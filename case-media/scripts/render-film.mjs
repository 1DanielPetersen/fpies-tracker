// Film, part 2: lays the step stills out on a 1920 x 1200 stage, renders it
// frame by frame at 30 fps (every animation paused and seeked, so the result
// is exact and sharp) and encodes MP4 (H.264) and WebM (VP9) plus the poster.
//   node case-media/scripts/render-film.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SCRIPTS_DIR, WORK_DIR, OUT_DIR, launchBrowser, mkdirp } from './lib/common.mjs';

const FILM_DIR = path.join(WORK_DIR, 'film');
const SLIDES_DIR = path.join(FILM_DIR, 'slides');
const SCALED_DIR = path.join(FILM_DIR, 'scaled');
const FRAMES_DIR = path.join(FILM_DIR, 'frames');

const W = 1920;
const H = 1200;
const FPS = 30;
const TOTAL = 13000; // ms
const FRAME_MS = 1000 / FPS;
const frameAt = (ms) => Math.round(ms / FRAME_MS);

// Each phone is the 390 x 844 screen at ~1.25x, rounded to whole pixels so
// nothing gets resampled twice: 488 x 1056.
const PHONE_W = 488;
const PHONE_H = 1056;
const GAP = 160;
const RADIUS = 36;
const STROKE = 1.5;
const LEFT_X = (W - (2 * PHONE_W + GAP)) / 2; // 392
const RIGHT_X = LEFT_X + PHONE_W + GAP; // 1040
const TOP_Y = (H - PHONE_H) / 2; // 72

// Timeline in ms. Each tap leads its screen change by 150 ms; crossfades and
// slides are 300-400 ms.
export const TL = {
  tapCamera: 1000,
  photoIn: [1150, 1500], // crossfade: photo + "Analyserer AI..." (pulsing)
  resultIn: [3000, 3300], // crossfade: the red result card appears
  scrollFrom: 3500, // 12 real scroll stills, one per frame (400 ms)
  tapTrials: 5200,
  trialsIn: [5350, 5700], // crossfade: 4-Dages Test
  tapDag4: 6400,
  passFrom: 6550, // slide: Laks leaves the active tests (11 frames, ~367 ms)
  syncFrom: 7900, // slide: Laks arrives on the right phone
  highlight: [[8270, 0], [8570, 1], [9100, 1], [10300, 0]],
  loopBack: [12500, 12900], // crossfade back to the very first frame
  poster: 12000, // finished state, before the loop crossfade
};
const SLIDE_FRAMES = 11;

const MP4_LIMIT = 4 * 1024 * 1024;
const WEBM_LIMIT = 3 * 1024 * 1024;

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

// The in-between frames of a list change, built only from real renders of the
// app: `from`, `to`, and a plate (the same screen with the one moving element
// hidden). Rows move by exactly one row/card, so the last step equals `to`.
async function composeSlides(page, manifest) {
  fs.rmSync(SLIDES_DIR, { recursive: true, force: true });
  mkdirp(SLIDES_DIR);
  const steps = {};
  const s = manifest.scale;
  const dataUrl = (name) => `data:image/png;base64,${fs.readFileSync(path.join(FILM_DIR, manifest.steps[name])).toString('base64')}`;
  for (const [side, slide] of Object.entries(manifest.slides)) {
    const spec = {
      kind: slide.kind,
      from: dataUrl(slide.from),
      to: dataUrl(slide.to),
      plate: dataUrl(slide.plate),
      under: slide.under ? dataUrl(slide.under) : null,
      newRow: slide.newRow ? { y: Math.round(slide.newRow.y * s), h: Math.round(slide.newRow.h * s) } : null,
      top: Math.round(slide.top * s),
      split: Math.round((slide.split ?? slide.top) * s),
      pitch: Math.round(slide.pitch * s),
      navTop: Math.round(slide.navTop * s),
      progress: Array.from({ length: SLIDE_FRAMES - 1 }, (_, i) => easeInOutCubic((i + 1) / SLIDE_FRAMES)),
    };
    const frames = await page.evaluate(async (sp) => {
      const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
      const [from, to, plate, under] = await Promise.all([load(sp.from), load(sp.to), load(sp.plate), sp.under ? load(sp.under) : null]);
      const w = to.naturalWidth;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = to.naturalHeight;
      const ctx = c.getContext('2d');
      const clipped = (y, h, draw) => { ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, h); ctx.clip(); draw(); ctx.restore(); };
      const out = [];
      for (const p of sp.progress) {
        const d = Math.round(sp.pitch * p);
        ctx.globalAlpha = 1;
        ctx.drawImage(to, 0, 0);
        if (sp.kind === 'remove') {
          // Where the card was: the plate, with the card fading out over it.
          clipped(sp.top, sp.split - d - sp.top, () => {
            ctx.drawImage(plate, 0, 0);
            ctx.globalAlpha = 1 - p;
            ctx.drawImage(from, 0, 0);
            ctx.globalAlpha = 1;
          });
          // Everything below slides up by d, taken from the render without the
          // tab bar so nothing is missing as it rises out from under it. The
          // new "finished" row rides along just below it and fades in. The
          // tab bar itself comes from `to`, untouched.
          clipped(sp.split - d, sp.navTop - (sp.split - d), () => {
            const h = Math.min(under.naturalHeight, sp.navTop + sp.pitch) - sp.split;
            ctx.drawImage(under, 0, sp.split, w, h, 0, sp.split - d, w, h);
            const r = sp.newRow;
            ctx.globalAlpha = p;
            ctx.drawImage(to, 0, r.y - 4, w, r.h + 8, 0, r.y - 4 + sp.pitch - d, w, r.h + 8);
            ctx.globalAlpha = 1;
          });
        } else {
          // The opening slot shows the new row fading in over the empty slot.
          clipped(sp.top, d, () => { ctx.globalAlpha = 1 - p; ctx.drawImage(plate, 0, 0); ctx.globalAlpha = 1; });
          // The old list slides down by d, under the tab bar.
          const h = sp.navTop - sp.top - d;
          if (h > 0) ctx.drawImage(from, 0, sp.top, w, h, 0, sp.top + d, w, h);
        }
        out.push(c.toDataURL('image/png'));
      }
      return out;
    }, spec);
    steps[side] = frames.map((url, i) => {
      const name = `${slide.from}${slide.to}_${String(i + 1).padStart(2, '0')}`;
      const file = path.join(SLIDES_DIR, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      manifest.steps[name] = path.relative(FILM_DIR, file);
      return name;
    });
  }
  return steps;
}

function scaleStills(manifest) {
  fs.rmSync(SCALED_DIR, { recursive: true, force: true });
  mkdirp(SCALED_DIR);
  const out = {};
  for (const [name, rel] of Object.entries(manifest.steps)) {
    if (/_(plate|nonav)$/.test(name)) continue; // only used to build the slides
    const dst = path.join(SCALED_DIR, `${name}.png`);
    ffmpeg(['-i', path.join(FILM_DIR, rel), '-vf', `scale=${PHONE_W}:${PHONE_H}:flags=lanczos+accurate_rnd`, '-pix_fmt', 'rgb24', dst]);
    out[name] = pathToFileURL(dst).href;
  }
  return out;
}

// Stills shown one per frame, starting the frame after `startFrame`.
const flipbook = (src, names, startFrame) =>
  names.map((n, i) => ({ src: src[n], cut: (startFrame + i + 0.5) * FRAME_MS }));

function buildConfig(manifest, src, slides) {
  const sx = PHONE_W / manifest.viewport.width;
  const sy = PHONE_H / manifest.viewport.height;
  const phone = { w: PHONE_W, h: PHONE_H, y: TOP_Y, radius: RADIUS, stroke: STROKE };
  const onStage = (x0, p) => ({ x: Math.round(x0 + p.x * sx), y: Math.round(TOP_Y + p.y * sy) });
  const scrollNames = Object.keys(src).filter((n) => /^L2_(0[1-9]|1\d)$/.test(n)).sort();
  const hl = manifest.highlight;

  return {
    total: TOTAL,
    phones: [
      {
        ...phone,
        x: LEFT_X,
        layers: [
          { src: src.L0 },
          { group: [{ src: src.L1a }, { src: src.L1b, pulse: [TL.photoIn[0], TL.resultIn[1]] }], fadeIn: TL.photoIn },
          { src: src.L2_00, fadeIn: TL.resultIn },
          ...flipbook(src, scrollNames, frameAt(TL.scrollFrom)),
          { src: src.L3, fadeIn: TL.trialsIn },
          ...flipbook(src, [...slides.left, 'L4'], frameAt(TL.passFrom)),
          { src: src.L0, fadeIn: TL.loopBack },
        ],
      },
      {
        ...phone,
        x: RIGHT_X,
        layers: [
          { src: src.R0 },
          ...flipbook(src, [...slides.right, 'R1'], frameAt(TL.syncFrom)),
          {
            highlight: { x: Math.round(hl.x * sx), y: Math.round(hl.y * sy), w: Math.round(hl.width * sx), h: Math.round(hl.height * sy), radius: Math.round(16 * sx) },
            keys: TL.highlight,
          },
          { src: src.R0, fadeIn: TL.loopBack },
        ],
      },
    ],
    taps: [
      { ...onStage(LEFT_X, manifest.taps.camera), t: TL.tapCamera },
      { ...onStage(LEFT_X, manifest.taps.trials), t: TL.tapTrials },
      { ...onStage(LEFT_X, manifest.taps.dag4), t: TL.tapDag4 },
    ],
  };
}

export function encode(frames = Math.round((TOTAL / 1000) * FPS)) {
  // -fflags +bitexact: no random IDs or version strings, so the same frames
  // always give the same file.
  const input = ['-framerate', String(FPS), '-i', path.join(FRAMES_DIR, 'f%04d.png'), '-frames:v', String(frames), '-an', '-fflags', '+bitexact'];
  // sRGB frames -> BT.709 limited range, tagged, so browsers show the right colours.
  const colour = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
  const mp4 = path.join(OUT_DIR, 'fpies-film.mp4');
  const webm = path.join(OUT_DIR, 'fpies-film.webm');

  // Best quality that stays well under each size limit. At CRF 12 both are
  // close to transparent for this mostly still screen content.
  for (const crf of [12, 14, 16, 18, 20, 22, 24]) {
    ffmpeg([...input, ...colour, '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', String(crf),
      '-profile:v', 'high', '-movflags', '+faststart', mp4]);
    if (fs.statSync(mp4).size < MP4_LIMIT * 0.9) break;
  }
  // Single-pass constant quality: two-pass VP9 fails in some ffmpeg 6.1 builds
  // ("rc_twopass_stats_in missing EOS stats packet").
  for (const crf of [12, 16, 20, 24, 28, 32]) {
    ffmpeg([...input, ...colour, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1',
      '-tile-columns', '2', '-deadline', 'good', '-cpu-used', '1', webm]);
    if (fs.statSync(webm).size < WEBM_LIMIT * 0.9) break;
  }
  return { mp4, webm };
}

// Builds the stage and returns the open page, ready to seek (used by the
// renderer and handy for checking single frames).
export async function openStage(browser) {
  const manifest = JSON.parse(fs.readFileSync(path.join(FILM_DIR, 'manifest.json'), 'utf8'));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(SCRIPTS_DIR, 'film', 'film.html')).href);
  const slides = await composeSlides(page, manifest);
  const config = buildConfig(manifest, scaleStills(manifest), slides);
  fs.writeFileSync(path.join(FILM_DIR, 'stage-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const count = await page.evaluate((cfg) => window.buildFilm(cfg), config);
  return { page, count };
}

export async function renderFilm({ encodeVideo = true } = {}) {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirp(FRAMES_DIR);
  const frames = Math.round((TOTAL / 1000) * FPS);
  const browser = await launchBrowser();
  try {
    const { page, count } = await openStage(browser);
    console.log(`Stage ready: ${count} animations, ${frames} frames.`);
    for (let n = 0; n < frames; n++) {
      await page.evaluate((t) => window.seekFilm(t), n * FRAME_MS);
      await page.screenshot({ path: path.join(FRAMES_DIR, `f${String(n).padStart(4, '0')}.png`) });
    }
    await page.evaluate((t) => window.seekFilm(t), TL.poster);
    await page.screenshot({ path: path.join(OUT_DIR, 'fpies-film-poster.png') });
  } finally {
    await browser.close();
  }
  if (!encodeVideo) return;
  const { mp4, webm } = encode(frames);
  for (const f of [mp4, webm]) console.log(`${path.basename(f)}: ${(fs.statSync(f).size / 1024 / 1024).toFixed(2)} MB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // --encode-only re-encodes the frames already rendered in .work/film/frames.
  const job = process.argv.includes('--encode-only')
    ? Promise.resolve(encode()).then(({ mp4, webm }) => {
      for (const f of [mp4, webm]) console.log(`${path.basename(f)}: ${(fs.statSync(f).size / 1024 / 1024).toFixed(2)} MB`);
    })
    : renderFilm();
  job.catch((err) => { console.error(err); process.exit(1); });
}
