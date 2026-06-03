const qrForm = document.querySelector("#qrForm");
const qrResult = document.querySelector("#qrResult");
const merchantHistory = document.querySelector("#merchantHistory");
const refreshMerchantHistory = document.querySelector("#refreshMerchantHistory");
const billingTypeInput = document.querySelector("#billingTypeInput");
const periodField = document.querySelector(".merchant-period-field");
const consumerBaseUrlInput = document.querySelector("#consumerBaseUrlInput");

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

function normalizeUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return new URL(value, window.location.href).href;
  }
}

function buildCheckoutUrl(data) {
  const params = new URLSearchParams({
    merchantName: data.merchantName,
    productName: data.productName,
    amount: String(data.amount),
    billingType: data.billingType,
  });
  if (data.billingType === "subscription") params.set("period", data.period);
  const baseUrl = new URL(normalizeUrl(data.consumerBaseUrl));
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
    consumerBaseUrl: String(form.get("consumerBaseUrl") || "").trim(),
    amount: Number(form.get("amount")),
    billingType: form.get("billingType"),
    period: form.get("period") || "monthly",
  };
}

function renderQr(data) {
  const checkoutUrl = buildCheckoutUrl(data);
  const checkoutHost = new URL(checkoutUrl).hostname;
  const localQrWarning = ["localhost", "127.0.0.1", "::1"].includes(checkoutHost)
    ? `<div class="notice">スマホでQRを読む場合、localhostは開けません。PCと同じWi-Fiから開けるIPアドレス、または公開URLを「消費者ページURL」に入力してください。</div>`
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
  const data = readForm();
  if (!data.merchantName) {
    merchantHistory.innerHTML = `<div class="error">加盟店名を入力してください。</div>`;
    return;
  }

  try {
    const response = await fetch(`/api/merchant/orders?merchantName=${encodeURIComponent(data.merchantName)}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("static-mode");
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "履歴取得に失敗しました。");
    merchantHistory.innerHTML = payload.length
      ? payload.map(historyItem).join("")
      : `<p class="product-name">この店舗の履歴はまだありません。</p>`;
  } catch (error) {
    const localOrders = JSON.parse(localStorage.getItem("komojutest_orders") || "[]")
      .filter((order) => order.merchantName === data.merchantName)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    merchantHistory.innerHTML = localOrders.length
      ? `<div class="notice">静的デモモードです。実決済履歴にはNodeサーバーが必要です。</div>${localOrders.map(historyItem).join("")}`
      : `<p class="product-name">この店舗の履歴はまだありません。</p>`;
  }
}

function historyItem(order) {
  const isSubscription = order.billingType === "subscription";
  return `
    <article class="history-item">
      <div class="history-id">${escapeHtml(order.id)}</div>
      <div class="history-row"><span>購入者</span><strong>${escapeHtml(order.userEmail || "-")}</strong></div>
      <div class="history-row"><span>タイプ</span><strong>${isSubscription ? "サブスク" : "一回払い"}</strong></div>
      <div class="history-row"><span>金額</span><strong>${yen.format(order.amount)}</strong></div>
      ${isSubscription ? `<div class="history-row"><span>周期</span><strong>${periodLabel(order.period)}</strong></div>` : ""}
      <div class="history-row"><span>Session</span><strong><span class="badge ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></strong></div>
      ${
        isSubscription
          ? `<div class="history-row"><span>Subscription</span><strong><span class="badge ${escapeHtml(order.subscriptionStatus)}">${escapeHtml(order.subscriptionStatus || "-")}</span></strong></div>
             <div class="history-row"><span>次回課金</span><strong>${formatOptionalDate(order.nextCaptureAt)}</strong></div>`
          : `<div class="history-row"><span>Payment</span><strong><span class="badge ${escapeHtml(order.paymentStatus)}">${escapeHtml(order.paymentStatus || "-")}</span></strong></div>`
      }
      <div class="history-row"><span>作成</span><strong>${dateTime.format(new Date(order.createdAt))}</strong></div>
    </article>
  `;
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
    qrResult.innerHTML = `<div class="error">加盟店名、商品名、消費者ページURL、1円以上の金額を入力してください。</div>`;
    return;
  }
  renderQr(data);
  loadMerchantHistory();
});

billingTypeInput.addEventListener("change", syncPeriodField);
refreshMerchantHistory.addEventListener("click", loadMerchantHistory);
syncPeriodField();
consumerBaseUrlInput.value = new URL("../consumer/", window.location.href).href;
renderQr(readForm());
loadMerchantHistory();
