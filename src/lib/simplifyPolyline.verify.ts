/**
 * simplifyPolyline.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 137.4章。
 *
 * このリポジトリには2026-09-07時点でテストランナー（jest等）が導入されていない
 * （package.jsonのdevDependenciesにテスト系パッケージが無いことを確認済み）ため、
 * 「既存のテスト方式に倣う」対象が無く、依頼文の指示どおり「Node で直接実行する
 * 簡単な検証スクリプト」として書いた。Node.js 22（`--experimental-strip-types`が
 * 既定で有効。ローカルでNode v22.18.0で動作確認済み）であれば、ビルド不要でそのまま
 * 実行できる:
 *
 *   node src/lib/simplifyPolyline.verify.ts
 *
 * 実行するとテストケースごとにOK/NGを表示し、1件でも失敗すれば非ゼロの終了コードで
 * 終わる（`process.exitCode`）。`"@/..."`のパスエイリアスはNode単体実行では解決
 * できないため、simplifyPolyline.ts側は元々パスエイリアスに依存しない設計にしている
 * （相対importのみ）。
 *
 * 実行時に`MODULE_TYPELESS_PACKAGE_JSON`という警告が出るが無害（package.jsonに
 * `"type": "module"`が無いために出る性能上の注意で、Expo/React Native側の挙動には
 * 影響しないため、この検証スクリプトのためだけにpackage.jsonへ手を加えることはしない）。
 *
 * このファイルはNode単体実行専用のため`tsconfig.json`の`exclude`（ファイル名が
 * `.verify.ts`で終わるものを除外するパターン）で本体のtsc型チェック対象から外している
 * （tscはimport指定子の`.ts`拡張子を許容せず
 * TS5097エラーになる一方、Nodeのネイティブ実行は逆に拡張子を省略できないため）。
 * 型の妥当性は`npx tsc --noEmit --allowImportingTsExtensions src/lib/simplifyPolyline.verify.ts`
 * で個別に確認できる。
 */
import { simplifyPolyline } from "./simplifyPolyline.ts";

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${e}`);
    console.log(`     実際値: ${a}`);
  }
}

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
  }
}

// ---- 1. 直線上に並んだ10点 → 2点になる ----
{
  // (0,0) から (90,0) まで、10点を等間隔（10ずつ）の完全な直線上に置く。
  const straight: number[] = [];
  for (let i = 0; i < 10; i++) straight.push(i * 10, 0);
  const result = simplifyPolyline(straight, 2);
  assertEqual("直線上の10点→始点・終点の2点になる", result, [0, 0, 90, 0]);
}

// ---- 2. 始点・終点が必ず残る（直線でない、ジグザグの例） ----
{
  const zigzag = [0, 0, 10, 100, 20, 0, 30, 100, 40, 0, 50, 100, 60, 0];
  const result = simplifyPolyline(zigzag, 2);
  const n = result.length / 2;
  assert("始点が残る（ジグザグ）", result[0] === zigzag[0] && result[1] === zigzag[1]);
  assert(
    "終点が残る（ジグザグ）",
    result[result.length - 2] === zigzag[zigzag.length - 2] &&
      result[result.length - 1] === zigzag[zigzag.length - 1]
  );
  // ジグザグは大きく振れているため、間引かれても3点未満にはならない（潰れて直線化しない）。
  assert("ジグザグは3点以上残る（形が潰れない）", n >= 3);
}

// ---- 3. 1点・2点の入力はそのまま ----
{
  const onePoint = [123, 456];
  assertEqual("1点の入力はそのまま", simplifyPolyline(onePoint, 2), onePoint);

  const twoPoints = [0, 0, 1000, 1000];
  assertEqual("2点の入力はそのまま", simplifyPolyline(twoPoints, 2), twoPoints);

  const empty: number[] = [];
  assertEqual("0点（空配列）の入力はそのまま", simplifyPolyline(empty, 2), empty);
}

// ---- 4. 許容値0なら何も減らない（同一直線上の点を除く） ----
{
  // 完全な直線上の点は許容値0でも除かれる（距離0は「許容値を超えていない」ため）。
  const straight = [0, 0, 5, 0, 10, 0];
  assertEqual(
    "許容値0：完全な直線上の中間点は除かれる",
    simplifyPolyline(straight, 0),
    [0, 0, 10, 0]
  );

  // 直線からわずかにでも外れた点（距離1）は許容値0では残る（0を超えるため）。
  const almostStraight = [0, 0, 5, 1, 10, 0];
  assertEqual(
    "許容値0：直線から1ずれた中間点は残る",
    simplifyPolyline(almostStraight, 0),
    [0, 0, 5, 1, 10, 0]
  );
}

// ---- 5. 整数が保たれること（間引きは点を減らすだけで座標値を書き換えない） ----
{
  const withInts = [0, 0, 3, 7, 999, 1000, 500, 250];
  const result = simplifyPolyline(withInts, 2);
  assert(
    "出力の座標はすべて入力に含まれる整数のまま",
    result.every((v) => Number.isInteger(v) && withInts.includes(v))
  );
}

// ---- 6. 再帰を使わない実装であることの確認（大きめの入力でもクラッシュしないこと） ----
{
  // 1本の上限300点（p配列としては600要素、theme.drawingLimits.maxPointsPerLine）
  // に相当する、渦巻き状（毎回方向が変わり、区間が半分ずつに割れにくい意地悪な形）の点列。
  const spiral: number[] = [];
  for (let i = 0; i < 300; i++) {
    const angle = i * 0.5;
    const r = i;
    spiral.push(Math.round(500 + r * Math.cos(angle)), Math.round(500 + r * Math.sin(angle)));
  }
  let result: number[] = [];
  let threw = false;
  try {
    result = simplifyPolyline(spiral, 2);
  } catch {
    threw = true;
  }
  assert("300点の渦巻きでも例外にならない（スタックオーバーフローしない）", !threw);
  assert("300点の渦巻きの出力も2点以上300点以下", result.length / 2 >= 2 && result.length / 2 <= 300);
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
