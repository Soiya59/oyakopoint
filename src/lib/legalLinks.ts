/**
 * 使い方ガイド・プライバシーポリシー・利用規約の公開URL。
 * やること.md 2-28（宣伝部/成果物/開発チャットへの申し送り（2026-09-09）.md 件3）。
 *
 * 本部長が2026-09-09に本番公開済み（`https://soiya59.github.io/oyakopoint/` 配下）。
 * [注意・実装メモ.md 181章] TERMS_URL（利用規約）は、このファイル作成時点
 * （2026-09-09）でまだ生成されていない（404）。宣伝部が原稿の未記入箇所を
 * 対応中で、近く生成される見込み。本部長の指示により、未生成のままリンクを
 * 張ってよいことになっている。
 */
const BASE_URL = "https://soiya59.github.io/oyakopoint";

export const HELP_PARENT_URL = `${BASE_URL}/help/parent.html`;
export const HELP_SUPPORTER_URL = `${BASE_URL}/help/supporter.html`;
export const HELP_CHILD_URL = `${BASE_URL}/help/child.html`;
export const PRIVACY_POLICY_URL = `${BASE_URL}/legal/privacy.html`;
export const TERMS_URL = `${BASE_URL}/legal/terms.html`;

/**
 * 規約類（プライバシーポリシー・利用規約）のページを公開済みかどうか。
 *
 * [2026-09-09・統括判断] **false の間は、この2つへのリンクを画面に出さない。**
 * 理由: 制定日が未定のため両ページとも公開していない（`public/legal/` に置いて
 * いない）。**読めない規約への同意は、同意として弱い。** 統括に「このまま出す／
 * リンクだけ隠して出す」の二択で諮り、後者が選ばれた。
 *
 * 制定日が決まり、`python tools/convert_help_docs.py` が2本を書き出せるように
 * なったら、**この定数を true にするだけでリンクが出る。**
 *
 * 使い方ガイド（HELP_*）は公開済みなので、この定数の影響を受けない。
 */
export const LEGAL_PAGES_PUBLISHED = false;
