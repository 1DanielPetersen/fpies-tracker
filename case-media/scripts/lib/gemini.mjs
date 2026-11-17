// Answers the app's Gemini request inside Playwright, so every capture gets
// the same scan result.
//
// data/gemini-<label>.json holds either
//   { "source": "gemini", "response": <the raw API response> }  (a real answer)
//   { "source": "stub",   "answer":   <the app's JSON schema> }  (written by hand)
//
// Record mode (GEMINI_RECORD=1 with VITE_GEMINI_API_KEY set in the shell):
// the app's request is forwarded once to the real API with the key added here
// in Node, and the raw answer is saved for replay. The key is never put in the
// bundle, never logged and never written to disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, WORK_DIR, mkdirp } from './common.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function answerFile(label) {
  return path.join(DATA_DIR, `gemini-${label}.json`);
}

export function readAnswer(label) {
  const file = answerFile(label);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function wrapStub(answer) {
  // Same shape as a generateContent response; the app reads the last
  // non-thought text part and JSON.parses it.
  return {
    candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] } }],
    modelVersion: 'stub',
  };
}

export function createGemini(labelPhotos) {
  const byImage = new Map(
    Object.entries(labelPhotos).map(([label, file]) => [sha(fs.readFileSync(file).toString('base64')), label]),
  );
  const record = process.env.GEMINI_RECORD === '1';
  const key = process.env.VITE_GEMINI_API_KEY || '';
  if (record && !key) throw new Error('GEMINI_RECORD=1 needs VITE_GEMINI_API_KEY in the environment.');

  let hold = null;
  const served = [];

  return {
    served,
    // Keep the next answer back until release() is called.
    holdNext() {
      let release;
      hold = new Promise((r) => { release = r; });
      return release;
    },
    async handle(route) {
      const req = route.request();
      const body = JSON.parse(req.postData() || '{}');
      const parts = body.contents?.[0]?.parts || [];
      const prompt = parts.find((p) => p.text)?.text || '';
      const image = parts.find((p) => p.inlineData)?.inlineData?.data || '';
      const label = byImage.get(sha(image));
      if (!label) {
        console.error('Gemini request with an unknown image; aborting it.');
        return route.abort('failed');
      }
      // Keep the exact prompt the app sent, for reference.
      fs.writeFileSync(path.join(mkdirp(WORK_DIR), `gemini-prompt-${label}.txt`), prompt);

      let saved = readAnswer(label);
      if (record && saved?.source !== 'gemini') {
        const url = new URL(req.url());
        url.searchParams.set('key', key);
        const res = await route.fetch({ url: url.toString() });
        if (!res.ok()) throw new Error(`Gemini answered ${res.status()} while recording ${label}`);
        saved = { source: 'gemini', recordedAt: new Date().toISOString(), response: await res.json() };
        fs.writeFileSync(answerFile(label), `${JSON.stringify(saved, null, 2)}\n`);
        console.log(`Recorded a real Gemini answer for ${label}.`);
      }
      if (!saved) throw new Error(`No saved Gemini answer for ${label} (${answerFile(label)})`);

      const response = saved.source === 'gemini' ? saved.response : wrapStub(saved.answer);
      if (hold) {
        const wait = hold;
        hold = null;
        await wait;
      }
      served.push(`${label}:${saved.source}`);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    },
  };
}
