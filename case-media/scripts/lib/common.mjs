// Shared Playwright helpers for the case-media captures.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FAMILY_CODE, FROZEN_NOW } from '../data/family.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = path.resolve(here, '..');
export const CASE_DIR = path.resolve(SCRIPTS_DIR, '..');
export const WORK_DIR = path.join(CASE_DIR, '.work');
export const OUT_DIR = path.join(CASE_DIR, 'fpies-beskytter');
export const DATA_DIR = path.join(SCRIPTS_DIR, 'data');
// The fictional labels as "phone photos" (fixed inputs, see make-labels.mjs).
export const LABEL_PHOTOS = {
  puffs: path.join(SCRIPTS_DIR, 'labels', 'puffs.jpg'),
  frugtmos: path.join(SCRIPTS_DIR, 'labels', 'frugtmos.jpg'),
};

export const APP_URL = 'http://127.0.0.1:4173/';
export const PHONE = { width: 390, height: 844 };

// Hosts the app may reach. Everything else is blocked, and the three real
// Firebase hosts are reported loudly, so a mistake fails instead of writing
// to the real project.
const PROD_FIREBASE_HOSTS = new Set([
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
]);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']); // the app's own @import
const GEMINI_HOST = 'generativelanguage.googleapis.com';

export function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Playwright is resolved like require() would: a local install next to these
// scripts, the repo, or a global one (NODE_PATH).
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export async function launchBrowser() {
  return chromium.launch();
}

async function installGuard(context, name, gemini) {
  const blocked = [];
  const block = (url) => {
    const kind = PROD_FIREBASE_HOSTS.has(url.hostname) ? 'REAL FIREBASE' : 'unexpected host';
    const where = `${url.protocol}//${url.hostname}${url.pathname}`; // never log query strings
    blocked.push(`${kind}: ${where}`);
    console.error(`\n!!! [${name}] BLOCKED ${kind} request: ${where}\n`);
  };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (LOCAL_HOSTS.has(url.hostname) || FONT_HOSTS.has(url.hostname)) return route.continue();
    if (url.hostname === GEMINI_HOST && gemini) return gemini.handle(route);
    block(url);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket((url) => !LOCAL_HOSTS.has(url.hostname), (ws) => {
    block(new URL(ws.url()));
    ws.close();
  });
  return {
    blocked,
    assertClean() {
      if (blocked.length) throw new Error(`[${name}] Blocked requests:\n  ${blocked.join('\n  ')}`);
    },
  };
}

// One phone = one browser context = one anonymous user on the emulator.
export async function newPhone(browser, { name, scale, gemini }) {
  const context = await browser.newContext({
    viewport: PHONE,
    screen: PHONE,
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
    locale: 'da-DK',
    timezoneId: 'Europe/Copenhagen',
    colorScheme: 'light',
    // Blocked so page.route sees every request (a service worker would hide
    // them). The update banner is checked separately, see assertNoBanner().
    serviceWorkers: 'block',
  });
  const guard = await installGuard(context, name, gemini);
  await context.clock.setFixedTime(new Date(FROZEN_NOW));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
    console.error(`[${name}] page error: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[${name}] console error: ${msg.text()}`);
  });
  return {
    name,
    context,
    page,
    guard,
    errors,
    async close() {
      guard.assertClean();
      await context.close();
    },
  };
}

// The real join flow: open the app, type the family code, tap "Deltag i Familie".
export async function joinFamily(phone) {
  const { page } = phone;
  const signedIn = page.waitForResponse((r) => r.url().includes('accounts:signUp') && r.ok(), { timeout: 20000 });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await signedIn; // signInAnonymously() against the Auth emulator
  const input = page.getByPlaceholder('Indtast Familiekode');
  await input.fill(FAMILY_CODE);
  // The app ignores the tap until onAuthStateChanged has handed it the user,
  // which lands a moment after the sign-up response. Tap again until joined.
  const header = page.getByText(`Familiekode: ${FAMILY_CODE}`);
  for (let attempt = 1; ; attempt++) {
    await page.getByRole('button', { name: 'Deltag i Familie' }).click();
    try {
      await header.waitFor({ timeout: 1500 });
      break;
    } catch (err) {
      if (attempt >= 10) throw err;
    }
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await assertDemoBackend(page);
  phone.guard.assertClean();
}

// Belt and braces: the running bundle must be the demo/emulator build.
async function assertDemoBackend(page) {
  const usesEmulator = await page.evaluate(async () => {
    const res = await fetch(document.querySelector('script[type="module"]').src);
    const js = await res.text();
    return js.includes('127.0.0.1:9099') && js.includes('demo-fpies') && !js.includes('fpies-tracker.firebaseapp.com');
  });
  if (!usesEmulator) throw new Error('The app bundle is not the emulator capture build. Stopping.');
}

// Freeze CSS motion for stills, so nothing is caught mid-transition.
export async function freezeMotion(page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
}

// Tap like a finger, then park the pointer on an inert spot so no hover style
// is left behind (a phone has no hover).
export async function tap(page, locator) {
  await locator.tap();
  await page.mouse.move(4, 840);
}

export async function scrollTo(page, y) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// Wait for the app font (all weights it uses), every image and two frames.
export async function settle(page) {
  await page.evaluate(async () => {
    const weights = ['400', '500', '600', '700', '800'];
    const faces = await Promise.all(weights.map((w) => document.fonts.load(`${w} 16px "Plus Jakarta Sans"`, 'FPIES Beskytter Æøå')));
    if (faces.some((f) => f.length === 0)) throw new Error('Plus Jakarta Sans did not load');
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? img.decode().catch(() => {}) : new Promise((r) => { img.onload = img.onerror = r; }),
      ),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

export async function assertNoBanner(page) {
  if (await page.getByText('En ny version af appen er tilgængelig').count()) {
    throw new Error('The update banner is showing. version.json must match the build.');
  }
}

// version.json served next to the bundle must carry the bundle's own version.
export async function assertVersionMatches(page) {
  const ok = await page.evaluate(async () => {
    const { version } = await (await fetch('/version.json', { cache: 'no-store' })).json();
    const js = await (await fetch(document.querySelector('script[type="module"]').src)).text();
    return js.includes(`"${version}"`);
  });
  if (!ok) throw new Error('version.json does not match the build; the update banner could show.');
}

export async function shoot(phone, file, { clip } = {}) {
  const { page } = phone;
  await settle(page);
  await assertNoBanner(page);
  phone.guard.assertClean();
  if (phone.errors.length) throw new Error(`[${phone.name}] page errors: ${phone.errors.join('; ')}`);
  mkdirp(path.dirname(file));
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', scale: 'device', clip });
  return file;
}

export function centerOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
