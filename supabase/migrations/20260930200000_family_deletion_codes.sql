-- ============================================================
-- 家族を削除するための確認コード（family_deletion_codes、新設・2026-09-27）
-- 参照:
--   - 要件定義書.md 07-42章
--   - 設計部/成果物/スキーマ設計.sql 80.2章（本ファイルはそのDDLをそのまま適用する）
--   - 開発部/成果物/実装メモ.md 311章
--
-- [破壊的操作ではない] 新しいテーブルを1つ追加するのみで、既存データへの
-- 変更は無い。
--
-- [設計方針] family_member_pins（子どものPIN、initial_schema.sql）と
-- 意図的に同じ形にする。理由は既に何度もレビュー・実装・運用してきた
-- 枯れたパターンをそのまま流用し、新規の設計ミスの余地を最小化するため
-- （スキーマ設計.sql 80.2章）。
--
-- [なぜfamily_id列を持たないか] 検証する2つの呼び出し元
-- （remove-member・delete-account）は、いずれもクライアントから受け取った
-- member_idを一切信用せず、JWTから解決した「呼び出し本人のmember_id」だけを
-- 使って検証するため、本テーブル側にfamily_idを重複して持たせる必要が無い。
--
-- [なぜmember_idを主キーにするか] family_member_pinsと同じ理由。1人の
-- 保護者が同時に有効なコードを2つ持つ意味が無いため、新しいコードを
-- 発行するたびにUPSERTで上書きする（前のコードは自動的に無効化される）。
-- ============================================================

CREATE TABLE IF NOT EXISTS family_deletion_codes (
  member_id UUID PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- is_owner=trueであることの検証はサブクエリを使うCHECK制約では書けない
  -- ため（family_member_pinsのrole='child'検証と同じ制約）、下記トリガーで
  -- 担保する。
);

-- [トリガーの意図] このテーブルへ書き込めるのはservice_role（Edge
-- Function経由）だけだが、「service_roleなら何を書き込んでもよい」という
-- 前提には立たない設計にする（family_member_pinsのrole='child'検証・
-- chore_nfc_tags_before_write()等、このプロジェクト全体の一貫した方針。
-- Edge Function側の実装ミスで、オーナーでない保護者や子どもにコードを
-- 発行してしまっても、DB側がもう一段止める）。
CREATE OR REPLACE FUNCTION public.family_deletion_codes_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_is_owner BOOLEAN;
  v_is_active BOOLEAN;
BEGIN
  SELECT fm.role, fm.is_owner, fm.is_active
    INTO v_role, v_is_owner, v_is_active
  FROM family_members fm
  WHERE fm.id = NEW.member_id;

  IF v_role IS DISTINCT FROM 'parent' OR v_is_owner IS NOT TRUE OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION '家族削除の確認コードは在籍中のオーナーにのみ発行できます'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_deletion_codes_before_write ON family_deletion_codes;
CREATE TRIGGER trg_family_deletion_codes_before_write
  BEFORE INSERT OR UPDATE ON family_deletion_codes
  FOR EACH ROW EXECUTE FUNCTION public.family_deletion_codes_before_write();

ALTER TABLE family_deletion_codes ENABLE ROW LEVEL SECURITY;
-- ポリシーを一切作らない = authenticated/anonからは常に空集合
-- （family_member_pinsと同じdefault-denyパターン）。service_roleはRLSを
-- バイパスする。

-- [開発部CLAUDE.md「新しい表を作るときのGRANT」] 2026年10月30日以降、
-- GRANTの無い新しい表はData API（PostgREST）から権限エラーになる。RLSに
-- ポリシーが無いため実質的な読み書きは引き続きservice_roleのみに限られる
-- （このGRANTはRLSを緩めるものではない）。anonへは付与しない（未ログインで
-- この表に触れる理由が無いため）。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_deletion_codes TO authenticated, service_role;
