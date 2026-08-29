/**
 * 画面いちばん上の戻る導線。
 *
 * [2026-08-29追加・本部長／軽微変更ルート] ユーザーの実機指摘
 * 「完了報告のホームへ戻るについて、一番下までスクロールしないといけないので、
 *  上にもどるボタンあればよい。他も同じかも」への対応。
 *
 * 保護者・みまもり向けの画面は「ホームへ戻る」を画面の最下部にだけ置いていた。
 * 完了報告一覧や実施履歴のように縦に長い画面では、戻るためだけに全部スクロール
 * する必要があり、実質的に戻れない導線になっていた。
 * （子ども向け画面と、掲示板・コレクション等の後発画面には既に「← もどる」が
 * 上部にあり、パターン自体は確立していた。それを全画面に揃える。）
 *
 * 行き先は呼び出し側が決める。`router.back()` は履歴の状態次第で行き先が変わり、
 * 「ホームへ戻る」と名乗りながらホーム以外に着くことがあるため使わない
 * （同日に判明した不具合。実装メモ.md 86章参照）。
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import theme from "@/theme/theme";

export interface ScreenBackLinkProps {
  tone: "parent" | "supporter";
  /** 押したときの遷移。ホームへ戻す場合は router.replace("/parent/home") 等を渡す。 */
  onPress: () => void;
  /** 既定は「← ホームへ戻る」。別の場所へ戻す画面はここで上書きする。 */
  label?: string;
}

export function ScreenBackLink({ tone, onPress, label = "← ホームへ戻る" }: ScreenBackLinkProps) {
  const textStyle = tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  return (
    <Pressable onPress={onPress} style={styles.hit} hitSlop={8}>
      <Text style={[textStyle, styles.text]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 保護者44dp・みまもり48dpのタップターゲット下限を、高さで確保する
  // （デザイントークン.md 1.7節）。
  hit: {
    minHeight: theme.tapTarget.parent,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingRight: theme.spacing.s3,
  },
  text: { color: theme.colors.brandPrimaryStrong },
});

export default ScreenBackLink;
