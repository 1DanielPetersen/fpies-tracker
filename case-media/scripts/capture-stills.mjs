// The phone stills: 390 x 844 CSS px at 3x = 1170 x 2532 px.
//   node case-media/scripts/capture-stills.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resetAndSeed } from './seed.mjs';
import {
  LABEL_PHOTOS, OUT_DIR, launchBrowser, newPhone, joinFamily, freezeMotion, scrollTo, shoot,
  assertVersionMatches,
} from './lib/common.mjs';
import { createGemini } from './lib/gemini.mjs';
import {
  openTab, openSafeList, pickLabelPhoto, waitForResult, scrollToResult, fitAboveTabBar, rowOf, layoutReport,
} from './lib/flows.mjs';

const SCALE = 3;

export async function captureStills() {
  await resetAndSeed();
  const gemini = createGemini(LABEL_PHOTOS);
  const browser = await launchBrowser();
  const reports = {};
  try {
    const phone = await newPhone(browser, { name: 'stills', scale: SCALE, gemini });
    const { page } = phone;
    await joinFamily(phone);
    await assertVersionMatches(page);
    await freezeMotion(page);

    // 1. Scanner after the red label.
    await pickLabelPhoto(page, 'puffs');
    await waitForResult(page, 'red');
    await scrollToResult(page);
    const photo = page.getByAltText('Scannet etiket');
    await fitAboveTabBar(page, page.locator('.fpies-fade-in'), photo, { gap: 12, slack: 4 });
    reports['scan-resultat'] = await layoutReport(page, [
      ['photo', photo],
      ['result card', page.locator('.fpies-fade-in')],
    ]);
    await shoot(phone, path.join(OUT_DIR, 'scan-resultat.png'));

    // 2. 4-Dages Test.
    await scrollTo(page, 0);
    await openTab(page, '4-Dages Test', 'Aktive Tests');
    await fitAboveTabBar(page, page.getByText('Godkendt til Sikker').locator('..'), page.getByRole('heading', { name: 'Start 4-Dages Test' }));
    reports['test-4-dage'] = await layoutReport(page, [
      ['Laks card', page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Laks' }) })],
      ['Broccoli card', page.locator('div.rounded-3xl', { has: page.getByRole('heading', { name: 'Broccoli' }) })],
      ['finished: Havre', page.getByText('Fejlet til Forbudt')],
      ['finished: Blåbær', page.getByText('Godkendt til Sikker')],
    ]);
    await shoot(phone, path.join(OUT_DIR, 'test-4-dage.png'));

    // 3. Madlister on Sikker Liste.
    await scrollTo(page, 0);
    await openSafeList(page);
    await fitAboveTabBar(page, rowOf(page, 'Pære'), page.getByRole('button', { name: 'Sikker Liste', exact: true }), { gap: 6, slack: 4 });
    reports.madlister = await layoutReport(page, [
      ['tabs', page.getByRole('button', { name: 'Sikker Liste', exact: true })],
      ['first row', page.getByText('Blåbær', { exact: true })],
      ['7th row', page.getByText('Pære', { exact: true })],
    ]);
    await shoot(phone, path.join(OUT_DIR, 'madlister.png'));

    // 4. Scanner after the green label.
    await scrollTo(page, 0);
    await openTab(page, 'Scanner', 'Åbn Kamera for at Scanne');
    await pickLabelPhoto(page, 'frugtmos');
    await waitForResult(page, 'green');
    await scrollToResult(page);
    reports['scan-groen'] = await layoutReport(page, [
      ['photo', page.getByAltText('Scannet etiket')],
      ['result card', page.locator('.fpies-fade-in')],
    ]);
    await shoot(phone, path.join(OUT_DIR, 'scan-groen.png'));

    console.log('Gemini answers served:', gemini.served.join(', '));
    await phone.close();
  } finally {
    await browser.close();
  }
  for (const [name, rows] of Object.entries(reports)) {
    console.log(`\n${name}.png (CSS px; safe = inside the 4% margin)`);
    console.table(rows);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  captureStills().catch((err) => { console.error(err); process.exit(1); });
}
