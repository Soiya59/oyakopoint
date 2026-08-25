import React from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";

/**
 * C25 おえかき できたよ（子ども、保存成功の全画面演出）
 * 参照: 画面一覧・遷移図.md C25、主要画面ワイヤーフレーム.md 21.5節
 *
 * 「まだひみつ」であることを、欠落・制限としてではなく前向きな秘密として伝える
 * （21.7節トーン設計メモ「お絵かきの秘匿性」）。「はずれ」「非公開」等の否定表現、
 * 「上限に達しました」等の制限表現は一切使わない。
 */
export default function ChildDrawingDoneScreen() {
  return (
    <Screen tone="child">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 56 }}>✨</Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4, textAlign: "center" }]}>
          ひみつが うまれたよ！
        </Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
          だれかが みつけてくれるまで{"\n"}ないしょだよ
        </Text>
        <AppButton
          label="ホームに もどる"
          tone="child"
          fullWidth
          style={{ marginTop: theme.spacing.s8 }}
          onPress={() => router.replace("/child/home")}
        />
      </View>
    </Screen>
  );
}
