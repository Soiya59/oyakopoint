/**
 * 木への飾り付け（P29／C23／S17、「かざりつけモード」）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.0節決定7・決定8・決定10、21.4節。
 *
 * 決定7: 独立した別ビジュアルは新設せず、既存の家族の木（FamilyTree.tsx
 *   TreeStageVisual）に一時的な「かざりつけモード」を追加する形で実装する。
 * 決定8: 交換相手（自分の色丸）の選択は木の絵の直接タップではなく、本コンポーネント
 *   下部の横スクロール一覧（自分の完了報告カード）から選ぶ。木の絵の上では
 *   自分の色丸にのみ「淡い強調」を加算的に添え、他人の丸には一切手を加えない。
 * 決定10（本部長裁定）: 40スロットは景品を優先確保する方式（FamilyTree.tsx
 *   pickDisplaySlots参照）のため、「選んだのに木の上に見えない」は発生しない。
 *   ただし選択した瞬間はまだ確定前（DBに反映前）なので、現在の40スロット表示
 *   対象に含まれる場合のみ木の上でも合わせてハイライトする（含まれない場合は
 *   一覧側のハイライトのみでよい、との明記どおり）。
 */
import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import { TreeStageVisual } from "./FamilyTree";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { FamilyTreeCompletionDot, DecoratableCompletion } from "@/data/api";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

export interface TreeDecoratePanelProps {
  tone: Tone;
  /** 木のビジュアル（家族の木、現在シーズン）の読み込み状態。 */
  treeLoadState: LoadState;
  stage: number;
  dots: FamilyTreeCompletionDot[];
  /** 交換相手選択の一覧（自分の未交換の完了報告）の読み込み状態。 */
  candidatesLoadState: LoadState;
  candidates: DecoratableCompletion[];
  myMemberId: string;
  /** 「かざる」確定処理中（連打防止のためボタンをローディング表示にする）。 */
  decorating: boolean;
  /** 直近の確定操作で発生した通信エラー文言。 */
  decorateErrorMessage: string | null;
  onRetryLoad: () => void;
  onConfirm: (completionId: string) => void;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

const captionStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

export function TreeDecoratePanel({
  tone,
  treeLoadState,
  stage,
  dots,
  candidatesLoadState,
  candidates,
  myMemberId,
  decorating,
  decorateErrorMessage,
  onRetryLoad,
  onConfirm,
}: TreeDecoratePanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (treeLoadState === "loading" || candidatesLoadState === "loading") {
    return <SkeletonList count={3} />;
  }
  if (treeLoadState === "error" || candidatesLoadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
        onRetry={onRetryLoad}
      />
    );
  }

  // 21.4節「空状態（保険的）」: 07-13-4章により理論上は発生しないが、機能停止的な
  // 文言は使わず再試行を促す文言にとどめる。
  if (candidates.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={[bodyStyle, styles.emptyText]}>
          {isChild ? "すこし じかんを おいて、もういちど みてみてね" : "少し時間をおいて、もういちど見てみてください"}
        </Text>
        <AppButton
          label={isChild ? "もういちど" : "再読み込み"}
          tone={tone}
          onPress={onRetryLoad}
          style={{ marginTop: theme.spacing.s4 }}
        />
      </View>
    );
  }

  return (
    <View>
      <TreeStageVisual stage={stage} dots={dots} highlightMemberId={myMemberId} highlightCompletionId={selectedId} />

      <Text style={[bodyStyle, styles.question]}>
        {isChild ? "どの きろくと こうかんする？" : "どの記録と交換しますか？"}
      </Text>

      <FlatList
        horizontal
        data={candidates}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <Pressable
              onPress={() => setSelectedId(item.id)}
              style={[
                styles.card,
                tone === "child" && styles.cardChild,
                tone === "supporter" && styles.cardSupporter,
                selected && styles.cardSelected,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={styles.cardEmoji}>{item.chore_emoji}</Text>
              <Text style={[captionStyle, styles.cardDate]}>{formatDate(item.reported_at)}</Text>
              {selected && <Text style={styles.cardCheck}>✓</Text>}
            </Pressable>
          );
        }}
      />

      {decorateErrorMessage && <Text style={styles.errorText}>{decorateErrorMessage}</Text>}

      <AppButton
        label={isChild ? "かざる！" : "かざる"}
        tone={tone}
        fullWidth
        loading={decorating}
        disabled={!selectedId || decorating}
        onPress={() => selectedId && onConfirm(selectedId)}
        style={styles.confirmButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  question: { marginTop: theme.spacing.s6, marginBottom: theme.spacing.s3, textAlign: "center" },
  listContent: { gap: theme.spacing.s2, paddingHorizontal: theme.spacing.s1 },
  card: {
    minWidth: 64,
    minHeight: 64,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s2,
  },
  cardChild: {
    minWidth: 72,
    minHeight: 72,
    borderRadius: theme.radius.childXl,
  },
  cardSupporter: {
    minWidth: 56,
    minHeight: 56,
  },
  cardSelected: {
    borderColor: theme.gachaColors.accent,
    borderWidth: 2,
    backgroundColor: theme.gachaColors.accentSoft,
  },
  cardEmoji: { fontSize: 24 },
  cardDate: { marginTop: theme.spacing.s1 },
  cardCheck: { position: "absolute", top: 2, right: 4, color: theme.gachaColors.accent, fontWeight: "700" },
  errorText: { color: theme.colors.statusBlocking, textAlign: "center", marginTop: theme.spacing.s3 },
  confirmButton: { marginTop: theme.spacing.s6 },
  emptyWrap: { alignItems: "center", marginTop: theme.spacing.s8 },
  emptyText: { textAlign: "center" },
});

export default TreeDecoratePanel;
