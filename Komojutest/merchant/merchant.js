const qrForm = document.querySelector("#qrForm");
const qrResult = document.querySelector("#qrResult");
const merchantHistory = document.querySelector("#merchantHistory");
const refreshMerchantHistory = document.querySelector("#refreshMerchantHistory");
const billingTypeInput = document.querySelector("#billingTypeInput");
const periodField = document.querySelector(".merchant-period-field");
const merchantFilter = document.querySelector("#merchantFilter");
const portalConfig = window.KOMOJU_PORTAL_CONFIG || {};

let merchantOrders = [];

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function apiUrl(path) {
  const baseUrl = String(portalConfig.apiBaseUrl || "").trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

function consumerBaseUrl() {
  return new URL("../consumer/", window.location.href).href;
}

function buildCheckoutUrl(data) {
  const params = new URLSearchParams({
    merchantName: data.merchantName,
    productName: data.productName,
    amount: String(data.amount),
    billingType: data.billingType,
  });
  if (data.billingType === "subscription") params.set("period", data.period);
  const baseUrl = new URL(consumerBaseUrl());
  baseUrl.search = params.toString();
  return baseUrl.href;
}

function syncPeriodField() {
  periodField.hidden = billingTypeInput.value !== "subscription";
}

function readForm() {
  const form = new FormData(qrForm);
  return {
    merchantName: String(form.get("merchantName") || "").trim(),
    productName: String(form.get("productName") || "").trim(),
    amount: Number(form.get("amount")),
    billingType: form.get("billingType"),
    period: form.get("period") || "monthly",
  };
}

function applyQueryDefaults() {
  const params = new URLSearchParams(window.location.search);
  const assignments = [
    ["merchantName", "#merchantNameInput"],
    ["productName", "#productNameInput"],
    ["amount", "#amountInput"],
    ["billingType", "#billingTypeInput"],
    ["period", "#periodInput"],
  ];
  assignments.forEach(([param, selector]) => {
    const value = params.get(param);
    const element = document.querySelector(selector);
    if (value && element) element.value = value;
  });
}

function renderQr(data) {
  const checkoutUrl = buildCheckoutUrl(data);
  const checkoutHost = new URL(checkoutUrl).hostname;
  const localQrWarning = ["localhost", "127.0.0.1", "::1"].includes(checkoutHost)
    ? `<div class="notice">スマホでQRを読む場合、localhostは開けません。公開URLまたは同じWi-Fiから開ける端末用URLで加盟店ページを開いてQRを生成してください。</div>`
    : "";
  const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(checkoutUrl)}`;

  qrResult.hidden = false;
  qrResult.innerHTML = `
    <div class="qr-preview">
      <img src="${qrImage}" alt="決済用QRコード">
      <div class="qr-detail">
        <h2>${escapeHtml(data.merchantName)}</h2>
        <div class="summary">
          <div class="summary-row"><span>商品名</span><strong>${escapeHtml(data.productName)}</strong></div>
          <div class="summary-row"><span>金額</span><strong>${yen.format(data.amount)}</strong></div>
          <div class="summary-row"><span>決済タイプ</span><strong>${data.billingType === "subscription" ? "サブスク" : "一回払い"}</strong></div>
          ${
            data.billingType === "subscription"
              ? `<div class="summary-row"><span>周期</span><strong>${periodLabel(data.period)}</strong></div>`
              : ""
          }
        </div>
        <form class="open-checkout-form" action="../consumer/" method="get">
          <input type="hidden" name="merchantName" value="${escapeHtml(data.merchantName)}">
          <input type="hidden" name="productName" value="${escapeHtml(data.productName)}">
          <input type="hidden" name="amount" value="${escapeHtml(data.amount)}">
          <input type="hidden" name="billingType" value="${escapeHtml(data.billingType)}">
          ${data.billingType === "subscription" ? `<input type="hidden" name="period" value="${escapeHtml(data.period)}">` : ""}
          <button class="checkout-link link-button" type="submit">消費者ページを開く</button>
        </form>
        ${localQrWarning}
      </div>
    </div>
    <textarea class="qr-url" readonly>${checkoutUrl}</textarea>
  `;
}

async function loadMerchantHistory() {
  try {
    const response = await fetch(apiUrl("/api/merchant/orders"), {
      credentials: String(portalConfig.apiBaseUrl || "").trim() ? "include" : "same-origin",
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("static-mode");
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "履歴取得に失敗しました。");
    merchantOrders = payload;
    renderMerchantFilter();
    renderMerchantHistoryList();
  } catch (error) {
    merchantOrders = JSON.parse(localStorage.getItem("komojutest_orders") || "[]").sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    renderMerchantFilter();
    const staticNotice = `<div class="notice">静的デモモードです。実決済履歴にはNodeサーバーが必要です。</div>`;
    const items = filteredMerchantOrders();
    merchantHistory.innerHTML = items.length
      ? `${staticNotice}${items.map(historyItem).join("")}`
      : `<p class="product-name">この店舗の履歴はまだありません。</p>`;
  }
}

function renderMerchantFilter() {
  const selected = merchantFilter.value;
  const names = [...new Set(merchantOrders.map((order) => order.merchantName).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ja")
  );
  merchantFilter.innerHTML = `
    <option value="">全店舗</option>
    ${names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
  `;
  merchantFilter.value = names.includes(selected) ? selected : "";
}

function filteredMerchantOrders() {
  const selected = merchantFilter.value;
  return selected ? merchantOrders.filter((order) => order.merchantName === selected) : merchantOrders;
}

function renderMerchantHistoryList() {
  const items = filteredMerchantOrders();
  merchantHistory.innerHTML = items.length
    ? items.map(historyItem).join("")
    : `<p class="product-name">該当する履歴はまだありません。</p>`;
}

function historyItem(order) {
  const isSubscription = order.billingType === "subscription";
  return `
    <article class="history-item">
      <div class="history-row"><span>決済番号</span><strong>${escapeHtml(order.id || "-")}</strong></div>
      <div class="history-row"><span>店舗名</span><strong>${escapeHtml(order.merchantName || "-")}</strong></div>
      <div class="history-row"><span>商品名</span><strong>${escapeHtml(order.productName || "-")}</strong></div>
      <div class="history-row"><span>決済タイプ</span><strong>${isSubscription ? "サブスク" : "一回払い"}</strong></div>
      <div class="history-row"><span>決済ステータス</span><strong><span class="status-label ${paymentStatusClass(order)}">${paymentStatusLabel(order)}</span></strong></div>
      <div class="history-row"><span>金額</span><strong>${yen.format(order.amount)}</strong></div>
      <div class="history-row"><span>決済時間</span><strong>${dateTime.format(new Date(order.createdAt))}</strong></div>
      <div class="history-row"><span>利用カード</span><strong>${escapeHtml(cardInfoLabel(order.cardInfo))}</strong></div>
      <div class="history-row"><span>Customer ID</span><strong>${escapeHtml(order.customerId || "-")}</strong></div>
      <div class="history-row"><span>メールアドレス</span><strong>${escapeHtml(order.customerEmail || order.userEmail || "-")}</strong></div>
    </article>
  `;
}

function cardInfoLabel(cardInfo) {
  return cardInfo?.label || "-";
}

function paymentStatusLabel(order) {
  const status = paymentStatusKey(order);
  return (
    {
      authorized: "承認済み",
      captured: "決済完了",
      completed: "完了",
      active: "有効",
      draft: "作成中",
      expired: "期限切れ",
      failed: "失敗",
      pending: "処理中",
      requires_3ds: "3Dセキュア認証待ち",
      refunded: "返金済み",
    }[status] || escapeHtml(status || "-")
  );
}

function paymentStatusKey(order) {
  return order.billingType === "subscription" ? order.subscriptionStatus || order.status : order.paymentStatus || order.status;
}

function paymentStatusClass(order) {
  const status = paymentStatusKey(order);
  if (["captured", "completed", "active", "authorized"].includes(status)) return "status-success";
  if (["pending", "draft"].includes(status)) return "status-pending";
  if (["requires_3ds"].includes(status)) return "status-warning";
  if (["refunded"].includes(status)) return "status-refunded";
  if (["failed", "expired"].includes(status)) return "status-danger";
  return "status-muted";
}

function periodLabel(period) {
  return { weekly: "毎週", monthly: "毎月", yearly: "毎年" }[period] || "-";
}

function formatOptionalDate(value) {
  if (!value) return "-";
  return dateTime.format(new Date(value));
}

qrForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = readForm();
  if (!data.merchantName || !data.productName || !Number.isInteger(data.amount) || data.amount < 1) {
    qrResult.hidden = false;
    qrResult.innerHTML = `<div class="error">加盟店名、商品名、1円以上の金額を入力してください。</div>`;
    return;
  }
  renderQr(data);
  loadMerchantHistory();
});

billingTypeInput.addEventListener("change", syncPeriodField);
refreshMerchantHistory.addEventListener("click", loadMerchantHistory);
merchantFilter.addEventListener("change", renderMerchantHistoryList);
applyQueryDefaults();
syncPeriodField();
renderQr(readForm());
loadMerchantHistory();
