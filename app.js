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
      renderOverview();
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
  $('env-dose-rate').textContent = effectiveDoseRate().toFixed(1) + ' mSv/day (dose equivalent)' +
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
  renderOverview();
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
      renderOverview();
      renderAdherence();
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

function vitalTileHTML(label, valueText, rangeText, subText, status, barCfg, provTag) {
  return '<div class="vital-tile ' + status + '">' +
    '<div class="v-label"><span>' + label + (provTag ? ' <span class="prov-tag">' + provTag + '</span>' : '') + '</span><span class="badge ' + status + '">' + statusWord(status) + '</span></div>' +
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
    { min: 40, max: 120, safeLow: 60, safeHigh: 100, value: v.hr, amber: [[50, 60], [100, 110]], red: [[40, 50], [110, 120]] },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Blood oxygen (SpO2)', v.spo2 + ' <small>%</small>', 'Safe range 95–100%', 'Blood oxygen saturation',
    V.vitalStatus('spo2', v.spo2),
    { min: 85, max: 100, safeLow: 95, safeHigh: 100, value: v.spo2, amber: [[94, 95]], red: [[85, 94]] },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Sleep (last night)', v.sleep.toFixed(1) + ' <small>h</small>', 'Target 7–9 h', 'Last night',
    V.vitalStatus('sleep', v.sleep),
    { min: 0, max: 12, safeLow: 7, safeHigh: 9, value: v.sleep, amber: [[5, 7], [9, 12]], red: [[0, 5]] },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Stress score', v.stress.toFixed(1) + ' <small>/ 10</small>', 'Target 5 or below', 'Self-reported, higher = worse',
    V.vitalStatus('stress', v.stress),
    { min: 0, max: 10, safeLow: 0, safeHigh: 5, value: v.stress, amber: [[5, 8.5]], red: [[8.5, 10]] },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Exercise today', v.exercise + ' <small>min</small>', 'Target 120 min/day', exerciseSubText(crew),
    V.vitalStatus('exercise', v.exercise),
    { min: 0, max: 150, safeLow: 90, safeHigh: 150, value: v.exercise, amber: [[30, 90]], red: [[0, 30]] },
    V.PROVENANCE.derived.tag));
  // Dose projection: transparent rate-times-time estimate from the
  // simulated rate, labelled ESTIMATE with its method. Not a forecast.
  const proj = V.doseProjection(crew, e, scenarioId, missionDayFraction());
  const projText = proj.hoursToActionLevel == null
    ? 'Estimate: at the current simulated rate (' + proj.ratePerDay.toFixed(2) + ' mSv/day dose equivalent) the action level is already reached today. ' + proj.careerNote
    : 'Estimate: at the current simulated rate (' + proj.ratePerDay.toFixed(2) + ' mSv/day dose equivalent) the action level is reached in ~' + proj.hoursToActionLevel.toFixed(1) + ' h. ' + proj.careerNote;
  tiles.push(vitalTileHTML('Radiation dose', radToday.toFixed(2) + ' <small>mSv today</small>',
    'Dose equivalent · daily action level ' + e.radAlertThreshold.toFixed(2) + ' mSv (' + e.label + ')',
    'Cumulative mission dose ' + v.radCumulative.toFixed(1) + ' mSv dose equivalent (simulated) · career limit 600 mSv effective dose<br>' + projText,
    V.vitalStatus('radDay', radToday, e),
    // Watch zone starts at 80% of the action level, exactly where the
    // RAD-WATCH alert starts; the alert zone starts at the level itself.
    { min: 0, max: e.radAlertThreshold * 1.5, safeLow: 0, safeHigh: e.radAlertThreshold * 0.8, value: radToday,
      amber: [[e.radAlertThreshold * 0.8, e.radAlertThreshold]], red: [[e.radAlertThreshold, e.radAlertThreshold * 1.5]] },
    V.PROVENANCE.derived.tag + ' · ' + V.PROVENANCE.estimate.tag));

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
      amber: [[V.CABIN.co2Watch, V.CABIN.co2Alert]], red: [[V.CABIN.co2Alert, 4000]] },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Oxygen partial pressure', cabin.ppo2Kpa.toFixed(1) + ' <small>kPa</small>',
    'Sea-level reference 21.2 kPa', 'Cabin air mix',
    cabin.ppo2Kpa < 20 ? 'amber' : 'green',
    { min: 15, max: 25, safeLow: 19, safeHigh: 23, value: cabin.ppo2Kpa },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Cabin pressure', cabin.pressureKpa.toFixed(1) + ' <small>kPa</small>',
    'Sea-level reference 101.3 kPa', 'Hull integrity nominal', 'green',
    { min: 90, max: 110, safeLow: 98, safeHigh: 104, value: cabin.pressureKpa },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Temperature', cabin.tempC.toFixed(1) + ' <small>°C</small>',
    'Comfort band 20-24.5 °C', 'Cabin climate',
    cabin.tempC > 26 || cabin.tempC < 18 ? 'amber' : 'green',
    { min: 15, max: 30, safeLow: 20, safeHigh: 24.5, value: cabin.tempC },
    V.PROVENANCE.simulated.tag));
  tiles.push(vitalTileHTML('Humidity', Math.round(cabin.humidityPct) + ' <small>%</small>',
    'Comfort band 35-60%', 'Cabin climate',
    cabin.humidityPct > 65 || cabin.humidityPct < 30 ? 'amber' : 'green',
    { min: 20, max: 80, safeLow: 35, safeHigh: 60, value: cabin.humidityPct },
    V.PROVENANCE.simulated.tag));
  grid.innerHTML = tiles.join('');
  // Cabin decision support: when CO2 leaves its intended demo range, show
  // the same fixed guidance shape as the alerts (trigger, evidence,
  // suggested informational action, basis, limitation). Display only.
  const guide = $('cabin-guidance');
  if (guide) {
    if (recovery) {
      guide.hidden = false;
      guide.innerHTML = '<b>Cabin guidance:</b> Trigger: CO2 Scrubber Drift scenario ended. Evidence: cabin CO2 is returning from ' +
        Math.round(cabin.co2Ppm) + ' ppm toward the 1,150 ppm baseline. Suggested action (informational): keep monitoring until the recovery completes. Basis: Simulation guidance. Limitation: simulated demo data only, not a flight procedure.';
    } else if (co2Status !== 'green') {
      guide.hidden = false;
      guide.innerHTML = '<b>Cabin guidance:</b> Trigger: cabin CO2 at or above the ' + (co2Status === 'red' ? '2,500 ppm action level' : '1,500 ppm watch level') +
        ' (demo levels). Evidence: cabin CO2 is ' + Math.round(cabin.co2Ppm) + ' ppm. Suggested action (informational): switch to the backup CO2 scrubber, increase cabin ventilation, and re-check crew SpO2 every 15 min. Basis: Operationally referenced. Limitation: demo thresholds on simulated data, not NASA limits and not a flight procedure.';
    } else {
      guide.hidden = true;
      guide.innerHTML = '';
    }
  }
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

/* ---------- Theme (dark / light) ----------
   Presentation only: no simulated value, rule or chart datum depends on
   the theme. The boot script in index.html sets data-theme on <html>
   before first paint (the stored choice, dark when unset); this module
   owns the header toggle, localStorage persistence, the Chart.js
   re-theme, and the pointer parallax on the background layers. */
const THEME_KEY = 'vitalorbit-theme';
const themeStore = {
  get() { try { return window.localStorage.getItem(THEME_KEY); } catch (e) { return null; } },
  set(v) { try { window.localStorage.setItem(THEME_KEY, v); } catch (e) { /* storage unavailable: the theme still applies for this session */ } },
};
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function syncThemeToggle() {
  const btn = $('theme-toggle');
  if (!btn) return;
  const t = currentTheme();
  btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  btn.setAttribute('aria-label', t === 'dark'
    ? 'Dark theme active. Switch to light theme'
    : 'Light theme active. Switch to dark theme');
  const label = btn.querySelector('.theme-toggle-label');
  if (label) label.textContent = t === 'dark' ? 'Dark' : 'Light';
}

function setTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  themeStore.set(name);
  syncThemeToggle();
  rethemeCharts();
}

function initTheme() {
  // Align the mutable chart palette and the toggle with the theme the
  // boot script already applied, then wire the toggle.
  Object.assign(CHART_COLORS, CHART_PALETTES[currentTheme()]);
  syncThemeToggle();
  const btn = $('theme-toggle');
  if (btn) btn.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  // Colour transitions start only after first paint, so loading with a
  // stored light theme never animates away from the dark default.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.add('theme-transitions');
  }));
}

/* Pointer parallax on the decorative background layers: tiny offsets,
   lerped on requestAnimationFrame, desktop fine pointers only, and never
   under prefers-reduced-motion. Purely decorative; no data meaning. */
function initParallax() {
  const finePointer = window.matchMedia('(pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!finePointer.matches || reducedMotion.matches) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
  const step = () => {
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    document.body.style.setProperty('--par-x', cx.toFixed(2) + 'px');
    document.body.style.setProperty('--par-y', cy.toFixed(2) + 'px');
    if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1) raf = requestAnimationFrame(step);
    else raf = null;
  };
  window.addEventListener('pointermove', (ev) => {
    tx = (ev.clientX / Math.max(1, window.innerWidth) - 0.5) * 14;
    ty = (ev.clientY / Math.max(1, window.innerHeight) - 0.5) * 10;
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });
}

/* ---------- Charts ---------- */
/* Two full chart palettes. CHART_COLORS is the mutable working copy the
   chart builders read; a theme switch copies the active palette into it
   and pushes the colour fields into every live chart (data untouched). */
const CHART_PALETTES = {
  dark: { line: '#4da3ff', band: 'rgba(47, 191, 113, 0.18)', grid: 'rgba(143, 163, 184, 0.15)', tick: '#8fa3b8',
          tooltipBg: '#101a28', tooltipBorder: '#2b405c', tooltipTitle: '#e7eef7', tooltipBody: '#c9d8ea', point: '#fff' },
  light: { line: '#1c6dd0', band: 'rgba(23, 138, 76, 0.16)', grid: 'rgba(30, 64, 105, 0.14)', tick: '#47617e',
           tooltipBg: '#ffffff', tooltipBorder: '#b9cbdf', tooltipTitle: '#12263f', tooltipBody: '#33506f', point: '#fff' },
};
const CHART_COLORS = { line: '#4da3ff', band: 'rgba(47, 191, 113, 0.18)', grid: 'rgba(143, 163, 184, 0.15)', tick: '#8fa3b8',
  tooltipBg: '#101a28', tooltipBorder: '#2b405c', tooltipTitle: '#e7eef7', tooltipBody: '#c9d8ea', point: '#fff' };

/* Push the active palette into every live Chart.js instance: line, band,
   grid, tick and tooltip colours only. Data, scales and bands (the safe
   range geometry) are never touched. */
function rethemeCharts() {
  const pal = CHART_PALETTES[currentTheme()];
  Object.assign(CHART_COLORS, pal);
  Object.keys(charts).forEach((key) => {
    const chart = charts[key];
    if (!chart) return;
    const ds = chart.data.datasets;
    if (ds[1]) ds[1].backgroundColor = pal.band;
    const main = ds[ds.length - 1];
    if (main) {
      main.borderColor = pal.line;
      main.backgroundColor = pal.line;
      main.pointBackgroundColor = pal.point;
    }
    ['x', 'y'].forEach((axis) => {
      const scale = chart.options.scales[axis];
      if (!scale) return;
      if (scale.grid) scale.grid.color = pal.grid;
      if (scale.ticks) scale.ticks.color = pal.tick;
      if (scale.title) scale.title.color = pal.tick;
    });
    const tip = chart.options.plugins && chart.options.plugins.tooltip;
    if (tip) {
      tip.backgroundColor = pal.tooltipBg;
      tip.borderColor = pal.tooltipBorder;
      tip.titleColor = pal.tooltipTitle;
      tip.bodyColor = pal.tooltipBody;
    }
    chart.update('none');
  });
}

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
    tension: 0.25, borderWidth: 2, pointRadius: 3, pointBackgroundColor: CHART_COLORS.point,
  });
  return new Chart(ctx, {
    type: 'line',
    data: { labels: V.DAYS.slice(), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false, // deterministic rendering: no mid-animation frames in screenshots
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: CHART_COLORS.tooltipBg, borderColor: CHART_COLORS.tooltipBorder, borderWidth: 1,
          titleColor: CHART_COLORS.tooltipTitle, bodyColor: CHART_COLORS.tooltipBody, padding: 10,
          // Only the measured series is explained; the safe-band datasets are shading, not values.
          filter: (item) => item.dataset.label === yLabel,
          callbacks: { label: (item) => ' ' + item.dataset.label + ': ' + item.parsed.y },
        },
      },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.tick, font: { size: 10 } },
             title: { display: true, text: 'Mission day', color: CHART_COLORS.tick, font: { size: 10 } } },
        y: { min: yMin, max: yMax, grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.tick, font: { size: 10 } },
             title: { display: true, text: yLabel, color: CHART_COLORS.tick, font: { size: 10 } } },
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
  charts.rad = makeChart('chart-rad', 0, e.radAlertThreshold, crew.history.radDay, 0, Math.max(2, e.radAlertThreshold * 1.4), 'Radiation dose equivalent (mSv/day)');
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
    0, Math.max(2, e.radAlertThreshold * 1.4), 'Radiation dose equivalent (mSv/day)');
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
  set('desc-chart-rad', 'Radiation dose equivalent chart, last 7 days for ' + crew.name + ' in the ' + e.label +
    ' environment: ' + range(crew.history.radDay, (x) => x.toFixed(2) + ' mSv') +
    '. Today so far: ' + radTodayFor(crew).toFixed(2) + ' mSv. Daily action level ' + e.radAlertThreshold.toFixed(2) + ' mSv. All values are simulated dose equivalent.');
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
  list.innerHTML = all.map((x) => {
    // Decision support: every alert carries its trigger, its basis label
    // and its limitation next to the evidence and the suggested action.
    // Displaying guidance never changes any simulated value.
    const g = V.alertGuidance(x.alert);
    return '<div class="alert-item ' + x.alert.severity + '">' +
    '<div class="a-top"><span class="badge ' + x.alert.severity + '">' + x.alert.severity.toUpperCase() + '</span>' +
    '<span class="a-title">' + x.alert.title + ' · ' + x.crew.name + '</span></div>' +
    '<div class="a-detail">' + x.alert.detail + '</div>' +
    '<div class="a-guide"><b>Trigger:</b> ' + g.trigger + '<br>' +
    '<b>Basis:</b> ' + g.basis + ' · <b>Limitation:</b> ' + g.limitation + '</div>' +
    '<div class="a-action"><b>Suggested action (informational):</b> ' + x.alert.action + '</div>' +
    '</div>';
  }).join('');
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
    // Explainable detail: inputs, the rule in plain words, the threshold
    // state for THIS astronaut, the evidence basis and the countermeasure.
    const ex = V.hazardExplain(h, crew, env());
    card.innerHTML =
      '<div class="h-top"><span class="h-icon" aria-hidden="true">' + h.icon + '</span><h3>' + h.name + '</h3></div>' +
      '<p>' + h.blurb + '</p>' +
      '<p style="margin-top:8px;"><span class="badge ' + risk + '">Risk: ' + statusWord(risk) + '</span></p>' +
      '<p class="h-for">Risk shown for ' + crew.name + ' · crew worst case: ' + statusWord(crewWorst) + '</p>' +
      '<p class="h-vitals"><b>Watched via:</b> ' + h.vitals.join(' · ') + '</p>' +
      '<p class="h-cm"><b>Countermeasure tracked:</b> ' + h.countermeasure + '</p>' +
      '<details class="h-details"><summary>Why this risk? Inputs, rule and evidence</summary>' +
      '<p><b>Inputs:</b> ' + ex.inputs.join(' · ') + '</p>' +
      '<p><b>How the risk is decided:</b> ' + ex.rule + '</p>' +
      '<p><b>Status:</b> ' + ex.status + '</p>' +
      '<p><b>Evidence basis:</b> ' + ex.evidence + '</p>' +
      '<p><b>Countermeasure information:</b> ' + ex.mitigation + '</p></details>';
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

/* ---------- Chatbot: project answers for newcomers ----------
   The assistant also explains the project itself, so a first-time visitor
   (or a judge) can understand what VitalOrbit is and how it works just by
   asking. The intents are deliberately narrow and project-specific, so
   health and live-state questions keep flowing to the layers below, and
   state-specific questions ("why is Okafor flagged?", "what is the CO2
   scenario doing?") keep their existing explainable answers. Every
   statement matches the page: simulated data, fictional crew, published
   reference values, NASA non-endorsement. */
const PROJECT_LEARN = 'VitalOrbit is a student-built demo for the NASA Space Apps Challenge 2026. It is not a medical system, and NASA does not endorse this project.';

function projectOverviewAnswer() {
  return {
    a: 'VitalOrbit is an astronaut health monitoring dashboard built by Team VitalOrbit India for the NASA Space Apps Challenge 2026, answering the challenge "Create Health Monitoring Software for Astronauts on Space Missions". On a long mission the nearest hospital can be millions of miles away and the crew are their own first responders, so VitalOrbit watches heart rate, blood oxygen, sleep, stress, exercise and radiation dose for four fictional astronauts, plus the cabin air around them, and explains every warning in plain language: what fired, why, and what to do. Use the views on the left (or the strip at the top on a phone) to explore, and ask me things like "What is VitalOrbit?", "How does this work?", "Is this real data?" or "Why is Okafor flagged?".',
    learn: PROJECT_LEARN,
  };
}

function isProjectQuestion(q) {
  return /\b(vitalorbit|this (app|project|dashboard|page|site|demo)|the (app|project|dashboard|demo)|nasa|space apps|hackathon|challenge|judge|judges|presentation|deck|your team|who made|who built|who created)\b/.test(' ' + q.toLowerCase() + ' ');
}

function answerProject(question, ctx) {
  const q = ' ' + question.toLowerCase().trim() + ' ';
  const crewNamed = V.CREW.some((c) => q.includes(c.id) || q.includes(c.name.toLowerCase().split(' ').pop()));

  // What is VitalOrbit / what is this project?
  if (/\bwhat is (vitalorbit|this)\b/.test(q) || /\bwhat('s| is) this (app|project|dashboard|page|site|demo)\b/.test(q) ||
      /\bwhat does vitalorbit do\b/.test(q) || /\b(tell me about|about) (vitalorbit|this project|this app|this dashboard)\b/.test(q) ||
      /\bwhat is (the|this) (nasa )?space apps challenge\b/.test(q)) {
    return projectOverviewAnswer();
  }

  // How does it work / how do I use the dashboard?
  if (/\bhow does (this|it|vitalorbit|the dashboard|the app) work\b/.test(q) || /\bhow do i use\b/.test(q) ||
      /\bhow to use\b/.test(q) || /\btour\b/.test(q) || /\bguide me\b/.test(q) ||
      /\bwhere (do|should) i start\b/.test(q) || /\bwhat can (i|you) do\b/.test(q) ||
      /\bexplain (this|the) (dashboard|app|page|project)\b/.test(q) || q.trim() === 'help') {
    return {
      a: 'Here is the tour. Overview: the whole mission at a glance, plus the mission controls. Crew Health: pick one of the four astronauts to see their vitals, 7-day trend charts, daily timeline and exercise adherence; every other view follows the same selection. Environment: where the crew is and the cabin air they breathe. Radiation & Mission: dose rates, the 7-day dose trend, and why no career projection is shown. Risk & Alerts: every active alert with its evidence, basis and limitation, plus the five hazards of human spaceflight. Methodology: the basis, source and limitation of every number on the page. Two controls change everything live: the Environment switcher (Spacecraft transit, ISS, Moon, Mars) and the Scenario Simulator (Nominal Orbit, Solar Particle Event, CO2 Scrubber Drift), both on the Overview. The button at the bottom right opens me from anywhere, and the sun/moon button at the top switches the light and dark themes.',
      learn: PROJECT_LEARN,
    };
  }

  // Is this real data?
  if (/\bis (this|the data|it|that) (real|live data|actual)\b/.test(q) || /\breal (data|astronauts|people|measurements)\b/.test(q) ||
      /\bis this (a |really |just )?(simulation|simulated|fake|real)\b/.test(q) || /\bfictional\b/.test(q) ||
      /\bwhere does (the|this) data come from\b/.test(q)) {
    return {
      a: 'No. Every live value on this page is SIMULATED demo data, generated for four fictional astronauts (Reyes, Chen, Okafor and Novak), and the header says so: "SIMULATED TELEMETRY". Nothing here is a real measurement from a real person. What IS real is the yardstick the simulated values are judged against: the reference ranges and measurements come from published sources listed in the Methodology view, for example resting heart rate 60 to 100 bpm and SpO2 95 to 100% (standard clinical ranges), sleep 7 to 9 h, the Mars surface dose measured by MSL/RAD, the Moon dose measured by Chang\'E-4, and NASA\'s 600 mSv career limit in NASA-STD-3001. Each number also carries a tag: SIMULATED is a generated demo value, DERIVED is computed from simulated inputs by a stated rule, and ESTIMATE is extrapolated from a simulated rate and is not a forecast.',
      learn: PROJECT_LEARN,
    };
  }

  // How do alerts work? (Why a specific astronaut is flagged stays with
  // the explainable layer below.)
  if (/\bhow do alerts work\b/.test(q) || /\bhow are alerts (generated|created|decided|triggered|raised)\b/.test(q) ||
      /\balert (system|engine|rules?|logic)\b/.test(q) || /\bwhat (is|does) an alert (mean|do)\b/.test(q) ||
      /\bwhat do alerts mean\b/.test(q)) {
    return {
      a: 'Alerts are rule-based, not a black box. Every few seconds each astronaut\'s simulated readings are checked against fixed thresholds: for example, resting heart rate above 100 bpm, SpO2 below 95%, sleep under 6 h, or stress above 7 out of 10. Crossing a watch threshold raises an amber alert; crossing the action threshold raises a red one. Three crossings together (sleep under 6 h AND stress above 7 AND resting heart rate above 100) fire one compound alert, "Compound Fatigue & Cardiovascular Strain", which replaces the three separate warnings so the problem is shown once, whole. Radiation uses an action level set at 90% of the current environment\'s daily dose rate: a watch at 80% of that level, an alert at the level itself. Every alert shows its trigger, the live evidence, a suggested action, its basis and its limitation. The thresholds are demo rules (simulation assumptions, labelled in Methodology), not NASA limits.',
      learn: PROJECT_LEARN,
    };
  }

  // What are the scenarios? (What a scenario is doing right now stays
  // with the explainable layer below.)
  if (/\bwhat (are|is) the scenarios?\b/.test(q) || /\bwhich scenarios\b/.test(q) ||
      /\blist (the |all )?scenarios\b/.test(q) || /\bscenario (options|simulator)\b/.test(q) ||
      /\bwhat scenarios (are there|can i|exist)\b/.test(q)) {
    return {
      a: 'The Scenario Simulator on the Overview offers three what-if scenarios. Nominal Orbit is the calm baseline. Solar Particle Event multiplies the simulated radiation dose rate by 6, so radiation watches and alerts respond. CO2 Scrubber Drift makes the cabin CO2 climb while crew SpO2 drifts down and resting heart rate drifts up. Switching back to Nominal Orbit after a CO2 drift does not snap anything back: a labelled recovery runs for about 30 seconds and returns the vitals and the cabin CO2 to the exact pre-scenario values, so you can watch the crew recover.',
      learn: PROJECT_LEARN,
    };
  }

  // The Mars radiation dose: the surface figure, exactly as the app and
  // the Methodology view state it. Own-state questions ("my dose") and
  // named-crew questions stay with the layers below.
  if (/\bmars\b/.test(q) && /\b(dose|radiation|msv)\b/.test(q) && !/\bmy\b/.test(q) && !crewNamed) {
    const mars = V.ENVIRONMENTS.mars;
    // Reuse the app's own shared note: the career limit is an effective
    // dose and these rates are dose equivalent, so no projection is shown.
    const note = V.doseProjection(ctx.crew, mars, 'nominal', ctx.frac).careerNote;
    return {
      a: 'For the Mars surface, VitalOrbit uses 0.64 ± 0.12 mSv/day (dose equivalent), measured by the MSL Radiation Assessment Detector at Gale Crater (Hassler et al., Science, 2014). The daily action level in that environment is 90% of the rate, ' + mars.radAlertThreshold.toFixed(2) + ' mSv. Do not confuse the surface figure with the higher 1.84 ± 0.30 mSv/day from Zeitlin et al. (2013): that was measured during the cruise to Mars, in transit, and this app never uses it as a surface value. ' + note,
      learn: PROJECT_LEARN,
    };
  }

  // Who made this / where are the deck and the sources?
  if (/\bwho (made|built|created|developed|coded)\b/.test(q) || /\byour team\b/.test(q) ||
      /\b(team|the) (deck|presentation|slides)\b/.test(q) || /\bwhere (is|can i find) the (deck|presentation|slides|sources|references)\b/.test(q) ||
      /\bwhat are (your|the) (sources|references)\b/.test(q)) {
    return {
      a: 'VitalOrbit was built by Team VitalOrbit India during the NASA Space Apps Challenge 2026 (14 November 2026), in answer to the challenge "Create Health Monitoring Software for Astronauts on Space Missions". The team\'s demo deck (PDF and PPTX) is in the project repository under deck/. Every source behind the numbers is listed on this page: the Methodology view carries the data and resources used, the basis for each parameter, and the full source references, including the NASA Human Research Program five-hazards material, NASA-STD-3001, and the MSL/RAD and Chang\'E-4 papers.',
      learn: PROJECT_LEARN,
    };
  }

  return null;
}

function askChatbot(question) {
  const q = question.trim();
  if (!q) return;
  addChatMessage(q, 'user');
  // Layer order: (1) project answers for newcomers (what VitalOrbit is,
  // how the dashboard works, whether the data is real, how alerts and
  // scenarios work, the Mars dose figure, who built it), (2) explainable
  // state-aware answers (why flagged, trends, scenarios, hazards,
  // projections, data-not-held), (3) live-state answers about the selected
  // crew member, (4) the Q&A bank. A question about the project that no
  // layer recognises gets the project overview instead of the health-only
  // fallback; health questions keep the bank's behaviour exactly.
  const crew = crewById(selectedCrewId);
  const ctx = {
    crew, env: env(), scenario: scenarioId, frac: missionDayFraction(),
    radToday: radTodayFor(crew), cabin, minutesOfDay: missionDayMinutes() % 1440,
  };
  let ans = answerProject(q, ctx) || V.answerExplain(q, ctx) ||
    V.answerLiveState(q, crew, radTodayFor(crew), env());
  if (!ans) {
    const bank = V.answerChatbot(q);
    ans = bank.q === null && isProjectQuestion(q) ? projectOverviewAnswer() : bank;
  }
  addChatMessage(ans.a, 'bot', ans.learn);
}

function initChatbot() {
  addChatMessage('Hello. I am the VitalOrbit health assistant. Ask me about your own vitals, or about heart rate, sleep, exercise, radiation, or any crew health topic. New here? Ask "What is VitalOrbit?" or "How does this work?" and I will explain the whole project.', 'bot',
    'Built from NASA Human Research Program material on the five hazards of human spaceflight.');
  const chips = $('chat-chips');
  const picks = [
    'What is VitalOrbit?',
    'How does this work?',
    'Is this real data?',
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
  // One submit path for the Ask button and Enter. The answer logic is
  // synchronous and unchanged; the busy flag simply disables Ask while an
  // answer is being produced and drops duplicate submissions (double
  // clicks, held Enter). The input is single-line, so Enter always sends.
  let chatBusy = false;
  const submitChat = () => {
    if (chatBusy) return;
    const input = $('chat-input');
    if (!input.value.trim()) return;
    chatBusy = true;
    $('chat-send').disabled = true;
    try {
      askChatbot(input.value);
    } finally {
      chatBusy = false;
      $('chat-send').disabled = false;
    }
    input.value = '';
    input.focus();
  };
  $('chat-send').addEventListener('click', submitChat);
  $('chat-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') submitChat();
  });
}

/* ---------- Sources ---------- */
function renderSources() {
  $('sources-list').innerHTML = V.SOURCES.map((s) =>
    '<li><a href="' + s.url + '" target="_blank" rel="noopener">' + s.name + '</a></li>').join('');
  const ml = $('methodology-list');
  if (ml) {
    ml.innerHTML = V.PARAMETER_BASIS.map((p) => {
      const ref = p.ref ? V.REFERENCES.find((r) => r.id === p.ref) : null;
      const refText = ref ? ' <span class="ref-name">[' + ref.publisher + (ref.year ? ', ' + ref.year : '') + ']</span>' : '';
      return '<li><b>' + p.param + '</b> · <span class="basis">' + p.basis + '</span> · ' + p.source + refText + '</li>';
    }).join('');
  }
  const rl = $('references-list');
  if (rl) {
    rl.innerHTML = V.REFERENCES.map((r) =>
      '<li><b>' + r.title + '</b> · ' + r.publisher + (r.year ? ', ' + r.year : '') +
      (r.url ? ' · <a href="' + r.url + '" target="_blank" rel="noopener">source</a>' : '') +
      '<br>Supports: ' + r.supports + '</li>').join('');
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
  renderOverview();
  renderAdherence();
}

/* ---------- Overview summaries (redesign) ----------
   The Overview view shows summaries only. Every number here is computed
   from the same live state and the same rule functions the full views
   use (crewOverallStatus, evaluateAlerts, cabinStatus, hazard riskFn),
   so a summary can never disagree with its detail view. */
function renderOverview() {
  const mission = $('ov-mission');
  if (!mission) return;
  const e = env();
  const crew = crewById(selectedCrewId);
  const frac = missionDayFraction();

  const scenarioText = recovery ? 'Recovery in progress (returning to baseline)'
    : V.SCENARIOS[scenarioId].label;
  mission.innerHTML =
    '<div class="ov-line"><span>Environment</span><span class="val">' + e.label + '</span></div>' +
    '<div class="ov-line"><span>Mission clock</span><span class="val">SOL ' + currentSol() + ' · ' + missionElapsedDays() + 'd elapsed</span></div>' +
    '<div class="ov-line"><span>Scenario</span><span class="val">' + scenarioText + '</span></div>' +
    '<div class="ov-line"><span>Viewing</span><span class="val">' + crew.name + '</span></div>';

  $('ov-crew').innerHTML = V.CREW.map((c) => {
    const st = crewOverallStatus(c);
    return '<div class="ov-line"><span class="ov-who"><span class="dot ' + st + '"></span>' + c.name +
      (c.id === selectedCrewId ? ' (viewing)' : '') + '</span>' +
      '<span class="badge ' + st + '">' + statusWord(st) + '</span></div>';
  }).join('');

  const all = [];
  V.CREW.forEach((c) => {
    V.evaluateAlerts(c, e, frac, scenarioId).forEach((a) => all.push({ crew: c, alert: a }));
  });
  all.sort((a, b) => (a.alert.severity === 'red' ? 0 : 1) - (b.alert.severity === 'red' ? 0 : 1));
  const reds = all.filter((x) => x.alert.severity === 'red').length;
  if (!all.length) {
    $('ov-alerts').innerHTML = '<p class="ov-quiet">All clear: no active alerts across the crew.</p>';
  } else {
    $('ov-alerts').innerHTML =
      '<div class="ov-line"><span>' + all.length + ' active alert' + (all.length === 1 ? '' : 's') + '</span>' +
      '<span class="val">' + reds + ' critical · ' + (all.length - reds) + ' watch</span></div>' +
      all.slice(0, 3).map((x) =>
        '<div class="ov-line"><span class="ov-who"><span class="badge ' + x.alert.severity + '">' + x.alert.severity.toUpperCase() + '</span>' + x.alert.title + '</span>' +
        '<span class="val">' + x.crew.name.split(' ').pop() + '</span></div>').join('') +
      (all.length > 3 ? '<div class="ov-line"><span class="ov-quiet">+ ' + (all.length - 3) + ' more in Risk &amp; Alerts</span></div>' : '');
  }

  const co2Status = recovery ? 'amber' : V.cabinStatus(cabin.co2Ppm);
  const co2Word = recovery ? 'Recovering' : co2Status === 'green' ? 'Nominal' : co2Status === 'amber' ? 'CO2 elevated' : 'Action required';
  $('ov-cabin').innerHTML =
    '<div class="ov-line"><span>Cabin CO2</span><span class="val">' + cabin.co2Ppm + ' ppm</span></div>' +
    '<div class="ov-line"><span>Status</span><span class="badge ' + co2Status + '">' + co2Word + '</span></div>' +
    '<div class="ov-line"><span>Oxygen · pressure</span><span class="val">' + cabin.ppo2Kpa.toFixed(1) + ' kPa · ' + cabin.pressureKpa.toFixed(1) + ' kPa</span></div>';

  $('ov-radiation').innerHTML =
    '<div class="ov-line"><span>Dose rate (dose equivalent)</span><span class="val">' + effectiveDoseRate().toFixed(2) + ' mSv/day</span></div>' +
    '<div class="ov-line"><span>Daily action level</span><span class="val">' + e.radAlertThreshold.toFixed(2) + ' mSv/day</span></div>' +
    '<div class="ov-line"><span>' + crew.name.split(' ').pop() + ' today · cumulative</span><span class="val">' + radTodayFor(crew).toFixed(2) + ' · ' + crew.vitals.radCumulative.toFixed(1) + ' mSv</span></div>';

  $('ov-risk').innerHTML = V.HAZARDS.map((h) => {
    const risk = h.riskFn(crew, e);
    return '<div class="ov-line"><span>' + h.name + '</span>' +
      '<span class="badge ' + risk + '">' + statusWord(risk) + '</span></div>';
  }).join('');
}

/* ---------- Exercise adherence panel (redesign) ----------
   Presentation only: reads the existing deterministic session model. */
function renderAdherence() {
  const body = $('adherence-body');
  if (!body) return;
  const crew = crewById(selectedCrewId);
  const minutes = missionDayMinutes() % 1440;
  const adh = V.exerciseAdherenceSummary(crew, minutes);
  const states = V.exerciseSessionStates(crew, minutes);
  const stateWord = { scheduled: 'Scheduled', active: 'In progress', complete: 'Complete', partial: 'Partial', missed: 'Missed' };
  body.innerHTML =
    '<p class="adh-big"><b>' + adh.logged + ' / ' + adh.planned + ' min</b> logged in finished sessions for ' + crew.name +
    ' (' + Math.round(adh.fraction * 100) + '% adherence) · ' + crew.vitals.exercise + ' min so far today against the 120 min target.</p>' +
    '<ul class="adh-list">' + states.map((s) =>
      '<li><span>' + s.session.name + '</span><span>' + s.logged + '/' + s.session.minutes + ' min · ' + stateWord[s.state] + '</span></li>').join('') + '</ul>' +
    '<p class="adh-note">Sessions are deterministic: minutes accrue only inside a session window, from this astronaut\'s stated adherence pattern.</p>';
}

/* ---------- Floating AI assistant (redesign) ----------
   The chatbot component lives permanently inside the floating panel;
   the AI Assistant button at the bottom right is its only entry point.
   Opening and closing only show and hide the panel, so the conversation
   history is never moved, copied or lost. */
let chatPanelOpen = false;
let chatHideTimer = null;
function setChatPanel(open) {
  const panel = $('chat-panel');
  if (!panel) return;
  chatPanelOpen = open;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (open) {
    if (chatHideTimer) { clearTimeout(chatHideTimer); chatHideTimer = null; }
    panel.hidden = false;
    $('chat-backdrop').hidden = false;
    $('chat-fab').setAttribute('aria-expanded', 'true');
    // Slide/fade in on the next frame; reduced motion shows it at once.
    if (reduced) panel.classList.add('open');
    else requestAnimationFrame(() => requestAnimationFrame(() => { if (chatPanelOpen) panel.classList.add('open'); }));
    const input = $('chat-input');
    if (input) input.focus();
  } else {
    panel.classList.remove('open');
    $('chat-fab').setAttribute('aria-expanded', 'false');
    $('chat-fab').focus();
    // The panel (and with it the whole conversation history) is hidden
    // only once the card has faded, and only if it was not reopened.
    const finish = () => {
      chatHideTimer = null;
      if (chatPanelOpen) return;
      panel.hidden = true;
      $('chat-backdrop').hidden = true;
    };
    if (reduced) finish();
    else chatHideTimer = setTimeout(finish, 190);
  }
}

/* ---------- Scrollspy for the sidebar (redesign) ---------- */
function initScrollspy() {
  const links = Array.prototype.slice.call(document.querySelectorAll('.side-link'));
  if (!links.length || typeof IntersectionObserver === 'undefined') return;
  const byId = {};
  links.forEach((l) => { byId[l.getAttribute('href').slice(1)] = l; });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((l) => { l.classList.remove('active'); l.removeAttribute('aria-current'); });
      const link = byId[en.target.id];
      if (link) { link.classList.add('active'); link.setAttribute('aria-current', 'true'); }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  document.querySelectorAll('.view').forEach((v) => obs.observe(v));
}

function initRedesign() {
  const fab = $('chat-fab');
  if (fab) {
    fab.addEventListener('click', () => setChatPanel(!chatPanelOpen));
    $('chat-close').addEventListener('click', () => setChatPanel(false));
    $('chat-backdrop').addEventListener('click', () => setChatPanel(false));
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && chatPanelOpen) setChatPanel(false); });
  }
  const quick = $('ov-open-chat');
  if (quick) quick.addEventListener('click', () => setChatPanel(true));
  initScrollspy();
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
  renderOverview();
  renderAdherence();
  renderSources();
  initChatbot();
  initRedesign();
  initTheme();
  initParallax();
  tickClock();
  ensureCharts((ok) => { if (ok) buildCharts(); else showChartsFallback(); });
  setInterval(tickClock, 1000);
  setInterval(liveTick, 3000);
  lastTickAt = 'Sol ' + currentSol() + ' ' + fmtDayTime(missionDaySeconds());
  $('last-updated').textContent = lastTickAt;
}

document.addEventListener('DOMContentLoaded', init);
