# CFS Homepage

CFS株式会社のホームページ管理用プロジェクトです。

## ファイル構成

- `index.html`
  - GitHub Pages、Netlify、通常のHTML公開向けのメインファイルです。
- `contact.html`
  - Googleフォームを埋め込んだお問い合わせページです。
- `privacy-policy.html`
  - プライバシーポリシーのページです。
- `information-security-policy.html`
  - 情報セキュリティ基本方針のページです。
- `antisocial-policy.html`
  - 反社会的勢力に対する基本方針のページです。
- `aml-cft-policy.html`
  - AML/CFTポリシーのページです。
- `google-sites-embed.html`
  - Google Sitesの「埋め込む」→「コードを埋め込む」に貼り付けるためのHTMLです。
  - Google Sites上で動きづらいページ内スクロールボタンを外した版です。
- `.nojekyll`
  - GitHub Pagesでそのまま静的HTMLとして公開するための設定ファイルです。

## Google Sitesで使う場合

1. Google Sitesを開きます。
2. 挿入メニューから「埋め込む」を選びます。
3. 「コードを埋め込む」を選びます。
4. `google-sites-embed.html` の中身をすべてコピーして貼り付けます。
5. サイズをページ幅いっぱいに調整します。

通常のテキストボックスに貼ると、CSSやアニメーションは反映されません。
必ず「コードを埋め込む」を使ってください。

お問い合わせは `contact.html` にGoogleフォームを埋め込んでいます。
Google Sitesで問い合わせフォームを使う場合は、Google Sites側で別ページを作り、同じGoogleフォームiframeを直接埋め込む方法が最も安定します。

## GitHub Pagesで公開する場合

1. GitHubで新しいリポジトリを作成します。
2. `github-upload` フォルダ内のファイルをアップロードします。
3. `Settings` → `Pages` を開きます。
4. Sourceを `Deploy from a branch` にします。
5. Branchを `main`、Folderを `/root` にします。
6. `Save` を押します。

数分後にGitHub PagesのURLが発行されます。

## デザイン設定

- 背景: `#FFFFFF`
- メイン文字: `#111111`
- 本文文字: `#4A4A4A`
- 補助文字: `#777777`
- アクセント: `#0E8F94`
- ネイビー: `#102A43`
- 薄背景: `#F4F8F9`
- 線: `#E3ECEF`
- フォント: Apple system / Google Sans / Noto Sans JP / Hiragino Sans / Yu Gothic
- ヘッダー: ホーム、会社概要、業務領域、問合せ
- フッター: 各方針ページ、著作権表記

## 更新方法

本文やデザインを変更したい場合は、まず `index.html` を編集します。
Google Sitesに再度貼り付ける場合は、編集後の内容を `google-sites-embed.html` にも反映してください。
問い合わせフォームを変更する場合は、Googleフォーム側で編集してください。
