import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer } from "expo-audio";
import reportSoundAsset from "../../assets/sounds/complete.wav";
import rewardSoundAsset from "../../assets/sounds/reward.wav";
import gachaSoundAsset from "../../assets/sounds/gacha.wav";

/**
 * 効果音の再生をまとめるモジュール（やること.md 2-3「効果音」対応）。
 *
 * 参照: 開発部/成果物/実装メモ.md（本章）、統括決定2026-09-14
 * （やること.md 2-3行目に決定事項を全文記載）。
 *
 * [鳴らす場面は3種類のみ]
 * - "report" … 完了報告が通ったとき（app/child/report-sent.tsx＝C7、
 *   app/child/nfc-complete.tsx＝C14）。C7とC14は同じ音を使う。
 * - "reward" … ごほうび交換が完了したとき（app/child/reward-complete.tsx＝C11）。
 * - "gacha"  … ガチャの結果が出たとき（app/child/gacha-result.tsx＝C22）。
 * 上記以外の画面・場面では絶対に呼び出さないこと（受信箱C29では鳴らさない、
 * 保護者・みまもりメンバーの完了報告画面では鳴らさない、などの決定は
 * やること.md 2-3行目参照）。
 *
 * [設計方針]
 * - 呼び出し側は`playSound("report")`のように1行で呼べるようにする。設定で
 *   後から消せるようにするとき直す箇所をこのファイル1つに絞るため
 *   （統括決定: 音を消す設定は今回作らないが、後から足す前提）。
 * - 再生に失敗しても画面を壊さない。`createAudioPlayer`・`player.play()`が
 *   例外を投げても黙って無視する（try/catchで囲み、呼び出し元には何も伝えない）。
 * - 音源ファイルは静的import（`src/types/sounds.d.ts`で型宣言。`src/types/
 *   images.d.ts`のpng用宣言と同じ考え方）でバンドルする（`assets/sounds/*.wav`、
 *   `tools/generate_sounds.js`で合成。外部サイトからのダウンロードはしない）。
 *   このプロジェクトは`require`の型を持たない（`images.d.ts`のコメント参照）
 *   ため、他のアセット同様`require()`ではなく`import`を使う。
 * - `setAudioModeAsync`は一切呼ばない。iOSのデフォルト（`playsInSilentMode:
 *   false`、`node_modules/expo-audio/ios/AudioRecords.swift`で確認済み）の
 *   ままにすることで、本体横のサイレントスイッチで音が消えるようにする
 *   （統括決定）。
 * - 再生が終わったプレイヤーは`remove()`で破棄しメモリに残さない。
 *
 * [詰まった点・`addListener`を使わなかった理由]
 * 当初は`player.addListener("playbackStatusUpdate", ...)`で再生完了
 * （`status.didJustFinish`）を検知して`remove()`する設計にしていたが、
 * `expo-audio@56.0.13`の型定義では`AudioPlayer`が継承する`SharedObject`
 * （`expo-modules-core`）の型が循環参照的に定義されており
 * （`node_modules/expo/node_modules/expo-modules-core/build/SharedObject.d.ts`
 * の`export type SharedObject<T> = typeof ExpoGlobal.SharedObject<T>`が、
 * 同じファイルの`ExpoGlobal`経由の再エクスポートを指す自己参照になっている）、
 * `tsc --noEmit`で「Property 'addListener' does not exist on type
 * 'AudioPlayer'」という誤検知が出る（実行時には存在するメソッドだが型上だけ
 * 見えない状態。最小再現で`expo-audio`単体の問題と確認済み）。`as any`で
 * 抑え込むこともできたが、そこまでして再生完了イベントに依存する理由が
 * 無かったため、方針を変えた。3種類とも自前で合成した音で長さを正確に
 * 把握しているため、**再生開始からの経過時間（`SOUND_DURATIONS_MS`）で
 * 破棄する**方式にした。実際の音の長さより余裕を持たせてあるため、
 * 破棄が早すぎて音が途切れることはない。
 */

export type SoundName = "report" | "reward" | "gacha";

/**
 * 効果音の再生ハンドル。通常は使い捨てでよいが、`report-sent.tsx`の
 * 「とりけす」のように途中で明示的に止めたい場面のために`stop()`を提供する。
 */
export interface SoundHandle {
  stop: () => void;
}

const NOOP_HANDLE: SoundHandle = { stop: () => undefined };

const SOUND_SOURCES: Record<SoundName, number> = {
  report: reportSoundAsset,
  reward: rewardSoundAsset,
  gacha: gachaSoundAsset,
};

/**
 * 各音源の実際の長さ＋余裕（ミリ秒）。`tools/generate_sounds.js`が生成する
 * 長さ（report=0.45s／reward=0.6s／gacha=0.55s）に対し、機種差・バッファ分の
 * 余裕を持たせた値にしている。この時間が経過したら再生済みとみなして
 * プレイヤーを破棄する。
 */
const SOUND_CLEANUP_MS: Record<SoundName, number> = {
  report: 900,
  reward: 1050,
  gacha: 1000,
};

/**
 * 効果音を1回再生する。失敗しても例外は投げない（呼び出し元は結果を待つ必要はない）。
 */
export function playSound(name: SoundName): SoundHandle {
  let player: AudioPlayer | null = null;
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    try {
      player?.remove();
    } catch {
      // 破棄に失敗しても無視する（画面動作に影響させない）。
    }
  };

  try {
    player = createAudioPlayer(SOUND_SOURCES[name]);
    player.play();
    setTimeout(cleanup, SOUND_CLEANUP_MS[name]);
  } catch {
    // 端末の音声機能が使えない等の理由で失敗しても、画面の動作は継続させる。
    return NOOP_HANDLE;
  }

  return {
    stop: () => {
      try {
        player?.pause();
      } catch {
        // 停止に失敗しても無視する。
      }
      cleanup();
    },
  };
}
