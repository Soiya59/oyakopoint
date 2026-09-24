import React from "react";
import { FlatList, FlatListProps, StyleProp, StyleSheet, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Screen, {
  SCREEN_CONTENT_BOTTOM_PADDING,
  SCREEN_CONTENT_HORIZONTAL_PADDING,
  SCREEN_CONTENT_TOP_PADDING,
} from "@/components/Screen";

/**
 * 一覧が主役の画面（完了報告フィード等）の共通の器。
 * `Screen`（既定はScrollView）＋`FlatList`の正しい組み合わせを1か所に閉じ込める。
 *
 * [2026-09-20新設・実装メモ.md 266章、やること.md 4-66]
 * 同じ形が3画面（P8 `app/parent/approvals.tsx`、S2 `app/supporter/activity.tsx`、
 * C18 `app/child/family-activity.tsx`）に写しで存在し、**P8だけが2026-09-19に
 * `FlatList`化され（255章）、写しだったS2が取り残されて全件描画のまま残った**
 * （UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 55.11節(3)で発見）。
 * 同じ取り残しが二度と起きないよう、「速さに効く部分」だけをこの部品に集約した。
 * 見た目（カードの中身・トーン）は画面ごとに違うため、ここには持ち込まない。
 *
 * この部品が引き受けること:
 *  1. `Screen`を`scroll={false}` ＋ `contentStyle`で余白0にし、`FlatList`自身を
 *     唯一のスクロールコンテナにする。`Screen`の既定（ScrollView）に`FlatList`を
 *     入れ子にすると仮想化が効かず、「VirtualizedLists should never be nested」警告も出る。
 *  2. `Screen.tsx`が`styles.content`で当てているpadding（左右・上・下＋safe areaインセット）を
 *     `contentContainerStyle`へ移し替え、見た目・スクロール挙動を`Screen`のままに保つ。
 *     値は`Screen.tsx`からexportされた定数そのものを使うので、`Screen.tsx`側を直せば
 *     自動で追随する（以前は各画面に同じ数値を書き写していた。255章の申し送り）。
 *  3. 仮想化の設定（`initialNumToRender` / `windowSize` / `removeClippedSubviews`）の既定値。
 *     画面側で上書きもできる。
 *
 * `children`は`FlatList`の**あとに**（`Screen`の中に）描かれる。モーダルやスナックバーなど、
 * 一覧と一緒にスクロールさせたくないものをここに置く。
 */
type ListScreenProps<ItemT> = FlatListProps<ItemT> & {
  tone?: "parent" | "child" | "supporter";
  /** 一覧と一緒にスクロールしない要素（モーダル等）。 */
  children?: React.ReactNode;
};

export default function ListScreen<ItemT>({
  tone = "parent",
  children,
  contentContainerStyle,
  style,
  ...listProps
}: ListScreenProps<ItemT>) {
  // `Screen.tsx`と同じ`useSafeAreaInsets()`（起動時に一度だけ生成されるContextを読む方式。
  // `Screen.tsx`冒頭の219章コメント参照）をここでも呼び、上下の余白を揃える。
  const insets = useSafeAreaInsets();
  const padding: StyleProp<ViewStyle> = {
    paddingHorizontal: SCREEN_CONTENT_HORIZONTAL_PADDING,
    paddingTop: SCREEN_CONTENT_TOP_PADDING + insets.top,
    paddingBottom: SCREEN_CONTENT_BOTTOM_PADDING + insets.bottom,
  };
  // [2026-09-25修正・やること.md 4-80] `padding: 0`だけでは、`Screen.tsx`が個別に
  // 指定している`paddingTop`・`paddingBottom`を消せず、上下の余白が`Screen`の器と
  // FlatListの中身の両方に入って二重になっていた（統括の実機報告「完了報告の上画面の
  // 謎の空白」）。React Nativeは`paddingTop`のような個別指定を`padding`より常に
  // 優先するため、上下も名指しで0にする。
  return (
    <Screen tone={tone} scroll={false} contentStyle={{ padding: 0, paddingTop: 0, paddingBottom: 0 }}>
      <FlatList
        style={[styles.list, style]}
        contentContainerStyle={[padding, contentContainerStyle]}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
        {...listProps}
      />
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, width: "100%" },
});
