import React from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  tone?: "parent" | "child" | "supporter";
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  /**
   * [2026-09-17追加・実装メモ243章・234.5節の申し送り] 描いている間だけ画面の
   * スクロールを止めるための入り口。既定`true`（今までどおりスクロールできる）。
   * `scroll=false`（ScrollViewを使わない画面）では無視される（元々スクロールしない
   * ため実害は無いが、`Container`がViewのときはScrollView用propを渡さない）。
   */
  scrollEnabled?: boolean;
  /**
   * [2026-09-17追加・実装メモ243章] iOS専用のScrollViewの保険。`true`だと
   * ScrollViewが「このタッチは自分のものだ」とコンテンツ側から途中で奪い取れる
   * （既定値）。お絵かき画面のように「掴んだら離さない」子（キャンバス）を持つ
   * 画面だけ`false`を渡し、横取りされないようにする。既定は未指定（RNの既定値
   * `true`のまま）で、既存の呼び出し元は今までどおり動く。Android・Webではこの
   * propは効果を持たない（iOS固有のScrollView実装のみが参照する）。
   */
  canCancelContentTouches?: boolean;
}

/**
 * 全画面共通のコンテナ。
 * tone="child" のときは背景をbrand-primary-soft寄りにして「賑やかさ」を出す
 * （デザイントークン.md 1.5「保護者向け/子ども向けのトーン分け方針」）。
 *
 * [2026-08-20修正・本部長] PCの広いブラウザ幅（LAN内Web版・GitHub Pages版とも）で
 * 開くと、上限幅が無いためカード等が画面いっぱいに間延びして見にくいとユーザーが
 * 実機（PCブラウザ）で発見した。スマホ幅で収まるmaxWidthの内側コンテナを設け、
 * それより広い画面では中央寄せする。中央寄せはouter側のalignItems: "center"で
 * 行う必要があり、内側のcontentにalignSelf: "center"を置くだけでは
 * （左上に寄ったまま幅だけ制限される形になり）効かないため、two-layer構成にした。
 * スマホ実機での見え方はwidth:100%のため変化しない。
 */
export function Screen({
  children,
  scroll = true,
  tone = "parent",
  style,
  contentStyle,
  scrollEnabled = true,
  canCancelContentTouches,
}: ScreenProps) {
  // tone="supporter"（デザイントークン.md 1.7節「neutralを基調にcolor-supporter-accentを
  // 差し色として使う」）は背景を保護者向けと同じneutralBgのままにし、差し色はボタン・見出し等
  // 個別コンポーネント側でsupporterAccentを使う設計とした（tone="child"のような全画面着色はしない）。
  const bg = tone === "child" ? theme.colors.brandPrimarySoft : theme.colors.neutralBg;
  const Container = scroll ? ScrollView : View;
  // [2026-09-02修正・本部長] 画面下端の余白が足りず、いちばん下の行が
  // 端末のナビゲーションバー（Androidのジェスチャーバー）に接していた。
  // 統括が家族の木の「週ごとのきろく」を実機で見て発見（8/3週の行が下端に
  // 貼り付いていた）。原因は2つあり、両方に対処する。
  //  (1) SafeAreaView の edges から "bottom" を意図的に外している
  //      （背景色を画面下端まで伸ばすため。この意図は維持する）ので、
  //      端末の下端インセットぶんの余白がどこにも入っていなかった
  //  (2) 固定の paddingBottom が s8（32）しかなく、行が詰まって見えた
  // (1) は useSafeAreaInsets() で明示的に足す。ただしWeb版（GitHub Pages を
  // Chrome で開く現在の運用）では env(safe-area-inset-bottom) が 0 を返すため
  // これだけでは解決せず、(2) の固定値も 32 → 64 に広げる。
  //
  // [2026-09-13修正・実装メモ.md 219章] 上端にも同じ「SafeAreaView任せにしない」
  // 方式を揃えた。統括が実機（Pixel 9a）で、画面遷移直後の一瞬だけ「← ホームへ戻る」
  // がステータスバーに重なって描かれ、直後に正しい位置へずれる現象を発見
  // （それを誤タップしてしまうとの報告）。原因はSafeAreaViewのedges任せの余白と
  // useSafeAreaInsets()を直接styleに足す余白とで、Android実機上での確定タイミングが
  // 異なること。前者はnative側のSafeAreaViewShadowNodeが自身の初回レイアウト後に
  // 親（SafeAreaProvider）からlocalDataを受け取って初めてpadding値を確定する
  // ため、新しい画面（＝新しいSafeAreaViewの実体）に遷移するたびに「0で1フレーム
  // 描画→インセット確定後にpaddingが入り直す」再レイアウトが起きる
  // （react-native-safe-area-context 5.7.0、
  // android/.../SafeAreaViewShadowNode.kt の setLocalData/onBeforeLayout 参照）。
  // 後者（useSafeAreaInsets()）はapp/_layout.tsxのSafeAreaProviderが起動時に
  // 一度だけ生成するReact Context（SafeAreaInsetsContext）の値を読むだけで、
  // このContextはアプリ起動中ずっとマウントされたまま値を保持しているため、
  // 新しい画面がマウントされた最初のレンダーから正しい値が返る（再レイアウトが
  // 発生しない）。下端をこの方式にしたときは元々値が足りていなかっただけで
  // このズレ自体は起きていなかった（下端は元からnative SafeAreaViewを使っていない
  // ため）。上端も同じ方式に揃えることでズレを無くす。
  // edgesから"top"を外しても、SafeAreaView自体は画面全体を覆ったまま
  // （edgesはpaddingの有無だけを決め、Viewの位置・大きさは変えない）なので、
  // 背景色が画面上端まで伸びる見え方は変わらない。
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }, style]} edges={["left", "right"]}>
      <Container
        style={scroll ? styles.scroll : [styles.flex, styles.outer]}
        contentContainerStyle={scroll ? styles.scrollOuter : undefined}
        // [2026-09-17追加・実装メモ243章] scroll=falseのとき（Containerが
        // ScrollViewではなくView）はScrollView専用propを渡さない
        // （contentContainerStyleと同じ、上のternaryの書き方に揃える）。
        scrollEnabled={scroll ? scrollEnabled : undefined}
        canCancelContentTouches={scroll ? canCancelContentTouches : undefined}
      >
        <View
          style={[
            styles.content,
            !scroll && styles.flex,
            {
              paddingTop: SCREEN_CONTENT_TOP_PADDING + insets.top,
              paddingBottom: SCREEN_CONTENT_BOTTOM_PADDING + insets.bottom,
            },
            contentStyle,
          ]}
        >
          {children}
        </View>
      </Container>
    </SafeAreaView>
  );
}

/** 画面下端の基本余白。端末の下端インセットをこれに足して使う（上のコメント参照）。 */
const BASE_BOTTOM_PADDING = theme.spacing.s8 * 2;

/**
 * [2026-09-20追加・実装メモ.md 266章] `Screen`が中身に当てている余白の値。
 * `FlatList`を唯一のスクロールコンテナにする画面（`components/ListScreen.tsx`）は、
 * この余白を`contentContainerStyle`へ移し替えて見た目を揃える必要がある。
 * 以前は各画面に同じ数値（`theme.spacing.s4` / `theme.spacing.s8 * 2`）を書き写し、
 * 「`Screen.tsx`側が変わったらここも直すこと」というコメントで運用していた（255章）。
 * 定数をexportして、書き写しそのものを無くす。
 */
export const SCREEN_CONTENT_HORIZONTAL_PADDING = theme.spacing.s4;
export const SCREEN_CONTENT_TOP_PADDING = theme.spacing.s4;
export const SCREEN_CONTENT_BOTTOM_PADDING = BASE_BOTTOM_PADDING;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  outer: { alignItems: "center" },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: 480,
    padding: SCREEN_CONTENT_HORIZONTAL_PADDING,
    // paddingTop・paddingBottom は描画時に「s4 + 上端インセット」
    // 「BASE_BOTTOM_PADDING + 下端インセット」でそれぞれ上書きする
  },
});

export default Screen;
