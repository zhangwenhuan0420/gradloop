import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PayerRole = "buyer" | "seller";

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
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

function normalizePem(value: string, label: "PRIVATE KEY" | "PUBLIC KEY") {
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

function base64FromBytes(bytes: ArrayBuffer) {
  const array = new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomString(length = 16) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function createOutTradeNo() {
  return `GL${Date.now().toString(36).toUpperCase()}${randomString(8)}`.slice(0, 32);
}

function toWechatTime(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function signWechatMessage(message: string, privateKeyPem: string) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(message));
  return base64FromBytes(signature);
}

function roleAmount(trade: Record<string, unknown>, payerRole: PayerRole) {
  const field = payerRole === "seller" ? "seller_deposit_amount" : "buyer_deposit_amount";
  const amount = Number(trade[field] || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError("Deposit amount must be greater than 0.", 422);
  }
  return amount;
}

function paymentDescription(trade: Record<string, unknown>, payerRole: PayerRole) {
  const listing = trade.listings as { title?: string } | null;
  const label = payerRole === "seller" ? "Seller deposit" : "Buyer deposit";
  return `GradLoop ${label} ${listing?.title || ""}`.trim().slice(0, 120);
}

async function assertAdmin(req: Request, adminClient: ReturnType<typeof createClient>) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError("Admin login is required for seller deposit QR codes.", 401);

  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  const email = userData.user?.email;
  if (userError || !email) throw new HttpError("Admin login is invalid or expired.", 401);

  const { data: adminRow, error: adminError } = await adminClient
    .from("admin_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (adminError || !adminRow) throw new HttpError("This account is not an admin.", 403);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let paymentOrderId: string | null = null;
  let adminClient: ReturnType<typeof createClient> | null = null;

  try {
    const { tradeRequestId, payerRole } = await req.json();
    if (!tradeRequestId) throw new HttpError("tradeRequestId is required.");
    if (payerRole !== "buyer" && payerRole !== "seller") {
      throw new HttpError("payerRole must be buyer or seller.");
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = supabaseSecretKey();
    const mchid = requiredEnv("WECHAT_PAY_MCH_ID");
    const appid = requiredEnv("WECHAT_PAY_APP_ID");
    const serialNo = requiredEnv("WECHAT_PAY_CERT_SERIAL_NO");
    const notifyUrl = requiredEnv("WECHAT_PAY_NOTIFY_URL");
    const privateKeyPem = normalizePem(requiredEnv("WECHAT_PAY_PRIVATE_KEY"), "PRIVATE KEY");
    const gbpToCnyRate = Number(requiredEnv("GBP_TO_CNY_RATE"));
    if (!Number.isFinite(gbpToCnyRate) || gbpToCnyRate <= 0) {
      throw new HttpError("GBP_TO_CNY_RATE must be a positive number.", 500);
    }

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    if (payerRole === "seller") {
      await assertAdmin(req, adminClient);
    }

    const now = new Date();
    const { data: existingOrder } = await adminClient
      .from("payment_orders")
      .select("*")
      .eq("trade_request_id", tradeRequestId)
      .eq("payer_role", payerRole)
      .eq("provider", "wechat_pay")
      .in("status", ["created", "qr_created"])
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingOrder?.code_url) {
      return jsonResponse({
        paymentOrderId: existingOrder.id,
        outTradeNo: existingOrder.out_trade_no,
        codeUrl: existingOrder.code_url,
        amountGbp: Number(existingOrder.amount_gbp),
        amountCny: Number(existingOrder.amount_cny),
        currency: existingOrder.currency,
        reused: true,
      });
    }

    const { data: trade, error: tradeError } = await adminClient
      .from("trade_requests")
      .select("*, listings(title, price)")
      .eq("id", tradeRequestId)
      .single();

    if (tradeError || !trade) {
      throw new HttpError("Trade request was not found.", 404);
    }

    const amountGbp = roleAmount(trade, payerRole);
    const amountCny = Number((amountGbp * gbpToCnyRate).toFixed(2));
    const amountCnyFen = Math.max(1, Math.round(amountCny * 100));
    const outTradeNo = createOutTradeNo();
    const expiresAtDate = new Date(now.getTime() + 30 * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString();

    const wxPayload = {
      appid,
      mchid,
      description: paymentDescription(trade, payerRole),
      out_trade_no: outTradeNo,
      time_expire: toWechatTime(expiresAtDate),
      attach: JSON.stringify({ tradeRequestId, payerRole }),
      notify_url: notifyUrl,
      amount: {
        total: amountCnyFen,
        currency: "CNY",
      },
    };

    const { data: order, error: orderError } = await adminClient
      .from("payment_orders")
      .insert({
        trade_request_id: tradeRequestId,
        payer_role: payerRole,
        out_trade_no: outTradeNo,
        amount_gbp: amountGbp,
        amount_cny: amountCny,
        amount_cny_fen: amountCnyFen,
        currency: "CNY",
        status: "created",
        raw_request: wxPayload,
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (orderError || !order) {
      throw new HttpError(orderError?.message || "Could not create local payment order.", 500);
    }
    paymentOrderId = order.id;

    const method = "POST";
    const path = "/v3/pay/transactions/native";
    const body = JSON.stringify(wxPayload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomString(32);
    const signature = await signWechatMessage(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`, privateKeyPem);
    const authorization =
      `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;

    const wxResponse = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
    });
    const wxText = await wxResponse.text();
    const wxData = wxText ? JSON.parse(wxText) : {};

    if (!wxResponse.ok || !wxData.code_url) {
      await adminClient
        .from("payment_orders")
        .update({
          status: "failed",
          raw_response: wxData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentOrderId);
      throw new HttpError(wxData.message || "WeChat Pay order creation failed.", wxResponse.status || 502);
    }

    await adminClient
      .from("payment_orders")
      .update({
        status: "qr_created",
        code_url: wxData.code_url,
        raw_response: wxData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentOrderId);

    if (trade.status === "pending_review") {
      await adminClient
        .from("trade_requests")
        .update({
          status: "awaiting_deposit",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tradeRequestId);
    }

    return jsonResponse({
      paymentOrderId,
      outTradeNo,
      codeUrl: wxData.code_url,
      amountGbp,
      amountCny,
      currency: "CNY",
      expiresAt,
      reused: false,
    });
  } catch (error) {
    if (adminClient && paymentOrderId) {
      await adminClient
        .from("payment_orders")
        .update({
          status: "failed",
          raw_response: { error: error instanceof Error ? error.message : String(error) },
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentOrderId);
    }

    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, status);
  }
});
