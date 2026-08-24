// [一時的な確認用画面] 家族の木の見た目を段階ごとに確認するための開発用ルート。
// 見た目の確認が終わったら削除する（本番のルートとして残さない）。
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { TreeStageVisual } from "@/components/FamilyTree";
import theme from "@/theme/theme";

const REPORTERS = [
  { id: "member-a", color: "#A8D5BA" },
  { id: "member-b", color: "#FFE5B4" },
  { id: "member-c", color: "#B4D4FF" },
  { id: "member-d", color: "#FFC1CC" },
  { id: "member-e", color: "#D9C2FF" },
];

function makeDots(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const r = REPORTERS[i % REPORTERS.length];
    return {
      id: `dot-${i}`,
      reported_by: r.id,
      avatar_color: r.color,
      reported_at: new Date(2026, 7, 1 + i).toISOString(),
    };
  });
}

const CASES = [
  { stage: 2, count: 34 },
  { stage: 4, count: 40 },
];

export default function DevTreeScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }} contentContainerStyle={{ padding: 12 }}>
      {CASES.map((c) => (
        <View key={c.stage} style={{ marginBottom: 16, borderWidth: 1, borderColor: "#eee", borderRadius: 16, alignItems: "center" }}>
          <Text style={{ fontWeight: "700", paddingTop: 8 }}>
            stage {c.stage}「{theme.treeStages[c.stage].name}」/ dots {c.count}
          </Text>
          <TreeStageVisual stage={c.stage} dots={makeDots(c.count) as never} />
        </View>
      ))}
    </ScrollView>
  );
}
