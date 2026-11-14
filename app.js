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
const MISSION_DAY_BASE = 141; // full days elapsed at boot
const DAY_SECONDS = 86400;

/* Mission time is one continuous count of seconds since the start of the
   boot day. Sol and elapsed days are DERIVED from it, so when the clock
   runs past midnight the day-of-month values roll over too (the earlier
   version displayed MISSION_SOL / MISSION_DAY_BASE constants forever, so
   Sol and elapsed days never advanced even though the time of day did).

   Timebase note: one Earth-referenced 24 h day is used for every
   environment, including the Mars surface, so the clock, timeline,
   exercise sessions and charts always agree with each other. A true Mars
   sol is 24 h 39 m; that distinction is documented here, not modelled,
   because mixing two day lengths would desynchronise the schedule. */
function missionDaySeconds() {
  return CLOCK_START_SECONDS + Math.floor((Date.now() - BOOT_REAL) / 1000);
}
function daysSinceBootDay() { return Math.floor(missionDaySeconds() / DAY_SECONDS); }
function currentSol() { return MISSION_SOL + daysSinceBootDay(); }
function missionElapsedDays() { return MISSION_DAY_BASE + daysSinceBootDay(); }
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
let scenarioId = 'nominal'; // Scenario Simulator state: 'nominal' | 'spe' | 'co2'
// Baseline SpO2 per crew member, captured at load, so a CO2 drift can recover.
V.CREW.forEach((c) => { c._nominalSpo2 = c.vitals.spo2; });
// Canonical 7-day radiation history, stored in unit terms (days of ISS-rate
// exposure). The displayed history for an environment is derived from this
// (base x environment dose rate), so switching environments back and forth
// can never compound rounding and drift the chart: ISS -> Mars -> ISS
// returns the exact original values.
V.CREW.forEach((c) => {
  c.history.radDayBase = c.history.radDay.map((x) => +(x / V.ENVIRONMENTS.iss.doseRate).toFixed(4));
});

/* ---------- Scenario recovery ----------
   Leaving the CO2 scenario does NOT snap vitals back. An explicit recovery
   state runs for RECOVERY_TICKS live ticks, interpolating heart rate, SpO2
   and cabin CO2 linearly from the drifted values back to the exact
   pre-scenario snapshot; the UI labels it while it runs. On completion the
   values equal the snapshot exactly (deterministic, no random-walk luck). */
const RECOVERY_TICKS = 10;
let recovery = null; // { ticksLeft, totalTicks, crew: {id: {...}}, cabinFrom }

/* ---------- Cabin environment (simulated) ---------- */
let cabin = Object.assign({}, V.CABIN.baseline);
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
  const v = crew.vitals;
  const radToday = radTodayFor(crew);
  return V.worstStatus([
    V.vitalStatus('hr', v.hr),
    V.vitalStatus('spo2', v.spo2),
    V.vitalStatus('sleep', v.sleep),
    V.vitalStatus('stress', v.stress),
    V.vitalStatus('exercise', v.exercise),
    V.vitalStatus('radDay', radToday, e),
  ]);
}

/* Effective dose rate: environment rate scaled by the active scenario
   (a solar particle event multiplies it). */
function effectiveDoseRate() { return env().doseRate * V.SCENARIOS[scenarioId].doseMultiplier; }

/* Today's radiation dose for ONE crew member: exposure is per-crew, because
   EVA work and time in shielded modules differ (crew.radFactor). */
function radTodayFor(crew) {
  return effectiveDoseRate() * missionDayFraction() * (crew.radFactor || 1);
}

/* ---------- Clock ---------- */
let lastTimelineMinute = -1; // timeline re-renders only when the minute flips
function tickClock() {
  const secs = missionDaySeconds();
  $('mission-clock').textContent =
    'SOL ' + currentSol() + ' · ' + missionElapsedDays() + 'd ' + fmtClock(secs);
  const minute = Math.floor(secs / 60);
  if (minute !== lastTimelineMinute) {
    lastTimelineMinute = minute;
    renderTimeline();
  }
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
      if (e.id === envId) return;
      envId = e.id;
      // Re-derive the 7-day radiation history from the canonical base (unit
      // days of ISS-rate exposure) at the new environment's dose rate, and
      // set today's point to the live per-crew dose. Derivation is exact,
      // so switching back restores the original history bit for bit.
      V.CREW.forEach((c) => {
        c.history.radDay = c.history.radDayBase.map((b, i) =>
          i === c.history.radDayBase.length - 1 ? +radTodayFor(c).toFixed(2) : +(b * e.doseRate).toFixed(2));
      });
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
  $('env-dose-rate').textContent = effectiveDoseRate().toFixed(1) + ' mSv/day' +
    (scenarioId !== 'nominal' ? ' (scenario simulation: ' + V.SCENARIOS[scenarioId].label + ')' : '');
  $('env-dose-budget').textContent = e.radAlertThreshold.toFixed(2) + ' mSv/day';
  $('env-line').textContent =
    'Environment: ' + e.label + ' · Gravity: ' + e.gravity + ' · Comms: ' + e.commDelay;
  $('rad-chart-note').textContent =
    'Daily dose vs ' + e.label + ' action level (' + e.radAlertThreshold.toFixed(2) + ' mSv/day)';
}

/* ---------- Scenario Simulator ---------- */
function renderScenarioButtons() {
  const box = $('scenario-buttons');
  if (!box) return;
  box.innerHTML = '';
  Object.values(V.SCENARIOS).forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'env-btn' + (s.id === scenarioId ? ' active' : '') + (s.id !== 'nominal' ? ' danger' : '');
    b.textContent = s.label;
    b.setAttribute('aria-pressed', s.id === scenarioId ? 'true' : 'false');
    b.addEventListener('click', () => setScenario(s.id));
    box.appendChild(b);
  });
}

function renderScenarioStatus() {
  const el = $('scenario-status');
  if (!el) return;
  if (recovery) {
    const pct = Math.round((1 - recovery.ticksLeft / recovery.totalTicks) * 100);
    el.textContent = 'Recovery in progress: crew vitals and cabin air returning to baseline (' + pct + '%)';
    el.hidden = false;
  } else if (scenarioId !== 'nominal') {
    el.textContent = 'Scenario active: ' + V.SCENARIOS[scenarioId].label + ' (simulation)';
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

/* Begin the deterministic recovery from a CO2 drift: snapshot where each
   crew member is now and where their pre-scenario baseline is. */
function startRecovery() {
  const crewState = {};
  V.CREW.forEach((c) => {
    const base = c._co2Base || { spo2: c._nominalSpo2, hr: c.vitals.hr, streak: c.highHrStreak || 0 };
    crewState[c.id] = {
      fromSpo2: c.vitals.spo2, fromHr: c.vitals.hr,
      toSpo2: base.spo2, toHr: base.hr, streak: base.streak,
    };
  });
  recovery = { ticksLeft: RECOVERY_TICKS, totalTicks: RECOVERY_TICKS, crew: crewState, cabinFrom: cabin.co2Ppm };
}

function setScenario(id) {
  if (id === scenarioId && !recovery) return;
  const leavingCo2 = scenarioId === 'co2' && id !== 'co2';
  if (id === 'co2') {
    // Snapshot the true baselines first. If a recovery is mid-flight, the
    // baseline is the recovery TARGET, not the half-recovered value.
    V.CREW.forEach((c) => {
      const target = recovery && recovery.crew[c.id] ? recovery.crew[c.id] : null;
      c._co2Base = {
        spo2: target ? target.toSpo2 : c.vitals.spo2,
        hr: target ? target.toHr : c.vitals.hr,
        streak: target ? target.streak : (c.highHrStreak || 0),
      };
      // Immediate nudge so the drift is visible at once; liveTick keeps it
      // drifting while the scenario stays active.
      c.vitals.spo2 = clamp(c.vitals.spo2 - 2, 91, 100);
      c.vitals.hr = clamp(c.vitals.hr + 4, 55, 118);
      if (c.vitals.hr > 100) c.highHrStreak = (c.highHrStreak || 0) + 2;
    });
    recovery = null;
  } else if (leavingCo2) {
    startRecovery();
  }
  // Switching between non-CO2 scenarios mid-recovery: recovery continues.
  scenarioId = id;
  renderScenarioButtons();
  renderScenarioStatus();
  logAlert('Scenario set: ' + V.SCENARIOS[id].label +
    (leavingCo2 ? ' (recovery in progress: returning to baseline)' :
      id === 'nominal' ? ' (baseline restored)' : ' (scenario simulation)'), 'scenario');
  renderEnvPanel();
  renderCrewCards();
  renderVitals();
  renderAlerts();
  renderHazards();
  renderCabin();
  updateChartTodayPoints();
}

/* ---------- Crew cards ---------- */
function renderCrewCards() {
  const grid = $('crew-grid');
  grid.innerHTML = '';
  V.CREW.forEach((crew) => {
    const radToday = radTodayFor(crew);
    crew.vitals.radDayToday = radToday;
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
      '<span>Sleep <b>' + crew.vitals.sleep.toFixed(1) + ' h</b></span><span>Rad today <b>' + radToday.toFixed(2) + '&nbsp;mSv</b></span>' +
      '</span>';
    card.addEventListener('click', () => {
      selectedCrewId = crew.id;
      renderCrewCards();
      renderVitals();
      renderHazards(); // hazard risk is shown for the selected astronaut
      renderTimeline(); // timeline session lines are for the selected astronaut
      updateChartsForCrew();
    });
    grid.appendChild(card);
  });
}

/* ---------- Vitals detail ---------- */
/* Range bar: a track with safe (green), watch (amber) and alert (red) zones
   plus a marker for the current value. The track clips the zones; the
   marker is a SIBLING of the track, centred with a transform, so it is
   never clipped at the extremes and sits exactly on the value. Zone bounds
   come from the same thresholds the alert engine uses, so the bar and the
   alerts can never disagree. */
function rangeBarHTML(cfg) {
  const pct = (x) => Math.max(0, Math.min(100, ((x - cfg.min) / (cfg.max - cfg.min)) * 100));
  const zone = (a, b, cls) =>
    '<span class="zone ' + cls + '" style="left:' + pct(a) + '%;width:' + Math.max(0, pct(b) - pct(a)) + '%;"></span>';
  let zones = '';
  (cfg.red || []).forEach(([a, b]) => { zones += zone(a, b, 'red'); });
  (cfg.amber || []).forEach(([a, b]) => { zones += zone(a, b, 'amber'); });
  zones += zone(cfg.safeLow, cfg.safeHigh, 'safe');
  const markerPct = Math.max(1, Math.min(99, pct(cfg.value)));
  return '<span class="range-bar"><span class="range-track">' + zones + '</span>' +
    '<span class="marker" style="left:' + markerPct + '%;"></span></span>';
}

function fmtMinOfDay(minutes) {
  const m = Math.round(minutes) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/* Exercise tile sub-line: the live session state for the selected crew
   member, so the tile, the timeline and the session model always agree. */
function exerciseSubText(crew) {
  const states = V.exerciseSessionStates(crew, missionDayMinutes() % 1440);
  const active = states.find((s) => s.state === 'active');
  if (active) return 'In session now: ' + active.session.name + ' (ends ' + fmtMinOfDay(active.session.end) + ')';
  const next = states.find((s) => s.state === 'scheduled');
  if (next) return 'Rest period · next session ' + fmtMinOfDay(next.session.start) + ': ' + next.session.name;
  return 'All sessions complete for today';
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
  const radToday = radTodayFor(crew);
  crew.vitals.radDayToday = radToday;
  const overall = crewOverallStatus(crew);

  $('detail-name').textContent = crew.name + ' · ' + crew.role;
  $('detail-status').innerHTML = '<span class="badge ' + overall + '">Overall: ' + statusWord(overall) + '</span>';
  $('last-updated').textContent = lastTickAt || ('Sol ' + currentSol() + ' ' + fmtDayTime(missionDaySeconds()));

  const tiles = [];
  tiles.push(vitalTileHTML('Heart rate', v.hr + ' <small>bpm</small>', 'Safe range 60–100 bpm', 'Resting',
    V.vitalStatus('hr', v.hr),
    { min: 40, max: 120, safeLow: 60, safeHigh: 100, value: v.hr, amber: [[50, 60], [100, 110]], red: [[40, 50], [110, 120]] }));
  tiles.push(vitalTileHTML('Blood oxygen (SpO2)', v.spo2 + ' <small>%</small>', 'Safe range 95–100%', 'Blood oxygen saturation',
    V.vitalStatus('spo2', v.spo2),
    { min: 85, max: 100, safeLow: 95, safeHigh: 100, value: v.spo2, amber: [[94, 95]], red: [[85, 94]] }));
  tiles.push(vitalTileHTML('Sleep (last night)', v.sleep.toFixed(1) + ' <small>h</small>', 'Target 7–9 h', 'Last night',
    V.vitalStatus('sleep', v.sleep),
    { min: 0, max: 12, safeLow: 7, safeHigh: 9, value: v.sleep, amber: [[5, 7], [9, 12]], red: [[0, 5]] }));
  tiles.push(vitalTileHTML('Stress score', v.stress.toFixed(1) + ' <small>/ 10</small>', 'Target 5 or below', 'Self-reported, higher = worse',
    V.vitalStatus('stress', v.stress),
    { min: 0, max: 10, safeLow: 0, safeHigh: 5, value: v.stress, amber: [[5, 8.5]], red: [[8.5, 10]] }));
  tiles.push(vitalTileHTML('Exercise today', v.exercise + ' <small>min</small>', 'Target 120 min/day', exerciseSubText(crew),
    V.vitalStatus('exercise', v.exercise),
    { min: 0, max: 150, safeLow: 90, safeHigh: 150, value: v.exercise, amber: [[30, 90]], red: [[0, 30]] }));
  tiles.push(vitalTileHTML('Radiation dose', radToday.toFixed(2) + ' <small>mSv today</small>',
    'Daily action level ' + e.radAlertThreshold.toFixed(2) + ' mSv (' + e.label + ')',
    'Cumulative mission dose ' + v.radCumulative.toFixed(1) + ' mSv · career limit 600 mSv',
    V.vitalStatus('radDay', radToday, e),
    // Watch zone starts at 80% of the action level, exactly where the
    // RAD-WATCH alert starts; the alert zone starts at the level itself.
    { min: 0, max: e.radAlertThreshold * 1.5, safeLow: 0, safeHigh: e.radAlertThreshold * 0.8, value: radToday,
      amber: [[e.radAlertThreshold * 0.8, e.radAlertThreshold]], red: [[e.radAlertThreshold, e.radAlertThreshold * 1.5]] }));

  $('vital-grid').innerHTML = tiles.join('');
  $('crew-note').textContent = crew.note;
  renderChartSummaries();
}

/* ---------- Cabin environment ---------- */
function renderCabin() {
  const grid = $('cabin-grid');
  if (!grid) return;
  const co2Status = recovery ? 'amber' : V.cabinStatus(cabin.co2Ppm);
  const statusWordText = recovery ? 'Recovering' : co2Status === 'green' ? 'Nominal' : co2Status === 'amber' ? 'CO2 elevated' : 'Action required';
  $('cabin-status').innerHTML = '<span class="badge ' + co2Status + '">Cabin: ' + statusWordText + '</span>';
  const tiles = [];
  tiles.push(vitalTileHTML('Cabin CO2', cabin.co2Ppm + ' <small>ppm</small>',
    'Watch above 1,500 ppm · action above 2,500 ppm (demo levels)',
    scenarioId === 'co2' ? 'Scrubber drift active: CO2 climbing' : recovery ? 'Recovery in progress: returning to baseline' : 'Scrubber nominal',
    co2Status,
    { min: 400, max: 4000, safeLow: 400, safeHigh: V.CABIN.co2Watch, value: cabin.co2Ppm,
      amber: [[V.CABIN.co2Watch, V.CABIN.co2Alert]], red: [[V.CABIN.co2Alert, 4000]] }));
  tiles.push(vitalTileHTML('Oxygen partial pressure', cabin.ppo2Kpa.toFixed(1) + ' <small>kPa</small>',
    'Sea-level reference 21.2 kPa', 'Cabin air mix',
    cabin.ppo2Kpa < 20 ? 'amber' : 'green',
    { min: 15, max: 25, safeLow: 19, safeHigh: 23, value: cabin.ppo2Kpa }));
  tiles.push(vitalTileHTML('Cabin pressure', cabin.pressureKpa.toFixed(1) + ' <small>kPa</small>',
    'Sea-level reference 101.3 kPa', 'Hull integrity nominal', 'green',
    { min: 90, max: 110, safeLow: 98, safeHigh: 104, value: cabin.pressureKpa }));
  tiles.push(vitalTileHTML('Temperature', cabin.tempC.toFixed(1) + ' <small>°C</small>',
    'Comfort band 20-24.5 °C', 'Cabin climate',
    cabin.tempC > 26 || cabin.tempC < 18 ? 'amber' : 'green',
    { min: 15, max: 30, safeLow: 20, safeHigh: 24.5, value: cabin.tempC }));
  tiles.push(vitalTileHTML('Humidity', Math.round(cabin.humidityPct) + ' <small>%</small>',
    'Comfort band 35-60%', 'Cabin climate',
    cabin.humidityPct > 65 || cabin.humidityPct < 30 ? 'amber' : 'green',
    { min: 20, max: 80, safeLow: 35, safeHigh: 60, value: cabin.humidityPct }));
  grid.innerHTML = tiles.join('');
}

/* One cabin step per live tick. Under the CO2 scenario the CO2 channel
   climbs coherently (with small knock-on effects on temperature, humidity
   and oxygen); during scenario recovery the CO2 channel is interpolated
   by the recovery state instead, and the other channels ease back to
   baseline afterwards. */
function cabinTick() {
  if (recovery) return; // CO2 is driven by the recovery interpolation
  if (scenarioId === 'co2') {
    cabin.co2Ppm = Math.min(V.CABIN.co2Cap, cabin.co2Ppm + 110);
    cabin.tempC = Math.min(V.CABIN.baseline.tempC + 0.8, +(cabin.tempC + 0.03).toFixed(2));
    cabin.humidityPct = Math.min(V.CABIN.baseline.humidityPct + 6, cabin.humidityPct + 0.4);
    cabin.ppo2Kpa = Math.max(V.CABIN.baseline.ppo2Kpa - 0.5, +(cabin.ppo2Kpa - 0.02).toFixed(2));
  } else {
    const b = V.CABIN.baseline;
    cabin.co2Ppm = Math.round(clamp(cabin.co2Ppm + (Math.random() * 2 - 1) * 15 + (b.co2Ppm - cabin.co2Ppm) * 0.1, 900, 1400));
    cabin.tempC = +(cabin.tempC + (b.tempC - cabin.tempC) * 0.1).toFixed(2);
    cabin.humidityPct = +(cabin.humidityPct + (b.humidityPct - cabin.humidityPct) * 0.1).toFixed(1);
    cabin.ppo2Kpa = +(cabin.ppo2Kpa + (b.ppo2Kpa - cabin.ppo2Kpa) * 0.1).toFixed(2);
  }
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
  if (charts.sleep) setLast(charts.sleep, crew.vitals.sleep);
  if (charts.rad) setLast(charts.rad, +radTodayFor(crew).toFixed(2));
}

/* Text summaries of the four charts for screen readers (the canvases
   themselves are not readable). Refreshed whenever the vitals render, so
   they always describe the selected crew member's current data. */
function renderChartSummaries() {
  const crew = crewById(selectedCrewId);
  const e = env();
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const range = (arr, fmt) => 'from ' + fmt(Math.min(...arr)) + ' to ' + fmt(Math.max(...arr));
  set('desc-chart-hr', 'Heart rate chart, last 7 days for ' + crew.name + ': ' +
    range(crew.history.hr, (x) => x + ' bpm') + '. Today: ' + crew.vitals.hr + ' bpm. Safe range 60 to 100 bpm.');
  set('desc-chart-spo2', 'Blood oxygen chart, last 7 days for ' + crew.name + ': ' +
    range(crew.history.spo2, (x) => x + '%') + '. Today: ' + crew.vitals.spo2 + '%. Safe range 95 to 100%.');
  set('desc-chart-sleep', 'Sleep chart, last 7 days for ' + crew.name + ': ' +
    range(crew.history.sleep, (x) => x.toFixed(1) + ' h') + '. Last night: ' + crew.vitals.sleep.toFixed(1) + ' h. Target 7 to 9 h.');
  set('desc-chart-rad', 'Radiation chart, last 7 days for ' + crew.name + ' in the ' + e.label +
    ' environment: ' + range(crew.history.radDay, (x) => x.toFixed(2) + ' mSv') +
    '. Today so far: ' + radTodayFor(crew).toFixed(2) + ' mSv. Daily action level ' + e.radAlertThreshold.toFixed(2) + ' mSv.');
}

/* ---------- Alerts ---------- */
function logAlert(text, kind) {
  alertLogEntries.unshift({ time: 'Sol ' + currentSol() + ' ' + fmtDayTime(missionDaySeconds()), text, kind });
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
    '<li><time>' + en.time + '</time> · ' + en.text + '</li>').join('');
}

function renderAlerts() {
  const frac = missionDayFraction();
  const all = [];
  V.CREW.forEach((crew) => {
    V.evaluateAlerts(crew, env(), frac, scenarioId).forEach((a) => all.push({ crew, alert: a }));
  });

  // Log newly-appearing alerts (and note cleared ones) — once per alert key.
  const currentKeys = new Set(all.map((x) => x.crew.id + ':' + x.alert.code));
  currentKeys.forEach((key) => {
    if (!knownAlertKeys.has(key)) {
      knownAlertKeys.add(key);
      const item = all.find((x) => (x.crew.id + ':' + x.alert.code) === key);
      logAlert('ALERT raised: ' + item.crew.name + ': ' + item.alert.title + ' (' + item.alert.severity + ')', 'raised');
      // Screen readers: announce newly raised critical (red) alerts.
      if (item.alert.severity === 'red') {
        const ann = $('alert-announcer');
        if (ann) ann.textContent = 'Critical alert: ' + item.alert.title + ' for ' + item.crew.name + '. ' + item.alert.detail;
      }
    }
  });
  [...knownAlertKeys].forEach((key) => {
    if (!currentKeys.has(key)) {
      knownAlertKeys.delete(key);
      const [crewId, code] = key.split(':');
      logAlert('ALERT cleared: ' + crewById(crewId).name + ': ' + code, 'cleared');
    }
  });

  const list = $('alerts-list');
  if (!all.length) {
    list.innerHTML = '<p class="all-clear">All clear: no active alerts across the crew.</p>';
    return;
  }
  // Red first, then amber.
  all.sort((a, b) => (a.alert.severity === 'red' ? 0 : 1) - (b.alert.severity === 'red' ? 0 : 1));
  list.innerHTML = all.map((x) =>
    '<div class="alert-item ' + x.alert.severity + '">' +
    '<div class="a-top"><span class="badge ' + x.alert.severity + '">' + x.alert.severity.toUpperCase() + '</span>' +
    '<span class="a-title">' + x.alert.title + ' · ' + x.crew.name + '</span></div>' +
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
    // Crew-level view, kept distinct from the selected astronaut's risk:
    // the worst risk this hazard poses to ANY crew member.
    const crewWorst = V.worstStatus(V.CREW.map((c) => h.riskFn(c, env())));
    const card = document.createElement('div');
    card.className = 'hazard-card';
    card.innerHTML =
      '<div class="h-top"><span class="h-icon" aria-hidden="true">' + h.icon + '</span><h3>' + h.name + '</h3></div>' +
      '<p>' + h.blurb + '</p>' +
      '<p style="margin-top:8px;"><span class="badge ' + risk + '">Risk: ' + statusWord(risk) + '</span></p>' +
      '<p class="h-for">Risk shown for ' + crew.name + ' · crew worst case: ' + statusWord(crewWorst) + '</p>' +
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
  const title = $('timeline-title');
  if (title) title.textContent = 'Daily Health Timeline · Sol ' + currentSol();
  const ul = $('timeline');
  ul.innerHTML = '';
  // Exercise blocks carry the selected crew member's live session state, so
  // the timeline and the exercise model can never drift apart.
  const sessionStates = {};
  V.exerciseSessionStates(crewById(selectedCrewId), missionDayMinutes() % 1440)
    .forEach((s) => { sessionStates[s.session.id] = s; });
  const crewFirst = crewById(selectedCrewId).name.split(' ').pop();
  V.TIMELINE.forEach((item) => {
    const state = timelineState(item);
    const li = document.createElement('li');
    li.className = state;
    const badge = state === 'done'
      ? '<span class="badge green">Done</span>'
      : state === 'overdue'
        ? '<span class="badge amber">Overdue</span>'
        : '<span class="badge grey">Upcoming</span>';
    let detail = item.detail;
    if (item.session && sessionStates[item.session]) {
      const ss = sessionStates[item.session];
      if (ss.state === 'active') detail += ' · In session now (' + crewFirst + ')';
      else if (ss.state === 'complete') detail += ' · Session complete: ' + ss.logged + ' min logged by ' + crewFirst;
      else if (ss.state === 'partial') detail += ' · Session ended: ' + ss.logged + '/' + ss.session.minutes + ' min logged by ' + crewFirst;
      else if (ss.state === 'missed') detail += ' · Session missed by ' + crewFirst;
    }
    li.innerHTML = '<span class="t-time">' + item.time + '</span>' +
      '<span class="t-body"><span class="t-title">' + item.title + '</span><br>' +
      '<span class="t-detail">' + detail + '</span></span>' +
      '<span class="t-state">' + badge + '</span>';
    // Keyboard accessible: focusable, Enter/Space toggles done, same as click.
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-pressed', item.done ? 'true' : 'false');
    li.setAttribute('aria-label', item.time + ' ' + item.title + '. Press Enter to toggle done.');
    const toggle = () => {
      item.done = !item.done;
      renderTimeline();
    };
    li.addEventListener('click', toggle);
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
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
  // First pass: questions about the selected crew member's own state are
  // answered from their live values; everything else uses the Q&A bank.
  const crew = crewById(selectedCrewId);
  const ans = V.answerLiveState(q, crew, radTodayFor(crew), env()) || V.answerChatbot(q);
  addChatMessage(ans.a, 'bot', ans.learn);
}

function initChatbot() {
  addChatMessage('Hello. I am the VitalOrbit health assistant. Ask me about your own vitals, or about heart rate, sleep, exercise, radiation, or any crew health topic.', 'bot',
    'Built from NASA Human Research Program material on the five hazards of human spaceflight.');
  const chips = $('chat-chips');
  const picks = [
    'How am I doing?',
    'Why is my heart rate high in space?',
    'How much exercise do I need?',
    'How do I sleep better in microgravity?',
    'What is my radiation dose today?',
    'Why do astronauts lose bone in space?',
    'I feel isolated. What helps?',
    'What if my blood oxygen is low?',
    'I feel unwell. What do I do?',
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
  const ml = $('methodology-list');
  if (ml) {
    ml.innerHTML = V.PARAMETER_BASIS.map((p) =>
      '<li><b>' + p.param + '</b> · <span class="basis">' + p.basis + '</span> · ' + p.source + '</li>').join('');
  }
}

/* ---------- Live simulation tick (every 3 s) ---------- */
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function liveTick() {
  const e = env();
  const frac = missionDayFraction();

  // Cabin steps before the recovery block: while a recovery is in flight
  // cabinTick leaves the CO2 channel to the recovery interpolation, and on
  // the completion tick the cabin is still in recovery at this point, so
  // the baseline restored below is not jittered in the same tick.
  cabinTick();

  // Scenario recovery runs FIRST and owns heart rate, SpO2 and cabin CO2
  // while it is active: values interpolate deterministically back to the
  // pre-scenario snapshot instead of relying on random-walk luck.
  const recoveringThisTick = !!recovery;
  if (recovery) {
    recovery.ticksLeft -= 1;
    const t = 1 - recovery.ticksLeft / recovery.totalTicks;
    V.CREW.forEach((c) => {
      const r = recovery.crew[c.id];
      if (!r) return;
      c.vitals.spo2 = Math.round(r.fromSpo2 + (r.toSpo2 - r.fromSpo2) * t);
      c.vitals.hr = Math.round(r.fromHr + (r.toHr - r.fromHr) * t);
    });
    cabin.co2Ppm = Math.round(recovery.cabinFrom + (V.CABIN.baseline.co2Ppm - recovery.cabinFrom) * t);
    if (recovery.ticksLeft === 0) {
      V.CREW.forEach((c) => {
        const r = recovery.crew[c.id];
        if (!r) return;
        c.vitals.spo2 = r.toSpo2; // exact baseline, no rounding drift
        c.vitals.hr = r.toHr;
        c.highHrStreak = r.streak; // scenario streak counter reset
      });
      cabin.co2Ppm = V.CABIN.baseline.co2Ppm;
      recovery = null;
      logAlert('Recovery complete: crew vitals and cabin air back at baseline', 'scenario');
    }
    renderScenarioStatus();
  }

  V.CREW.forEach((crew) => {
    const v = crew.vitals;
    if (!recoveringThisTick) {
      // Heart rate: gentle random walk; Okafor stays elevated by design.
      // A CO2 scrubber drift raises everyone's resting heart rate while active.
      const baseHr = crew.id === 'okafor' ? 104 : { reyes: 62, chen: 68, novak: 71 }[crew.id];
      const base = baseHr + (scenarioId === 'co2' ? 9 : 0);
      v.hr = clamp(Math.round(v.hr + (Math.random() * 2 - 1) * 2 + (base - v.hr) * 0.15), 55, 118);
      // SpO2: small walk, integer. Under CO2 drift it sinks; otherwise it
      // recovers toward the crew member's baseline captured at load.
      if (scenarioId === 'co2') {
        v.spo2 = clamp(Math.round(v.spo2 + (Math.random() * 2 - 1) * 0.6 - 0.3), 91, 100);
      } else {
        const driftBack = v.spo2 < crew._nominalSpo2 ? 0.35 : 0;
        v.spo2 = clamp(Math.round(v.spo2 + (Math.random() * 2 - 1) * 0.6 + driftBack), 93, 100);
      }
      // High-HR streak tracking for the alert rule.
      if (v.hr > 100) crew.highHrStreak = (crew.highHrStreak || 0) + 1;
      else crew.highHrStreak = 0;
    }
    // Stress: slow walk (continues during recovery; stress is not part of
    // the CO2 snapshot).
    v.stress = clamp(+(v.stress + (Math.random() * 2 - 1) * 0.15).toFixed(1), 1, 10);
    // Exercise: session-based and deterministic. Minutes are a pure
    // function of mission time, so nothing accrues outside a session, no
    // session can be counted twice, and tiles/timeline/alerts agree.
    v.exercise = V.exerciseAt(crew, missionDayMinutes() % 1440);
    // Cumulative radiation grows with the effective (scenario-scaled) dose
    // rate. Keep full float precision here: rounding to 3 decimals every
    // tick (the old code) discarded the whole per-tick increment
    // (~0.00008 mSv), so the cumulative dose never actually grew.
    // Display rounds it (toFixed(1) in the tile).
    v.radCumulative = v.radCumulative + (effectiveDoseRate() * 3) / 86400;
    // Keep today's history point in step with the live value (per-crew dose),
    // and keep the canonical unit-day base in step too, so an environment
    // switch later re-derives today's point exactly.
    crew.vitals.radDayToday = radTodayFor(crew);
    crew.history.hr[crew.history.hr.length - 1] = v.hr;
    crew.history.spo2[crew.history.spo2.length - 1] = v.spo2;
    crew.history.radDay[crew.history.radDay.length - 1] = +radTodayFor(crew).toFixed(2);
    crew.history.radDayBase[crew.history.radDayBase.length - 1] = +(frac * (crew.radFactor || 1)).toFixed(4);
  });
  lastTickAt = 'Sol ' + currentSol() + ' ' + fmtDayTime(missionDaySeconds());
  renderCrewCards();
  renderVitals();
  renderAlerts();
  renderHazards();
  renderCabin();
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
  renderScenarioButtons();
  renderScenarioStatus();
  renderEnvPanel();
  renderCrewCards();
  renderVitals();
  renderAlerts();
  renderHazards();
  renderCabin();
  renderTimeline();
  renderSources();
  initChatbot();
  tickClock();
  ensureCharts((ok) => { if (ok) buildCharts(); else showChartsFallback(); });
  setInterval(tickClock, 1000);
  setInterval(liveTick, 3000);
  lastTickAt = 'Sol ' + currentSol() + ' ' + fmtDayTime(missionDaySeconds());
  $('last-updated').textContent = lastTickAt;
}

document.addEventListener('DOMContentLoaded', init);
