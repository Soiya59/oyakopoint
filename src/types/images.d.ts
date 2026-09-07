/**
 * [2026-09-10新設・実装メモ149章] 画像アセット（png）の静的importにTypeScriptの
 * 型を与えるための宣言。react-nativeは`@types/node`を持たない前提（本プロジェクトの
 * tsconfig.jsonは`expo/tsconfig.base`のみを継承し、`require`の型を持たない）ため、
 * `import x from "./foo.png"`というES importの形でアセットを取り込む
 * （`StickerIcon.tsx`参照）。Metroバンドラーは実行時にこれをアセットID
 * （native）またはハッシュ付きURL（web）に解決する。ここではその戻り値の型のみを
 * `ImageSourcePropType`として宣言し、実際の解決はMetro・Expoに委ねる。
 */
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";
  const value: ImageSourcePropType;
  export default value;
}
