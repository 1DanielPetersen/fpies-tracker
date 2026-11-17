// Checks every file in case-media/fpies-beskytter against the brief:
// pixel sizes, file sizes, video length, codecs, no audio.
//   node case-media/scripts/verify-media.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OUT_DIR } from './lib/common.mjs';

const MB = 1024 * 1024;
const PNGS = {
  'scan-resultat.png': [1170, 2532],
  'test-4-dage.png': [1170, 2532],
  'madlister.png': [1170, 2532],
  'scan-groen.png': [1170, 2532],
  'fpies-film-poster.png': [1920, 1200],
};
const VIDEOS = {
  'fpies-film.mp4': { codec: 'h264', limit: 4 * MB },
  'fpies-film.webm': { codec: 'vp9', limit: 3 * MB },
};

const rows = [];
let ok = true;
const check = (file, what, pass, detail) => {
  rows.push({ file, what, result: pass ? 'ok' : 'FAIL', detail });
  if (!pass) ok = false;
};

for (const [name, [w, h]] of Object.entries(PNGS)) {
  const file = path.join(OUT_DIR, name);
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  check(name, 'pixels', width === w && height === h, `${width} x ${height}`);
  check(name, 'size < 1.5 MB', buf.length < 1.5 * MB, `${(buf.length / MB).toFixed(2)} MB`);
}

for (const [name, spec] of Object.entries(VIDEOS)) {
  const file = path.join(OUT_DIR, name);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const video = info.streams.filter((s) => s.codec_type === 'video');
  const audio = info.streams.filter((s) => s.codec_type === 'audio');
  const v = video[0];
  const seconds = Number(info.format.duration);
  const bytes = Number(info.format.size);
  check(name, 'codec', video.length === 1 && v.codec_name === spec.codec, v.codec_name);
  check(name, 'pixels', v.width === 1920 && v.height === 1200, `${v.width} x ${v.height}`);
  check(name, 'yuv420p', v.pix_fmt === 'yuv420p', v.pix_fmt);
  check(name, 'no audio', audio.length === 0, `${audio.length} audio streams`);
  check(name, '12-14 s', seconds >= 12 && seconds <= 14, `${seconds.toFixed(2)} s`);
  check(name, `size < ${spec.limit / MB} MB`, bytes < spec.limit, `${(bytes / MB).toFixed(2)} MB`);
  if (name.endsWith('.mp4')) {
    const head = fs.readFileSync(file).subarray(0, 64 * 1024).toString('latin1');
    check(name, 'faststart', head.indexOf('moov') !== -1 && head.indexOf('moov') < head.indexOf('mdat'), 'moov before mdat');
  }
}

console.table(rows);
if (!ok) {
  console.error('Some checks failed.');
  process.exit(1);
}
console.log('All media checks passed.');
