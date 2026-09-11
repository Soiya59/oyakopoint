import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import ParentTabHeader from "@/components/ParentTabHeader";
import { countRecentInbox } from "@/components/InboxPanel";
import { useUnreadSince } from "@/hooks/useLastSeen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

type ManageRow = { emoji: string; label: string; path: string };

/**
 * かんり区画の入口（保護者のみ・新設）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35章（35.1節・35.6.4節・35.7節）、
 * 実装メモ.md 187章
 *
 * [2026-09-10新規追加・実装メモ.md 187章] 保護者のタブ化（P7ホーム廃止）に伴う新設画面。
 * 中身は旧`app/parent/home.tsx`の「家族のこと」タイルのうち管理系3項目
 * （クエスト管理・ごほうび管理・設定＝家族の管理）のみ。35.6.4節の指示どおり、
 * 「管理系は設定後ほとんど触らない」低頻度画面であることを見た目でも示すため、
 * じぶんタブのようなタイルグリッドではなく、装飾を最小限にした3行の縦並びリストにした
 * （ウィジェット・プレビューは置かない）。
 *
 * 「設定」の遷移先は既存の`/parent/family`（P14、`app/parent/family.tsx`）のまま
 * 変更していない。**このタブのファイル名を`manage.tsx`にした理由は`index.tsx`
 * （かぞくタブ）と同じ**（`app/parent/(tabs)/index.tsx`冒頭のコメント参照）:
 * `family.tsx`という名前は既にP14（`/parent/family`）が使っており、`(tabs)`グループ
 * 配下に同名ファイルを置くと同一URLの二重定義になるため避けた。
 */
export default function ParentManageTabScreen() {
  const { state } = useAppData();
  const myMember = state.members.find((m) => m.id === state.activeParentMemberId);
  const inboxSince = useUnreadSince("inbox", state.activeParentMemberId);
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, inboxSince);

  // [2026-09-11追加・統括指示「管理タブにみまもりの内容を確認できる選択があったほうが
  // よいかな？ いまはクエストやご褒美管理の中にある」／実装メモ.md 191章]
  // `/parent/supporter-chores`（P25）はクエストとごほうびの**両方**を1画面で見せるため、
  // クエスト管理の下にもごほうび管理の下にも属していなかった。入口が2つに分かれていた
  // ものをここへ集め、両方の管理画面からは外した（入口を1つにする）。
  // 呼び名「みまもり（参考）」は統括の案。すぐ下の「設定」の中にみまもりメンバーの
  // 招待・退会があるため、「みまもり」だけだとそちらと読み違えられる。「（参考）」が
  // 見るだけの画面であることを示し、画面末尾の脚注「みんなの参考にどうぞ」ともそろう。
  const hasAnySupporter = state.members.some((m) => m.role === "supporter" && m.is_active);
  const rows: ManageRow[] = [
    { emoji: "🧺", label: "クエスト管理", path: "/parent/chores" },
    { emoji: "🏆", label: "ごほうび管理", path: "/parent/rewards" },
    // [2026-09-11追加・統括指示「メダル管理はメダル管理として、ごほうび管理の下に
    // 追加してほしい」／本部長・軽微変更ルート] クエストとごほうびは独立した管理画面を
    // 持つのに、メダルだけがP14「設定」の奥にあり不揃いだった。UIUX 40章 決定1・
    // 41章 決定1（設定の中に置く）を取り下げ、`app/parent/sticker-settings.tsx` を
    // 新設してここへ並べる。2026-09-11に「みまもり（参考）」を設定から出して
    // ここへ集約した（実装メモ191章）のと同じ整理。
    { emoji: "🪙", label: "メダル管理", path: "/parent/sticker-settings" },
    // みまもりメンバーがいない家族では出さない（従来のリンク2つと同じ条件）。
    ...(hasAnySupporter
      ? [{ emoji: "👀", label: "みまもり（参考）", path: "/parent/supporter-chores" }]
      : []),
    { emoji: "⚙️", label: "設定", path: "/parent/family" },
  ];

  return (
    <Screen tone="parent">
      {/* [2026-09-10・本部長／軽微変更ルート] 共通ヘッダーに差し替えた。統括の実機確認
          「じぶんとかんりの左上のアイコンから、子供モードに飛べない」。187章のタブ化で
          「かぞく」タブにだけ子どもモードへの導線が付いていて、ここでは絵が置かれて
          いるだけだった。**同じ見た目なのに押せたり押せなかったりする**のは最も
          紛らわしいので、4タブとも同じ部品を使う。 */}
      <ParentTabHeader inboxCount={inboxCount} />

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>家族の管理</Text>
      <View style={{ marginTop: theme.spacing.s2 }}>
        {rows.map((r) => (
          <Pressable key={r.path} onPress={() => router.push(r.path as never)}>
            <Card style={styles.row}>
              <Text style={{ fontSize: 22 }}>{r.emoji}</Text>
              <Text style={[theme.typography.parentBodyMedium, styles.rowLabel]}>{r.label}</Text>
              <Text style={theme.typography.parentBodyMedium}>›</Text>
            </Card>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerMe: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  headerFamilyName: { flex: 1, marginLeft: theme.spacing.s3 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  bellHit: { minHeight: theme.tapTarget.parent, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s3,
    marginTop: theme.spacing.s3,
  },
  rowLabel: { flex: 1 },
});
