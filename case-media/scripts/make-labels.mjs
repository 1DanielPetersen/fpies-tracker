// Renders the fictional labels (labels/*.html) to "phone photos" (JPEG) in
// labels/. The photos are committed and used as fixed inputs, because
// Chromium rasterises this scene a hair differently from run to run (a few
// levels in a few pixels). Run this only when a label should change:
//   node case-media/scripts/make-labels.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCRIPTS_DIR, LABEL_PHOTOS, launchBrowser, mkdirp } from './lib/common.mjs';

export async function makeLabels() {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const [name, out] of Object.entries(LABEL_PHOTOS)) {
      const src = path.join(SCRIPTS_DIR, 'labels', `${name}.html`);
      await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });
      // Every weight the labels use, then two frames, so nothing is caught
      // half-loaded and every render is identical.
      await page.evaluate(async () => {
        const faces = [
          '700 40px Nunito', '800 40px Nunito', '900 40px Nunito',
          '400 40px "Source Sans 3"', '600 40px "Source Sans 3"', '800 40px "Source Sans 3"',
        ];
        for (const f of faces) {
          if (!(await document.fonts.load(f, 'fra mdr. Ææøå 0123456789 %')).length) throw new Error(`Label font missing: ${f}`);
        }
        await document.fonts.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      mkdirp(path.dirname(out));
      // A phone saves JPEG, so the "photo" gets real JPEG compression too.
      await page.screenshot({ path: out, type: 'jpeg', quality: 84 });
      console.log(`Label photo: ${path.relative(process.cwd(), out)}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  makeLabels().catch((err) => { console.error(err); process.exit(1); });
}
