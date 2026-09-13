/**
 * 効果音アセット（wav）の静的importにTypeScriptの型を与えるための宣言。
 * `src/types/images.d.ts`（png用）と同じ考え方（実装メモ149章参照）。
 * Metroバンドラーは`.wav`もデフォルトの`assetExts`に含めており
 * （`node_modules/metro-config/src/defaults/defaults.js`）、pngと同様に
 * アセットIDへ変換される。`src/lib/sound.ts`から`import x from "./foo.wav"`の
 * 形で取り込み、`expo-audio`の`createAudioPlayer(x)`にそのまま渡す
 * （`AudioSource`型は`number`を受け付ける）。
 */
declare module "*.wav" {
  const value: number;
  export default value;
}
