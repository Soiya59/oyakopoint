/**
 * お絵かきの「うごかす」道具（✋、実装メモ.md 315・316章、本部長依頼・軽微変更ルート
 * 2026-09-27・統括承認済み「おすすめで！」「Aで！」）で使う純粋関数。UIにもDrawingCanvas.tsx
 * （react-native-svgに依存）にも依存しない形に切り出し、`node`単体実行で検証できる
 * ようにする（`src/lib/drawingShapes.ts`・`drawingCanvasCoords.ts`と同じ方針）。
 *
 * [2026-09-27追加・実装メモ.md 316章、本部長依頼「回す」機能] `rotateLinePoints`を
 * このファイルへ追加した。「つかんで動かす（`translateLinePoints`）」と「つかんで
 * 選び、回す（`rotateLinePoints`）」は同じ✋道具・同じ`onLineMove(index, points)`
 * コールバック（`p`を書き換えるだけ）を共有する、ごく近い機能のため、別ファイルへは
 * 分けなかった（依頼文「（または新しい`*.verify.ts`）」の選択として、既存ファイルへの
 * 追加を選んだ理由）。
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
 * [2026-09-27追加・実装メモ.md 316章、本部長依頼「回す」機能・統括決定「A案」]
 * 線の全ての点を、外接矩形（バウンディングボックス）の中心のまわりに`angleDeg`度
 * （時計回り、正の値）だけ回す。
 *
 * [中心の決め方] `translateLinePoints`・`drawingShapes.ts`の`shapeToPolyline`
 * （丸・四角・三角のいずれも外接矩形の中心を基準に組み立てる）と同じ考え方で、
 * 「その時点で渡された`points`の外接矩形の中心」を回転の中心とする。形そのものの
 * 重心（面積の中心）ではなく外接矩形の中心なので、三角形のような非対称な形では
 * 見た目の重心とわずかにずれるが、依頼文に厳密な定義の指定が無く、既存の関数群と
 * 同じ基準に揃えるほうが一貫性がある。
 *
 * [時計回りの向き] このプロジェクトの正規化座標はSVGと同じくyが下向き（上端0・
 * 下端1000）。この座標系で標準の回転行列
 *   x' = cx + (x-cx)cosθ - (y-cy)sinθ
 *   y' = cy + (x-cx)sinθ + (y-cy)cosθ
 * に正のθ（時計回り側）を渡すと、見た目には時計回りに回る（SVGの`rotate()`
 * 変換が正の角度で時計回りになるのと同じ理由。y軸が下向きのため、数学の教科書の
 * 「反時計回りが正」がそのまま画面上では時計回りに見える）。
 *
 * [丸め誤差を積み重ねない・依頼文の決定] この関数は呼ばれるたびに、渡された
 * `points`（呼び出し元は「選んだ瞬間の、まだ回していない元の座標」を毎回渡すこと）
 * から回転をやり直す。前回の呼び出しの戻り値（既に整数へ丸め済み）を次の入力に
 * 使わない設計を呼び出し元（`DrawingCanvas.tsx`の`rotateBaseRef`）が徹底することで、
 * 「丸め→また丸め」を繰り返して形が少しずつ崩れることを防ぐ。この関数自体は
 * 「一度だけ回す」計算にのみ責任を持つ（角度の累積・基準点の保持はこの関数の外、
 * 呼び出し元の責務）。
 *
 * [キャンバスの外に出る扱い] 回転の結果は小数になり、外接矩形も0〜1000の外へ
 * はみ出しうる。`translateLinePoints(rotated, 0, 0)`をそのまま呼ぶことで、
 * 「形はつぶさず、外接矩形が0〜1000へ収まる範囲だけ形全体をずらしてから、
 * 各座標を整数へ丸める」という315章と全く同じクランプ・丸めロジックを再利用する
 * （dx=dy=0を渡しても、`translateLinePoints`内部の`cdx`/`cdy`計算が「はみ出た分だけ
 * 押し戻す」量を自動的に算出するため、これだけで315章の「形ごと端で止まる」
 * 挙動がそのまま手に入る）。
 */
export function rotateLinePoints(points: readonly number[], angleDeg: number): number[] {
  if (points.length < 4) return [...points];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotated: number[] = new Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - cx;
    const dy = points[i + 1] - cy;
    rotated[i] = cx + dx * cos - dy * sin;
    rotated[i + 1] = cy + dx * sin + dy * cos;
  }
  return translateLinePoints(rotated, 0, 0);
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
 *
 * [2026-09-27追記・316章] `rotateLinePoints`が`dx=dy=0`でこの関数を呼び、
 * 回転結果を0〜1000へ収める用途にも使っている（上記コメント参照）。
 */
/**
 * [2026-09-29追加・実装メモ.md 326章、本部長依頼・軽微変更ルート「これをけす」]
 * 指定した位置(`index`)の線を1本取り除いた新しい配列を返す。`index`が範囲外
 * （選択が外れた後に呼ばれる等、想定外の状況への保険）のときは何もせず、元の
 * 内容のコピーをそのまま返す。`lines`配列の他の要素の並び順（重なり順）は
 * 変えない。
 *
 * [「元の位置（重なり順も同じ）に戻る」はこの関数の責務ではない] この関数は
 * 「1本を取り除く」ことにだけ責任を持つ副作用の無い純粋関数。削除前の状態へ
 * 一括で戻す（依頼文「消したあとに『ひとつ戻す』を押すと、元の位置に戻る」）
 * 役目は、315章の`preMoveLinesRef`（「1回だけ使える巻き戻し」パターン、
 * `DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`）が既に担っている。削除の直前に
 * 削除前の`lines`をまるごと1回だけ保持しておけば、「ひとつ もどす」の既存ロジックが
 * そのまま復元してくれる（`findLineIndexAtPoint`等と同じく、UIに依存しない
 * 判定・変形だけをこのファイルへ切り出す方針を踏襲した）。
 *
 * ジェネリックにしているのは、このファイルがドメイン型（`FamilyDrawingLine`）に
 * 依存しない既存の方針（ファイル冒頭コメント「UIにもDrawingCanvas.tsxにも
 * 依存しない形に切り出し」）を保つため。
 */
export function removeLineAtIndex<T>(lines: readonly T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return [...lines];
  const out = lines.slice();
  out.splice(index, 1);
  return out;
}

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

/** 回す基準（`DrawingCanvas.tsx`の`rotateBaseRef`と同じ形）。 */
export interface RotateBase {
  index: number;
  basePoints: number[];
  angle: number;
}

/**
 * [2026-09-30追加・実装メモ.md 340章、本部長依頼・軽微変更ルート・統括承認済み]
 * ✋で線をつかんで指を離した瞬間に、「どの線を選んだ状態にするか」と「回す基準を
 * どう持つか」を決める。316章までは、動かさずに離した（タップ）ときだけ線を選び、
 * ドラッグで動かしたときは選択しなかった。340章から、動かした線も選んだままにする
 * （動かした直後にそのまま↻や🗑を押せるようにするため）。
 *
 * - 動かした（`moved`）: 選ぶ線は`grabIndex`。回す基準は、動かした後の座標
 *   （`finalPoints`）・角度0で必ず張り直す（動かす前の位置に引き戻って回り始めない
 *   ため。316章の考え方と同じ）。
 * - 動かさずに離した（タップ）: 選ぶ線は`grabIndex`。すでに同じ線の基準を持って
 *   いれば（`currentBase.index === grabIndex`）、積み上げた回転角度を0へ戻さないよう
 *   そのまま保つ。そうでなければ、今の線の座標（`currentLinePoints`、無ければ
 *   つかんだ時点の`origPoints`）・角度0で新しく立てる。
 *
 * どちらの場合も、選ぶ線の番号は`grabIndex`になる（別の線をつかんだ場合は、Grantの
 * 時点で前の選択と基準が外れているので、`currentBase`は`null`か同じ線のものだけが
 * 渡される）。
 */
export function selectionAfterRelease(input: {
  grabIndex: number;
  moved: boolean;
  finalPoints: readonly number[];
  origPoints: readonly number[];
  currentLinePoints: readonly number[] | undefined;
  currentBase: RotateBase | null;
}): { selectedIndex: number; base: RotateBase } {
  const { grabIndex, moved, finalPoints, origPoints, currentLinePoints, currentBase } = input;
  if (moved) {
    return {
      selectedIndex: grabIndex,
      base: { index: grabIndex, basePoints: [...finalPoints], angle: 0 },
    };
  }
  if (currentBase !== null && currentBase.index === grabIndex) {
    return { selectedIndex: grabIndex, base: currentBase };
  }
  return {
    selectedIndex: grabIndex,
    base: { index: grabIndex, basePoints: [...(currentLinePoints ?? origPoints)], angle: 0 },
  };
}
