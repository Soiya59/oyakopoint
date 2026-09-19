-- 絵柄の名前を子ども向けにひらがなで出す（統括決定2026-09-20・やること.md 4-60②、
-- 設計部/成果物/スキーマ設計.sql 60章のDDLをそのまま写したもの、API仕様.md 17.10節、
-- 主要画面ワイヤーフレーム.md 49-B.15章、開発部/成果物/実装メモ.md 261章）。
--
-- [列の追加のみ・破壊的操作ではない] 新規列はNULL許容（書き忘れても壊れないことが
-- 依頼文の要件）。既存の`kind_display_name`（漢字・大人向け）は無変更。
-- クライアント側フォールバック（`kind_display_name_child ?? kind_display_name`）を
-- 前提とするため、この列を埋め忘れても子ども画面に一時的に漢字が出るだけで
-- エラーにはならない（60.1章決定60-3）。
--
-- [本部長指示によりDB接続は行わない・マイグレーション作成のみ]
-- ローカル検証（`npx supabase db reset`等）は開発部の担当範囲。本番適用
-- （`npx supabase db push`）は行わない。

-- ------------------------------------------------------------
-- 60.1 列の追加（DDL）
-- ------------------------------------------------------------
ALTER TABLE habit_figure_catalog
  ADD COLUMN IF NOT EXISTS kind_display_name_child TEXT NULL
    CHECK (
      kind_display_name_child IS NULL
      OR char_length(trim(kind_display_name_child)) BETWEEN 1 AND 50
    );

COMMENT ON COLUMN habit_figure_catalog.kind_display_name_child IS
  '2026-09-20新設（スキーマ設計.sql 60章）。子ども向け画面で使う、絵柄の種類名のひらがな表記（例:「ドラゴンの シールちょう」）。NULL許容＝未入力を許す（60.1章の理由）。NULLの場合、読み出し側（クライアント）は既存のkind_display_name（漢字、大人向け）にフォールバックすること。大人・みまもり向けの表示は引き続きkind_display_nameを使い、この列は一切参照しない。';

-- ------------------------------------------------------------
-- 60.2 既存3種類への値の投入
-- ------------------------------------------------------------
UPDATE habit_figure_catalog SET kind_display_name_child = 'ドラゴンの シールちょう' WHERE kind_key = 'dragon';
UPDATE habit_figure_catalog SET kind_display_name_child = 'うさぎの シールちょう'   WHERE kind_key = 'rabbit';
UPDATE habit_figure_catalog SET kind_display_name_child = 'ほしの せいれいの シールちょう' WHERE kind_key = 'spirit';
