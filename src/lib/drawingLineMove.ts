/**
 * お絵かきの「うごかす」道具（✋、実装メモ.md 315章、本部長依頼・軽微変更ルート
 * 2026-09-27・統括承認済み「おすすめで！」）で使う純粋関数。UIにもDrawingCanvas.tsx
 * （react-native-svgに依存）にも依存しない形に切り出し、`node`単体実行で検証できる
 * ようにする（`src/lib/drawingShapes.ts`・`drawingCanvasCoords.ts`と同じ方針）。
 *
 * [座標・太さの単位について]
 * この関数群が受け取る座標・太さの値は、呼び出し元（`DrawingCanvas.tsx`）側で
 * 「0〜1000正規化座標と同じ比率」に変換済みであることを前提とする。線の太さ
 * （`FamilyDrawingLine.w`、実ピクセル単位）も、呼び出し元が`(w / size) * 1000`
 * （`drawingCanvasCoords.ts`の`normalizeDrawingPoint`と同じ比率）で正規化してから
 * `HitTestLine.halfWidth`として渡すこと。こうすることで、この関数自体は
 * キャンバスの実サイズ（`size`）を一切知らずに済み、平易な数値だけでテストできる
 * （`drawingCanvasCoords.ts`が担う「単位変換」と、この先の「判定・変形」の役割を
 * 分ける考え方は同じ）。
 *
 * [どれをつかむか・依頼文の決定]
 * - 重なっているときは、あとから描いた（`lines`配列の後ろにある＝SVGの描画順で
 *   上に表示されている）ものを優先する。`lines`を後ろから走査し、最初に条件を
 *   満たした行を返す。
 * - 手描きの線・形の輪郭は、線の太さの半分（`halfWidth`）に加えて`extraTolerance`
 *   ぶん判定の幅を広げる（依頼文「手描きの線は細いので、つかみやすいように
 *   判定の幅を少し広げる」）。
 * - 塗った形（`filled: true`）は、輪郭の近くでなくても、形の内側を押していれば
 *   つかめる（多角形の内外判定を追加で行う。依頼文「塗った形は、形の内側を
 *   押してもつかめるようにする」）。
 */

/** 判定対象の1本の線。`FamilyDrawingLine`から必要な項目だけを抜き出した形。 */
export interface HitTestLine {
  /** [x1,y1,x2,y2,...]。呼び出し元と同じ0〜1000正規化座標に揃えて渡すこと。 */
  p: readonly number[];
  /** 線の太さの半分。`p`と同じ単位（正規化座標）に変換済みであること。 */
  halfWidth: number;
  /** 塗った形かどうか（`FamilyDrawingLine.f`）。 */
  filled?: boolean;
}

/** 点(px,py)から線分(x1,y1)-(x2,y2)までの最短距離。 */
function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    // 長さ0の線分（同一点が2つ連続、通常は起きないが念のため）。点との距離をそのまま返す。
    return Math.hypot(px - x1, py - y1);
  }
  // 点から線分への正射影の位置（線分の範囲=0〜1にクランプ）。
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return Math.hypot(px - nearestX, py - nearestY);
}

/** 点(px,py)から、連続する線分の折れ線（p=[x1,y1,x2,y2,...]）までの最短距離。 */
function distanceToPolyline(p: readonly number[], px: number, py: number): number {
  let min = Infinity;
  for (let i = 0; i < p.length - 2; i += 2) {
    const d = distanceToSegment(px, py, p[i], p[i + 1], p[i + 2], p[i + 3]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * 点(px,py)が、閉じた多角形p=[x1,y1,x2,y2,...]の内側にあるか（レイキャスト法）。
 * `shapeToPolyline`（丸／三角／四角）が組み立てる形はいずれも始点=終点で閉じて
 * いる（`drawingShapes.verify.ts`「始点と終点が一致する」で確認済み）ため、
 * 末尾→先頭の辺を別途足さなくても、この重複した長さ0の辺が混ざるだけで
 * 判定結果には影響しない。
 */
function isPointInClosedPolygon(p: readonly number[], px: number, py: number): boolean {
  const n = p.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2];
    const yi = p[i * 2 + 1];
    const xj = p[j * 2];
    const yj = p[j * 2 + 1];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * 点(x,y)でつかめる線を探す。重なっていれば、あとから描いた（配列の後ろ）ものを
 * 優先する。何もつかめなければ`null`。
 *
 * `lines`は2点未満（`p.length < 4`）の行を含まないこと（DB側
 * `chk_family_drawings_line_data`・`chk_member_avatars_line_data`が既に2要素以上を
 * 要求しており保存データには起きないが、念のためこの関数内でもスキップする）。
 */
export function findLineIndexAtPoint(
  lines: readonly HitTestLine[],
  x: number,
  y: number,
  extraTolerance: number
): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.p.length < 4) continue;
    if (line.filled && isPointInClosedPolygon(line.p, x, y)) return i;
    const tolerance = line.halfWidth + extraTolerance;
    if (distanceToPolyline(line.p, x, y) <= tolerance) return i;
  }
  return null;
}

/** `drawingShapes.ts`の`clampNormalized`と同じ式（0〜1000への丸め込みクランプ）。
 *  1行だけの関数のため、既にレビュー済みの`drawingShapes.ts`を触らずこちらに
 *  複製する（`drawingCanvasCoords.ts`のように共有するほどの複雑さが無いため）。 */
function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}

/**
 * 線の全ての点を(dx,dy)だけ平行移動する。各座標を独立に0〜1000でクランプする。
 *
 * [キャンバスの外に出る扱い・依頼文の決定と理由]
 * 丸いキャンバス自体は「正方形0〜1000へ各座標を独立にクランプし、円形クリップ
 * （`DrawingCanvas.tsx`の`styles.circle`の`overflow: hidden`）で見た目上の
 * はみ出しを隠す」という既存のルールで動いている（`drawingCanvasCoords.ts`の
 * `normalizeDrawingPoint`・`drawingShapes.ts`の`clampNormalized`と同じ式）。
 * 動かした線だけ別の規則（例: 丸の半径で強制的に押し戻す）を持たせると、
 * ペンで直接キャンバスの四隅まで描いた場合と挙動が食い違ってしまうため、
 * ここでも同じ「各座標を独立に0〜1000へクランプするだけ」に揃えた。
 */
export function translateLinePoints(points: readonly number[], dx: number, dy: number): number[] {
  // [2026-09-27修正・本部長レビュー] 点ごとに0〜1000へ寄せると、端まで動かしたときに
  // はみ出た点だけがつぶれて形が変わる（丸が平たくなる）。形ごと端で止まるよう、
  // 先に「形の外枠が0〜1000に収まる範囲」へずらす量を絞ってから、全部の点を同じだけ動かす。
  if (points.length < 2) return [...points];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  const cdx = Math.min(Math.max(dx, 0 - minX), 1000 - maxX);
  const cdy = Math.min(Math.max(dy, 0 - minY), 1000 - maxY);
  const out: number[] = new Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = clampNormalized(points[i] + cdx);
    out[i + 1] = clampNormalized(points[i + 1] + cdy);
  }
  return out;
}
