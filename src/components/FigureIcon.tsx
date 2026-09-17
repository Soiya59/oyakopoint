/**
 * 習慣カード（台紙）の段階報酬フィギュアの絵柄表示（要件定義書07-28章、
 * スキーマ設計.sql 55.2章 habit_figure_catalog、開発部/成果物/実装メモ.md 237章）。
 *
 * `StickerIcon.tsx`（木を飾るメダルの絵柄表示）と同じ構造だが、**画像アセットが
 * 統括によって未着**（本部長依頼「絵は統括が制作中で未着。プレースホルダで進め、
 * 差し替え手順を実装メモに書く」）のため、`assets/figures/`配下のPNGを
 * `require()`/`import`で静的に取り込むことができない（Metroバンドラーは
 * 実在しないファイルへの静的importをビルド時エラーにする）。
 *
 * そのため本コンポーネントは、
 *   (1) `FIGURE_IMAGES`（画像が来たら埋める、現時点では空のマップ）を先に見る
 *   (2) 無ければ`kindEmoji`（🐉／🐰等、habit_figure_catalog.kind_emoji）を表示する
 *   (3) それも無ければ既定の絵文字（❔）を表示する
 * という3段階のフォールバックで「読み込み口だけ用意し、無い間は絵文字で代替する」
 * （本部長依頼）を実現する。
 *
 * [差し替え手順・assets/figures/README.md にも同じ内容を記載]
 *   1. 8枚の画像（figure_dragon_bronze.png等）を`assets/figures/`に置く。
 *   2. 下の8行のコメントアウトされたimportと`FIGURE_IMAGES`の中身の
 *      コメントアウトを外す。
 *   3. `npx tsc --noEmit`でエラーが無いことを確認する。
 * 呼び出し側（本コンポーネントを使う画面・コンポーネント）のコードは
 * 一切変更不要（`figureKey`文字列を渡すだけの疎結合な設計にしているため）。
 */
import React from "react";
import { Image, Text, View } from "react-native";

// ---- 画像が揃ったら、以下8行のコメントアウトを外す ----
// import figureDragonBronze from "../../assets/figures/figure_dragon_bronze.png";
// import figureDragonSilver from "../../assets/figures/figure_dragon_silver.png";
// import figureDragonGold from "../../assets/figures/figure_dragon_gold.png";
// import figureDragonCrystal from "../../assets/figures/figure_dragon_crystal.png";
// import figureRabbitBronze from "../../assets/figures/figure_rabbit_bronze.png";
// import figureRabbitSilver from "../../assets/figures/figure_rabbit_silver.png";
// import figureRabbitGold from "../../assets/figures/figure_rabbit_gold.png";
// import figureRabbitCrystal from "../../assets/figures/figure_rabbit_crystal.png";

/**
 * `habit_figure_catalog.figure_key`をキーにした画像の対応表。
 * 画像が揃うまでは空オブジェクトのまま（＝常にプレースホルダ表示）。
 * 揃ったら下記のコメントアウトを外す（キーはDBの`figure_key`と完全一致させること）。
 */
const FIGURE_IMAGES: Record<string, unknown> = {
  // figure_dragon_bronze: figureDragonBronze,
  // figure_dragon_silver: figureDragonSilver,
  // figure_dragon_gold: figureDragonGold,
  // figure_dragon_crystal: figureDragonCrystal,
  // figure_rabbit_bronze: figureRabbitBronze,
  // figure_rabbit_silver: figureRabbitSilver,
  // figure_rabbit_gold: figureRabbitGold,
  // figure_rabbit_crystal: figureRabbitCrystal,
};

export interface FigureIconProps {
  /** habit_figure_catalog.figure_key（例: "figure_dragon_bronze"）。 */
  figureKey: string;
  /** 画像が無いときのプレースホルダに使う絵文字（habit_figure_catalog.kind_emoji）。 */
  kindEmoji?: string | null;
  size: number;
}

export function FigureIcon({ figureKey, kindEmoji, size }: FigureIconProps) {
  const source = FIGURE_IMAGES[figureKey];
  if (!source) {
    // [プレースホルダ] 画像が届くまでは絵文字で代替する。1枚の絵が出ないことと
    // 画面全体が出ないことは重さが違う、というStickerIcon.tsxと同じ考え方を踏襲する。
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.6 }}>{kindEmoji ?? "❔"}</Text>
      </View>
    );
  }
  return <Image source={source as never} resizeMode="contain" style={{ width: size, height: size }} />;
}

export default FigureIcon;
