// Wipes the local emulators and writes the invented family.
// Talks only to 127.0.0.1 and refuses any project id that isn't demo-*.
//   node case-media/scripts/seed.mjs
import { pathToFileURL } from 'node:url';
import { familyDoc, FAMILY_CODE, APP_ID, PROJECT_ID } from './data/family.mjs';

const FIRESTORE = 'http://127.0.0.1:8080';
const AUTH = 'http://127.0.0.1:9099';

// Plain JS value -> Firestore REST value.
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  switch (typeof v) {
    case 'string': return { stringValue: v };
    case 'boolean': return { booleanValue: v };
    case 'number': return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case 'object': return { mapValue: { fields: toFields(v) } };
    default: throw new Error(`Unsupported value: ${v}`);
  }
}
function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
}

async function call(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status} ${await res.text()}`);
  return res;
}

export async function resetAndSeed() {
  if (!PROJECT_ID.startsWith('demo-')) throw new Error('Refusing: project id must start with demo-');
  const db = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  await call(`${FIRESTORE}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  await call(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });

  const docPath = `artifacts/${APP_ID}/public/data/families/${FAMILY_CODE}`;
  await call(`${db}/${docPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: toFields(familyDoc()) }),
  });

  // Read it back so a broken seed fails here, not in a screenshot.
  const check = await (await call(`${db}/${docPath}`, { headers: { Authorization: 'Bearer owner' } })).json();
  const safe = check.fields.safeFoods.arrayValue.values.length;
  const trials = check.fields.trials.arrayValue.values.length;
  console.log(`Seeded family ${FAMILY_CODE} in ${PROJECT_ID}: ${safe} safe foods, ${trials} trials.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  resetAndSeed().catch((err) => { console.error(err); process.exit(1); });
}
