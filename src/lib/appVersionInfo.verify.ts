/**
 * appVersionInfo.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 241章。
 *
 * このリポジトリにはテストランナー（jest等）が導入されていないため、
 * src/lib/simplifyPolyline.verify.ts の前例に倣い「Node で直接実行する検証スクリプト」
 * として書いた。Node.js 22（`--experimental-strip-types`が既定で有効）であれば
 * ビルド不要でそのまま実行できる:
 *
 *   node src/lib/appVersionInfo.verify.ts
 *
 * 実行するとテストケースごとにOK/NGを表示し、1件でも失敗すれば非ゼロの終了コードで
 * 終わる（`process.exitCode`）。対象本体（appVersionInfo.ts）は相対importのみ・
 * パスエイリアス非依存にしてある。tsconfig.jsonのexclude（`.verify.ts`）により
 * tscの型チェック対象からも外れる。
 */
import { formatAppVersionInfo } from "./appVersionInfo.ts";
import type { AppVersionInfoInput } from "./appVersionInfo.ts";

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${JSON.stringify(expected)}`);
    console.log(`     実際値: ${JSON.stringify(actual)}`);
  }
}

// ---- 1. Web版はチャンネル名等を無視して「Web版」だけ ----
{
  const input: AppVersionInfoInput = {
    platformOS: "web",
    version: "1.0.0",
    buildNumber: "8",
    updates: { isEmbeddedLaunch: false, updateId: "a1b2c3d4-0000-0000-0000-000000000000", createdAt: new Date() },
  };
  assertEqual("web → 'Web版'だけを返す", formatAppVersionInfo(input), "Web版");
}

// ---- 2. updatesが取得できない（undefined）→ 「更新 —」 ----
{
  const input: AppVersionInfoInput = {
    platformOS: "ios",
    version: "1.0.0",
    buildNumber: "8",
    updates: undefined,
  };
  assertEqual(
    "updates未取得 → '更新 —'",
    formatAppVersionInfo(input),
    "バージョン 1.0.0（ビルド 8）　更新 —"
  );
}

// ---- 3. isEmbeddedLaunch=true（OTA未適用・ビルド内蔵） → 「更新 なし」 ----
{
  const input: AppVersionInfoInput = {
    platformOS: "android",
    version: "1.0.0",
    buildNumber: "15",
    updates: { isEmbeddedLaunch: true, updateId: null, createdAt: null },
  };
  assertEqual(
    "isEmbeddedLaunch=true → '更新 なし'",
    formatAppVersionInfo(input),
    "バージョン 1.0.0（ビルド 15）　更新 なし"
  );
}

// ---- 4. OTA適用済み → updateIdの先頭8文字 / MM-DD HH:mm（端末ローカル時刻） ----
{
  const createdAt = new Date(2026, 8, 17, 21, 5); // 2026-09-17 21:05（ローカル時刻、月は0始まり）
  const input: AppVersionInfoInput = {
    platformOS: "ios",
    version: "1.0.0",
    buildNumber: "8",
    updates: { isEmbeddedLaunch: false, updateId: "a1b2c3d4-5678-90ab-cdef-1234567890ab", createdAt },
  };
  assertEqual(
    "OTA適用済み → '更新 a1b2c3d4 / 09-17 21:05'",
    formatAppVersionInfo(input),
    "バージョン 1.0.0（ビルド 8）　更新 a1b2c3d4 / 09-17 21:05"
  );
}

// ---- 5. isEmbeddedLaunch=falseだがupdateId/createdAtが欠けている → 「更新 —」（落とさない） ----
{
  const input: AppVersionInfoInput = {
    platformOS: "ios",
    version: "1.0.0",
    buildNumber: "8",
    updates: { isEmbeddedLaunch: false, updateId: null, createdAt: null },
  };
  assertEqual(
    "isEmbeddedLaunch=falseだがID欠落 → '更新 —'",
    formatAppVersionInfo(input),
    "バージョン 1.0.0（ビルド 8）　更新 —"
  );
}

// ---- 6. version/buildNumberが取得できない → 「—」で埋める ----
{
  const input: AppVersionInfoInput = {
    platformOS: "android",
    version: null,
    buildNumber: null,
    updates: undefined,
  };
  assertEqual(
    "version/buildNumber未取得 → '—'で埋める",
    formatAppVersionInfo(input),
    "バージョン —（ビルド —）　更新 —"
  );
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
