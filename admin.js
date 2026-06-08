const config = window.GRADLOOP_CONFIG || {};
const paymentConfig = config.payments || {};
const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const hasWechatPay =
  Boolean(paymentConfig.wechatPayEnabled && paymentConfig.wechatNativeFunctionName) && hasSupabaseConfig;
const db =
  hasSupabaseConfig && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

const adminStatus = document.querySelector("#adminStatus");
const loginPanel = document.querySelector("#loginPanel");
const dashboardPanel = document.querySelector("#dashboardPanel");
const listingsPanel = document.querySelector("#listings");
const tradesPanel = document.querySelector("#trades");
const reportsPanel = document.querySelector("#reports");
const adminLoginForm = document.querySelector("#adminLoginForm");
const signOutButton = document.querySelector("#signOutButton");
const refreshAdmin = document.querySelector("#refreshAdmin");
const statsGrid = document.querySelector("#statsGrid");
const adminListings = document.querySelector("#adminListings");
const adminTrades = document.querySelector("#adminTrades");
const adminReports = document.querySelector("#adminReports");
const adminStatusFilter = document.querySelector("#adminStatusFilter");
const tradeStatusFilter = document.querySelector("#tradeStatusFilter");
const adminPaymentDialog = document.querySelector("#adminPaymentDialog");
const adminPaymentResult = document.querySelector("#adminPaymentResult");

let allListings = [];
let allTrades = [];
let allPayments = [];
let allReports = [];

function setStatus(kind, title, detail) {
  adminStatus.className = `status-band ${kind}`;
  adminStatus.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  return `£${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;
}

function settlementMoney(value) {
  const currency = paymentConfig.settlementCurrency || "CNY";
  return `${currency} ${Number(value || 0).toFixed(2).replace(/\.00$/, "")}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status) {
  const labels = {
    active: "展示中",
    hidden: "已下架",
    sold: "已成交",
    flagged: "待处理",
  };
  return labels[status] || status;
}

function tradeStatusLabel(status) {
  const labels = {
    pending_review: "待审核",
    awaiting_deposit: "待交保证金",
    in_escrow: "担保中",
    completed: "已完成",
    cancelled: "已取消",
  };
  return labels[status] || status;
}

function contactLabel(method) {
  const labels = {
    wechat: "微信",
    email: "邮箱",
    phone: "手机号",
  };
  return labels[method] || "联系方式";
}

function paymentRoleLabel(role) {
  return role === "seller" ? "卖家保证金" : "买家保证金";
}

function paymentStatusLabel(status) {
  const labels = {
    created: "已创建",
    qr_created: "二维码已生成",
    paid: "已支付",
    failed: "失败",
    closed: "已关闭",
    refunded: "已退款",
  };
  return labels[status] || status;
}

function renderPaymentBadges(tradeId) {
  const payments = allPayments.filter((payment) => payment.trade_request_id === tradeId);
  if (!payments.length) return `<p>保证金支付：暂未生成微信支付订单</p>`;

  return `
    <div class="payment-badges">
      ${payments
        .map(
          (payment) => `
            <span class="status-pill ${payment.status === "paid" ? "active" : "flagged"}">
              ${paymentRoleLabel(payment.payer_role)} · ${paymentStatusLabel(payment.status)} · ${settlementMoney(payment.amount_cny)}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

async function renderPaymentQr(container, codeUrl) {
  const canvas = container?.querySelector("canvas");
  if (!canvas || !codeUrl) return;

  if (window.QRCode?.toCanvas) {
    await window.QRCode.toCanvas(canvas, codeUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#17211b",
        light: "#ffffff",
      },
    });
    return;
  }

  const fallback = document.createElement("a");
  fallback.href = codeUrl;
  fallback.target = "_blank";
  fallback.rel = "noreferrer";
  fallback.textContent = "打开微信支付链接";
  canvas.replaceWith(fallback);
}

async function createWechatPayment(tradeRequestId, payerRole) {
  if (!db || !hasWechatPay) {
    throw new Error("微信支付尚未启用。请先部署 Supabase Edge Function 并打开 config.js 的 wechatPayEnabled。");
  }

  const { data, error } = await db.functions.invoke(paymentConfig.wechatNativeFunctionName, {
    body: {
      tradeRequestId,
      payerRole,
    },
  });

  if (error) throw error;
  if (!data?.codeUrl) {
    throw new Error(data?.error || "微信支付二维码生成失败。");
  }
  return data;
}

function showAuthedUi(show) {
  loginPanel.hidden = show;
  dashboardPanel.hidden = !show;
  listingsPanel.hidden = !show;
  tradesPanel.hidden = !show;
  reportsPanel.hidden = !show;
  signOutButton.hidden = !show;
}

async function initAdmin() {
  if (!db) {
    setStatus("demo", "后台未连接", "请先在 config.js 中填入 Supabase Project URL 和 anon public key。");
    showAuthedUi(false);
    return;
  }

  const { data } = await db.auth.getSession();
  if (!data.session) {
    setStatus("loading", "等待管理员登录", "请输入管理员邮箱，点击邮件中的 Magic Link 后回到本页面。");
    showAuthedUi(false);
    return;
  }

  const email = data.session.user.email;
  const allowed = await isAdmin(email);
  if (!allowed) {
    setStatus("error", "没有管理员权限", `${email} 不在 admin_users 表中。请先把你的邮箱加入数据库。`);
    showAuthedUi(false);
    return;
  }

  setStatus("live", "管理员已登录", `当前管理员：${email}`);
  showAuthedUi(true);
  await loadAdminData();
}

async function isAdmin(email) {
  const { data, error } = await db.from("admin_users").select("email").eq("email", email).maybeSingle();
  return !error && Boolean(data);
}

async function sendMagicLink(event) {
  event.preventDefault();
  const email = new FormData(adminLoginForm).get("email").trim();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href.split("#")[0],
    },
  });

  if (error) {
    setStatus("error", "登录邮件发送失败", error.message);
  } else {
    setStatus("live", "登录邮件已发送", "请打开邮箱，点击 Supabase Magic Link 回到管理后台。");
  }
}

async function loadAdminData() {
  setStatus("loading", "正在读取后台数据", "正在加载全站商品和举报工单。");
  const [listingsResult, tradesResult, reportsResult, paymentsResult] = await Promise.all([
    db.from("listings").select("*").order("created_at", { ascending: false }),
    db
      .from("trade_requests")
      .select("*, listings(title, city, price, contact_name, contact_method, contact_value, status)")
      .order("created_at", { ascending: false }),
    db
      .from("listing_reports")
      .select("*, listings(title, city, status)")
      .order("created_at", { ascending: false }),
    db.from("payment_orders").select("*").order("created_at", { ascending: false }),
  ]);

  if (listingsResult.error) {
    setStatus("error", "商品读取失败", listingsResult.error.message);
    return;
  }

  if (tradesResult.error) {
    setStatus("error", "担保交易读取失败", `${tradesResult.error.message}。如果刚新增功能，请运行 add-trade-requests.sql。`);
    return;
  }

  if (reportsResult.error) {
    setStatus("error", "举报读取失败", reportsResult.error.message);
    return;
  }

  allListings = listingsResult.data || [];
  allTrades = tradesResult.data || [];
  allPayments = paymentsResult.error ? [] : paymentsResult.data || [];
  allReports = reportsResult.data || [];
  setStatus(
    paymentsResult.error ? "demo" : "live",
    "后台数据已同步",
    paymentsResult.error
      ? "商品和交易已加载；如果要启用微信支付，请先运行 add-wechat-payments.sql。"
      : "你现在可以管理商品、查看举报和跟踪保证金支付订单。",
  );
  renderStats();
  renderListings();
  renderTrades();
  renderReports();
}

function renderStats() {
  const active = allListings.filter((item) => item.status === "active").length;
  const hidden = allListings.filter((item) => item.status === "hidden").length;
  const sold = allListings.filter((item) => item.status === "sold").length;
  const reports = allReports.length;
  const trades = allTrades.length;
  const paidOrders = allPayments.filter((item) => item.status === "paid").length;
  statsGrid.innerHTML = `
    <article><strong>${allListings.length}</strong><p>总商品数</p></article>
    <article><strong>${active}</strong><p>展示中</p></article>
    <article><strong>${hidden}</strong><p>已下架</p></article>
    <article><strong>${sold}</strong><p>已成交</p></article>
    <article><strong>${reports}</strong><p>举报工单</p></article>
    <article><strong>${trades}</strong><p>担保交易申请</p></article>
    <article><strong>${paidOrders}</strong><p>已支付保证金</p></article>
  `;
}

function renderListings() {
  const filter = adminStatusFilter.value;
  const items = filter === "all" ? allListings : allListings.filter((item) => item.status === filter);
  if (!items.length) {
    adminListings.innerHTML = `<div class="empty-state"><h3>暂无商品</h3><p>换个状态筛选看看。</p></div>`;
    return;
  }

  adminListings.innerHTML = items
    .map(
      (item) => `
        <article class="admin-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.city)} · ${escapeHtml(item.category)} · ${money(item.price)} · ${formatDate(
              item.created_at,
            )}</p>
            <p>${escapeHtml(item.description)}</p>
            <p>${escapeHtml(item.contact_name)} · ${contactLabel(item.contact_method)}：${escapeHtml(
              item.contact_value,
            )}</p>
          </div>
          <div class="admin-row-side">
            <span class="status-pill ${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
            <button data-status="active" data-id="${item.id}">恢复</button>
            <button data-status="hidden" data-id="${item.id}">下架</button>
            <button data-status="sold" data-id="${item.id}">已成交</button>
            <button data-status="flagged" data-id="${item.id}">待处理</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderTrades() {
  const filter = tradeStatusFilter.value;
  const items = filter === "all" ? allTrades : allTrades.filter((item) => item.status === filter);
  if (!items.length) {
    adminTrades.innerHTML = `<div class="empty-state"><h3>暂无担保交易申请</h3><p>买家点击“发起平台担保交易”后会显示在这里。</p></div>`;
    return;
  }

  adminTrades.innerHTML = items
    .map(
      (trade) => `
        <article class="admin-row">
          <div>
            <strong>${escapeHtml(trade.listings?.title || "商品已删除")} · ${money(trade.listings?.price)}</strong>
            <p>买家：${escapeHtml(trade.buyer_name)} · ${contactLabel(trade.buyer_contact_method)}：${escapeHtml(
              trade.buyer_contact_value,
            )}</p>
            <p>卖家：${escapeHtml(trade.listings?.contact_name || "-")} · ${contactLabel(
              trade.listings?.contact_method,
            )}：${escapeHtml(trade.listings?.contact_value || "-")}</p>
            <p>方式：${trade.fulfillment_method === "pickup" ? "同城面交" : "快递"} · 买家保证金 ${money(
              trade.buyer_deposit_amount,
            )} · 卖家保证金 ${money(trade.seller_deposit_amount)}</p>
            <p>${escapeHtml(trade.message)}</p>
            ${renderPaymentBadges(trade.id)}
            <p>${formatDate(trade.created_at)}</p>
          </div>
          <div class="admin-row-side">
            <span class="status-pill flagged">${tradeStatusLabel(trade.status)}</span>
            <button data-payment-role="buyer" data-id="${trade.id}">买家保证金二维码</button>
            <button data-payment-role="seller" data-id="${trade.id}">卖家保证金二维码</button>
            <button data-trade-status="pending_review" data-id="${trade.id}">待审核</button>
            <button data-trade-status="awaiting_deposit" data-id="${trade.id}">待交保证金</button>
            <button data-trade-status="in_escrow" data-id="${trade.id}">担保中</button>
            <button data-trade-status="completed" data-id="${trade.id}">完成</button>
            <button data-trade-status="cancelled" data-id="${trade.id}">取消</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderReports() {
  if (!allReports.length) {
    adminReports.innerHTML = `<div class="empty-state"><h3>暂无举报</h3><p>用户举报会显示在这里。</p></div>`;
    return;
  }

  adminReports.innerHTML = allReports
    .map(
      (report) => `
        <article class="admin-row">
          <div>
            <strong>${escapeHtml(report.reason)} · ${escapeHtml(report.listings?.title || "商品已删除")}</strong>
            <p>${escapeHtml(report.details)}</p>
            <p>举报人：${escapeHtml(report.reporter_contact || "未留联系方式")} · ${formatDate(report.created_at)}</p>
          </div>
          <div class="admin-row-side">
            <span class="status-pill flagged">${escapeHtml(report.listings?.status || "unknown")}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

async function updateTradeStatus(id, status) {
  const { error } = await db
    .from("trade_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    setStatus("error", "交易状态更新失败", error.message);
    return;
  }

  allTrades = allTrades.map((item) => (item.id === id ? { ...item, status } : item));
  setStatus("live", "交易状态已更新", `交易申请已标记为：${tradeStatusLabel(status)}`);
  renderStats();
  renderTrades();
}

async function openAdminPayment(id, payerRole) {
  if (!adminPaymentDialog || !adminPaymentResult) return;

  adminPaymentResult.className = "payment-result loading";
  adminPaymentResult.innerHTML = `
    <strong>正在生成微信支付二维码</strong>
    <p>${paymentRoleLabel(payerRole)}订单正在创建，请稍等。</p>
  `;
  adminPaymentDialog.showModal();

  try {
    const payment = await createWechatPayment(id, payerRole);
    adminPaymentResult.className = "payment-result live";
    adminPaymentResult.innerHTML = `
      <strong>${paymentRoleLabel(payerRole)}二维码已生成</strong>
      <p>金额：${settlementMoney(payment.amountCny)}。请让对应用户用微信扫码支付。</p>
      <div class="payment-qr">
        <canvas aria-label="微信支付二维码"></canvas>
        <div>
          <span>商户订单号</span>
          <strong>${escapeHtml(payment.outTradeNo)}</strong>
          <p>支付成功后，微信回调会把这笔订单标记为已支付。</p>
        </div>
      </div>
    `;
    await renderPaymentQr(adminPaymentResult, payment.codeUrl);
    await loadAdminData();
  } catch (error) {
    adminPaymentResult.className = "payment-result error";
    adminPaymentResult.innerHTML = `
      <strong>二维码生成失败</strong>
      <p>${escapeHtml(error.message || String(error))}</p>
    `;
  }
}

async function updateListingStatus(id, status) {
  const { error } = await db
    .from("listings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    setStatus("error", "更新失败", error.message);
    return;
  }

  allListings = allListings.map((item) => (item.id === id ? { ...item, status } : item));
  setStatus("live", "商品状态已更新", `商品已标记为：${statusLabel(status)}`);
  renderStats();
  renderListings();
}

adminLoginForm.addEventListener("submit", sendMagicLink);
signOutButton.addEventListener("click", async () => {
  await db.auth.signOut();
  showAuthedUi(false);
  setStatus("loading", "已退出登录", "如需继续管理，请重新发送登录邮件。");
});
refreshAdmin?.addEventListener("click", loadAdminData);
adminStatusFilter?.addEventListener("input", renderListings);
tradeStatusFilter?.addEventListener("input", renderTrades);
adminListings?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button) return;
  updateListingStatus(button.dataset.id, button.dataset.status);
});
adminTrades?.addEventListener("click", (event) => {
  const paymentButton = event.target.closest("[data-payment-role]");
  if (paymentButton) {
    openAdminPayment(paymentButton.dataset.id, paymentButton.dataset.paymentRole);
    return;
  }

  const button = event.target.closest("[data-trade-status]");
  if (!button) return;
  updateTradeStatus(button.dataset.id, button.dataset.tradeStatus);
});

initAdmin();
