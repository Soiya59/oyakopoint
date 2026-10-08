/**
 * 古いビルドの人に「アップデートしてください」を出す仕組みの画面と、その判定を持つProvider。
 * 参照: 企画部/成果物/要件定義書.md 07-47章（決定1〜12・07-47追記）、設計部/成果物/API仕様.md 41章、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 73章（A1「必須」・A2「おすすめ」）、
 * 開発部/成果物/実装メモ.md 362章。
 *
 * [置き場所] app/_layout.tsx の SafeAreaProvider の直下・SessionProvider の**外**（73.2節）。
 * ログイン状態・ロール・家族を一切使わない（useSession()・useAppData()を呼ばない。決定2）。
 *
 * [閉じ込めない（決定5）] 次のどれでも何も出さずに通す: Web版／ビルド番号が読めない／通信できない／
 * 3秒を超える遅延／DBエラー・関数が無い／想定外の値／行が無い。起動を遅らせない（判定は裏で行い、
 * 結果が来てから上に重ねる。「確認中…」の画面は出さない）。再試行しない。
 * ここのコンポーネントが描画で例外を出しても、アプリ全体のエラー画面（AppErrorFallback）に
 * 巻き込まないよう、画面部分は専用のエラー境界で包んで何も出さずに通す（GateErrorBoundary）。
 *
 * [確認のタイミング（決定5）]
 *  - アプリを起動したとき: 「必須」「おすすめ」の両方。
 *  - バックグラウンドから戻ったとき: 「必須」だけ。前回の確認から1時間以上たっているときのみ。
 *    「おすすめ」は起動のときだけ（作業の途中で突然出さない）。
 *  - 「必須」が出たあとは、ストアへ行って戻っても出たままにする（更新されればアプリが作り直される）。
 *    DBの値を下げても、次の起動までは消えない（73.7節）。
 *
 * [重ならない順（73.2節 V3）] A1 ＞ A2 ＞ PushSoftAsk。Modalは同時に1つだけ出す。
 * PushSoftAskは `useAppUpdateGate().softAskAllowed` が偽の間（判定中・A1表示中・A2表示中）は出さない。
 *
 * [ビルド番号] `Application.nativeBuildVersion`（expo-application。src/components/AppVersionInfo.tsx
 * と同じ読み方）。ネイティブのライブラリは足していない（OTAで今のビルド iOS 24／Android 14 に届けるため）。
 *
 * [文言] 73.5節（＝要件定義書07-47章 決定6）の表から一字一句転記している。作っていない。
 * 73.5節で「本部署が足した」と明記されたもの（ストアを開けなかった文・ボタンの「ひらいています…」・
 * 読み上げ用の言い換え）だけが、決定6の表に無い。TestFlight向けの1文は足していない（07-47追記3）。
 */
import React, { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { AppStateStatus } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Application from "expo-application";
import AppButton from "@/components/AppButton";
import AppVersionInfo from "@/components/AppVersionInfo";
import Card from "@/components/Card";
import theme from "@/theme/theme";
import { fetchAppUpdatePolicy } from "@/data/api";
import { openExternalUrl } from "@/lib/externalLink";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  decideUpdateKind,
  parseOwnBuildNumber,
  platformFromOS,
  sanitizeStoreUrl,
  shouldRecheckRequired,
} from "@/lib/appUpdatePolicy";
import type { UpdateKind } from "@/lib/appUpdatePolicy";

// ---- 文言（73.5節の表。出典○＝企画部 決定6の表そのまま／△＝UIUXデザイン部が足したもの） ----
const REQUIRED_HEADING = "アップデートが ひつようです"; // ○
const REQUIRED_BODY = "おやこポイントを つづけて つかうには、アップデートしてください。"; // ○
const REQUIRED_FOR_CHILD = "こどもは、おうちの ひとに つたえてね。"; // ○
const RECOMMENDED_HEADING = "あたらしい バージョンが あります"; // ○
const RECOMMENDED_BODY = "アップデートすると、あたらしい きのうが つかえます。"; // ○
const RELIEF_BAND = "きろくは そのまま のこっています。"; // ○
const UPDATE_BUTTON = "アップデートする"; // ○
const LATER_BUTTON = "あとで"; // ○
const NO_LINK_SENTENCE = "ストアの アプリで『おやこポイント』を ひらいて、アップデートしてください。"; // ○（決定6・7）
const OPENING_LABEL = "ひらいています…"; // △
const OPEN_FAILED = "ストアを ひらけませんでした。もういちど ためしてね。"; // △

// 読み上げ用の言い換え（画面には出ない。漢字まじり。73.5節）
const A11Y_REQUIRED_HEADING = "アップデートが必要です";
const A11Y_RECOMMENDED_HEADING = "新しいバージョンがあります";
const A11Y_REQUIRED_BODY = "おやこポイントを続けて使うには、アップデートしてください。記録はそのまま残っています。子どもは、おうちの人に伝えてね。";
const A11Y_RECOMMENDED_BODY = "アップデートすると、新しい機能が使えます。記録はそのまま残っています。";
const A11Y_NO_LINK_SENTENCE = "ストアのアプリで『おやこポイント』を開いて、アップデートしてください。";
const A11Y_OPEN_FAILED = "ストアを開けませんでした。もう一度試してね。";

// ---- コンテキスト（PushSoftAskが読む） ----
interface AppUpdateGateContextValue {
  /** PushSoftAskを出してよいか。判定中・A1表示中・A2表示中は偽。 */
  softAskAllowed: boolean;
}

// Provider の外（想定していない）では「待たない」。ソフトアスクを止めてしまわないため。
const AppUpdateGateContext = createContext<AppUpdateGateContextValue>({ softAskAllowed: true });

export function useAppUpdateGate(): AppUpdateGateContextValue {
  return useContext(AppUpdateGateContext);
}

// ---- 自分のビルド番号 ----
/** `Application.nativeBuildVersion` を整数にする。読めなければ null（＝通す）。 */
function readOwnBuildNumber(): number | null {
  try {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
    return parseOwnBuildNumber(Application.nativeBuildVersion ?? null);
  } catch {
    return null;
  }
}

// ---- 画面部分の例外を握りつぶすエラー境界（アプリ全体を巻き込まない） ----
class GateErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("AppUpdateGate: 画面の描画で例外。何も出さずに通す", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ---- Provider ----
export function AppUpdateGateProvider({ children }: { children: React.ReactNode }) {
  const platform = platformFromOS(Platform.OS);
  const ownBuild = useMemo(() => readOwnBuildNumber(), []);
  // Web・番号が読めない・Supabase未設定のときは、判定自体をしない（受け入れ条件11・決定5）。
  const enabled = platform !== null && ownBuild !== null && isSupabaseConfigured();

  const [settled, setSettled] = useState(!enabled);
  const [kind, setKind] = useState<UpdateKind>("none");
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [recommendedDismissed, setRecommendedDismissed] = useState(false);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const lastCheckedAtRef = useRef<number | null>(null);
  const kindRef = useRef<UpdateKind>("none");

  const runCheck = useCallback(
    async (mode: "launch" | "resume") => {
      if (!enabled || platform === null || ownBuild === null) {
        setSettled(true);
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      lastCheckedAtRef.current = Date.now();
      try {
        // fetchAppUpdatePolicyは例外を投げない。失敗・3秒超過・想定外の形はすべてnull。
        const policy = await fetchAppUpdatePolicy(platform);
        if (!mountedRef.current) return;
        const decided = decideUpdateKind(ownBuild, policy);
        const url = policy ? sanitizeStoreUrl(policy.storeUrl) : null;
        if (decided === "required") {
          kindRef.current = "required";
          setStoreUrl(url);
          setKind("required");
        } else if (decided === "recommended" && mode === "launch" && kindRef.current === "none") {
          // 「おすすめ」は起動のときだけ。復帰時に新しく出さない。
          kindRef.current = "recommended";
          setStoreUrl(url);
          setKind("recommended");
        }
      } catch {
        // 何があっても通す。
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current && mode === "launch") setSettled(true);
      }
    },
    [enabled, platform, ownBuild]
  );

  // 起動時に1回だけ確認する。結果を待たずに子を描く（起動を遅らせない）。
  useEffect(() => {
    mountedRef.current = true;
    void runCheck("launch");
    return () => {
      mountedRef.current = false;
    };
  }, [runCheck]);

  // バックグラウンドから戻ったとき、「必須」だけを確かめ直す（前回の確認から1時間以上たっているとき）。
  useEffect(() => {
    if (!enabled) return;
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      const wasInactive = prev !== "active";
      prev = next;
      if (next !== "active" || !wasInactive) return;
      if (kindRef.current === "required") return; // 出たまま。確かめ直す必要がない
      if (!shouldRecheckRequired(lastCheckedAtRef.current, Date.now())) return;
      void runCheck("resume");
    });
    return () => sub.remove();
  }, [enabled, runCheck]);

  const shown: UpdateKind = kind === "required" ? "required" : kind === "recommended" && !recommendedDismissed ? "recommended" : "none";
  const softAskAllowed = settled && shown === "none";
  const value = useMemo(() => ({ softAskAllowed }), [softAskAllowed]);
  const dismissRecommended = useCallback(() => setRecommendedDismissed(true), []);

  return (
    <AppUpdateGateContext.Provider value={value}>
      {children}
      <GateErrorBoundary>
        {shown === "required" ? <UpdateRequiredModal storeUrl={storeUrl} /> : null}
        {shown === "recommended" ? <UpdateRecommendedModal storeUrl={storeUrl} onLater={dismissRecommended} /> : null}
      </GateErrorBoundary>
    </AppUpdateGateContext.Provider>
  );
}

// ---- ストアを開く（連打防止・開けなかったときの1文） ----
function useOpenStore(storeUrl: string | null) {
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const openingRef = useRef(false);
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    openingRef.current = false;
    if (aliveRef.current) setOpening(false);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // ストアから戻ってきたら、ボタンを押せる状態に戻す（73.7節）。
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && openingRef.current) release();
    });
    return () => {
      aliveRef.current = false;
      sub.remove();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [release]);

  useEffect(() => {
    if (openFailed) {
      void AccessibilityInfo.announceForAccessibility(A11Y_OPEN_FAILED);
    }
  }, [openFailed]);

  const open = useCallback(async () => {
    if (!storeUrl || openingRef.current) return; // 連打は先頭で弾く
    openingRef.current = true;
    setOpening(true);
    setOpenFailed(false);
    const ok = await openExternalUrl(storeUrl);
    if (!aliveRef.current) return;
    if (!ok) {
      // 黙って失敗しない（externalLink.tsの要件）。すぐ押し直せる状態に戻す。
      setOpenFailed(true);
      release();
      return;
    }
    // 開けた。戻ったとき（AppStateがactive）か2秒のどちらか早いほうでボタンを戻す。
    timerRef.current = setTimeout(release, 2000);
  }, [storeUrl, release]);

  return { opening, openFailed, open };
}

// ---- 共通の中身 ----
function ReliefBand() {
  return (
    <View style={styles.band}>
      <Text style={[theme.typography.supporterBody, styles.centerText, { color: theme.colors.neutralTextPrimary }]}>
        {RELIEF_BAND}
      </Text>
    </View>
  );
}

function OpenFailedBox({ withNoLinkSentence }: { withNoLinkSentence: boolean }) {
  return (
    <View style={styles.failedBox} accessibilityLiveRegion="polite">
      <Text style={[theme.typography.supporterBody, styles.centerText, { color: theme.colors.neutralTextPrimary }]}>
        {OPEN_FAILED}
      </Text>
      {withNoLinkSentence ? (
        <Text style={[theme.typography.supporterBody, styles.centerText, { color: theme.colors.neutralTextPrimary }]}>
          {NO_LINK_SENTENCE}
        </Text>
      ) : null}
    </View>
  );
}

// ---- A1「必須」: 閉じられない全画面（73.3節） ----
export function UpdateRequiredModal({ storeUrl }: { storeUrl: string | null }) {
  const insets = useSafeAreaInsets();
  const { opening, openFailed, open } = useOpenStore(storeUrl);
  const hasLink = storeUrl !== null;
  const a11yBody = hasLink ? A11Y_REQUIRED_BODY : `${A11Y_REQUIRED_BODY}${A11Y_NO_LINK_SENTENCE}`;

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      // 戻る操作（Androidの戻るボタン・戻るジェスチャー）は何も起きない。ホームボタンやアプリの切り替えは止めない。
      onRequestClose={() => {}}
    >
      <View style={styles.requiredRoot} accessibilityViewIsModal>
        <ScrollView
          contentContainerStyle={[
            styles.requiredScroll,
            { paddingTop: insets.top + theme.spacing.s8, paddingBottom: insets.bottom + theme.spacing.s8 },
          ]}
        >
          <View style={styles.requiredInner}>
            <Text style={styles.emojiLarge} accessible={false} importantForAccessibility="no">
              {"\u{1F4F2}"}
            </Text>
            <Text
              style={[theme.typography.supporterTitle, styles.centerText, styles.heading]}
              accessibilityRole="header"
              accessibilityLabel={A11Y_REQUIRED_HEADING}
            >
              {REQUIRED_HEADING}
            </Text>
            <View accessible accessibilityLabel={a11yBody} style={styles.groupFull}>
              <Text style={[theme.typography.supporterBody, styles.centerText, styles.bodyText]}>{REQUIRED_BODY}</Text>
              <ReliefBand />
              <Text style={[theme.typography.supporterBody, styles.centerText, styles.secondaryText]}>
                {REQUIRED_FOR_CHILD}
              </Text>
              {!hasLink ? (
                <Text style={[theme.typography.supporterBody, styles.centerText, styles.noLinkText]}>
                  {NO_LINK_SENTENCE}
                </Text>
              ) : null}
            </View>
            {hasLink ? (
              <View style={styles.buttonArea}>
                {openFailed ? <OpenFailedBox withNoLinkSentence /> : null}
                <AppButton
                  label={opening ? OPENING_LABEL : UPDATE_BUTTON}
                  tone="child"
                  fullWidth
                  disabled={opening}
                  onPress={() => void open()}
                  accessibilityHint="ストアのページを開きます"
                />
              </View>
            ) : null}
            {/* V14: 統括が「ビルドいくつ？」と聞くための小さな行。ロールが分からない段階で出るため、
                AppVersionInfo.tsxの「子どもには出さない」の例外とする。 */}
            <AppVersionInfo tone="parent" />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---- A2「おすすめ」: 画面を覆わない小さなカード（73.4節） ----
export function UpdateRecommendedModal({ storeUrl, onLater }: { storeUrl: string | null; onLater: () => void }) {
  const { height } = useWindowDimensions();
  const { opening, openFailed, open } = useOpenStore(storeUrl);
  const hasLink = storeUrl !== null;
  const a11yBody = hasLink ? A11Y_RECOMMENDED_BODY : `${A11Y_RECOMMENDED_BODY}${A11Y_NO_LINK_SENTENCE}`;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // 戻る操作（Android）は「あとで」と同じ。外側（うす暗い部分）のタップは何もしない。
      onRequestClose={onLater}
    >
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card tone="child" style={{ ...styles.recommendedCard, maxHeight: height * 0.7 }}>
          <ScrollView style={styles.recommendedScroll} contentContainerStyle={styles.recommendedScrollContent}>
            <Text style={styles.emojiSmall} accessible={false} importantForAccessibility="no">
              {"\u{1F4F2}"}
            </Text>
            <Text
              style={[theme.typography.supporterTitle, styles.centerText, styles.heading]}
              accessibilityRole="header"
              accessibilityLabel={A11Y_RECOMMENDED_HEADING}
            >
              {RECOMMENDED_HEADING}
            </Text>
            <View accessible accessibilityLabel={a11yBody} style={styles.groupFull}>
              <Text style={[theme.typography.supporterBody, styles.centerText, styles.bodyText]}>{RECOMMENDED_BODY}</Text>
              <ReliefBand />
              {!hasLink ? (
                <Text style={[theme.typography.supporterBody, styles.centerText, styles.noLinkText]}>
                  {NO_LINK_SENTENCE}
                </Text>
              ) : null}
            </View>
          </ScrollView>
          {/* ボタンはスクロールの外に固定して、文字が大きい端末でも常に見える */}
          <View style={styles.recommendedButtons}>
            {openFailed ? <OpenFailedBox withNoLinkSentence={false} /> : null}
            {hasLink ? (
              <AppButton
                label={opening ? OPENING_LABEL : UPDATE_BUTTON}
                tone="child"
                fullWidth
                disabled={opening}
                onPress={() => void open()}
                accessibilityHint="ストアのページを開きます"
              />
            ) : null}
            <AppButton
              label={LATER_BUTTON}
              tone="child"
              variant="secondary"
              fullWidth
              onPress={onLater}
              style={hasLink ? styles.laterButtonSpaced : undefined}
              accessibilityHint="いまは閉じて、あとでアップデートします"
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centerText: { textAlign: "center" },
  emojiLarge: { fontSize: 48, textAlign: "center", marginBottom: theme.spacing.s3 },
  emojiSmall: { fontSize: 32, textAlign: "center", marginBottom: theme.spacing.s2 },
  heading: { color: theme.colors.neutralTextPrimary },
  bodyText: { color: theme.colors.neutralTextPrimary, lineHeight: 24, marginTop: theme.spacing.s3 },
  secondaryText: { color: theme.colors.neutralTextSecondary, lineHeight: 24, marginTop: theme.spacing.s3 },
  noLinkText: { color: theme.colors.neutralTextPrimary, lineHeight: 24, marginTop: theme.spacing.s3 },
  groupFull: { width: "100%", alignItems: "center" },
  band: {
    width: "100%",
    marginVertical: theme.spacing.s3,
    padding: theme.spacing.s3,
    borderRadius: theme.radius.parentLg,
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  failedBox: {
    width: "100%",
    marginBottom: theme.spacing.s3,
    padding: theme.spacing.s3,
    borderRadius: theme.radius.parentLg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.statusPendingSoft,
  },
  // A1
  requiredRoot: { flex: 1, backgroundColor: theme.colors.neutralBg },
  requiredScroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s6,
  },
  requiredInner: { width: "100%", maxWidth: 480, alignItems: "center" },
  buttonArea: { width: "100%", marginTop: theme.spacing.s6 },
  // A2
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  recommendedCard: { width: "100%", maxWidth: 480, alignItems: "center", padding: theme.spacing.s6 },
  recommendedScroll: { flexGrow: 0, flexShrink: 1, width: "100%" },
  recommendedScrollContent: { alignItems: "center" },
  recommendedButtons: { width: "100%", marginTop: theme.spacing.s4 },
  laterButtonSpaced: { marginTop: theme.spacing.s3 },
});
