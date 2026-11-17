// The one invented family that runs through every picture and the film.
// No real names, codes or dates from our own account.

export const PROJECT_ID = 'demo-fpies'; // demo- ids can never reach real Firebase
export const APP_ID = 'demo-fpies'; // path segment: artifacts/{APP_ID}/public/data/families/{code}
export const FAMILY_CODE = 'K7Q2PX';

// Frozen clock for every capture: Tuesday 10 November 2026, 08:40 in Copenhagen.
export const FROZEN_NOW = '2026-11-10T08:40:00+01:00';

const at = (iso) => new Date(iso).toISOString();
const CREATED_AT = at('2026-08-02T20:05:00+02:00');

// The default forbidden list, as handleCreateFamily() in src/App.jsx creates it.
const DEFAULT_DANGER = [
  'Majsmel (Cornmeal)',
  'Hirse (Millet)',
  'Majs (Corn)',
  'Majsstivelse (Corn Starch)',
  'Glukosesirup (Glucose Syrup)',
  'Maltodextrin',
  'Dextrose',
];

// Sikker liste. Blåbær came in through a passed 4-day test (see trials).
const SAFE = [
  ['Sød kartoffel', '2026-08-02T20:05:40+02:00'],
  ['Gulerod', '2026-08-02T20:06:10+02:00'],
  ['Pære', '2026-08-02T20:06:40+02:00'],
  ['Æble', '2026-08-19T19:20:00+02:00'],
  ['Banan', '2026-09-01T18:40:00+02:00'],
  ['Avocado', '2026-09-16T19:55:00+02:00'],
  ['Kalkun', '2026-09-30T17:30:00+02:00'],
  ['Squash', '2026-10-08T18:10:00+02:00'],
  ['Blåbær', '2026-11-01T19:45:00+01:00'],
];

// Trials in the order they were started (the app appends new ones).
// "Laks on day 3" means days 1-3 are ticked and Dag 4 is next.
const TRIALS = [
  { foodName: 'Havre', startDate: '2026-10-13T08:30:00+02:00', daysPassed: 1, status: 'failed' },
  { foodName: 'Blåbær', startDate: '2026-10-29T08:15:00+01:00', daysPassed: 4, status: 'passed' },
  { foodName: 'Laks', startDate: '2026-11-07T09:00:00+01:00', daysPassed: 3, status: 'active' },
  { foodName: 'Broccoli', startDate: '2026-11-08T09:20:00+01:00', daysPassed: 2, status: 'active' },
];

export function familyDoc() {
  return {
    createdAt: CREATED_AT,
    safeFoods: SAFE.map(([name, when]) => ({ name, addedAt: at(when) })),
    dangerFoods: [
      ...DEFAULT_DANGER.map((name) => ({ name, addedAt: CREATED_AT })),
      // Moved here when the Havre test failed (handleFailTrial in the app).
      { name: 'Havre', addedAt: at('2026-10-14T15:10:00+02:00') },
    ],
    trials: TRIALS.map((t) => ({
      id: String(Date.parse(t.startDate)), // the app uses Date.now().toString()
      foodName: t.foodName,
      daysPassed: t.daysPassed,
      status: t.status,
      startDate: at(t.startDate),
    })),
  };
}
