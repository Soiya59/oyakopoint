/**
 * 木を飾るステッカー（要件定義書07-19-9a章「決定12」）の絵柄表示。
 * 参照: デザイントークン.md 1.11節、主要画面ワイヤーフレーム.md 32.0節決定2・決定3。
 *
 * [2026-09-07改訂・本部長／実装メモ152章] 画面に出す呼び名は「メダル」に統一した
 * （統括判断）。コンポーネント名・DBの`sticker_key`・本コメントの「シール」
 * 「ステッカー」はそのまま変更していない。
 *
 * [2026-09-08改訂・本部長／実装メモ173章] 最上位レアリティの呼び名を統括判断で
 * 「虹（rainbow）」から「クリスタル（crystal）」に改称した（絵を作り直したことで
 * クリスタル感が出たため）。アセットファイル名（`*_rainbow.png`）も`*_crystal.png`に
 * 差し替えた（旧`*_rainbow.png`はリポジトリから削除、内容はcrystal側と同一だった）。
 *
 * [2026-09-10改訂・実装メモ149章] 従来は`react-native-svg`による自前描画
 * （形とレアリティのグラデーションをコードで組み立てる方式）だったが、統括提供の
 * 完成画像（`assets/stickers/`、12種×2解像度）へ差し替えた。理由・変更点は
 * 実装メモ149章参照。旧SVG実装（`Defs`/`LinearGradient`等、`theme.stickerRarityGradients`・
 * `theme.stickerAccentFixed`）はこのコンポーネントの書き換えにあわせて削除した
 * （149章「削除したもの」節）。
 *
 * [解像度の出し分け] `assets/stickers/`には512px（拡大表示用）と128px
 * （`@sm`、木の上・一覧など小さく出す場所用）の2種類がある。本コンポーネントは
 * `size`（表示pt数）が`SM_THRESHOLD`（64pt）以下なら128px側、それを超えるなら
 * 512px側を自動選択する。しきい値の根拠は149章参照。呼び出し側で明示的に
 * 512px側を使いたい場合（コレクション等の拡大表示）は`highRes`をtrueにする
 * （`size`が小さくても強制的に512px側になる）。
 *
 * [uidの廃止について] SVG自前描画時代はgradient idの衝突を避けるため呼び出し側に
 * 一意な`uid`を渡してもらっていたが、画像表示に切り替えたことでgradientそのものが
 * 無くなり不要になった。呼び出し側からも`uid`の指定を取り除いた（149章）。
 */
import React from "react";
import { Image, Text, View } from "react-native";
import type { StickerRarity, StickerShape } from "@/theme/theme";

// ---- 12種×2解像度の静的import ----
// [重要] `require()`/`import`のアセットパスはMetroバンドラーが静的解析できる
// 「リテラル文字列」でなければ解決されない（テンプレートリテラルで動的に
// パスを組み立てる方式は使えない）。そのため12種×2解像度＝24枚を1枚ずつ
// importし、下の`STICKER_IMAGES`で対応表として静的に持つ。

import beetleBronzeFull from "../../assets/stickers/beetle_bronze.png";
import beetleBronzeSm from "../../assets/stickers/beetle_bronze@sm.png";
import beetleSilverFull from "../../assets/stickers/beetle_silver.png";
import beetleSilverSm from "../../assets/stickers/beetle_silver@sm.png";
import beetleGoldFull from "../../assets/stickers/beetle_gold.png";
import beetleGoldSm from "../../assets/stickers/beetle_gold@sm.png";
import beetleCrystalFull from "../../assets/stickers/beetle_crystal.png";
import beetleCrystalSm from "../../assets/stickers/beetle_crystal@sm.png";

import butterflyBronzeFull from "../../assets/stickers/butterfly_bronze.png";
import butterflyBronzeSm from "../../assets/stickers/butterfly_bronze@sm.png";
import butterflySilverFull from "../../assets/stickers/butterfly_silver.png";
import butterflySilverSm from "../../assets/stickers/butterfly_silver@sm.png";
import butterflyGoldFull from "../../assets/stickers/butterfly_gold.png";
import butterflyGoldSm from "../../assets/stickers/butterfly_gold@sm.png";
import butterflyCrystalFull from "../../assets/stickers/butterfly_crystal.png";
import butterflyCrystalSm from "../../assets/stickers/butterfly_crystal@sm.png";

import flowerBronzeFull from "../../assets/stickers/flower_bronze.png";
import flowerBronzeSm from "../../assets/stickers/flower_bronze@sm.png";
import flowerSilverFull from "../../assets/stickers/flower_silver.png";
import flowerSilverSm from "../../assets/stickers/flower_silver@sm.png";
import flowerGoldFull from "../../assets/stickers/flower_gold.png";
import flowerGoldSm from "../../assets/stickers/flower_gold@sm.png";
import flowerCrystalFull from "../../assets/stickers/flower_crystal.png";
import flowerCrystalSm from "../../assets/stickers/flower_crystal@sm.png";

// [2026-09-09追加・本部長／実装メモ177章] やること5-9のうち「ドラゴン」のみ追加。
import dragonBronzeFull from "../../assets/stickers/dragon_bronze.png";
import dragonBronzeSm from "../../assets/stickers/dragon_bronze@sm.png";
import dragonSilverFull from "../../assets/stickers/dragon_silver.png";
import dragonSilverSm from "../../assets/stickers/dragon_silver@sm.png";
import dragonGoldFull from "../../assets/stickers/dragon_gold.png";
import dragonGoldSm from "../../assets/stickers/dragon_gold@sm.png";
import dragonCrystalFull from "../../assets/stickers/dragon_crystal.png";
import dragonCrystalSm from "../../assets/stickers/dragon_crystal@sm.png";

// [2026-09-21追加・要件定義書07-34章「メダルとフィギュアの入れ替え」、主要画面
// ワイヤーフレーム.md 62.5節] `habit_figure_catalog`（入れ替え後の呼び名
// 「メダル」）を円形の枠で表示するための絵。統括作成・本部長が既存と同じ形式に
// 整えて配置済み。dragonぶんは`sticker_catalog`側の既存画像（上）をそのまま
// 再利用し（07-34章3節「ドラゴンは既に両方向の絵がある」）、rabbitぶんのみ
// 新規に追加する。
import rabbitBronzeFull from "../../assets/stickers/rabbit_bronze.png";
import rabbitBronzeSm from "../../assets/stickers/rabbit_bronze@sm.png";
import rabbitSilverFull from "../../assets/stickers/rabbit_silver.png";
import rabbitSilverSm from "../../assets/stickers/rabbit_silver@sm.png";
import rabbitGoldFull from "../../assets/stickers/rabbit_gold.png";
import rabbitGoldSm from "../../assets/stickers/rabbit_gold@sm.png";
import rabbitCrystalFull from "../../assets/stickers/rabbit_crystal.png";
import rabbitCrystalSm from "../../assets/stickers/rabbit_crystal@sm.png";

// [2026-09-25追加・統括が原画を制作、やること.md 4-75対応] 「くま」。ドラゴンと同じ
// 木を飾る用の絵（assets/stickers/bear_*.png・@sm）。
import bearBronzeFull from "../../assets/stickers/bear_bronze.png";
import bearBronzeSm from "../../assets/stickers/bear_bronze@sm.png";
import bearSilverFull from "../../assets/stickers/bear_silver.png";
import bearSilverSm from "../../assets/stickers/bear_silver@sm.png";
import bearGoldFull from "../../assets/stickers/bear_gold.png";
import bearGoldSm from "../../assets/stickers/bear_gold@sm.png";
import bearCrystalFull from "../../assets/stickers/bear_crystal.png";
import bearCrystalSm from "../../assets/stickers/bear_crystal@sm.png";

const STICKER_IMAGES: Record<StickerShape, Record<StickerRarity, { full: typeof beetleBronzeFull; sm: typeof beetleBronzeSm }>> = {
  beetle: {
    bronze: { full: beetleBronzeFull, sm: beetleBronzeSm },
    silver: { full: beetleSilverFull, sm: beetleSilverSm },
    gold: { full: beetleGoldFull, sm: beetleGoldSm },
    crystal: { full: beetleCrystalFull, sm: beetleCrystalSm },
  },
  butterfly: {
    bronze: { full: butterflyBronzeFull, sm: butterflyBronzeSm },
    silver: { full: butterflySilverFull, sm: butterflySilverSm },
    gold: { full: butterflyGoldFull, sm: butterflyGoldSm },
    crystal: { full: butterflyCrystalFull, sm: butterflyCrystalSm },
  },
  flower: {
    bronze: { full: flowerBronzeFull, sm: flowerBronzeSm },
    silver: { full: flowerSilverFull, sm: flowerSilverSm },
    gold: { full: flowerGoldFull, sm: flowerGoldSm },
    crystal: { full: flowerCrystalFull, sm: flowerCrystalSm },
  },
  dragon: {
    bronze: { full: dragonBronzeFull, sm: dragonBronzeSm },
    silver: { full: dragonSilverFull, sm: dragonSilverSm },
    gold: { full: dragonGoldFull, sm: dragonGoldSm },
    crystal: { full: dragonCrystalFull, sm: dragonCrystalSm },
  },
  bear: {
    bronze: { full: bearBronzeFull, sm: bearBronzeSm },
    silver: { full: bearSilverFull, sm: bearSilverSm },
    gold: { full: bearGoldFull, sm: bearGoldSm },
    crystal: { full: bearCrystalFull, sm: bearCrystalSm },
  },
};

/**
 * この表示pt数以下なら128px（`@sm`）画像を使う。木の上（30pt前後）・一覧
 * セル（28〜32pt）はいずれもこの範囲。512pxを128px以下まで縮小表示するのは
 * データの無駄（149章）。
 */
const SM_THRESHOLD = 64;

export interface StickerIconProps {
  shape: StickerShape;
  rarity: StickerRarity;
  size: number;
  /**
   * trueなら`size`によらず512px（`full`）画像を強制する。コレクション等で
   * ステッカーを拡大表示する箇所向け（149章）。
   */
  highRes?: boolean;
}

/**
 * [2026-09-21新設・要件定義書07-34章「メダルとフィギュアの入れ替え」、主要画面
 * ワイヤーフレーム.md 62.5節「結線の入れ替え」対応]
 * `habit_figure_catalog`（入れ替え後の呼び名「メダル」）の絵を、円形の枠で表示
 * するための画像対応表。キーは`habit_figure_catalog.figure_key`と完全一致させる
 * （`FigureIcon.tsx`のFIGURE_IMAGESと同じキー文字列を、別の画像に対応付ける形）。
 * dragonは`sticker_catalog`側の既存画像を再利用、rabbitは今回追加した新規画像。
 * DBの`figure_key`列は一切変更しない。
 */
const ORNAMENT_CIRCLE_IMAGES: Record<string, { full: typeof beetleBronzeFull; sm: typeof beetleBronzeSm }> = {
  figure_dragon_bronze: { full: dragonBronzeFull, sm: dragonBronzeSm },
  figure_dragon_silver: { full: dragonSilverFull, sm: dragonSilverSm },
  figure_dragon_gold: { full: dragonGoldFull, sm: dragonGoldSm },
  figure_dragon_crystal: { full: dragonCrystalFull, sm: dragonCrystalSm },
  figure_rabbit_bronze: { full: rabbitBronzeFull, sm: rabbitBronzeSm },
  figure_rabbit_silver: { full: rabbitSilverFull, sm: rabbitSilverSm },
  figure_rabbit_gold: { full: rabbitGoldFull, sm: rabbitGoldSm },
  figure_rabbit_crystal: { full: rabbitCrystalFull, sm: rabbitCrystalSm },
};

export interface HabitFigureCircleIconProps {
  /** habit_figure_catalog.figure_key（例: "figure_rabbit_bronze"）。 */
  figureKey: string;
  /** 画像が無いときのプレースホルダに使う絵文字（habit_figure_catalog.kind_emoji）。 */
  kindEmoji?: string | null;
  size: number;
  /** trueなら`size`によらず512px（`full`）画像を強制する（`StickerIcon`と同じ考え方）。 */
  highRes?: boolean;
}

/**
 * `habit_figure_catalog`（入れ替え後の呼び名「メダル」）の絵柄を円形の枠向けに
 * 表示する。`StickerIcon`と兄弟の関係にある新設コンポーネント（`StickerIcon`
 * 自体は改変しない、07-34章5節「内部名は変更しない」の原則を保つため、既存の
 * `shape`/`rarity`型〈beetle/butterfly/flower/dragon〉を汚さず独立させた）。
 * 画像が無い場合は`FigureIcon.tsx`と同じ考え方で絵文字にフォールバックする。
 */
export function HabitFigureCircleIcon({ figureKey, kindEmoji, size, highRes = false }: HabitFigureCircleIconProps) {
  const images = ORNAMENT_CIRCLE_IMAGES[figureKey];
  if (!images) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.6 }}>{kindEmoji ?? "❔"}</Text>
      </View>
    );
  }
  const source = highRes || size > SM_THRESHOLD ? images.full : images.sm;
  return <Image source={source} resizeMode="contain" style={{ width: size, height: size }} />;
}

export function StickerIcon({ shape, rarity, size, highRes = false }: StickerIconProps) {
  // [2026-09-09追加・本部長／軽微変更ルート] 対応する画像が無いときに落ちないようにする。
  //
  // 従来は`STICKER_IMAGES[shape][rarity].full`と素で辿っていたため、**表に無い形か
  // 段階が1つ来ただけで例外になり、この絵を含む画面（メダル購入・コレクション・木）が
  // まるごと表示できなくなった。**
  //
  // 実際に起こりうる。(1) `assets/stickers/`には7形ぶんの画像があるのに、この表には
  // beetle・butterfly・flower・dragonの4形しか無い（2026-09-09にドラゴンのみ登録。
  // acorn・bird・carは引き続き未登録。やること5-9でカタログに載せた瞬間ここを通る）。
  // (2) DBのレアリティを2026-09-08にrainbow→crystalへ改称したように、DB側の値が
  // 先に変わってアプリが追いつく前の一瞬でも同じことが起きる。
  //
  // **1枚の絵が出ないことと、画面がまるごと出ないことは重さが違う。**前者に倒す。
  const images = STICKER_IMAGES[shape]?.[rarity];
  if (!images) {
    if (__DEV__) {
      console.warn(`StickerIcon: 画像が未登録です（shape=${shape} rarity=${rarity}）`);
    }
    // 場所だけ確保して何も描かない（周りのレイアウトを崩さないため）。
    return <View style={{ width: size, height: size }} />;
  }
  const source = highRes || size > SM_THRESHOLD ? images.full : images.sm;
  return <Image source={source} resizeMode="contain" style={{ width: size, height: size }} />;
}

export default StickerIcon;
