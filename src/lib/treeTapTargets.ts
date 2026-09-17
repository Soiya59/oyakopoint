/**
 * 家族の木の飾り（景品・ステッカー）タップ判定の核（主要画面ワイヤーフレーム.md
 * 46.2節 決定2〜4、開発部/成果物/実装メモ.md 233章）。
 *
 * UIにもFamilyTree.tsx（react-native・react-native-svgに依存）にも依存しない
 * 純粋関数として切り出し、`node`で直接実行できるようにする
 * （src/lib/simplifyPolyline.ts・src/lib/groupDuplicateRows.ts と同じ方針）。
 *
 * 決定2: 各対象の「捕まえる範囲（キャッチ半径）」は見た目の大きさではなく、
 *   ロールごとのタップ領域の基準値（theme.tapTarget、子56／保護者44／
 *   みまもり48pt＝直径）を使う。呼び出し元（FamilyTree.tsx）がこの直径を
 *   `catchRadius`（直径の半分）に変換して渡す。
 * 決定3: 複数の対象のキャッチ範囲にタップ位置が入った場合は、タップ位置に
 *   最も近い中心を持つ対象を選ぶ（一番上に描かれているものを優先、のような
 *   描画順に依存する選び方は採らない。20章決定4「決定論的な計算」と矛盾しないため）。
 * 決定4: どの対象のキャッチ範囲にも入らない場合（空振り）はnullを返す。
 */

export interface TreeTapTarget {
  /** 呼び出し元が付ける一意なキー（例: `prize:<completion_id>` / `sticker:<decoration_id>`）。 */
  id: string;
  /** キャンバス絶対座標（TreeStageVisualが実測・計算した canvasWidth × CANVAS_HEIGHT の座標系）。 */
  x: number;
  y: number;
  /** キャッチ半径（直径ではなく半径。theme.tapTargetの値の半分）。 */
  catchRadius: number;
}

/**
 * タップ位置ともっとも近い対象のidを返す。どの対象のキャッチ範囲にも
 * 入らなければnull（決定4）。複数の対象のキャッチ範囲に同時に入っている
 * 場合は、距離が最も近いものを選ぶ（決定3）。
 */
export function pickNearestTreeTapTarget(
  tapX: number,
  tapY: number,
  targets: readonly TreeTapTarget[]
): string | null {
  let bestId: string | null = null;
  let bestDistance = Infinity;
  for (const target of targets) {
    const distance = Math.hypot(tapX - target.x, tapY - target.y);
    if (distance <= target.catchRadius && distance < bestDistance) {
      bestDistance = distance;
      bestId = target.id;
    }
  }
  return bestId;
}
