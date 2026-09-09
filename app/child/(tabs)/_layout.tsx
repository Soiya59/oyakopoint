import React from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";

/**
 * 子ども向け下部タブ: [🏠クエスト] [👨‍👩‍👧‍👦かぞく] [🌟じぶん] [🌳木]
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章（36.1節）、
 * 開発部/成果物/実装メモ.md 188章
 *
 * [2026-09-10改訂・実装メモ.md 188章] 子ども下部タブ4区画化。旧4タブ
 * （やる／ごほうび／きろく／つうちょう）を、保護者・みまもりメンバーと同じ
 * 「クエスト／かぞく／じぶん／木」の構成へ再編した（3ロールで区画の骨格を揃える。
 * 子どもだけ初期表示が「クエスト」で非対称なのは統括方針どおり）。
 * ごほうび・きろく・つうちょうは独立タブから「じぶん」タブのタイルへ移設した
 * （`app/child/(tabs)/self.tsx`参照）。実体ファイル（`rewards.tsx`・`points.tsx`・
 * `history.tsx`）は`(tabs)/`の外（`app/child/`直下）へ移設済みで、URL自体は
 * 変わっていない（`/child/rewards`・`/child/points`・`/child/history`のまま）。
 *
 * `home.tsx`はファイル名を変えず中身だけ再編した（36.11節1「C7・C14の遷移先
 * `/child/home`は変更不要」のとおり。子どもはホーム自体を廃止しないため
 * リダイレクトのスタブは不要）。
 *
 * 下記のタブバー本体のスタイル（高さ・余白・アイコンの出し方）は一切変更していない。
 * 2026-09-09に本部長が自作の部品で下部タブを壊した教訓（実装メモ184章）があるため、
 * 既存のこのファイルの`screenOptions`をそのまま維持し、`Tabs.Screen`の列挙だけを
 * 差し替えた。
 *
 * [2026-08-22修正・本部長] tabBarStyleの高さ・paddingBottomを固定値にしていたため、
 * ホームインジケーター/ジェスチャーバーのある実機（iPhone X以降・Android等）で
 * タブバーのラベル（「やる」「きろく」等）がその領域と重なり見切れる、と
 * ユーザーが実機で発見した。Screen.tsx側はedges=["top","left","right"]でbottomの
 * safe areaを意図的に含めていない（スクロール領域を圧迫しないため）ため、
 * タブバー自体でuseSafeAreaInsets().bottomを高さ・paddingに加算するよう修正した。
 *
 * [2026-08-22追加修正・本部長] 上記対応後も「絵文字の下の文字が5分の1くらい途切れる」
 * と実機で再現した。height・paddingBottomの両方にinsets.bottomを加算していたため
 * 打ち消し合い、アイコン+ラベルに使える実質の高さ（height-paddingTop-paddingBottom）は
 * 従来の64pxのときから50pxのまま変わっておらず、実機のフォント描画では
 * この50pxがアイコン(fontSize20の絵文字)+ラベル(fontSize12)にそもそも不足していた
 * ことが真因だった（PCブラウザでの検証では余裕があり再現しなかった）。
 * ベースの高さを64→80に増やして実質の高さを66pxに広げ、ラベルにも明示的な
 * lineHeightを指定して端末ごとのフォント行高のばらつきで再び詰まらないようにした。
 */
export default function ChildTabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandPrimaryStrong,
        tabBarInactiveTintColor: theme.colors.neutralTextSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.neutralSurface,
          height: 80 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
        // [2026-09-09追加・本部長／軽微変更ルート] 統括の実機確認「選択していることが
        // もっとわかりやすくしてほしい」。従来はtabBarActiveTintColorによる色の違い
        // だけで、**絵文字アイコンは色が変わらない**ため実質12pxのラベルの色だけが
        // 手がかりだった。
        //
        // **React Navigationの組み込みオプションを使う。自作のtabBarButtonは使わない。**
        // 一度は自作の部品で「下線＋背景」を入れたが（`1d73014`）、下線用の3pxの帯を
        // 足したことでタブの高さ（80 + 端末の下余白）に収まらなくなり、**中身が下へ
        // 押し出されて見えなくなった**（統括の実機報告により`ed9cc49`で撤回）。
        // 型チェックもlintも通り、ビルドも成功していた。**見た目は実機でしか分からない。**
        // 統括判断により、高さを一切変えない「背景の色付けだけ」にした。
        tabBarActiveBackgroundColor: theme.colors.brandPrimarySoft,
      }}
    >
      {/* Tabsは最初に列挙したScreenを初期タブとして扱う（保護者・みまもりの(tabs)と
          同じ挙動）。統括確定「タブは4つのまま、並びはクエスト→かぞく→じぶん→木、
          初期表示はクエスト」（36.1節決定1）。 */}
      <Tabs.Screen
        name="home"
        options={{
          title: "クエスト",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="family"
        options={{
          title: "かぞく",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>👨‍👩‍👧‍👦</Text>,
        }}
      />
      <Tabs.Screen
        name="self"
        options={{
          title: "じぶん",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🌟</Text>,
        }}
      />
      <Tabs.Screen
        name="tree"
        options={{
          title: "木",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🌳</Text>,
        }}
      />
    </Tabs>
  );
}
