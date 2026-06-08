const DATA_VERSION = "2026-06-08-live-v1";
const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=700&q=85";

const seedListings = [
  {
    id: "macbook-air",
    type: "sell",
    title: "MacBook Air M1 8+256",
    price: 420,
    city: "Manchester",
    category: "电子数码",
    method: "both",
    sellerDepositRate: 0.5,
    urgent: true,
    description: "毕业回国急出，电池健康 91%，可当面验机，带英规充电器。",
    image:
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=700&q=85",
    contactName: "Demo seller",
    contactMethod: "wechat",
    contactValue: "gradloop_demo",
    createdAt: "今天 14:20",
  },
  {
    id: "rice-cooker",
    type: "sell",
    title: "小米电饭煲 3L",
    price: 28,
    city: "London",
    category: "厨房家电",
    method: "pickup",
    sellerDepositRate: 0.5,
    urgent: true,
    description: "适合 1 到 3 人，锅胆干净，Canary Wharf 附近自取。",
    image:
      "https://images.unsplash.com/photo-1588610875261-9a1babae26f3?auto=format&fit=crop&w=700&q=85",
    contactName: "Demo seller",
    contactMethod: "wechat",
    contactValue: "gradloop_demo",
    createdAt: "今天 11:06",
  },
  {
    id: "bike",
    type: "buy",
    title: "求购通勤自行车",
    price: 90,
    city: "Edinburgh",
    category: "交通出行",
    method: "pickup",
    sellerDepositRate: 0.5,
    urgent: false,
    description: "身高 170，想买一辆能正常骑的通勤车，最好可在学校附近看车。",
    image:
      "https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=700&q=85",
    contactName: "Demo buyer",
    contactMethod: "email",
    contactValue: "demo@example.com",
    createdAt: "昨天 18:45",
  },
  {
    id: "desk-chair",
    type: "sell",
    title: "IKEA 书桌椅一套",
    price: 45,
    city: "Birmingham",
    category: "家具家居",
    method: "pickup",
    sellerDepositRate: 0.5,
    urgent: false,
    description: "书桌 120cm，椅子可升降。需要买家自取，电梯公寓。",
    image:
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=700&q=85",
    contactName: "Demo seller",
    contactMethod: "wechat",
    contactValue: "gradloop_demo",
    createdAt: "昨天 09:12",
  },
  {
    id: "monitor",
    type: "sell",
    title: "Dell 24 寸显示器",
    price: 65,
    city: "Leeds",
    category: "电子数码",
    method: "delivery",
    sellerDepositRate: 0.5,
    urgent: false,
    description: "1080p，办公写论文很好用。可邮寄，邮费买家承担。",
    image:
      "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=700&q=85",
    contactName: "Demo seller",
    contactMethod: "wechat",
    contactValue: "gradloop_demo",
    createdAt: "周五 16:30",
  },
  {
    id: "textbooks",
    type: "buy",
    title: "求二手 ACCA 教材",
    price: 35,
    city: "Glasgow",
    category: "书籍资料",
    method: "delivery",
    sellerDepositRate: 0.5,
    urgent: false,
    description: "求 PM 和 FR 两本，2024 或 2025 版都可以，接受邮寄。",
    image:
      "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=700&q=85",
    contactName: "Demo buyer",
    contactMethod: "email",
    contactValue: "demo@example.com",
    createdAt: "周四 20:18",
  },
];

const config = window.GRADLOOP_CONFIG || {};
const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const db =
  hasSupabaseConfig && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

const state = {
  listings: [],
  saved: new Set(JSON.parse(localStorage.getItem("gradloop:saved") || "[]")),
  quick: "all",
};

const grid = document.querySelector("#listingGrid");
const emptyState = document.querySelector("#emptyState");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const cityFilter = document.querySelector("#cityFilter");
const categoryFilter = document.querySelector("#categoryFilter");
const typeFilter = document.querySelector("#typeFilter");
const postDialog = document.querySelector("#postDialog");
const postForm = document.querySelector("#postForm");
const reportDialog = document.querySelector("#reportDialog");
const reportForm = document.querySelector("#reportForm");
const backendStatus = document.querySelector("#backendStatus");
const reviewPrice = document.querySelector("#reviewPrice");
const penaltyRate = document.querySelector("#penaltyRate");
const penaltyRateLabel = document.querySelector("#penaltyRateLabel");
const penaltyAmount = document.querySelector("#penaltyAmount");

function setBackendStatus(kind, title, detail) {
  if (!backendStatus) return;
  backendStatus.className = `status-band ${kind}`;
  backendStatus.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
}

function loadDemoListings() {
  const version = localStorage.getItem("gradloop:version");
  if (version !== DATA_VERSION) {
    localStorage.setItem("gradloop:version", DATA_VERSION);
    localStorage.removeItem("gradloop:listings");
    localStorage.removeItem("gradloop:saved");
  }

  const stored = localStorage.getItem("gradloop:listings");
  return stored ? JSON.parse(stored) : seedListings;
}

function saveDemoListings() {
  localStorage.setItem("gradloop:listings", JSON.stringify(state.listings));
}

function saveFavorites() {
  localStorage.setItem("gradloop:saved", JSON.stringify([...state.saved]));
}

function normalizeListing(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    price: Number(row.price),
    city: row.city,
    category: row.category,
    method: row.method,
    sellerDepositRate: Number(row.seller_deposit_rate ?? row.sellerDepositRate ?? 0.5),
    urgent: Boolean(row.urgent),
    description: row.description,
    image: row.image || DEFAULT_IMAGE,
    contactName: row.contact_name || row.contactName || "发布者",
    contactMethod: row.contact_method || row.contactMethod || "wechat",
    contactValue: row.contact_value || row.contactValue || "",
    status: row.status || "active",
    reportCount: Number(row.report_count || row.reportCount || 0),
    createdAt: row.created_at ? formatDate(row.created_at) : row.createdAt || "刚刚",
  };
}

function toDatabasePayload(listing) {
  return {
    type: listing.type,
    title: listing.title,
    price: listing.price,
    city: listing.city,
    category: listing.category,
    method: listing.method,
    seller_deposit_rate: listing.sellerDepositRate,
    urgent: listing.urgent,
    description: listing.description,
    image: listing.image || DEFAULT_IMAGE,
    contact_name: listing.contactName,
    contact_method: listing.contactMethod,
    contact_value: listing.contactValue,
    status: "active",
  };
}

async function loadListings() {
  if (!db) {
    state.listings = loadDemoListings().map(normalizeListing);
    setBackendStatus("demo", "演示模式", "还没有配置 Supabase。当前发布只保存在本机浏览器里。");
    populateFilters();
    renderListings();
    return;
  }

  setBackendStatus("loading", "正在连接数据库", "正在读取 Supabase 中的真实商品数据。");
  const { data, error } = await db
    .from("listings")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    state.listings = [];
    setBackendStatus("error", "数据库连接失败", "请检查 Supabase URL、anon key 和 SQL 表结构。");
  } else {
    state.listings = data.map(normalizeListing);
    setBackendStatus("live", "真实平台模式", "商品会保存到 Supabase 数据库，管理员后台可以审核和下架。");
  }

  populateFilters();
  renderListings();
}

function populateFilters() {
  const defaultCities = ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Leeds", "Nottingham", "Bristol"];
  const defaultCategories = ["电子数码", "厨房家电", "家具家居", "交通出行", "书籍资料", "生活杂物"];
  const cities = [...new Set([...defaultCities, ...state.listings.map((item) => item.city)])].sort();
  const categories = [...new Set([...defaultCategories, ...state.listings.map((item) => item.category)])].sort();

  cityFilter.innerHTML = `<option value="all">全部城市</option>${cities
    .map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`)
    .join("")}`;

  categoryFilter.innerHTML = `<option value="all">全部品类</option>${categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("")}`;
}

function methodLabel(method) {
  const labels = {
    pickup: "同城自取",
    delivery: "支持快递",
    both: "自取或快递",
  };
  return labels[method] || method;
}

function contactMethodLabel(method) {
  const labels = {
    wechat: "微信",
    email: "邮箱",
    phone: "手机号",
  };
  return labels[method] || "联系方式";
}

function money(value) {
  return `£${Number(value).toFixed(2).replace(/\.00$/, "")}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escrowFor(item) {
  const price = Number(item.price);
  const sellerDepositRate = Number(item.sellerDepositRate ?? 0.5);
  return {
    buyerDeposit: price,
    sellerDeposit: price * sellerDepositRate,
    issuePenaltyRate: 0.1,
    issuePenalty: price * 0.1,
    sellerDepositRate,
  };
}

function matchesQuick(item) {
  if (state.quick === "all") return true;
  if (state.quick === "pickup") return item.method === "pickup" || item.method === "both";
  if (state.quick === "delivery") return item.method === "delivery" || item.method === "both";
  if (state.quick === "urgent") return item.urgent;
  if (state.quick === "saved") return state.saved.has(item.id);
  return true;
}

function getFilteredListings() {
  const query = searchInput.value.trim().toLowerCase();
  return state.listings.filter((item) => {
    const haystack = `${item.title} ${item.description} ${item.category} ${item.city}`.toLowerCase();
    const searchMatch = !query || haystack.includes(query);
    const cityMatch = cityFilter.value === "all" || item.city === cityFilter.value;
    const categoryMatch = categoryFilter.value === "all" || item.category === categoryFilter.value;
    const typeMatch = typeFilter.value === "all" || item.type === typeFilter.value;
    return searchMatch && cityMatch && categoryMatch && typeMatch && matchesQuick(item);
  });
}

function renderListings() {
  const items = getFilteredListings();
  grid.innerHTML = items.map(renderCard).join("");
  emptyState.hidden = items.length > 0;
  resultCount.textContent = `${items.length} 条结果`;
}

function renderCard(item) {
  const isBuy = item.type === "buy";
  const saved = state.saved.has(item.id);
  const escrow = escrowFor(item);
  return `
    <article class="listing-card">
      <div class="listing-image">
        <img src="${escapeHtml(item.image || DEFAULT_IMAGE)}" alt="${escapeHtml(item.title)}" loading="lazy">
        <div class="badge-row">
          <span class="badge ${isBuy ? "buy" : ""}">${isBuy ? "想买" : "想卖"}</span>
          <button class="save-button ${saved ? "saved" : ""}" data-save="${escapeHtml(item.id)}" aria-label="收藏 ${escapeHtml(
            item.title,
          )}">
            ${saved ? "★" : "☆"}
          </button>
        </div>
      </div>
      <div class="listing-body">
        <div class="price-row">
          <h3>${escapeHtml(item.title)}</h3>
          <span class="price">${money(item.price)}</span>
        </div>
        <span class="meta">${escapeHtml(item.city)} · ${escapeHtml(item.category)} · ${escapeHtml(item.createdAt)}</span>
        <p>${escapeHtml(item.description)}</p>
        <div class="escrow-summary" aria-label="保证金摘要">
          <div>
            <span>买家托管</span>
            <strong>${money(escrow.buyerDeposit)}</strong>
          </div>
          <div>
            <span>卖家保证金</span>
            <strong>${money(escrow.sellerDeposit)}</strong>
          </div>
        </div>
        <div class="tags">
          <span>${methodLabel(item.method)}</span>
          <span>${db ? "真实数据库" : "演示模式"}</span>
          <span>默认扣罚 ${Math.round(escrow.issuePenaltyRate * 100)}%</span>
          <span>卖家押金 ${Math.round(escrow.sellerDepositRate * 100)}%</span>
          ${item.urgent ? "<span>急出 / 急需</span>" : ""}
        </div>
        <div class="card-actions">
          <button class="contact-button" data-contact="${escapeHtml(item.id)}">
            ${isBuy ? "我有这个，联系 TA" : "联系发布者"}
          </button>
          <button class="report-button" data-report="${escapeHtml(item.id)}">举报</button>
        </div>
      </div>
    </article>
  `;
}

function openPostDialog() {
  if (typeof postDialog.showModal === "function") {
    postDialog.showModal();
  }
}

async function addListing(event) {
  event.preventDefault();
  const formData = new FormData(postForm);
  const listing = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: formData.get("type"),
    title: formData.get("title").trim(),
    price: Number(formData.get("price")),
    city: formData.get("city"),
    category: formData.get("category"),
    method: formData.get("method"),
    sellerDepositRate: Number(formData.get("sellerDepositRate")),
    urgent: formData.has("urgent"),
    description: formData.get("description").trim(),
    image: formData.get("image")?.trim() || DEFAULT_IMAGE,
    contactName: formData.get("contactName").trim(),
    contactMethod: formData.get("contactMethod"),
    contactValue: formData.get("contactValue").trim(),
    createdAt: "刚刚",
  };

  const submitButton = postForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "发布中...";

  try {
    if (db) {
      const { data, error } = await db.from("listings").insert(toDatabasePayload(listing)).select("*").single();
      if (error) throw error;
      state.listings = [normalizeListing(data), ...state.listings];
    } else {
      state.listings = [listing, ...state.listings];
      saveDemoListings();
    }

    populateFilters();
    renderListings();
    postForm.reset();
    postDialog.close();
    alert(db ? "发布成功，商品已进入真实市场。" : "演示发布成功。配置 Supabase 后会进入真实数据库。");
  } catch (error) {
    console.error(error);
    alert(`发布失败：${error.message || "请检查数据库配置"}`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "发布到市场";
  }
}

function openReportDialog(id) {
  if (!reportDialog || !reportForm) return;
  reportForm.elements.listingId.value = id;
  reportDialog.showModal();
}

async function submitReport(event) {
  event.preventDefault();
  const formData = new FormData(reportForm);
  const report = {
    listing_id: formData.get("listingId"),
    reason: formData.get("reason"),
    details: formData.get("details").trim(),
    reporter_contact: formData.get("reporterContact").trim(),
  };

  try {
    if (db) {
      const { error } = await db.from("listing_reports").insert(report);
      if (error) throw error;
      alert("举报已提交，管理员会在后台查看。");
    } else {
      alert("演示模式下不会提交到后台。配置 Supabase 后，举报会进入管理员后台。");
    }
    reportForm.reset();
    reportDialog.close();
  } catch (error) {
    console.error(error);
    alert(`举报失败：${error.message || "请稍后再试"}`);
  }
}

document.querySelectorAll("#openPostTop, #openPostHero, #openPostFilter").forEach((button) => {
  button.addEventListener("click", openPostDialog);
});

[searchInput, cityFilter, categoryFilter, typeFilter].forEach((control) => {
  control.addEventListener("input", renderListings);
});

document.querySelectorAll("[data-quick]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-quick]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.quick = button.dataset.quick;
    renderListings();
  });
});

grid.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-save]");
  const contactButton = event.target.closest("[data-contact]");
  const reportButton = event.target.closest("[data-report]");

  if (saveButton) {
    const id = saveButton.dataset.save;
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    saveFavorites();
    renderListings();
  }

  if (contactButton) {
    const item = state.listings.find((listing) => listing.id === contactButton.dataset.contact);
    const escrow = escrowFor(item);
    alert(
      `${item.contactName} 的${contactMethodLabel(item.contactMethod)}：${item.contactValue}\n\n保证金预估：买家托管 ${money(
        escrow.buyerDeposit,
      )}，卖家保证金 ${money(escrow.sellerDeposit)}。请优先选择公共地点面交并保留聊天记录。`,
    );
  }

  if (reportButton) {
    openReportDialog(reportButton.dataset.report);
  }
});

postForm.addEventListener("submit", addListing);
reportForm?.addEventListener("submit", submitReport);

function updatePenaltyReview() {
  if (!reviewPrice || !penaltyRate || !penaltyRateLabel || !penaltyAmount) return;
  const price = Number(reviewPrice.value || 0);
  const rate = Number(penaltyRate.value || 0);
  penaltyRateLabel.textContent = `${rate}%`;
  penaltyAmount.textContent = money(price * (rate / 100));
}

reviewPrice?.addEventListener("input", updatePenaltyReview);
penaltyRate?.addEventListener("input", updatePenaltyReview);

loadListings();
updatePenaltyReview();
