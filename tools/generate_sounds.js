#!/usr/bin/env node
/**
 * 効果音（3種類）を合成してWAVファイルとして書き出すスクリプト。
 *
 * やること.md 2-3「効果音（お祝い演出）」対応。外部サイトからのダウンロードは
 * ライセンス確認ができず統括に説明できないため使わず、サイン波を重ねて自前で
 * 合成する（開発部/成果物/実装メモ.md 参照）。依存ライブラリは使わず、
 * Node.js標準機能のみでPCM波形を組み立ててWAVヘッダを付けて書き出す。
 *
 * 生成する3種類（すべて「明るく上がっていく」音、0.4〜0.8秒、44.1kHz・16bit・モノラル）:
 * - complete.wav … 完了報告が通ったとき（C7・C14）。3音の短い上昇アルペジオ。
 * - reward.wav   … ごほうび交換が完了したとき（C11）。4音のやや華やかな上昇アルペジオ。
 * - gacha.wav    … ガチャの結果が出たとき（C22）。周波数が滑らかに駆け上がる
 *                   グリッサンド＋最後に明るい和音の「ジャーン」。
 *
 * 音量はどれもピークを-6dBFS程度に抑えてある（夜に鳴っても驚かない程度、という
 * 統括決定）。実際の生成後、`assets/sounds/`配下のwavをこのスクリプトで
 * 作り直せる（`node tools/generate_sounds.js`）。
 *
 * 音を消す設定（ミュート等）は今回作らない方針のため、このスクリプトにも
 * 音量パラメータ以外の可変オプションは用意していない。
 *
 * 【2026-09-16追記】やること.md 2-3の統括フィードバック（「音は少し地味」
 * 「チャリーン・ピカーン・キラリーンのような明るい系がいい」）を受け、
 * 「候補を作るモード」を追加した。以下のように呼び分ける。
 * - `node tools/generate_sounds.js`
 *   … 従来どおり。`assets/sounds/`配下の本番3ファイルを生成する（この経路・
 *     生成内容は一切変更していない）。
 * - `node tools/generate_sounds.js --candidates <出力ディレクトリ>`
 *   … 本番ファイルには触れず、指定ディレクトリに「チャリーン／キラリーン／
 *     ピカーン」3系統×3場面＝9個の候補WAVと、比較用の現行3音のコピーを
 *     書き出す。詳細は本ファイル下部の「候補音生成」セクションのコメント参照。
 *
 * 【2026-09-16追記その2】統括がPCで系統A（チャリーン）を選んだが、スマホの
 * スピーカーで聴くと高域が「刺さる」というフィードバックを受けた（PCとスマホ
 * でスピーカー特性が違い、スマホは低域が出ず高域が強調されるため）。方向性
 * （チャリーンという金属的な明るさ）は維持したまま刺さりだけを抑えた
 * 「やわらかめ」の2段階（A2・A3）を追加した。
 * - `node tools/generate_sounds.js --soften-candidates <出力ディレクトリ>`
 *   … 本番ファイルには触れず、指定ディレクトリにA2・A3（各3場面＝6個）の
 *     候補WAVと、比較用に系統Aの実測値（ファイルは書き出さず数値のみ）を
 *     一覧表示する。詳細は本ファイル下部の「やわらかめ候補生成（A2/A3）」
 *     セクションのコメント参照。
 *
 * 【2026-09-16追記その3】統括がスマホでA2・A3を聴き比べ「A2で！」と決定
 * （実装メモ.md 220.9章）。これを受け、**本番の既定動作をA2に切り替えた**。
 * - `node tools/generate_sounds.js`
 *   … 【変更】これまでの「サイン波3音アルペジオ・0.45〜0.6秒・-6dBFS」から、
 *     **A2（チャリーン・非整数次倍音・基音×0.75・5.4倍音-8dB・
 *     ローパス6000Hz・アタック6ms・0.75〜0.95秒・-3dBFS）**を
 *     `assets/sounds/`配下の本番3ファイルとして生成する既定に変わった。
 *     「スクリプトを叩けば本番の3音を再現できる」という約束は変えていない
 *     （既定の中身が変わっただけ）。
 * - `node tools/generate_sounds.js --legacy`
 *   … 差し替え前の旧サイン波版（本番採用前の初代。実装メモ220.2章）を
 *     `assets/sounds/`配下に生成したいときに使う（比較・切り戻し用に残す）。
 * - `--candidates` / `--soften-candidates` は変更していない（本番ファイルには
 *   一切触れない候補生成専用の経路のまま）。
 */
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const TARGET_PEAK_DB = -6; // 統括決定: 音量は控えめに（ピーク-6dB程度）
const TARGET_PEAK = Math.pow(10, TARGET_PEAK_DB / 20);

/**
 * 1つの「音符」をFloat64のサンプル配列に加算する。
 * アタック（立ち上がり）を短く、ディケイ（減衰）を指数的にかけることで
 * 「ポーン」という明るい鐘のような質感にする。基音に加えて弱いオクターブ上の
 * 倍音を足し、キラッとした明るさを出す（子ども向けの演出のため）。
 */
function addNote(buffer, startSample, durationSamples, freqHz, peakAmp) {
  const attackSamples = Math.floor(SAMPLE_RATE * 0.005); // 5ms
  for (let i = 0; i < durationSamples; i++) {
    const idx = startSample + i;
    if (idx < 0 || idx >= buffer.length) continue;
    const t = i / SAMPLE_RATE;
    // アタック: 線形で立ち上がる。それ以降は指数減衰。
    const envelope =
      i < attackSamples
        ? i / attackSamples
        : Math.exp(-4.5 * ((i - attackSamples) / durationSamples));
    const fundamental = Math.sin(2 * Math.PI * freqHz * t);
    const overtone = 0.25 * Math.sin(2 * Math.PI * freqHz * 2 * t); // オクターブ上、弱め
    buffer[idx] += peakAmp * envelope * (fundamental + overtone);
  }
}

/** 開始〜終了で周波数が滑らかに変化するグリッサンド（駆け上がり）を加算する。 */
function addGlissando(buffer, startSample, durationSamples, freqStartHz, freqEndHz, peakAmp) {
  const attackSamples = Math.floor(SAMPLE_RATE * 0.01);
  let phase = 0;
  let prevFreq = freqStartHz;
  for (let i = 0; i < durationSamples; i++) {
    const idx = startSample + i;
    const progress = i / durationSamples;
    const freq = freqStartHz + (freqEndHz - freqStartHz) * progress;
    // 位相を周波数の積分として進める（サンプルごとに周波数が変わるための処理）。
    phase += (2 * Math.PI * ((freq + prevFreq) / 2)) / SAMPLE_RATE;
    prevFreq = freq;
    if (idx < 0 || idx >= buffer.length) continue;
    const envelope =
      i < attackSamples ? i / attackSamples : 1 - 0.3 * progress; // わずかに減衰しつつ駆け上がる
    buffer[idx] += peakAmp * envelope * Math.sin(phase);
  }
}

function secToSamples(sec) {
  return Math.round(sec * SAMPLE_RATE);
}

/** ピークを揃え、末尾に短いフェードアウトをかけてからInt16 PCMバッファへ変換する。 */
function finalize(buffer) {
  let peak = 0;
  for (const v of buffer) {
    peak = Math.max(peak, Math.abs(v));
  }
  const scale = peak > 0 ? TARGET_PEAK / peak : 0;

  // 末尾10msをフェードアウトしてプツッというクリック音を防ぐ。
  const fadeSamples = Math.floor(SAMPLE_RATE * 0.01);
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let sample = buffer[i] * scale;
    const distFromEnd = buffer.length - i;
    if (distFromEnd <= fadeSamples) {
      sample *= distFromEnd / fadeSamples;
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

/** Int16 PCMサンプル列にWAV(RIFF)ヘッダを付けてBufferを組み立てる。 */
function encodeWav(samples) {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmtチャンクサイズ
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // モノラル
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE((SAMPLE_RATE * BITS_PER_SAMPLE) / 8, 28); // byteRate
  header.writeUInt16LE(BITS_PER_SAMPLE / 8, 32); // blockAlign
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  const dataBuffer = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i++) {
    dataBuffer.writeInt16LE(samples[i], i * 2);
  }
  return Buffer.concat([header, dataBuffer]);
}

// ドの音階（C5=523.25Hz）を基準にしたアルペジオ用周波数。
const NOTE = {
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  C6: 1046.5,
  E6: 1318.51,
};

function buildComplete() {
  // 完了報告の音: C5→E5→G5 の3音、0.45秒。短く軽快に。
  const totalSec = 0.45;
  const buffer = new Float64Array(secToSamples(totalSec));
  const noteDur = secToSamples(0.16);
  addNote(buffer, secToSamples(0.0), noteDur, NOTE.C5, 1.0);
  addNote(buffer, secToSamples(0.13), noteDur, NOTE.E5, 1.0);
  addNote(buffer, secToSamples(0.26), secToSamples(0.19), NOTE.G5, 1.0);
  return finalize(buffer);
}

function buildReward() {
  // ごほうび交換の音: C5→E5→G5→C6 の4音、0.6秒。完了報告より少し華やか・長め。
  const totalSec = 0.6;
  const buffer = new Float64Array(secToSamples(totalSec));
  const step = 0.13;
  addNote(buffer, secToSamples(0 * step), secToSamples(0.2), NOTE.C5, 0.9);
  addNote(buffer, secToSamples(1 * step), secToSamples(0.2), NOTE.E5, 0.9);
  addNote(buffer, secToSamples(2 * step), secToSamples(0.2), NOTE.G5, 0.9);
  addNote(buffer, secToSamples(3 * step), secToSamples(0.25), NOTE.C6, 1.0);
  return finalize(buffer);
}

function buildGacha() {
  // ガチャ結果の音: 0.35秒のグリッサンド（駆け上がり）＋最後に明るい和音の「ジャーン」、
  // 合計0.55秒。結果が出た瞬間のワクワク感を出す。
  const totalSec = 0.55;
  const buffer = new Float64Array(secToSamples(totalSec));
  addGlissando(buffer, secToSamples(0.0), secToSamples(0.32), 320, 900, 0.8);
  const chordStart = secToSamples(0.28);
  const chordDur = secToSamples(0.27);
  addNote(buffer, chordStart, chordDur, NOTE.G5, 0.7);
  addNote(buffer, chordStart, chordDur, NOTE.C6, 0.7);
  addNote(buffer, chordStart, chordDur, NOTE.E6, 0.55);
  return finalize(buffer);
}

function main() {
  const args = process.argv.slice(2);
  const candidateFlagIndex = args.indexOf("--candidates");
  if (candidateFlagIndex !== -1) {
    const outDir = args[candidateFlagIndex + 1];
    if (!outDir) {
      console.error(
        "使い方: node tools/generate_sounds.js --candidates <出力ディレクトリ>"
      );
      process.exit(1);
    }
    generateCandidates(outDir);
    return;
  }

  const softenFlagIndex = args.indexOf("--soften-candidates");
  if (softenFlagIndex !== -1) {
    const outDir = args[softenFlagIndex + 1];
    if (!outDir) {
      console.error(
        "使い方: node tools/generate_sounds.js --soften-candidates <出力ディレクトリ>"
      );
      process.exit(1);
    }
    generateSoftenCandidates(outDir);
    return;
  }

  // 【2026-09-16変更】既定（引数なし）はA2を生成する。`--legacy`を付けたときだけ
  // 差し替え前の旧サイン波版を生成する（本ファイル冒頭コメント「追記その3」参照）。
  // 【2026-09-25変更・統括決定】既定は「やさしい版」（本ファイル末尾のセクション）。
  // A2は `--a2`、旧サイン波版は `--legacy` で生成する。
  const legacy = args.includes("--legacy");
  const a2 = args.includes("--a2");
  const outDir = path.join(__dirname, "..", "assets", "sounds");
  fs.mkdirSync(outDir, { recursive: true });

  const files = legacy
    ? {
        "complete.wav": buildComplete(),
        "reward.wav": buildReward(),
        "gacha.wav": buildGacha(),
      }
    : a2
      ? {
          "complete.wav": buildVariantComplete(A2_CONFIG),
          "reward.wav": buildVariantReward(A2_CONFIG),
          "gacha.wav": buildVariantGacha(A2_CONFIG),
        }
      : {
          "complete.wav": buildGentleComplete(),
          "reward.wav": buildGentleReward(),
          "gacha.wav": buildGentleGacha(),
        };

  console.log(
    legacy
      ? "旧サイン波版（--legacy指定・ピーク-6dBFS・0.45〜0.6秒）を生成します。"
      : a2
        ? "A2（--a2指定・チャリーン・やわらかめ・ピーク-3dBFS・0.75〜0.95秒）を生成します。"
        : "やさしい版（ピーク-8dBFS・0.6〜1.05秒）を生成します。" +
            "A2は --a2、旧サイン波版は --legacy を付けてください。"
  );

  for (const [name, samples] of Object.entries(files)) {
    const wav = encodeWav(samples);
    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, wav);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(3);
    // 実測値も併記する（220.9章の検証で使う: 長さ・ピーク・クリップ0件・重心Hz）。
    const peakDb = measureWavPeakDb(wav).toFixed(2);
    const clipped = countClippedSamples(samples);
    const centroidHz = Math.round(measureSpectralCentroid(wav));
    console.log(
      `wrote ${outPath} (${seconds}s, ${wav.length} bytes, peak=${peakDb}dBFS, clip=${clipped}, centroid=${centroidHz}Hz)`
    );
  }
}

/* =========================================================================
 * 候補音生成（2026-09-16、やること.md 2-3・実装メモ220章の続き。まだ本番採用
 * 前の「候補」段階。assets/sounds/ には一切書き込まない）
 *
 * 統括の実機での感想「音は少し地味」「チャリーン・ピカーン・キラリーンの
 * ような明るい系がいい」を受け、3系統×3場面＝9候補を作る。
 *
 * 前回（220章）の反省点への対応:
 * 1. サイン波だけで作っていた→倍音を重ねる（addPartialNote関数で複数の
 *    部分音・倍音を同時に鳴らせるようにした）
 * 2. 短すぎた（0.45〜0.6秒）→0.7〜1.0秒まで許容（1.0秒は超えない）
 * 3. ピーク-6dBFSは控えめすぎた可能性→候補は-3dBFSまで上げる
 *    （CANDIDATE_TARGET_PEAK_DB。歪ませないよう、必ず実測ピークを検算する）
 * 4. 音の高さが低めだった可能性→ただし8kHz以上に主成分を置かない、という
 *    上限も守る必要があるため、各系統で使う基音・倍音の最大到達周波数を
 *    このコメント内、および各build関数の実装コメントで確認できるようにした
 * ========================================================================= */

const CANDIDATE_TARGET_PEAK_DB = -3; // 統括指示: 候補は-3dBFSまで上げる
const CANDIDATE_TARGET_PEAK = Math.pow(10, CANDIDATE_TARGET_PEAK_DB / 20);

// 候補音で使う音階（既存NOTEに、より広い音域を追加）。
// 最高音C8(4186.01Hz)でも単音なら8kHz未満。倍音・非整数次倍音を重ねる
// 系統（A・C）は、各build関数側で「基音×倍率が8000Hzを超えないか」を
// 個別にコメントで検算している。
Object.assign(NOTE, {
  A5: 880.0,
  D6: 1174.66,
  G6: 1567.98,
  A6: 1760.0,
  C7: 2093.0,
  E7: 2637.02,
  G7: 3135.96,
  C8: 4186.01,
});

/**
 * 汎用の「複数の部分音（倍音・非整数次倍音）を重ねた音符」を加算する。
 * addNote()と違い、partialsに任意個の{ratio, amp, decayMul, phase}を渡せる。
 * - ratio: 基音に対する周波数の倍率（整数なら楽器的な倍音、非整数なら
 *   ベルのような金属的な質感になる）
 * - decayMul: baseDecayRateに掛ける係数。1より大きい部分音は基音より速く
 *   減衰する（実際のベル・コインの音は高い部分音ほど早く消える）
 * - vibratoHz/vibratoDepth: アタック後にわずかな周波数の揺らぎを加える
 *   （シマー・ビブラート。「生気」を出すための微小な時間変化）
 */
function addPartialNote(buffer, startSample, durationSamples, baseFreqHz, peakAmp, partials, opts = {}) {
  const attackSec = opts.attackSec ?? 0.004;
  const baseDecayRate = opts.baseDecayRate ?? 3.2;
  const vibratoHz = opts.vibratoHz ?? 0;
  const vibratoDepth = opts.vibratoDepth ?? 0;
  const vibratoDelaySec = opts.vibratoDelaySec ?? 0.08;
  const attackSamples = Math.max(1, Math.floor(SAMPLE_RATE * attackSec));

  for (let i = 0; i < durationSamples; i++) {
    const idx = startSample + i;
    if (idx < 0 || idx >= buffer.length) continue;
    const t = i / SAMPLE_RATE;
    let vibratoMul = 1;
    if (vibratoHz > 0 && vibratoDepth > 0 && t > vibratoDelaySec) {
      vibratoMul = 1 + vibratoDepth * Math.sin(2 * Math.PI * vibratoHz * (t - vibratoDelaySec));
    }
    let sum = 0;
    for (const partial of partials) {
      const decayRate = baseDecayRate * (partial.decayMul ?? 1);
      const partialEnv =
        i < attackSamples
          ? i / attackSamples
          : Math.exp(-decayRate * ((i - attackSamples) / durationSamples));
      const freq = baseFreqHz * partial.ratio * vibratoMul;
      sum += (partial.amp ?? 1) * partialEnv * Math.sin(2 * Math.PI * freq * t + (partial.phase ?? 0));
    }
    buffer[idx] += peakAmp * sum;
  }
}

/** 候補音用: ピークを-3dBFSに正規化し、始端3ms・終端15msにフェードをかける。 */
function finalizeCandidate(buffer) {
  let peak = 0;
  for (const v of buffer) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? CANDIDATE_TARGET_PEAK / peak : 0;

  const fadeInSamples = Math.floor(SAMPLE_RATE * 0.003);
  const fadeOutSamples = Math.floor(SAMPLE_RATE * 0.015);
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let sample = buffer[i] * scale;
    if (i < fadeInSamples) sample *= i / fadeInSamples;
    const distFromEnd = buffer.length - i;
    if (distFromEnd <= fadeOutSamples) sample *= distFromEnd / fadeOutSamples;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

/** 書き出し済みWAVファイルのバッファから実測ピーク(dBFS)を検算する（歪みゼロの確認用）。 */
function measureWavPeakDb(wavBuffer) {
  const dataSize = wavBuffer.readUInt32LE(40);
  let peak = 0;
  for (let offset = 44; offset < 44 + dataSize; offset += 2) {
    const sample = wavBuffer.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

// ---- 系統A「チャリーン」: 金属的なコイン音（非整数次倍音） ----
// 部分音の比率1.0/2.76/5.4はベルの部分音に近い非整数次比（統括指示の例その
// もの）。高い部分音ほどdecayMulを大きくして早く消えるようにし、金属らしい
// 減衰にした。この系統は基音を最大1318.51Hz(E6)までに抑えている
// （1318.51×5.4≈7120Hz<8000Hzなので上限を守れている）。
const BELL_PARTIALS = [
  { ratio: 1.0, amp: 1.0, decayMul: 1.0 },
  { ratio: 2.76, amp: 0.5, decayMul: 1.7 },
  { ratio: 5.4, amp: 0.28, decayMul: 2.4 },
];

function buildBellHit(buffer, startSample, durationSamples, baseFreq, amp, opts = {}) {
  addPartialNote(buffer, startSample, durationSamples, baseFreq, amp, BELL_PARTIALS, {
    attackSec: 0.002, // 立ち上がりは鋭く
    baseDecayRate: opts.baseDecayRate ?? 2.6, // 減衰は長め（0.7〜0.9秒残るように）
  });
}

function candidateA_complete() {
  // コインが2枚、少しずらして落ちたような「チャリーン」。合計0.75秒。
  const totalSec = 0.75;
  const buffer = new Float64Array(secToSamples(totalSec));
  buildBellHit(buffer, secToSamples(0.0), secToSamples(0.35), NOTE.C6, 0.9);
  buildBellHit(buffer, secToSamples(0.09), buffer.length - secToSamples(0.09), NOTE.E6, 1.0);
  return finalizeCandidate(buffer);
}

function candidateA_reward() {
  // コインが3枚連続で積み重なる、少し華やかな「チャリチャリーン」。合計0.85秒。
  const totalSec = 0.85;
  const buffer = new Float64Array(secToSamples(totalSec));
  buildBellHit(buffer, secToSamples(0.0), secToSamples(0.3), NOTE.C6, 0.8);
  buildBellHit(buffer, secToSamples(0.1), secToSamples(0.4), NOTE.D6, 0.9);
  buildBellHit(buffer, secToSamples(0.2), buffer.length - secToSamples(0.2), NOTE.E6, 1.0);
  return finalizeCandidate(buffer);
}

function candidateA_gacha() {
  // コインがザラザラ落ちて（短い4連打）、最後に2枚同時の大きな「チャリーン」。
  // 合計0.95秒（1.0秒は超えない）。
  const totalSec = 0.95;
  const buffer = new Float64Array(secToSamples(totalSec));
  const smallNotes = [NOTE.A5, NOTE.C6, NOTE.D6, NOTE.E6];
  const step = 0.06;
  smallNotes.forEach((freq, i) => {
    buildBellHit(buffer, secToSamples(i * step), secToSamples(0.16), freq, 0.5 + i * 0.05);
  });
  const finalStart = secToSamples(smallNotes.length * step + 0.03);
  const finalDur = buffer.length - finalStart;
  buildBellHit(buffer, finalStart, finalDur, NOTE.E6, 1.0);
  buildBellHit(buffer, finalStart, finalDur, NOTE.C6, 0.55); // 同時に重ねて厚みを出す
  return finalizeCandidate(buffer);
}

// ---- 系統B「キラリーン」: 星がきらめくように駆け上がる音 ----
// 短い音を40〜50msおきに、長3度・完全5度・オクターブの明るい音程で並べ、
// 最後の音だけ長く残してシマー（微小な揺らぎ）を足す。最高音C8(4186.01Hz)
// でも単音なので8000Hz未満（デチューン分1.006倍しても4211Hzで安全）。
function buildTwinkleNote(buffer, start, dur, freq, amp, opts = {}) {
  const partials = opts.shimmer
    ? [
        { ratio: 1.0, amp: 1.0 },
        { ratio: 1.006, amp: 0.35 }, // わずかにデチューンした音を重ねてシマーを出す
        { ratio: 0.994, amp: 0.25 },
      ]
    : [{ ratio: 1.0, amp: 1.0 }];
  addPartialNote(buffer, start, dur, freq, amp, partials, {
    attackSec: opts.attackSec ?? 0.006,
    baseDecayRate: opts.baseDecayRate ?? 6.0,
    vibratoHz: opts.vibratoHz ?? 0,
    vibratoDepth: opts.vibratoDepth ?? 0,
    vibratoDelaySec: opts.vibratoDelaySec ?? 0.05,
  });
}

function buildTwinkleRun(notes, step, lastDur, lastAmp, vibratoDepth) {
  const totalSec = (notes.length - 1) * step + lastDur;
  const buffer = new Float64Array(secToSamples(totalSec));
  notes.forEach((freq, i) => {
    const start = secToSamples(i * step);
    if (i < notes.length - 1) {
      buildTwinkleNote(buffer, start, secToSamples(0.12), freq, 0.75, { baseDecayRate: 7.5 });
    } else {
      buildTwinkleNote(buffer, start, buffer.length - start, freq, lastAmp, {
        baseDecayRate: 2.0,
        shimmer: true,
        vibratoHz: 6,
        vibratoDepth,
      });
    }
  });
  return finalizeCandidate(buffer);
}

function candidateB_complete() {
  // 5音・45msおきに上昇、合計0.75秒。
  return buildTwinkleRun([NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7, NOTE.E7], 0.05, 0.55, 1.0, 0.02);
}

function candidateB_reward() {
  // 完了報告より1音多い6音・45msおきに上昇、合計0.85秒。
  return buildTwinkleRun(
    [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7, NOTE.E7, NOTE.G7],
    0.045,
    0.625,
    1.0,
    0.022
  );
}

function candidateB_gacha() {
  // 最も速く（40msおき）・最も高くまで（C8）駆け上がる7音、合計0.94秒。
  return buildTwinkleRun(
    [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7, NOTE.E7, NOTE.G7, NOTE.C8],
    0.04,
    0.7,
    1.0,
    0.028
  );
}

// ---- 系統C「ピカーン」: ひらめき・達成の「決まった」感 ----
// 短い前打音（ピ）＋長い高音（カーン）。カーンは倍音1〜4次（+ガチャ場面は5次）
// を重ね、微小なビブラートで生気を出す。基音は最大1567.98Hz(G6)で、4次
// 倍音でも6271.9Hz、5次でも7839.9Hzといずれも8000Hz未満。
function buildPing(buffer, start, dur, freq, amp) {
  addPartialNote(
    buffer,
    start,
    dur,
    freq,
    amp,
    [
      { ratio: 1, amp: 1.0 },
      { ratio: 2, amp: 0.3 },
    ],
    { attackSec: 0.002, baseDecayRate: 9.0 }
  );
}

function buildKaan(buffer, start, dur, freq, amp, opts = {}) {
  const partials = [
    { ratio: 1, amp: 1.0, decayMul: 1.0 },
    { ratio: 2, amp: 0.5, decayMul: 1.3 },
    { ratio: 3, amp: 0.3, decayMul: 1.6 },
    { ratio: 4, amp: 0.15, decayMul: 2.0 },
  ];
  if (opts.rich) partials.push({ ratio: 5, amp: 0.08, decayMul: 2.3 });
  addPartialNote(buffer, start, dur, freq, amp, partials, {
    attackSec: 0.006,
    baseDecayRate: opts.baseDecayRate ?? 2.3,
    vibratoHz: opts.vibratoHz ?? 5.5,
    vibratoDepth: opts.vibratoDepth ?? 0.015,
    vibratoDelaySec: 0.1,
  });
}

function candidateC_complete() {
  // 「ピ・カーン」。合計0.75秒。
  const totalSec = 0.75;
  const buffer = new Float64Array(secToSamples(totalSec));
  buildPing(buffer, secToSamples(0.0), secToSamples(0.05), NOTE.G6, 0.7);
  const kaanStart = secToSamples(0.07);
  buildKaan(buffer, kaanStart, buffer.length - kaanStart, NOTE.C6, 1.0);
  return finalizeCandidate(buffer);
}

function candidateC_reward() {
  // 「ピピ・カーン」。前打音が2つに増え、カーンの倍音も5次まで（rich）。合計0.85秒。
  const totalSec = 0.85;
  const buffer = new Float64Array(secToSamples(totalSec));
  buildPing(buffer, secToSamples(0.0), secToSamples(0.045), NOTE.G6, 0.6);
  buildPing(buffer, secToSamples(0.07), secToSamples(0.05), NOTE.A6, 0.75);
  const kaanStart = secToSamples(0.14);
  buildKaan(buffer, kaanStart, buffer.length - kaanStart, NOTE.C6, 1.0, {
    rich: true,
    vibratoDepth: 0.02,
  });
  return finalizeCandidate(buffer);
}

function candidateC_gacha() {
  // 「ピピピ・カラーン」。前打音3連続で上昇＋最後は完全5度上を薄く重ねて
  // 「決まった」和音感を出す。合計0.95秒（1.0秒は超えない）。
  const totalSec = 0.95;
  const buffer = new Float64Array(secToSamples(totalSec));
  const blips = [NOTE.G6, NOTE.A6, NOTE.C7];
  const step = 0.045;
  blips.forEach((freq, i) => {
    buildPing(buffer, secToSamples(i * step), secToSamples(0.04), freq, 0.55 + i * 0.08);
  });
  const kaanStart = secToSamples(blips.length * step + 0.02);
  const kaanDur = buffer.length - kaanStart;
  buildKaan(buffer, kaanStart, kaanDur, NOTE.C6, 1.0, {
    rich: true,
    vibratoDepth: 0.025,
    baseDecayRate: 2.0,
  });
  buildKaan(buffer, kaanStart, kaanDur, NOTE.G6, 0.4, { baseDecayRate: 2.6, vibratoDepth: 0 });
  return finalizeCandidate(buffer);
}

function noteName(freq) {
  const entry = Object.entries(NOTE).find(([, v]) => Math.abs(v - freq) < 0.01);
  return entry ? `${entry[0]}(${freq.toFixed(1)}Hz)` : `${freq.toFixed(1)}Hz`;
}

/**
 * 候補9ファイル＋比較用の現行3音コピーを指定ディレクトリに書き出し、
 * 一覧表を標準出力に表示する（`assets/sounds/`には一切書き込まない）。
 */
function generateCandidates(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const prodDir = path.join(__dirname, "..", "assets", "sounds");
  const rows = [];

  function writeCandidate(fileName, samples, freqDesc, aim) {
    const wav = encodeWav(samples);
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, wav);
    const written = fs.readFileSync(outPath);
    const peakDb = measureWavPeakDb(written);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(3);
    rows.push({ fileName, seconds, peakDb: peakDb.toFixed(2), freqDesc, aim });
  }

  writeCandidate(
    "A_チャリーン_完了報告.wav",
    candidateA_complete(),
    `${noteName(NOTE.C6)}→${noteName(NOTE.E6)}、各音に非整数次倍音1.0/2.76/5.4倍を重畳`,
    "コインが2枚、少しずらして落ちたような短く明るいチャリーン"
  );
  writeCandidate(
    "A_チャリーン_ごほうび交換.wav",
    candidateA_reward(),
    `${noteName(NOTE.C6)}→${noteName(NOTE.D6)}→${noteName(NOTE.E6)}、同上の倍音構成`,
    "コインが3枚連続で積み重なる、少し華やかなチャリーン"
  );
  writeCandidate(
    "A_チャリーン_ガチャ.wav",
    candidateA_gacha(),
    `${noteName(NOTE.A5)}〜${noteName(NOTE.E6)}の4連打→最後に${noteName(NOTE.E6)}+${noteName(
      NOTE.C6
    )}の二重チャリーン`,
    "コインがザラザラ落ちて最後に大きく鳴る、ガチャらしい高揚感"
  );
  writeCandidate(
    "B_キラリーン_完了報告.wav",
    candidateB_complete(),
    "C6→E6→G6→C7→E7（5音上昇・45msおき）、最後の音にシマー",
    "星がキラッと瞬くような短い駆け上がり"
  );
  writeCandidate(
    "B_キラリーン_ごほうび交換.wav",
    candidateB_reward(),
    "C6→E6→G6→C7→E7→G7（6音上昇・45msおき）、最後の音にシマー",
    "完了報告より1音多く、少し長く輝くキラリーン"
  );
  writeCandidate(
    "B_キラリーン_ガチャ.wav",
    candidateB_gacha(),
    `C6→E6→G6→C7→E7→G7→${noteName(NOTE.C8)}（7音上昇・40msおき）、最も強いシマー`,
    "駆け上がりが最も速く高い、ガチャの期待感を煽るキラリーン"
  );
  writeCandidate(
    "C_ピカーン_完了報告.wav",
    candidateC_complete(),
    `ピ=${noteName(NOTE.G6)}→カーン=${noteName(NOTE.C6)}（倍音1〜4次、微ビブラート）`,
    "ひらめき・達成の「ピカーン」を短く"
  );
  writeCandidate(
    "C_ピカーン_ごほうび交換.wav",
    candidateC_reward(),
    `ピピ=${noteName(NOTE.G6)}/${noteName(NOTE.A6)}→カーン=${noteName(
      NOTE.C6
    )}（倍音1〜5次、ビブラートやや強め）`,
    "前打音が2つに増え、少し華やかな「ピピカーン」"
  );
  writeCandidate(
    "C_ピカーン_ガチャ.wav",
    candidateC_gacha(),
    `ピピピ=${noteName(NOTE.G6)}/${noteName(NOTE.A6)}/${noteName(
      NOTE.C7
    )}（上昇）→カラーン=${noteName(NOTE.C6)}+${noteName(NOTE.G6)}の和音（倍音1〜5次、ビブラート最強）`,
    "前打音が3連続で期待を煽り、最後に和音で「決まった」感を出す"
  );

  // 比較用に現行の本番3音をそのままコピーする（assets/sounds/は変更しない。読むだけ）。
  const prodMap = [
    ["complete.wav", "現行_完了報告.wav"],
    ["reward.wav", "現行_ごほうび交換.wav"],
    ["gacha.wav", "現行_ガチャ.wav"],
  ];
  for (const [src, dst] of prodMap) {
    const srcPath = path.join(prodDir, src);
    const wav = fs.readFileSync(srcPath);
    fs.writeFileSync(path.join(outDir, dst), wav);
    const dataSize = wav.readUInt32LE(40);
    const seconds = (dataSize / 2 / SAMPLE_RATE).toFixed(3);
    const peakDb = measureWavPeakDb(wav);
    rows.push({
      fileName: dst,
      seconds,
      peakDb: peakDb.toFixed(2),
      freqDesc: "現行のtools/generate_sounds.js（本セクション追加前の関数）の生成内容そのまま",
      aim: "比較用（現行の本番音をそのままコピー）",
    });
  }

  console.log("\n=== 候補音の一覧 ===");
  console.log("ファイル名 / 長さ(秒) / ピーク(dBFS) / 主な周波数成分 / 狙い");
  for (const row of rows) {
    console.log(`- ${row.fileName} / ${row.seconds}s / ${row.peakDb}dB / ${row.freqDesc} / ${row.aim}`);
  }
  console.log(`\n出力先: ${outDir}`);
}

/* =========================================================================
 * やわらかめ候補生成（A2/A3）（2026-09-16、実装メモ220章の続き。まだ本番
 * 採用前の「候補」段階。assets/sounds/・src/lib/sound.ts には一切触れない）
 *
 * 統括の実機フィードバック「PCでは系統A（チャリーン）が良かったが、スマホの
 * スピーカーで聴くと高域が刺さった」を受けて追加した。方向性（金属的で明るい
 * ・コインが落ちる感じ・0.75〜0.95秒の余韻）は維持し、刺さりの原因になり
 * うる要素だけを2段階（A2よりA3のほうが強く）で落とす。
 *
 * 「刺さり」を抑えるために変えた5つの要素（Aとの差分）:
 * 1. 基音を下げる … A(C6〜E6, 1046.5〜1318.51Hz) → A2はA×0.75（完全4度下、
 *    784.9〜988.9Hz≒G5〜B5） → A3はA×0.625（短6度〜長6度下、654.1〜
 *    824.1Hz≒E5〜G5あたり）。倍率はAの周波数に対して直接かけている
 *    （A3はA2からの追加シフトではなく、Aからの下げ幅を大きくする形）。
 * 2. 非整数次倍音の上側（5.4倍音）を弱める … A2は-8dB（指示の-6〜-9dBの
 *    範囲内）、A3は0（完全に外し、2.76倍音までにする＝指示の代替案を採用）。
 * 3. 高域をなだらかに落とす … 1次RCローパス（`applyOnePoleLowpass`）を
 *    A2は6000Hz、A3は4500Hzで適用。
 * 4. 立ち上がりを鈍らせる … アタックをA(2ms)→A2は6ms→A3は8ms。
 * 5. ピークは変えない … どちらも`finalizeCandidate`で-3dBFSに正規化する
 *    （Aと同じ。刺さりは音量ではなく高域の問題という統括の見立てに従う）。
 *
 * 段階になっていることを耳だけでなく数字でも示すため、`measureSpectralCentroid`
 * で「スペクトル重心（Hz）」を実測する。重心は音のスペクトル全体の
 * エネルギー分布の中心を表す1つの数値で、値が高いほど高域寄り＝刺さりやすい
 * 傾向にあるとみなせる。A > A2 > A3 の順に下がることを一覧表で確認できる。
 * ========================================================================= */

/**
 * 単純な1次ローパスフィルタ（IIR、一方向）。標準的な1次RCローパスの式
 * alpha = dt/(RC+dt)、RC=1/(2πfc) で平滑化係数を求め、
 * y[n] = y[n-1] + alpha*(x[n]-y[n-1]) をサンプル列に適用する（in-place）。
 * 位相はわずかに遅れるが、パーカッシブな効果音では聴感上問題にならない。
 */
function applyOnePoleLowpass(buffer, cutoffHz) {
  const dt = 1 / SAMPLE_RATE;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < buffer.length; i++) {
    prev = prev + alpha * (buffer[i] - prev);
    buffer[i] = prev;
  }
}

/** 2のべき乗のうちn以上で最小のものを返す（FFTの入力長を揃えるため）。 */
function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * 反復版radix-2 Cooley-Tukey FFT（in-place、実部・虚部の配列を直接書き換える）。
 * 長さは2のべき乗である必要がある。外部ライブラリを使わずNode標準機能のみで
 * 実装（依存関係を増やさない方針のため）。
 */
function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1;
      let curWi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = real[i + j];
        const ui = imag[i + j];
        const vr = real[i + j + len / 2] * curWr - imag[i + j + len / 2] * curWi;
        const vi = real[i + j + len / 2] * curWi + imag[i + j + len / 2] * curWr;
        real[i + j] = ur + vr;
        imag[i + j] = ui + vi;
        real[i + j + len / 2] = ur - vr;
        imag[i + j + len / 2] = ui - vi;
        const nextWr = curWr * wr - curWi * wi;
        const nextWi = curWr * wi + curWi * wr;
        curWr = nextWr;
        curWi = nextWi;
      }
    }
  }
}

/**
 * WAVバッファ（`encodeWav`が返すもの。ディスクに書く前でも計測できる）から
 * スペクトル重心（Hz）を実測する。刺さり（高域の強さ）を数値で比較するための
 * 指標で、値が高いほど高域寄り。ハン窓をかけてからゼロパディングしFFTし、
 * DC(0Hz)を除く各ビンの振幅で周波数を重み付け平均する。
 */
function measureSpectralCentroid(wavBuffer) {
  const dataSize = wavBuffer.readUInt32LE(40);
  const sampleCount = dataSize / 2;
  const fftSize = nextPow2(sampleCount);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  for (let i = 0; i < sampleCount; i++) {
    const sample = wavBuffer.readInt16LE(44 + i * 2) / 32768;
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (sampleCount - 1));
    real[i] = sample * window;
  }
  fft(real, imag);
  let weightedSum = 0;
  let magSum = 0;
  const half = fftSize / 2;
  for (let k = 1; k < half; k++) {
    const mag = Math.hypot(real[k], imag[k]);
    const freq = (k * SAMPLE_RATE) / fftSize;
    weightedSum += freq * mag;
    magSum += mag;
  }
  return magSum > 0 ? weightedSum / magSum : 0;
}

/** Int16配列のうち、フルスケール（±32767/32768）に張り付いた（クリップした）サンプル数を数える。 */
function countClippedSamples(int16Samples) {
  let count = 0;
  for (const v of int16Samples) {
    if (v >= 32767 || v <= -32768) count++;
  }
  return count;
}

/**
 * 系統Aのベル部分音（`BELL_PARTIALS`）から、5.4倍音（金属的な高域成分）の
 * 音量だけを変えた版を作る。`topPartialAmpDb`に`null`を渡すと5.4倍音を
 * 完全に外す（指示の代替案「5.4倍を外して2.76倍までにする」を採用）。
 */
function makeSoftBellPartials(topPartialAmpDb) {
  if (topPartialAmpDb === null) {
    return [
      { ratio: 1.0, amp: 1.0, decayMul: 1.0 },
      { ratio: 2.76, amp: 0.5, decayMul: 1.7 },
    ];
  }
  const topAmp = 0.28 * Math.pow(10, topPartialAmpDb / 20);
  return [
    { ratio: 1.0, amp: 1.0, decayMul: 1.0 },
    { ratio: 2.76, amp: 0.5, decayMul: 1.7 },
    { ratio: 5.4, amp: topAmp, decayMul: 2.4 },
  ];
}

// A2（やわらかめ）: 基音×0.75（完全4度下）、5.4倍音-8dB、アタック6ms、
// ローパス6000Hz。方向性（チャリーン）は保ったまま刺さりを一段階抑える。
const A2_CONFIG = {
  freqScale: 0.75,
  partials: makeSoftBellPartials(-8),
  attackSec: 0.006,
  lowpassHz: 6000,
};

// A3（さらにやわらかめ）: 基音×0.625（短6度〜長6度下）、5.4倍音を除去、
// アタック8ms、ローパス4500Hz。A2よりもう一段階、丸みを持たせる。
const A3_CONFIG = {
  freqScale: 0.625,
  partials: makeSoftBellPartials(null),
  attackSec: 0.008,
  lowpassHz: 4500,
};

/** A2/A3共通のベル1打（`buildBellHit`のやわらかめ版）。configで音色を切り替える。 */
function buildSoftBellHit(buffer, startSample, durationSamples, baseFreq, amp, config) {
  addPartialNote(buffer, startSample, durationSamples, baseFreq, amp, config.partials, {
    attackSec: config.attackSec,
    baseDecayRate: 2.6, // Aと同じ減衰速度（残響の長さは変えない）
  });
}

// 以下3つの`buildVariant*`は、系統A（`candidateA_complete/reward/gacha`）と
// 完全に同じリズム・音符の長さ・音量バランスを使い、(1)基音の周波数、
// (2)倍音構成、(3)アタック、(4)ローパスの4点だけをconfigで差し替える。
// 「方向性は保ったまま刺さりだけ落とす」ため、構造自体は変えない。

function buildVariantComplete(config) {
  const totalSec = 0.75;
  const buffer = new Float64Array(secToSamples(totalSec));
  buildSoftBellHit(buffer, secToSamples(0.0), secToSamples(0.35), NOTE.C6 * config.freqScale, 0.9, config);
  buildSoftBellHit(
    buffer,
    secToSamples(0.09),
    buffer.length - secToSamples(0.09),
    NOTE.E6 * config.freqScale,
    1.0,
    config
  );
  applyOnePoleLowpass(buffer, config.lowpassHz);
  return finalizeCandidate(buffer);
}

function buildVariantReward(config) {
  const totalSec = 0.85;
  const buffer = new Float64Array(secToSamples(totalSec));
  buildSoftBellHit(buffer, secToSamples(0.0), secToSamples(0.3), NOTE.C6 * config.freqScale, 0.8, config);
  buildSoftBellHit(buffer, secToSamples(0.1), secToSamples(0.4), NOTE.D6 * config.freqScale, 0.9, config);
  buildSoftBellHit(
    buffer,
    secToSamples(0.2),
    buffer.length - secToSamples(0.2),
    NOTE.E6 * config.freqScale,
    1.0,
    config
  );
  applyOnePoleLowpass(buffer, config.lowpassHz);
  return finalizeCandidate(buffer);
}

function buildVariantGacha(config) {
  const totalSec = 0.95;
  const buffer = new Float64Array(secToSamples(totalSec));
  const smallNotes = [NOTE.A5, NOTE.C6, NOTE.D6, NOTE.E6];
  const step = 0.06;
  smallNotes.forEach((freq, i) => {
    buildSoftBellHit(
      buffer,
      secToSamples(i * step),
      secToSamples(0.16),
      freq * config.freqScale,
      0.5 + i * 0.05,
      config
    );
  });
  const finalStart = secToSamples(smallNotes.length * step + 0.03);
  const finalDur = buffer.length - finalStart;
  buildSoftBellHit(buffer, finalStart, finalDur, NOTE.E6 * config.freqScale, 1.0, config);
  buildSoftBellHit(buffer, finalStart, finalDur, NOTE.C6 * config.freqScale, 0.55, config); // 同時に重ねて厚みを出す
  applyOnePoleLowpass(buffer, config.lowpassHz);
  return finalizeCandidate(buffer);
}

/**
 * A2・A3（各3場面＝6ファイル）を指定ディレクトリに書き出し、比較用に系統A
 * （既存の`A_チャリーン_*.wav`。ここではディスクには書かず数値計測だけ行う）
 * を含めた一覧表を標準出力に表示する。`assets/sounds/`・`src/lib/sound.ts`・
 * 既存の候補ファイル（`--candidates`が書き出した12個）には一切触れない。
 */
function generateSoftenCandidates(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];

  function addRow(fileName, samples, meta, write) {
    const wav = encodeWav(samples);
    if (write) {
      fs.writeFileSync(path.join(outDir, fileName), wav);
    }
    const peakDb = measureWavPeakDb(wav);
    const centroidHz = Math.round(measureSpectralCentroid(wav));
    const clipped = countClippedSamples(samples);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(3);
    rows.push({ fileName, seconds, peakDb: peakDb.toFixed(2), centroidHz, clipped, ...meta });
  }

  // 比較用（参考）: 系統A本体。ファイルは書き出さない（scratchpad内の既存
  // A_チャリーン_*.wavは前回セッションが書いたものをそのまま残す）。
  addRow(
    "(参考)A_チャリーン_完了報告",
    candidateA_complete(),
    {
      baseFreq: `${noteName(NOTE.C6)}→${noteName(NOTE.E6)}`,
      partials: "1.0/2.76/5.4倍（5.4倍0dB=減衰なし）",
      lowpass: "なし",
      attack: "2ms",
      diff: "（基準）",
    },
    false
  );
  addRow(
    "(参考)A_チャリーン_ごほうび交換",
    candidateA_reward(),
    {
      baseFreq: `${noteName(NOTE.C6)}→${noteName(NOTE.D6)}→${noteName(NOTE.E6)}`,
      partials: "1.0/2.76/5.4倍（5.4倍0dB=減衰なし）",
      lowpass: "なし",
      attack: "2ms",
      diff: "（基準）",
    },
    false
  );
  addRow(
    "(参考)A_チャリーン_ガチャ",
    candidateA_gacha(),
    {
      baseFreq: `${noteName(NOTE.A5)}〜${noteName(NOTE.E6)}`,
      partials: "1.0/2.76/5.4倍（5.4倍0dB=減衰なし）",
      lowpass: "なし",
      attack: "2ms",
      diff: "（基準）",
    },
    false
  );

  // A2（やわらかめ）
  addRow(
    "A2_チャリーン_完了報告.wav",
    buildVariantComplete(A2_CONFIG),
    {
      baseFreq: `${(NOTE.C6 * A2_CONFIG.freqScale).toFixed(1)}Hz→${(NOTE.E6 * A2_CONFIG.freqScale).toFixed(1)}Hz（G5〜B5あたり、A×0.75）`,
      partials: "1.0/2.76/5.4倍（5.4倍-8dB）",
      lowpass: "6000Hz(1次)",
      attack: "6ms",
      diff: "基音-0.75倍・5.4倍音-8dB・アタック6ms・LPF6000Hz",
    },
    true
  );
  addRow(
    "A2_チャリーン_ごほうび交換.wav",
    buildVariantReward(A2_CONFIG),
    {
      baseFreq: `${(NOTE.C6 * A2_CONFIG.freqScale).toFixed(1)}→${(NOTE.D6 * A2_CONFIG.freqScale).toFixed(1)}→${(NOTE.E6 * A2_CONFIG.freqScale).toFixed(1)}Hz（G5〜B5あたり）`,
      partials: "1.0/2.76/5.4倍（5.4倍-8dB）",
      lowpass: "6000Hz(1次)",
      attack: "6ms",
      diff: "基音-0.75倍・5.4倍音-8dB・アタック6ms・LPF6000Hz",
    },
    true
  );
  addRow(
    "A2_チャリーン_ガチャ.wav",
    buildVariantGacha(A2_CONFIG),
    {
      baseFreq: `${(NOTE.A5 * A2_CONFIG.freqScale).toFixed(1)}〜${(NOTE.E6 * A2_CONFIG.freqScale).toFixed(1)}Hz`,
      partials: "1.0/2.76/5.4倍（5.4倍-8dB）",
      lowpass: "6000Hz(1次)",
      attack: "6ms",
      diff: "基音-0.75倍・5.4倍音-8dB・アタック6ms・LPF6000Hz",
    },
    true
  );

  // A3（さらにやわらかめ）
  addRow(
    "A3_チャリーン_完了報告.wav",
    buildVariantComplete(A3_CONFIG),
    {
      baseFreq: `${(NOTE.C6 * A3_CONFIG.freqScale).toFixed(1)}Hz→${(NOTE.E6 * A3_CONFIG.freqScale).toFixed(1)}Hz（E5〜G5あたり、A×0.625）`,
      partials: "1.0/2.76倍のみ（5.4倍を除去）",
      lowpass: "4500Hz(1次)",
      attack: "8ms",
      diff: "基音-0.625倍・5.4倍音を除去・アタック8ms・LPF4500Hz",
    },
    true
  );
  addRow(
    "A3_チャリーン_ごほうび交換.wav",
    buildVariantReward(A3_CONFIG),
    {
      baseFreq: `${(NOTE.C6 * A3_CONFIG.freqScale).toFixed(1)}→${(NOTE.D6 * A3_CONFIG.freqScale).toFixed(1)}→${(NOTE.E6 * A3_CONFIG.freqScale).toFixed(1)}Hz（E5〜G5あたり）`,
      partials: "1.0/2.76倍のみ（5.4倍を除去）",
      lowpass: "4500Hz(1次)",
      attack: "8ms",
      diff: "基音-0.625倍・5.4倍音を除去・アタック8ms・LPF4500Hz",
    },
    true
  );
  addRow(
    "A3_チャリーン_ガチャ.wav",
    buildVariantGacha(A3_CONFIG),
    {
      baseFreq: `${(NOTE.A5 * A3_CONFIG.freqScale).toFixed(1)}〜${(NOTE.E6 * A3_CONFIG.freqScale).toFixed(1)}Hz`,
      partials: "1.0/2.76倍のみ（5.4倍を除去）",
      lowpass: "4500Hz(1次)",
      attack: "8ms",
      diff: "基音-0.625倍・5.4倍音を除去・アタック8ms・LPF4500Hz",
    },
    true
  );

  console.log("\n=== やわらかめ候補（A2/A3）の一覧（参考: 系統Aも掲載） ===");
  console.log(
    "ファイル名 / 長さ(秒) / ピーク(dBFS) / クリップ数 / スペクトル重心(Hz) / 基音 / 倍音構成 / ローパス / アタック / Aからの差分"
  );
  for (const row of rows) {
    console.log(
      `- ${row.fileName} / ${row.seconds}s / ${row.peakDb}dB / ${row.clipped}件 / ${row.centroidHz}Hz / ${row.baseFreq} / ${row.partials} / ${row.lowpass} / ${row.attack} / ${row.diff}`
    );
  }
  console.log(
    "\n重心Hzの比較（同一場面での並び。値が高いほど高域寄り＝刺さりやすい傾向）:"
  );
  const scenes = [
    ["完了報告", "(参考)A_チャリーン_完了報告", "A2_チャリーン_完了報告.wav", "A3_チャリーン_完了報告.wav"],
    ["ごほうび交換", "(参考)A_チャリーン_ごほうび交換", "A2_チャリーン_ごほうび交換.wav", "A3_チャリーン_ごほうび交換.wav"],
    ["ガチャ", "(参考)A_チャリーン_ガチャ", "A2_チャリーン_ガチャ.wav", "A3_チャリーン_ガチャ.wav"],
  ];
  for (const [label, aName, a2Name, a3Name] of scenes) {
    const find = (name) => rows.find((r) => r.fileName === name);
    const a = find(aName);
    const a2 = find(a2Name);
    const a3 = find(a3Name);
    console.log(
      `- ${label}: A=${a.centroidHz}Hz > A2=${a2.centroidHz}Hz > A3=${a3.centroidHz}Hz` +
        (a.centroidHz > a2.centroidHz && a2.centroidHz > a3.centroidHz ? "（段階を確認）" : "（要確認：順序が逆転）")
    );
  }
  console.log(`\n出力先: ${outDir}`);
}

/* =========================================================================
 * やさしい版（2026-09-25、統括決定・やること.md 4-76・実装メモ297章）
 *
 * A2（鐘の響き・高い音を速く続けて鳴らす）が、家族から「緊急地震速報みたいで
 * 心臓に悪い」と言われた。緊急地震速報のチャイムも鐘の音を続けて鳴らす作りで、
 * 似たのは偶然ではない。統括が候補を聴き比べ、統括が持ち込んだWeb Audioの
 * コード（「やさしい版」）の音を選んだ。ごほうび交換だけは余韻を0.35秒→1.0秒に
 * 伸ばした（統括「もうすこしぽーんとながく」）。
 *
 * - 完了報告：三角波のド・ミ・ソ（C4・E4・G4、0.12秒おき）、900Hzのローパス
 * - ガチャ：「ポコッ」（220→110Hz）のあと、ミ・ソ・ド・ミ（E4〜E5、0.09秒おき）
 * - ごほうび交換：「ぽーん」（360→240Hz、600Hzのローパス、1.0秒で消える）
 * - 鐘のような「整数倍からずれた倍音」は使わない。音はA2より大幅に低い
 *
 * 音量の時間変化とフィルターは、Web Audioの setValueAtTime・linearRamp・
 * exponentialRamp と BiquadFilter(lowpass, Q=1dB) と同じ計算で再現している。
 * 聴き比べに使ったファイルと1バイトも違わないことを確かめてある（297章）。
 * ========================================================================= */

const GENTLE_PEAK_DB = -8;

function gentleEnvelope(points) {
  return (t) => {
    let v = points[0].v;
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      if (t < p.t) {
        const prev = points[k - 1];
        if (!prev || p.type === "set") return v;
        const r = (t - prev.t) / (p.t - prev.t);
        return p.type === "lin" ? prev.v + (p.v - prev.v) * r : prev.v * Math.pow(p.v / prev.v, r);
      }
      v = p.v;
    }
    return v;
  };
}

function gentleLowpass(cutoffHz) {
  const q = Math.pow(10, 1 / 20);
  const w = (2 * Math.PI * cutoffHz) / SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function gentleOsc(buffer, { type, start, stop, freq, gain, cutoff }) {
  let phase = 0;
  const lp = cutoff ? gentleLowpass(cutoff) : (x) => x;
  for (let i = Math.floor(start * SAMPLE_RATE); i < Math.floor(stop * SAMPLE_RATE) && i < buffer.length; i++) {
    const t = i / SAMPLE_RATE;
    phase += (2 * Math.PI * freq(t)) / SAMPLE_RATE;
    const wave = type === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    buffer[i] += lp(wave) * gain(t);
  }
}

/** ピークを-8dBFSに揃えてInt16にする（音は最後に自然に消えるので、フェードはかけない）。 */
function finalizeGentle(buffer) {
  let peak = 0;
  for (const v of buffer) peak = Math.max(peak, Math.abs(v));
  const scale = Math.pow(10, GENTLE_PEAK_DB / 20) / peak;
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    out[i] = Math.round(Math.max(-1, Math.min(1, buffer[i] * scale)) * 32767);
  }
  return out;
}

const gentleRise = (start, amp, riseSec, endSec) =>
  gentleEnvelope([
    { t: start, v: 0, type: "set" },
    { t: start + riseSec, v: amp, type: "lin" },
    { t: endSec, v: 0.001, type: "exp" },
  ]);

function buildGentleComplete() {
  const buffer = new Float64Array(Math.floor(SAMPLE_RATE * 0.6));
  [261.63, 329.63, 392.0].forEach((f, i) => {
    const s = i * 0.12;
    gentleOsc(buffer, { type: "triangle", start: s, stop: s + 0.3, freq: () => f, gain: gentleRise(s, 0.25, 0.02, s + 0.28), cutoff: 900 });
  });
  return finalizeGentle(buffer);
}

function buildGentleGacha() {
  const buffer = new Float64Array(Math.floor(SAMPLE_RATE * 0.85));
  gentleOsc(buffer, {
    type: "sine",
    start: 0,
    stop: 0.1,
    cutoff: 400,
    freq: gentleEnvelope([{ t: 0, v: 220, type: "set" }, { t: 0.1, v: 110, type: "exp" }]),
    gain: gentleEnvelope([{ t: 0, v: 0.3, type: "set" }, { t: 0.1, v: 0.01, type: "exp" }]),
  });
  [329.63, 392.0, 523.25, 659.25].forEach((f, i) => {
    const s = 0.08 + i * 0.09;
    gentleOsc(buffer, { type: "sine", start: s, stop: s + 0.4, freq: () => f, gain: gentleRise(s, 0.2, 0.015, s + 0.4) });
  });
  return finalizeGentle(buffer);
}

function buildGentleReward() {
  const tail = 1.0;
  const buffer = new Float64Array(Math.floor(SAMPLE_RATE * (tail + 0.05)));
  gentleOsc(buffer, {
    type: "sine",
    start: 0,
    stop: tail,
    cutoff: 600,
    freq: gentleEnvelope([{ t: 0, v: 360, type: "set" }, { t: 0.15, v: 240, type: "exp" }]),
    gain: gentleRise(0, 0.35, 0.01, tail),
  });
  return finalizeGentle(buffer);
}

main();
