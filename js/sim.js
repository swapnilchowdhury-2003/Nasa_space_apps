/* AstraGuard AI · front-end prototype
 * sim.js: simulated crew telemetry + a simple baseline-deviation score.
 * Everything here is fake data for demo purposes. In the full system this
 * module is replaced by FastAPI + WebSocket streams and ML model output.
 */
const KEYS = ['hr', 'hrv', 'spo2', 'sys', 'dia', 'temp', 'resp'];
const SD   = { hr: 5, hrv: 9, spo2: 0.8, sys: 7, dia: 5, temp: 0.25, resp: 1.5 };
const HIST = 60;

const EFFECT = {
  nominal:   {},
  radiation: { hr: 14, hrv: -26, spo2: -1.4, temp: 0.3, resp: 2, sys: 8 },
  fatigue:   { hr: 9, hrv: -30, spo2: -0.8, temp: -0.35, resp: 2 },
  cardio:    { hr: 28, hrv: -26, spo2: -1.5, sys: 24, dia: 12 }
};

const CREW_DEF = [
  { id: 'vega',  name: 'Vega',  role: 'Commander',        base: { hr: 66, hrv: 62, spo2: 98.0, sys: 118, dia: 76, temp: 36.7, resp: 15 } },
  { id: 'atlas', name: 'Atlas', role: 'Flight Engineer',  base: { hr: 62, hrv: 70, spo2: 98.4, sys: 114, dia: 73, temp: 36.6, resp: 14 } },
  { id: 'lyra',  name: 'Lyra',  role: 'Mission Specialist', base: { hr: 70, hrv: 58, spo2: 97.8, sys: 112, dia: 72, temp: 36.8, resp: 16 } },
  { id: 'nova',  name: 'Nova',  role: 'Medical Officer',  base: { hr: 64, hrv: 66, spo2: 98.2, sys: 116, dia: 75, temp: 36.7, resp: 15 } }
];

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function createCrew(def) {
  const c = { ...def, scenario: 'nominal', v: { ...def.base }, hist: {}, score: 0.08, level: 'ok', scoreHist: [], episode: false };
  KEYS.forEach(k => { c.hist[k] = []; });
  for (let i = 0; i < HIST; i++) { stepCrew(c, true); }
  return c;
}

function targetOf(c, k) { return c.base[k] + (EFFECT[c.scenario][k] || 0); }

function zscores(c) {
  const z = {};
  KEYS.forEach(k => { z[k] = Math.abs((c.v[k] - c.base[k]) / SD[k]); });
  return z;
}

function stepCrew(c, silent) {
  KEYS.forEach(k => {
    c.v[k] += (targetOf(c, k) - c.v[k]) * 0.12 + gauss() * SD[k] * 0.12;
    c.hist[k].push(c.v[k]);
    if (c.hist[k].length > HIST) c.hist[k].shift();
  });
  // baseline-deviation score (stand-in for Isolation Forest output): 0 = normal, 1 = highly abnormal
  const z = zscores(c);
  const raw = (z.hr + z.hrv + z.spo2 + z.sys + z.temp + z.resp) / 6 / 3;
  c.score = clamp(c.score * 0.8 + raw * 0.2, 0, 1);
  c.scoreHist.push(c.score);
  if (c.scoreHist.length > HIST) c.scoreHist.shift();

  // alert level with hysteresis
  let next = c.level;
  if (c.score >= 0.65) next = 'crit';
  else if (c.score >= 0.40) next = (c.level === 'crit' && c.score > 0.55) ? 'crit' : 'warn';
  else if (c.score < 0.32) next = 'ok';
  const changed = !silent && next !== c.level;
  const prev = c.level;
  c.level = next;
  return changed ? { from: prev, to: next } : null;
}

const vitality = c => Math.round(100 * (1 - c.score * 0.9));

/* habitat environment */
function createEnv() {
  return {
    rad:  { label: 'Radiation dose rate', unit: 'µSv/h', base: 18, v: 18, max: 140, dec: 0 },
    co2:  { label: 'Cabin CO₂',           unit: 'ppm',   base: 2400, v: 2400, max: 5000, dec: 0 },
    temp: { label: 'Cabin temperature',   unit: '°C',    base: 22.4, v: 22.4, max: 30, dec: 1 },
    hum:  { label: 'Humidity',            unit: '%',     base: 46, v: 46, max: 80, dec: 0 }
  };
}
function stepEnv(env, radiationActive) {
  const t = radiationActive ? env.rad.base * 6 : env.rad.base;
  env.rad.v  += (t - env.rad.v) * 0.1 + gauss() * 1.2;
  env.co2.v  += (env.co2.base - env.co2.v) * 0.05 + gauss() * 18;
  env.temp.v += (env.temp.base - env.temp.v) * 0.05 + gauss() * 0.03;
  env.hum.v  += (env.hum.base - env.hum.v) * 0.05 + gauss() * 0.15;
}

/* 48 h risk forecast (simulated; in production: Prophet / XGBoost output) */
function forecast(c) {
  const labels = [], mean = [], lo = [], hi = [];
  const active = c.scenario !== 'nominal';
  const h = c.scoreHist, n = h.length;
  const trend = n > 20 ? (h[n - 1] - h[n - 11]) / 10 : 0;
  const floor = 0.12, tau = active ? 90 : 9;
  for (let t = 0; t <= 48; t += 4) {
    const circ = 0.05 * Math.sin((t / 24) * 2 * Math.PI + 1.2);
    const decay = floor + (c.score - floor) * Math.exp(-t / tau);
    const drift = active ? clamp(trend * t * 0.6, -0.1, 0.25) : 0;
    const m = clamp(decay + drift + circ, 0.02, 0.98);
    const w = 0.035 + t * 0.0019;
    labels.push(t === 0 ? 'now' : '+' + t + 'h');
    mean.push(+(m * 100).toFixed(1));
    lo.push(+(clamp(m - w, 0, 1) * 100).toFixed(1));
    hi.push(+(clamp(m + w, 0, 1) * 100).toFixed(1));
  }
  return { labels, mean, lo, hi };
}

/* placeholder protocols (replace with NASA-aligned clinical guidance) */
const PROTOCOLS = {
  radiation: {
    title: 'Radiation exposure protocol',
    why: 'Habitat dose rate is elevated and the crew member shows reduced HRV with a raised heart rate.',
    steps: ['Move to the designated shielded area of the habitat.', 'Log start time and current dose-rate reading.', 'Hydrate and rest; avoid strenuous activity.', 'Re-check vitals after 15 minutes.', 'Queue an exposure report for Mission Control.']
  },
  cardio: {
    title: 'Cardiovascular stress protocol',
    why: 'Heart rate and blood pressure are well above this crew member’s personal baseline.',
    steps: ['Stop current activity and sit or lie down.', 'Take a manual blood pressure and pulse reading to confirm sensors.', 'Hydrate; check cabin CO₂ and temperature.', 'Repeat measurement in 10 minutes.', 'If readings stay high, notify the medical officer and Mission Control.']
  },
  fatigue: {
    title: 'Fatigue & recovery protocol',
    why: 'HRV is low and baseline deviation is rising, a pattern consistent with accumulated fatigue.',
    steps: ['Review the sleep log for the past 3 nights.', 'Schedule a protected rest period.', 'Reduce high-risk tasks for the next shift.', 'Light exercise and a hydration check.', 'Review the 48-hour forecast again after rest.']
  }
};

function classify(c, env) {
  const z = zscores(c);
  if (env.rad.v > env.rad.base * 3) return 'radiation';
  if (z.sys > 2 || (z.hr > 2.2 && z.sys > 1) || z.hr > 3.5) return 'cardio';
  return 'fatigue';
}
