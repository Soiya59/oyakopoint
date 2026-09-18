-- ============================================================
-- habit_cards_before_write() のエラー文言だけ「台紙」→「シール帳」に直す
-- （統括指示「台帳でなく、シール帳にしてね」・開発部/成果物/実装メモ.md 251章の
-- 残り、本部長の差し戻し・2026-09-18）
--
-- 【経緯】
-- 20260926010000_habit_figure_spirit_and_rename.sql で habit_figure_catalog の
-- kind_display_name（「◯◯台紙」→「◯◯のシール帳」）は直したが、アプリ画面の
-- 文言は251章で別途直した。ただし habit_cards_before_write() が
-- RAISE EXCEPTION で返す上限メッセージ（DB側の文言）だけは対象外にしていたため
-- 「台紙」表記のまま残っていた。通常はクライアント側の事前チェック
-- （app/parent/chore-edit.tsx・app/supporter/chore-edit.tsxのHABIT_CARD_LIMIT_MESSAGE、
-- 251章で「シール帳は同時に3さつまでです…」に直し済み）で先に弾かれるため、この
-- DB側の文言が実際に画面に出ることは稀だが、複数端末からの同時操作等でDBまで
-- 到達すると、そこだけ旧表記「台紙」が出て統一が崩れる。本マイグレーションで
-- そのメッセージ文言だけを直す。
--
-- 【変更範囲】
-- 20260925010000_habit_cards_and_figures.sql の habit_cards_before_write() を
-- そのまま複写し、RAISE EXCEPTION の文言1箇所だけを書き換えた
-- （app/parent/chore-edit.tsx の HABIT_CARD_LIMIT_MESSAGE と一字一句同じにする）。
-- それ以外のロジック（家族整合性の検証・上限3枚のカウント・ERRCODE等）は
-- 一切変更していない。トリガー（trg_habit_cards_before_write）の再作成も不要
-- （関数の中身を差し替えるだけで、既存のトリガーはそのまま新しい定義を使う）。
--
-- 【非破壊性】
-- CREATE OR REPLACE FUNCTION のみ。テーブル定義・データ・権限には一切触れない。
-- 適用は本部長が次のビルドと同じタイミングで別途行う（本マイグレーションは
-- ファイルを追加するのみで、npx supabase db push はこの作業では実行しない）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.habit_cards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chores c WHERE c.id = NEW.chore_id AND c.family_id = NEW.family_id
  ) THEN
    RAISE EXCEPTION 'chore_idは同じ家族のクエストである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM family_members fm WHERE fm.id = NEW.member_id AND fm.family_id = NEW.family_id
  ) THEN
    RAISE EXCEPTION 'member_idは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.status = 'active' THEN
    SELECT count(*) INTO v_active_count
    FROM habit_cards
    WHERE member_id = NEW.member_id AND status = 'active';

    IF v_active_count >= 3 THEN
      RAISE EXCEPTION 'シール帳は同時に3さつまでです。今のシール帳をどれか「おわりにする」と、新しいシール帳を始められます' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
