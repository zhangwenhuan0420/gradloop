const DATA_VERSION = "2026-06-07-d";

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
    createdAt: "周四 20:18",
  },
];

const state = {
  listings: loadListings(),
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
const reviewPrice = document.querySelector("#reviewPrice");
const penaltyRate = document.querySelector("#penaltyRate");
const penaltyRateLabel = document.querySelector("#penaltyRateLabel");
const penaltyAmount = document.querySelector("#penaltyAmount");

function loadListings() {
  const version = localStorage.getItem("gradloop:version");
  if (version !== DATA_VERSION) {
    localStorage.setItem("gradloop:version", DATA_VERSION);
    localStorage.removeItem("gradloop:listings");
    localStorage.removeItem("gradloop:saved");
  }

  const stored = localStorage.getItem("gradloop:listings");
  return stored ? JSON.parse(stored) : seedListings;
}

function saveListings() {
  localStorage.setItem("gradloop:listings", JSON.stringify(state.listings));
}

function saveFavorites() {
  localStorage.setItem("gradloop:saved", JSON.stringify([...state.saved]));
}

function populateFilters() {
  const cities = [...new Set(state.listings.map((item) => item.city))].sort();
  const categories = [...new Set(state.listings.map((item) => item.category))].sort();

  cityFilter.innerHTML = `<option value="all">全部城市</option>${cities
    .map((city) => `<option value="${city}">${city}</option>`)
    .join("")}`;

  categoryFilter.innerHTML = `<option value="all">全部品类</option>${categories
    .map((category) => `<option value="${category}">${category}</option>`)
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

function money(value) {
  return `£${Number(value).toFixed(2).replace(/\.00$/, "")}`;
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
        <img src="${item.image}" alt="${item.title}" loading="lazy">
        <div class="badge-row">
          <span class="badge ${isBuy ? "buy" : ""}">${isBuy ? "想买" : "想卖"}</span>
          <button class="save-button ${saved ? "saved" : ""}" data-save="${item.id}" aria-label="收藏 ${item.title}">
            ${saved ? "★" : "☆"}
          </button>
        </div>
      </div>
      <div class="listing-body">
        <div class="price-row">
          <h3>${item.title}</h3>
          <span class="price">${money(item.price)}</span>
        </div>
        <span class="meta">${item.city} · ${item.category} · ${item.createdAt}</span>
        <p>${item.description}</p>
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
          <span>免费试用版</span>
          <span>默认扣罚 ${Math.round(escrow.issuePenaltyRate * 100)}%</span>
          <span>卖家押金 ${Math.round(escrow.sellerDepositRate * 100)}%</span>
          ${item.urgent ? "<span>急出 / 急需</span>" : ""}
        </div>
        <button class="contact-button" data-contact="${item.id}">
          ${isBuy ? "我有这个，联系 TA" : "联系卖家"}
        </button>
      </div>
    </article>
  `;
}

function openPostDialog() {
  if (typeof postDialog.showModal === "function") {
    postDialog.showModal();
  }
}

function addListing(event) {
  event.preventDefault();
  const formData = new FormData(postForm);
  const listing = {
    id: crypto.randomUUID(),
    type: formData.get("type"),
    title: formData.get("title").trim(),
    price: Number(formData.get("price")),
    city: formData.get("city"),
    category: formData.get("category"),
    method: formData.get("method"),
    sellerDepositRate: Number(formData.get("sellerDepositRate")),
    urgent: formData.has("urgent"),
    description: formData.get("description").trim(),
    image:
      "https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=700&q=85",
    createdAt: "刚刚",
  };

  state.listings = [listing, ...state.listings];
  saveListings();
  populateFilters();
  renderListings();
  postForm.reset();
  postDialog.close();
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
      `已打开与 ${item.city} 发布者的聊天入口。\n\n保证金预估：买家托管 ${money(
        escrow.buyerDeposit,
      )}，卖家保证金 ${money(escrow.sellerDeposit)}。免费试用版不收交易服务费，MVP 中这里会接入站内私信和托管支付。`,
    );
  }
});

postForm.addEventListener("submit", addListing);

function updatePenaltyReview() {
  if (!reviewPrice || !penaltyRate || !penaltyRateLabel || !penaltyAmount) return;
  const price = Number(reviewPrice.value || 0);
  const rate = Number(penaltyRate.value || 0);
  penaltyRateLabel.textContent = `${rate}%`;
  penaltyAmount.textContent = money(price * (rate / 100));
}

reviewPrice?.addEventListener("input", updatePenaltyReview);
penaltyRate?.addEventListener("input", updatePenaltyReview);

populateFilters();
renderListings();
updatePenaltyReview();
