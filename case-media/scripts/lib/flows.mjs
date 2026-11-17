// App steps shared by the stills and the film. They only use the app's real UI.
import { LABEL_PHOTOS, PHONE, tap, scrollTo } from './common.mjs';

export const RESULT_HEADINGS = {
  red: 'FARE REGISTRERET',
  orange: 'Nye ingredienser fundet',
  green: 'Alle ingredienser er kendte og sikre',
};

export function navButton(page, label) {
  return page.locator('nav').getByRole('button', { name: label, exact: true });
}

export async function openTab(page, label, readyText) {
  await tap(page, navButton(page, label));
  await page.getByText(readyText, { exact: true }).first().waitFor();
}

export async function openSafeList(page) {
  await openTab(page, 'Madlister', 'Forbudt Liste');
  await tap(page, page.getByRole('button', { name: 'Sikker Liste', exact: true }));
  await page.getByPlaceholder('Tilføj til Sikker liste...').waitFor();
}

// "Takes the photo": hands the label photo to the camera input, exactly as the
// phone's camera would after "Åbn Kamera for at Scanne".
export async function pickLabelPhoto(page, label) {
  await page.locator('input[type="file"][capture="environment"]').first().setInputFiles(LABEL_PHOTOS[label]);
  await page.getByAltText('Scannet etiket').waitFor();
}

export async function waitForResult(page, status) {
  await page.getByText(RESULT_HEADINGS[status], { exact: true }).waitFor({ timeout: 30000 });
}

// Scroll so the photo sits just under the sticky header and the whole result
// card is in view, like a parent would after the answer appears.
export async function resultScrollY(page) {
  return page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const photo = document.querySelector('img[alt="Scannet etiket"]').parentElement.getBoundingClientRect();
    return Math.round(window.scrollY + photo.top - header.bottom - 16);
  });
}

export async function scrollToResult(page) {
  const y = await resultScrollY(page);
  await scrollTo(page, y);
  return y;
}

// Scroll down just far enough that `last` ends `gap` px above the tab bar,
// but never so far that `keep` slides more than `slack` px under the header.
export async function fitAboveTabBar(page, last, keep, { gap = 10, slack = 0 } = {}) {
  const lastBox = await last.boundingBox();
  const keepBox = await keep.boundingBox();
  const { navTop, headerBottom, y } = await page.evaluate(() => ({
    navTop: document.querySelector('nav').getBoundingClientRect().top,
    headerBottom: document.querySelector('header').getBoundingClientRect().bottom,
    y: window.scrollY,
  }));
  const wanted = lastBox.y + lastBox.height - (navTop - gap);
  const allowed = keepBox.y - headerBottom + slack;
  const delta = Math.max(0, Math.min(wanted, allowed));
  await scrollTo(page, Math.round(y + delta));
  return Math.round(y + delta);
}

export function rowOf(page, text) {
  return page.getByText(text, { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
}

// Where things sit on screen, in CSS px, to check the 4% safe margin.
export async function layoutReport(page, entries) {
  const out = [];
  for (const [what, locator] of entries) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Not on screen: ${what}`);
    const insideX = box.x >= PHONE.width * 0.04 && box.x + box.width <= PHONE.width * 0.96;
    const insideY = box.y >= PHONE.height * 0.04 && box.y + box.height <= PHONE.height * 0.96;
    out.push({ what, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), safe: insideX && insideY });
  }
  return out;
}
