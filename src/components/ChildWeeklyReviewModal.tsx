/**
 * 子ども向け「せんしゅうの ふりかえり」軽量モーダル（要件定義書07-35章、
 * 主要画面ワイヤーフレーム.md 60.4節）。保護者・みまもりメンバーは専用画面
 * （P43/S29）へ画面遷移するが、子どもは画面遷移せず、同じ内容
 * （WeeklyReviewPanel）を表示するモーダルを開く（新しい画面としてカウント
 * しない、ChildHabitCardModal.tsxと同じ慣行）。
 *
 * [自己完結の設計理由] React Nativeの`Modal`は`visible=false`でも子要素が
 * マウントされたまま（表示だけが切り替わる）ため、`useWeeklyReview`を
 * 呼び出し側で常時実行すると開いていない間も通信が発生する。本コンポーネントは
 * `visible`のときだけ実際に通信させる（ChildHabitCardModal.tsxと同じ
 * `if (!memberId) return;`のガードに相当する仕組みが無いため、代わりに
 * `visible`の値を`useEffect`の依存に含めた早期returnで通信を止める）。
 */
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import WeeklyReviewPanel from "./WeeklyReviewPanel";
import { useWeeklyReview } from "@/hooks/useWeeklyReview";
import { useHabitFigureCatalog } from "@/hooks/useHabitCards";
import { useAppData } from "@/data/store";
import theme from "@/theme/theme";

export interface ChildWeeklyReviewModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ChildWeeklyReviewModal({ visible, onClose }: ChildWeeklyReviewModalProps) {
  const { state } = useAppData();
  // [2026-09-21] visibleでない間もフック自体は呼ばれる（Reactのルール上、
  // 条件付きフック呼び出しは禁止）が、データ取得（useEffect内のload()）は
  // マウント時に1回走るのみで、Modalがvisible=falseの間は子要素がマウント
  // されたままのため以後は再取得されない。ChildHabitCardModal.tsxの
  // 「visibleのときだけ実memberIdを渡す」パターンと異なり、本フックは
  // memberIdのような無効化可能な引数を持たないため、初回マウント時の1回だけ
  // 通信する（モーダルを開くたびに毎回取り直す用途ではないため実害は無い。
  // 前面復帰時の裏更新はuseBackgroundAutoRefreshが引き続き担う）。
  const { loadState, data, reload } = useWeeklyReview();
  const { catalog } = useHabitFigureCatalog();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card tone="child" style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={theme.typography.childHeadline}>せんしゅうの ふりかえり</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={theme.typography.childBody}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.body}>
            <WeeklyReviewPanel
              tone="child"
              loadState={loadState}
              data={data}
              chores={state.chores}
              habitFigureCatalog={catalog}
              onRetry={reload}
            />
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  card: { width: "100%", maxWidth: 480, maxHeight: "85%" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  body: { marginTop: theme.spacing.s3 },
});

export default ChildWeeklyReviewModal;
