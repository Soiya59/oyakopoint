/**
 * 木を飾るステッカー（要件定義書07-19-9a章「決定12」）の自前描画SVG。
 * 参照: デザイントークン.md 1.11節、主要画面ワイヤーフレーム.md 32.0節決定2・決定3。
 *
 * 統括決定12「絵文字は一切使わずSVGで自前描画する」・決定26「虹はシャボン玉・
 * 真珠・オーロラのような優しいホログラム、金銀銅は金属光沢という色と質感だけで
 * 表現する」に対応する。木の色丸（FamilyTree.tsx StageDot）・実・花と同じ
 * viewBox 100×100の座標系を使い、木の上・区画3・購入画面のいずれでも
 * 同一のコンポーネントを使い回す（決定2）。
 *
 * [gradient idの一意性について・重要] `react-native-svg`はWeb書き出し時、実際の
 * DOM上の`<linearGradient id="...">`としてレンダリングされる。同じidを持つ
 * gradientが複数同時に存在すると、後勝ち（あるいはブラウザ実装依存）で色が
 * 混ざる・意図しない方の色が適用される事故につながる（本部長申し送り事項6）。
 * 12種のカタログ・木の上に同時に並ぶ複数のステッカー・区画3のグリッド等、
 * 同じ画面に複数の`StickerIcon`が同時に描画される場面は多いため、呼び出し側は
 * 必ず`uid`にその文脈で一意な値（木の上ならdecorationId、カタログ・区画3なら
 * sticker_catalog.idや`purchase.id`等）を渡すこと。同じ`shape`・`rarity`の
 * 組み合わせであっても`uid`が異なれば別のgradient idになる。
 */
import React from "react";
import Svg, { Defs, LinearGradient, Stop, Path, Circle, Ellipse, Line, Polygon } from "react-native-svg";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";

export interface StickerIconProps {
  shape: StickerShape;
  rarity: StickerRarity;
  size: number;
  /** この描画インスタンスに一意な文字列（gradient id衝突を避けるため。上記コメント参照）。 */
  uid: string;
}

const FIXED = theme.stickerAccentFixed;

export function StickerIcon({ shape, rarity, size, uid }: StickerIconProps) {
  const gradId = `sticker-grad-${shape}-${rarity}-${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const def = theme.stickerRarityGradients[rarity];
  const fill = `url(#${gradId})`;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          {def.stops.map((c, i) => (
            <Stop key={i} offset={`${(i / (def.stops.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>

      {shape === "beetle" && <BeetleGlyph fill={fill} />}
      {shape === "butterfly" && <ButterflyGlyph fill={fill} />}
      {shape === "flower" && <FlowerGlyph fill={fill} />}

      {/* 金属光沢のハイライト（銅・銀・金のみ、左上寄りの小さな楕円）。 */}
      {def.highlight && <Ellipse cx={38} cy={34} rx={12} ry={7} fill="rgba(255,255,255,0.35)" />}

      {/* 虹（パステル調ホログラム）: 斜めの光の帯＋小さな光の粒。統括決定26。 */}
      {rarity === "rainbow" && (
        <>
          <Polygon points="20,70 40,30 55,35 35,75" fill="rgba(255,255,255,0.55)" />
          <SparklePoint cx={78} cy={26} />
          <SparklePoint cx={24} cy={78} />
        </>
      )}
    </Svg>
  );
}

function SparklePoint({ cx, cy }: { cx: number; cy: number }) {
  const r = 4;
  return (
    <Path
      d={`M${cx} ${cy - r} L${cx + r * 0.4} ${cy - r * 0.4} L${cx + r} ${cy} L${cx + r * 0.4} ${cy + r * 0.4} L${cx} ${cy + r} L${cx - r * 0.4} ${cy + r * 0.4} L${cx - r} ${cy} L${cx - r * 0.4} ${cy - r * 0.4} Z`}
      fill="rgba(255,255,255,0.8)"
    />
  );
}

/**
 * カブトムシ: 頭部（小さい楕円）＋胸部・腹部（重なる2つの楕円）＋背中中央の
 * 縦の分割線＋頭部前方の小さな角。分割線・角は固定色の線のみ（塗りではない）。
 */
function BeetleGlyph({ fill }: { fill: string }) {
  return (
    <>
      <Ellipse cx={50} cy={62} rx={26} ry={28} fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
      <Ellipse cx={50} cy={34} rx={16} ry={14} fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
      <Line x1={50} y1={38} x2={50} y2={88} stroke={FIXED} strokeWidth={2} strokeOpacity={0.7} />
      <Path d="M50 16 L46 26 L54 26 Z" fill="none" stroke={FIXED} strokeWidth={2.5} strokeLinejoin="round" strokeOpacity={0.7} />
    </>
  );
}

/**
 * ちょうちょ: 上下2対・計4枚の翼（上翼は大きめの丸みを帯びた三角形、下翼は
 * 小さめ）＋中央の胴体（縦長のカプセル形）＋頭部（小さい円）＋触角2本。
 * 胴体・頭部・触角は固定色（レアリティ色に関わらず常に同じ）。
 */
function ButterflyGlyph({ fill }: { fill: string }) {
  return (
    <>
      {/* 上翼（左右） */}
      <Path d="M48 46 C30 20 6 24 8 46 C10 62 32 58 48 50 Z" fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
      <Path d="M52 46 C70 20 94 24 92 46 C90 62 68 58 52 50 Z" fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
      {/* 下翼（左右、小さめ） */}
      <Path d="M48 54 C36 66 20 74 16 64 C14 56 30 50 48 50 Z" fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
      <Path d="M52 54 C64 66 80 74 84 64 C86 56 70 50 52 50 Z" fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
      {/* 胴体（固定色） */}
      <Ellipse cx={50} cy={54} rx={4} ry={22} fill={FIXED} />
      {/* 頭部（固定色） */}
      <Circle cx={50} cy={30} r={5} fill={FIXED} />
      {/* 触角（固定色） */}
      <Line x1={48} y1={26} x2={42} y2={16} stroke={FIXED} strokeWidth={1.6} strokeLinecap="round" />
      <Line x1={52} y1={26} x2={58} y2={16} stroke={FIXED} strokeWidth={1.6} strokeLinecap="round" />
    </>
  );
}

/** 小さな花: 花びら5枚（72°ずつ配置した5つの円）＋中心の円。花びら・花芯とも同じレアリティ色。 */
function FlowerGlyph({ fill }: { fill: string }) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <>
      {petals.map((deg) => (
        <Circle
          key={deg}
          cx={50 + 24 * Math.cos((deg - 90) * (Math.PI / 180))}
          cy={50 + 24 * Math.sin((deg - 90) * (Math.PI / 180))}
          r={20}
          fill={fill}
          stroke="rgba(0,0,0,0.16)"
          strokeWidth={1}
        />
      ))}
      <Circle cx={50} cy={50} r={14} fill={fill} stroke="rgba(0,0,0,0.16)" strokeWidth={1} />
    </>
  );
}

export default StickerIcon;
