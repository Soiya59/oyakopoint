-- 「きろく」のクエストごとの回数（要件定義書07-46章、2026-10-03）
-- 設計部/成果物/スキーマ設計.sql 84章（84.3章のView・84.4章の権限）のDDLをそのまま写したもの
-- （開発部/成果物/実装メモ.md 353章。既存のView3本と同じ作り方）。
--
-- [何を足すか] 読み取り専用のViewを1つ（member_chore_name_counts）だけ。
-- 表・列・索引・トリガー・関数（RPC）・RLSポリシーは足さない・変えない。
-- 完了報告（chore_completions。追記専用）・クエスト（chores）・既存のView
-- （chore_completion_totals・chore_weekly_completion_counts・habit_card_chore_breakdown・
-- member_badge_progress）には1文字も触れない。**破壊的な操作（DROP・既存データの書き換え）は無い。**
--
-- [何を数えるか] メンバー（member_id = reported_by）×クエスト名（chore_name）ごとの、これまでの
-- 完了報告の回数と最後にやった時刻。名前は、いまもあるクエスト（chore_idが残っている）は今の名前、
-- 消したクエスト（chore_idがNULL）は記録時の名前（chore_completions.chore_title）を、前後の空白
-- （半角・全角・タブ・改行・U+00A0）を除いて完全一致で1つにまとめる。おねがい（chores.is_request）は
-- 除く。chore_idがNULLの行は通常のクエストとして数える（**LEFT JOINにすること**）。
--
-- [誰に何行返るか（84.2 判断F）] security_invoker = true なので、呼んだ人の権限で
-- chore_completions・chores の既存RLS（family_id = current_family_id()）が効く。そのうえで、
-- Viewの中の条件で、子ども・みまもりには本人の行だけ、保護者には同じ家族の全員の行を返す。
-- **ロールが特定できない呼び出し（管理者のSQL・service_role・退会済みのメンバーのトークン・
-- 家族に属さないログイン）では current_family_member_id() / current_family_role() がNULLを
-- 返すため、このViewは0行になる（意図。開発中にSQLエディタで読んで空に見えても不具合ではない）。**
-- 確かめるときは `SET LOCAL ROLE authenticated` ＋ request.jwt.claims の
-- family_member_id でなりすます（スキーマ設計.sql 84.11章）。
-- この条件は「秘密を守る壁」ではない（基礎の表は家族全員が読める）。便利な入口とアプリの書き間違いを
-- 閉じる守りである（84.2 判断F(2)）。
--
-- [PL/pgSQLの関数は書いていない] RETURNS TABLEの出力列名と本文の列名の衝突
-- （column reference ... is ambiguous）は起きない。Viewの内側の列には別名
-- （completion_id・display_name・display_emoji）を付け、外側は x. 付きで参照している。
--
-- [出す順序] DB（このmigration）が先、アプリ（OTA）があと。新しいアプリが先だと、区画を開いた瞬間に
-- Viewが無くてエラー（42P01）になる。ロールバックは `DROP VIEW IF EXISTS
-- public.member_chore_name_counts;`（先にアプリ〔OTA〕を戻す。ほかのどのオブジェクトもこのViewを
-- 参照しないので単独で消せる。データは失われない）。
--
-- [権限] 84.4章。既存のView群は明示的なGRANTを書かず、Supabaseの自動付与に乗っている。2026-10-30以降の
-- 自動付与の廃止がViewにも及ぶかは未確認（84.14 未決1。本件の外）なので、このViewは明示的に
-- REVOKE→GRANTを書く。anonには付けない（ログイン前に読ませる事情が無い）。

CREATE OR REPLACE VIEW public.member_chore_name_counts
WITH (security_invoker = true) AS
SELECT
  x.family_id,
  x.reported_by AS member_id,
  x.display_name AS chore_name,
  (array_agg(x.display_emoji ORDER BY x.reported_at DESC, x.completion_id DESC))[1] AS chore_emoji,
  COUNT(*)::INT AS completion_count,
  MAX(x.reported_at) AS last_completed_at
FROM (
  SELECT
    cc.id AS completion_id,
    cc.family_id,
    cc.reported_by,
    cc.reported_at,
    btrim(COALESCE(ch.title, cc.chore_title), E' \t\r\n' || chr(12288) || chr(160)) AS display_name,
    CASE WHEN ch.id IS NOT NULL THEN ch.emoji ELSE cc.chore_emoji END AS display_emoji
  FROM chore_completions cc
  LEFT JOIN chores ch
    ON ch.id = cc.chore_id
   AND ch.family_id = cc.family_id
  WHERE COALESCE(ch.is_request, false) = false
    AND (
      cc.reported_by = (SELECT public.current_family_member_id())
      OR (SELECT public.current_family_role()) = 'parent'
    )
) x
GROUP BY x.family_id, x.reported_by, x.display_name;

COMMENT ON VIEW public.member_chore_name_counts IS
  '要件定義書07-46章「きろくのクエストごとの回数」（スキーマ設計.sql 84章）。メンバー（member_id=reported_by）ごと・クエスト名（chore_name）ごとの、これまでの完了報告の回数と最後にやった時刻。名前は、いまもあるクエスト（chore_idが残っている）は今の名前（chores.title）、消したクエスト（chore_idがNULL）は記録時の名前（chore_completions.chore_title）を、前後の空白（半角・全角・タブ・改行・U+00A0）を除いて完全一致で1つにまとめる（大文字小文字・全角半角・ひらがなカタカナは同じとみなさない）。絵文字は同じ名前のうち最後にやった行のもの（いまもあるクエストなら今の絵文字、消したクエストなら記録時の絵文字）。おねがい（chores.is_request）は除く。chore_idがNULLの行は通常のクエストとして数える（LEFT JOINにすること。INNER JOINにすると消したクエストが全部落ちる）。期間の絞り込みは一切行わない。ORDER BYは持たない（並べ替えは呼び出し側の.order()。画面は最後にやった時刻の新しい順→名前の順の1つだけ。回数の多い順にしない＝07-46章決定5）。合計・順位・割合・メンバーをまたぐ集計の列は持たない（決定7）。security_invoker=trueのため、chore_completions・choresのRLS（family_id = current_family_id()）がそのまま効く。さらにViewの中の条件で、子ども・みまもりには本人の行だけ、保護者には同じ家族の全員の行を返す（ロールが特定できない管理者・service_role・退会済みのメンバーには0行を返すのが正しい）。読む箇所はアプリの1関数に絞り、必ず.eq(member_id)を付けて1人ぶんだけ読むこと（API仕様.md 40章）。chore_completion_totals等の既存のViewはchore_id単位で、消したクエストがNULLの1グループに混ざるため流用しない。';

-- 権限（84.4章）。anonには付けない。service_roleにも付けるが、ロールが特定できないので0行になる
-- （Edge Functionからは読まない）。
REVOKE ALL ON public.member_chore_name_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_chore_name_counts TO authenticated;
GRANT SELECT ON public.member_chore_name_counts TO service_role;
