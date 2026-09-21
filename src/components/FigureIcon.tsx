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

// [2026-09-18] 統括が8枚を制作し、本部長が透過PNG（512px）に変換して配置した。
import figureDragonBronze from "../../assets/figures/figure_dragon_bronze.png";
import figureDragonSilver from "../../assets/figures/figure_dragon_silver.png";
import figureDragonGold from "../../assets/figures/figure_dragon_gold.png";
import figureDragonCrystal from "../../assets/figures/figure_dragon_crystal.png";
import figureRabbitBronze from "../../assets/figures/figure_rabbit_bronze.png";
import figureRabbitSilver from "../../assets/figures/figure_rabbit_silver.png";
import figureRabbitGold from "../../assets/figures/figure_rabbit_gold.png";
import figureRabbitCrystal from "../../assets/figures/figure_rabbit_crystal.png";
// [2026-09-18追加] 3つ目の種類「星の精霊」。統括が制作。
import figureSpiritBronze from "../../assets/figures/figure_spirit_bronze.png";
import figureSpiritSilver from "../../assets/figures/figure_spirit_silver.png";
import figureSpiritGold from "../../assets/figures/figure_spirit_gold.png";
import figureSpiritCrystal from "../../assets/figures/figure_spirit_crystal.png";
// [2026-09-21追加・要件定義書07-34章「メダルとフィギュアの入れ替え」] 木を飾る
// ステッカー（`sticker_catalog`、入れ替え後の呼び名「フィギュア」）のうち、
// カブトムシ（beetle）の絵。統括作成・本部長が既存と同じ形式（512px・RGBA）に
// 整えて配置済み。キーは`figureKeyOfSticker()`（theme.ts）が生成する
// `figure_beetle_*`と一致させる。ちょうちょ（butterfly）・おはな（flower）は
// まだ絵が無く、下のフォールバック（絵文字）に自然に落ちる（本部長判断
// 「絵が無いものは空欄でよい」。実施理由は開発部/成果物/実装メモ.md参照）。
import figureBeetleBronze from "../../assets/figures/figure_beetle_bronze.png";
import figureBeetleSilver from "../../assets/figures/figure_beetle_silver.png";
import figureBeetleGold from "../../assets/figures/figure_beetle_gold.png";
import figureBeetleCrystal from "../../assets/figures/figure_beetle_crystal.png";

/**
 * `habit_figure_catalog.figure_key`をキーにした画像の対応表。
 * キーはDBの`figure_key`と完全一致させること。
 * [2026-09-18] 8枚とも配置済み。プレースホルダ（絵文字）の分岐は、
 * 将来「種類を足したが画像がまだ」という状態のために残してある。
 * [2026-09-21追加] `sticker_catalog`側（入れ替え後「フィギュア」）のbeetleぶんを
 * 追加した。butterfly/flowerのキーはまだこの表に無く、下のフォールバックに
 * 自然に落ちる。
 */
const FIGURE_IMAGES: Record<string, unknown> = {
  figure_dragon_bronze: figureDragonBronze,
  figure_dragon_silver: figureDragonSilver,
  figure_dragon_gold: figureDragonGold,
  figure_dragon_crystal: figureDragonCrystal,
  figure_rabbit_bronze: figureRabbitBronze,
  figure_rabbit_silver: figureRabbitSilver,
  figure_rabbit_gold: figureRabbitGold,
  figure_rabbit_crystal: figureRabbitCrystal,
  figure_spirit_bronze: figureSpiritBronze,
  figure_spirit_silver: figureSpiritSilver,
  figure_spirit_gold: figureSpiritGold,
  figure_spirit_crystal: figureSpiritCrystal,
  figure_beetle_bronze: figureBeetleBronze,
  figure_beetle_silver: figureBeetleSilver,
  figure_beetle_gold: figureBeetleGold,
  figure_beetle_crystal: figureBeetleCrystal,
};

/**
 * [2026-09-21新設] 指定した`figureKey`に画像が用意されているかどうか。
 * ショップの購入一覧から「絵が無いものを出さない」判定（開発部/成果物/
 * 実装メモ.md参照、本部長判断）に使う。`is_active`（DB）は変更しない
 * （設計部の方針どおり、クライアント側だけで絞り込む）。
 */
export function hasFigureImage(figureKey: string): boolean {
  return figureKey in FIGURE_IMAGES;
}

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
