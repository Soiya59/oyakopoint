/**
 * 子ども向け「台紙」軽量モーダル（主要画面ワイヤーフレーム.md 49.4章決定12・
 * 49.6章）。保護者・みまもりメンバーは新設「台紙」画面（P38/S26）へ画面遷移するが、
 * 子どもは画面遷移せず、同じ内容（HabitCardBoard）を表示するモーダルを開く
 * （新しい画面としてカウントしない、46章・21.6節と同じ慣行）。
 *
 * [自己完結の設計理由] React Nativeの`Modal`は`visible=false`でも子要素が
 * マウントされたまま（表示だけが切り替わる）ため、`useHabitCardsForMember`を
 * 呼び出し側で常時実行すると開いていない間も通信が発生する。本コンポーネントは
 * `visible`のときだけ実際のmemberIdを、そうでなければ空文字列を
 * `useHabitCardsForMember`へ渡す（同フックの`if (!memberId) return;`ガードに
 * より、モーダルを開くまで通信が発生しない）。決定18「家族の全メンバーが対象」を
 * 満たすため、選択メンバーの状態もこのモーダル内に閉じ込めて自己完結させる。
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import HabitCardBoard from "./HabitCardBoard";
import { useHabitCardsForMember } from "@/hooks/useHabitCards";
import theme from "@/theme/theme";
import type { Chore, FamilyMember, HabitFigureCatalogItem } from "@/types/domain";

export interface ChildHabitCardModalProps {
  visible: boolean;
  onClose: () => void;
  members: FamilyMember[];
  myMemberId: string;
  chores: Chore[];
  catalog: HabitFigureCatalogItem[];
}

export function ChildHabitCardModal({ visible, onClose, members, myMemberId, chores, catalog }: ChildHabitCardModalProps) {
  const [selectedMemberId, setSelectedMemberId] = useState(myMemberId);
  useEffect(() => {
    if (visible) setSelectedMemberId(myMemberId);
  }, [visible, myMemberId]);

  const { loadState, activeCards, archivedCards, reload } = useHabitCardsForMember(visible ? selectedMemberId : "");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card tone="child" style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={theme.typography.childHeadline}>📔 台紙</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={theme.typography.childBody}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.body}>
            <HabitCardBoard
              tone="child"
              members={members}
              myMemberId={myMemberId}
              selectedMemberId={selectedMemberId}
              onSelectMember={setSelectedMemberId}
              chores={chores}
              catalog={catalog}
              loadState={loadState}
              activeCards={activeCards}
              archivedCards={archivedCards}
              onRetry={reload}
              onEndedCard={reload}
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

export default ChildHabitCardModal;
