# KOMOJU Checkout Web App Sample

KOMOJU Hosted Page を呼び出すための最小Webアプリです。

## 機能

- 固定の加盟店名と商品名を表示
- メールアドレスでログイン
- ユーザーが金額を入力
- 一回払い / 繰り返し決済を選択
- 繰り返し決済では課金周期とメールアドレスを入力
- 決済手段は Card決済のみ選択
- 確認画面を表示
- サーバー側で KOMOJU Session を作成し、`session_url` にリダイレクト
- 繰り返し決済ではカード登録後に KOMOJU Subscription を作成
- `return_url` で Session 状態を確認
- ログインユーザー本人の注文履歴・サブスク履歴を表示
- ローカルJSONに注文履歴とログインセッションを保存
- 必要に応じて KOMOJU の Payment List API を参照する `/api/komoju/payments` を用意
- 加盟店ページ `/merchant/` で決済QRコードを生成
- 加盟店ページで店舗名別の決済履歴を確認

## 起動

```bash
cd komoju_checkout_app
PORT=8787 \
KOMOJU_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxx \
MERCHANT_NAME="CFS株式会社" \
PRODUCT_NAME="オンライン決済" \
node server.js
```

ブラウザで消費者ページ `http://localhost:8787/consumer/` を開きます。

加盟店ページは `http://localhost:8787/merchant/` を開きます。

## 加盟店ページ

QRコードには以下の情報を含む消費者ページURLを入れています。

- 加盟店名
- 商品名
- 決済金額
- 一回払い / サブスク
- サブスクの場合の課金周期

ユーザーがQRコードを読み取ると、消費者ページに加盟店名・商品名・金額・決済タイプが自動入力された状態で開きます。

GitHub Pages で公開する場合、加盟店ページの「消費者ページURL」は通常
`https://portal.cfsjp.com/Komojutest/consumer/` になります。ローカル確認時は
`http://localhost:8788/consumer/` のように、起動中のローカルURLを指定します。

GitHub Pages は静的ホスティングのため、ログイン画面とQR遷移は静的デモモードで動きます。
KOMOJU決済、履歴API、返金APIを実際に動かすには、`server.js` をNodeサーバーとして別途デプロイし、
`KOMOJU_SECRET_KEY` を環境変数で設定してください。

GitHub Pages からデプロイ済みAPIを呼ぶ場合は、`shared/config.js` にAPIの公開URLを設定します。

```js
window.KOMOJU_PORTAL_CONFIG = {
  apiBaseUrl: "https://your-komoju-api.example.com",
};
```

APIサーバー側は、公開ページからのブラウザ通信を許可するため以下のように起動します。

```bash
KOMOJU_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxx \
ALLOWED_ORIGINS=https://portal.cfsjp.com \
COOKIE_SAME_SITE=None \
node server.js
```

この構成では、GitHub Pages は画面だけを配信し、KOMOJU API は必ずサーバー側から呼び出します。

## 本番化で追加したいもの

- SQLite/PostgreSQLなどの永続DB
- KOMOJU Webhook の署名検証と `payment.captured` 反映
- KOMOJU Webhook の `subscription.*` 反映
- 管理者ログイン
- 本番用のパスワード認証または外部ID基盤
- 注文番号・顧客メール・顧客名の入力または自動連携
- サブスク解約APIと画面
- HTTPSの公開URL

## 注意

`KOMOJU_SECRET_KEY` は必ずサーバー側だけで保持してください。ブラウザ側に埋め込まないでください。
