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
import { Image } from "react-native";
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

export function StickerIcon({ shape, rarity, size, highRes = false }: StickerIconProps) {
  const images = STICKER_IMAGES[shape][rarity];
  const source = highRes || size > SM_THRESHOLD ? images.full : images.sm;
  return <Image source={source} resizeMode="contain" style={{ width: size, height: size }} />;
}

export default StickerIcon;
