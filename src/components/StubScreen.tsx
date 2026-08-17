import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "./Screen";
import AppButton from "./AppButton";
import theme from "@/theme/theme";

interface StubScreenProps {
  screenCode: string;
  title: string;
  purpose: string;
  elements: string[];
  tone?: "parent" | "child";
  nextLabel?: string;
  onNext?: () => void;
}

/**
 * スタブ画面共通レイアウト。
 * 画面一覧・遷移図.md の「画面名 / 目的 / 主要要素」列をそのまま表示することで、
 * どの設計文書のどの画面に対応するスタブなのかを実装上も追跡できるようにする。
 * 主要5画面（C5/C6/P8/P16・C8/C9〜C11）はこのコンポーネントを使わず、
 * 個別に実装している。
 */
export function StubScreen({
  screenCode,
  title,
  purpose,
  elements,
  tone = "parent",
  nextLabel,
  onNext,
}: StubScreenProps) {
  return (
    <Screen tone={tone}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{screenCode}</Text>
      </View>
      <Text style={tone === "child" ? theme.typography.childHeadline : theme.typography.parentTitle}>
        {title}
      </Text>
      <Text style={[theme.typography.parentBody, styles.purpose]}>{purpose}</Text>

      <View style={styles.elementsBox}>
        <Text style={[theme.typography.parentCaption, styles.elementsTitle]}>主要要素（設計書より）</Text>
        {elements.map((el, i) => (
          <Text key={i} style={[theme.typography.parentBody, styles.elementRow]}>
            ・{el}
          </Text>
        ))}
      </View>

      <View style={styles.stubNotice}>
        <Text style={theme.typography.parentCaption}>
          このスタブ画面は「画面一覧・遷移図.md」に定義されているプレースホルダーです。主要5画面（C5/C6/P8/P16・C8/C9〜C11）はワイヤーフレーム準拠の実UIを別途実装しています。
        </Text>
      </View>

      {onNext ? (
        <AppButton label={nextLabel ?? "つぎへ"} onPress={onNext} tone={tone} style={{ marginTop: theme.spacing.s6 }} />
      ) : null}
      <AppButton
        label="戻る"
        variant="secondary"
        onPress={() => router.back()}
        tone={tone}
        style={{ marginTop: theme.spacing.s3 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.brandPrimarySoft,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s1,
    borderRadius: theme.radius.parentMd,
    marginBottom: theme.spacing.s3,
  },
  badgeText: { color: theme.colors.brandPrimaryStrong, fontWeight: "700", fontSize: 12 },
  purpose: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  elementsBox: {
    marginTop: theme.spacing.s6,
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentLg,
    padding: theme.spacing.s4,
  },
  elementsTitle: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
  elementRow: { marginTop: theme.spacing.s1 },
  stubNotice: {
    marginTop: theme.spacing.s4,
    padding: theme.spacing.s3,
    backgroundColor: theme.colors.statusPendingSoft,
    borderRadius: theme.radius.parentMd,
  },
});

export default StubScreen;
