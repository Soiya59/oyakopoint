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

/**
 * 文字列から決定論的な非負整数ハッシュを作る（FNV-1a＋最終ミックス）。
 *
 * [2026-08-24修正] FNV-1aは最後の演算が奇数の素数との乗算であるため、
 * 入力によっては**最下位ビットがほぼ固定される**という偏りがある。実際に
 * `dot-0`〜`dot-19` の20件すべてで `hash % 2 === 0` となることを確認した。
 * このため `% 2` での左右振り分けが全て片側に寄り、さらに
 * pickDisplaySlots の `% (i + 1)` も、i+1が偶数のときは置き換え先が
 * 偶数スロットにしか当たらないという偏りを生んでいた（40件超過時のみ
 * 影響する潜在不具合）。
 * 全ビットが均等に散るよう、最後にavalanche（lowbias32）を掛ける。
 */
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = (h * 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = (h * 0x846ca68b) >>> 0;
  h ^= h >>> 16;
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
 * 段階ごとの木の形。
 *
 * [2026-08-24再改訂・本部長] 初回の作り直しでは段階ごとに「大きさ」だけを変え、
 * 形はどの段階も同じ樹冠にしていた。その結果、芽（stage1）が「小さい木」に
 * 見えてしまい、ユーザーから「これは芽なのかは疑問」との指摘を受けた。
 * 芽は木の縮小版ではなく双葉という別の形であるため、段階ごとに
 * 「形の種類（kind）」自体を変える設計に改めた。
 *   seed  : まだ何も生えていない。土と種のみ
 *   sprout: 双葉。細く短い茎＋左右に開いた2枚の葉（樹冠は作らない）
 *   tree  : 幹＋樹冠。若木→花→実で単調に大きくなる
 */
type StageShape =
  | { kind: "seed" }
  | { kind: "sprout"; stemHeight: number; leafWidth: number; leafHeight: number }
  | { kind: "tree"; leafRadius: number; trunkWidth: number; trunkHeight: number };

const STAGE_GEOMETRY: readonly StageShape[] = [
  { kind: "seed" },
  { kind: "sprout", stemHeight: 26, leafWidth: 66, leafHeight: 40 },
  { kind: "tree", leafRadius: 48, trunkWidth: 12, trunkHeight: 40 },
  { kind: "tree", leafRadius: 62, trunkWidth: 17, trunkHeight: 50 },
  { kind: "tree", leafRadius: 74, trunkWidth: 22, trunkHeight: 58 },
] as const;

/** 双葉の開き角（左右対称）。 */
const SPROUT_LEAF_ANGLE_DEG = 26;

/**
 * 色丸の色を決める。
 *
 * [2026-08-24追加] 本番データを確認したところ、アクティブなメンバー6人のうち
 * 4人が avatar_color 未設定（NULL）であり、従来の実装ではそれらが一律グレーで
 * 描画されていた。07-10章「色分けによる個人の可視化」の目的が実データでは
 * ほぼ成立していない状態だったため、未設定の場合は報告者ID（reported_by）から
 * 決定論的にパレット色（1.3節の8色）を割り当てるフォールバックを入れる。
 * DBには書き込まず表示上のみの割り当てであり、同じ人には常に同じ色が出る。
 */
function dotColor(dot: FamilyTreeCompletionDot): string {
  if (dot.avatar_color) return dot.avatar_color;
  const palette = theme.memberColorPalette;
  return palette[stableHash(dot.reported_by) % palette.length].value;
}

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
function dotOffsetInEllipse(id: string, rx: number, ry: number): { x: number; y: number } {
  const h = stableHash(id);
  const angle = ((h % 3600) / 3600) * Math.PI * 2;
  const normalized = Math.sqrt(((h >>> 11) % 1000) / 1000);
  return { x: Math.cos(angle) * normalized * rx, y: Math.sin(angle) * normalized * ry };
}

function dotOffsetInCircle(id: string, radius: number): { x: number; y: number } {
  return dotOffsetInEllipse(id, radius, radius);
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
  const shape = STAGE_GEOMETRY[stage] ?? STAGE_GEOMETRY[0];
  const soilWidth = SOIL_WIDTH_BY_STAGE[stage] ?? SOIL_WIDTH_BY_STAGE[0];

  return (
    <View style={styles.canvas}>
      {shape.kind === "tree" && (
        <>
          {/* 樹冠は大小3つの円を重ねて作る（1つの楕円だけだと棒付きキャンディに
              見えてしまうため）。色丸は中央の大きい円の内側にだけ配置し、
              常に葉の上に乗っているように見せる。 */}
          {(() => {
            const { leafRadius } = shape;
            const boxWidth = leafRadius * 2.7;
            const boxHeight = leafRadius * 2.05;
            const mainSize = leafRadius * 2;
            const sideSize = leafRadius * 1.3;
            const dotRadius = Math.max(leafRadius - DOT_SIZE, 0);
            return (
              <View style={{ width: boxWidth, height: boxHeight }}>
                <View
                  style={[
                    styles.leafShape,
                    { width: sideSize, height: sideSize, borderRadius: sideSize / 2, left: 0, top: boxHeight - sideSize },
                  ]}
                />
                <View
                  style={[
                    styles.leafShape,
                    { width: sideSize, height: sideSize, borderRadius: sideSize / 2, right: 0, top: boxHeight - sideSize },
                  ]}
                />
                <View
                  style={[
                    styles.leafShape,
                    { width: mainSize, height: mainSize, borderRadius: leafRadius, left: (boxWidth - mainSize) / 2, top: 0 },
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
                          backgroundColor: dotColor(dot),
                          left: boxWidth / 2 + x - DOT_SIZE / 2,
                          top: leafRadius + y - DOT_SIZE / 2,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            );
          })()}
          <View
            style={{
              width: shape.trunkWidth,
              height: shape.trunkHeight,
              marginTop: -2,
              backgroundColor: theme.treeColors.trunk,
              borderBottomLeftRadius: 3,
              borderBottomRightRadius: 3,
            }}
          />
        </>
      )}

      {/* stage1（芽）は双葉。細い茎の先に左右へ開いた葉を2枚つける。
          色丸は葉の子要素として置くので、葉の傾きに合わせて一緒に傾く
          （＝葉の表面に乗っているように見える）。 */}
      {shape.kind === "sprout" && (() => {
        const { stemHeight, leafWidth, leafHeight } = shape;
        const rx = leafWidth / 2 - DOT_SIZE / 2 - 2;
        const ry = leafHeight / 2 - DOT_SIZE / 2 - 2;
        const leftDots = slots.filter((d) => stableHash(d.id) % 2 === 0);
        const rightDots = slots.filter((d) => stableHash(d.id) % 2 === 1);
        // 双葉は左右の葉を「外側の先端が上・内側の付け根が下」に傾けてV字に開く。
        // 回転方向を逆にすると2枚が外へ垂れて1つの塊に重なり、茂みのように
        // 見えてしまう（初回実装の不具合）。CSSの正の回転は時計回りなので、
        // 左の葉が時計回り(+)・右の葉が反時計回り(-)でV字になる。
        const renderLeaf = (leafDots: FamilyTreeCompletionDot[], side: "left" | "right") => (
          <View
            style={[
              styles.leafShape,
              {
                width: leafWidth,
                height: leafHeight,
                borderRadius: leafWidth / 2,
                [side]: 0,
                top: 0,
                transform: [{ rotate: `${side === "left" ? SPROUT_LEAF_ANGLE_DEG : -SPROUT_LEAF_ANGLE_DEG}deg` }],
              },
            ]}
          >
            {leafDots.map((dot) => {
              const { x, y } = dotOffsetInEllipse(dot.id, rx, ry);
              return (
                <View
                  key={dot.id}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: dotColor(dot),
                      left: leafWidth / 2 + x - DOT_SIZE / 2,
                      top: leafHeight / 2 + y - DOT_SIZE / 2,
                    },
                  ]}
                />
              );
            })}
          </View>
        );
        return (
          <View style={{ width: leafWidth * 2, height: leafHeight + stemHeight, alignItems: "center" }}>
            {renderLeaf(leftDots, "left")}
            {renderLeaf(rightDots, "right")}
            <View style={[styles.sproutStem, { height: stemHeight + 8, top: leafHeight - 8 }]} />
          </View>
        );
      })()}

      {/* stage0（種）はまだ何も生えていないので、まかれた種を土の上に散らして見せる。
          色丸が土に埋もれないよう、土より前面へ重ねる。 */}
      {shape.kind === "seed" && (
        <View style={styles.groundScatter}>
          {slots.map((dot) => {
            const { x, y } = dotOffsetOnGround(dot.id);
            return (
              <View
                key={dot.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor: dotColor(dot),
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
  leafShape: {
    position: "absolute",
    backgroundColor: theme.treeColors.foliageBase,
  },
  sproutStem: {
    position: "absolute",
    width: 6,
    backgroundColor: theme.treeColors.trunk,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  dot: {
    position: "absolute",
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1,
    // [2026-08-24修正] 当初は白の縁取りにしていたが、メンバーカラーが
    // パステル調（1.3節の8色）で葉の下地とも明度が近いため、白縁が色を
    // 洗い流して全部が白っぽく見えてしまっていた。暗い半透明の縁に変更して
    // 輪郭だけを締める（勝者演出ではなく単なる視認性確保）。
    borderColor: "rgba(0,0,0,0.16)",
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
