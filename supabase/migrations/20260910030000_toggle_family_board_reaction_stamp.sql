-- ============================================================
-- 家族の掲示板へのスタンプ（絵文字）リアクションの取消・切替（2026-09-10）
-- ============================================================
-- 【2026-09-10改訂・実装メモ.md 160章】本ファイルは159章時点の内容から仕様を
-- 変更した（統括判断B）。**「1人1投稿につき有効なスタンプは常に1件まで」という
-- 強制は撤回し、104章の「1人が最大4種類のスタンプを送れる」仕様を維持したまま
-- 取消・再追加のみを足す形にした。** 経緯・判断理由は実装メモ.md 160章参照。
-- 以下の[経緯][確定した仕様]節は改訂後の内容に置き換えている。改訂前の内容
-- （159章時点、統括に確認せず「1人1件まで」を実装してしまっていた版）は
-- git履歴および実装メモ.md 159章（取消線付きで保持）を参照。
--
-- 参照:
--   本部長からの業務指示。統括が157章（完了報告へのスタンプの取消・切替）を
--   知り、「掲示板も同じくでお願いします」と指示した（開発部/成果物/実装メモ.md
--   159章・160章に判断理由を記録）。157章と同じく設計部を通していない
--   （規模が小さく、157章という直接の前例があるため）。
--
-- [確定した仕様（160章・統括判断B。157章の完了報告とは意図的に異なる）]
--   - `UNIQUE (post_id, reactor_member_id, stamp_key)`（104章）はそのまま維持する
--   - 同じスタンプをもう一度押す → **そのスタンプだけ**消える（取消）
--   - 違うスタンプを押す → **追加される**（既存の他のスタンプは消えない。
--     157章＝完了報告〈1人1件まで〉とはここが異なる。完了報告は「一言添える」、
--     掲示板は「みんなで押す」という場の性格の違いによる意図的な差）
--   - 時間の制限は付けない
--
-- [159章で発生した前提誤り・本番前に止まった経緯（実装メモ.md 160章に詳細）]
-- 159章着手時、業務指示は「family_board_reactionsには
-- `UNIQUE(post_id, reactor_member_id)`があり、1人1つは既にDBで守られている」と
-- いう前提だったが、これは20260901160000_family_board_reactions.sql時点
-- （103章）の制約であり、その後の20260901180000_family_board_reactions_line_
-- style.sql（104章、統括の「LINEみたいに複数種類使える感じでも良い」という
-- フィードバックへの対応）で`UNIQUE (post_id, reactor_member_id, stamp_key)`に
-- 張り替え済みだった。開発部はこれを実測で確認し159.6・159.8で「104章の決定を
-- 実質撤回することになるため統括に確認すべき」と本部長に報告した。本部長がこれを
-- 統括に確認したところ、統括の要望は「押し間違いを消したい」であって「1人1つに
-- したい」ことではないと判明し、**本番適用前に、159章時点の実装（1人1件までの
-- 強制を含む版）を本改訂の内容に差し替えた。** 159章時点の版は一度も本番に
-- 適用していない（開発部/成果物/実装メモ.md 159章・160章参照）。
--
-- [削除の方式: 157章と同じSECURITY DEFINER RPCに一本化する（160章でも維持）]
-- 「1人1件まで」の強制自体は撤回したが、RPC方式そのものをやめる理由にはならない
-- ため、160章でも継続してRPCに一本化した。
--   (a) 「取消」「追加」を1回のDB呼び出し・1トランザクションで完結させたい
--   (b) このプロジェクトの「書き込みをRPCに集約する」方針（cancel_chore_
--       completion・toggle_chore_reaction_stamp等）を踏襲する
--   (c) 対象投稿の存在確認・自己リアクション禁止など、RLSを経由しない
--       SECURITY DEFINER関数として独立して権限判定を行う既存の型（157章と同じ）に
--       揃えることで、直接INSERT/DELETEポリシーを新設するより実装・レビューの
--       型を1つに保てる
--
-- [直接INSERTポリシーの扱いについての判断（157章と揃えるかの判断・実装メモ.md
-- 159章に記録）]
-- 157章はchore_reactionsに`kind`列（'stamp'/'comment'）があり、スタンプの直接
-- INSERTだけを塞ぎ、コメントの直接INSERTは残す必要があったため、INSERTポリシーを
-- 「`kind = 'comment'`のときのみ許可」に絞り込んだ（DROP→CREATEで置き換え）。
-- **family_board_reactionsには`kind`列が無く、このテーブルへの書き込みは
-- 100%スタンプである（コメント相当の概念自体が存在しない、20260901160000の
-- 設計コメント参照）。** したがって157章のように「絞り込んで一部を残す」という
-- 選択肢が無く、残すべき直接INSERT経路が1つも無い。よって157章の「絞り込む」
-- ではなく、**INSERTポリシーをDROPし、置き換えを作らない**という判断にした
-- （`WITH CHECK (false)`の空ポリシーを残す案も検討したが、恒久的に何も許可
-- しないポリシーを残すのは「なぜ存在するのか」を将来読む人が誤解しやすく、
-- 単純にポリシーが0本＝RLS有効時のデフォルト拒否のほうが素直だと判断した）。
-- 以後、掲示板スタンプの追加・切替・取消はすべて本RPC経由に一本化される。
-- この判断により、RLS照査スイート（supabase/tests/rls_checks.sql）のS3は
-- 157章と異なり本数が1本減る（55→54、後述）。
--
-- [権限判定の二重実装についての注意]
-- 本関数はSECURITY DEFINERのためRLSを経由しない。対象投稿の存在確認
-- （自家族限定・論理削除済み投稿の除外）と自己リアクション禁止は、従来
-- `family_board_reactions_before_insert`トリガー（20260901160000）がRLS経由の
-- 除外＋明示チェックで行っていたが、本関数はRLSを経由しないため同じ判定を
-- 関数本体内で独立して再実装している（cancel_chore_completion・
-- toggle_chore_reaction_stampが同様に権限判定を関数内で再実装しているのと
-- 同じパターン）。なお本関数のINSERT自体は既存のトリガーを経由する
-- （SECURITY DEFINER関数内のINSERT文であってもテーブルのトリガーは通常どおり
-- 発火するため、family_idの自動補完は従来どおりトリガーが行う。トリガーの
-- 内部チェックは本関数の事前チェックと重複するだけで害はない）。
--
-- [誰が誰にリアクションできるか（chore_reactionsとの違い）]
-- 要件定義書07-14章「誰が誰に送れるか」は掲示板について3ロール対等（非対称
-- 制限なし）と定めており、20260901160000のINSERTポリシーもfamily_id一致＋
-- 本人一致のみで役割による制限を持たない。本関数もこれを踏襲し、権限判定は
-- 「自分の投稿でないこと」の1点のみ（157章のchore_reactionsのような
-- 「保護者は誰にでも、子どもは対象completionの報告者がparentの場合のみ」という
-- 非対称ロジックは移植しない。要件が異なるため）。
--
-- [自分のスタンプだけ消せること／他人・他家族のスタンプを消せないこと]
--   - reactor_member_id = v_caller_member_idで常に絞り込むため、他人のスタンプは
--     一切対象にならない（157章と同じ、「他人の反応を指定して操作する」引数自体が
--     存在しない構造）。
--   - 対象投稿の取得をfamily_id = v_caller_family_idで絞り込むため、他家族の
--     post_idを渡されても「対象の投稿が見つからないか、すでに削除されています」に
--     収束し、他家族の行には一切触れない。
--
-- [エラーメッセージ・ERRCODEを既存のトリガーと完全に一致させた理由]
-- 「対象の投稿が見つからないか、すでに削除されています」（foreign_key_violation）
-- ・「自分の投稿にはリアクションできません」（check_violation）は、いずれも
-- 既存のfamily_board_reactions_before_insertトリガーが送出していたメッセージ・
-- ERRCODEとそのまま一致させた。クライアント側（src/hooks/useFamilyBoard.ts・
-- src/components/FamilyBoardHistoryPanel.tsxのreactionErrorText）が
-- 「見つからない」という文言・foreign_key_violationコードで「削除済み投稿への
-- 反応」を判定しているため、ここを変えるとクライアント側の分岐が壊れる
-- （開発部/成果物/実装メモ.md 159章参照）。
--
-- 破壊性: 非破壊的。新規関数1件（toggle_family_board_reaction_stamp）の追加と、
-- 既存の`family_board_reactions_insert_self`ポリシーのDROP（置き換えなし）のみ。
-- 新規テーブル・新規列は無い。DROPするポリシーはINSERT専用であり、既存データの
-- 削除・変更は一切発生しない。
--
-- 権限影響: RLS照査スイート（supabase/tests/rls_checks.sql）の
-- S3（55→54、family_board_reactions_insert_selfの削除）・
-- S4（58→59、新規関数toggle_family_board_reaction_stampをauthenticatedへ
-- 明示的にGRANT）は159章時点から**変わらない**（160章の改訂はRPCの関数本体の
-- ロジックのみを変更しており、ポリシー・関数の存在自体は159章時点から増減して
-- いないため。実装メモ.md 160章で実測して確認済み）。S1（27のまま。新規テーブル
-- 無し）も変更しない。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 159章・160章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. family_board_reactions_insert_self を削除し、置き換えを作らない
--    （上記コメント[直接INSERTポリシーの扱い]参照。以後の書き込みは
--    本RPC経由に一本化される）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "family_board_reactions_insert_self" ON family_board_reactions;

-- ------------------------------------------------------------
-- 2. toggle_family_board_reaction_stamp() — スタンプの追加・切替・取消
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_family_board_reaction_stamp(
  p_post_id UUID,
  p_stamp_key TEXT
)
RETURNS TABLE (
  removed BOOLEAN,
  reaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_post RECORD;
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. 対象投稿の存在確認・自家族限定・論理削除済みを除外する（他家族の投稿・
  --    削除済み投稿・存在しないIDを区別しない。既存のfamily_board_reactions_
  --    before_insertトリガーがRLS経由の除外で実現していたのと同じ挙動を、
  --    本関数はRLSを経由しないため明示的な条件として再実装する）。
  SELECT fbp.family_id, fbp.author_member_id INTO v_post
  FROM family_board_posts fbp
  WHERE fbp.id = p_post_id
    AND fbp.family_id = v_caller_family_id
    AND fbp.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の投稿が見つからないか、すでに削除されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 2. 自己リアクション禁止（既存トリガーと同じメッセージ・ERRCODE。多重防御）。
  IF v_post.author_member_id = v_caller_member_id THEN
    RAISE EXCEPTION '自分の投稿にはリアクションできません' USING ERRCODE = 'check_violation';
  END IF;

  -- 3. 自分が「ちょうど同じstamp_key」の行を既に持っているか（そのスタンプ
  --    1件のみを対象にする。160章：他の種類のスタンプには一切触れない。
  --    159章時点は種類問わず全削除していたが、これは撤回した）。
  SELECT id INTO v_existing_id
  FROM family_board_reactions
  WHERE post_id = p_post_id
    AND reactor_member_id = v_caller_member_id
    AND stamp_key = p_stamp_key;

  IF v_existing_id IS NOT NULL THEN
    -- 同じスタンプをもう一度押した → そのスタンプだけ取り消す（自分が送った
    -- 他の種類のスタンプはそのまま残る。104章の複数種類対応を維持する）。
    DELETE FROM family_board_reactions WHERE id = v_existing_id;
    RETURN QUERY SELECT true, NULL::uuid;
    RETURN;
  END IF;

  -- 4. 未送信、または違う種類のスタンプ → 追加する（自分の既存スタンプは
  --    一切削除しない。`UNIQUE (post_id, reactor_member_id, stamp_key)`
  --    〈104章〉により同じ組み合わせの二重送信自体はDBが防ぐが、上記3で
  --    既に無いことを確認済みのためここで一意制約違反になることはない）。
  --    family_idは既存のfamily_board_reactions_before_insertトリガーが対象投稿
  --    から自動補完する（本関数からのINSERTであってもトリガーは通常どおり
  --    発火する）。stamp_keyの空文字・NULL・長さ超過は既存のCHECK制約が
  --    拒否するため、本関数では二重にバリデーションしない。
  INSERT INTO family_board_reactions (post_id, reactor_member_id, stamp_key)
  VALUES (p_post_id, v_caller_member_id, p_stamp_key)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT false, v_new_id;
END;
$$;

COMMENT ON FUNCTION public.toggle_family_board_reaction_stamp(UUID, TEXT) IS
  '統括指示「掲示板のスタンプも完了報告と同じく取消・切替できるように」への対応（開発部/成果物/実装メモ.md 160章、157章の踏襲。159章時点は「1人1件まで」を強制していたが撤回した）。同じスタンプを再度押すとそのスタンプだけ取消、違うスタンプを押すと追加（既存の他のスタンプは消えない。104章の複数種類対応を維持）。自分の行のみ操作可（reactor_member_id = current_family_member_id()）、他家族のpost_idは対象外（family_id一致を要求）。family_board_reactions_insert_selfをDROPし置き換えを作らないため、掲示板スタンプの追加・切替・取消はすべて本関数経由に一本化されている。EXECUTE権限は下記参照。';

-- ------------------------------------------------------------
-- EXECUTE権限（GRANT/REVOKE）— toggle_chore_reaction_stamp等と同じパターン
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.toggle_family_board_reaction_stamp(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_family_board_reaction_stamp(UUID, TEXT) TO authenticated;
