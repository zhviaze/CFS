const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

const PORT = 9798;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "..");

let server;
let dataDir;

function seedData() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "komojutest-test-"));
  const now = new Date("2026-06-04T01:45:00.000Z").toISOString();
  const orders = [
    {
      id: "order_test_completed",
      merchantName: "夜猫子店铺",
      productName: "オンライン決済",
      amount: 8800,
      currency: "JPY",
      userEmail: "zhviaze@gmail.com",
      billingType: "one_time",
      period: null,
      email: null,
      paymentType: "credit_card",
      status: "completed",
      sessionId: null,
      sessionUrl: null,
      paymentStatus: "captured",
      paymentId: "payment_test",
      customerId: "customer_master",
      savePaymentMethod: false,
      usedSavedPaymentMethod: true,
      subscriptionId: null,
      subscriptionStatus: null,
      nextCaptureAt: null,
      refundedAt: null,
      refundAmount: null,
      refundStatus: null,
      rawPayment: {
        payment_details: {
          type: "credit_card",
          email: "zhviaze@gmail.com",
          brand: "master",
          last_four_digits: "0107",
          month: 12,
          year: 2030
        }
      },
      createdAt: now,
      updatedAt: now
    },
    {
      id: "order_test_subscription",
      merchantName: "サブスク店舗",
      productName: "月額商品",
      amount: 5000,
      currency: "JPY",
      userEmail: "zhviaze@gmail.com",
      billingType: "subscription",
      period: "monthly",
      email: "zhviaze@gmail.com",
      paymentType: "credit_card",
      status: "subscription_created",
      sessionId: "session_subscription",
      sessionUrl: null,
      paymentStatus: null,
      paymentId: null,
      customerId: "customer_unknown",
      savePaymentMethod: false,
      usedSavedPaymentMethod: false,
      subscriptionId: "subscription_test",
      subscriptionStatus: "active",
      nextCaptureAt: "2026-07-04T01:45:00.000Z",
      refundedAt: null,
      refundAmount: null,
      refundStatus: null,
      createdAt: now,
      updatedAt: now
    }
  ];

  const customers = {
    "zhviaze@gmail.com": {
      methods: [
        {
          customerId: "customer_master",
          label: "MASTER **** 0107（12/2030）",
          brand: "master",
          lastFourDigits: "0107",
          expiryMonth: 12,
          expiryYear: 2030,
          sourceOrderId: "order_test_completed",
          updatedAt: now
        },
        {
          customerId: "customer_unknown",
          label: "保存済みカード",
          brand: null,
          lastFourDigits: null,
          expiryMonth: null,
          expiryYear: null,
          sourceOrderId: "order_test_subscription",
          updatedAt: now
        }
      ]
    }
  };

  fs.writeFileSync(path.join(dataDir, "orders.json"), JSON.stringify(orders, null, 2));
  fs.writeFileSync(path.join(dataDir, "sessions.json"), "{}");
  fs.writeFileSync(path.join(dataDir, "customers.json"), JSON.stringify(customers, null, 2));
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn("node", ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        KOMOJU_SECRET_KEY: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      reject(new Error("server did not start"));
    }, 5000);

    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes(`http://localhost:${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    server.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`server exited with code ${code}`));
      }
    });
  });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await response.text();
  return { response, text };
}

async function requestJson(pathname, options = {}) {
  const { response, text } = await request(pathname, options);
  const json = text ? JSON.parse(text) : null;
  return { response, json };
}

async function login(email = "zhviaze@gmail.com") {
  const { response, json } = await requestJson("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  return { cookie, json };
}

before(async () => {
  seedData();
  await startServer();
});

after(() => {
  if (server) server.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("KOMOJU portal pages", () => {
  it("redirects directory pages to trailing-slash URLs so relative assets load", async () => {
    const merchant = await fetch(`${BASE_URL}/merchant?merchantName=${encodeURIComponent("CFS株式会社")}`, {
      redirect: "manual"
    });
    assert.equal(merchant.status, 308);
    assert.equal(merchant.headers.get("location"), `/merchant/?merchantName=${encodeURIComponent("CFS株式会社")}`);

    const consumer = await fetch(`${BASE_URL}/consumer?amount=1000`, {
      redirect: "manual"
    });
    assert.equal(consumer.status, 308);
    assert.equal(consumer.headers.get("location"), "/consumer/?amount=1000");
  });

  it("serves consumer and merchant pages", async () => {
    const consumer = await request("/consumer/");
    assert.equal(consumer.response.status, 200);
    assert.match(consumer.text, /CFSオンライン決済/);
    assert.match(consumer.text, /\.\/app\.js/);

    const merchant = await request("/merchant/");
    assert.equal(merchant.response.status, 200);
    assert.match(merchant.text, /CFS管理ポータル/);
    assert.match(merchant.text, /merchant\.js/);
    assert.doesNotMatch(merchant.text, /consumerBaseUrlInput/);
    assert.doesNotMatch(merchant.text, /消費者ページURL/);
  });

  it("logs in and exposes all saved cards for the consumer", async () => {
    const { json } = await login();
    assert.equal(json.user.email, "zhviaze@gmail.com");
    assert.equal(json.savedPaymentMethods.length, 2);
    assert.equal(json.savedPaymentMethods[0].label, "MASTER **** 0107（12/2030）");
    assert.equal(json.savedPaymentMethods[1].customerId, "customer_unknown");
  });

  it("shows consumer history with merchant, product, card, and status data", async () => {
    const { cookie } = await login();
    const { response, json } = await requestJson("/api/orders", {
      headers: { Cookie: cookie }
    });
    assert.equal(response.status, 200);
    assert.equal(json[0].merchantName, "夜猫子店铺");
    assert.equal(json[0].productName, "オンライン決済");
    assert.equal(json[0].cardInfo.label, "MASTER **** 0107（12/2030）");
    assert.equal(json[0].paymentStatus, "captured");
  });

  it("creates a draft order with the selected saved customer id", async () => {
    const { cookie } = await login();
    const { response, json } = await requestJson("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body: JSON.stringify({
        merchantName: "テスト店舗",
        productName: "テスト商品",
        amount: 1234,
        paymentType: "credit_card",
        billingType: "subscription",
        period: "monthly",
        selectedCustomerId: "customer_master"
      })
    });
    assert.equal(response.status, 201);
    assert.equal(json.merchantName, "テスト店舗");
    assert.equal(json.productName, "テスト商品");

    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "orders.json"), "utf8"));
    const created = stored.find((order) => order.id === json.id);
    assert.equal(created.selectedCustomerId, "customer_master");
  });

  it("serves merchant history for all stores and store filters", async () => {
    const all = await requestJson("/api/merchant/orders");
    assert.equal(all.response.status, 200);
    assert.ok(all.json.length >= 2);

    const filtered = await requestJson(`/api/merchant/orders?merchantName=${encodeURIComponent("サブスク店舗")}`);
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.json.length, 1);
    assert.equal(filtered.json[0].merchantName, "サブスク店舗");
  });

  it("consumer script contains the expected confirmation-page controls", () => {
    const appJs = fs.readFileSync(path.join(ROOT, "consumer", "app.js"), "utf8");
    assert.match(appJs, /id="confirmPaymentChoice"/);
    assert.match(appJs, /別カードを使う（KOMOJU画面）/);
    assert.match(appJs, /id="confirmSavePaymentMethod"/);
    assert.match(appJs, /hasDisplayableCardInfo/);
    assert.match(appJs, /加盟店名/);
    assert.match(appJs, /商品名/);
    assert.doesNotMatch(appJs, /Customer \$\{method\.customerId/);
    assert.doesNotMatch(appJs, /カード情報未取得（登録済み/);
  });

  it("history status labels are color-classed on both pages", () => {
    const consumerJs = fs.readFileSync(path.join(ROOT, "consumer", "app.js"), "utf8");
    const merchantJs = fs.readFileSync(path.join(ROOT, "merchant", "merchant.js"), "utf8");
    const css = fs.readFileSync(path.join(ROOT, "shared", "styles.css"), "utf8");

    assert.match(consumerJs, /status-label \$\{paymentStatusClass\(order\)\}/);
    assert.match(merchantJs, /status-label \$\{paymentStatusClass\(order\)\}/);
    assert.match(css, /\.status-success/);
    assert.match(css, /\.status-danger/);
  });

  it("merchant script auto-builds consumer URLs without a manual URL field", () => {
    const merchantJs = fs.readFileSync(path.join(ROOT, "merchant", "merchant.js"), "utf8");
    assert.match(merchantJs, /function consumerBaseUrl/);
    assert.match(merchantJs, /new URL\("\.\.\/consumer\/", window\.location\.href\)/);
    assert.doesNotMatch(merchantJs, /consumerBaseUrlInput/);
    assert.doesNotMatch(merchantJs, /form\.get\("consumerBaseUrl"\)/);
  });
});
