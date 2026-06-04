const state = {
  config: null,
  user: null,
  prefill: {},
  draft: null,
  busy: false,
  staticMode: false,
  savedPaymentMethod: null,
  savedPaymentMethods: [],
  historyMessage: "",
};

const app = document.querySelector("#app");
const accountPanel = document.querySelector("#accountPanel");
const historyList = document.querySelector("#historyList");
const refreshHistory = document.querySelector("#refreshHistory");
const portalConfig = window.KOMOJU_PORTAL_CONFIG || {};

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
        .map(
          ([label, key], index) => `
            ${index > 0 ? `<span class="step-arrow" aria-hidden="true">→</span>` : ""}
            <div class="step ${key === active ? "is-active" : ""}">${label}</div>
          `
        )
        .join("")}
    </div>
  `;
}

async function api(path, options = {}) {
  if (!hasApiServer() && isServerOnlyPath(path, options)) {
    throw new Error("決済APIサーバーが未設定です。加盟店にお問い合わせください。");
  }

  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      credentials: hasApiServer() ? "include" : "same-origin",
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

function hasApiServer() {
  return Boolean(String(portalConfig.apiBaseUrl || "").trim()) || !isPublishedStaticHost();
}

function apiUrl(path) {
  const baseUrl = String(portalConfig.apiBaseUrl || "").trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${path}` : path;
}

function isPublishedStaticHost() {
  return location.hostname === "portal.cfsjp.com" || location.hostname.endsWith(".github.io");
}

function isServerOnlyPath(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  return (
    (/^\/api\/orders\/[^/]+\/session$/.test(path) && method === "POST") ||
    (/^\/api\/orders\/[^/]+\/customer-payment$/.test(path) && method === "POST") ||
    (/^\/api\/orders\/[^/]+\/secure-token-status$/.test(path) && method === "POST") ||
    (/^\/api\/orders\/[^/]+\/refund$/.test(path) && method === "POST")
  );
}

function staticApi(path, options = {}) {
  state.staticMode = true;
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const localUserKey = "komojutest_user";
  const localOrdersKey = "komojutest_orders";
  const localCustomerKey = "komojutest_customer";
  const user = JSON.parse(localStorage.getItem(localUserKey) || "null");
  const orders = JSON.parse(localStorage.getItem(localOrdersKey) || "[]");
  const savedCustomer = JSON.parse(localStorage.getItem(localCustomerKey) || "null");

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
      komojuReady: hasApiServer(),
    };
  }

  if (path === "/api/me") {
    const savedPaymentMethod = user && savedCustomer?.email === user.email ? { available: true, label: "保存済みカード" } : null;
    return {
      user,
      savedPaymentMethod,
      savedPaymentMethods: savedPaymentMethod ? [savedPaymentMethod] : [],
    };
  }

  if (path === "/api/login" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("メールアドレスを正しく入力してください。");
    }
    const nextUser = { email };
    localStorage.setItem(localUserKey, JSON.stringify(nextUser));
    const savedPaymentMethod = savedCustomer?.email === email ? { available: true, label: "保存済みカード" } : null;
    return {
      user: nextUser,
      savedPaymentMethod,
      savedPaymentMethods: savedPaymentMethod ? [savedPaymentMethod] : [],
    };
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
      selectedCustomerId: body.selectedCustomerId || null,
      savePaymentMethod: body.billingType === "subscription" || Boolean(body.savePaymentMethod),
      usedSavedPaymentMethod: false,
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
    throw new Error("決済APIサーバーが未設定です。加盟店にお問い合わせください。");
  }

  if (/^\/api\/orders\/[^/]+\/customer-payment$/.test(path) && method === "POST") {
    const orderId = path.split("/")[3];
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error("注文が見つかりません。");
    if (!savedCustomer || savedCustomer.email !== user.email) {
      throw new Error("保存済み決済手段がありません。");
    }
    Object.assign(order, {
      status: "completed",
      paymentStatus: "captured",
      customerId: savedCustomer.customerId,
      usedSavedPaymentMethod: true,
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem(localOrdersKey, JSON.stringify(orders));
    return { order, requires3ds: false, authenticationUrl: null };
  }

  if (/^\/api\/orders\/[^/]+\/secure-token-status$/.test(path) && method === "POST") {
    const orderId = path.split("/")[3];
    return orders.find((order) => order.id === orderId) || null;
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
      savePaymentMethod: false,
      selectedCustomerId:
        form.get("paymentType") === "credit_card"
          ? selectedSavedPaymentMethod()?.customerId || null
          : null,
      useSavedPaymentMethod:
        form.get("paymentType") === "credit_card" && savedPaymentMethods().length > 0,
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
      state.savedPaymentMethod = result.savedPaymentMethod;
      state.savedPaymentMethods = result.savedPaymentMethods || [];
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
  state.savedPaymentMethod = null;
  state.savedPaymentMethods = [];
  state.historyMessage = "";
  renderLogin();
}

function renderConfirm(message = "") {
  if (!state.draft) {
    renderInput();
    return;
  }
  const methods = savedPaymentMethods();
  const hasSavedMethods = methods.length > 0 && state.draft.paymentType === "credit_card";
  const canUseSavedPayment = hasSavedMethods && state.draft.useSavedPaymentMethod !== false;
  const canDirectSavedPayment = canUseSavedPayment && state.draft.billingType === "one_time";
  const selectedMethod = canUseSavedPayment ? selectedSavedPaymentMethod(state.draft.selectedCustomerId) : null;
  const savedPaymentSummary = savedPaymentMethodSummary(selectedMethod);
  app.innerHTML = `
    ${stepper("confirm")}
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
      ${
        hasSavedMethods
          ? `<div class="summary-row"><span>カード選択</span><strong>${canUseSavedPayment ? escapeHtml(savedPaymentSummary) : "別カードを使用"}</strong></div>`
          : state.draft.billingType === "one_time" && state.draft.savePaymentMethod
            ? `<div class="summary-row"><span>カード保存</span><strong>保存する</strong></div>`
            : ""
      }
    </div>
    ${
      state.draft.paymentType === "credit_card"
        ? `<div class="confirm-payment-options">
            ${
              hasSavedMethods
                ? `<div class="field">
                    <label for="confirmPaymentChoice">利用するカード</label>
                    <select id="confirmPaymentChoice" name="confirmPaymentChoice">
                      ${methods
                        .map((method) => {
                          const methodId = method.customerId || "";
                          return `<option value="saved:${escapeHtml(methodId)}" ${
                            canUseSavedPayment && selectedMethod?.customerId === methodId ? "selected" : ""
                          }>${escapeHtml(savedPaymentMethodSummary(method))}</option>`;
                        })
                        .join("")}
                      <option value="new_card" ${canUseSavedPayment ? "" : "selected"}>別カードを使う（KOMOJU画面）</option>
                    </select>
                  </div>`
                : ""
            }
            ${
              state.draft.billingType === "one_time"
                ? `<div id="confirmSaveMethodField" class="field confirm-save-method-field" ${canUseSavedPayment ? "hidden" : ""}>
                    <label class="checkbox-label">
                      <input id="confirmSavePaymentMethod" name="confirmSavePaymentMethod" type="checkbox" ${state.draft.savePaymentMethod ? "checked" : ""}>
                      このカードを次回以降の決済用に保存する
                    </label>
                  </div>`
                : ""
            }
          </div>`
        : ""
    }
    <div class="actions">
      <button id="backButton" class="button secondary" type="button">戻る</button>
      ${
        canDirectSavedPayment
          ? `<button id="savedPaymentButton" class="button" type="button" ${state.busy || !state.config.komojuReady ? "disabled" : ""}>保存済み決済手段で支払う</button>`
          : `<button id="checkoutButton" class="button" type="button" ${state.busy || !state.config.komojuReady ? "disabled" : ""}>${state.config.komojuReady ? "KOMOJU画面へ進む" : "決済ページを準備中"}</button>`
      }
    </div>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
  `;

  document.querySelector("#backButton").addEventListener("click", () => renderInput());
  document.querySelector("#confirmPaymentChoice")?.addEventListener("change", (event) => {
    const value = event.currentTarget.value;
    if (value === "new_card") {
      state.draft.useSavedPaymentMethod = false;
      state.draft.selectedCustomerId = null;
      state.draft.savePaymentMethod = true;
    } else {
      state.draft.useSavedPaymentMethod = true;
      state.draft.selectedCustomerId = value.replace(/^saved:/, "");
      state.draft.savePaymentMethod = false;
    }
    renderConfirm(message);
  });
  document.querySelector("#confirmSavePaymentMethod")?.addEventListener("change", (event) => {
    state.draft.savePaymentMethod = event.currentTarget.checked;
  });
  document.querySelector("#savedPaymentButton")?.addEventListener("click", startSavedCustomerPayment);
  document.querySelector("#checkoutButton")?.addEventListener("click", startCheckout);
}

async function createDraftOrder() {
  return api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: state.draft.amount,
      paymentType: state.draft.paymentType,
      billingType: state.draft.billingType,
      period: state.draft.period,
      email: state.draft.email,
      merchantName: state.draft.merchantName,
      productName: state.draft.productName,
      savePaymentMethod: state.draft.useSavedPaymentMethod ? false : state.draft.savePaymentMethod,
      selectedCustomerId: state.draft.useSavedPaymentMethod ? state.draft.selectedCustomerId : null,
    }),
  });
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
    const order = await createDraftOrder();
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

async function startSavedCustomerPayment() {
  if (!state.user) {
    renderLogin();
    return;
  }

  if (!state.config.komojuReady) {
    renderConfirm("決済ページは現在準備中です。管理者側の設定完了後にご利用いただけます。");
    return;
  }

  const confirmed = window.confirm(
    `${yen.format(state.draft.amount)}を${savedPaymentMethodSummary(selectedSavedPaymentMethod(state.draft.selectedCustomerId))}で支払います。必要に応じて3Dセキュア認証へ進みます。よろしいですか？`
  );
  if (!confirmed) return;

  state.busy = true;
  renderConfirm();
  try {
    const order = await createDraftOrder();
    const result = await api(`/api/orders/${encodeURIComponent(order.id)}/customer-payment`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (result.requires3ds && result.authenticationUrl) {
      window.location.assign(result.authenticationUrl);
      return;
    }

    const paidOrder = result.order || result;
    state.busy = false;
    state.draft = null;
    renderComplete(paidOrder);
    loadHistory();
  } catch (error) {
    state.busy = false;
    renderConfirm(error.message);
    loadHistory();
  }
}

async function renderReturn() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order_id");
  const secureTokenId = params.get("secure_token_id");
  let order = null;
  let message = "";

  if (!state.user) {
    renderLogin("決済結果を確認するにはログインしてください。");
    return;
  }

  if (orderId) {
    try {
      order = secureTokenId
        ? await api(`/api/orders/${encodeURIComponent(orderId)}/secure-token-status`, {
            method: "POST",
            body: JSON.stringify({ secureTokenId }),
          })
        : await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
            method: "POST",
            body: JSON.stringify({}),
          });
    } catch (error) {
      message = error.message;
    }
  }

  renderComplete(order, message, orderId);
  loadHistory();
}

function renderComplete(order, message = "", fallbackOrderId = "") {
  if (order?.customerId) {
    const method = {
      available: true,
      customerId: order.customerId,
      label: order.cardInfo?.label || "保存済みカード",
      ...(order.cardInfo || {}),
    };
    state.savedPaymentMethod = method;
    const otherMethods = state.savedPaymentMethods.filter((candidate) => candidate.customerId !== order.customerId);
    state.savedPaymentMethods = [method, ...otherMethods];
  }
  const savedPaymentSummary = savedPaymentMethodSummary(selectedSavedPaymentMethod(order?.customerId));
  app.innerHTML = `
    ${stepper("complete")}
    <div class="summary">
      <div class="summary-row"><span>注文番号</span><strong>${escapeHtml(order?.id || fallbackOrderId || "-")}</strong></div>
      <div class="summary-row"><span>加盟店名</span><strong>${escapeHtml(order?.merchantName || "-")}</strong></div>
      <div class="summary-row"><span>商品名</span><strong>${escapeHtml(order?.productName || "-")}</strong></div>
      <div class="summary-row"><span>決済タイプ</span><strong>${order?.billingType === "subscription" ? "繰り返し決済" : "一回払い"}</strong></div>
      <div class="summary-row"><span>セッション状態</span><strong><span class="badge ${escapeHtml(order?.status)}">${escapeHtml(order?.status || "-")}</span></strong></div>
      <div class="summary-row"><span>決済状態</span><strong><span class="badge ${escapeHtml(order?.paymentStatus)}">${escapeHtml(order?.paymentStatus || "-")}</span></strong></div>
      ${
        order?.billingType === "subscription"
          ? `<div class="summary-row"><span>サブスク状態</span><strong><span class="badge ${escapeHtml(order?.subscriptionStatus)}">${escapeHtml(order?.subscriptionStatus || "-")}</span></strong></div>
             <div class="summary-row"><span>次回課金</span><strong>${formatOptionalDate(order?.nextCaptureAt)}</strong></div>`
          : ""
      }
      ${
        order?.usedSavedPaymentMethod
          ? `<div class="summary-row"><span>利用した決済手段</span><strong>${escapeHtml(savedPaymentSummary)}</strong></div>`
        : order?.customerId
            ? `<div class="summary-row"><span>利用カード</span><strong>${escapeHtml(cardInfoLabel(order.cardInfo))}</strong></div>`
            : ""
      }
      ${
        order?.status === "requires_3ds"
          ? `<div class="summary-row"><span>3Dセキュア</span><strong>認証待ち</strong></div>`
          : ""
      }
      <div class="summary-row"><span>金額</span><strong>${order ? yen.format(order.amount) : "-"}</strong></div>
    </div>
    ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
  `;
}

function savedPaymentMethods() {
  const methods = Array.isArray(state.savedPaymentMethods) ? state.savedPaymentMethods : [];
  const fallback = state.savedPaymentMethod ? [state.savedPaymentMethod] : [];
  return (methods.length ? methods : fallback).filter((method) => method?.available && hasDisplayableCardInfo(method));
}

function selectedSavedPaymentMethod(customerId = state.draft?.selectedCustomerId) {
  const methods = savedPaymentMethods();
  return methods.find((method) => method.customerId && method.customerId === customerId) || methods[0] || null;
}

function savedPaymentMethodSummary(method = state.savedPaymentMethod) {
  if (!method) return "保存済みカード";
  if (method.label && method.label !== "保存済みカード") return method.label;
  const brand = String(method.brand || "CARD").toUpperCase();
  const last4 = method.lastFourDigits ? ` **** ${method.lastFourDigits}` : "";
  const expiry = method.expiryMonth && method.expiryYear ? `（${String(method.expiryMonth).padStart(2, "0")}/${method.expiryYear}）` : "";
  if (last4 || expiry) return `${brand}${last4}${expiry}`;
  return "カード情報未取得";
}

function hasDisplayableCardInfo(method) {
  return Boolean(method?.lastFourDigits || (method?.label && method.label !== "保存済みカード"));
}

function historyItem(order) {
  const isSubscription = order.billingType === "subscription";
  return `
    <article class="history-item">
      <div class="history-row"><span>決済番号</span><strong>${escapeHtml(order.id || "-")}</strong></div>
      <div class="history-row"><span>加盟店名</span><strong>${escapeHtml(order.merchantName || "-")}</strong></div>
      <div class="history-row"><span>決済時間</span><strong>${dateTime.format(new Date(order.createdAt))}</strong></div>
      <div class="history-row"><span>金額</span><strong>${yen.format(order.amount)}</strong></div>
      <div class="history-row"><span>決済タイプ</span><strong>${isSubscription ? "サブスク" : "一回払い"}</strong></div>
      <div class="history-row"><span>決済ステータス</span><strong><span class="status-label ${paymentStatusClass(order)}">${paymentStatusLabel(order)}</span></strong></div>
      <div class="history-row"><span>利用カード</span><strong>${escapeHtml(cardInfoLabel(order.cardInfo))}</strong></div>
      <div class="history-row"><span>メールアドレス</span><strong>${escapeHtml(order.customerEmail || order.email || "-")}</strong></div>
    </article>
  `;
}

function cardInfoLabel(cardInfo) {
  return cardInfo?.label || "カード情報未取得";
}

function paymentStatusLabel(order) {
  const status = paymentStatusKey(order);
  return (
    {
      active: "有効",
      authorized: "承認済み",
      captured: "決済完了",
      completed: "完了",
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
  } catch (error) {
    historyList.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function init() {
  state.config = await api("/api/config");
  const me = await api("/api/me");
  state.user = me.user;
  state.savedPaymentMethod = me.savedPaymentMethod;
  state.savedPaymentMethods = me.savedPaymentMethods || [];
  state.prefill = readPrefill();
  document.querySelector("#merchantName").textContent = state.prefill.merchantName || state.config.merchantName;
  document.querySelector("#productName").textContent = state.prefill.productName || state.config.productName;
  renderAccount();
  refreshHistory.addEventListener("click", loadHistory);

  if (window.location.pathname === "/return" || window.location.pathname.endsWith("/return")) {
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
