import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";

/**
 * C14 NFCタップ完了
 * 参照: 主要画面ワイヤーフレーム.md 7.3章、画面一覧・遷移図.md 3.7節
 *
 * [2026-08-15改訂] 承認フロー廃止（要件定義書.md v0.5、スキーマ設計.sql v2.0で
 * chores.requires_approval列自体を削除）に伴い、旧「承認待ち」状態を削除した。
 * NFC経由の完了報告は常に「即時加点」の1状態のみになる（主要画面ワイヤーフレーム.md
 * 7.0決定1「NFC経由の完了報告は常に『即時加点』の1状態のみになる」参照）。
 *
 * 状態: 即時加点（常に）／上限到達／タグ未登録・他家族のタグ／通信エラー の4状態。
 * 「取り消す」導線は持たない（主要画面ワイヤーフレーム.md 7.0決定4で撤回済み。
 * chore_completionsに子ども自身によるUPDATE/DELETEを許すRLSポリシーが存在しないため）。
 *
 * [2026-08-15改訂] 旧「あとで写真・メモをつける」リンクは撤回された
 * （主要画面ワイヤーフレーム.md 7.0決定5・7.4節【撤回】参照）。「取り消す」導線と
 * 全く同じ理由（chore_completionsに子ども自身によるUPDATEを許すRLSポリシーが
 * 存在しない）のため、即時加点状態は演出＋「やることリストへもどる」ボタンのみの
 * 1状態に戻した。実装メモ.md 11章参照。
 */
type ResultParam = "approved" | "limitReached" | "notFound" | "networkError";

export default function NfcCompleteScreen() {
  const params = useLocalSearchParams<{
    result?: string;
    choreId?: string;
    choreTitle?: string;
    choreEmoji?: string;
    points?: string;
    tagValue?: string;
  }>();
  const result = (params.result as ResultParam) ?? "notFound";

  const goHome = () => router.replace("/child/home");

  if (result === "approved") {
    return (
      <Screen tone="child">
        <View style={styles.centerBlock}>
          <Text style={styles.bigEmoji}>🌟🎉🌟</Text>
          <Text style={[theme.typography.childHeadline, styles.centerText, { marginTop: theme.spacing.s4 }]}>
            「{params.choreTitle}」とどいたよ！
          </Text>
          <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s2, color: theme.colors.brandPrimaryStrong }]}>
            +{params.points}pt
          </Text>
        </View>
        <AppButton label="やることリストへもどる" tone="child" fullWidth style={{ marginTop: theme.spacing.s8 }} onPress={goHome} />
      </Screen>
    );
  }

  if (result === "limitReached") {
    return (
      <Screen tone="child">
        <View style={styles.centerBlock}>
          <Text style={styles.bigEmoji}>🌟✅🌟</Text>
          <Text style={[theme.typography.childHeadline, styles.centerText, { marginTop: theme.spacing.s4 }]}>
            きょうの「{params.choreTitle}」は{"\n"}もう たっぷりやったよ！
          </Text>
          <Text style={[theme.typography.childBody, styles.centerText, { marginTop: theme.spacing.s3 }]}>
            またあした ためしてね
          </Text>
        </View>
        <AppButton label="やることリストへもどる" tone="child" fullWidth style={{ marginTop: theme.spacing.s8 }} onPress={goHome} />
      </Screen>
    );
  }

  if (result === "notFound") {
    return (
      <Screen tone="child">
        <View style={styles.centerBlock}>
          <Text style={styles.bigEmoji}>🤔📶</Text>
          <Text style={[theme.typography.childHeadline, styles.centerText, { marginTop: theme.spacing.s4 }]}>
            このタグは よみとれなかったよ
          </Text>
          <Text style={[theme.typography.childBody, styles.centerText, { marginTop: theme.spacing.s3 }]}>
            おうちの人にきいてみてね
          </Text>
        </View>
        <AppButton label="やることリストへもどる" tone="child" fullWidth style={{ marginTop: theme.spacing.s8 }} onPress={goHome} />
      </Screen>
    );
  }

  // networkError
  return (
    <Screen tone="child">
      <View style={styles.centerBlock}>
        <Text style={theme.typography.childBody}>⚠ とどきませんでした…</Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>もういちど タグに近づけてね</Text>
      </View>
      <AppButton
        label="もういちど"
        tone="child"
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() =>
          router.replace({ pathname: "/child/nfc-scan", params: { tagValue: params.tagValue ?? "" } })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  centerText: { textAlign: "center" },
  bigEmoji: { fontSize: 40 },
});
