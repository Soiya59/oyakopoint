import React from "react";
import { Platform, Text } from "react-native";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import theme from "@/theme/theme";
import { formatAppVersionInfo } from "@/lib/appVersionInfo";
import type { AppVersionInfoUpdates } from "@/lib/appVersionInfo";

type Tone = "parent" | "supporter";

interface AppVersionInfoProps {
  tone?: Tone;
}

/**
 * いま動いているバージョンの表示。参照: 開発部/成果物/実装メモ.md 241章。
 * 保護者の設定系画面（app/parent/family.tsx）・みまもりの設定画面
 * （app/supporter/settings.tsx）の最下部に置く。子どもには出さない。
 *
 * OTA（expo-updates）を2026-09-17に使い始めたことで、配布した中身はストアの
 * 「バージョン」にも「新機能」にも一切出なくなった。「この端末に届いているか」を
 * 統括・テスターが確かめる手段と、不具合報告のときに「どのバージョン？」と聞ける
 * 材料をこの表示で作る。
 *
 * [ビルド番号についての決定事項・2026-09-18改訂] 当初の指示は`Constants.nativeBuildVersion`
 * だったが、expo-constants@56.0.23では既に廃止されている
 * （CHANGELOG.md: "Remove deprecated ... nativeAppVersion, nativeBuildVersion ...
 * properties"）。代替として`Constants.platform?.ios?.buildNumber` /
 * `Constants.platform?.android?.versionCode`を使ったが、これもAndroid実機
 * （build 10）で「ビルド -」のまま取れなかった。原因は
 * `node_modules/expo/node_modules/expo-modules-core/android/src/main/java/expo/modules/constants/ConstantsService.kt`
 * が`"platform" to mapOf("android" to emptyMap())`とAndroidの`platform.android`を
 * 空オブジェクトで固定で返しているため（`versionCode`キー自体が存在しない。iOS側の
 * `ConstantsProvider.swift`は`CFBundleVersion`から`buildNumber`を入れており動く実装
 * だったが、Android側だけ未実装のまま放置されていた）。
 * これはJS側の書き方の問題ではなく`expo-constants`のAndroidネイティブ実装の欠落なので、
 * `expo-application`を追加し`Application.nativeBuildVersion`に切り替えた
 * （`node_modules/expo-application/android/.../ApplicationModule.kt`は
 * `PackageManager.getPackageInfo(...).versionCode`を直接読んでおり、上記の
 * 空オブジェクト問題と無関係。iOS側も`CFBundleVersion`を直接読む独立実装）。
 * ネイティブモジュールの追加のため、この対応はOTA（expo-updates）では配信できず、
 * 新しいビルドが必要（2026-09-18・統括承認済み）。
 *
 * expo-updates はネイティブ以外（Web・一部の開発ビルド）で値が取れないことがあるため、
 * try/catchと存在チェックで囲み、取れなければformatAppVersionInfo側で「更新 —」にする
 * （落とさない）。
 */
export default function AppVersionInfo({ tone = "parent" }: AppVersionInfoProps) {
  const text = formatAppVersionInfo({
    platformOS: Platform.OS,
    version: Constants.expoConfig?.version ?? null,
    buildNumber: readBuildNumber(),
    updates: Platform.OS === "web" ? undefined : readUpdatesInfo(),
  });

  const style = tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  return (
    <Text
      style={[
        style,
        { marginTop: theme.spacing.s4, textAlign: "center", color: theme.colors.neutralTextSecondary },
      ]}
    >
      {text}
    </Text>
  );
}

/**
 * iOS/Androidそれぞれのネイティブビルド番号を文字列で返す。取れなければnull。
 * `expo-application`の`Application.nativeBuildVersion`を使う理由は本ファイル冒頭の
 * コメント参照（`Constants.platform`はAndroidで取れないことが判明したため）。
 */
function readBuildNumber(): string | null {
  try {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
    return Application.nativeBuildVersion ?? null;
  } catch {
    return null;
  }
}

/** expo-updatesの値を読む。取れない・想定外の形の場合はundefinedを返す（落とさない）。 */
function readUpdatesInfo(): AppVersionInfoUpdates | undefined {
  try {
    if (typeof Updates.isEmbeddedLaunch !== "boolean") return undefined;
    return {
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      updateId: Updates.updateId ?? null,
      createdAt: Updates.createdAt ?? null,
    };
  } catch {
    return undefined;
  }
}
