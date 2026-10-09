/* AstraGuard AI · front-end prototype · app.js (UI layer) */
(function () {
  const $ = id => document.getElementById(id);
  const crew = CREW_DEF.map(createCrew);
  const env = createEnv();
  let focus = 0;
  let offline = false;
  let queued = 0;
  let metSec = 142 * 86400 + 6 * 3600 + 12 * 60 + 33;
  let tickN = 0;
  let pendingProto = null;

  const COLORS = { cyan: '#4cc9f0', orange: '#ff8a4c', ok: '#3ddc97', warn: '#ffb84d', crit: '#ff5d6c', grid: 'rgba(143,163,201,.12)' };
  Chart.defaults.color = '#8fa3c9';
  Chart.defaults.font.family = '"Segoe UI",system-ui,sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.animation = false;

  const TILES = [
    { id: 'hr',   label: 'Heart rate',   unit: 'bpm',  dec: 0, get: c => c.v.hr,   hist: c => c.hist.hr },
    { id: 'hrv',  label: 'HRV (RMSSD)',  unit: 'ms',   dec: 0, get: c => c.v.hrv,  hist: c => c.hist.hrv },
    { id: 'spo2', label: 'Blood oxygen', unit: '%',    dec: 1, get: c => c.v.spo2, hist: c => c.hist.spo2 },
    { id: 'bp',   label: 'Blood pressure', unit: 'mmHg', dec: 0, get: c => c.v.sys, hist: c => c.hist.sys, fmt: c => Math.round(c.v.sys) + '/' + Math.round(c.v.dia), zk: ['sys', 'dia'] },
    { id: 'temp', label: 'Core temp',    unit: '°C',   dec: 1, get: c => c.v.temp, hist: c => c.hist.temp },
    { id: 'resp', label: 'Respiration',  unit: '/min', dec: 0, get: c => c.v.resp, hist: c => c.hist.resp }
  ];

  /* ---------- build static UI ---------- */
  $('tiles').innerHTML = TILES.map(t => `
    <div class="col-6 col-md-4">
      <div class="tile" id="tile-${t.id}">
        <div class="tile-label">${t.label}</div>
        <div class="tile-val"><span id="tv-${t.id}">--</span><small>${t.unit}</small></div>
        <svg class="spark" id="sp-${t.id}" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>
      </div>
    </div>`).join('');

  $('envList').innerHTML = Object.keys(env).map(k => `
    <div class="env-row">
      <div class="env-top"><span>${env[k].label}</span><b><span id="ev-${k}">--</span> ${env[k].unit}</b></div>
      <div class="bar"><i id="eb-${k}" style="width:0"></i></div>
    </div>`).join('');

  /* ---------- charts ---------- */
  const grid = { color: COLORS.grid, drawTicks: false };
  const liveChart = new Chart($('liveChart'), {
    type: 'line',
    data: { labels: Array(HIST).fill(''), datasets: [
      { label: 'Heart rate (bpm)', data: [], borderColor: COLORS.orange, backgroundColor: 'rgba(255,138,76,.1)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
      { label: 'HRV (ms)', data: [], borderColor: COLORS.cyan, tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' }
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } },
      scales: { x: { display: false },
        y:  { position: 'left',  grid, suggestedMin: 50, suggestedMax: 110, title: { display: true, text: 'bpm' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, suggestedMin: 20, suggestedMax: 90, title: { display: true, text: 'ms' } } } }
  });

  const forecastChart = new Chart($('forecastChart'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'upper', data: [], borderColor: 'transparent', backgroundColor: 'rgba(76,201,240,.16)', pointRadius: 0, fill: '+1', tension: .35 },
      { label: 'lower', data: [], borderColor: 'transparent', pointRadius: 0, fill: false, tension: .35 },
      { label: 'Stress risk (%)', data: [], borderColor: COLORS.cyan, borderWidth: 2.5, pointRadius: 2, pointBackgroundColor: COLORS.cyan, tension: .35, fill: false },
      { label: 'Alert threshold', data: [], borderColor: COLORS.crit, borderDash: [6, 5], borderWidth: 1.2, pointRadius: 0, fill: false }
    ] },
    options: { maintainAspectRatio: false,
      plugins: { legend: { labels: { filter: i => i.text === 'Stress risk (%)' || i.text === 'Alert threshold', usePointStyle: true, boxWidth: 8 } } },
      scales: { x: { grid }, y: { min: 0, max: 100, grid, title: { display: true, text: 'risk %' } } } }
  });

  const gaugeChart = new Chart($('gaugeChart'), {
    type: 'doughnut',
    data: { datasets: [{ data: [100, 0], backgroundColor: [COLORS.ok, 'rgba(143,163,201,.15)'], borderWidth: 0, borderRadius: 6 }] },
    options: { rotation: -90, circumference: 180, cutout: '78%', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
  });

  const anomChart = new Chart($('anomChart'), {
    type: 'line',
    data: { labels: Array(HIST).fill(''), datasets: [
      { label: 'score', data: [], borderColor: COLORS.cyan, backgroundColor: 'rgba(76,201,240,.12)', fill: true, tension: .3, pointRadius: 0, borderWidth: 2 },
      { label: 'warn', data: Array(HIST).fill(0.40), borderColor: COLORS.warn, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
      { label: 'crit', data: Array(HIST).fill(0.65), borderColor: COLORS.crit, borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }
    ] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { min: 0, max: 1, grid, ticks: { stepSize: .25 } } } }
  });

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const nowStr = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const lvText = { ok: 'NOMINAL', warn: 'WARNING', crit: 'CRITICAL' };
  const lvColor = l => COLORS[l];

  function spark(svg, data, color) {
    const min = Math.min(...data), max = Math.max(...data), r = (max - min) || 1;
    const pts = data.map((v, i) => (i / (data.length - 1) * 100).toFixed(1) + ',' + (28 - ((v - min) / r) * 26).toFixed(1)).join(' ');
    svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  }

  function addAlert(level, text) {
    const feed = $('alertFeed');
    const first = feed.querySelector('.empty');
    if (first) first.parentElement.remove();
    const tagCls = { info: 'tag-info', ok: 'tag-ok', warn: 'tag-warn', crit: 'tag-crit' }[level];
    const tagTxt = { info: 'INFO', ok: 'OK', warn: 'WARN', crit: 'CRIT' }[level];
    const q = offline ? ' <em class="text-warning">(queued for sync)</em>' : '';
    if (offline) { queued++; $('queueCount').textContent = queued; }
    const el = document.createElement('div');
    el.className = 'fi';
    el.innerHTML = `<time>${nowStr()}</time><div><span class="tag ${tagCls}">${tagTxt}</span>${text}${q}</div>`;
    feed.prepend(el);
    while (feed.children.length > 40) feed.lastChild.remove();
  }

  /* ---------- crew list ---------- */
  function renderCrew() {
    $('crewList').innerHTML = crew.map((c, i) => `
      <div class="crew-item ${i === focus ? 'active' : ''}" data-i="${i}">
        <div class="avatar">${c.name[0]}</div>
        <div class="crew-meta"><b>${c.name}</b><span>${c.role}</span></div>
        <div class="crew-score lv-${c.level}">${vitality(c)}<small>${lvText[c.level]}</small></div>
      </div>`).join('');
  }
  $('crewList').addEventListener('click', e => {
    const it = e.target.closest('.crew-item'); if (!it) return;
    focus = +it.dataset.i;
    document.querySelectorAll('#scenarioBtns .scen').forEach(b => b.classList.toggle('active', b.dataset.s === crew[focus].scenario));
    render(true);
  });

  /* ---------- scenarios ---------- */
  $('scenarioBtns').addEventListener('click', e => {
    const b = e.target.closest('.scen'); if (!b) return;
    const c = crew[focus];
    c.scenario = b.dataset.s;
    document.querySelectorAll('#scenarioBtns .scen').forEach(x => x.classList.toggle('active', x === b));
    const names = { nominal: 'returned to nominal operations', radiation: 'radiation event simulated', fatigue: 'fatigue scenario simulated', cardio: 'cardiovascular stress simulated' };
    addAlert('info', `${c.name}: ${names[c.scenario]}.`);
  });

  /* ---------- comms switch ---------- */
  $('commsSwitch').addEventListener('change', e => {
    offline = !e.target.checked;
    $('blackoutBanner').hidden = !offline;
    $('modeText').textContent = offline ? 'Autonomous (no uplink)' : 'Autonomous';
    $('modeText').className = offline ? 'text-warning' : 'text-ok';
    if (!offline) { addAlert('ok', `Uplink restored. ${queued} event(s) synced to Mission Control.`); queued = 0; $('queueCount').textContent = 0; }
    else addAlert('warn', 'Uplink to Mission Control lost. Running fully on board.');
  });

  /* ---------- protocol modal ---------- */
  const modal = new bootstrap.Modal($('protoModal'));
  function openProtocol(c, cause, level) {
    const p = PROTOCOLS[cause];
    pendingProto = c;
    $('mKicker').textContent = (level === 'crit' ? 'CRITICAL · ' : 'WARNING · ') + c.name.toUpperCase();
    $('mKicker').className = 'modal-kicker' + (level === 'crit' ? '' : ' warn');
    $('mTitle').textContent = p.title;
    $('mWhy').textContent = p.why;
    $('mSteps').innerHTML = p.steps.map((s, i) => `<label class="step"><input type="checkbox" data-i="${i}"><span>${s}</span></label>`).join('');
    modal.show();
  }
  $('mSteps').addEventListener('change', e => { if (e.target.matches('input')) e.target.closest('.step').classList.toggle('done', e.target.checked); });
  $('mDone').addEventListener('click', () => {
    if (pendingProto) addAlert('ok', `${pendingProto.name}: protocol steps marked as completed.`);
    modal.hide();
  });

  /* ---------- render ---------- */
  function render(full) {
    const c = crew[focus];
    $('focusName').textContent = c.name;
    $('focusRole').textContent = c.role;
    const pill = $('focusPill');
    pill.className = 'pill pill-' + c.level;
    pill.innerHTML = `<i class="dot"></i> ${lvText[c.level]}`;

    const z = zscores(c);
    TILES.forEach(t => {
      const zv = t.zk ? Math.max(...t.zk.map(k => z[k])) : z[t.id];
      const st = zv > 3 ? 'crit' : zv > 2 ? 'warn' : 'ok';
      const tile = $('tile-' + t.id);
      tile.className = 'tile' + (st === 'ok' ? '' : ' st-' + st);
      $('tv-' + t.id).textContent = t.fmt ? t.fmt(c) : t.get(c).toFixed(t.dec);
      spark($('sp-' + t.id), t.hist(c), st === 'ok' ? COLORS.cyan : lvColor(st));
    });

    liveChart.data.datasets[0].data = c.hist.hr.slice();
    liveChart.data.datasets[1].data = c.hist.hrv.slice();
    liveChart.update('none');

    anomChart.data.datasets[0].data = c.scoreHist.slice();
    anomChart.data.datasets[0].borderColor = lvColor(c.level === 'ok' ? 'cyan' : c.level);
    anomChart.update('none');

    const vi = vitality(c);
    gaugeChart.data.datasets[0].data = [vi, 100 - vi];
    gaugeChart.data.datasets[0].backgroundColor[0] = lvColor(c.level);
    gaugeChart.update('none');
    $('vitalityNum').textContent = vi;
    $('vitalityLabel').textContent = c.level === 'ok' ? 'Within personal baseline' : c.level === 'warn' ? 'Drifting from personal baseline' : 'Far from personal baseline';

    Object.keys(env).forEach(k => {
      const e = env[k];
      $('ev-' + k).textContent = e.v.toFixed(e.dec);
      const bar = $('eb-' + k);
      bar.style.width = clamp(e.v / e.max * 100, 2, 100) + '%';
      bar.style.background = (k === 'rad' && e.v > e.base * 3) ? COLORS.crit : COLORS.cyan;
    });

    if (full || tickN % 5 === 0) {
      const f = forecast(c);
      forecastChart.data.labels = f.labels;
      forecastChart.data.datasets[0].data = f.hi;
      forecastChart.data.datasets[1].data = f.lo;
      forecastChart.data.datasets[2].data = f.mean;
      forecastChart.data.datasets[3].data = f.labels.map(() => 65);
      forecastChart.update('none');
      const peak = Math.max(...f.mean);
      $('forecastNote').textContent = peak >= 65
        ? `Risk is projected to cross the alert threshold within 48 h (peak ${peak.toFixed(0)}%). Early action recommended.`
        : `Projected stress risk stays below the alert threshold (peak ${peak.toFixed(0)}%).`;
    }
    renderCrew();
  }

  /* ---------- main loop (1 Hz) ---------- */
  function tick() {
    tickN++;
    metSec++;
    const d = Math.floor(metSec / 86400), h = Math.floor(metSec % 86400 / 3600), m = Math.floor(metSec % 3600 / 60), s = metSec % 60;
    $('met').textContent = `D+${d} ${pad(h)}:${pad(m)}:${pad(s)}`;

    const radiationOn = crew.some(c => c.scenario === 'radiation');
    stepEnv(env, radiationOn);

    crew.forEach((c, i) => {
      const ch = stepCrew(c);
      if (!ch) return;
      if (ch.to === 'warn' || ch.to === 'crit') {
        const cause = classify(c, env);
        const label = { radiation: 'radiation exposure pattern', cardio: 'cardiovascular stress pattern', fatigue: 'fatigue pattern' }[cause];
        addAlert(ch.to, `${c.name}: ${label} detected (score ${(c.score * 100).toFixed(0)}%). Protocol ready.`);
        const modalOpen = !!document.querySelector('.modal.show');
        if (i === focus && (ch.to === 'crit' || !c.episode) && (!modalOpen || pendingProto === c)) {
          c.episode = true;
          openProtocol(c, cause, ch.to);
        }
      } else if (ch.to === 'ok') {
        c.episode = false;
        addAlert('ok', `${c.name}: vitals back within personal baseline.`);
      }
    });

    const sysPill = $('sysPill');
    const worst = crew.some(c => c.level === 'crit') ? 'crit' : crew.some(c => c.level === 'warn') ? 'warn' : 'ok';
    sysPill.className = 'pill pill-' + worst;
    sysPill.innerHTML = `<i class="dot"></i> ${worst === 'ok' ? 'ON-BOARD AI ACTIVE' : worst === 'warn' ? 'ATTENTION NEEDED' : 'CRITICAL ALERT'}`;

    render(false);
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  addAlert('info', 'AstraGuard AI started. Learning personal baselines for 4 crew members.');
  render(true);
  setInterval(tick, 1000);
})();
