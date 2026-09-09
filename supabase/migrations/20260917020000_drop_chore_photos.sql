-- ============================================================
-- 証拠写真機能の残骸を撤去する: chore_completions.photo_url 列と
-- chore-photos Storageバケット（RLSポリシー込み）を削除する
-- ============================================================
-- 参照:
--   やること.md 5-4「証拠写真の残骸をどうするか」。
--   開発部/成果物/実装メモ.md 180章。
--   宣伝部が作成したプライバシーポリシー（179章でHTML化）2章の注記レビュー中に
--   統括から「画像ファイルについて言及する必要があるのか」との指摘があり、
--   本部長が「残骸を説明で埋め合わせるより、残骸そのものを消すほうが筋が通る」
--   と判断（2026-09-09・統括承認済み）。
--
-- [経緯] 証拠写真機能は2026-08-24に廃止が決定され、2026-08-29に書き込み経路
-- （クライアントからのアップロード・INSERTペイロードへのphoto_url同梱）を撤去した
-- （設計部/成果物/API仕様.md 249行目・259行目）。ただしAPI仕様.md 259行目は
-- 「`chore_completions.photo_url` 列とStorageバケット `chore-photos` は
-- **残している**。列を落とすのは不可逆であり、廃止の目的（新たに写真を集めない）は
-- 書き込み経路を断つだけで達成できるため」という明示的な理由付きの決定として
-- 列を残す判断を記録していた。本マイグレーションはこの2026-08-29時点の決定を、
-- 2026-09-09の統括承認により変更するものである（決定そのものの当否ではなく、
-- 判断材料〈読み手であるプライバシーポリシー利用者に実装の内情を説明する形の
-- 注記が不安を与える〉が新たに生じたことによる方針転換）。
--
-- [対象範囲外・報告のみ] 設計部/成果物/認証・データ管理設計書.md 182・209・222・
-- 238・380行目、設計部/成果物/スキーマ設計.sql 11章・782行目にも証拠写真機能を
-- 前提にした記述（90日自動削除ルールの説明、Storage削除の記載等）が残っている。
-- 設計部の文書の修正は本部長が判断するため、本マイグレーションでは変更しない
-- （開発部/成果物/実装メモ.md 180章に指摘として記録済み）。
--
-- [本番での実測（本部長・2026-09-09）] chore_completions 132行中
-- photo_url IS NOT NULL は0件、storage.objects の bucket_id = 'chore-photos' も
-- 0件、chore-photosバケットは存在するが空。失うデータは無い。ただし適用の瞬間に
-- 実際に0件であることを機械的に再確認するガードを以下に入れる。
-- ============================================================

-- ------------------------------------------------------------
-- ガード1: chore_completions.photo_url が1件でもNOT NULLなら中止する。
-- ------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM chore_completions WHERE photo_url IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'chore_completions.photo_url に % 件のNOT NULLな行が残っています。想定（0件）と異なるため中断します。', v_count;
  END IF;
END $$;

-- ------------------------------------------------------------
-- ガード2: storage.objects の bucket_id = 'chore-photos' が1件でもあれば中止する。
-- ------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM storage.objects WHERE bucket_id = 'chore-photos';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'storage.objects（bucket_id = chore-photos）に % 件の行が残っています。想定（0件）と異なるため中断します。', v_count;
  END IF;
END $$;

-- ガード3: 想定外にバケット自体が既に存在しない場合も、状態が想定と異なるため
-- 気付けるように明示的に確認する（無ければ以降のDELETEはno-opになり気付けない）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chore-photos') THEN
    RAISE EXCEPTION 'storage.buckets に chore-photos が見つかりません。想定と異なる状態のため中断します。';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. Storage: chore-photosバケットに紐づくRLSポリシーを削除する
--    （20260815105323_chore_photos_storage_bucket.sqlで作成した2本）。
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_photos_insert_own_family" ON storage.objects;
DROP POLICY IF EXISTS "chore_photos_select_own_family" ON storage.objects;

-- ------------------------------------------------------------
-- 2. Storage: chore-photosバケット本体を削除する。
--    storage.objects/storage.bucketsへの直接DELETEはSupabase標準の
--    protect_delete トリガー（storage.protect_objects_delete /
--    storage.protect_buckets_delete）により、セッション変数
--    storage.allow_delete_query が 'true' でない限り拒否される
--    （「Direct deletion from storage tables is not allowed. Use the
--    Storage API instead.」）。マイグレーションはStorage APIを呼べない
--    ため、このトランザクション内に限定してSET LOCALで許可する。
--    storage.objectsは上記ガード2で0件を確認済みだが、念のためDELETEを
--    明示的に実行する（0件想定・no-op）。
-- ------------------------------------------------------------
SET LOCAL storage.allow_delete_query = 'true';

DELETE FROM storage.objects WHERE bucket_id = 'chore-photos';
DELETE FROM storage.buckets WHERE id = 'chore-photos';

-- ------------------------------------------------------------
-- 3. chore_completions.photo_url 列を削除する。
-- ------------------------------------------------------------
ALTER TABLE chore_completions DROP COLUMN IF EXISTS photo_url;

-- ------------------------------------------------------------
-- 事後確認: バケット・列がいずれも消えていることを確認する。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chore-photos') THEN
    RAISE EXCEPTION '削除後もstorage.bucketsにchore-photosが残っています。想定外です。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chore_completions' AND column_name = 'photo_url'
  ) THEN
    RAISE EXCEPTION '削除後もchore_completions.photo_url列が残っています。想定外です。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('chore_photos_insert_own_family', 'chore_photos_select_own_family')
  ) THEN
    RAISE EXCEPTION '削除後もchore-photos関連のstorage.objectsポリシーが残っています。想定外です。';
  END IF;
END $$;
