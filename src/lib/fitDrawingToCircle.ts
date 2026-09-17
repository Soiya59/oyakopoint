/**
 * お絵かき画面の「まんなかに おおきく」ボタン（主要画面ワイヤーフレーム.md 48章、
 * 開発部/成果物/実装メモ.md 236章）で使う、線データ全体を丸の中央いっぱいに拡大する
 * 純粋関数。UIにもDrawingCanvas.tsx（react-native-svgに依存）にも依存しない形に
 * 切り出し、`node`で直接実行できるようにする（src/lib/drawingZoomPan.ts と同じ方針）。
 *
 * 48.1節 決定1〜6の手順をそのまま実装する。
 * - 決定1: 全ての線の全ての座標点（`p`配列、端点だけでなく途中の点も含む）から
 *   バウンディングボックス（外接矩形）を求め、全ての線を1つのまとまりとして
 *   同じ拡大率・同じ中心で変換する（線ごとに別々の基準は使わない）。
 * - 決定2: 拡大の目標は「対角線の長さが丸の直径（正規化座標で1000）とちょうど
 *   同じになるまで」。縮小は行わない。
 * - 決定3: 対角線がすでに`FIT_TO_CIRCLE_DIAGONAL_THRESHOLD`（998、丸め誤差の余裕込み）
 *   以上のときは、拡大も中央寄せの移動も一切行わない（何もしない。寄せるだけでも
 *   絵の一部が丸からはみ出す＝切れるおそれがあるため）。
 * - 決定4: 変換後の座標は理論上0〜1000へ収まるが、最終防衛として
 *   `DrawingCanvas.tsx`の`toNormalized`と同じ`Math.max(0, Math.min(1000, Math.round(...)))`
 *   でクランプする。
 * - 決定5: 対角線がほぼ0（点に近い）ときに拡大率が発散しないよう、上限を20倍とする。
 * - 決定14: 線の太さ（`w`）・色（`c`）は一切変更しない。座標のみを変換する。
 *
 * バイト数の事前確認（決定6）は呼び出し側（`DrawingBoard.tsx`）の責務とする
 * （`estimateLineDataBytes`は既存関数、`src/lib/drawingLineDataBytes.ts`）。
 */
import type { FamilyDrawingLine } from "@/types/domain";

/** 決定3: 対角線がこの値以上ならすでに十分大きいとみなし、何もしない。 */
export const FIT_TO_CIRCLE_DIAGONAL_THRESHOLD = 998;
/** 決定2: 拡大の目標（丸の直径、正規化座標で1000）。 */
const TARGET_DIAGONAL = 1000;
/** 決定5: 拡大率の上限。 */
const MAX_SCALE = 20;
/** 丸の中心（正規化座標）。 */
const CIRCLE_CENTER = 500;

export interface FitDrawingToCircleResult {
  /**
   * 変換後の線データ。`changed`がfalseのときは、引数と同じ内容（配列そのものは
   * 引数と同じ参照を返す。呼び出し側が「変わっていない」ことを参照比較でも
   * 判定できるようにするため、あえて複製しない）。
   */
  lines: FamilyDrawingLine[];
  /** 実際に座標を変更したか（決定3で「何もしない」に該当した場合はfalse）。 */
  changed: boolean;
}

/** 全ての線の全ての座標点から外接矩形を求める。線が1本も無い・点が1つも無い場合はnull。 */
function computeBoundingBox(
  lines: FamilyDrawingLine[]
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.p.length; i += 2) {
      found = true;
      const x = line.p[i];
      const y = line.p[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return found ? { minX, maxX, minY, maxY } : null;
}

/** 決定4: DrawingCanvas.tsxのtoNormalizedと同じ最終防衛クランプ。 */
function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}

/**
 * 線データ全体を、丸の中央いっぱいに拡大する（48.1節決定1〜5、決定14）。
 * 線が1本も無い、または既に十分大きい（決定3）ときは`changed: false`を返し、
 * 座標は一切変更しない。
 */
export function fitDrawingLinesToCircle(lines: FamilyDrawingLine[]): FitDrawingToCircleResult {
  const bbox = computeBoundingBox(lines);
  if (!bbox) {
    return { lines, changed: false };
  }
  const { minX, maxX, minY, maxY } = bbox;
  const width = maxX - minX;
  const height = maxY - minY;
  const diagonal = Math.sqrt(width * width + height * height);

  // 決定3: すでに十分大きい（対角線が概ね998以上）なら何もしない。中央寄せも行わない。
  if (diagonal >= FIT_TO_CIRCLE_DIAGONAL_THRESHOLD) {
    return { lines, changed: false };
  }

  // 決定2・5: 対角線がちょうど1000になるまで拡大する（上限20倍）。
  // 対角線がほぼ0（点に近い落書き）の場合はInfinityになりうるため上限で止める。
  const rawScale = diagonal === 0 ? MAX_SCALE : TARGET_DIAGONAL / diagonal;
  const scale = Math.min(MAX_SCALE, rawScale);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const transformed: FamilyDrawingLine[] = lines.map((line) => {
    const p: number[] = new Array(line.p.length);
    for (let i = 0; i + 1 < line.p.length; i += 2) {
      const x = line.p[i];
      const y = line.p[i + 1];
      p[i] = clampNormalized(CIRCLE_CENTER + (x - centerX) * scale);
      p[i + 1] = clampNormalized(CIRCLE_CENTER + (y - centerY) * scale);
    }
    // 決定14: w・cは変えない。
    return { ...line, p };
  });

  return { lines: transformed, changed: true };
}
