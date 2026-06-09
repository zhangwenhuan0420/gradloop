import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(`Missing environment variable: ${name}`, 500);
  return value;
}

function supabaseSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys);
    if (parsed.default) return parsed.default;
  }

  throw new HttpError("Missing Supabase secret key for admin operations.", 500);
}

function normalizePem(value: string, label: "PUBLIC KEY") {
  const normalized = value.trim().replace(/\\n/g, "\n");
  if (normalized.includes(`BEGIN ${label}`)) return normalized;

  const wrapped = normalized.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n");
  if (!wrapped) throw new HttpError(`Invalid ${label} PEM`, 500);
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyWechatSignature(req: Request, rawBody: string, platformPublicKeyPem: string) {
  const timestamp = req.headers.get("Wechatpay-Timestamp");
  const nonce = req.headers.get("Wechatpay-Nonce");
  const signature = req.headers.get("Wechatpay-Signature");
  if (!timestamp || !nonce || !signature) {
    throw new HttpError("Missing WeChat Pay signature headers.", 401);
  }

  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(platformPublicKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    bytesFromBase64(signature),
    new TextEncoder().encode(message),
  );

  if (!ok) throw new HttpError("Invalid WeChat Pay signature.", 401);
}

async function decryptResource(resource: {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}, apiV3Key: string) {
  if (apiV3Key.length !== 32) {
    throw new HttpError("WECHAT_PAY_API_V3_KEY must be 32 characters.", 500);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiV3Key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new TextEncoder().encode(resource.nonce),
      additionalData: new TextEncoder().encode(resource.associated_data || ""),
    },
    key,
    bytesFromBase64(resource.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function refreshTradeStatus(adminClient: ReturnType<typeof createClient>, tradeRequestId: string) {
  const { data: trade } = await adminClient
    .from("trade_requests")
    .select("status")
    .eq("id", tradeRequestId)
    .maybeSingle();
  if (!trade || ["completed", "cancelled"].includes(trade.status)) return;

  const { data: payments } = await adminClient
    .from("payment_orders")
    .select("payer_role, status")
    .eq("trade_request_id", tradeRequestId);

  const buyerPaid = payments?.some((item) => item.payer_role === "buyer" && item.status === "paid");
  const sellerPaid = payments?.some((item) => item.payer_role === "seller" && item.status === "paid");
  const nextStatus = buyerPaid && sellerPaid ? "in_escrow" : "awaiting_deposit";

  await adminClient
    .from("trade_requests")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tradeRequestId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const rawBody = await req.text();
    const platformPublicKeyPem = normalizePem(requiredEnv("WECHAT_PAY_PLATFORM_PUBLIC_KEY"), "PUBLIC KEY");
    await verifyWechatSignature(req, rawBody, platformPublicKeyPem);

    const event = JSON.parse(rawBody);
    const plaintext = await decryptResource(event.resource, requiredEnv("WECHAT_PAY_API_V3_KEY"));
    const transaction = JSON.parse(plaintext);
    const outTradeNo = transaction.out_trade_no;
    if (!outTradeNo) throw new HttpError("out_trade_no is missing in notification.", 400);

    const adminClient = createClient(requiredEnv("SUPABASE_URL"), supabaseSecretKey(), {
      auth: {
        persistSession: false,
      },
    });

    if (event.event_type === "TRANSACTION.SUCCESS" || transaction.trade_state === "SUCCESS") {
      const { data: payment } = await adminClient
        .from("payment_orders")
        .update({
          status: "paid",
          transaction_id: transaction.transaction_id,
          raw_notify: event,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("out_trade_no", outTradeNo)
        .select("trade_request_id")
        .maybeSingle();

      if (payment?.trade_request_id) {
        await refreshTradeStatus(adminClient, payment.trade_request_id);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return new Response(message, { status });
  }
});
