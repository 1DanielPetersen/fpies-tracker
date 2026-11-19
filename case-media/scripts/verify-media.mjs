// Checks every file in case-media/fpies-beskytter against the brief: pixel
// sizes, file sizes, video length, codecs, no audio, and the film's colours
// (poster background and hairline exact, video background measured).
//   node case-media/scripts/verify-media.mjs
// The expected colours are the film setting (FILM_BG / FILM_HAIRLINE or the
// defaults in render-film.mjs), so run it with the same settings as the render.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OUT_DIR, launchBrowser } from './lib/common.mjs';
import { FILM_COLORS, STAGE } from './render-film.mjs';

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
const skip = (file, what, detail) => rows.push({ file, what, result: 'n/a', detail });

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

// ---- The film's colours ---------------------------------------------------
const toHex = (c) => `#${c.toString(16).padStart(6, '0').toUpperCase()}`;
const toInt = (hex) => parseInt(hex.slice(1), 16);
const rgbOf = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const levelsOff = (a, b) => Math.max(...rgbOf(a).map((v, i) => Math.abs(v - rgbOf(b)[i])));
const BG = toInt(FILM_COLORS.background);
const HAIRLINE = toInt(FILM_COLORS.hairline);

// One frame as raw RGB. Video is decoded as it is tagged: BT.709, limited range.
function rgbFrame(file, frame = 0) {
  const vf = file.endsWith('.png')
    ? 'format=rgb24'
    : `select=eq(n\\,${frame}),scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * MB });
}

// Every stage pixel outside the phones and their hairline, counted by colour,
// most common first.
function backgroundColours(rgb, margin = 4) {
  const counts = new Map();
  for (let y = 0; y < STAGE.height; y++) {
    for (let x = 0; x < STAGE.width; x++) {
      if (STAGE.phones.some((p) => x >= p.x - margin && x < p.x + p.w + margin && y >= p.y - margin && y < p.y + p.h + margin)) continue;
      const i = (y * STAGE.width + x) * 3;
      const c = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

// Pixels the 1.5 px hairline covers completely: the middle of each straight edge.
function hairlinePixels(rgb) {
  const out = [];
  for (const p of STAGE.phones) {
    const midX = Math.round(p.x + p.w / 2);
    const midY = Math.round(p.y + p.h / 2);
    for (const [x, y] of [[p.x - 1, midY], [p.x + p.w, midY], [midX, p.y - 1], [midX, p.y + p.h]]) {
      const i = (y * STAGE.width + x) * 3;
      out.push((rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]);
    }
  }
  return out;
}

// What a browser shows: Chromium decodes the first frame onto a canvas.
async function chromiumBackground(names) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.route('https://film.check/**', (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      if (!name) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><video muted playsinline></video>' });
      return route.fulfill({ path: path.join(OUT_DIR, name), contentType: name.endsWith('.webm') ? 'video/webm' : 'video/mp4' });
    });
    await page.goto('https://film.check/');
    const out = {};
    for (const name of names) {
      out[name] = await page.evaluate(async (src) => {
        const v = document.querySelector('video');
        v.src = src;
        try {
          await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = () => reject(new Error('cannot play')); });
        } catch {
          return null;
        }
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0);
        const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return (d[0] << 16) | (d[1] << 8) | d[2]; };
        return [px(20, 20), px(1900, 20), px(960, 600), px(20, 1180), px(1900, 1180)];
      }, `https://film.check/${name}`);
    }
    return out;
  } finally {
    await browser.close();
  }
}

{
  const name = 'fpies-film-poster.png';
  const rgb = rgbFrame(path.join(OUT_DIR, name));
  const colours = backgroundColours(rgb);
  const wrong = colours.filter(([c]) => c !== BG);
  check(name, `background ${FILM_COLORS.background}`, wrong.length === 0,
    wrong.length ? `${wrong.reduce((n, [, k]) => n + k, 0)} pixels differ, e.g. ${toHex(wrong[0][0])}` : 'every background pixel exact');
  const hair = hairlinePixels(rgb);
  check(name, `hairline ${FILM_COLORS.hairline}`, hair.every((c) => c === HAIRLINE), [...new Set(hair.map(toHex))].join(', '));
}

const measured = {};
for (const name of Object.keys(VIDEOS)) {
  // The first frame and the finished state (12 s), as ffmpeg decodes them.
  const frames = [0, 360].map((n) => backgroundColours(rgbFrame(path.join(OUT_DIR, name), n)));
  const [top, count] = frames[0][0];
  const total = frames[0].reduce((n, [, k]) => n + k, 0);
  const worst = Math.max(...frames.flatMap((f) => f.map(([c]) => levelsOff(c, BG))));
  measured[name] = toHex(top);
  check(name, 'background (ffmpeg, BT.709)', levelsOff(top, BG) <= 2,
    `${toHex(top)} (${levelsOff(top, BG)} off) on ${((100 * count) / total).toFixed(1)}%, every pixel within ${worst}`);
}
const shown = await chromiumBackground(Object.keys(VIDEOS));
for (const [name, px] of Object.entries(shown)) {
  if (!px) {
    skip(name, 'background (Chromium)', 'this Chromium build cannot play it');
    continue;
  }
  const uniform = new Set(px).size === 1;
  measured[`${name} in Chromium`] = toHex(px[0]);
  check(name, 'background (Chromium)', uniform && levelsOff(px[0], BG) <= 2, `${[...new Set(px.map(toHex))].join(', ')} (${levelsOff(px[0], BG)} off)`);
}

console.table(rows);
console.log(`Film colours: background ${FILM_COLORS.background}, hairline ${FILM_COLORS.hairline}.`);
console.log(`Film background as decoded: ${Object.entries(measured).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
if (!ok) {
  console.error('Some checks failed.');
  process.exit(1);
}
console.log('All media checks passed.');
