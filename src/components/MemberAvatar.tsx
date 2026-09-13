import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import theme from "@/theme/theme";
import { avatarLineDisplayStrokeWidth, pointsToPolylineString } from "./DrawingCanvas";
import type { FamilyDrawingLineData } from "@/types/domain";

/**
 * [2026-09-13追加・主要画面ワイヤーフレーム.md 43.11節、実装メモ218章]
 * 拡大表示（`expandOnTap`有効時）で自分自身を再描画する際の絵の大きさ。
 * `CollectorShelfPanel.tsx`が「大きく見せるとき」に採用済みの値（`StickerIcon
 * size={220} highRes`・`DrawingThumbnail size={220}`）に合わせ、新しい数値を作らない。
 */
const EXPANDED_AVATAR_SIZE = 220;

interface MemberAvatarProps {
  name: string;
  color?: string | null;
  size?: number;
  emoji?: string;
  /**
   * [2026-09-11追加・要件定義書07-27章決定21、主要画面ワイヤーフレーム.md 43.4節]
   * `member_avatars.line_data`（メンバーが自分で描いたアバターの絵）。渡されて
   * `lines`が1本以上ある場合は、色丸（既存どおり）の上に決定17〜20のルールに従って
   * 線を重ねて描画し、頭文字は表示しない。無い場合（未設定・DELETE済み）は
   * 現状どおり頭文字を表示する（決定1の「デフォルトは現状のまま」をこの
   * コンポーネント内だけで完結させる）。`emoji`が渡された場合は`lineData`より
   * `emoji`を優先する（既存の頭文字より優先する現行の優先順位をそのまま延長）。
   */
  lineData?: FamilyDrawingLineData | null;
  /**
   * [2026-09-13追加・主要画面ワイヤーフレーム.md 43.11.C節、実装メモ218章]
   * `true`のときだけ丸全体を`Pressable`にし、タップで本人の絵（またはフォールバックの
   * 色＋頭文字の丸）を220pxで拡大表示するモーダルを開く。**既定値は`false`**。
   * 31か所あるうち「アバターを押すこと自体が別の意味を持つ画面」（プロフィール選択・
   * 切替、送り先選択、絞り込み等）に誤って拡大を有効化すると既存の主要操作が壊れる一方、
   * 付け忘れの被害は「その1か所だけ拡大できない」で済むため、事故の非対称性を根拠に
   * 既定オフとした（43.11.C節）。
   */
  expandOnTap?: boolean;
}

/**
 * 色付き丸アイコン＋イニシャル/絵文字でメンバーを識別する表現
 * （デザイントークン.md 1.3。family-todoの表現を継承）。
 *
 * [2026-09-11変更] `DrawingThumbnail`とは別に自前でSvgを組み立てる（`DrawingThumbnail`を
 * そのまま呼ぶと1px枠線〈styles.thumbnail〉が付き、既存のMemberAvatarの見た目
 * 〈枠線なし〉が27箇所すべてで変わってしまうため）。線の縁取り・太さのルールは
 * `DrawingCanvas.tsx`の`avatarLineDisplayStrokeWidth`・`pointsToPolylineString`を
 * 共有し、`DrawingThumbnail`と挙動をそろえる。
 */
export function MemberAvatar({ name, color, size = 40, emoji, lineData, expandOnTap = false }: MemberAvatarProps) {
  const [expanded, setExpanded] = useState(false);
  const initial = name.trim().slice(0, 1) || "?";
  const backgroundColor = color ?? theme.colors.neutralBorder;
  const showDrawing = !emoji && !!lineData && lineData.lines.length > 0;

  // [2026-09-13追加・実装メモ218章] 丸本体の描画（色＋頭文字/絵文字、または線画）を
  // 引数の`circleSize`で再利用できるよう関数化。拡大表示（220px）でも同じ分岐を使い、
  // `DrawingThumbnail`との二重実装を避ける（43.11.D申し送り2）。
  const renderCircle = (circleSize: number) => {
    if (!showDrawing) {
      return (
        <View
          style={[
            styles.circle,
            {
              width: circleSize,
              height: circleSize,
              borderRadius: circleSize / 2,
              backgroundColor,
            },
          ]}
        >
          <Text style={{ fontSize: circleSize * 0.45, fontWeight: "700", color: theme.colors.neutralTextPrimary }}>
            {emoji ?? initial}
          </Text>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.circle,
          { width: circleSize, height: circleSize, borderRadius: circleSize / 2, overflow: "hidden" },
        ]}
      >
        <Svg width={circleSize} height={circleSize}>
          <Circle cx={circleSize / 2} cy={circleSize / 2} r={circleSize / 2} fill={backgroundColor} />
          {lineData!.lines.map((line, idx) => {
            const displayStrokeWidth = avatarLineDisplayStrokeWidth(circleSize, line.w);
            const points = pointsToPolylineString(line.p, circleSize);
            const needsWhiteOutline = line.c === "#FFFFFF";
            return (
              <React.Fragment key={idx}>
                {needsWhiteOutline && (
                  <Polyline
                    points={points}
                    fill="none"
                    stroke={theme.colors.neutralTextPrimary}
                    strokeWidth={displayStrokeWidth + 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                <Polyline
                  points={points}
                  fill="none"
                  stroke={line.c}
                  strokeWidth={displayStrokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    );
  };

  const circle = renderCircle(size);

  if (!expandOnTap) {
    return circle;
  }

  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${name}の絵を大きく見る`}
      >
        {circle}
      </Pressable>
      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <Pressable
          style={styles.overlay}
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="閉じる"
        >
          {/* [2026-09-13] カード自体は無反応のPressableで包み、背景タップの
              クローズ（上のPressable）にタップイベントが伝播しないようにする。 */}
          <Pressable onPress={() => {}} style={styles.expandedCard}>
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={8}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="閉じる"
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
            {renderCircle(EXPANDED_AVATAR_SIZE)}
            <Text style={styles.expandedCaption}>「{name}」の絵</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  expandedCard: {
    alignItems: "center",
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentLg,
    paddingHorizontal: theme.spacing.s4,
    paddingTop: theme.spacing.s6,
    paddingBottom: theme.spacing.s4,
  },
  closeButton: {
    position: "absolute",
    top: theme.spacing.s2,
    right: theme.spacing.s2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.neutralTextPrimary,
    lineHeight: 20,
  },
  expandedCaption: {
    marginTop: theme.spacing.s3,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.neutralTextPrimary,
  },
});

export default MemberAvatar;
