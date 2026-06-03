const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const KOMOJU_SECRET_KEY = process.env.KOMOJU_SECRET_KEY || "";
const KOMOJU_API_VERSION = process.env.KOMOJU_API_VERSION || "2025-01-28";
const MERCHANT_NAME = process.env.MERCHANT_NAME || "CFS株式会社";
const PRODUCT_NAME = process.env.PRODUCT_NAME || "オンライン決済";
const CURRENCY = process.env.CURRENCY || "JPY";

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const PUBLIC_DIR = __dirname;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]\n");
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "{}\n");
}

function readOrders() {
  ensureStore();
  return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
}

function writeOrders(orders) {
  ensureStore();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2) + "\n");
}

function readSessions() {
  ensureStore();
  return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
}

function writeSessions(sessions) {
  ensureStore();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2) + "\n");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function sessionCookie(sessionId, maxAge) {
  return `checkout_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function currentUser(req) {
  const sessionId = parseCookies(req).checkout_session;
  if (!sessionId) return null;
  const session = readSessions()[sessionId];
  if (!session) return null;
  return { email: session.email };
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "ログインしてください。" });
    return null;
  }
  return user;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function orderOwnerEmail(order) {
  return (
    order.userEmail ||
    order.email ||
    order.rawSession?.payment?.payment_details?.email ||
    order.rawRefund?.payment_details?.email ||
    null
  );
}

function userOwnsOrder(order, user) {
  return orderOwnerEmail(order) === user.email;
}

function findUserOrder(orderId, user) {
  return readOrders().find((candidate) => candidate.id === orderId && userOwnsOrder(candidate, user));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function absoluteBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function authHeader() {
  return `Basic ${Buffer.from(`${KOMOJU_SECRET_KEY}:`).toString("base64")}`;
}

async function komoju(pathname, options = {}) {
  if (!KOMOJU_SECRET_KEY) {
    throw Object.assign(new Error("KOMOJU_SECRET_KEY is not configured."), {
      status: 503,
    });
  }

  const response = await fetch(`https://komoju.com/api/v1${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: authHeader(),
      "X-KOMOJU-API-VERSION": KOMOJU_API_VERSION,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.message === "string"
          ? payload.message
          : JSON.stringify(payload.error || payload.message || payload);
    const error = new Error(message || "KOMOJU API error.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function publicOrder(order) {
  return {
    id: order.id,
    merchantName: order.merchantName,
    productName: order.productName,
    amount: order.amount,
    currency: order.currency,
    billingType: order.billingType || "one_time",
    period: order.period || null,
    email: order.email || null,
    paymentType: order.paymentType,
    status: order.status,
    sessionId: order.sessionId,
    paymentStatus: order.paymentStatus,
    paymentId: order.paymentId,
    customerId: order.customerId || null,
    subscriptionId: order.subscriptionId || null,
    subscriptionStatus: order.subscriptionStatus || null,
    nextCaptureAt: order.nextCaptureAt || null,
    refundedAt: order.refundedAt || null,
    refundAmount: order.refundAmount || null,
    refundStatus: order.refundStatus || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function merchantOrder(order) {
  const publicData = publicOrder(order);
  return {
    ...publicData,
    userEmail: orderOwnerEmail(order),
  };
}

function updateOrder(id, changes) {
  const orders = readOrders();
  const index = orders.findIndex((order) => order.id === id);
  if (index === -1) return null;
  orders[index] = { ...orders[index], ...changes, updatedAt: new Date().toISOString() };
  writeOrders(orders);
  return orders[index];
}

async function createSession(req, order) {
  const payload =
    order.billingType === "subscription"
      ? {
          mode: "customer",
          currency: order.currency,
          return_url: `${absoluteBaseUrl(req)}/consumer/return?order_id=${encodeURIComponent(order.id)}`,
          payment_types: [order.paymentType],
          default_locale: "ja",
          email: order.email,
          external_customer_id: order.id,
          metadata: {
            order_id: order.id,
            merchant: order.merchantName,
            product: order.productName,
            billing: "subscription",
            period: order.period,
          },
        }
      : {
          mode: "payment",
          amount: order.amount,
          currency: order.currency,
          return_url: `${absoluteBaseUrl(req)}/consumer/return?order_id=${encodeURIComponent(order.id)}`,
          payment_types: [order.paymentType],
          default_locale: "ja",
          payment_data: {
            external_order_num: order.id,
          },
          metadata: {
            order_id: order.id,
            merchant: order.merchantName,
            product: order.productName,
            billing: "one_time",
          },
        };

  return komoju("/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function createSubscription(order, customerId) {
  return komoju("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      amount: order.amount,
      currency: order.currency,
      period: order.period,
      metadata: {
        order_id: order.id,
        merchant: order.merchantName,
        product: order.productName,
      },
    }),
  });
}

async function refreshOrderFromSession(order) {
  if (!order.sessionId) return order;
  const session = await komoju(`/sessions/${encodeURIComponent(order.sessionId)}`);

  if (order.billingType === "subscription") {
    const customerId =
      session.customer_id ||
      session.customer?.id ||
      session.customer ||
      order.customerId ||
      null;

    if (!customerId) {
      return updateOrder(order.id, {
        status: session.status || order.status,
        rawSession: session,
      });
    }

    if (order.subscriptionId) {
      return updateOrder(order.id, {
        status: session.status || order.status,
        customerId,
        rawSession: session,
      });
    }

    const subscription = await createSubscription(order, customerId);
    return updateOrder(order.id, {
      status: "subscription_created",
      customerId,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status || "pending",
      nextCaptureAt: subscription.next_capture_at || null,
      rawSession: session,
      rawSubscription: subscription,
    });
  }

  return updateOrder(order.id, {
    status: session.status || order.status,
    paymentStatus: session.payment?.status || order.paymentStatus || null,
    paymentId: session.payment?.id || order.paymentId || null,
    rawSession: session,
  });
}

async function refundPayment(paymentId, amount) {
  const payload = {};
  if (amount !== undefined && amount !== null) payload.amount = amount;
  return komoju(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function serveStatic(req, res) {
  const requestedPath = new URL(req.url, "http://localhost").pathname;
  let relativePath = requestedPath.replace(/^\/+/, "");
  if (requestedPath === "/" || requestedPath === "/consumer" || requestedPath === "/consumer/" || requestedPath === "/return" || requestedPath === "/consumer/return") {
    relativePath = "consumer/index.html";
  }
  if (requestedPath === "/merchant" || requestedPath === "/merchant/" || requestedPath === "/merchant.html") {
    relativePath = "merchant/index.html";
  }
  const filePath = path.join(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
  };
  res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function router(req, res) {
  const url = new URL(req.url, "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, {
        merchantName: MERCHANT_NAME,
        productName: PRODUCT_NAME,
        currency: CURRENCY,
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
        komojuReady: Boolean(KOMOJU_SECRET_KEY),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      sendJson(res, 200, { user: currentUser(req) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!isValidEmail(email)) {
        sendJson(res, 422, { error: "メールアドレスを正しく入力してください。" });
        return;
      }
      const sessionId = crypto.randomBytes(24).toString("hex");
      const sessions = readSessions();
      sessions[sessionId] = { email, createdAt: new Date().toISOString() };
      writeSessions(sessions);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookie(sessionId, 60 * 60 * 24 * 14),
      });
      res.end(JSON.stringify({ user: { email } }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const sessionId = parseCookies(req).checkout_session;
      if (sessionId) {
        const sessions = readSessions();
        delete sessions[sessionId];
        writeSessions(sessions);
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookie("", 0),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      const user = requireUser(req, res);
      if (!user) return;
      const orders = readOrders()
        .filter((order) => userOwnsOrder(order, user))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      sendJson(res, 200, orders.map(publicOrder));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/merchant/orders") {
      const merchantName = String(url.searchParams.get("merchantName") || "").trim();
      if (!merchantName) {
        sendJson(res, 422, { error: "加盟店名を指定してください。" });
        return;
      }
      const orders = readOrders()
        .filter((order) => order.merchantName === merchantName)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      sendJson(res, 200, orders.map(merchantOrder));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const user = requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      const amount = Number(body.amount);
      const billingType = body.billingType || "one_time";
      const period = body.period || "monthly";
      const email = user.email;
      const merchantName = String(body.merchantName || MERCHANT_NAME).trim();
      const productName = String(body.productName || PRODUCT_NAME).trim();

      if (!Number.isInteger(amount) || amount < 1) {
        sendJson(res, 422, { error: "金額は1円以上の整数で入力してください。" });
        return;
      }
      if (!merchantName) {
        sendJson(res, 422, { error: "加盟店名を指定してください。" });
        return;
      }
      if (!["one_time", "subscription"].includes(billingType)) {
        sendJson(res, 422, { error: "決済タイプを正しく選択してください。" });
        return;
      }
      if (billingType === "subscription" && !["weekly", "monthly", "yearly"].includes(period)) {
        sendJson(res, 422, { error: "繰り返し決済の周期を正しく選択してください。" });
        return;
      }
      if (billingType === "subscription" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(res, 422, { error: "繰り返し決済ではメールアドレスを入力してください。" });
        return;
      }
      if (body.paymentType !== "credit_card") {
        sendJson(res, 422, { error: "現在はCard決済のみ選択できます。" });
        return;
      }

      const now = new Date().toISOString();
      const order = {
        id: `order_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
        merchantName,
        productName,
        amount,
        currency: CURRENCY,
        userEmail: user.email,
        billingType,
        period: billingType === "subscription" ? period : null,
        email: billingType === "subscription" ? email : null,
        paymentType: body.paymentType,
        status: "draft",
        sessionId: null,
        sessionUrl: null,
        paymentStatus: null,
        paymentId: null,
        customerId: null,
        subscriptionId: null,
        subscriptionStatus: null,
        nextCaptureAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const orders = readOrders();
      orders.push(order);
      writeOrders(orders);
      sendJson(res, 201, publicOrder(order));
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/session$/);
    if (req.method === "POST" && sessionMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const order = findUserOrder(sessionMatch[1], user);
      if (!order) {
        sendJson(res, 404, { error: "注文が見つかりません。" });
        return;
      }

      const session = await createSession(req, order);
      const updated = updateOrder(order.id, {
        status: session.status || "pending",
        sessionId: session.id,
        sessionUrl: session.session_url,
        rawSession: session,
      });
      sendJson(res, 200, { order: publicOrder(updated), sessionUrl: session.session_url });
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (req.method === "POST" && statusMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const order = findUserOrder(statusMatch[1], user);
      if (!order) {
        sendJson(res, 404, { error: "注文が見つかりません。" });
        return;
      }
      const updated = await refreshOrderFromSession(order);
      sendJson(res, 200, publicOrder(updated));
      return;
    }

    const refundMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/refund$/);
    if (req.method === "POST" && refundMatch) {
      const user = requireUser(req, res);
      if (!user) return;
      const order = findUserOrder(refundMatch[1], user);
      if (!order) {
        sendJson(res, 404, { error: "注文が見つかりません。" });
        return;
      }
      if (!order.paymentId) {
        sendJson(res, 422, { error: "KOMOJUのPayment IDがないため返金できません。決済状態を更新してください。" });
        return;
      }
      if (order.refundedAt) {
        sendJson(res, 409, { error: "この取引はすでに返金処理済みです。" });
        return;
      }

      const body = await readBody(req);
      const amount = body.amount === undefined || body.amount === null || body.amount === "" ? null : Number(body.amount);
      if (amount !== null && (!Number.isInteger(amount) || amount < 1 || amount > order.amount)) {
        sendJson(res, 422, { error: "返金額は1円以上、決済金額以下の整数で入力してください。" });
        return;
      }

      const refund = await refundPayment(order.paymentId, amount);
      const updated = updateOrder(order.id, {
        status: "refunded",
        paymentStatus: refund.status || "refunded",
        refundStatus: refund.status || "refunded",
        refundAmount: amount || order.amount,
        refundedAt: new Date().toISOString(),
        rawRefund: refund,
      });
      sendJson(res, 200, publicOrder(updated));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/komoju/payments") {
      const params = new URLSearchParams({
        per_page: url.searchParams.get("per_page") || "20",
        page: url.searchParams.get("page") || "1",
      });
      if (url.searchParams.get("status")) params.set("status", url.searchParams.get("status"));
      if (url.searchParams.get("currency")) params.set("currency", url.searchParams.get("currency"));
      const payments = await komoju(`/payments?${params.toString()}`);
      sendJson(res, 200, payments);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Unexpected server error.",
      details: error.payload || null,
    });
  }
}

ensureStore();
http.createServer(router).listen(PORT, () => {
  console.log(`KOMOJU checkout app: http://localhost:${PORT}`);
});
