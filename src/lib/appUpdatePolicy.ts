/**
 * 古いビルドの人に「アップデートしてください」を出す仕組みの、判定まわりの純粋関数。
 * 参照: 企画部/成果物/要件定義書.md 07-47章（決定1〜12）、設計部/成果物/API仕様.md 41章
 * （41.3の判定表）、開発部/成果物/実装メモ.md 362章。
 *
 * RN/expoのAPI（Platform・expo-application・AppState）には依存させない。呼び出し側
 * （src/components/AppUpdateGate.tsx）が取得した値を渡す形にしてある。
 * src/lib/appVersionInfo.ts と同じ理由（プラットフォームAPIに依存しない純粋関数にして
 * 検証しやすくするため。検査は src/lib/appUpdatePolicy.verify.ts）。
 *
 * [大原則] **迷ったら「出さない」（通す）。** この仕組みは古い人を促すためのもので、
 * 誤って全員を止める危険のほうが大きい（決定5）。したがって、ここの関数は
 * 「読めない・想定外の形」をすべて null / "none" に倒す。例外は投げない。
 */

export type UpdatePlatform = "ios" | "android";
export type UpdateKind = "none" | "recommended" | "required";

/** RPCが返す3つの値（API仕様.md 41.2）。 */
export interface AppUpdatePolicy {
  /** 必須の最低ビルド番号。0＝「必須」は使わない。 */
  requiredMinBuild: number;
  /** おすすめの最低ビルド番号。0＝「おすすめ」は使わない。 */
  recommendedMinBuild: number;
  /** ストアのURL。空文字＝リンクなし（検査前の生の値。開く前に sanitizeStoreUrl を通す）。 */
  storeUrl: string;
}

/** 確認のタイムアウト（決定5・API仕様.md 41.4。再試行はしない）。 */
export const APP_UPDATE_TIMEOUT_MS = 3000;
/** 「必須」を復帰時に確かめ直す間隔（決定5：前回の確認から1時間以上）。 */
export const REQUIRED_RECHECK_INTERVAL_MS = 60 * 60 * 1000;
/** DBのCHECKと同じ上限（スキーマ設計.sql 85.2 判断D）。これを超える値は想定外として通す。 */
export const MAX_BUILD_NUMBER = 100000;

/** Platform.OS から比べる対象のOSを決める。ios/android以外（web等）は null＝判定しない。 */
export function platformFromOS(os: string): UpdatePlatform | null {
  if (os === "ios") return "ios";
  if (os === "android") return "android";
  return null;
}

/**
 * 自分のビルド番号（`Application.nativeBuildVersion` の文字列）を整数にする。
 * 数字だけの1〜9桁の文字列のみ受け付ける。"1.0.0.24" のようなドット入り・空・空白入り・
 * 負・小数・null は null（＝通す）。**0 も null にする**（0は「読めなかった」ことが多く、
 * 0と読んでしまうと最低値より必ず小さくなって止めてしまうため）。
 */
export function parseOwnBuildNumber(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  if (!/^[0-9]{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

function isValidMinBuild(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_BUILD_NUMBER;
}

/**
 * RPCの返り値（`[{required_min_build, recommended_min_build, store_url}]`）を検査して取り出す。
 * 配列でない・1要素でない・列が無い・数字でない（文字列の "30" も不可）・範囲外・URLが文字列でない、
 * のどれかなら null（＝通す。API仕様.md 41.3の1行目）。
 */
export function parseAppUpdatePolicyResponse(data: unknown): AppUpdatePolicy | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row: unknown = data[0];
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const required = r.required_min_build;
  const recommended = r.recommended_min_build;
  const storeUrl = r.store_url;
  if (!isValidMinBuild(required) || !isValidMinBuild(recommended)) return null;
  if (typeof storeUrl !== "string") return null;
  return { requiredMinBuild: required, recommendedMinBuild: recommended, storeUrl };
}

/**
 * 判定表（API仕様.md 41.3）。**必須を先に見る。**
 *  1. 自分の番号が読めない／policyが無い（取得失敗・想定外）→ 出さない
 *  2. 必須>0 かつ 自分<必須 → 必須（A1）
 *  3. おすすめ>0 かつ 自分<おすすめ → おすすめ（A2）
 *  4. それ以外（等しい・大きい・0）→ 出さない
 */
export function decideUpdateKind(ownBuild: number | null, policy: AppUpdatePolicy | null): UpdateKind {
  if (ownBuild === null || policy === null) return "none";
  if (!Number.isInteger(ownBuild) || ownBuild < 1) return "none";
  if (!isValidMinBuild(policy.requiredMinBuild) || !isValidMinBuild(policy.recommendedMinBuild)) return "none";
  if (policy.requiredMinBuild > 0 && ownBuild < policy.requiredMinBuild) return "required";
  if (policy.recommendedMinBuild > 0 && ownBuild < policy.recommendedMinBuild) return "recommended";
  return "none";
}

/**
 * ストアのURLを開いてよいか検査する（決定7・UIUXデザイン部73.12節3）。
 * 通るのは `https://play.google.com` または `https://apps.apple.com` のホスト**完全一致**だけ。
 * ホストの直後は `/` か文字列の終わりのみ（`@`・`:`・`.` が続くものは通さない＝
 * `https://play.google.com@evil.example/`・`https://play.google.com.evil.example/`・
 * `https://play.google.com:8080/` は全部落ちる）。空白・制御文字入り・300字超も落とす。
 * 通らなければ null＝「リンクが無い」と同じに扱う（ボタンを出さない）。
 */
export function sanitizeStoreUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  if (url.length === 0 || url.length > 300) return null;
  if (!/^https:\/\/(play\.google\.com|apps\.apple\.com)(\/[^\s\u0000-\u001f\u007f\\]*)?$/.test(url)) return null;
  return url;
}

/**
 * 「必須」の再確認をしてよいか（バックグラウンドから戻ったとき）。前回の確認から1時間以上。
 * 前回の確認が一度も無い（null）なら true。時計が巻き戻って経過がマイナスのときも true
 * （いつまでも確かめ直さない状態を避ける）。
 */
export function shouldRecheckRequired(lastCheckedAtMs: number | null, nowMs: number): boolean {
  if (lastCheckedAtMs === null) return true;
  const elapsed = nowMs - lastCheckedAtMs;
  if (elapsed < 0) return true;
  return elapsed >= REQUIRED_RECHECK_INTERVAL_MS;
}
