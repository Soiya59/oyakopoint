/**
 * appUpdatePolicy.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 362章、企画部/成果物/要件定義書.md 07-47章 4節（受け入れ条件3・4・8）。
 *
 * 実行:
 *   npx tsx src/lib/appUpdatePolicy.verify.ts
 *
 * 1件でも失敗すれば非ゼロの終了コードで終わる。tsconfig.jsonのexclude（`.verify.ts`）により
 * tscの型チェック対象からは外れる。
 */
import {
  APP_UPDATE_TIMEOUT_MS,
  REQUIRED_RECHECK_INTERVAL_MS,
  decideUpdateKind,
  parseAppUpdatePolicyResponse,
  parseOwnBuildNumber,
  platformFromOS,
  sanitizeStoreUrl,
  shouldRecheckRequired,
} from "./appUpdatePolicy.ts";
import type { AppUpdatePolicy } from "./appUpdatePolicy.ts";

let failed = 0;
let passed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passed += 1;
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${JSON.stringify(expected)}`);
    console.log(`     実際値: ${JSON.stringify(actual)}`);
  }
}

const pol = (requiredMinBuild: number, recommendedMinBuild: number, storeUrl = ""): AppUpdatePolicy => ({
  requiredMinBuild,
  recommendedMinBuild,
  storeUrl,
});

// ---- 0. 定数 ----
assertEqual("タイムアウトは3秒", APP_UPDATE_TIMEOUT_MS, 3000);
assertEqual("再確認の間隔は1時間", REQUIRED_RECHECK_INTERVAL_MS, 3600000);

// ---- 1. platformFromOS ----
assertEqual("ios -> ios", platformFromOS("ios"), "ios");
assertEqual("android -> android", platformFromOS("android"), "android");
assertEqual("web -> null（判定しない）", platformFromOS("web"), null);
assertEqual("windows -> null", platformFromOS("windows"), null);
assertEqual("大文字IOS -> null（Platform.OSは小文字のみ）", platformFromOS("IOS"), null);
assertEqual("空文字 -> null", platformFromOS(""), null);

// ---- 2. parseOwnBuildNumber（読めない番号は null＝通す） ----
assertEqual("'24' -> 24", parseOwnBuildNumber("24"), 24);
assertEqual("'14' -> 14", parseOwnBuildNumber("14"), 14);
assertEqual("'1' -> 1", parseOwnBuildNumber("1"), 1);
assertEqual("'024'（先頭0）-> 24", parseOwnBuildNumber("024"), 24);
assertEqual("'100000' -> 100000", parseOwnBuildNumber("100000"), 100000);
assertEqual("'0' -> null（0は読めなかった扱い）", parseOwnBuildNumber("0"), null);
assertEqual("'' -> null", parseOwnBuildNumber(""), null);
assertEqual("null -> null", parseOwnBuildNumber(null), null);
assertEqual("undefined -> null", parseOwnBuildNumber(undefined), null);
assertEqual("数値24（文字列でない）-> null", parseOwnBuildNumber(24), null);
assertEqual("'1.0.0.24' -> null", parseOwnBuildNumber("1.0.0.24"), null);
assertEqual("'24.5' -> null", parseOwnBuildNumber("24.5"), null);
assertEqual("'-3' -> null", parseOwnBuildNumber("-3"), null);
assertEqual("' 24' -> null（空白入り）", parseOwnBuildNumber(" 24"), null);
assertEqual("'24 ' -> null", parseOwnBuildNumber("24 "), null);
assertEqual("'24a' -> null", parseOwnBuildNumber("24a"), null);
assertEqual("'abc' -> null", parseOwnBuildNumber("abc"), null);
assertEqual("'１２'（全角）-> null", parseOwnBuildNumber("１２"), null);
assertEqual("'1234567890'（10桁）-> null", parseOwnBuildNumber("1234567890"), null);
assertEqual("'NaN' -> null", parseOwnBuildNumber("NaN"), null);
assertEqual("'1e3' -> null", parseOwnBuildNumber("1e3"), null);

// ---- 3. parseAppUpdatePolicyResponse（想定外の形は null＝通す） ----
const good = [{ required_min_build: 30, recommended_min_build: 25, store_url: "https://play.google.com/store/apps/details?id=x" }];
const parsed = parseAppUpdatePolicyResponse(good);
assertEqual("正しい形: required", parsed?.requiredMinBuild, 30);
assertEqual("正しい形: recommended", parsed?.recommendedMinBuild, 25);
assertEqual("正しい形: storeUrl", parsed?.storeUrl, "https://play.google.com/store/apps/details?id=x");
assertEqual("初期値(0,0,'') は有効な形", JSON.stringify(parseAppUpdatePolicyResponse([{ required_min_build: 0, recommended_min_build: 0, store_url: "" }])), JSON.stringify(pol(0, 0, "")));
assertEqual("上限100000は有効", parseAppUpdatePolicyResponse([{ required_min_build: 100000, recommended_min_build: 0, store_url: "" }])?.requiredMinBuild, 100000);
assertEqual("100001は想定外 -> null", parseAppUpdatePolicyResponse([{ required_min_build: 100001, recommended_min_build: 0, store_url: "" }]), null);
assertEqual("負の数 -> null", parseAppUpdatePolicyResponse([{ required_min_build: -1, recommended_min_build: 0, store_url: "" }]), null);
assertEqual("小数 -> null", parseAppUpdatePolicyResponse([{ required_min_build: 1.5, recommended_min_build: 0, store_url: "" }]), null);
assertEqual("文字列の数字 '30' -> null", parseAppUpdatePolicyResponse([{ required_min_build: "30", recommended_min_build: 0, store_url: "" }]), null);
assertEqual("NaN -> null", parseAppUpdatePolicyResponse([{ required_min_build: NaN, recommended_min_build: 0, store_url: "" }]), null);
assertEqual("null値 -> null", parseAppUpdatePolicyResponse([{ required_min_build: null, recommended_min_build: 0, store_url: "" }]), null);
assertEqual("recommendedが無い列 -> null", parseAppUpdatePolicyResponse([{ required_min_build: 0, store_url: "" }]), null);
assertEqual("requiredが無い列 -> null", parseAppUpdatePolicyResponse([{ recommended_min_build: 0, store_url: "" }]), null);
assertEqual("store_urlが無い列 -> null", parseAppUpdatePolicyResponse([{ required_min_build: 0, recommended_min_build: 0 }]), null);
assertEqual("store_urlがnull -> null（DBは''に直して返す約束）", parseAppUpdatePolicyResponse([{ required_min_build: 0, recommended_min_build: 0, store_url: null }]), null);
assertEqual("空の配列 -> null", parseAppUpdatePolicyResponse([]), null);
assertEqual("2要素 -> null", parseAppUpdatePolicyResponse([good[0], good[0]]), null);
assertEqual("配列でないオブジェクト -> null", parseAppUpdatePolicyResponse(good[0]), null);
assertEqual("null -> null", parseAppUpdatePolicyResponse(null), null);
assertEqual("undefined -> null", parseAppUpdatePolicyResponse(undefined), null);
assertEqual("文字列 -> null", parseAppUpdatePolicyResponse("[]"), null);
assertEqual("要素がnull -> null", parseAppUpdatePolicyResponse([null]), null);
assertEqual("要素が配列 -> null", parseAppUpdatePolicyResponse([[]]), null);
assertEqual("PostgRESTのエラー本文 -> null", parseAppUpdatePolicyResponse({ code: "PGRST301", message: "x" }), null);

// ---- 4. decideUpdateKind（API仕様.md 41.3の判定表。受け入れ条件1〜4・9） ----
// 自分=24 のとき
assertEqual("必須25 > 自分24 -> required", decideUpdateKind(24, pol(25, 0)), "required");
assertEqual("必須24 = 自分24 -> none（等しい）", decideUpdateKind(24, pol(24, 0)), "none");
assertEqual("必須23 < 自分24 -> none（大きい）", decideUpdateKind(24, pol(23, 0)), "none");
assertEqual("必須0 -> none（0は使わない）", decideUpdateKind(24, pol(0, 0)), "none");
assertEqual("おすすめ25 > 自分24 -> recommended", decideUpdateKind(24, pol(0, 25)), "recommended");
assertEqual("おすすめ24 = 自分24 -> none", decideUpdateKind(24, pol(0, 24)), "none");
assertEqual("おすすめ23 -> none", decideUpdateKind(24, pol(0, 23)), "none");
assertEqual("おすすめ0 -> none", decideUpdateKind(24, pol(0, 0)), "none");
assertEqual("必須25・おすすめ25 -> required だけ（必須を先に見る）", decideUpdateKind(24, pol(25, 25)), "required");
assertEqual("必須25・おすすめ30 -> required", decideUpdateKind(24, pol(25, 30)), "required");
assertEqual("必須24（足りる）・おすすめ25 -> recommended", decideUpdateKind(24, pol(24, 25)), "recommended");
assertEqual("必須0・おすすめ25 -> recommended", decideUpdateKind(24, pol(0, 25)), "recommended");
assertEqual("おすすめが必須より小さくても矛盾しない: 必須25・おすすめ10 -> required", decideUpdateKind(24, pol(25, 10)), "required");
assertEqual("おすすめが必須より小さい: 必須10・おすすめ20 -> recommended（おすすめだけ効く）", decideUpdateKind(15, pol(10, 20)), "recommended");
assertEqual("両方足りている -> none", decideUpdateKind(24, pol(10, 20)), "none");
// 境界
assertEqual("自分1・必須2 -> required", decideUpdateKind(1, pol(2, 0)), "required");
assertEqual("自分1・必須1 -> none", decideUpdateKind(1, pol(1, 0)), "none");
assertEqual("自分100000・必須100000 -> none", decideUpdateKind(100000, pol(100000, 0)), "none");
assertEqual("自分99999・必須100000 -> required", decideUpdateKind(99999, pol(100000, 0)), "required");
// 読めない・想定外は none
assertEqual("自分の番号が読めない(null) -> none", decideUpdateKind(null, pol(999, 999)), "none");
assertEqual("policyが取れない(null) -> none", decideUpdateKind(24, null), "none");
assertEqual("両方null -> none", decideUpdateKind(null, null), "none");
assertEqual("自分が0 -> none（読めなかった扱い）", decideUpdateKind(0, pol(999, 999)), "none");
assertEqual("自分が負 -> none", decideUpdateKind(-1, pol(999, 999)), "none");
assertEqual("自分が小数 -> none", decideUpdateKind(24.5, pol(999, 999)), "none");
assertEqual("自分がNaN -> none", decideUpdateKind(NaN, pol(999, 999)), "none");
assertEqual("必須が範囲外(100001)のpolicy -> none（直接渡されても止めない）", decideUpdateKind(24, pol(100001, 0)), "none");
assertEqual("おすすめが負のpolicy -> none", decideUpdateKind(24, pol(0, -5)), "none");
assertEqual("必須がNaNのpolicy -> none", decideUpdateKind(24, pol(NaN, 0)), "none");
// OSごとの別値（受け入れ条件9）: 呼び出し側がOSごとに別の行を取るので、判定は行を入れ替えるだけで別々に決まる
const iosRow = pol(30, 0);
const androidRow = pol(0, 0);
assertEqual("iOS行だけ必須30・自分24 -> required", decideUpdateKind(24, iosRow), "required");
assertEqual("Android行は0・自分14 -> none", decideUpdateKind(14, androidRow), "none");

// ---- 5. sanitizeStoreUrl（受け入れ条件8） ----
const OK = (u: string) => assertEqual(`通す: ${u}`, sanitizeStoreUrl(u), u);
const NG = (label: string, u: unknown) => assertEqual(`落とす: ${label}`, sanitizeStoreUrl(u), null);
OK("https://play.google.com/store/apps/details?id=jp.soiyalab.oyakopoint");
OK("https://apps.apple.com/app/id6811203757");
OK("https://play.google.com");
OK("https://play.google.com/");
NG("空文字", "");
NG("null", null);
NG("undefined", undefined);
NG("数値", 123);
NG("http（httpsでない）", "http://play.google.com/store/apps/details?id=x");
NG("別のホスト", "https://example.com/");
NG("前方一致のなりすまし play.google.com.evil.example", "https://play.google.com.evil.example/x");
NG("ユーザー情報で偽装 play.google.com@evil.example", "https://play.google.com@evil.example/");
NG("ユーザー情報（パスワード付き）", "https://user:pass@play.google.com/x");
NG("ポート付き", "https://play.google.com:8080/x");
NG("ポート443付き", "https://play.google.com:443/x");
NG("サブドメイン xxx.play.google.com", "https://xxx.play.google.com/x");
NG("サブドメイン www.apps.apple.com", "https://www.apps.apple.com/x");
NG("大文字ホスト", "https://PLAY.GOOGLE.COM/x");
NG("大文字スキーム", "HTTPS://play.google.com/x");
NG("先頭に空白", " https://play.google.com/x");
NG("末尾に空白", "https://play.google.com/x ");
NG("途中に空白", "https://play.google.com/a b");
NG("改行入り", "https://play.google.com/a\nb");
NG("タブ入り", "https://play.google.com/a\tb");
NG("制御文字入り", "https://play.google.com/a\u0001b");
NG("バックスラッシュ入り", "https://play.google.com/\\evil.example");
NG("ホスト直後がバックスラッシュ", "https://play.google.com\\@evil.example/");
NG("ホストの直後がドット", "https://play.google.com./x");
NG("ホストの直後がハイフン", "https://play.google.com-evil.example/x");
NG("スキームだけ", "https://");
NG("javascript:", "javascript:alert(1)");
NG("market://", "market://details?id=jp.soiyalab.oyakopoint");
NG("itms-apps://", "itms-apps://apps.apple.com/app/id6811203757");
NG("301字（長すぎる）", "https://play.google.com/" + "a".repeat(300 - 24 + 1));
OK("https://play.google.com/" + "a".repeat(300 - 24));

// ---- 6. shouldRecheckRequired（決定5：前回の確認から1時間以上） ----
const T = 1_000_000_000_000;
assertEqual("前回なし -> 確認する", shouldRecheckRequired(null, T), true);
assertEqual("直後 -> しない", shouldRecheckRequired(T, T), false);
assertEqual("59分59秒 -> しない", shouldRecheckRequired(T, T + 3_599_000), false);
assertEqual("ちょうど1時間 -> する", shouldRecheckRequired(T, T + 3_600_000), true);
assertEqual("2時間 -> する", shouldRecheckRequired(T, T + 7_200_000), true);
assertEqual("時計が巻き戻った -> する", shouldRecheckRequired(T, T - 1), true);

console.log(`\n${passed} 件OK / ${failed} 件NG`);
if (failed > 0) process.exitCode = 1;
