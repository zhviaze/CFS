const state = {
  config: null,
  user: null,
  prefill: {},
  draft: null,
  busy: false,
  staticMode: false,
  refundingOrderId: null,
  historyMessage: "",
};

const app = document.querySelector("#app");
const accountPanel = document.querySelector("#accountPanel");
const historyList = document.querySelector("#historyList");
const refreshHistory = document.querySelector("#refreshHistory");

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

function stepper(active) {
  const steps = [
    ["入力", "input"],
    ["確認", "confirm"],
    ["完了", "complete"],
  ];
  return `
    <div class="stepper">
      ${steps
        .map(([label, key]) => `<div class="step ${key === active ? "is-active" : ""}">${label}</div>`)
        .join("")}
    </div>
  `;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    return staticApi(path, options);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return staticApi(path, options);
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "通信に失敗しました。");
  return payload;
}

function staticApi(path, options = {}) {
  state.staticMode = true;
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const localUserKey = "komojutest_user";
  const localOrdersKey = "komojutest_orders";
  const user = JSON.parse(localStorage.getItem(localUserKey) || "null");
  const orders = JSON.parse(localStorage.getItem(localOrdersKey) || "[]");

  if (path === "/api/config") {
    return {
      merchantName: "CFS株式会社",
      productName: "オンライン決済",
      currency: "JPY",
      paymentTypes: [{ value: "credit_card", label: "Card決済" }],
      billingTypes: [
        { value: "one_time", label: "一回払い" },
        { value: "subscription", label: "繰り返し決済" },
      ],
      periods: [
        { value: "weekly", label: "毎週" },
        { value: "monthly", label: "毎月" },
        { value: "yearly", label: "毎年" },
      ],
      komojuReady: false,
    };
  }

  if (path === "/api/me") return { user };

  if (path === "/api/login" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("メールアドレスを正しく入力してください。");
    }
    const nextUser = { email };
    localStorage.setItem(localUserKey, JSON.stringify(nextUser));
    return { user: nextUser };
  }

  if (path === "/api/logout" && method === "POST") {
    localStorage.removeItem(localUserKey);
    return { ok: true };
  }

  if (path === "/api/orders" && method === "GET") {
    if (!user) throw new Error("ログインしてください。");
    return orders
      .filter((order) => order.userEmail === user.email)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  if (path === "/api/orders" && method === "POST") {
    if (!user) throw new Error("ログインしてください。");
    const now = new Date().toISOString();
    const order = {
      id: `static_${Date.now()}`,
      merchantName: body.merchantName || "CFS株式会社",
      productName: body.productName || "オンライン決済",
      amount: Number(body.amount),
      currency: "JPY",
      userEmail: user.email,
      billingType: body.billingType || "one_time",
      period: body.billingType === "subscription" ? body.period || "monthly" : null,
      email: body.billingType === "subscription" ? user.email : null,
      paymentType: body.paymentType || "credit_card",
      status: "draft",
      paymentStatus: null,
      paymentId: null,
      customerId: null,
      subscriptionId: null,
      subscriptionStatus: null,
      nextCaptureAt: null,
      refundedAt: null,
      refundAmount: null,
      refundStatus: null,
      createdAt: now,
      updatedAt: now,
    };
    orders.push(order);
    localStorage.setItem(localOrdersKey, JSON.stringify(orders));
    return order;
  }

  if (/^\/api\/orders\/[^/]+\/session$/.test(path) && method === "POST") {
    throw new Error("GitHub PagesではKOMOJU APIを直接呼べません。実決済にはNodeサーバーを起動してください。");
  }

  if (/^\/api\/orders\/[^/]+\/status$/.test(path) && method === "POST") {
    const orderId = path.split("/")[3];
    return orders.find((order) => order.id === orderId) || null;
  }

  if (/^\/api\/orders\/[^/]+\/refund$/.test(path) && method === "POST") {
    throw new Error("GitHub Pagesでは返金APIを直接呼べません。");
  }

  throw new Error("APIサーバーに接続できません。ローカルでは node server.js を起動してください。");
}

function renderInput(message = "") {
  if (!state.user) {
    renderLogin();
    return;
  }

  const amount = state.draft?.amount || state.prefill.amount || "";
  const paymentType = state.draft?.paymentType || "credit_card";
  const billingType = state.draft?.billingType || state.prefill.billingType || "one_time";
  const period = state.draft?.period || state.prefill.period || "monthly";
  const email = state.user.email;
  const merchantName = state.draft?.merchantName || state.prefill.merchantName || state.config.merchantName;
  const productName = state.draft?.productName || state.prefill.productName || state.config.productName;
  app.innerHTML = `
    ${stepper("input")}
    ${state.staticMode ? `<div class="notice">静的デモモードです。ログインとQR確認はできますが、実決済にはNodeサーバーが必要です。</div>` : ""}
    <form id="paymentForm">
      <div class="form-grid">
        <div class="field">
          <label for="billingType">決済タイプ</label>
          <select id="billingType" name="billingType" ${state.prefill.billingType ? "disabled" : ""}>
            ${state.config.billingTypes
              .map(
                (type) =>
                  `<option value="${escapeHtml(type.value)}" ${
                    type.value === billingType ? "selected" : ""
                  }>${escapeHtml(type.label)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="amount">金額</label>
          <input id="amount" name="amount" type="number" inputmode="numeric" min="1" step="1" value="${escapeHtml(amount)}" placeholder="10000" ${state.prefill.amount ? "readonly" : ""} required>
        </div>
        <div class="field">
          <label for="paymentType">決済手段</label>
          <select id="paymentType" name="paymentType">
            ${state.config.paymentTypes
              .map(
                (type) =>
                  `<option value="${escapeHtml(type.value)}" ${
                    type.value === paymentType ? "selected" : ""
                  }>${escapeHtml(type.label)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="field subscription-field" ${billingType === "subscription" ? "" : "hidden"}>
          <label for="period">課金周期</label>
          <select id="period" name="period" ${state.prefill.period ? "disabled" : ""}>
            ${state.config.periods
              .map(
                (item) =>
                  `<option value="${escapeHtml(item.value)}" ${
                    item.value === period ? "selected" : ""
                  }>${escapeHtml(item.label)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="field subscription-field" ${billingType === "subscription" ? "" : "hidden"}>
          <label for="email">メールアドレス</label>
          <input id="email" name="email" type="email" value="${escapeHtml(email)}" readonly>
        </div>
      </div>
      <div class="actions">
        <button class="button" type="submit">確認へ進む</button>
      </div>
      ${!state.config.komojuReady ? `<div class="notice">決済ページは現在準備中です。しばらくしてから再度お試しください。</div>` : ""}
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
    </form>
  `;

  document.querySelector("#paymentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.draft = {
      productName,
      merchantName,
      amount: Number(form.get("amount")),
      currency: state.config.currency,
      paymentType: form.get("paymentType"),
      billingType: state.prefill.billingType || form.get("billingType"),
      period: state.prefill.period || form.get("period"),
      email,
    };
    if (!Number.isInteger(state.draft.amount) || state.draft.amount < 1) {
      renderInput("金額は1円以上の整数で入力してください。");
      return;
    }
    if (state.draft.billingType === "subscription" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.draft.email)) {
      renderInput("繰り返し決済ではメールアドレスを入力してください。");
      return;
    }
    renderConfirm();
  });

  const syncSubscriptionFields = () => {
    const isSubscription = document.querySelector("#billingType").value === "subscription";
    document.querySelectorAll(".subscription-field").forEach((field) => {
      field.hidden = !isSubscription;
      field.style.display = isSubscription ? "" : "none";
    });
    document.querySelector("#email").required = isSubscription;
  };
  document.querySelector("#billingType").addEventListener("change", syncSubscriptionFields);
  syncSubscriptionFields();
}

function renderAccount() {
  accountPanel.innerHTML = state.user
    ? `
        <div class="account-bar">
          <span>ログイン中: <strong>${escapeHtml(state.user.email)}</strong></span>
          <button id="logoutButton" class="text-button" type="button">ログアウト</button>
        </div>
      `
    : "";

  document.querySelector("#logoutButton")?.addEventListener("click", logout);
}

function renderLogin(message = "") {
  renderAccount();
  app.innerHTML = `
    <div class="login-panel">
      <h2>ログイン</h2>
      <form id="loginForm">
        <div class="field">
          <label for="loginEmail">メールアドレス</label>
          <input id="loginEmail" name="email" type="email" placeholder="customer@example.com" required>
        </div>
        <div class="actions">
          <button class="button" type="submit">ログイン</button>
        </div>
        ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
      </form>
    </div>
  `;
  historyList.innerHTML = `<p class="product-name">ログインすると、ご自身の支払い履歴とサブスクを確認できます。</p>`;
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: String(form.get("email") || "").trim() }),
      });
      state.user = result.user;
      state.draft = null;
      renderAccount();
      renderInput();
      loadHistory();
    } catch (error) {
      renderLogin(error.message);
    }
  });
}

async function logout() {
  await api("/api/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.user = null;
  state.draft = null;
  state.historyMessage = "";
  renderLogin();
}

function renderConfirm(message = "") {
  if (!state.draft) {
    renderInput();
    return;
  }
  app.innerHTML = `
    ${stepper("confirm")}
    ${state.staticMode ? `<div class="notice">静的デモモードです。KOMOJUの決済画面へ進むにはNodeサーバーで開いてください。</div>` : ""}
    <div class="summary">
      <div class="summary-row"><span>加盟店名</span><strong>${escapeHtml(state.draft.merchantName)}</strong></div>
      <div class="summary-row"><span>商品名</span><strong>${escapeHtml(state.draft.productName)}</strong></div>
      <div class="summary-row"><span>決済タイプ</span><strong>${state.draft.billingType === "subscription" ? "繰り返し決済" : "一回払い"}</strong></div>
      <div class="summary-row"><span>金額</span><strong>${yen.format(state.draft.amount)}</strong></div>
      ${
        state.draft.billingType === "subscription"
          ? `<div class="summary-row"><span>課金周期</span><strong>${periodLabel(state.draft.period)}</strong></div>
             <div class="summary-row"><span>メール</span><strong>${escapeHtml(state.draft.email)}</strong></div>`
          : ""
      }
      <div class="summary-row"><span>決済手段</span><strong>Card決済</strong></div>
    </div>
    <div class="actions">
      <button id="backButton" class="button secondary" type="button">戻る</button>
      <button id="checkoutButton" class="button" type="button" ${state.busy || !state.config.komojuReady ? "disabled" : ""}>${state.config.komojuReady ? "確認して決済へ進む" : "決済ページを準備中"}</button>
    </div>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
  `;

  document.querySelector("#backButton").addEventListener("click", () => renderInput());
  document.querySelector("#checkoutButton").addEventListener("click", startCheckout);
}

async function startCheckout() {
  if (!state.user) {
    renderLogin();
    return;
  }

  if (!state.config.komojuReady) {
    renderConfirm("決済ページは現在準備中です。管理者側の設定完了後にご利用いただけます。");
    return;
  }

  state.busy = true;
  renderConfirm();
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: state.draft.amount,
        paymentType: state.draft.paymentType,
        billingType: state.draft.billingType,
        period: state.draft.period,
        email: state.draft.email,
        merchantName: state.draft.merchantName,
        productName: state.draft.productName,
      }),
    });
    const session = await api(`/api/orders/${encodeURIComponent(order.id)}/session`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    window.location.assign(session.sessionUrl);
  } catch (error) {
    state.busy = false;
    renderConfirm(error.message);
    loadHistory();
  }
}

async function refundOrder(orderId) {
  if (!window.confirm("この取引を全額返金します。よろしいですか？")) return;

  state.refundingOrderId = orderId;
  state.historyMessage = "";
  await loadHistory();

  try {
    await api(`/api/orders/${encodeURIComponent(orderId)}/refund`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.historyMessage = "返金処理を実行しました。";
  } catch (error) {
    state.historyMessage = error.message;
  } finally {
    state.refundingOrderId = null;
    await loadHistory();
  }
}

async function renderReturn() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order_id");
  let order = null;
  let message = "";

  if (!state.user) {
    renderLogin("決済結果を確認するにはログインしてください。");
    return;
  }

  if (orderId) {
    try {
      order = await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (error) {
      message = error.message;
    }
  }

  app.innerHTML = `
    ${stepper("complete")}
    <div class="summary">
      <div class="summary-row"><span>注文番号</span><strong>${escapeHtml(order?.id || orderId || "-")}</strong></div>
      <div class="summary-row"><span>決済タイプ</span><strong>${order?.billingType === "subscription" ? "繰り返し決済" : "一回払い"}</strong></div>
      <div class="summary-row"><span>セッション状態</span><strong><span class="badge ${escapeHtml(order?.status)}">${escapeHtml(order?.status || "-")}</span></strong></div>
      <div class="summary-row"><span>決済状態</span><strong><span class="badge ${escapeHtml(order?.paymentStatus)}">${escapeHtml(order?.paymentStatus || "-")}</span></strong></div>
      ${
        order?.billingType === "subscription"
          ? `<div class="summary-row"><span>サブスク状態</span><strong><span class="badge ${escapeHtml(order?.subscriptionStatus)}">${escapeHtml(order?.subscriptionStatus || "-")}</span></strong></div>
             <div class="summary-row"><span>次回課金</span><strong>${formatOptionalDate(order?.nextCaptureAt)}</strong></div>`
          : ""
      }
      <div class="summary-row"><span>金額</span><strong>${order ? yen.format(order.amount) : "-"}</strong></div>
    </div>
    <div class="actions">
      <button id="newPayment" class="button" type="button">新しい決済を作成</button>
    </div>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
  `;
  document.querySelector("#newPayment").addEventListener("click", () => {
    window.history.replaceState({}, "", "/");
    state.draft = null;
    renderInput();
  });
  loadHistory();
}

function historyItem(order) {
  const isSubscription = order.billingType === "subscription";
  const canRefund = !isSubscription && Boolean(order.paymentId) && !order.refundedAt;
  const isRefunding = state.refundingOrderId === order.id;
  return `
    <article class="history-item">
      <div class="history-id">${escapeHtml(order.id)}</div>
      <div class="history-row"><span>タイプ</span><strong>${isSubscription ? "繰り返し" : "一回払い"}</strong></div>
      <div class="history-row"><span>金額</span><strong>${yen.format(order.amount)}</strong></div>
      ${isSubscription ? `<div class="history-row"><span>周期</span><strong>${periodLabel(order.period)}</strong></div>` : ""}
      <div class="history-row"><span>Session</span><strong><span class="badge ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></strong></div>
      ${
        isSubscription
          ? `<div class="history-row"><span>Subscription</span><strong><span class="badge ${escapeHtml(order.subscriptionStatus)}">${escapeHtml(order.subscriptionStatus || "-")}</span></strong></div>
             <div class="history-row"><span>次回課金</span><strong>${formatOptionalDate(order.nextCaptureAt)}</strong></div>`
          : `<div class="history-row"><span>Payment</span><strong><span class="badge ${escapeHtml(order.paymentStatus)}">${escapeHtml(order.paymentStatus || "-")}</span></strong></div>
             <div class="history-row"><span>返金</span><strong>${order.refundedAt ? yen.format(order.refundAmount || order.amount) : "-"}</strong></div>`
      }
      <div class="history-row"><span>作成</span><strong>${dateTime.format(new Date(order.createdAt))}</strong></div>
      <button class="history-refund" type="button" data-refund-order="${escapeHtml(order.id)}" ${canRefund && !isRefunding ? "" : "disabled"}>
        ${isSubscription ? "サブスク返金対象外" : order.refundedAt ? "返金済み" : isRefunding ? "返金処理中" : canRefund ? "返金する" : "返金不可"}
      </button>
    </article>
  `;
}

function periodLabel(period) {
  return state.config?.periods?.find((item) => item.value === period)?.label || "-";
}

function formatOptionalDate(value) {
  if (!value) return "-";
  return dateTime.format(new Date(value));
}

async function loadHistory() {
  if (!state.user) {
    historyList.innerHTML = `<p class="product-name">ログインすると、ご自身の支払い履歴とサブスクを確認できます。</p>`;
    return;
  }

  try {
    const orders = await api("/api/orders");
    historyList.innerHTML = orders.length
      ? `${state.historyMessage ? `<div class="notice">${escapeHtml(state.historyMessage)}</div>` : ""}${orders.map(historyItem).join("")}`
      : `<p class="product-name">まだ履歴がありません。</p>`;
    historyList.querySelectorAll("[data-refund-order]").forEach((button) => {
      button.addEventListener("click", () => refundOrder(button.dataset.refundOrder));
    });
  } catch (error) {
    historyList.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function init() {
  state.config = await api("/api/config");
  const me = await api("/api/me");
  state.user = me.user;
  state.prefill = readPrefill();
  document.querySelector("#merchantName").textContent = state.prefill.merchantName || state.config.merchantName;
  document.querySelector("#productName").textContent = state.prefill.productName || state.config.productName;
  renderAccount();
  refreshHistory.addEventListener("click", loadHistory);

  if (window.location.pathname === "/return") {
    await renderReturn();
  } else {
    renderInput();
  }
  loadHistory();
}

init().catch((error) => {
  app.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  historyList.innerHTML = `<p class="product-name">APIサーバーに接続できる状態で再読み込みしてください。</p>`;
});

function readPrefill() {
  const params = new URLSearchParams(window.location.search);
  const amount = Number(params.get("amount"));
  const billingType = params.get("billingType");
  const period = params.get("period");
  const prefill = {};

  if (params.get("merchantName")) prefill.merchantName = params.get("merchantName");
  if (params.get("productName")) prefill.productName = params.get("productName");
  if (Number.isInteger(amount) && amount > 0) prefill.amount = amount;
  if (["one_time", "subscription"].includes(billingType)) prefill.billingType = billingType;
  if (["weekly", "monthly", "yearly"].includes(period)) prefill.period = period;
  return prefill;
}
