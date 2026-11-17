// Film, part 1: every step of the story as a crisp 2x still (780 x 1688 px),
// from two live phones (two anonymous users) on the same family code.
// The right phone is never touched: Laks reaches it through the app's own
// Firestore sync from the left phone's tap, via the emulator.
//   node case-media/scripts/capture-film-steps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resetAndSeed } from './seed.mjs';
import {
  LABEL_PHOTOS, WORK_DIR, launchBrowser, newPhone, joinFamily, freezeMotion, tap, scrollTo, shoot,
  assertVersionMatches, centerOf, mkdirp,
} from './lib/common.mjs';
import { createGemini } from './lib/gemini.mjs';
import {
  navButton, openSafeList, pickLabelPhoto, waitForResult, scrollToResult, fitAboveTabBar, rowOf,
} from './lib/flows.mjs';

const SCALE = 2;
export const FILM_DIR = path.join(WORK_DIR, 'film');
const STEPS_DIR = path.join(FILM_DIR, 'steps');
export const SCROLL_FRAMES = 12; // one still per film frame: 12 frames = 400 ms at 30 fps

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// Capture with one element hidden (layout unchanged), then show it again.
async function withHidden(handle, capture) {
  await handle.evaluate((el) => { el.style.visibility = 'hidden'; });
  try {
    await capture();
  } finally {
    await handle.evaluate((el) => { el.style.visibility = ''; });
    await handle.dispose();
  }
}

// Where the tab bar starts and how far the page is scrolled (CSS px).
async function screenGeometry(page) {
  return page.evaluate(() => ({
    navTop: document.querySelector('nav').getBoundingClientRect().top,
    scrollY: window.scrollY,
  }));
}

export async function captureFilmSteps() {
  await resetAndSeed();
  fs.rmSync(STEPS_DIR, { recursive: true, force: true });
  mkdirp(STEPS_DIR);
  const gemini = createGemini(LABEL_PHOTOS);
  const browser = await launchBrowser();
  const manifest = { scale: SCALE, viewport: { width: 390, height: 844 }, steps: {}, taps: {}, slides: {}, highlight: null };
  const still = async (phone, name) => {
    manifest.steps[name] = path.relative(FILM_DIR, await shoot(phone, path.join(STEPS_DIR, `${name}.png`)));
  };

  try {
    const left = await newPhone(browser, { name: 'left', scale: SCALE, gemini });
    const right = await newPhone(browser, { name: 'right', scale: SCALE, gemini });
    await joinFamily(left);
    await joinFamily(right);
    await assertVersionMatches(left.page);
    await freezeMotion(left.page);
    await freezeMotion(right.page);
    const L = left.page;
    const R = right.page;

    // Right phone: Madlister -> Sikker Liste, same framing as madlister.png.
    await openSafeList(R);
    await fitAboveTabBar(R, rowOf(R, 'Pære'), R.getByRole('button', { name: 'Sikker Liste', exact: true }), { gap: 6, slack: 4 });
    await still(right, 'R0');
    const rightGeo = { ...(await screenGeometry(R)), firstRowTop: (await rowOf(R, 'Blåbær').boundingBox()).y };

    // Left phone: Scanner, ready to scan.
    await still(left, 'L0');
    manifest.taps.camera = centerOf(await L.getByText('Åbn Kamera for at Scanne').locator('..').boundingBox());

    // The photo arrives and the app shows "Analyserer AI..." while Gemini works.
    const release = gemini.holdNext();
    await pickLabelPhoto(L, 'puffs');
    await L.getByText('Analyserer AI...').waitFor();
    await still(left, 'L1a'); // pulse at full strength
    // The same overlay at the middle of the app's animate-pulse (opacity .5),
    // so the film can play the real pulse by blending the two.
    const half = await L.addStyleTag({ content: '.animate-pulse{opacity:.5!important}' });
    await still(left, 'L1b');
    await half.evaluate((el) => el.remove());

    release();
    await waitForResult(L, 'red');
    await still(left, 'L2_00');

    // Scroll to the full result card, one real still per film frame.
    await scrollToResult(L);
    const target = await fitAboveTabBar(L, L.locator('.fpies-fade-in'), L.getByAltText('Scannet etiket'), { gap: 12, slack: 4 });
    for (let k = 1; k <= SCROLL_FRAMES; k++) {
      await scrollTo(L, Math.round(target * easeInOutCubic(k / SCROLL_FRAMES) * 2) / 2);
      await still(left, `L2_${String(k).padStart(2, '0')}`);
    }
    manifest.scrollTarget = target;

    // Tap "4-Dages Test" (the tab bar is fixed, so the tap point doesn't
    // depend on scroll). The trials screen starts at the top rather than at
    // the scanner's leftover scroll, which would cut its title under the
    // header, and stays there when Laks moves (the page gets shorter).
    manifest.taps.trials = centerOf(await navButton(L, '4-Dages Test').boundingBox());
    await scrollTo(L, 0);
    await tap(L, navButton(L, '4-Dages Test'));
    await L.getByText('Aktive Tests').waitFor();
    await still(left, 'L3');

    // Geometry for the film's slide when Laks leaves the active tests, plus a
    // plate: the same screen with only the Laks card hidden, so the card can
    // fade out over the real background.
    const laksCard = L.locator('div.rounded-3xl', { has: L.getByRole('heading', { name: 'Laks' }) });
    const broccoliCard = L.locator('div.rounded-3xl', { has: L.getByRole('heading', { name: 'Broccoli' }) });
    const laksBox = await laksCard.boundingBox();
    const broccoliTop = (await broccoliCard.boundingBox()).y;
    const leftNav = await screenGeometry(L);
    await withHidden(await laksCard.elementHandle(), () => still(left, 'L3_plate'));
    // And the same screen without the (fixed) tab bar, so the list can slide
    // up out from under it without anything missing.
    await withHidden(await L.locator('nav').elementHandle(), () => still(left, 'L3_nonav'));

    // Tap "Dag 4" on Laks (day 3 done): the app moves it to "Godkendt til Sikker".
    const dag4 = laksCard.getByRole('button', { name: '4', exact: true });
    manifest.taps.dag4 = centerOf(await dag4.boundingBox());
    // Watch the right phone from the moment of the tap, to time the real sync.
    const tappedAt = Date.now();
    const synced = rowOf(R, 'Laks').waitFor({ timeout: 20000 }).then(() => Date.now() - tappedAt);
    await tap(L, dag4);
    await L.locator('div.rounded-2xl', { hasText: 'Laks' }).filter({ hasText: 'Godkendt til Sikker' }).waitFor();
    await still(left, 'L4');
    if ((await screenGeometry(L)).scrollY !== leftNav.scrollY) throw new Error('Left phone scrolled while Laks moved.');
    const gapL = broccoliTop - (laksBox.y + laksBox.height);
    const newRow = await rowOf(L, 'Laks').boundingBox(); // Laks in "Nyligt Afsluttede"
    manifest.slides.left = {
      kind: 'remove', from: 'L3', to: 'L4', plate: 'L3_plate', under: 'L3_nonav',
      newRow: { y: newRow.y, h: newRow.height },
      top: laksBox.y - 8, // the card with its soft shadow
      split: broccoliTop - gapL / 2, // everything below this slides up
      pitch: broccoliTop - laksBox.y, // by exactly one card
      navTop: leftNav.navTop,
    };

    // Right phone: Laks arrives through the sync and lands on top (newest first).
    manifest.syncMs = await synced;
    await still(right, 'R1');
    const laksRow = await rowOf(R, 'Laks').boundingBox();
    const blaabaerAfter = (await rowOf(R, 'Blåbær').boundingBox()).y;
    if ((await screenGeometry(R)).scrollY !== rightGeo.scrollY) throw new Error('Right phone scrolled when Laks arrived.');
    manifest.highlight = laksRow;
    manifest.laksAddedLabel = await rowOf(R, 'Laks').getByText(/Tilføjet/).innerText();
    // The list with an empty slot where Laks lands.
    await withHidden(await rowOf(R, 'Laks').elementHandle(), () => still(right, 'R1_plate'));
    const gapR = blaabaerAfter - (laksRow.y + laksRow.height);
    manifest.slides.right = {
      kind: 'insert', from: 'R0', to: 'R1', plate: 'R1_plate',
      top: rightGeo.firstRowTop - gapR / 2, // everything below this slides down
      pitch: blaabaerAfter - rightGeo.firstRowTop, // by exactly one row
      navTop: rightGeo.navTop,
    };

    await left.close();
    await right.close();
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(FILM_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Film steps: ${Object.keys(manifest.steps).length} stills. Laks reached the right phone ${manifest.syncMs} ms after the tap (${manifest.laksAddedLabel}).`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  captureFilmSteps().catch((err) => { console.error(err); process.exit(1); });
}
