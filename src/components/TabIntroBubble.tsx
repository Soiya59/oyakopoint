/**
 * タブごとの案内カード（そのタブを初めて開いたときに1つだけ出る、50.2節）。
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 50.2節（決定5〜7・17〜19）、
 * 開発部/成果物/実装メモ.md 247章。
 *
 * [部品（決定5）] 新しいUIパターンは作らない。既存の`Card`＋既存の丸型×ボタン
 * （`MemberAvatar.tsx`拡大表示の閉じるボタンと同型）を組み合わせるだけ。
 * [位置（決定6）] 各タブ画面の共通ヘッダーの直下、他のどのカードよりも上に
 * 呼び出し元が配置すること（本コンポーネント自身はレイアウト上の位置を強制しない、
 * 呼び出し側で最初に置くだけでよい）。
 * [閉じ方（決定7）] ×ボタンのタップのみ。背景タップ・スワイプは無い
 * （オーバーレイではなくインライン配置のため、そもそも「背景」に相当する領域が無い）。
 *
 * [記録先] `src/lib/introSeen.ts`に`{kind:"tab", tabKey}`のキーで記録する
 * （50.3節決定9・10）。memberIdごとに個別のキーのため、1台の端末で複数の
 * 子どもプロフィールを切り替えても、きょうだいの一方が閉じた案内がもう一方にも
 * 出なくなる、という誤動作は起きない。
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import theme from "@/theme/theme";
import { hydrateIntroSeen, isIntroSeen, markIntroSeen, subscribeIntroSeen } from "@/lib/introSeen";

type Tone = "parent" | "child" | "supporter";

export interface TabIntroBubbleProps {
  /** `50.3節`決定10のキー例（`parent.family`のようにロール＋タブ名を組み合わせた固定文字列）。 */
  tabKey: string;
  tone: Tone;
  /** 50.2.1節の表の文言をそのまま渡す（👋は呼び出し元の文言に含める）。 */
  text: string;
  memberId: string;
}

const CLOSE_BUTTON_SIZE: Record<Tone, number> = {
  // デザイントークン.md 1.7節・theme.tapTarget（46.2節と同じ値、50.7節）。
  parent: theme.tapTarget.parent, // 44
  child: theme.tapTarget.child, // 56
  supporter: theme.tapTarget.supporterPrimary, // 48
};

export function TabIntroBubble({ tabKey, tone, text, memberId }: TabIntroBubbleProps) {
  const surface = { kind: "tab" as const, tabKey };
  const [, forceRender] = useState(0);

  useEffect(() => subscribeIntroSeen(() => forceRender((n) => n + 1)), []);
  useEffect(() => {
    void hydrateIntroSeen(surface, memberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, memberId]);

  const seen = isIntroSeen(surface, memberId);
  if (seen) return null;

  const bodyStyle =
    tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const closeSize = CLOSE_BUTTON_SIZE[tone];

  return (
    <Card tone={tone} style={{ ...styles.card, paddingRight: closeSize + theme.spacing.s2 }}>
      <Text style={bodyStyle}>{text}</Text>
      <Pressable
        onPress={() => void markIntroSeen(surface, memberId)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="閉じる"
        style={{
          ...styles.closeButton,
          width: closeSize,
          height: closeSize,
          borderRadius: closeSize / 2,
        }}
      >
        <Text style={styles.closeButtonText}>×</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: theme.spacing.s3,
  },
  closeButton: {
    position: "absolute",
    top: theme.spacing.s2,
    right: theme.spacing.s2,
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
});

export default TabIntroBubble;
