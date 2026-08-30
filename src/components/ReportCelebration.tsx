/**
 * 完了報告のお祝いポップアップ（保護者・みまもりメンバー向け）。
 *
 * [2026-08-29追加・本部長／軽微変更ルート]
 *
 * ■ 経緯
 * ユーザーの「保護者・みまもりの完了画面にも同じ演出がよい」という要望から始まったが、
 * 調べると**大人には完了画面が存在しなかった**。報告すると一覧へ直行し、
 * 「きろくしました +1pt」という細い帯が1.5秒出るだけだった。これは意図的な設計で、
 * 07-4章・主要画面ワイヤーフレーム.md 9.2章が「新しい画面へは遷移せず、控えめな
 * 確認表示にとどめる」（＝子どもは達成を称える／大人は淡々とした記録）と定めていた。
 *
 * 本部長から「全画面を新設すると報告のたびに戻るボタンが1タップ増える」と伝えたところ、
 * ユーザーから**「ポップアップみたいな感じで表示されて、数秒後は消えるけど、×でも
 * 消せるような仕様はどうかな？　一番は軽さだから、それで重くなるのであれば、やめたい」**
 * という案が出た。これがAB両案の利点を取れるため採用した。
 *
 * - 画面遷移が無いので**戻る操作が増えない**（＝軽い。重さの正体は演出ではなく遷移）
 * - 画面中央に大きく出るので、帯より達成感がある
 * - 数秒で自動的に消え、×でも即座に閉じられる
 *
 * ■ 軽さのために守っていること
 * - ライブラリを追加しない（`Animated`のみ。Confetti.tsx参照）
 * - 音を入れない（ライブラリ追加＋ブラウザの自動再生制限。アプリ化以降に再検討）
 * - `Modal`ではなく絶対配置のオーバーレイにする（Web版でのModalの挙動差を避け、
 *   一覧の再レンダーも起こさないため）
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text } from "react-native";
import Confetti from "./Confetti";
import GachaCelebrationHint from "./GachaCelebrationHint";
import theme from "@/theme/theme";

/** 自動で閉じるまで。子どもの完了画面が自動でホームへ戻るまでの時間と揃えている。 */
const AUTO_DISMISS_MS = 3000;

export interface ReportCelebrationProps {
  tone: "parent" | "supporter";
  /** 報告したクエスト名。 */
  title: string;
  /** 加算されたポイント。 */
  points: string;
  /** 報告した本人（ガチャ残数の取得に使う）。 */
  memberId: string | null;
  onDismiss: () => void;
}

export function ReportCelebration({
  tone,
  title,
  points,
  memberId,
  onDismiss,
}: ReportCelebrationProps) {
  const isSupporter = tone === "supporter";
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(pop, { toValue: 1.08, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();

    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [pop, onDismiss]);

  const bodyStyle = isSupporter ? theme.typography.supporterBody : theme.typography.parentBody;
  const titleStyle = isSupporter ? theme.typography.supporterTitle : theme.typography.parentTitle;

  return (
    // 背面をタップしても閉じられる（急いでいるときに×を狙わなくてよい）。
    <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="閉じる">
      <Animated.View style={[styles.card, { transform: [{ scale: pop }] }]}>
        <Confetti height={200} />

        <Pressable onPress={onDismiss} hitSlop={12} style={styles.close} accessibilityLabel="閉じる">
          <Text style={styles.closeText}>×</Text>
        </Pressable>

        <Text style={styles.emoji}>🎉</Text>
        <Text style={[titleStyle, styles.center]}>きろくしました</Text>
        <Text style={[bodyStyle, styles.center, styles.title]}>{title}</Text>
        <Text style={styles.points}>+{points}pt</Text>

        <GachaCelebrationHint tone={tone} memberId={memberId} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(27, 32, 25, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s6,
    zIndex: 10,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentLg,
    paddingVertical: theme.spacing.s8,
    paddingHorizontal: theme.spacing.s6,
    alignItems: "center",
    overflow: "hidden",
  },
  close: { position: "absolute", top: theme.spacing.s2, right: theme.spacing.s3, zIndex: 2 },
  closeText: { fontSize: 22, color: theme.colors.neutralTextSecondary },
  emoji: { fontSize: 48 },
  center: { textAlign: "center" },
  title: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  points: {
    marginTop: theme.spacing.s2,
    marginBottom: theme.spacing.s4,
    fontSize: 28,
    fontWeight: "700",
    color: theme.colors.brandPrimaryStrong,
  },
});

export default ReportCelebration;
