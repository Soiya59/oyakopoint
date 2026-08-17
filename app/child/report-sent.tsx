import React from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";

/**
 * C7 報告完了（送信済み）
 * 参照: 主要画面ワイヤーフレーム.md 2章 トーン設計メモ、画面一覧・遷移図.md C7
 *
 * [2026-08-15改訂] 承認フロー廃止に伴い「承認待ち」の説明を廃止した（審査待ち状態が
 * 存在しないため）。唯一の成功状態として「とどいたよ！」＋ポイントが確定したことを
 * 伝える表現に統一する。「みてもらうよ」「審査中」という、確認・審査を待たせる
 * ニュアンスの表現は子ども向けには一切使わない（ポイントは送信と同時にすでに確定している）。
 * あくまで任意・控えめな一言として「おうちの人にもとどいたよ」（＝通知が飛んだことの説明で
 * あり、承認を待つ説明ではない）程度の表現に留める。
 */
export default function ReportSentScreen() {
  const { choreTitle, points } = useLocalSearchParams<{ choreTitle?: string; points?: string }>();

  return (
    <Screen tone="child">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 56 }}>🎉</Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4, textAlign: "center" }]}>
          とどいたよ！
        </Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
          {points ? `「${choreTitle}」+${points}ptとどいたよ！` : `「${choreTitle}」のポイントがとどいたよ`}
        </Text>
        <Text
          style={[
            theme.typography.parentCaption,
            { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.neutralTextSecondary },
          ]}
        >
          おうちの人にもとどいたよ
        </Text>
      </View>
      <AppButton
        label="やることリストへもどる"
        tone="child"
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() => router.replace("/child/home")}
      />
    </Screen>
  );
}
