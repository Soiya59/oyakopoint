import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import type { FamilyTreeCompletionDot } from "@/data/api";
import type { FamilyTreeMemberBreakdown } from "@/types/domain";
import MemberAvatar from "./MemberAvatar";

/**
 * 家族の木の共通ビジュアル（P26/C20/S14の3画面から共有）。
 * 参照: 主要画面ワイヤーフレーム.md 20章、デザイントークン.md 1.8節。
 *
 * 決定1: 木の共有部分（土・幹・葉の土台）は個人色に一切染めない（固定色）。
 * 決定2: 完了報告1件ごとの視覚要素は絵文字自体の着色ではなく、avatar_colorで
 *   塗った小さな色丸として表現する。
 * 決定3・4: 表示上限40スロット。上限到達後は新しい完了報告のたびに、
 *   完了報告のIDをシードにした決定論的な計算で既存スロットを置き換える
 *   （reservoir sampling。クライアント側の乱数は使わない）。
 *
 * [2026-08-24改訂・本部長] 実機で「見た目が微妙」との指摘を受けて描画を作り直した。
 * 旧実装は「段階の絵文字1個＋その上に色丸をflex-wrapで並べる」構成だったため、
 * 色丸が木と無関係な升目のように上空に浮いて見え、さらに芽（stage1）以下では
 * 葉の土台が透明で色丸の置き場所が無かった。本実装では葉・幹・土をViewで
 * 実際に描き、色丸は葉の内側に決定論的に散らして配置する（色丸が「木に実った
 * もの」として読めるようにする）。段階の絵文字は木の絵の代わりではなく、
 * 各画面の段階名テキストに添える役割へ移した。
 */

const MAX_SLOTS = 40;
const DOT_SIZE = 9;

/** 文字列から決定論的な非負整数ハッシュを作る（FNV-1a風の簡易実装）。 */
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 決定3・4のreservoir sampling実装。dotsは`reported_at`昇順であることを前提とする
 * （src/data/api.ts fetchFamilyTreeCompletionDots がその順で返す）。
 */
export function pickDisplaySlots(dots: FamilyTreeCompletionDot[]): (FamilyTreeCompletionDot | null)[] {
  const slots: (FamilyTreeCompletionDot | null)[] = Array.from({ length: MAX_SLOTS }, () => null);
  dots.forEach((dot, i) => {
    if (i < MAX_SLOTS) {
      slots[i] = dot;
      return;
    }
    const j = stableHash(dot.id) % (i + 1);
    if (j < MAX_SLOTS) slots[j] = dot;
  });
  return slots;
}

/**
 * 段階ごとの木の寸法。段階が上がるほど葉が大きく・幹が太く高くなる。
 * stage0（種）はまだ木が生えていないため葉も幹も持たず、色丸は土の中に
 * 「まかれた種」として配置する（0件でも寂しく見えないよう種の絵は常に描く）。
 */
const STAGE_GEOMETRY = [
  { hasTree: false, leafRadius: 0, trunkWidth: 0, trunkHeight: 0 },
  { hasTree: true, leafRadius: 42, trunkWidth: 10, trunkHeight: 24 },
  { hasTree: true, leafRadius: 54, trunkWidth: 14, trunkHeight: 38 },
  { hasTree: true, leafRadius: 64, trunkWidth: 18, trunkHeight: 48 },
  { hasTree: true, leafRadius: 72, trunkWidth: 22, trunkHeight: 56 },
] as const;

// 土は「板」に見えないよう、段階に応じて幅が変わる横長の楕円（土の盛り上がり）にする。
const SOIL_WIDTH_BY_STAGE = [92, 116, 136, 152, 164] as const;
const SOIL_HEIGHT = 18;
/** stage0（種）で、まかれた種を散らす範囲の半径。地面に沿うよう縦は潰す。 */
const SEED_SCATTER_RADIUS = 32;

/**
 * 完了報告IDから、葉の円の内側の座標を決定論的に求める。
 * 極座標で求め、半径にsqrtを掛けることで円内に偏りなく散る（中心に密集しない）。
 * 乱数を使わないため、どの家族メンバーの端末で見ても必ず同じ配置になる。
 */
function dotOffsetInCircle(id: string, radius: number): { x: number; y: number } {
  const h = stableHash(id);
  const angle = ((h % 3600) / 3600) * Math.PI * 2;
  const normalized = Math.sqrt(((h >>> 11) % 1000) / 1000);
  const r = normalized * radius;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/**
 * stage0（種）用。地面にまかれた種として、土の上に低く広がるように散らす。
 * 円内配置の縦だけを潰して、一直線に並ばず・浮き上がりもしない見え方にする。
 */
function dotOffsetOnGround(id: string): { x: number; y: number } {
  const { x, y } = dotOffsetInCircle(id, SEED_SCATTER_RADIUS);
  return { x, y: y * 0.42 };
}

export function TreeStageVisual({ stage, dots }: { stage: number; dots: FamilyTreeCompletionDot[] }) {
  const slots = useMemo(
    () => pickDisplaySlots(dots).filter((d): d is FamilyTreeCompletionDot => d !== null),
    [dots]
  );
  const geometry = STAGE_GEOMETRY[stage] ?? STAGE_GEOMETRY[0];
  const { hasTree, leafRadius, trunkWidth, trunkHeight } = geometry;

  // 葉のかたまりは大小3つの円を重ねて作る（1つの楕円だけだと棒付きキャンディに
  // 見えてしまうため）。色丸は中央の大きい円の内側にだけ配置し、常に葉の上に
  // 乗っているように見せる。
  const soilWidth = SOIL_WIDTH_BY_STAGE[stage] ?? SOIL_WIDTH_BY_STAGE[0];
  const leafBoxWidth = leafRadius * 2.7;
  const leafBoxHeight = leafRadius * 2.05;
  const mainLeafSize = leafRadius * 2;
  const sideLeafSize = leafRadius * 1.3;
  const dotRadius = Math.max(leafRadius - DOT_SIZE, 0);

  return (
    <View style={styles.canvas}>
      {hasTree && (
        <View style={{ width: leafBoxWidth, height: leafBoxHeight }}>
          <View
            style={[
              styles.leafCircle,
              {
                width: sideLeafSize,
                height: sideLeafSize,
                borderRadius: sideLeafSize / 2,
                left: 0,
                top: leafBoxHeight - sideLeafSize,
              },
            ]}
          />
          <View
            style={[
              styles.leafCircle,
              {
                width: sideLeafSize,
                height: sideLeafSize,
                borderRadius: sideLeafSize / 2,
                right: 0,
                top: leafBoxHeight - sideLeafSize,
              },
            ]}
          />
          <View
            style={[
              styles.leafCircle,
              {
                width: mainLeafSize,
                height: mainLeafSize,
                borderRadius: leafRadius,
                left: (leafBoxWidth - mainLeafSize) / 2,
                top: 0,
              },
            ]}
          />
          {slots.map((dot) => {
            const { x, y } = dotOffsetInCircle(dot.id, dotRadius);
            return (
              <View
                key={dot.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor: dot.avatar_color ?? theme.colors.neutralBorder,
                    left: leafBoxWidth / 2 + x - DOT_SIZE / 2,
                    top: leafRadius + y - DOT_SIZE / 2,
                  },
                ]}
              />
            );
          })}
        </View>
      )}

      {hasTree && (
        <View
          style={{
            width: trunkWidth,
            height: trunkHeight,
            marginTop: -2,
            backgroundColor: theme.treeColors.trunk,
            borderBottomLeftRadius: 3,
            borderBottomRightRadius: 3,
          }}
        />
      )}

      {/* stage0（種）はまだ木が無いので、まかれた種を土の上に散らして見せる。
          色丸が土に埋もれないよう、木がある段階と違って土より前面へ重ねる。 */}
      {!hasTree && (
        <View style={styles.groundScatter}>
          {slots.map((dot) => {
            const { x, y } = dotOffsetOnGround(dot.id);
            return (
              <View
                key={dot.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor: dot.avatar_color ?? theme.colors.neutralBorder,
                    left: SEED_SCATTER_RADIUS + x - DOT_SIZE / 2,
                    top: SEED_SCATTER_RADIUS * 0.42 + y - DOT_SIZE / 2,
                  },
                ]}
              />
            );
          })}
          <View style={styles.seed} />
        </View>
      )}

      <View
        style={[
          styles.soil,
          {
            width: soilWidth,
            borderTopLeftRadius: soilWidth / 2,
            borderTopRightRadius: soilWidth / 2,
            borderBottomLeftRadius: soilWidth / 2,
            borderBottomRightRadius: soilWidth / 2,
          },
        ]}
      />
    </View>
  );
}

/**
 * 詳細内訳（タップ表示）。07-10章必須3条件:
 * ①ソートしない（呼び出し元がmember_created_at昇順で渡す前提。本コンポーネントは
 *   受け取った配列の順序をそのまま表示するのみで、内部で再ソートしない）
 * ②勝者演出を入れない（強調枠・ハイライト・1位ラベル等を一切描画しない）
 * ③比較誘発コピーを使わない（呼び出し元の見出し文言側で担保）
 */
export function FamilyTreeBreakdownList({
  breakdown,
  countLabel = "回",
}: {
  breakdown: FamilyTreeMemberBreakdown[];
  countLabel?: string;
}) {
  return (
    <View style={{ gap: theme.spacing.s2 }}>
      {breakdown.map((row) => (
        <View key={row.member_id} style={styles.breakdownRow}>
          <MemberAvatar name={row.display_name} color={row.avatar_color} size={28} />
          <Text style={[theme.typography.parentBody, styles.breakdownName]}>{row.display_name}</Text>
          <Text style={theme.typography.parentBodyMedium}>
            {row.completion_count}
            {countLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { alignItems: "center", justifyContent: "flex-end", paddingVertical: theme.spacing.s4 },
  leafCircle: {
    position: "absolute",
    backgroundColor: theme.treeColors.foliageBase,
  },
  dot: {
    position: "absolute",
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1,
    // 葉の緑・土の茶に対して色丸の輪郭を立たせ、同系色のavatar_colorでも
    // 埋もれないようにする（勝者演出ではなく単なる視認性確保）。
    borderColor: "rgba(255,255,255,0.7)",
  },
  soil: {
    height: SOIL_HEIGHT,
    backgroundColor: theme.treeColors.soil,
  },
  groundScatter: {
    width: SEED_SCATTER_RADIUS * 2,
    height: SEED_SCATTER_RADIUS * 0.42 * 2,
    marginBottom: -SEED_SCATTER_RADIUS * 0.42,
    zIndex: 1,
  },
  seed: {
    position: "absolute",
    left: SEED_SCATTER_RADIUS - 7,
    bottom: -2,
    width: 14,
    height: 11,
    borderRadius: 7,
    backgroundColor: theme.treeColors.trunk,
  },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  breakdownName: { flex: 1 },
});

export default TreeStageVisual;
