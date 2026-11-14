/* VitalOrbit — app logic (DOM + live simulation + charts + alerts + chatbot).
   Data and pure rules live in data.js (VITALORBIT). All values are SIMULATED. */
'use strict';

const V = VITALORBIT;

/* ---------- Mission clock ---------- */
// Mission day starts at 16:45 on Sol 142 and ticks in real time.
const CLOCK_START_MINUTES = 16 * 60 + 45; // 16:45
const CLOCK_START_SECONDS = CLOCK_START_MINUTES * 60;
const BOOT_REAL = Date.now();
const MISSION_SOL = 142;
const MISSION_DAY_BASE = 141; // full days elapsed

function missionDaySeconds() {
  return CLOCK_START_SECONDS + Math.floor((Date.now() - BOOT_REAL) / 1000);
}
function missionDayMinutes() { return missionDaySeconds() / 60; }
function missionDayFraction() { return (missionDaySeconds() % 86400) / 86400; }
function fmtClock(totalSeconds) {
  const s = totalSeconds % 86400;
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h + ':' + m + ':' + sec;
}
function fmtDayTime(totalSeconds) {
  const s = totalSeconds % 86400;
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return h + ':' + m;
}

/* ---------- State ---------- */
let selectedCrewId = 'okafor'; // open on the astronaut with active alerts, so judges see the engine working
let envId = 'iss';
let alertLogEntries = []; // {time, text, kind}
const knownAlertKeys = new Set(); // to log only newly-appearing alerts
let charts = {};
let lastTickAt = null;

const $ = (id) => document.getElementById(id);
const crewById = (id) => V.CREW.find((c) => c.id === id);
const env = () => V.ENVIRONMENTS[envId];

function statusWord(s) { return s === 'green' ? 'In range' : s === 'amber' ? 'Watch' : 'Alert'; }

function crewOverallStatus(crew) {
  const e = env();
  const frac = missionDayFraction();
  const v = crew.vitals;
  const radToday = e.doseRate * frac;
  return V.worstStatus([
    V.vitalStatus('hr', v.hr),
    V.vitalStatus('spo2', v.spo2),
    V.vitalStatus('sleep', v.sleep),
    V.vitalStatus('stress', v.stress),
    V.vitalStatus('exercise', v.exercise),
    V.vitalStatus('radDay', radToday, e),
  ]);
}

function radTodayFor() { return env().doseRate * missionDayFraction(); }

/* ---------- Clock ---------- */
function tickClock() {
  const secs = missionDaySeconds();
  $('mission-clock').textContent =
    'SOL ' + MISSION_SOL + ' · ' + MISSION_DAY_BASE + 'd ' + fmtClock(secs);
  renderTimeline();
}

/* ---------- Environment ---------- */
function renderEnvButtons() {
  const box = $('env-buttons');
  box.innerHTML = '';
  Object.values(V.ENVIRONMENTS).forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'env-btn' + (e.id === envId ? ' active' : '');
    b.textContent = e.label;
    b.setAttribute('aria-pressed', e.id === envId ? 'true' : 'false');
    b.addEventListener('click', () => {
      envId = e.id;
      renderEnvButtons();
      renderEnvPanel();
      renderCrewCards();
      renderVitals();
      renderAlerts();
      renderHazards();
      rebuildRadChart();
      updateChartTodayPoints();
    });
    box.appendChild(b);
  });
}

function renderEnvPanel() {
  const e = env();
  $('env-title').textContent = e.label;
  $('env-gravity').textContent = 'Gravity: ' + e.gravity + ' · Comms delay: ' + e.commDelay;
  $('env-context').textContent = e.context;
  $('env-countermeasures').textContent = e.countermeasures;
  $('env-dose-rate').textContent = e.doseRate.toFixed(1) + ' mSv/day';
  $('env-dose-budget').textContent = e.radAlertThreshold.toFixed(2) + ' mSv/day';
  $('env-line').textContent =
    'Environment: ' + e.label + ' · Gravity: ' + e.gravity + ' · Comms: ' + e.commDelay;
  $('rad-chart-note').textContent =
    'Daily dose vs ' + e.label + ' action level (' + e.radAlertThreshold.toFixed(2) + ' mSv/day)';
}

/* ---------- Crew cards ---------- */
function renderCrewCards() {
  const grid = $('crew-grid');
  grid.innerHTML = '';
  const radToday = radTodayFor();
  V.CREW.forEach((crew) => {
    const st = crewOverallStatus(crew);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'crew-card' + (crew.id === selectedCrewId ? ' selected' : '');
    card.setAttribute('aria-pressed', crew.id === selectedCrewId ? 'true' : 'false');
    card.innerHTML =
      '<span class="card-top"><span class="avatar" aria-hidden="true">' + crew.initials + '</span>' +
      '<span><span class="name">' + crew.name + '</span><br><span class="role">' + crew.role + '</span></span></span>' +
      '<span class="status-line"><span class="dot ' + st + '"></span>' +
      (st === 'green' ? 'All vitals in range' : st === 'amber' ? 'Needs attention' : 'Needs urgent attention') +
      ' <span class="badge ' + st + '">' + statusWord(st) + '</span></span>' +
      '<span class="mini-vitals">' +
      '<span>HR <b>' + crew.vitals.hr + ' bpm</b></span><span>SpO2 <b>' + crew.vitals.spo2 + '%</b></span>' +
      '<span>Sleep <b>' + crew.vitals.sleep.toFixed(1) + ' h</b></span><span>Rad today <b>' + radToday.toFixed(2) + ' mSv</b></span>' +
      '</span>';
    card.addEventListener('click', () => {
      selectedCrewId = crew.id;
      renderCrewCards();
      renderVitals();
      updateChartsForCrew();
    });
    grid.appendChild(card);
  });
}

/* ---------- Vitals detail ---------- */
function rangeBarHTML(cfg) {
  const pct = (x) => Math.max(0, Math.min(100, ((x - cfg.min) / (cfg.max - cfg.min)) * 100));
  return '<span class="range-bar"><span class="safe-zone" style="left:' + pct(cfg.safeLow) + '%;width:' +
    Math.max(0, pct(cfg.safeHigh) - pct(cfg.safeLow)) + '%;"></span>' +
    '<span class="marker" style="left:calc(' + pct(cfg.value) + '% - 1px);"></span></span>';
}

function vitalTileHTML(label, valueText, rangeText, subText, status, barCfg) {
  return '<div class="vital-tile ' + status + '">' +
    '<div class="v-label"><span>' + label + '</span><span class="badge ' + status + '">' + statusWord(status) + '</span></div>' +
    '<div class="v-value">' + valueText + '</div>' +
    '<div class="v-range">' + rangeText + '</div>' +
    (barCfg ? rangeBarHTML(barCfg) : '') +
    (subText ? '<div class="v-sub">' + subText + '</div>' : '') +
    '</div>';
}

function renderVitals() {
  const crew = crewById(selectedCrewId);
  const e = env();
  const v = crew.vitals;
  const radToday = radTodayFor();
  const overall = crewOverallStatus(crew);

  $('detail-name').textContent = crew.name + ' — ' + crew.role;
  $('detail-status').innerHTML = '<span class="badge ' + overall + '">Overall: ' + statusWord(overall) + '</span>';
  $('last-updated').textContent = lastTickAt || ('Sol ' + MISSION_SOL + ' ' + fmtDayTime(missionDaySeconds()));

  const tiles = [];
  tiles.push(vitalTileHTML('Heart rate', v.hr + ' <small>bpm</small>', 'Safe range 60–100 bpm', 'Resting',
    V.vitalStatus('hr', v.hr), { min: 40, max: 120, safeLow: 60, safeHigh: 100, value: v.hr }));
  tiles.push(vitalTileHTML('Blood oxygen (SpO2)', v.spo2 + ' <small>%</small>', 'Safe range 95–100%', 'Blood oxygen saturation',
    V.vitalStatus('spo2', v.spo2), { min: 85, max: 100, safeLow: 95, safeHigh: 100, value: v.spo2 }));
  tiles.push(vitalTileHTML('Sleep (last night)', v.sleep.toFixed(1) + ' <small>h</small>', 'Target 7–9 h', 'Last night',
    V.vitalStatus('sleep', v.sleep), { min: 0, max: 12, safeLow: 7, safeHigh: 9, value: v.sleep }));
  tiles.push(vitalTileHTML('Stress score', v.stress.toFixed(1) + ' <small>/ 10</small>', 'Target 5 or below', 'Self-reported, higher = worse',
    V.vitalStatus('stress', v.stress), { min: 0, max: 10, safeLow: 0, safeHigh: 5, value: v.stress }));
  tiles.push(vitalTileHTML('Exercise today', v.exercise + ' <small>min</small>', 'Target 120 min/day', 'Resistive + aerobic',
    V.vitalStatus('exercise', v.exercise), { min: 0, max: 150, safeLow: 90, safeHigh: 150, value: v.exercise }));
  tiles.push(vitalTileHTML('Radiation dose', radToday.toFixed(2) + ' <small>mSv today</small>',
    'Daily action level ' + e.radAlertThreshold.toFixed(2) + ' mSv (' + e.label + ')',
    'Cumulative mission dose ' + v.radCumulative.toFixed(1) + ' mSv · career limit 600 mSv',
    V.vitalStatus('radDay', radToday, e),
    { min: 0, max: e.radAlertThreshold * 1.5, safeLow: 0, safeHigh: e.radAlertThreshold, value: radToday }));

  $('vital-grid').innerHTML = tiles.join('');
  $('crew-note').textContent = crew.note;
}

/* ---------- Charts ---------- */
const CHART_COLORS = { line: '#4da3ff', band: 'rgba(47, 191, 113, 0.18)', grid: 'rgba(143, 163, 184, 0.15)', tick: '#8fa3b8' };

function bandDatasets(low, high, labels) {
  const n = labels.length;
  return [
    { label: 'Safe high', data: Array(n).fill(high), borderColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 0 },
    { label: 'Safe low', data: Array(n).fill(low), borderColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 0, fill: '-1', backgroundColor: CHART_COLORS.band },
  ];
}

function makeChart(canvasId, low, high, data, yMin, yMax, yLabel) {
  const ctx = $(canvasId).getContext('2d');
  const datasets = bandDatasets(low, high, V.DAYS);
  datasets.push({
    label: yLabel, data: data.slice(),
    borderColor: CHART_COLORS.line, backgroundColor: CHART_COLORS.line,
    tension: 0.25, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#fff',
  });
  return new Chart(ctx, {
    type: 'line',
    data: { labels: V.DAYS.slice(), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false, // deterministic rendering: no mid-animation frames in screenshots
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.tick, font: { size: 10 } } },
        y: { min: yMin, max: yMax, grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.tick, font: { size: 10 } } },
      },
    },
  });
}

function buildCharts() {
  if (typeof Chart === 'undefined') return;
  const crew = crewById(selectedCrewId);
  const e = env();
  charts.hr = makeChart('chart-hr', 60, 100, crew.history.hr, 50, 115, 'Heart rate (bpm)');
  charts.spo2 = makeChart('chart-spo2', 95, 100, crew.history.spo2, 90, 100, 'SpO2 (%)');
  charts.sleep = makeChart('chart-sleep', 7, 9, crew.history.sleep, 4, 10, 'Sleep (h)');
  charts.rad = makeChart('chart-rad', 0, e.radAlertThreshold, crew.history.radDay, 0, Math.max(2, e.radAlertThreshold * 1.4), 'Radiation (mSv/day)');
}

function updateChartsForCrew() {
  if (!charts.hr || !charts.spo2 || !charts.sleep || !charts.rad) return; // charts unavailable (see init fallback)
  const crew = crewById(selectedCrewId);
  const set = (chart, data) => {
    const ds = chart.data.datasets[chart.data.datasets.length - 1];
    ds.data = data.slice();
    chart.update();
  };
  set(charts.hr, crew.history.hr);
  set(charts.spo2, crew.history.spo2);
  set(charts.sleep, crew.history.sleep);
  set(charts.rad, crew.history.radDay);
}

function rebuildRadChart() {
  if (typeof Chart === 'undefined') return;
  const e = env();
  if (charts.rad) {
    charts.rad.destroy();
    // Belt and braces: make sure no pixel of the old chart survives on the canvas.
    const canvas = $('chart-rad');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }
  charts.rad = makeChart('chart-rad', 0, e.radAlertThreshold, crewById(selectedCrewId).history.radDay,
    0, Math.max(2, e.radAlertThreshold * 1.4), 'Radiation (mSv/day)');
}

function updateChartTodayPoints() {
  // Keep the "today" (last) point of the live charts in sync with the simulated feed.
  const crew = crewById(selectedCrewId);
  const setLast = (chart, value) => {
    const ds = chart.data.datasets[chart.data.datasets.length - 1];
    ds.data[ds.data.length - 1] = value;
    chart.update('none');
  };
  if (charts.hr) setLast(charts.hr, crew.vitals.hr);
  if (charts.spo2) setLast(charts.spo2, crew.vitals.spo2);
  if (charts.rad) setLast(charts.rad, +radTodayFor().toFixed(2));
}

/* ---------- Alerts ---------- */
function logAlert(text, kind) {
  alertLogEntries.unshift({ time: 'Sol ' + MISSION_SOL + ' ' + fmtDayTime(missionDaySeconds()), text, kind });
  if (alertLogEntries.length > 12) alertLogEntries.length = 12;
  renderAlertLog();
}

function renderAlertLog() {
  const ul = $('alert-log');
  if (!alertLogEntries.length) {
    ul.innerHTML = '<li>No alerts logged yet this session.</li>';
    return;
  }
  ul.innerHTML = alertLogEntries.map((en) =>
    '<li><time>' + en.time + '</time> — ' + en.text + '</li>').join('');
}

function renderAlerts() {
  const frac = missionDayFraction();
  const all = [];
  V.CREW.forEach((crew) => {
    V.evaluateAlerts(crew, env(), frac).forEach((a) => all.push({ crew, alert: a }));
  });

  // Log newly-appearing alerts (and note cleared ones) — once per alert key.
  const currentKeys = new Set(all.map((x) => x.crew.id + ':' + x.alert.code));
  currentKeys.forEach((key) => {
    if (!knownAlertKeys.has(key)) {
      knownAlertKeys.add(key);
      const item = all.find((x) => (x.crew.id + ':' + x.alert.code) === key);
      logAlert('ALERT raised — ' + item.crew.name + ': ' + item.alert.title + ' (' + item.alert.severity + ')', 'raised');
    }
  });
  [...knownAlertKeys].forEach((key) => {
    if (!currentKeys.has(key)) {
      knownAlertKeys.delete(key);
      const [crewId, code] = key.split(':');
      logAlert('ALERT cleared — ' + crewById(crewId).name + ': ' + code, 'cleared');
    }
  });

  const list = $('alerts-list');
  if (!all.length) {
    list.innerHTML = '<p class="all-clear">All clear — no active alerts across the crew.</p>';
    return;
  }
  // Red first, then amber.
  all.sort((a, b) => (a.alert.severity === 'red' ? 0 : 1) - (b.alert.severity === 'red' ? 0 : 1));
  list.innerHTML = all.map((x) =>
    '<div class="alert-item ' + x.alert.severity + '">' +
    '<div class="a-top"><span class="badge ' + x.alert.severity + '">' + x.alert.severity.toUpperCase() + '</span>' +
    '<span class="a-title">' + x.alert.title + ' — ' + x.crew.name + '</span></div>' +
    '<div class="a-detail">' + x.alert.detail + '</div>' +
    '<div class="a-action"><b>Recommended action:</b> ' + x.alert.action + '</div>' +
    '</div>').join('');
}

/* ---------- Hazards ---------- */
function renderHazards() {
  const grid = $('hazard-grid');
  grid.innerHTML = '';
  V.HAZARDS.forEach((h) => {
    const crew = crewById(selectedCrewId);
    const risk = h.riskFn(crew, env());
    const card = document.createElement('div');
    card.className = 'hazard-card';
    card.innerHTML =
      '<div class="h-top"><span class="h-icon" aria-hidden="true">' + h.icon + '</span><h3>' + h.name + '</h3></div>' +
      '<p>' + h.blurb + '</p>' +
      '<p style="margin-top:8px;"><span class="badge ' + risk + '">Risk: ' + statusWord(risk) + '</span></p>' +
      '<p class="h-vitals"><b>Watched via:</b> ' + h.vitals.join(' · ') + '</p>' +
      '<p class="h-cm"><b>Countermeasure tracked:</b> ' + h.countermeasure + '</p>';
    grid.appendChild(card);
  });
}

/* ---------- Timeline ---------- */
function timelineState(item) {
  if (item.done) return 'done';
  const [h, m] = item.time.split(':').map(Number);
  const nowMin = missionDayMinutes() % 1440;
  return (h * 60 + m) < nowMin ? 'overdue' : 'upcoming';
}

function renderTimeline() {
  const ul = $('timeline');
  ul.innerHTML = '';
  V.TIMELINE.forEach((item) => {
    const state = timelineState(item);
    const li = document.createElement('li');
    li.className = state;
    const badge = state === 'done'
      ? '<span class="badge green">Done</span>'
      : state === 'overdue'
        ? '<span class="badge amber">Overdue</span>'
        : '<span class="badge grey">Upcoming</span>';
    li.innerHTML = '<span class="t-time">' + item.time + '</span>' +
      '<span class="t-body"><span class="t-title">' + item.title + '</span><br>' +
      '<span class="t-detail">' + item.detail + '</span></span>' +
      '<span class="t-state">' + badge + '</span>';
    li.addEventListener('click', () => {
      item.done = !item.done;
      renderTimeline();
    });
    ul.appendChild(li);
  });
}

/* ---------- Chatbot ---------- */
function addChatMessage(text, who, learn) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + who;
  div.textContent = text;
  if (learn) {
    const span = document.createElement('span');
    span.className = 'learn';
    span.innerHTML = '<b>Learn:</b> ' + learn;
    div.appendChild(span);
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function askChatbot(question) {
  const q = question.trim();
  if (!q) return;
  addChatMessage(q, 'user');
  const ans = V.answerChatbot(q);
  addChatMessage(ans.a, 'bot', ans.learn);
}

function initChatbot() {
  addChatMessage('Hello — I am the VitalOrbit health assistant. Ask me about heart rate, sleep, exercise, radiation, or any crew health topic. I give general information only, never a diagnosis.', 'bot',
    'Built from NASA Human Research Program material on the five hazards of human spaceflight.');
  const chips = $('chat-chips');
  const picks = [
    'Why is my heart rate high in space?',
    'How much exercise do I need?',
    'How do I sleep better in microgravity?',
    'What is my radiation dose today?',
    'Why do astronauts lose bone in space?',
    'I feel isolated. What helps?',
    'What if my blood oxygen is low?',
    'I feel unwell — what do I do?',
  ];
  picks.forEach((q) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = q;
    b.addEventListener('click', () => askChatbot(q));
    chips.appendChild(b);
  });
  $('chat-send').addEventListener('click', () => {
    askChatbot($('chat-input').value);
    $('chat-input').value = '';
  });
  $('chat-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      askChatbot($('chat-input').value);
      $('chat-input').value = '';
    }
  });
}

/* ---------- Sources ---------- */
function renderSources() {
  $('sources-list').innerHTML = V.SOURCES.map((s) =>
    '<li><a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a></li>').join('');
}

/* ---------- Live simulation tick (every 3 s) ---------- */
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function liveTick() {
  const e = env();
  const frac = missionDayFraction();
  V.CREW.forEach((crew) => {
    const v = crew.vitals;
    // Heart rate: gentle random walk; Okafor stays elevated by design.
    const base = crew.id === 'okafor' ? 104 : { reyes: 62, chen: 68, novak: 71 }[crew.id];
    v.hr = clamp(Math.round(v.hr + (Math.random() * 2 - 1) * 2 + (base - v.hr) * 0.15), 55, 115);
    // SpO2: small walk, integer.
    v.spo2 = clamp(Math.round(v.spo2 + (Math.random() * 2 - 1) * 0.6), 93, 100);
    // Stress: slow walk.
    v.stress = clamp(+(v.stress + (Math.random() * 2 - 1) * 0.15).toFixed(1), 1, 10);
    // Exercise: a minute here and there as the day goes on.
    if (Math.random() < 0.4) v.exercise = Math.min(150, v.exercise + 1);
    // Cumulative radiation grows with the environment dose rate.
    v.radCumulative = +(v.radCumulative + (e.doseRate * 3) / 86400).toFixed(3);
    // High-HR streak tracking for the alert rule.
    if (v.hr > 100) crew.highHrStreak = (crew.highHrStreak || 0) + 1;
    else crew.highHrStreak = 0;
    // Keep today's history point in step with the live value.
    crew.history.hr[crew.history.hr.length - 1] = v.hr;
    crew.history.spo2[crew.history.spo2.length - 1] = v.spo2;
    crew.history.radDay[crew.history.radDay.length - 1] = +radTodayFor().toFixed(2);
  });
  lastTickAt = 'Sol ' + MISSION_SOL + ' ' + fmtDayTime(missionDaySeconds());
  renderCrewCards();
  renderVitals();
  renderAlerts();
  renderHazards();
  updateChartTodayPoints();
}

/* ---------- Init ---------- */
function showChartsFallback() {
  document.querySelectorAll('.chart-box').forEach((box) => {
    box.insertAdjacentHTML('beforeend',
      '<p style="color:var(--amber);font-size:0.85rem;">Charts could not load (Chart.js failed to load). The rest of the dashboard works offline.</p>');
  });
}

// Chart.js is vendored locally (vendor/chart.umd.js); fall back to the CDN if it fails.
function ensureCharts(done) {
  if (typeof Chart !== 'undefined') return done(true);
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
  s.onload = () => done(typeof Chart !== 'undefined');
  s.onerror = () => done(false);
  document.head.appendChild(s);
}

function init() {
  renderEnvButtons();
  renderEnvPanel();
  renderCrewCards();
  renderVitals();
  renderAlerts();
  renderHazards();
  renderTimeline();
  renderSources();
  initChatbot();
  tickClock();
  ensureCharts((ok) => { if (ok) buildCharts(); else showChartsFallback(); });
  setInterval(tickClock, 1000);
  setInterval(liveTick, 3000);
  lastTickAt = 'Sol ' + MISSION_SOL + ' ' + fmtDayTime(missionDaySeconds());
  $('last-updated').textContent = lastTickAt;
}

document.addEventListener('DOMContentLoaded', init);
