# 佐々木歯科医院 ブログ自動投稿システム

佐々木歯科医院（京都市西京区）の公式ブログ記事を、医療広告ガイドラインに準拠した形で執筆・品質チェック・WordPress投稿するためのツール群です。

---

## 前提条件

- **Node.js 18 以上**（`fetch` API をネイティブで使用するため）
- **WordPress サイト**（REST API v2 が有効であること）
- **WordPress Application Password**（管理画面 → ユーザー → プロフィール → アプリケーションパスワード で発行）

---

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone <リポジトリURL>
cd dentalBlog
```

### 2. 依存パッケージのインストール

```bash
npm install
```

以下のパッケージがインストールされます:
- `dotenv` - 環境変数の読み込み
- `marked` - Markdown から HTML への変換
- `sanitize-html` - HTML のサニタイズ（安全でないタグの除去）
- `sharp` - OGP画像の生成（1200x630、タイトルオーバーレイ）

### 3. 環境変数の設定

プロジェクトルートに `.env` ファイルを作成し、以下を設定します。

```env
WP_SITE_URL=https://www.dentalclinic-sasaki.com
WP_USERNAME=WordPress管理ユーザー名
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

- `WP_SITE_URL`: WordPress サイトのURL（末尾スラッシュなし）
- `WP_USERNAME`: WordPress の管理ユーザー名
- `WP_APP_PASSWORD`: WordPress のアプリケーションパスワード（スペース区切り形式のまま記入可）

### 4. 認証テスト

```bash
node test-wp-auth.js
```

「Authentication successful!」と表示されれば設定完了です。

---

## 使い方

### 全体の流れ

```
1. ブリーフ作成 → 2. 記事執筆 → 3. 品質チェック → 4. レビュー → 5. 投稿
```

### 1. ブリーフ（記事企画書）の作成

`briefs/_template.json` をコピーして、新しいブリーフファイルを作成します。

```bash
cp briefs/_template.json briefs/新しい記事のスラッグ.json
```

`config/tracked-keywords.json` からキーワードを選び、ブリーフの各フィールドを埋めます。各フィールドの説明はテンプレート内の `_comment` フィールドを参照してください。

### 2. 記事の執筆

ブリーフの内容に基づき、Markdown形式で6,000字以上の記事を執筆します。執筆ルールの詳細は `config/shiji.md` を参照してください。

Claude Code を使って執筆する場合は、`CLAUDE.md` の「執筆ワークフロー」に従ってください。

### 3. 品質チェック

`publish.js` の実行時に `lib/quality-check.js` が自動で品質チェックを行います。チェック項目:

1. NG語の検出（`clinic.json` の `ngWords`）
2. プレースホルダー `[[...]]` の残留
3. ダミーURLの検出
4. 文字化け（U+FFFD）の検出
5. `<figcaption>` タグの検出
6. AI型CTA（`>>...はこちら`）の検出
7. 文字数チェック（6,000字以上）
8. 架空内部リンクの検出
9. 禁止固有名詞の検出
10. 限定解除要件（「リスク」「副作用」「自由診療」）の存在確認

### 4. 下書き投稿

```bash
node publish.js articles/記事ファイル名.md --status draft
```

### 5. 公開投稿（要注意）

```bash
node publish.js articles/記事ファイル名.md --status publish
```

### 6. 予約投稿

```bash
node publish.js articles/記事ファイル名.md --status publish --schedule "2026-05-01T09:00:00"
```

---

## ファイル構成

```
dentalBlog/
├── clinic.json                ← 医院設定
├── publish.js                 ← 投稿スクリプト（メイン）
├── test-wp-auth.js            ← 認証テスト
├── verify-images.js           ← 画像検証
├── package.json               ← パッケージ定義
├── .env                       ← 環境変数（要作成・Git管理外）
├── CLAUDE.md                  ← Claude Code 実行指示書
├── README.md                  ← 本ファイル
├── research-notes.md          ← 調査ノート
├── config/
│   ├── shiji.md               ← 医療広告ガイドライン執筆指示書
│   ├── eeat-config.json       ← E-E-A-T設定
│   └── tracked-keywords.json  ← SEOキーワード一覧
├── briefs/
│   ├── _template.json         ← ブリーフテンプレート
│   └── *.json                 ← 各記事のブリーフ
├── lib/
│   ├── wordpress-api.js       ← WordPress REST API クライアント
│   ├── markdown-html.js       ← Markdown→HTML変換
│   ├── quality-check.js       ← 品質チェック
│   └── image-overlay.js       ← OGP画像生成
├── articles/                  ← 記事Markdownファイル
└── output/                    ← 生成OGP画像
```

---

## 設定ファイルの説明

### clinic.json

医院の基本情報を管理するファイルです。

| フィールド | 説明 |
|---|---|
| `clinicName` | 医院名 |
| `siteUrl` / `blogUrl` | サイトURL / ブログURL |
| `supervisor` | 記事監修者（副院長）の情報 |
| `servicePages` | 院内サービスページ一覧（内部リンクの検証に使用） |
| `ngWords` | 使用禁止語リスト |
| `specialtyTerms` | 当院で使用する専門用語一覧 |
| `uniquePoints` | 当院の差別化ポイント |
| `existingArticles` | 既存ブログ記事タイトル一覧（重複回避用） |
| `topicDistribution` | 記事テーマの配分比率 |

### config/shiji.md

医療広告ガイドラインに基づく執筆ルールを定めたファイルです。

- NG表現一覧（誇大広告、比較優良広告、禁止事項）
- 自費診療の費用表記ルール
- 治療別リスク・副作用の記載例
- 限定解除要件ブロックのテンプレート
- 引用可能出典リスト
- 監修者情報テンプレート
- 公開前チェックリスト

### config/eeat-config.json

Google の E-E-A-T（経験・専門性・権威性・信頼性）に対応するための設定ファイルです。

- 記事監修者の詳細プロフィール（資格、役職、経歴）
- 医院の信頼性シグナル
- 引用可能出典リスト（公的機関・学会のみ）
- schema.org 構造化データテンプレート（MedicalWebPage、LocalBusiness、FAQPage）

### config/tracked-keywords.json

SEO対策用のターゲットキーワード20件を管理するファイルです。

- カテゴリ別のキーワードリスト（矯正、インプラント、噛み合わせ、メタルフリー、予防）
- 各キーワードの優先度とステータス
- 既存記事との重複回避指針

---

## トラブルシューティング

### 「WP_USERNAME and WP_APP_PASSWORD must be set in .env file.」

`.env` ファイルが存在しないか、`WP_USERNAME` / `WP_APP_PASSWORD` が未設定です。「セットアップ手順」の手順3を確認してください。

### 「Quality check FAILED」

品質チェックでエラーが検出されました。エラーメッセージに従って記事を修正してください。詳細は `CLAUDE.md` の「自己校閲チェックリスト」を参照してください。

### 「Authentication failed」

WordPress REST API への認証に失敗しています。

1. `.env` の `WP_SITE_URL` が正しいか確認（末尾スラッシュなし）
2. `WP_USERNAME` が正しいか確認
3. `WP_APP_PASSWORD` が有効か確認（WordPress管理画面で再発行）
4. WordPress REST API が有効か確認（セキュリティプラグインによるブロックの可能性）

### OGP画像の生成に失敗する

`sharp` パッケージの問題が考えられます。

```bash
npm rebuild sharp
```

それでも解決しない場合は、`sharp` を再インストールしてください。

```bash
npm uninstall sharp && npm install sharp
```

### npm install で依存関係エラーが出る

Node.js のバージョンが 18 未満の可能性があります。

```bash
node --version
```

Node.js 18 以上にアップデートしてください。

---

## 注意事項

- **外部AI APIは使用しません**: 本システムは外部AI APIを呼び出しません。記事執筆は Claude Code が直接行います。
- **医療広告ガイドライン遵守**: すべての記事は厚生労働省「医療広告ガイドライン」（令和5年改定版）に準拠して執筆されます。
- **.env ファイルの管理**: `.env` ファイルにはWordPressの認証情報が含まれます。Gitリポジトリにコミットしないでください。
- **投稿前の確認**: `publish.js` で投稿する前に、必ず記事内容のレビューと承認を行ってください。
