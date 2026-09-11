import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import theme from "@/theme/theme";
import { avatarLineDisplayStrokeWidth, pointsToPolylineString } from "./DrawingCanvas";
import type { FamilyDrawingLineData } from "@/types/domain";

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
export function MemberAvatar({ name, color, size = 40, emoji, lineData }: MemberAvatarProps) {
  const initial = name.trim().slice(0, 1) || "?";
  const backgroundColor = color ?? theme.colors.neutralBorder;
  const showDrawing = !emoji && !!lineData && lineData.lines.length > 0;

  if (!showDrawing) {
    return (
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor,
          },
        ]}
      >
        <Text style={{ fontSize: size * 0.45, fontWeight: "700", color: theme.colors.neutralTextPrimary }}>
          {emoji ?? initial}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, overflow: "hidden" },
      ]}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={backgroundColor} />
        {lineData!.lines.map((line, idx) => {
          const displayStrokeWidth = avatarLineDisplayStrokeWidth(size, line.w);
          const points = pointsToPolylineString(line.p, size);
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
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
});

export default MemberAvatar;
