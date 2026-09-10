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
 * [2026-09-11・統括決定] **true にした。**制定日が2026年9月11日で確定し
 * （`宣伝部/成果物/利用規約（初稿・2026-09-07）.md`・同プライバシーポリシーの
 * 「制定日」節）、`python tools/convert_help_docs.py` が2本とも書き出せるように
 * なったため。統括が保留を解除した理由: **初回モーダル（やること.md 2-22）は
 * 既に稼働しており、家族が現在、読めない規約に同意している状態にある。**
 * これは上記2026-09-09の判断（読めない規約への同意は弱い）と噛み合わない。
 * 規約を公開してもストア配信は始まらず、本名も公開されない。
 *
 * あわせて統括が決めた日付の運用: **一般公開までは改定日を足さず、直すたびに
 * 制定日そのものを書き換える。**利用者が増えた時点で「最終改定日」を足す運用へ
 * 切り替える（切り替え時期は統括の判断）。
 *
 * 使い方ガイド（HELP_*）は公開済みなので、この定数の影響を受けない。
 */
export const LEGAL_PAGES_PUBLISHED = true;
