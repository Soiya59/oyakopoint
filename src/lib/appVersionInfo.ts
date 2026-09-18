/**
 * アプリ内バージョン表示（保護者・みまもりの設定画面の最下部）の文字列を組み立てる
 * 純粋関数。参照: 開発部/成果物/実装メモ.md 241章。
 *
 * OTA（expo-updates）を2026-09-17に使い始めたことで、配布した中身はストアの
 * 「バージョン」にも「新機能」にも一切出なくなった。「この端末に届いているか」を
 * 統括・テスターが確かめる手段と、不具合報告のときに「どのバージョン？」と聞ける
 * 材料をこの表示で作る。
 *
 * RN/expoのAPI（Constants・expo-updates）には依存させず、呼び出し側
 * （src/components/AppVersionInfo.tsx）が取得した値を渡す形にしてある。
 * src/lib/groupDuplicateRows.ts と同じ理由（画面・プラットフォームAPIに依存しない
 * 純粋関数として検証しやすくするため）。
 */

export interface AppVersionInfoUpdates {
  /** expo-updatesのisEmbeddedLaunch。trueならOTA未適用・ビルド内蔵の中身。 */
  isEmbeddedLaunch: boolean;
  /** expo-updatesのupdateId（UUID）。取得できない場合はnull。 */
  updateId: string | null;
  /** expo-updatesのcreatedAt。取得できない場合はnull。 */
  createdAt: Date | null;
}

export interface AppVersionInfoInput {
  /** Platform.OSの値。"web"のときは他のフィールドを無視して「Web版」だけを返す。 */
  platformOS: string;
  /** Constants.expoConfig?.version 等から取得したバージョン文字列。取得できなければnull。 */
  version: string | null;
  /**
   * ビルド番号。expo-constants@56系では`nativeBuildVersion`が廃止されており、
   * 代替の`Constants.platform`もAndroidでは値を返さないことが判明したため、
   * 呼び出し側は`expo-application`の`Application.nativeBuildVersion`から作った
   * 文字列を渡す（実装メモ241章・249章「決定事項」参照）。取得できなければnull。
   */
  buildNumber: string | null;
  /**
   * expo-updatesの値。ネイティブ以外（Web・一部の開発ビルド）や取得に失敗した場合は
   * undefinedを渡すこと（呼び出し側でtry/catchと存在チェック）。
   */
  updates?: AppVersionInfoUpdates;
}

/** 端末のローカル時刻で「MM-DD HH:mm」に整形する。 */
function formatLocalDateTime(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * 「更新」欄を組み立てる。
 * - updatesが無い（取得できなかった）→ "更新 —"
 * - isEmbeddedLaunchがtrue（OTA未適用・ビルド内蔵のまま）→ "更新 なし"
 * - updateId・createdAtが揃っていない → "更新 —"
 * - それ以外 → "更新 <updateIdの先頭8文字> / <MM-DD HH:mm>"
 */
function formatUpdatePart(updates: AppVersionInfoUpdates | undefined): string {
  if (!updates) return "更新 —";
  if (updates.isEmbeddedLaunch) return "更新 なし";
  if (!updates.updateId || !updates.createdAt) return "更新 —";
  return `更新 ${updates.updateId.slice(0, 8)} / ${formatLocalDateTime(updates.createdAt)}`;
}

/**
 * 表示文字列を組み立てる。
 * 例: "バージョン 1.0.0（ビルド 8）　更新 a1b2c3d4 / 09-17 21:05"
 * Web版は "Web版" だけを返す（チャンネル名は出さない、利用者に意味がないため）。
 */
export function formatAppVersionInfo(input: AppVersionInfoInput): string {
  if (input.platformOS === "web") return "Web版";
  const version = input.version ?? "—";
  const build = input.buildNumber ?? "—";
  return `バージョン ${version}（ビルド ${build}）　${formatUpdatePart(input.updates)}`;
}
