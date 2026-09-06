/**
 * お絵かきの線1本を Douglas-Peucker法で間引く純粋関数。
 * 参照: 開発部/成果物/実装メモ.md 137章（統括承認 2026-09-07）。
 *
 * [なぜ間引くか]
 * DrawingCanvas.tsx の `MIN_POINT_DISTANCE_PX = 4` による間引き（指を動かしている間、
 * 直前の点から4px未満なら点を追加しない）は「点と点の間隔」だけを見る簡易な間引きで、
 * 直線に近い区間でも一定間隔で点を打ち続けてしまう。Douglas-Peucker法は「区間の
 * 始点・終点を結んだ線分からの垂直距離」を見るため、直線に近い区間はまとめて間引き、
 * 曲がっている区間の点は残せる。本部長が統括の実際の絵（86本・1,862点・21,463byte）に
 * 許容値2で適用した検証では 1,190点・14,746byte（-32%）まで減った（実装メモ137章）。
 *
 * [いつ適用するか・触らないもの　※実装上の最重要事項]
 * - **描き終わった瞬間（1本の線が確定したとき）にだけ、その線1本に対して呼ぶ。**
 *   呼び出し元は DrawingCanvas.tsx の `finishStroke`（PanResponderの
 *   `onPanResponderRelease` / `onPanResponderTerminate`）のみ。
 * - **保存済みの絵・DBの既存データには一切適用しない。** 過去に保存済みの`line_data`を
 *   このロジックで書き換える一括処理（マイグレーション等）は行っていない・今回のスコープ外。
 * - **描画中（指を動かしている最中）のライブプレビュー（`livePoints`）には適用しない。**
 *   確定前の点は今回変更していない。指を動かしている間の描き味を変えないため
 *   （案件依頼文の決定事項）。
 *
 * [許容値の単位・値]
 * キャンバス座標系（0〜1000に正規化、スキーマ設計.sql 33b章）での距離。値そのものは
 * `src/theme/theme.ts` の `drawingSimplifyTolerance`（=2）を単一の定義箇所とする。
 * 実際のキャンバス直径280pt（デザイントークン.md 1.9節）に対しては 2/1000*280 ≈ 0.56pt
 * ＝スマホ画面では1ピクセル未満のズレにしかならない。
 *
 * [アルゴリズム・実装メモ]
 * 本部長が実データで検証したPython実装（再帰）と同じ結果になるようTypeScriptへ移植した。
 * ただし**再帰ではなくスタックを使った反復処理**にしている。1本あたり最大300点
 * （`theme.drawingLimits.maxPointsPerLine`）なので再帰でも深さの問題は起きないはずだが、
 * 「念のため再帰が深くならないことを確認する」という依頼文の指示に対し、そもそも再帰を
 * 使わなければ確認するまでもなく安全と判断した（スタックベースのDouglas-Peuckerは
 * 教科書的にもよく知られた同値な実装であり、結果は再帰版と一致する）。
 *
 * [型について]
 * 既存の`FamilyDrawingLine.p`（`src/types/domain.ts`）に合わせ、`[x1,y1,x2,y2,...]`の
 * 平坦な`number[]`のみを入出力形式とする（`[[x,y],...]`形式は扱わない。呼び出し元が
 * 常に平坦配列を持っているため、変換の往復コストをかける理由が無い）。
 */
export function simplifyPolyline(points: readonly number[], tolerance: number): number[] {
  const pointCount = points.length / 2;
  // 0点・1点・2点（始点と終点しか無い）はそのまま返す。これ以上間引く余地が無い。
  // 1点だけの線（タップ）もここで素通りする。
  if (pointCount < 3) return points.slice();

  const keep = new Uint8Array(pointCount);
  keep[0] = 1;
  keep[pointCount - 1] = 1;

  // スタックに「区間の始点index・終点index」を積んで反復処理する
  // （本部長のPython実装の`dp(points[:idx+1])`・`dp(points[idx:])`の再帰呼び出しに相当）。
  const stack: Array<[number, number]> = [[0, pointCount - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop() as [number, number];
    if (endIdx - startIdx < 2) continue; // 区間内に中間点が無い（隣接2点のみ）

    const x1 = points[startIdx * 2];
    const y1 = points[startIdx * 2 + 1];
    const x2 = points[endIdx * 2];
    const y2 = points[endIdx * 2 + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segmentLength = Math.hypot(dx, dy);

    let maxDist = -1;
    let maxIdx = startIdx;
    for (let i = startIdx + 1; i < endIdx; i++) {
      const x = points[i * 2];
      const y = points[i * 2 + 1];
      // 始点と終点が同一点（segmentLength===0）の場合は、その点からの直線距離を使う
      // （Python版の`hypot(x-x1,y-y1)`分岐と同じ）。
      const dist =
        segmentLength === 0
          ? Math.hypot(x - x1, y - y1)
          : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / segmentLength;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([startIdx, maxIdx]);
      stack.push([maxIdx, endIdx]);
    }
  }

  const result: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    if (keep[i]) {
      result.push(points[i * 2], points[i * 2 + 1]);
    }
  }
  return result;
}
