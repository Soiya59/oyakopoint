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
  const outDir = path.join(__dirname, "..", "assets", "sounds");
  fs.mkdirSync(outDir, { recursive: true });

  const files = {
    "complete.wav": buildComplete(),
    "reward.wav": buildReward(),
    "gacha.wav": buildGacha(),
  };

  for (const [name, samples] of Object.entries(files)) {
    const wav = encodeWav(samples);
    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, wav);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(3);
    console.log(`wrote ${outPath} (${seconds}s, ${wav.length} bytes)`);
  }
}

main();
