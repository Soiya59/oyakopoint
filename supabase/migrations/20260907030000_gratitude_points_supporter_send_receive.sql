-- ============================================================
-- 感謝ポイント: みまもりメンバーを送受信対象に含める
-- （gratitude_points_insert_self ポリシーの改訂）
-- ============================================================
-- 参照:
--   設計部/成果物/スキーマ設計.sql 48章（48.1〜48.12。本部長採点100点）
--   設計部/成果物/API仕様.md 7a章・8.2章・11章
--   企画部/成果物/要件定義書.md 05章・07-7章・07-14章
--   開発部/成果物/実装メモ.md 141章（本マイグレーション対応章）
--
-- [概要] `gratitude_points_insert_self`ポリシー（24章が追加した「送信者・受信者が
-- role='supporter'であってはならない」という2条件）を撤回し、13章時点の条件
-- （家族一致・送信者本人一致のみ）に戻す。結果としてみまもりメンバーも感謝ポイント
-- の送信者・受信者いずれにもなれる（みまもり同士の送受信も含む）。
--
-- [破壊性の評価・非破壊的と判断した理由]
--   - DROP POLICY IF EXISTS → CREATE POLICY で同名ポリシーを置き換えるのみ。
--     テーブル定義・列・データは一切変更しない。
--   - 条件を「緩める」方向の変更（拒否条件2つの削除）のみであり、既存データ
--     （本番で累計5件程度の既存gratitude_points行）はいずれも新しいWITH CHECKを
--     引き続き満たす（既存行は挿入時点で家族一致・送信者本人一致を満たしていた
--     ため、遡って無効になる既存行は無い。UPDATEは対象外＝取消時のRLSは
--     `gratitude_points_update_revoke_by_sender`という別ポリジーで本マイグレーション
--     の対象外）。
--   - 日次原資（`gratitude_daily_allowance()`/`gratitude_points_daily_used()`）・
--     `member_points`Viewの合算ロジックはroleを一切参照しない実装のため、本マイグ
--     レーションに伴う追加のスキーマ変更は無い（スキーマ設計.sql 48.3章・48.4章で
--     確認済み）。
--   - 自己贈呈禁止（`chk_gratitude_no_self_gift`）・家族またぎ禁止
--     （`gratitude_points_before_insert()`の家族一致チェック）はいずれも無変更。
--
-- [関数シグネチャへの影響] 無し。本ファイルはテーブルのRLSポリシー（関数ではない）
-- のみを対象とする。DROP対象・CREATE対象とも同名`gratitude_points_insert_self`の
-- FOR INSERTポリシーであり、引数を持つ関数のDROP/CREATEではない。
--
-- [本番適用について] 本マイグレーションはローカルDocker（`npx supabase start`）での
-- 動作確認・RLS照査スイート実測のみに使う。本番への適用は本部長が行う
-- （開発部CLAUDE.mdの指示どおり、開発部は作成のみでデプロイしない）。

DROP POLICY IF EXISTS "gratitude_points_insert_self" ON gratitude_points;
CREATE POLICY "gratitude_points_insert_self" ON gratitude_points
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND sender_id = current_family_member_id()
  );
