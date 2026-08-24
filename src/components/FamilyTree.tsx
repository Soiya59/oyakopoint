import React, { useMemo, useState } from "react";
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
// [2026-08-24拡大] 木の拡大にあわせて色丸も少し大きくする。樹冠の面積が約2.9倍に
// なったため、丸を大きくしても拡大前より密度は下がる（＝重なりにくくなる）。
const DOT_SIZE = 13;

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

// [2026-08-24拡大・本部長] ユーザーから「家族の木はもっと大きくてもよい、
// スマホ画面の3分の2くらい」との要望を受けて全段階を拡大した。
// 制約は縦ではなく**横**にある。スマホ幅375ptから余白を引いた実質340ptに
// 樹冠の横幅（leafRadius * 2.7）が収まる必要があり、leafRadius=125 が上限に近い
// （125 * 2.7 = 337.5pt）。この横幅に対して樹冠の高さは自動的に決まるため、
// 画面の3分の2に近づけるぶんは幹を長くして稼いでいる（幹が長いほど、将来
// 枝先に飾りを吊るす余地も増える）。実の段階で全体約480pt≒画面の約60%。
// 樹冠の面積は拡大前の約2.9倍になり、色丸40個が重なりにくくなる。
const STAGE_GEOMETRY: readonly StageShape[] = [
  { kind: "seed" },
  { kind: "sprout", stemHeight: 62, leafWidth: 116, leafHeight: 70 },
  { kind: "tree", leafRadius: 82, trunkWidth: 20, trunkHeight: 88 },
  { kind: "tree", leafRadius: 105, trunkWidth: 27, trunkHeight: 110 },
  { kind: "tree", leafRadius: 125, trunkWidth: 34, trunkHeight: 130 },
] as const;

/**
 * 表示領域の高さを全段階で固定するための値（実の段階の全高に合わせる）。
 * 段階ごとに高さが変わると、成長した瞬間に画面がガタつくうえ、
 * 種・芽の段階で「まだ小さい」ことが余白の少なさとして伝わってしまう。
 * 高さを固定して下端（地面）を揃えることで、小さい段階では上方向に
 * 伸びしろが見える＝「これから育つ」ことが余白として伝わるようにする。
 */
// 樹冠256(=125*2.05) + 幹130 + 土110 ≒ 496。
// [2026-08-24再改訂] 地面を下方向に広げた分だけ全体も高くした（木の位置は変えず、
// 下に伸ばすだけ）。スマホ812ptに対して約64%で、当初の要望「画面の3分の2くらい」
// にほぼ一致する。
const CANVAS_HEIGHT = 520;

/** 双葉の開き角（左右対称）。 */
const SPROUT_LEAF_ANGLE_DEG = 26;

/**
 * 色丸の色を決める。
 *
 * [2026-08-24] 一時は「avatar_colorがNULLなら報告者IDから色を導出する」という
 * 表示側フォールバックを入れたが、**内訳リストのアバター（MemberAvatar）には
 * 同じ処理が無いため、木の色丸と内訳の色が食い違う**という不整合をユーザーの
 * 実機確認で指摘された。表示箇所ごとにフォールバックを実装して回る方式は
 * 漏れが必ず起きるため撤回し、データ側で全メンバーに色を持たせる方式に変更した
 * （マイグレーション 20260824221436_assign_avatar_color_to_all_members.sql。
 * 保護者・みまもりメンバーを作る3つのRPCが avatar_color を一切設定していない
 * という根本原因を修正し、既存メンバーにも色を補充した）。
 * よってここは素直にavatar_colorを使う。万一NULLが残っていた場合はグレーに
 * なるが、それは内訳リスト側の表示とも一致する（食い違わない）。
 */
function dotColor(dot: FamilyTreeCompletionDot): string {
  return dot.avatar_color ?? theme.colors.neutralBorder;
}

// [2026-08-24再改訂] 当初は段階ごとに土の幅を変えていたが、
// 「地面は端まで届かせて、下方向に広げてよい」との指摘を受けて全段階で
// 画面幅いっぱいに変更した。地面は木と違って「育つもの」ではないので、
// 段階によって広さが変わる必然性がそもそも無い。
// 面積が広がったことで、色丸の「地面タイプ」の配分が意味を持つようになる。
const SOIL_HEIGHT = 110;
/** stage0（種）で、まかれた種を散らす範囲の半径。地面に沿うよう縦は潰す。 */
const SEED_SCATTER_RADIUS = 56;

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

/**
 * 木の段階（stage2以降）で、色丸をどの部位に置くかを決める。
 *
 * [2026-08-24追加・本部長] 当初は樹冠の中央の円の内側にしか置いていなかったが、
 * ユーザーから「木全体に色を散らばせたい。そのほうが1つ1つの木に特徴が出て
 * 面白い」との要望を受けて、幹・地面・葉の左右のふくらみにも置けるようにした。
 * 割合は樹冠を主役に保ちつつ、他の部位にも必ず幾つか乗るよう調整している。
 *
 * 位置決め（dotOffsetInEllipse）とは**別のハッシュ**を使う。同じハッシュの
 * 別ビットを使うと部位と座標に相関が出て、特定の部位だけ角度が偏るため。
 */
type TreeRegion = "canopy" | "lobeLeft" | "lobeRight" | "trunk" | "soil" | "sky";

const REGION_WEIGHTS: readonly (readonly [TreeRegion, number])[] = [
  ["canopy", 45],
  ["lobeLeft", 11],
  ["lobeRight", 11],
  ["trunk", 5],
  ["soil", 11],
  ["sky", 17],
] as const;

/**
 * 空に散る色丸の配置範囲。木より少し広めにとり、木の**背面**に描画する。
 * 背面に置くことで、木に重なった分は隠れて「空いている場所にだけ現れる」形になり、
 * 段階によって空の広さが変わっても（若木は上が広く、実は左右だけ空く）
 * 自動的に馴染む。
 */
/** 幅を実測できるまでの初期値。実測後は onLayout の値を使う。 */
const FALLBACK_WIDTH = 320;

function pickTreeRegion(id: string): TreeRegion {
  const h = stableHash(`${id}|region`) % 100;
  let acc = 0;
  for (const [region, weight] of REGION_WEIGHTS) {
    acc += weight;
    if (h < acc) return region;
  }
  return "canopy";
}

export function TreeStageVisual({ stage, dots }: { stage: number; dots: FamilyTreeCompletionDot[] }) {
  const slots = useMemo(
    () => pickDisplaySlots(dots).filter((d): d is FamilyTreeCompletionDot => d !== null),
    [dots]
  );
  const shape = STAGE_GEOMETRY[stage] ?? STAGE_GEOMETRY[0];
  // 幅は固定値ではなく実測する。固定値だと画面幅とずれ、はみ出した分が
  // React Nativeの既定の切り取りで消える（空の色丸が出ない不具合の原因になった）。
  const [canvasWidth, setCanvasWidth] = useState(FALLBACK_WIDTH);

  // 木の段階だけ、色丸を部位ごとに振り分ける（種・芽は従来どおり地面／双葉に置く）。
  const byRegion = useMemo(() => {
    const map: Record<TreeRegion, FamilyTreeCompletionDot[]> = {
      canopy: [], lobeLeft: [], lobeRight: [], trunk: [], soil: [], sky: [],
    };
    if (shape.kind === "tree") {
      for (const dot of slots) map[pickTreeRegion(dot.id)].push(dot);
    } else if (shape.kind === "sprout") {
      // 芽は樹冠・幹が無いので双葉と空だけに振り分ける。芽の段階は完了報告が
      // 10〜29件あり、2枚の葉だけでは密集しがちなため、空に逃がす意味もある。
      for (const dot of slots) {
        const r = pickTreeRegion(dot.id);
        if (r === "sky") map.sky.push(dot);
        else if (r === "soil" || r === "trunk") map.soil.push(dot); // 芽には幹が無いので地面へ寄せる
        else if (stableHash(dot.id) % 2 === 0) map.lobeLeft.push(dot);
        else map.lobeRight.push(dot);
      }
    }
    return map;
  }, [slots, shape.kind]);

  /** 指定した楕円の中に、決定論的に色丸を1つ置く。 */
  const renderDot = (dot: FamilyTreeCompletionDot, cx: number, cy: number, rx: number, ry: number) => {
    const { x, y } = dotOffsetInEllipse(dot.id, Math.max(rx, 0), Math.max(ry, 0));
    return (
      <View
        key={dot.id}
        style={[
          styles.dot,
          { backgroundColor: dotColor(dot), left: cx + x - DOT_SIZE / 2, top: cy + y - DOT_SIZE / 2 },
        ]}
      />
    );
  };

  return (
    <View
      style={styles.canvas}
      onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}
    >
      {/* 背景（晴れた空）。太陽と雲は固定色で、個人色には染めない。
          いちばん背面に置き、木や色丸より目立たないよう彩度を抑える。 */}
      <View style={styles.skyBackground} pointerEvents="none">
        <View style={styles.sun} />
        <View style={[styles.cloudPuff, { width: 58, height: 58, borderRadius: 29, left: 18, top: 96 }]} />
        <View style={[styles.cloudPuff, { width: 42, height: 42, borderRadius: 21, left: 56, top: 108 }]} />
        <View style={[styles.cloudPuff, { width: 36, height: 36, borderRadius: 18, left: 0, top: 112 }]} />
        <View style={[styles.cloudPuff, { width: 46, height: 46, borderRadius: 23, right: 24, top: 168 }]} />
        <View style={[styles.cloudPuff, { width: 34, height: 34, borderRadius: 17, right: 58, top: 178 }]} />
      </View>

      {/* 空に散る色丸。木より背面になるよう木の前に置く。木に重なった分は
          隠れる＝空いている場所にだけ現れる（SKY_WIDTHのコメント参照）。 */}
      <View style={styles.skyLayer} pointerEvents="none">
        {byRegion.sky.map((dot) =>
          renderDot(dot, canvasWidth / 2, CANVAS_HEIGHT * 0.36, canvasWidth / 2 - DOT_SIZE, CANVAS_HEIGHT * 0.32)
        )}
      </View>

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
                {byRegion.canopy.map((dot) =>
                  renderDot(dot, boxWidth / 2, leafRadius, dotRadius, dotRadius)
                )}
                {byRegion.lobeLeft.map((dot) =>
                  renderDot(dot, sideSize / 2, boxHeight - sideSize / 2, sideSize / 2 - DOT_SIZE, sideSize / 2 - DOT_SIZE)
                )}
                {byRegion.lobeRight.map((dot) =>
                  renderDot(dot, boxWidth - sideSize / 2, boxHeight - sideSize / 2, sideSize / 2 - DOT_SIZE, sideSize / 2 - DOT_SIZE)
                )}
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
          >
            {byRegion.trunk.map((dot) =>
              renderDot(
                dot,
                shape.trunkWidth / 2,
                shape.trunkHeight / 2,
                shape.trunkWidth / 2 - DOT_SIZE / 2,
                shape.trunkHeight / 2 - DOT_SIZE
              )
            )}
          </View>
        </>
      )}

      {/* stage1（芽）は双葉。細い茎の先に左右へ開いた葉を2枚つける。
          色丸は葉の子要素として置くので、葉の傾きに合わせて一緒に傾く
          （＝葉の表面に乗っているように見える）。 */}
      {shape.kind === "sprout" && (() => {
        const { stemHeight, leafWidth, leafHeight } = shape;
        const rx = leafWidth / 2 - DOT_SIZE / 2 - 2;
        const ry = leafHeight / 2 - DOT_SIZE / 2 - 2;
        // 空に振り分けられた分は上のskyLayerが描くので、ここでは葉の分だけを使う
        // （両方で描くと同じ色丸が二重に出てしまう）。
        const leftDots = byRegion.lobeLeft;
        const rightDots = byRegion.lobeRight;
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

      {/* 地面は全段階で画面幅いっぱい。上端だけ緩く丸めて、平らな板ではなく
          なだらかな地平線に見せる。 */}
      <View style={styles.soil}>
        {byRegion.soil.map((dot) =>
          renderDot(
            dot,
            canvasWidth / 2,
            SOIL_HEIGHT / 2 + 6,
            canvasWidth / 2 - DOT_SIZE,
            SOIL_HEIGHT / 2 - DOT_SIZE
          )
        )}
      </View>
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
  // 高さを固定し、下端（地面）を揃える。段階が上がっても画面がガタつかない。
  canvas: {
    // 空の色丸レイヤーを収めるため横幅いっぱいに広げる。木の幅しか無いと
    // はみ出した空の色丸が切り取られて消える。
    width: "100%",
    height: CANVAS_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: theme.spacing.s4,
  },
  skyBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CANVAS_HEIGHT,
    backgroundColor: theme.treeColors.sky,
    borderRadius: theme.radius.childXl,
    overflow: "hidden",
  },
  sun: {
    position: "absolute",
    right: 26,
    top: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.treeColors.sun,
  },
  cloudPuff: {
    position: "absolute",
    backgroundColor: theme.treeColors.cloud,
    opacity: 0.85,
  },
  skyLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CANVAS_HEIGHT,
  },
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
    alignSelf: "stretch",
    height: SOIL_HEIGHT,
    backgroundColor: theme.treeColors.soil,
    borderTopLeftRadius: 44,
    borderTopRightRadius: 44,
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
