-- ============================================================
-- アバターの「まえのアバター」（ストック3枚）
-- 統括決定2026-09-30、要件定義書07-44章、設計部/成果物/スキーマ設計.sql 81章
-- （81.3・81.4の写し）、API仕様.md 37章、開発部/成果物/実装メモ.md 334章
-- ============================================================
--
-- [非破壊] 新しい表1つ・索引2つ・ポリシー2本・関数4つ（定数関数1＋RPC3）を足すだけ。
-- 既存の`member_avatars`（表・列・行・RLS・トリガー）・`is_valid_avatar_line_data()`・
-- `family_drawings`・`family_members`は1文字も変更しない。`CREATE ... IF NOT EXISTS`・
-- `CREATE OR REPLACE`・`DROP POLICY IF EXISTS`だけで構成しており、何度流しても安全
-- （既存データを1行も触らない。81.10章）。
--
-- [記述順] 関数（max_avatar_stock_per_member）→表→索引→GRANT→RLS→RPC。CHECKが
-- 参照する関数を先に作る（54章の訂正）。
--
-- [ロールバック] 新しい表と関数4つをDROPするだけで元に戻る（`member_avatars`は
-- 影響を受けない）。
--
-- [anonへのGRANT] しない（開発部CLAUDE.md「新しい表を作るときのGRANT」）。ログイン前に
-- この表を直接読ませる必要が無く、`invite-lookup`（service_role）もこの表を読んではならない。
--
-- [列名衝突の確認] 3本のRPCはRETURNS TABLEを使わずJSONB 1個を返す。本文の列参照はすべて
-- 表の別名（fm／ma／ms）付き。引数はp_始まり・変数はv_始まりで、どの表の列名とも一致しない。
-- ローカルで81.16章のV1〜V18を実行して、呼ぶたびに必ず失敗する状態でないことを確認した
-- （実装メモ334章）。
--
-- ------------------------------------------------------------
-- 81.3 DDL: 上限の定数関数・テーブル・索引・GRANT・RLS
-- ------------------------------------------------------------
-- [上限の単一定義] max_unpublished_drawings_per_member()（33b章、値3）と同じ形。
-- 統括決定「お絵かきと合わせる」を、**値の共有ではなく同じ書き方の別関数**で実現する。
-- 理由: お絵かきの3枚（ガチャの公平性）とアバターのストックの3枚（気に入った絵を
-- 取っておく）は目的が違う。将来どちらか一方だけ数を変える決定が出ても、もう一方を
-- 巻き添えにしない（54.3章がvalid関数を専用に分けたのと同じ判断）。
CREATE OR REPLACE FUNCTION public.max_avatar_stock_per_member()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 3; $$;

COMMENT ON FUNCTION public.max_avatar_stock_per_member() IS
  '2026-09-30統括決定。メンバー1人が持てる「まえのアバター」の上限枚数の単一の定義箇所（お絵かきの未公開3枚＝max_unpublished_drawings_per_member()に数を揃えた。関数は別）。保存・色にもどすのRPCは、まえのアバターがこの枚数に達しているとき、新たにストックへ入れる操作を断る（SQLSTATE AV001。自動では消さない）。アプリのトークンavatarStock.maxSlotsと必ず同じ値にすること。数を増やす変更は既存データに影響しない。減らす変更は既存の行を消さない（超過している人は、消すまで新たに入れられない）。';

-- [表] 1行＝「まえのアバター」1枚。
--   ・`id`: 主キー。**「入れ替え」のたびに新しいidで作り直す**（81.5章。二度押し・
--     別の端末からの古い操作を、idが見つからないことで自然に無効にするため）。
--   ・`member_id`: 誰の「まえのアバター」か。`member_avatars.member_id`と同じく
--     family_membersにON DELETE CASCADE。
--   ・`family_id`: RLSがfamily_membersへの結合なしにfamily_id一致で完結できるよう
--     冗長に持つ（member_avatars・family_drawingsと同じ流儀）。**書き込みは
--     RPC（SECURITY DEFINER）だけで、RPCがfamily_membersから引いた実際のfamily_idを
--     入れる。クライアントが表へ直接INSERTする経路は無い（INSERTポリシーを作らない）
--     ため、member_avatarsのようなfamily_id補正トリガーは要らない。**
--   ・`line_data`: 今の絵（member_avatars.line_data）と同じ形式・同じ検証関数。
--     検証を緩める方向にのみ変えること（54.14章(2)。締めると、取っておいた絵を
--     「これにもどす」でmember_avatarsへ戻すときのCHECKに落ちる）。
--   ・`stocked_at`: ストックに入った時刻（描いた日時ではなく、まえのアバターに
--     なった日時）。**一覧を新しい順に返すための並び順の基準**（統括決定5.）。
--     古いものを自動で消す処理は無い（統括の追加決定1.）ので、削除の基準には使わない。
--     clock_timestamp()にするのは、同じトランザクション内でも時刻が進み、
--     並び順が必ず決まるようにするため（now()はトランザクション内で固定）。
--   ・`updated_at`は持たない。行は作られるか消されるかだけで、書き換えない
--     （UPDATEポリシーも作らない。family_drawingsの「UPDATEポリシーは一切
--     定義しない」と同じ思想。入れ替えも「削除して新しいidで入れ直す」）。
--   ・**色（avatar_color）は持たない**（決定54-6の踏襲。81.11章）。
CREATE TABLE IF NOT EXISTS member_avatar_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  line_data JSONB NOT NULL,
  stocked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT chk_member_avatar_stocks_line_data CHECK (public.is_valid_avatar_line_data(line_data))
);

-- 読み出しは「あるメンバーの分を新しい順に」（画面を開いたとき）と、RPC内の
-- 「そのメンバーの枚数を数える」。どちらもこの索引1本で足りる。
-- member_idへの外部キー（ON DELETE CASCADE）のカスケード削除も、この索引が使われる。
CREATE INDEX IF NOT EXISTS idx_member_avatar_stocks_member
  ON member_avatar_stocks(member_id, stocked_at DESC);
-- 家族の削除（families → CASCADE）用。member_avatarsのidx_member_avatars_family_idと同じ。
CREATE INDEX IF NOT EXISTS idx_member_avatar_stocks_family_id
  ON member_avatar_stocks(family_id);

ALTER TABLE member_avatar_stocks ENABLE ROW LEVEL SECURITY;

-- [開発部CLAUDE.md「新しい表を作るときのGRANT」の決まり文句] anonへは付与しない。
-- INSERT/UPDATEをGRANTしていても、それを許すポリシーが1本も無いためRLSが常に拒否する
-- （default-deny。family_drawingsのUPDATE、gacha_drawsのINSERTと同じ守り方）。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_avatar_stocks TO authenticated, service_role;

-- [RLS 1/2] 読める人: 本人、または同じ家族の保護者（統括の追加決定2.）。
--   **条件式は、既存の`member_avatars_write_self_or_parent`（54.5章）と全く同じ**
--   （family_id一致 AND（保護者 OR 本人））。新しい判定ロジックは何も足さない。
--   ・`family_id = current_family_id()`が家族の分離（他家族の行は誰にも見えない）。
--   ・`member_id = current_family_member_id()`: 本人。子ども（PINログイン）・
--     保護者・みまもりのすべてで、自分の行が見える。
--   ・`is_current_user_parent()`: 保護者は同じ家族の全員（子ども・他の保護者・
--     みまもり）の分を見られる。今のアバターを保護者が全員分描き直せるのと同じ範囲。
--   ・みまもり・子どもは、他人の行が一切見えない。
--   ・退会済み（is_active=false）本人は`current_family_member_id()`がNULLを返すため
--     見えない。保護者からは、退会済みメンバーの行も見える（member_avatarsの書き込み
--     RLSがis_activeを見ないのと同じ。範囲を「同じ」にするため意図的に合わせた）。
--   ・**サブクエリを含まない**ため、前の版（子どもの分だけに絞る案）より単純で速い。
DROP POLICY IF EXISTS "member_avatar_stocks_select_scoped" ON member_avatar_stocks;
CREATE POLICY "member_avatar_stocks_select_scoped" ON member_avatar_stocks
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND (is_current_user_parent() OR member_id = current_family_member_id())
  );

-- [RLS 2/2] 消せる人: 見える人と同じ（「いらないものは消せる」＝見えるものは消せる）。
-- INSERT・UPDATEのポリシーは**意図的に作らない**。書き込みは下記のRPC（SECURITY
-- DEFINER）だけが行う。クライアントが行を偽造して件数上限を超えたり、他人の絵を
-- 自分のストックに入れたりできない構造にするため。
DROP POLICY IF EXISTS "member_avatar_stocks_delete_scoped" ON member_avatar_stocks;
CREATE POLICY "member_avatar_stocks_delete_scoped" ON member_avatar_stocks
  FOR DELETE
  USING (
    family_id = current_family_id()
    AND (is_current_user_parent() OR member_id = current_family_member_id())
  );

COMMENT ON TABLE member_avatar_stocks IS
  '2026-09-30統括決定「まえのアバター」（ストック3枚）。member_avatars（今の1枚。家族全員が読める）とは別の表にして、本人と保護者（今の絵を描き直せる範囲と同じ）だけが読めるようにした。行はRPC（save_member_avatar・restore_member_avatar_from_stock・reset_member_avatar）だけが作る。クライアントの直接INSERT/UPDATEは不可（ポリシー無し）。DELETEのみ本人・保護者が可能。3枚いっぱいのとき、保存・色にもどすはSQLSTATE AV001で断られる（自動では消さない）。色は持たない（family_members.avatar_colorが唯一の情報源）。invite-lookup等のservice_roleの読み手はこの表を読んではならない（RLSを通らないため）。';

-- ------------------------------------------------------------
-- 81.4 RPC 3本のDDL
-- ------------------------------------------------------------
-- [共通の方針]
--  ・SECURITY DEFINER＋SET search_path = public（edit_unpublished_drawing()と同じ）。
--    RLSを通らず動くので、**権限判定は関数の冒頭で自分で行う**。3本とも
--    member_avatars_write_self_or_parentと同じ「本人または保護者」（統括の追加決定2.。
--    上の2本のポリシーとも同じ範囲）。加えて対象メンバーが在籍中（is_active）であること。
--  ・**同時に押されても壊れないための直列化**: 対象メンバーの`family_members`の行を
--    `FOR NO KEY UPDATE`でロックする（先頭で1回。以降の順序は常に
--    family_members → member_avatars → member_avatar_stocks で固定＝デッドロックしない）。
--    NO KEY UPDATEは、他の表がfamily_membersを外部キーで参照するときに取る
--    FOR KEY SHAREと衝突しないため、ガチャ・完了報告など他の機能を止めない
--    （同じメンバーの表示名変更・色変更などと数ミリ秒だけ順番待ちになる）。
--  ・**満杯のときは断る（自動では消さない）**（統括の追加決定1.）。断るときのエラーは
--    **SQLSTATE `AV001`**（PostgRESTの`code`にそのまま載る。`check_violation`は
--    「絵のデータが不正」と区別できないため使わない）。メッセージに現在の枚数を含め、
--    `HINT = 'avatar_stock_full'`も付ける。アプリは`code === "AV001"`で分岐する
--    （api.tsのPG_ERRCODEに`avatarStockFull: "AV001"`を足す）。
--    断る条件は「**今の絵があり、新しい絵と違い、まえのアバターが上限枚数に達している**」
--    だけ。次のときは、満杯でも断らない: 今の絵が無い（枚数が増えない）／同じ絵の
--    再保存（何もしない）／「これにもどす」の入れ替え（枚数が変わらない）。
--  ・**戻り値はJSONB**（`{"result": "...", "stock_id": "uuid|null", "stock_count": n}`）。
--    アプリが「ストックに足された」ことを正確に知り、文言を出し分けられる（統括の追加
--    決定4.）。`result`の値は各関数のコメント参照。`stock_count`は操作後の枚数。
--    **RETURNS TABLEを使わない**（JSONB 1個を返す）ため、出力列名と本文の列名の衝突
--    （設計部CLAUDE.mdの3回踏んだ罠）は原理的に起こらない。それでも本文中の列参照は
--    すべて表の別名（fm/ma/ms）を付けて書いた。引数名はp_ 始まり、変数名はv_ 始まりで、
--    どの表の列名とも一致しない（INSERTの列リスト・UPDATEのSET句は別名を付けられない
--    構文位置だが、列名と同じ名前のplpgsql変数・引数が無いため衝突しない）。
--  ・呼ぶたびに必ず失敗する型のバグ（column reference is ambiguous）が無いことを、
--    提出前に「出力列名と同じ名前を本文で無修飾参照していないか」の観点で確認した:
--    出力列なし＝該当なし。開発部は81.16章の手順でローカル実行して確認すること。

-- --- 保存する（今の絵をまえのアバターに移し、新しい絵を今の絵にする） ---
-- p_member_id: 描く対象（自分、または保護者が代理で描く相手）。
-- 戻り値（JSONB）:
--   {"result": "created",   "stock_id": null, "stock_count": n}
--       初めて描いた（今の絵が無かった）。ストックには何も足していない。
--   {"result": "unchanged", "stock_id": null, "stock_count": n}
--       今の絵と同じ絵だった。何もしていない（満杯でも断らない）。
--   {"result": "stocked",   "stock_id": "<新しい行のid>", "stock_count": n}
--       今の絵をまえのアバターに足して、新しい絵を今の絵にした。
--   満杯（今の絵があり、新しい絵と違い、まえのアバターが上限に達している）のときは
--   結果を返さず、SQLSTATE AV001で失敗する（今の絵・ストックとも変化なし）。
CREATE OR REPLACE FUNCTION public.save_member_avatar(
  p_member_id UUID,
  p_line_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := public.current_family_member_id();
  v_family_id UUID := public.current_family_id();
  v_target_active BOOLEAN;
  v_old_line_data JSONB;
  v_stock_count INT;
  v_new_stock_id UUID;
BEGIN
  IF v_caller_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 権限（member_avatars_write_self_or_parentと同じ）。ロックを取る前に弾く。
  IF p_member_id IS DISTINCT FROM v_caller_id
     AND NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'この操作はできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 形式・上限の検証も、ロックの前に弾く（member_avatarsのCHECKが二重に効く）。
  IF NOT public.is_valid_avatar_line_data(p_line_data) THEN
    RAISE EXCEPTION 'うまく保存できませんでした。もう一度描いてみてください' USING ERRCODE = 'check_violation';
  END IF;

  -- 対象が自分の家族の在籍メンバーであることの確認＋同時操作の直列化（行ロック）。
  SELECT fm.is_active INTO v_target_active
  FROM family_members fm
  WHERE fm.id = p_member_id AND fm.family_id = v_family_id
  FOR NO KEY UPDATE OF fm;

  IF NOT FOUND OR NOT v_target_active THEN
    RAISE EXCEPTION '対象のメンバーが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 現在の枚数（このメンバーの行ロックを持っているので、他の操作で増減しない）。
  SELECT count(*)::INT INTO v_stock_count
  FROM member_avatar_stocks ms
  WHERE ms.member_id = p_member_id;

  SELECT ma.line_data INTO v_old_line_data
  FROM member_avatars ma
  WHERE ma.member_id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- 初めて描く（今の絵が無い＝色の状態）。ストックするものが無い（満杯でも通す）。
    INSERT INTO member_avatars (member_id, family_id, line_data)
    VALUES (p_member_id, v_family_id, p_line_data);
    RETURN jsonb_build_object('result', 'created', 'stock_id', NULL::UUID, 'stock_count', v_stock_count);
  END IF;

  IF v_old_line_data = p_line_data THEN
    -- 「なおす」画面で何も変えずに保存した場合など。同じ絵をストックに積まない
    -- （3枚が同じ絵で埋まるのを防ぐ。統括の追加決定3.）。JSONBの=はキーの順序に
    -- 影響されない。満杯でも断らない（何も足さないため）。
    RETURN jsonb_build_object('result', 'unchanged', 'stock_id', NULL::UUID, 'stock_count', v_stock_count);
  END IF;

  -- 満杯なら断る（統括の追加決定1.。自動では消さない。今の絵・ストックは変えない）。
  IF v_stock_count >= public.max_avatar_stock_per_member() THEN
    RAISE EXCEPTION 'まえのアバターがいっぱいです（%枚）。いらない絵を消してから保存してください', v_stock_count
      USING ERRCODE = 'AV001', HINT = 'avatar_stock_full';
  END IF;

  -- 今の絵をまえのアバターへ移す。
  INSERT INTO member_avatar_stocks AS ms (member_id, family_id, line_data)
  VALUES (p_member_id, v_family_id, v_old_line_data)
  RETURNING ms.id INTO v_new_stock_id;

  -- 新しい絵を今の絵にする。updated_at・family_idの補正はmember_avatarsの既存
  -- トリガー（set_updated_at・member_avatars_before_write）がそのまま働く。
  UPDATE member_avatars ma
  SET line_data = p_line_data
  WHERE ma.member_id = p_member_id;

  RETURN jsonb_build_object('result', 'stocked', 'stock_id', v_new_stock_id, 'stock_count', v_stock_count + 1);
END;
$$;

COMMENT ON FUNCTION public.save_member_avatar(UUID, JSONB) IS
  '2026-09-30統括決定「まえのアバター」。アバターの保存（新規・描き直しの両方）を1トランザクションで行う。今の絵があり新しい絵と違えば、今の絵をmember_avatar_stocksへ足してから新しい絵を今の絵にする。まえのアバターが上限（max_avatar_stock_per_member()＝3）に達しているときは、SQLSTATE AV001で断る（自動では消さない。統括の追加決定）。初めて描くとき・同じ絵の再保存はストックに足さない（満杯でも断らない）。権限は本人または保護者（member_avatars_write_self_or_parentと同じ）。対象メンバーのfamily_members行を FOR NO KEY UPDATE でロックして同時操作を直列化する。戻り値はJSONB {result: created|unchanged|stocked, stock_id, stock_count}。';

-- --- これにもどす（まえのアバターと今の絵を入れ替える） ---
-- p_stock_id: 戻したい「まえのアバター」の行id。対象メンバーはこの行から決まる
--   （クライアントに別途member_idを指定させない＝食い違いの余地が無い）。
-- 戻り値（JSONB）:
--   {"result": "swapped",  "stock_id": "<新しい行のid>", "stock_count": n}
--       入れ替えた。今までの絵が新しいidでまえのアバターに入った。枚数は変わらない
--       （満杯でも使える。統括の追加決定1.）。
--   {"result": "restored", "stock_id": null, "stock_count": n}
--       今の絵が無かった（色の状態だった）ので、まえのアバターが今の絵になった。
--       ストックは1枚減る。
CREATE OR REPLACE FUNCTION public.restore_member_avatar_from_stock(
  p_stock_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := public.current_family_member_id();
  v_family_id UUID := public.current_family_id();
  v_member_id UUID;
  v_target_active BOOLEAN;
  v_stock_line_data JSONB;
  v_current_line_data JSONB;
  v_has_current BOOLEAN;
  v_stock_count INT;
  v_new_stock_id UUID;
BEGIN
  IF v_caller_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 手順1: ロックを取る前に、どのメンバーの行かだけを引く（ロック対象を決めるため）。
  SELECT ms.member_id INTO v_member_id
  FROM member_avatar_stocks ms
  WHERE ms.id = p_stock_id AND ms.family_id = v_family_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'まえのアバターが見つかりません（すでに使われたか、消された可能性があります）' USING ERRCODE = 'no_data_found';
  END IF;

  -- 手順2: メンバーの行をロックしつつ、在籍を取る（保存・色にもどすと同じ
  -- ロックなので、同じメンバーへの操作は1つずつ順番に実行される）。
  SELECT fm.is_active INTO v_target_active
  FROM family_members fm
  WHERE fm.id = v_member_id AND fm.family_id = v_family_id
  FOR NO KEY UPDATE OF fm;

  IF NOT FOUND OR NOT v_target_active THEN
    RAISE EXCEPTION 'まえのアバターが見つかりません（すでに使われたか、消された可能性があります）' USING ERRCODE = 'no_data_found';
  END IF;

  -- 手順3: 権限（member_avatar_stocks_select_scopedと同じ条件＝本人または保護者。
  -- 統括の追加決定2.）。見えない行は「存在しない」と同じメッセージにして、他人の
  -- ストックの有無を漏らさない（decorate_tree_with_gacha_prize()・
  -- edit_unpublished_drawing()と同じ考え方）。
  IF v_member_id IS DISTINCT FROM v_caller_id
     AND NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'まえのアバターが見つかりません（すでに使われたか、消された可能性があります）' USING ERRCODE = 'no_data_found';
  END IF;

  -- 手順4: ロックを取ったあとにもう一度、行が存在するか確かめて行ロックする。
  -- 手順1〜2の間に、別の操作（別の端末での「これにもどす」・削除）が先に完了して
  -- いればここで見つからない。**二度押しした2回目・別の端末からの古い操作は、
  -- ここで必ず「見つかりません」になり、入れ替えが二重に起きて元に戻ってしまう
  -- ことがない**（入れ替えのたびに行のidが変わるため）。
  SELECT ms.line_data INTO v_stock_line_data
  FROM member_avatar_stocks ms
  WHERE ms.id = p_stock_id AND ms.member_id = v_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'まえのアバターが見つかりません（すでに使われたか、消された可能性があります）' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT ma.line_data INTO v_current_line_data
  FROM member_avatars ma
  WHERE ma.member_id = v_member_id
  FOR UPDATE;
  v_has_current := FOUND;

  -- 現在の枚数（戻す行を含む。行ロックを持っているので他の操作で増減しない）。
  SELECT count(*)::INT INTO v_stock_count
  FROM member_avatar_stocks ms
  WHERE ms.member_id = v_member_id;

  -- 戻す側の行は消す（idは使い捨て）。
  DELETE FROM member_avatar_stocks ms WHERE ms.id = p_stock_id;

  IF v_has_current THEN
    -- 入れ替え: 今の絵が、新しいidで、いちばん新しい「まえのアバター」になる。
    -- 枚数は増減しない（1枚消して1枚入れる）ため、満杯でも通り、上限の確認も要らない。
    INSERT INTO member_avatar_stocks AS ms (member_id, family_id, line_data)
    VALUES (v_member_id, v_family_id, v_current_line_data)
    RETURNING ms.id INTO v_new_stock_id;

    UPDATE member_avatars ma
    SET line_data = v_stock_line_data
    WHERE ma.member_id = v_member_id;

    RETURN jsonb_build_object('result', 'swapped', 'stock_id', v_new_stock_id, 'stock_count', v_stock_count);
  END IF;

  -- 今は色の状態（絵が無い）。ストックの絵をそのまま今の絵にする（ストックは1枚減る）。
  INSERT INTO member_avatars (member_id, family_id, line_data)
  VALUES (v_member_id, v_family_id, v_stock_line_data);

  RETURN jsonb_build_object('result', 'restored', 'stock_id', NULL::UUID, 'stock_count', v_stock_count - 1);
END;
$$;

COMMENT ON FUNCTION public.restore_member_avatar_from_stock(UUID) IS
  '2026-09-30統括決定「まえのアバター」。「これにもどす」。指定したまえのアバターと今の絵を入れ替える（今の絵が新しいidでまえのアバターに入る。枚数は変わらないので満杯でも使える）。今の絵が無い（色の状態）ときは、まえのアバターが今の絵になりストックが1枚減る。権限は本人または保護者（member_avatars_write_self_or_parentと同じ範囲）。見えない行・存在しない行・二度押しの2回目・他端末で先に処理された古いidは、すべて同じno_data_foundになる（入れ替えが二重に起きない）。1トランザクションで、失敗すれば今の絵は変わらない。戻り値はJSONB {result: swapped|restored, stock_id, stock_count}。';

-- --- 色にもどす（今の絵をまえのアバターに入れてから外す） ---
-- 統括の追加決定1.: 「色にもどす」も、今の絵をまえのアバターに入れる動きにする。
--   満杯のときは保存と同じく断る（SQLSTATE AV001）。**前版の`p_keep_in_stock`引数は
--   廃止した**（常にストックに入れる）。その結果、「今の絵を、何も残さずに消す」操作は
--   なくなる。残したくない絵は、色にもどしたあとで、まえのアバターから消せばよい
--   （満杯のときは、先にまえのアバターを1枚消して空きを作る）。
-- 戻り値（JSONB）:
--   {"result": "stocked", "stock_id": "<新しい行のid>", "stock_count": n}
--       今の絵をまえのアバターに足して、今の絵を外した（色の状態になった）。
--   {"result": "nothing", "stock_id": null, "stock_count": n}
--       今の絵が無かった。何もしていない（エラーにならない＝べき等。満杯でも断らない）。
CREATE OR REPLACE FUNCTION public.reset_member_avatar(
  p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := public.current_family_member_id();
  v_family_id UUID := public.current_family_id();
  v_target_active BOOLEAN;
  v_old_line_data JSONB;
  v_stock_count INT;
  v_new_stock_id UUID;
BEGIN
  IF v_caller_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_member_id IS DISTINCT FROM v_caller_id
     AND NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'この操作はできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT fm.is_active INTO v_target_active
  FROM family_members fm
  WHERE fm.id = p_member_id AND fm.family_id = v_family_id
  FOR NO KEY UPDATE OF fm;

  IF NOT FOUND OR NOT v_target_active THEN
    RAISE EXCEPTION '対象のメンバーが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*)::INT INTO v_stock_count
  FROM member_avatar_stocks ms
  WHERE ms.member_id = p_member_id;

  SELECT ma.line_data INTO v_old_line_data
  FROM member_avatars ma
  WHERE ma.member_id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- すでに色の状態。何もしない（べき等。満杯でも断らない）。
    RETURN jsonb_build_object('result', 'nothing', 'stock_id', NULL::UUID, 'stock_count', v_stock_count);
  END IF;

  -- 満杯なら断る（保存と同じ。統括の追加決定1.。今の絵・ストックは変えない）。
  IF v_stock_count >= public.max_avatar_stock_per_member() THEN
    RAISE EXCEPTION 'まえのアバターがいっぱいです（%枚）。いらない絵を消してから色にもどしてください', v_stock_count
      USING ERRCODE = 'AV001', HINT = 'avatar_stock_full';
  END IF;

  INSERT INTO member_avatar_stocks AS ms (member_id, family_id, line_data)
  VALUES (p_member_id, v_family_id, v_old_line_data)
  RETURNING ms.id INTO v_new_stock_id;

  DELETE FROM member_avatars ma WHERE ma.member_id = p_member_id;

  RETURN jsonb_build_object('result', 'stocked', 'stock_id', v_new_stock_id, 'stock_count', v_stock_count + 1);
END;
$$;

COMMENT ON FUNCTION public.reset_member_avatar(UUID) IS
  '2026-09-30統括決定「まえのアバター」。「色にもどす」（今の絵を外して色丸＋頭文字の表示に戻す）。今の絵をまえのアバターに入れてから外す。まえのアバターが上限（3枚）に達しているときは、保存と同じくSQLSTATE AV001で断る（統括の追加決定）。今の絵が無ければ何もせずresult=nothingを返す（べき等）。権限は本人または保護者。1トランザクション。戻り値はJSONB {result: stocked|nothing, stock_id, stock_count}。';

-- [EXECUTE権限] edit_unpublished_drawing()（38.5章）と同じ扱い。33g章の教訓
-- （PUBLICへのREVOKEだけではSupabaseが直接付与するanonのEXECUTEは消えない）を
-- 踏まえ、anonも明示的にREVOKEする。子どものPINログインのJWTもroleは'authenticated'
-- のため、authenticatedへのGRANTで子どもも呼べる（権限は関数内で判定）。
REVOKE ALL ON FUNCTION public.save_member_avatar(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_member_avatar(UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.restore_member_avatar_from_stock(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_member_avatar_from_stock(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_member_avatar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_member_avatar(UUID) TO authenticated;
