import React from "react";
import { Platform, ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import KeyboardAvoidingPaddingView from "@/components/KeyboardAvoidingPaddingView";
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
  // [2026-09-23追加・実装メモ.md 289章。同日、本部長の差し戻しで289.4節のとおり
  // 直し方を変更] 画面下のほうにあるTextInputがiOSでキーボードに隠れる不具合
  // （統括・ばあば実機報告）への対応。`Screen`はほぼ全画面が経由する共通の器なので、
  // ここ1か所を直せば個々の画面を書き換えずに済む（`Modal`の中身は別レイヤーで
  // 描かれるためこれの外。289.4節②〜③参照）。
  //
  // 【最初の直し方（差し戻し前）】`Screen`全体を`KeyboardAvoidingView(padding)`で
  // 1段包んでいた。**これだと、`scroll=true`（`ScrollView`）のとき、キーボード分だけ
  // 器を縮めてもScrollViewのcontentOffset（スクロール位置）自体は動かないため、
  // 画面の下のほうにあった入力欄はキーボードに隠れなくなる代わりに、縮んだ
  // ScrollViewの表示範囲の外（下）に押し出されたままになり、結局見えなかった**
  // （本部長が`node_modules/react-native/React/Fabric/Mounting/ComponentViews/
  // ScrollView/RCTScrollViewComponentView.mmの`_keyboardWillChangeFrame:`を
  // 読んで指摘）。
  //
  // 【直した内容】
  //  - `scroll=true`（`Container`が`ScrollView`）: `KeyboardAvoidingView`はやめ、
  //    `ScrollView`自身の`automaticallyAdjustKeyboardInsets`（iOS専用。同じ.mmの
  //    `_keyboardWillChangeFrame:`が(1)キーボードと重なる分だけ下insetを足し、
  //    (2)`reactUpdateResponderOffsetForScrollView:`でフォーカス中の入力欄の位置を
  //    取ってキーボードより下ならcontentOffsetを動かして見える位置まで持ち上げる。
  //    無効時は`if (!_automaticallyAdjustKeyboardInsets) return;`で何もしない）を使う。
  //    Androidは何もしない（Expoの既定`android.softwareKeyboardLayoutMode: "resize"`で
  //    OS自身がウィンドウをリサイズし、Android標準のScrollViewがフォーカス中の子を
  //    見える位置へ動かす。ここへ足すと二重にずれる）。
  //  - `scroll=false`（`Container`が`View`。`ListScreen`経由のみ、289章時点で
  //    TextInputを持つ画面はこの経路を直接使っていない——`approvals.tsx`・
  //    `activity.tsx`はこの経路を使うが、TextInput自体はどちらも`Modal`の中にあり
  //    この`View`の外）: `ScrollView`が無くフォーカス位置への自動スクロールという
  //    概念自体が無いため、器をキーボード分だけ縮める`KeyboardAvoidingPaddingView`
  //    （`behavior="padding"`、iOSのみ）で包む、という最初の考え方をそのまま残す。
  const scrollBody = (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }, style]} edges={["left", "right"]}>
      <Container
        style={scroll ? styles.scroll : [styles.flex, styles.outer]}
        contentContainerStyle={scroll ? styles.scrollOuter : undefined}
        // [2026-09-17追加・実装メモ243章] scroll=falseのとき（Containerが
        // ScrollViewではなくView）はScrollView専用propを渡さない
        // （contentContainerStyleと同じ、上のternaryの書き方に揃える）。
        scrollEnabled={scroll ? scrollEnabled : undefined}
        canCancelContentTouches={scroll ? canCancelContentTouches : undefined}
        // [2026-09-23追加・実装メモ.md 289章] キーボード表示中に送信ボタン等を
        // タップしたとき、1回目でキーボードが閉じるだけで押せないことがある
        // （RN公式ドキュメントのScrollView.keyboardShouldPersistTaps）。
        keyboardShouldPersistTaps={scroll ? "handled" : undefined}
        // [2026-09-23追加・実装メモ.md 289.4章] 上のコメントのとおりiOSのみ。
        automaticallyAdjustKeyboardInsets={scroll && Platform.OS === "ios" ? true : undefined}
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
  return scroll ? scrollBody : <KeyboardAvoidingPaddingView style={styles.flex}>{scrollBody}</KeyboardAvoidingPaddingView>;
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
