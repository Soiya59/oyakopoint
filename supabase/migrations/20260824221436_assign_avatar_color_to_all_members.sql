-- 開発部/成果物/実装メモ.md 69章、設計部/成果物/スキーマ設計.sql 33章。
--
-- 背景（本部長がユーザーの実機指摘から発見）:
-- 家族の木の色丸と、その下の内訳リストのアバターで同じ人の色が食い違っていた。
-- 調査の結果、根本原因は表示側ではなくデータ側にあった。
--
-- `family_members.avatar_color` を設定しているのは子どもプロフィール作成
-- （src/data/api.ts createChildProfile）だけであり、保護者・みまもりメンバーを
-- 作成する3つの経路——create_family_with_owner（家族作成時のオーナー）、
-- join_family_with_invite_code（招待コードでの保護者参加）、
-- accept_family_invite（みまもりメンバーの承認）——はいずれも avatar_color に
-- 一切触れていなかった。このため**全ての家族で、保護者とみまもりメンバーは
-- 例外なく色なし(NULL)**になっていた。
-- 07-10章「色分けによる個人の可視化」は全員に色がある前提の機能だが、
-- 3ロールのうち2ロールには色が付く経路がそもそも存在しなかった。
--
-- 対応: 表示側でのフォールバック（表示箇所ごとに実装が必要で漏れやすい）ではなく、
-- データ側を正す。以後どの画面でも自動的に一致し、将来「自分の色を選ぶ」機能を
-- 追加する際の土台にもなる。

-- ------------------------------------------------------------
-- 1. 色の割り当て関数
-- ------------------------------------------------------------
-- デザイントークン.md 1.3節のメンバーカラーパレット8色。クライアント側の
-- src/theme/theme.ts memberColorPalette と同じ並び・同じ値で保つこと。
-- 同じ家族内で色が重複しないよう、まだ使われていない色を先頭から選ぶ。
-- 8色を使い切った家族では、メンバー数による循環で割り当てる（重複を許容する）。
CREATE OR REPLACE FUNCTION public.next_member_avatar_color(p_family_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_palette TEXT[] := ARRAY[
    '#A8D5BA', -- ミントグリーン
    '#FFE5B4', -- ピーチ
    '#B4D4FF', -- スカイブルー
    '#FFC1CC', -- ピンク
    '#D9C2FF', -- ラベンダー
    '#FFF3B0', -- レモン
    '#FFAFA3', -- コーラル
    '#C2F0E8'  -- アクアミント
  ];
  v_color TEXT;
  v_count INT;
BEGIN
  FOREACH v_color IN ARRAY v_palette LOOP
    IF NOT EXISTS (
      SELECT 1 FROM family_members
      WHERE family_id = p_family_id AND avatar_color = v_color
    ) THEN
      RETURN v_color;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count FROM family_members WHERE family_id = p_family_id;
  RETURN v_palette[(v_count % array_length(v_palette, 1)) + 1];
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_member_avatar_color(UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.next_member_avatar_color(UUID) IS
  '同じ家族内で重複しないメンバーカラーを1色返す。8色（デザイントークン.md 1.3節）を使い切った場合のみ重複を許容して循環割り当てする。';

-- ------------------------------------------------------------
-- 2. メンバー作成時に色を割り当てる（3つのRPCすべて）
-- ------------------------------------------------------------
-- 既存のガード（27章の`AND is_active`など）は変更せず、INSERT時の
-- avatar_color 指定のみを追加する。

CREATE OR REPLACE FUNCTION public.create_family_with_owner(p_family_name TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO families (name) VALUES (p_family_name) RETURNING id INTO v_family_id;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner, avatar_color)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), true, public.next_member_avatar_color(v_family_id));

  RETURN v_family_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_family_with_invite_code(p_invite_code TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  SELECT id INTO v_family_id FROM families WHERE invite_code = upper(p_invite_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION '招待コードが無効です' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner, avatar_color)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), false, public.next_member_avatar_color(v_family_id));

  RETURN v_family_id;
END;
$$;

-- accept_family_invite（みまもりメンバーの承認）は本文が長いため、
-- family_membersへのINSERT部分のみを差し替える形で再定義する。
-- 25b章・27章・28章の内容は維持したうえで avatar_color の指定を追加している。
DO $$
DECLARE
  v_src TEXT;
  v_new TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE proname = 'accept_family_invite' AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'accept_family_invite が見つかりません';
  END IF;

  IF v_src ILIKE '%avatar_color%' THEN
    RAISE NOTICE 'accept_family_invite は既に avatar_color を設定済みのため変更しません';
    RETURN;
  END IF;

  -- 列リストとVALUESの両方に avatar_color を追記する。
  -- 既存実装（本マイグレーション作成時点で pg_proc から実物を確認済み）は
  --   INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  --   VALUES (v_invite.family_id, p_display_name, v_invite.role, auth.uid(), false)
  -- の形。想定と異なっていたら黙って素通しせず明示的にエラーにする。
  v_new := replace(
    v_src,
    'INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)',
    'INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner, avatar_color)'
  );
  IF v_new = v_src THEN
    RAISE EXCEPTION 'accept_family_invite のINSERT列リストが想定と異なるため自動置換できませんでした。手動で avatar_color の指定を追加してください';
  END IF;

  v_src := v_new;
  v_new := replace(
    v_src,
    'VALUES (v_invite.family_id, p_display_name, v_invite.role, auth.uid(), false)',
    'VALUES (v_invite.family_id, p_display_name, v_invite.role, auth.uid(), false, public.next_member_avatar_color(v_invite.family_id))'
  );
  IF v_new = v_src THEN
    RAISE EXCEPTION 'accept_family_invite のVALUES句が想定と異なるため自動置換できませんでした。手動で avatar_color の指定を追加してください';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.accept_family_invite(p_token TEXT, p_display_name TEXT) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    v_new
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. 既存メンバーへの色の補充（1回限りの追加のみの更新）
-- ------------------------------------------------------------
-- ---- 破壊的操作についての注記 ----
-- 本ブロックは既存行のUPDATEを行うが、対象は avatar_color IS NULL の行に
-- 限定しており、既に色が入っている行（子どもプロフィール経由で作成された
-- メンバー）は一切上書きしない。値の消去・置換ではなく欠損の補充のみ。
-- 退会済み(is_active=false)のメンバーも対象に含める。過去の完了報告は
-- 家族の木に色丸として表示され続けるため、色が無いとそこだけグレーで残るため。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, family_id FROM family_members
    WHERE avatar_color IS NULL
    ORDER BY family_id, created_at
  LOOP
    UPDATE family_members
    SET avatar_color = public.next_member_avatar_color(r.family_id)
    WHERE id = r.id;
  END LOOP;
END;
$$;
