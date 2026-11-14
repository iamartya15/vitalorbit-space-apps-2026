/* VitalOrbit — data layer (pure data + pure logic, no DOM access).
   All live values are SIMULATED demo data. Reference ranges are grounded in
   NASA Human Research Program material (see ABOUT / sources in index.html):
   - The 5 Hazards of Human Spaceflight (NASA HRP)
   - NASA career limit 600 mSv effective dose (NASA-STD-3001, 2022).
     The ISS rate used here (0.4 mSv/day) is a simulation assumption in
     dose equivalent, NOT the published ISS effective-dose planning
     range (~0.2-0.5 mSv/day): effective dose and dose equivalent are
     different quantities and are never mixed. Measured dose equivalent
     inside the Columbus laboratory runs higher (up to 647 microSv/day,
     DOSIS/DOSIS 3D DOSTEL, Berger et al. 2017; 731 microSv/day in
     early 2019, reported in Zhang et al. 2020).
   - Resting heart rate 60-100 bpm; SpO2 95-100%; sleep target 7-9 h.
   Demo crew members are fictional.

   Parameter honesty (audit pass, Nov 2026): every parameter used below is
   one of three kinds, and the in-app Methodology list (PARAMETER_BASIS)
   labels each one: (1) a published reference range, (2) a NASA requirement
   or operational practice, or (3) a simulation assumption used only for
   this demo. Demo thresholds (daily dose action levels, the SPE x6 surge
   factor, stress cut-offs, cabin watch levels) are simulation assumptions,
   never NASA limits. Verified anchors: career limit 600 mSv is
   NASA-STD-3001 Vol 1 §4.8.2 (an effective dose); the Mars surface rate
   0.64 mSv/day is the MSL/RAD measurement at Gale Crater (0.64 ± 0.12
   mSv/day dose equivalent, Hassler et al., Science 2014). The MSL/RAD
   cruise value (1.84 ± 0.30 mSv/day dose equivalent, Zeitlin et al.,
   Science 2013) is a transit measurement and is not used for the surface
   environment. The lunar surface rate 1.4 mSv/day matches the Chang'E-4
   LND measurement (~1,369 µSv/day, Science Advances 2020).
*/
'use strict';

const VITALORBIT = (() => {

  /* ---------- Reference ranges / thresholds ---------- */
  const RANGES = {
    hr:     { label: 'Heart rate', unit: 'bpm', low: 60, high: 100, redLow: 50, redHigh: 110, decimals: 0 },
    spo2:   { label: 'Blood oxygen (SpO2)', unit: '%', low: 95, high: 100, redLow: 94, redHigh: 100, decimals: 0 },
    sleep:  { label: 'Sleep (last night)', unit: 'h', low: 7, high: 9, redLow: 5, redHigh: 12, decimals: 1 },
    stress: { label: 'Stress score', unit: '/ 10', low: 0, high: 5, redLow: 0, redHigh: 8.5, decimals: 1, invert: true },
    exercise:{ label: 'Exercise today', unit: 'min', low: 90, high: 150, redLow: 30, redHigh: 240, decimals: 0 },
    radDay: { label: 'Radiation dose today', unit: 'mSv', low: 0, high: null, redLow: 0, redHigh: null, decimals: 2 },
  };

  /* Status of one vital value against its range.
     Returns 'green' | 'amber' | 'red'. */
  function vitalStatus(key, value, env) {
    const r = RANGES[key];
    if (key === 'radDay') {
      const threshold = env ? env.radAlertThreshold : 1.0;
      if (value >= threshold) return 'red';
      if (value >= threshold * 0.8) return 'amber';
      return 'green';
    }
    if (r.invert) {
      if (value > r.redHigh) return 'red';
      if (value > r.high) return 'amber';
      return 'green';
    }
    if (value < r.redLow || value > r.redHigh) return 'red';
    if (value < r.low || value > r.high) return 'amber';
    return 'green';
  }

  function worstStatus(statuses) {
    if (statuses.includes('red')) return 'red';
    if (statuses.includes('amber')) return 'amber';
    return 'green';
  }

  /* Radiation: the daily dose "action level" is set at 90% of a full day at the
     nominal dose rate, so the crew is warned before the day ends: amber at 80%
     of the action level, red when the level is reached. At the 16:45 start time
     (70% of the day) no radiation alert is active; one appears later in the day. */
  const ENVIRONMENTS = {
    spacecraft: {
      id: 'spacecraft', label: 'Spacecraft (transit)', gravity: 'Microgravity (transit)',
      doseRate: 0.6, radAlertThreshold: 0.54, commDelay: 'Near-real-time via relay',
      context: 'Deep-space transit: highest radiation exposure of any phase, microgravity throughout, and no quick return. Health checks are self-reliant: the crew is the first responder.',
      countermeasures: 'Daily 2 h exercise, strict sleep schedule, radiation shelter drills, dosimeter checks at every check-in.',
    },
    iss: {
      id: 'iss', label: 'ISS (low Earth orbit)', gravity: 'Microgravity',
      doseRate: 0.4, radAlertThreshold: 0.36, commDelay: 'Near-real-time',
      context: 'Low Earth orbit: partly shielded by Earth\u2019s magnetic field, so the radiation dose rate is the lowest of the crewed environments here. This demo uses 0.4 mSv/day (dose equivalent) as a simulation assumption: measured dose equivalent inside the station runs higher (about 0.65–0.73 mSv/day in the Columbus laboratory). Microgravity still drives bone and muscle loss; mission control is minutes away.',
      countermeasures: '2 h daily exercise (ARED + treadmill), weekly bone/muscle countermeasure checks, regular video contact with ground and family.',
    },
    moon: {
      id: 'moon', label: 'Moon (surface)', gravity: '1/6 g',
      doseRate: 1.4, radAlertThreshold: 1.26, commDelay: '~1.3 s one-way',
      context: 'Lunar surface: no atmosphere and no magnetic field, so radiation dose is several times higher than on the ISS. Partial gravity (1/6 g) helps, but does not replace exercise.',
      countermeasures: 'Regolith-shielded habitat time, surface-EVA dose budgeting, partial-gravity exercise, dust-exposure checks after every EVA.',
    },
    mars: {
      id: 'mars', label: 'Mars (surface)', gravity: '3/8 g',
      doseRate: 0.64, radAlertThreshold: 0.576, commDelay: '4–24 min one-way',
      context: 'Martian surface: a thin atmosphere and no global magnetic field leave the crew exposed to galactic cosmic rays. MSL/RAD measured 0.64 mSv/day dose equivalent at Gale Crater (Hassler et al., Science, 2014); the higher MSL/RAD cruise value belongs to the transit phase, not the surface. At 3/8 g, with help 4–24 light-minutes away, the crew must detect and act on health changes alone.',
      countermeasures: 'Regolith-shielded habitat time, surface-EVA dose budgeting, autonomous health monitoring (this dashboard), pre-planned medical protocols, strict exercise and sleep discipline.',
    },
  };

  /* ---------- Scenario simulator ----------
     Mission-control what-if scenarios layered on the live simulation.
     'spe' multiplies the radiation dose rate while it is active.
     'co2' is applied to crew vitals by the app layer (falling SpO2, rising
     resting heart rate). Switching back to 'nominal' clears both. */
  const SCENARIOS = {
    nominal: { id: 'nominal', label: 'Nominal Orbit', doseMultiplier: 1 },
    spe: { id: 'spe', label: 'Solar Particle Event', doseMultiplier: 6 },
    co2: { id: 'co2', label: 'CO2 Scrubber Drift', doseMultiplier: 1 },
  };

  /* ---------- Demo crew (fictional) ---------- */
  // history arrays: 7 days, oldest -> newest (today = last entry)
  const DAYS = ['Sol 136', 'Sol 137', 'Sol 138', 'Sol 139', 'Sol 140', 'Sol 141', 'Sol 142'];

  const CREW = [
    {
      id: 'reyes', name: 'Cmdr. A. Reyes', role: 'Commander', initials: 'AR', radFactor: 1.0,
      exerciseAdherence: { 'ex-morning': 1, 'ex-resistive': 1, 'ex-aerobic': 0.5, 'ex-evening': 1 },
      vitals: { hr: 62, spo2: 98, sleep: 7.6, stress: 3.1, exercise: 105, radCumulative: 58.4 },
      history: {
        hr:    [61, 63, 60, 62, 64, 61, 62],
        spo2:  [98, 98, 99, 98, 98, 97, 98],
        sleep: [7.4, 7.8, 7.2, 7.6, 7.9, 7.5, 7.6],
        radDay:[0.38, 0.41, 0.39, 0.42, 0.38, 0.40, 0.28],
      },
      note: 'Steady across all vitals. No open alerts.',
    },
    {
      id: 'chen', name: 'Dr. L. Chen', role: 'Flight Surgeon', initials: 'LC', radFactor: 0.9,
      exerciseAdherence: { 'ex-morning': 1, 'ex-resistive': 1, 'ex-aerobic': 1, 'ex-evening': 1 },
      vitals: { hr: 68, spo2: 97, sleep: 7.1, stress: 4.0, exercise: 120, radCumulative: 57.9 },
      history: {
        hr:    [66, 68, 67, 69, 68, 67, 68],
        spo2:  [98, 97, 98, 97, 98, 98, 97],
        sleep: [7.0, 7.3, 6.9, 7.2, 7.1, 7.0, 7.1],
        radDay:[0.35, 0.36, 0.34, 0.37, 0.35, 0.38, 0.25],
      },
      note: 'Steady. Sleep at the low end of target: watch the trend. Mostly works in the shielded lab module, so daily radiation runs below the crew average.',
    },
    {
      id: 'okafor', name: 'Eng. M. Okafor', role: 'Flight Engineer', initials: 'MO', radFactor: 1.35,
      exerciseAdherence: { 'ex-morning': 0.5, 'ex-resistive': 0.5, 'ex-aerobic': 0, 'ex-evening': 0.5 },
      vitals: { hr: 104, spo2: 96, sleep: 5.4, stress: 7.2, exercise: 45, radCumulative: 59.1 },
      history: {
        hr:    [96, 97, 99, 100, 101, 103, 104],
        spo2:  [98, 97, 97, 96, 97, 96, 96],
        sleep: [6.8, 6.5, 6.2, 6.0, 5.8, 5.6, 5.4],
        radDay:[0.54, 0.53, 0.55, 0.51, 0.57, 0.54, 0.38],
      },
      note: 'Elevated resting heart rate trending up for 7 days, sleep falling. EVA work gives him the highest daily radiation dose of the crew. Several active alerts: see the Alerts panel.',
      highHrStreak: 2, // consecutive readings above 100 bpm at load, so the rule fires immediately
    },
    {
      id: 'novak', name: 'Pilot S. Novak', role: 'Pilot', initials: 'SN', radFactor: 1.1,
      exerciseAdherence: { 'ex-morning': 1, 'ex-resistive': 1, 'ex-aerobic': 0.5, 'ex-evening': 1 },
      vitals: { hr: 71, spo2: 98, sleep: 7.0, stress: 3.8, exercise: 105, radCumulative: 58.0 },
      history: {
        hr:    [70, 72, 71, 69, 72, 70, 71],
        spo2:  [98, 99, 98, 98, 99, 98, 98],
        sleep: [6.9, 7.0, 6.7, 6.8, 7.1, 6.9, 7.0],
        radDay:[0.42, 0.44, 0.43, 0.45, 0.42, 0.43, 0.31],
      },
      note: 'Steady across all vitals. No open alerts.',
    },
  ];

  /* ---------- Exercise sessions ----------
     Exercise is session-based, not random: the mission day has four planned
     sessions and each crew member completes a per-crew fraction of each
     (exerciseAdherence: sessions cut short, or missed entirely, stay
     visible). Minutes logged are a pure, deterministic function of mission
     time: exerciseAt(crew, t) never changes outside a session window, can
     never double-count a session, and resets naturally at day rollover.
     The daily TARGET is 120 min (the ISS ~2 h/day exercise practice); the
     four sessions total 150 planned minutes so the target is reachable
     even when one session is cut short. */
  const EXERCISE_TARGET_MIN = 120;
  const EXERCISE_SESSIONS = [
    { id: 'ex-morning', name: 'Morning mobility + core', start: 375, end: 405, minutes: 30 },
    { id: 'ex-resistive', name: 'Exercise block 1: resistive (ARED)', start: 480, end: 540, minutes: 60 },
    { id: 'ex-aerobic', name: 'Exercise block 2: aerobic', start: 960, end: 990, minutes: 30 },
    { id: 'ex-evening', name: 'Evening aerobic top-up', start: 1140, end: 1170, minutes: 30 },
  ];

  function sessionProgress(session, minutesOfDay) {
    if (minutesOfDay <= session.start) return 0;
    if (minutesOfDay >= session.end) return 1;
    return (minutesOfDay - session.start) / (session.end - session.start);
  }

  function exerciseAdherenceFor(crew, session) {
    const a = crew.exerciseAdherence;
    return a && a[session.id] != null ? a[session.id] : 1;
  }

  /* Total exercise minutes logged by this crew member at a mission time. */
  function exerciseAt(crew, minutesOfDay) {
    let total = 0;
    for (const s of EXERCISE_SESSIONS) {
      total += s.minutes * exerciseAdherenceFor(crew, s) * sessionProgress(s, minutesOfDay);
    }
    return Math.round(total);
  }

  /* Per-session state at a mission time: scheduled | active | complete |
     partial | missed, with the minutes that crew member has logged. */
  function exerciseSessionStates(crew, minutesOfDay) {
    return EXERCISE_SESSIONS.map((s) => {
      const p = sessionProgress(s, minutesOfDay);
      const logged = Math.round(s.minutes * exerciseAdherenceFor(crew, s) * p);
      let state;
      if (minutesOfDay < s.start) state = 'scheduled';
      else if (minutesOfDay < s.end) state = 'active';
      else state = logged >= s.minutes ? 'complete' : logged > 0 ? 'partial' : 'missed';
      return { session: s, state, logged, progress: p };
    });
  }

  /* ---------- Cabin environment (simulated) ----------
     One coherent simulated cabin: baseline air/climate channels plus demo
     watch/action levels for CO2. The CO2 Scrubber Drift scenario drives
     the CO2 channel in the app layer. Baselines and thresholds are
     simulation assumptions (see PARAMETER_BASIS): ISS cabin CO2 in reality
     runs well above terrestrial indoor levels, so these are demo values,
     not NASA limits. */
  const CABIN = {
    baseline: { co2Ppm: 1150, ppo2Kpa: 21.2, pressureKpa: 101.3, tempC: 22.4, humidityPct: 46 },
    co2Watch: 1500, co2Alert: 2500, co2Cap: 3400,
  };

  function cabinStatus(co2Ppm) {
    if (co2Ppm >= CABIN.co2Alert) return 'red';
    if (co2Ppm >= CABIN.co2Watch) return 'amber';
    return 'green';
  }

  /* ---------- 5 Hazards (NASA HRP) ---------- */
  const HAZARDS = [
    {
      id: 'radiation', name: 'Space Radiation',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="1.7"/><path d="M10.75 9.83 L7 3.34 A10 10 0 0 1 17 3.34 L13.25 9.83 A2.5 2.5 0 0 0 10.75 9.83 Z"/><path d="M10.75 9.83 L7 3.34 A10 10 0 0 1 17 3.34 L13.25 9.83 A2.5 2.5 0 0 0 10.75 9.83 Z" transform="rotate(120 12 12)"/><path d="M10.75 9.83 L7 3.34 A10 10 0 0 1 17 3.34 L13.25 9.83 A2.5 2.5 0 0 0 10.75 9.83 Z" transform="rotate(240 12 12)"/></svg>',
      blurb: 'Invisible, and the most menacing of the five hazards: it raises cancer risk, can damage the central nervous system and impair cognition.',
      vitals: ['Radiation dose (today + cumulative)', 'Heart rate', 'Immune markers (tracked via health log)'],
      countermeasure: 'Dosimeter checks at every check-in, shielded-habitat time, EVA dose budgeting.',
      riskFn: (crew, env) => {
        // Per-astronaut: exactly the radiation vital status of THIS crew
        // member, so the hazard panel can never contradict the vitals tile.
        const today = crew.vitals.radDayToday != null ? crew.vitals.radDayToday : env.doseRate * 0.7 * (crew.radFactor || 1);
        return vitalStatus('radDay', today, env);
      },
    },
    {
      id: 'isolation', name: 'Isolation & Confinement',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="2.6"/><path d="M6.8 17.4c1.2-2.4 3-3.5 5.2-3.5s4 1.1 5.2 3.5"/></svg>',
      blurb: 'Months in a small crew, far from home: sleep loss, circadian disruption and work overload can compound into mood and performance problems.',
      vitals: ['Stress score', 'Sleep hours', 'Mood check-ins'],
      countermeasure: 'Scheduled family video calls, private psychological support time, protected sleep window.',
      riskFn: (crew) => {
        // Per-astronaut: THIS crew member's own stress and sleep. (An earlier
        // version averaged stress across the whole crew, which labelled
        // every astronaut with the crew's risk; that was wrong.)
        const stress = crew.vitals.stress;
        const sleep = crew.vitals.sleep;
        if (stress > 7 || sleep < 5.5) return 'red';
        if (stress > 5 || sleep < 6.5) return 'amber';
        return 'green';
      },
    },
    {
      id: 'distance', name: 'Distance from Earth',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="12" r="2.1" fill="currentColor" stroke="none"/><circle cx="20" cy="12" r="1.5" fill="currentColor" stroke="none"/><line x1="7.6" y1="12" x2="16.4" y2="12" stroke-dasharray="2.4 2.6"/></svg>',
      blurb: 'Mars averages about 140 million miles away: a three-year round trip with help minutes to hours away. The crew must be self-sufficient.',
      vitals: ['All vitals (autonomous monitoring)', 'Alert response time'],
      countermeasure: 'Onboard medical protocols, autonomous alerts, pre-packed treatment kits.',
      riskFn: (crew, env) => (env.id === 'mars' ? 'amber' : 'green'),
    },
    {
      id: 'gravity', name: 'Gravity Fields',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11.6"/><path d="M6.8 9.8 12 15l5.2-4.8"/><line x1="4" y1="19.6" x2="20" y2="19.6"/></svg>',
      blurb: 'Microgravity, then 1/6 g or 3/8 g: muscles atrophy, bones lose density, fluids shift, and vision and balance change too.',
      vitals: ['Exercise minutes', 'Heart rate', 'Sleep (fluid-shift effects)'],
      countermeasure: '2 h daily exercise (resistive + aerobic), bone-density tracking, fluid-shift monitoring.',
      riskFn: (crew) => {
        // Per-astronaut: THIS crew member's exercise minutes today.
        const ex = crew.vitals.exercise;
        if (ex < 30) return 'red';
        if (ex < 60) return 'amber';
        return 'green';
      },
    },
    {
      id: 'hostile', name: 'Hostile / Closed Environments',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4"/><path d="M17.7 3.2v3.7h-3.7"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
      blurb: 'The spacecraft is a sealed ecosystem: temperature, pressure, lighting, noise, microbes and air quality all affect health every day.',
      vitals: ['Blood oxygen (SpO2)', 'Sleep quality', 'Stress score'],
      countermeasure: 'Continuous cabin air and CO2 monitoring, lighting tuned to circadian rhythm, noise limits.',
      riskFn: (crew) => {
        // Per-astronaut: THIS crew member's own blood oxygen.
        const o = crew.vitals.spo2;
        if (o < 94) return 'red';
        if (o < 95) return 'amber';
        return 'green';
      },
    },
  ];

  /* ---------- Daily health timeline (mission day, Sol 142) ---------- */
  const TIMELINE = [
    { time: '06:00', title: 'Wake + morning health check-in', detail: 'Vitals snapshot, mood log, dosimeter read', done: true },
    { time: '07:00', title: 'Breakfast + hydration', detail: 'Calorie and fluid targets logged', done: true },
    { time: '08:00', title: 'Exercise block 1: resistive (ARED)', detail: '60 min · bone & muscle countermeasure', done: true, session: 'ex-resistive' },
    { time: '10:00', title: 'Work / science operations', detail: 'Task blocks with 10-min movement breaks', done: true },
    { time: '12:30', title: 'Lunch', detail: 'Nutrition log + fluid top-up', done: true },
    { time: '14:00', title: 'Midday vitals check-in', detail: 'HR + SpO2 re-check', done: false },
    { time: '16:00', title: 'Exercise block 2: aerobic', detail: '30 min · cardiovascular countermeasure', done: true, session: 'ex-aerobic' },
    { time: '17:30', title: 'Evening health log + mood check', detail: 'End-of-day symptom and mood log', done: false },
    { time: '18:00', title: 'Dinner + crew time', detail: 'Shared meal · isolation countermeasure', done: false },
    { time: '19:30', title: 'Video call home', detail: 'Family contact · isolation countermeasure', done: false },
    { time: '21:00', title: 'Wind-down: lights dim, screens off', detail: 'Circadian wind-down routine', done: false },
    { time: '22:00', title: 'Sleep window opens', detail: 'Target 7–9 h · cabin lights to night mode', done: false },
  ];

  /* ---------- Alert engine (pure rules) ---------- */
  // state: per-crew consecutive high-HR readings (seeded in crew data)
  function evaluateAlerts(crew, env, missionDayFraction, scenario) {
    const v = crew.vitals;
    const alerts = [];
    const streak = crew.highHrStreak || 0;

    // Composite fatigue rule, computed first: short sleep + high stress +
    // elevated heart rate together. While this compound alert is active it
    // CONSOLIDATES the overlapping heart-rate, sleep and stress warnings:
    // they are not also raised as separate alerts, so the crew member gets
    // one consolidated red alert instead of three amber ones plus the
    // compound. The compound detail carries all three values, so no
    // information is lost. Independent alerts (oxygen, radiation, exercise,
    // scenario events) still fire separately.
    const compound = v.sleep < 6 && v.stress > 7 && v.hr > 100;

    if (!compound) {
    if (v.hr > 110) {
      alerts.push({ severity: 'red', code: 'HR-HIGH',
        title: 'Resting heart rate critically high',
        detail: crew.name + ': ' + v.hr + ' bpm (safe 60–100 bpm).',
        action: 'Stop exertion now, sit and rest, re-check in 10 min. If it stays above 110 bpm, alert the flight surgeon immediately.' });
    } else if (v.hr > 100 && streak >= 2) {
      alerts.push({ severity: 'amber', code: 'HR-ELEVATED',
        title: 'Elevated resting heart rate',
        detail: crew.name + ': ' + v.hr + ' bpm for ' + streak + ' consecutive readings (safe 60–100 bpm), trending up over 7 days.',
        action: 'Rest, hydrate, re-check in 30 min. No heavy exercise until heart rate is back under 100 bpm.' });
    }
    if (v.spo2 < 94) {
      alerts.push({ severity: 'red', code: 'SPO2-LOW',
        title: 'Blood oxygen critically low',
        detail: crew.name + ': SpO2 ' + v.spo2 + '% (safe 95–100%).',
        action: 'Check sensor placement, take slow deep breaths, re-check in 5 min. If still below 94%, alert the flight surgeon immediately.' });
    } else if (v.spo2 < 95) {
      alerts.push({ severity: 'amber', code: 'SPO2-WATCH',
        title: 'Blood oxygen below target',
        detail: crew.name + ': SpO2 ' + v.spo2 + '% (safe 95–100%).',
        action: 'Re-check sensor fit, rest and re-measure in 15 min.' });
    }
    if (v.sleep < 5) {
      alerts.push({ severity: 'red', code: 'SLEEP-CRITICAL',
        title: 'Severely short sleep',
        detail: crew.name + ': ' + v.sleep.toFixed(1) + ' h last night (target 7–9 h).',
        action: 'Protect tonight\u2019s sleep window, no caffeine after midday, tell the flight surgeon before the next work block.' });
    } else if (v.sleep < 6) {
      alerts.push({ severity: 'amber', code: 'SLEEP-SHORT',
        title: 'Short sleep last night',
        detail: crew.name + ': ' + v.sleep.toFixed(1) + ' h last night (target 7–9 h), falling for 7 days.',
        action: 'Protect tonight\u2019s sleep window (22:00), dim lights at 21:00, avoid caffeine after midday.' });
    }
    if (v.stress > 8.5) {
      alerts.push({ severity: 'red', code: 'STRESS-HIGH',
        title: 'Stress score critically high',
        detail: crew.name + ': stress ' + v.stress.toFixed(1) + ' / 10.',
        action: 'Take a break now, talk to a crewmate or the flight surgeon, use the scheduled video call home.' });
    } else if (v.stress > 7) {
      alerts.push({ severity: 'amber', code: 'STRESS-ELEVATED',
        title: 'Stress score elevated',
        detail: crew.name + ': stress ' + v.stress.toFixed(1) + ' / 10 (target 5 or below).',
        action: 'Take a 15-min break, light activity or music, and keep the 19:30 video call home.' });
    }
    }
    // Composite rule: three borderline vitals together are worse than any one
    // alone. Short sleep + high stress + elevated resting heart rate multiply
    // fatigue and cardiac strain, so they raise ONE high-priority alert that
    // consolidates the component warnings above (see the note at the top of
    // this function).
    if (compound) {
      alerts.push({ severity: 'red', code: 'COMPOUND-FATIGUE',
        title: 'Compound Fatigue & Cardiovascular Strain',
        detail: crew.name + ': sleep ' + v.sleep.toFixed(1) + ' h, stress ' + v.stress.toFixed(1) + ' / 10 and resting heart rate ' + v.hr + ' bpm at the same time. Each alone is a watch item; combined they multiply fatigue and cardiac strain.',
        action: 'Cancel non-essential work, no heavy resistive exercise today, hydrate, and take a protected rest period. The flight surgeon reviews before the next work block.' });
    }
    if (missionDayFraction > 0.6 && v.exercise < 60) {
      alerts.push({ severity: 'amber', code: 'EXERCISE-BEHIND',
        title: 'Exercise behind schedule',
        detail: crew.name + ': only ' + v.exercise + ' min today (target 120 min).',
        action: 'Fit in a 30-min aerobic session before dinner: exercise is the main countermeasure for bone and muscle loss.' });
    }
    // Radiation is per-crew: each member's exposure factor (EVA work, time in
    // shielded modules) scales the environment dose rate, and an active solar
    // particle event multiplies the rate itself.
    const doseRate = env.doseRate * (scenario && SCENARIOS[scenario] ? SCENARIOS[scenario].doseMultiplier : 1);
    const radToday = doseRate * missionDayFraction * (crew.radFactor || 1);
    if (radToday >= env.radAlertThreshold) {
      alerts.push({ severity: 'red', code: 'RAD-DAILY',
        title: 'Daily radiation dose over the planned action level',
        detail: crew.name + ': ' + radToday.toFixed(2) + ' mSv today (action level ' + env.radAlertThreshold.toFixed(2) + ' mSv).',
        action: 'Move to the shielded part of the habitat, postpone any EVA, and log the exposure with the flight surgeon.' });
    } else if (radToday >= env.radAlertThreshold * 0.8) {
      alerts.push({ severity: 'amber', code: 'RAD-WATCH',
        title: 'Radiation dose approaching the daily action level',
        detail: crew.name + ': ' + radToday.toFixed(2) + ' mSv today, ' + Math.round((radToday / env.radAlertThreshold) * 100) + '% of the ' + env.radAlertThreshold.toFixed(2) + ' mSv action level.',
        action: 'Stay in shielded areas for the rest of the day and avoid non-essential EVA.' });
    }
    if (scenario === 'spe') {
      alerts.push({ severity: 'red', code: 'SPE-EVENT',
        title: 'Solar particle event: radiation surge',
        detail: crew.name + ': incoming solar particle event. The dose rate is running at ' + doseRate.toFixed(1) + ' mSv/day and today\u2019s dose is already ' + radToday.toFixed(2) + ' mSv.',
        action: 'Move to shielded module now and stay there until the event passes. Postpone all EVA and log the exposure with the flight surgeon.' });
    }
    if (scenario === 'co2') {
      alerts.push({ severity: 'red', code: 'CO2-DRIFT',
        title: 'CO2 scrubber drift: cabin air quality falling',
        detail: crew.name + ': CO2 removal is drifting off nominal. Watch for falling SpO2 and rising resting heart rate across the crew.',
        action: 'Switch to the backup CO2 scrubber, increase cabin ventilation, and re-check SpO2 every 15 min until levels recover.' });
    }
    return alerts;
  }

  /* ---------- Health chatbot Q&A (rule-based) ---------- */
  const CHATBOT_QA = [
    { keys: ['heart rate', 'heart', 'pulse', 'hr high', 'bpm'],
      q: 'Why is my heart rate high in space?',
      a: 'Fluid shifts and deconditioning in microgravity change how hard your heart works, and stress, poor sleep or dehydration can push resting heart rate up. A short rise after exercise is normal; a resting rate above 100 bpm needs a rest and a re-check.',
      learn: 'Heart rate is a window into cardiovascular deconditioning, one of the effects the Human Research Program tracks.' },
    { keys: ['exercise', 'workout', 'work out', 'how much exercise', 'ared', 'treadmill'],
      q: 'How much exercise do I need?',
      a: 'About 2 hours a day: roughly 60 minutes of resistive exercise (ARED) plus 30–60 minutes of aerobic work. It is the main countermeasure for muscle atrophy and bone loss.',
      learn: 'Without countermeasures, astronauts can lose 1–2% of bone density per month in microgravity.' },
    { keys: ['sleep', 'sleep better', 'insomnia', 'tired', 'microgravity sleep'],
      q: 'How do I sleep better in microgravity?',
      a: 'Keep a fixed sleep window (22:00–06:00 here), dim lights at 21:00, use your sleep restraint and eye mask, avoid caffeine after midday, and keep the cabin cool and quiet.',
      learn: 'Sleep loss and circadian disruption are a recognised risk under the isolation and confinement hazard.' },
    { keys: ['radiation', 'dose', 'msv', 'rad'],
      q: 'What is my radiation dose today?',
      a: 'Check your vitals panel: it shows today\u2019s dose and your cumulative mission dose. For the ISS this demo uses 0.4 mSv per day (dose equivalent, a simulation assumption); measured dose equivalent inside the station runs higher, about 0.65–0.73 mSv per day in the Columbus laboratory measurements. Deep-space transit is higher still in this simulation. Your daily action level is shown for the current environment.',
      learn: 'NASA\u2019s career exposure limit is 600 mSv effective dose (NASA-STD-3001). The dose figures in this demo are dose equivalent, a different quantity, so the app does not project a time to that limit.' },
    { keys: ['oxygen', 'spo2', 'sp o2', 'breath', 'low oxygen'],
      q: 'What if my blood oxygen (SpO2) is low?',
      a: 'First check the sensor is fitted properly, sit down and take slow deep breaths, then re-measure in 5 minutes. Below 95% is a watch level; below 94% is an alert: tell the flight surgeon.',
      learn: 'SpO2 is a fast check on how well the closed cabin environment is supporting you.' },
    { keys: ['bone', 'bones', 'bone loss', 'density'],
      q: 'Why do astronauts lose bone in space?',
      a: 'Without gravity loading your skeleton, bone is broken down faster than it is rebuilt, especially in the hips and spine. Resistive exercise, good nutrition (calcium, vitamin D) and, in future, artificial gravity are the countermeasures.',
      learn: 'Bone loss is a core effect of the gravity-fields hazard.' },
    { keys: ['muscle', 'atrophy', 'weak'],
      q: 'How do I stop muscle loss in space?',
      a: 'Daily resistive exercise on ARED plus aerobic work, enough protein, and moving often during the day. Your exercise minutes are tracked on this dashboard for exactly this reason.',
      learn: 'Muscle atrophy is fastest in the legs and back: the muscles gravity normally loads.' },
    { keys: ['lonely', 'isolation', 'alone', 'mood', 'homesick', 'depressed', 'sad'],
      q: 'I feel isolated. What helps?',
      a: 'Talk to a crewmate, use your scheduled video call home (19:30), keep a routine, and get daylight-spectrum light in the morning. If low mood lasts more than a few days, tell the flight surgeon: it is a health issue, not a weakness.',
      learn: 'Isolation and confinement is one of the five hazards; crew cohesion is a countermeasure.' },
    { keys: ['food', 'eat', 'meal', 'nutrition', 'diet'],
      q: 'What should I eat on a mission?',
      a: 'Follow the planned menu: enough calories for your workload, good protein for muscle, calcium and vitamin D for bone, and plenty of fluids. Log every meal in the timeline so intake stays visible.',
      learn: 'Nutrition is a countermeasure: it works together with exercise, not instead of it.' },
    { keys: ['water', 'hydration', 'drink', 'dehydrated', 'thirsty'],
      q: 'How much water do I need?',
      a: 'Roughly 2–3 litres a day, more on heavy exercise days. In space, thirst is a poor guide, so drink on schedule and log it. Dark urine or a headache can mean you are behind on fluids.',
      learn: 'Dehydration raises heart rate and worsens fatigue, so it shows up in your vitals first.' },
    { keys: ['eye', 'vision', 'eyesight', 'blurry', 'sans'],
      q: 'Why is my vision changing?',
      a: 'Fluid shifting towards the head in microgravity can change eye shape and pressure (spaceflight-associated neuro-ocular syndrome). Report any blurry vision or headaches promptly: do not wait for the next check-in.',
      learn: 'Vision changes are one of the effects the Human Research Program studies under gravity fields.' },
    { keys: ['stress', 'anxious', 'anxiety', 'worried', 'overwhelmed'],
      q: 'I feel stressed. What can I do right now?',
      a: 'Stop, breathe slowly for two minutes, step away from the task, and talk to a crewmate. Then check the timeline: a break, a meal or the video call home often helps. Persistent stress above 7/10 raises an alert here.',
      learn: 'Stress is tracked because it affects sleep, heart rate and performance together.' },
    { keys: ['emergency', 'chest pain', 'unwell', 'sick', 'help', 'pain', 'hurt', 'injured'],
      q: 'I feel unwell. What do I do?',
      a: 'Stop what you are doing, sit or lie down, and alert the flight surgeon and the commander immediately. Do not try to diagnose yourself: a real person must respond.',
      learn: 'Distance from Earth means the crew is the first responder; that is why alerts here are plain-language actions.' },
    { keys: ['vitalorbit', 'how does this work', 'how it works', 'what is this', 'dashboard'],
      q: 'How does VitalOrbit work?',
      a: 'It watches the crew\u2019s vitals (heart rate, oxygen, sleep, stress, exercise, radiation), colours each one green, amber or red against safe ranges, charts 7-day trends, and fires plain-language alerts with an action. Everything runs locally in your browser.',
      learn: 'Colour-first status means a problem is visible at a glance, exactly what the challenge asked for.' },
    { keys: ['missed exercise', 'behind', 'skipped', 'no exercise'],
      q: 'I missed my exercise session. Does it matter?',
      a: 'One missed session is not a crisis, but exercise is your main defence against bone and muscle loss, so catch up with a shorter session today and keep the next one. If you are behind schedule, VitalOrbit raises an amber alert.',
      learn: 'Consistency matters more than any single session: the 7-day chart shows the pattern.' },
    { keys: ['mars', 'moon', 'difference', 'environment'],
      q: 'How does health risk change between the ISS, Moon and Mars?',
      a: 'Use the environment switcher above: radiation dose rises sharply beyond low Earth orbit, gravity changes from zero to 1/6 g (Moon) to 3/8 g (Mars), and help goes from minutes away to 4–24 light-minutes away on Mars.',
      learn: 'That is why the same dashboard shows a different hazard picture for each environment.' },
    { keys: ['immune', 'immunity', 'sick', 'infection', 'cold'],
      q: 'Does spaceflight affect my immune system?',
      a: 'Yes: stress, disrupted sleep and radiation can all weaken immune responses, and a closed cabin means germs circulate. Sleep, exercise, good food and hand hygiene are the practical defences.',
      learn: 'Immune changes are studied through the Human Research Program and the Open Science Data Repository.' },
    { keys: ['circadian', 'body clock', 'jet lag', 'light', 'schedule'],
      q: 'How do I keep my body clock on track?',
      a: 'Fixed wake/sleep times, bright light in the morning, dim light after 21:00, meals at the same times each day, and exercise earlier rather than right before bed.',
      learn: 'On the ISS the sun rises every 90 minutes, so the schedule, not the window, sets your clock.' },
  ];

  function answerChatbot(question) {
    const q = question.toLowerCase();
    let best = null, bestScore = 0;
    for (const item of CHATBOT_QA) {
      let score = 0;
      for (const k of item.keys) {
        if (q.includes(k)) score += k.split(' ').length + 1;
      }
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best) return { q: best.q, a: best.a, learn: best.learn };
    return {
      q: null,
      a: 'I can answer questions about heart rate, sleep, exercise, radiation dose, oxygen, bone and muscle health, stress, isolation, food and water, vision, and emergencies. Try one of the quick questions below, or ask e.g. "How much exercise do I need?"',
      learn: 'If you feel unwell, alert the flight surgeon straight away.',
    };
  }

  /* ---------- Chatbot live-state answers ----------
     First pass: questions about the SELECTED crew member's own current state
     are answered from their live values, not the generic Q&A bank. Returns
     null when the question is not about that crew member's own state, so the
     caller falls through to answerChatbot. */
  function answerLiveState(question, crew, radToday, env) {
    const q = ' ' + question.toLowerCase().trim() + ' ';
    const mentions = {
      hr: /\b(heart rate|pulse|hr|bpm)\b/.test(q),
      spo2: /\b(oxygen|spo2|sp o2|breathing)\b/.test(q),
      sleep: /\b(sleep|slept|rest)\b/.test(q),
      stress: /\b(stress|anxiety|anxious)\b/.test(q),
      exercise: /\b(exercise|workout|training)\b/.test(q),
      rad: /\b(radiation|dose|msv)\b/.test(q),
    };
    const anyMention = Object.keys(mentions).some((k) => mentions[k]);
    const general = /\b(how am i|how do i look|check my vitals|my vitals|my health|my status|am i ok|am i okay|how are my)\b/.test(q);
    if (!general) {
      // Knowledge / advice questions ("why is...", "how do I sleep better...",
      // "how much exercise...") belong to the Q&A bank, not the live pass.
      if (/\bwhy\b/.test(q) || /\bhow (do|can|could) i\b/.test(q) || /\bhow much\b/.test(q)) return null;
      const ownState = /\bmy\b/.test(q) || /\b(am i|did i|have i)\b/.test(q);
      if (!(anyMention && ownState)) return null;
    }

    const v = crew.vitals;
    const parts = crew.name.split(' ');
    const address = parts[0] + ' ' + parts[parts.length - 1];
    const showAll = general || !anyMention;
    const sentences = [];
    const advice = [];
    if (showAll || mentions.hr) {
      const verdict = v.hr > 100 ? 'above the 100 bpm limit' : v.hr < 60 ? 'below the 60 bpm floor' : 'inside the safe 60 to 100 bpm range';
      sentences.push('your resting heart rate is currently ' + v.hr + ' bpm (' + verdict + ')');
      if (v.hr > 100) advice.push('rest, hydrate, and re-check in 30 min');
    }
    if (showAll || mentions.spo2) {
      const verdict = v.spo2 >= 95 ? 'inside the safe 95 to 100% range' : 'below the 95% target';
      sentences.push('your SpO2 is ' + v.spo2 + '% (' + verdict + ')');
      if (v.spo2 < 95) advice.push('check the sensor fit and re-measure in 15 min');
    }
    if (showAll || mentions.sleep) {
      sentences.push('you slept ' + v.sleep.toFixed(1) + ' h last night (target 7 to 9 h)');
      if (v.sleep < 6) advice.push('protect tonight\u2019s sleep window');
    }
    if (showAll || mentions.stress) {
      sentences.push('your stress score is ' + v.stress.toFixed(1) + ' / 10 (target 5 or below)');
      if (v.stress > 7) advice.push('take a break and talk to a crewmate');
    }
    if (showAll || mentions.exercise) {
      sentences.push('you have logged ' + v.exercise + ' min of exercise today (target 120 min)');
      if (v.exercise < 60) advice.push('fit in a 30 min aerobic session before dinner');
    }
    if (showAll || mentions.rad) {
      sentences.push('your radiation dose today is ' + radToday.toFixed(2) + ' mSv (daily action level ' + env.radAlertThreshold.toFixed(2) + ' mSv here)');
      if (radToday >= env.radAlertThreshold * 0.8) advice.push('stay in shielded areas for the rest of the day');
    }
    if (v.hr > 100 && v.sleep < 6) advice.unshift('skip today\u2019s heavy resistive workout');
    let text = address + ', ' + sentences.join('; ') + '.';
    const uniqueAdvice = [...new Set(advice)].slice(0, 3);
    if (uniqueAdvice.length) {
      const joined = uniqueAdvice.join('; ');
      text += ' ' + joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
    } else {
      text += ' Everything is in range: keep the routine going.';
    }
    return { q: null, a: text, learn: 'This answer reads the live panel values of the selected crew member.' };
  }

  /* ---------- Sources ----------
     Resource links as listed on the challenge's official Resources tab
     (verified live from spaceappschallenge.org), plus the open HRP data
     portals. No logos or branding — text links only. */
  const SOURCES = [
    { name: '5 Hazards of Human Spaceflight · NASA Human Research Program', url: 'https://www.nasa.gov/hrp/hazards/' },
    { name: 'Risks of Human Spaceflight · NASA Human Research Program', url: 'https://www.nasa.gov/hrp/risks/' },
    { name: 'Ongoing HRP Research in Space · NASA Human Research Program', url: 'https://www.nasa.gov/hrp/ongoing-hrp-research/' },
    { name: 'Monitoring Radiation for Astronaut Health · Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp' },
    { name: 'NASA Open Science Data Repository (OSDR)', url: 'https://osdr.nasa.gov' },
    { name: 'NASA Life Sciences Portal (NLSP)', url: 'https://nlsp.nasa.gov' },
  ];

  /* ---------- Methodology: what every parameter is based on ----------
     basis is one of: 'Published reference range' | 'NASA requirement' |
     'NASA operational practice' | 'Published measurement' |
     'Simulation assumption'. Rendered in the app under Data & resources. */
  const PARAMETER_BASIS = [
    { param: 'Resting heart rate 60-100 bpm', basis: 'Published reference range', source: 'Standard adult clinical range (Earth clinical reference; spaceflight resting HR varies with fluid shifts and deconditioning)', ref: 'clinical-ranges' },
    { param: 'Blood oxygen (SpO2) 95-100%', basis: 'Published reference range', source: 'Standard adult clinical range (Earth clinical reference)', ref: 'clinical-ranges' },
    { param: 'Sleep target 7-9 h per night', basis: 'Published reference range', source: 'General adult guidance; NASA schedules an 8.5 h sleep opportunity aboard ISS', ref: 'clinical-ranges' },
    { param: 'Exercise target 120 min/day', basis: 'NASA operational practice', source: 'ISS crew exercise runs about 2 h per day (resistive + aerobic countermeasures)', ref: 'hrp-hazards' },
    { param: 'Radiation career limit 600 mSv (effective dose)', basis: 'NASA requirement', source: 'NASA-STD-3001 Vol 1 Rev C, section 4.8.2 [V1 4030] (career effective dose, all ages and sexes)', ref: 'nasa-std-3001' },
    { param: 'ISS dose rate 0.4 mSv/day', basis: 'Simulation assumption', source: 'Demo value in dose equivalent. It is NOT drawn from the published ISS effective-dose planning range (about 0.2-0.5 mSv/day, NASA OCHMO TB-020): effective dose and dose equivalent are different quantities and are never mixed here. Measured dose equivalent inside the Columbus laboratory is higher, and varies with detector location, shielding and solar cycle: up to 647 microSv/day (DOSTEL, May 2016; Berger et al., J Space Weather Space Clim 7, A8, 2017) and 731 microSv/day in early 2019 (DOSIS 3D, reported in Zhang et al., Science Advances, 2020). The demo keeps 0.4 as a labelled assumption so the ISS remains the lowest-dose crewed environment in the simulation', ref: 'zhang-2020' },
    { param: 'Moon dose rate 1.4 mSv/day', basis: 'Published measurement', source: "Chang'E-4 Lunar Lander Neutrons and Dosimetry: about 1,369 microSv/day on the surface (Science Advances, 2020)", ref: 'zhang-2020' },
    { param: 'Mars dose rate 0.64 mSv/day', basis: 'Published measurement', source: 'Mars surface dose equivalent measured by the MSL Radiation Assessment Detector at Gale Crater: 0.64 +/- 0.12 mSv/day (Hassler et al., Science, 2014). The same instrument measured 1.84 +/- 0.30 mSv/day dose equivalent during the cruise to Mars (Zeitlin et al., Science, 2013); that transit value is not used for this surface environment', ref: 'zeitlin-2013' },
    { param: 'Spacecraft transit dose rate 0.6 mSv/day', basis: 'Simulation assumption', source: 'Planning value between the LEO and lunar rates; no single published constant' },
    { param: 'Daily dose action levels (90% of a nominal day, in mSv)', basis: 'Simulation assumption', source: 'Internal demo thresholds for the dashboard, not NASA limits. Each action level is an accumulated dose in mSv (90% of one full day at the environment rate), compared against the dose accumulated so far today; it is not a dose rate. The dose projection shown in the app is rate-times-time arithmetic on these rates, to the daily action level only: an estimate, not a forecast. No time-to-career-limit estimate is computed: the 600 mSv career limit is an effective dose and these rates are dose equivalent, and the two quantities cannot be divided into each other without a validated conversion' },
    { param: 'Solar Particle Event dose multiplier x6', basis: 'Simulation assumption', source: 'Event strength varies widely; NASA-STD-3001 separately requires crew protection to under 250 mSv for a design-reference SPE', ref: 'nasa-std-3001' },
    { param: 'Per-crew exposure factors 0.9-1.35 (EVA vs shielded time)', basis: 'Simulation assumption', source: 'Models different EVA and shielding exposure across the demo crew' },
    { param: 'Stress scale cut-offs (watch above 5, elevated above 7, critical above 8.5 of 10)', basis: 'Simulation assumption', source: 'Self-reported demo scale; NASA uses validated instruments, not a single 0-10 cut-off' },
    { param: 'Cabin baselines and CO2 watch/action levels (1,500 / 2,500 ppm)', basis: 'Simulation assumption', source: 'Demo cabin values; real ISS CO2 runs higher than terrestrial indoor levels, and flight limits are set as CO2 partial pressure in NASA-STD-3001 Vol 2, not as these demo ppm levels. Pressure (101.3 kPa), oxygen partial pressure (21.2 kPa), temperature and humidity baselines are sea-level/comfort references, not flight set points' },
  ];

  /* ---------- Full source references ----------
     Only sources actually verified against the publisher or the paper
     itself are listed, with the parameter(s) each one supports. */
  const REFERENCES = [
    { id: 'nasa-std-3001', title: 'NASA-STD-3001, Volume 1, Revision C: Crew Health (Human System Standard), requirements [V1 4030] career exposure limit and [V1 4031] solar particle event protection; summarised in OCHMO Technical Brief OCHMO-TB-020 Rev G, Design for Ionizing Radiation Protection', publisher: 'NASA Office of the Chief Health and Medical Officer (OCHMO)', year: '2025 (brief, Rev G)', url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-020-radiation-protection.pdf', supports: 'Career limit 600 mSv; design-reference SPE protection under 250 mSv' },
    { id: 'zeitlin-2013', title: 'MSL/RAD papers: Measurements of Energetic Particle Radiation in Transit to Mars on the Mars Science Laboratory (Zeitlin et al., 2013); Mars\' Surface Radiation Environment Measure with the Mars Science Laboratory\'s Radiation Assessment Detector (Hassler et al., 2014)', publisher: 'Science, AAAS', year: '2013 / 2014', url: 'https://doi.org/10.1126/science.1235989', supports: 'MSL/RAD dose-equivalent rates: Mars cruise (transit) 1.84 +/- 0.30 mSv/day (Zeitlin et al., Science 340, 2013; DOI 10.1126/science.1235989) and Mars surface at Gale Crater 0.64 +/- 0.12 mSv/day (Hassler et al., Science 343, 2014; DOI 10.1126/science.1244797)' },
    { id: 'zhang-2020', title: 'First measurements of the radiation dose on the lunar surface', publisher: 'Science Advances 6 (39), eaaz1334, AAAS', year: '2020', url: 'https://www.science.org/doi/full/10.1126/sciadv.aaz1334', supports: 'Lunar surface dose equivalent about 1,369 microSv/day (Chang\'E-4 LND); the same paper reports the DOSIS 3D dose equivalent onboard the ISS as 731 microSv/day for the same period (early 2019)' },
    { id: 'hrp-hazards', title: '5 Hazards of Human Spaceflight; Risks of Human Spaceflight; Ongoing HRP Research in Space', publisher: 'NASA Human Research Program', year: 'accessed 2026', url: 'https://www.nasa.gov/hrp/hazards/', supports: 'Five-hazards framework, hazard effects, ISS countermeasure practice (about 2 h/day exercise, 8.5 h sleep opportunity)' },
    { id: 'csa-radiation', title: 'Monitoring Radiation for Astronaut Health', publisher: 'Canadian Space Agency', year: '2026', url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp', supports: 'General context on how radiation is monitored for astronaut health aboard the ISS. It publishes no numeric dose range and is not the source of any dose value in this app' },
    { id: 'clinical-ranges', title: 'Standard adult clinical reference ranges: resting heart rate 60-100 bpm, SpO2 95-100%, adult sleep 7-9 h', publisher: 'Clinical reference consensus (Earth-based; e.g. AHA resting heart-rate guidance, CDC adult sleep guidance)', year: 'accessed 2026', url: '', supports: 'Heart rate, SpO2 and sleep reference ranges. These are Earth clinical references, not spaceflight limits' },
    { id: 'osdr', title: 'NASA Open Science Data Repository (OSDR) and NASA Life Sciences Portal (NLSP)', publisher: 'NASA', year: 'accessed 2026', url: 'https://osdr.nasa.gov', supports: 'Background HRP data portals consulted for reference ranges and findings; no dataset is integrated into this demo (see README, simulation model)' },
  ];

  /* ---------- Data provenance ----------
     Every value the dashboard shows carries one of these tags, so a reader
     can tell at a glance what kind of number it is. Nothing on this page is
     a real measurement: SIMULATED values are generated demo readings,
     DERIVED values are computed from simulated inputs by a stated rule, and
     ESTIMATE values are arithmetic extrapolations of a simulated rate. */
  const PROVENANCE = {
    simulated: { tag: 'SIMULATED', note: 'Generated demo value, not a measurement' },
    derived: { tag: 'DERIVED', note: 'Computed from simulated inputs by the stated rule' },
    estimate: { tag: 'ESTIMATE', note: 'Extrapolated from a simulated rate, not a forecast' },
  };

  /* ---------- Radiation dose projection (transparent estimate) ----------
     Pure arithmetic on the simulated dose rate: at the CURRENT rate, how
     long until today's dose reaches the daily action level. That is the
     only time projection offered, because its input, threshold and output
     are one and the same quantity (simulated dose equivalent).
     NO time-to-career-limit estimate is computed: the 600 mSv career
     reference (NASA-STD-3001) is an EFFECTIVE dose, while every rate
     simulated here is a DOSE EQUIVALENT rate, and dividing one quantity
     by the other is not valid without a validated conversion model,
     which this demo does not apply. careerEstimate therefore reports
     'unavailable' with the reason, and the UI and chatbot say so plainly.
     The daily estimate is an extrapolation of demo data, labelled
     ESTIMATE everywhere it appears. It is not a forecast: real dose
     rates vary with orbit, shielding, solar activity and EVA schedule. */
  const CAREER_ESTIMATE_NOTE = 'No time estimate is available for the 600 mSv career reference: that NASA-STD-3001 limit is an effective dose, while the dose rates simulated here are dose equivalent. Dividing the remaining effective-dose margin by a dose-equivalent rate would mix two different quantities, so no career projection is shown.';
  function doseProjection(crew, env, scenario, missionDayFraction) {
    const mult = scenario && SCENARIOS[scenario] ? SCENARIOS[scenario].doseMultiplier : 1;
    const ratePerDay = env.doseRate * mult * (crew.radFactor || 1);
    const todaySoFar = ratePerDay * missionDayFraction;
    const remainingToday = env.radAlertThreshold - todaySoFar;
    const hoursToActionLevel = ratePerDay > 0 && remainingToday > 0
      ? (remainingToday / ratePerDay) * 24 : null; // null = already reached (or no rate)
    return {
      ratePerDay, todaySoFar, actionLevel: env.radAlertThreshold,
      hoursToActionLevel,
      careerEstimate: 'unavailable',
      careerNote: CAREER_ESTIMATE_NOTE,
      provenance: 'estimate',
    };
  }

  /* ---------- 7-day trend directions (transparent estimate) ----------
     Direction only: compares the mean of the first three days with the
     mean of the last three days of the seeded 7-day history. A series is
     'steady' when the difference is inside a small dead-band. No model is
     fitted and no accuracy is claimed; this describes the demo history,
     it does not predict tomorrow. */
  function seriesDirection(values, deadBand) {
    const n = values.length;
    const first = values.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const last = values.slice(n - 3).reduce((a, b) => a + b, 0) / 3;
    const delta = +(last - first).toFixed(2);
    if (delta > deadBand) return { direction: 'rising', delta };
    if (delta < -deadBand) return { direction: 'falling', delta };
    return { direction: 'steady', delta };
  }

  function trendDirections(crew) {
    const hr = seriesDirection(crew.history.hr, 1);
    const sleep = seriesDirection(crew.history.sleep, 0.2);
    const spo2 = seriesDirection(crew.history.spo2, 0.4);
    // Fatigue direction combines the two fatigue inputs that have a
    // history: worsening = sleep falling while heart rate rises.
    let fatigue = 'steady';
    if (sleep.direction === 'falling' && hr.direction === 'rising') fatigue = 'worsening';
    else if (sleep.direction === 'rising' && hr.direction === 'falling') fatigue = 'improving';
    else if (sleep.direction === 'falling' || hr.direction === 'rising') fatigue = 'mixed, leaning worse';
    else if (sleep.direction === 'rising' || hr.direction === 'falling') fatigue = 'mixed, leaning better';
    // Exercise adherence: fraction of planned minutes actually logged in
    // the sessions that have already ended today (deterministic model).
    return { hr, sleep, spo2, fatigue };
  }

  function exerciseAdherenceSummary(crew, minutesOfDay) {
    const states = exerciseSessionStates(crew, minutesOfDay);
    const ended = states.filter((s) => s.state === 'complete' || s.state === 'partial' || s.state === 'missed');
    const planned = ended.reduce((a, s) => a + s.session.minutes, 0);
    const logged = ended.reduce((a, s) => a + s.logged, 0);
    return { endedSessions: ended.length, planned, logged, fraction: planned ? logged / planned : 1 };
  }

  /* ---------- Explainable hazard detail ----------
     For each hazard: the exact inputs used, the rule in plain words, the
     threshold state for THIS astronaut, the evidence basis, and the
     countermeasure information the dashboard tracks. No weighted scores:
     every risk is the direct output of the stated rule on the stated
     inputs, and the crew worst case stays a separate line in the UI. */
  function hazardExplain(hazard, crew, env) {
    const v = crew.vitals;
    const risk = hazard.riskFn(crew, env);
    const head = { hazard: hazard.name, astronaut: crew.name, risk };
    const word = (s) => (s === 'red' ? 'Alert' : s === 'amber' ? 'Watch' : 'In range');
    switch (hazard.id) {
      case 'radiation': {
        const today = v.radDayToday != null ? v.radDayToday : env.doseRate * 0.7 * (crew.radFactor || 1);
        return { ...head,
          inputs: ['Radiation dose today for ' + crew.name + ': ' + today.toFixed(2) + ' mSv (dose equivalent, simulated)', 'Environment dose rate: ' + env.doseRate.toFixed(2) + ' mSv/day dose equivalent (' + env.label + ')', 'Exposure factor for this astronaut: ' + (crew.radFactor || 1)],
          rule: 'Watch at 80% of the daily action level (' + env.radAlertThreshold.toFixed(2) + ' mSv), Alert at or above it. This is the same rule as the radiation vital tile, so the two can never disagree.',
          status: 'Dose today is ' + Math.round((today / env.radAlertThreshold) * 100) + '% of the action level, so this hazard is ' + word(risk) + ' for ' + crew.name + '.',
          evidence: 'Daily action levels are simulation assumptions (demo thresholds, not NASA limits). The environment dose rates rest on published measurements and ranges (see Methodology): MSL/RAD for the Mars surface (Hassler et al. 2014; the same instrument\'s cruise value, Zeitlin et al. 2013, is a transit measurement), Chang\'E-4 LND for the Moon. The ISS rate is a simulation assumption in dose equivalent, set below the dose equivalent actually measured inside the Columbus laboratory (Berger et al. 2017; Zhang et al. 2020) and labelled as an assumption in Methodology; the published ISS effective-dose planning range is a different quantity and is never used as dose-equivalent support. Every simulated dose figure in this app is dose equivalent; the 600 mSv career limit is an effective dose and a NASA requirement (NASA-STD-3001 Vol 1 Rev C, section 4.8.2), so no time-to-career-limit estimate is shown.',
          mitigation: hazard.countermeasure };
      }
      case 'isolation': {
        return { ...head,
          inputs: ['Stress score: ' + v.stress.toFixed(1) + ' / 10', 'Sleep last night: ' + v.sleep.toFixed(1) + ' h'],
          rule: 'Alert when stress is above 7 or sleep under 5.5 h; Watch when stress is above 5 or sleep under 6.5 h. Only this astronaut\'s own values are used, never a crew average.',
          status: 'Stress ' + v.stress.toFixed(1) + ' / 10 and sleep ' + v.sleep.toFixed(1) + ' h put this hazard at ' + word(risk) + ' for ' + crew.name + '.',
          evidence: 'Isolation and confinement is one of the five hazards in the NASA Human Research Program framework; sleep loss and workload are its tracked drivers here. The numeric cut-offs are simulation assumptions on a self-reported demo scale; NASA uses validated instruments instead.',
          mitigation: hazard.countermeasure };
      }
      case 'distance': {
        return { ...head,
          inputs: ['Environment: ' + env.label, 'Comms delay: ' + env.commDelay],
          rule: 'Watch in the Mars environment, where one-way light time is 4 to 24 minutes and real-time ground help is impossible; In range elsewhere. This hazard depends on the environment, not on a vital sign.',
          status: 'Current environment is ' + env.label + ' (' + env.commDelay + '), so this hazard is ' + word(risk) + '.',
          evidence: 'Distance from Earth is one of the five HRP hazards. The delay figures are the environment context values shown in the rail panel.',
          mitigation: hazard.countermeasure };
      }
      case 'gravity': {
        return { ...head,
          inputs: ['Exercise logged today: ' + v.exercise + ' min', 'Daily target: ' + EXERCISE_TARGET_MIN + ' min'],
          rule: 'Alert under 30 min logged, Watch under 60 min. Exercise minutes come from the session model, so this agrees with the vitals tile and the timeline.',
          status: v.exercise + ' min logged puts this hazard at ' + word(risk) + ' for ' + crew.name + '.',
          evidence: 'Gravity fields is one of the five HRP hazards; exercise is its main tracked countermeasure. The 120 min/day target follows ISS operational practice (about 2 h/day). The 30/60 min cut-offs are simulation assumptions for this demo.',
          mitigation: hazard.countermeasure };
      }
      case 'hostile': {
        return { ...head,
          inputs: ['Blood oxygen (SpO2): ' + v.spo2 + '%'],
          rule: 'Alert below 94%, Watch below 95%, matching the SpO2 vital tile exactly. Only this astronaut\'s own SpO2 is used.',
          status: 'SpO2 ' + v.spo2 + '% puts this hazard at ' + word(risk) + ' for ' + crew.name + '.',
          evidence: 'Hostile/closed environments is one of the five HRP hazards; the cabin panel tracks the air side of it (CO2, pressure, oxygen) while this card tracks the crew-side oxygen signal. SpO2 95-100% is a published Earth clinical reference range.',
          mitigation: hazard.countermeasure };
      }
      default:
        return { ...head, inputs: hazard.vitals, rule: 'See the countermeasure tracked for this hazard.', status: 'Risk: ' + word(risk) + ' for ' + crew.name + '.', evidence: 'NASA Human Research Program five-hazards framework.', mitigation: hazard.countermeasure };
    }
  }

  /* ---------- Alert decision support (guidance) ----------
     Every alert carries informational guidance in a fixed shape: trigger,
     evidence (the alert detail, from live values), suggested action (the
     alert action), the basis label, and the limitation. Guidance is
     displayed only; showing it never changes any simulated value, and it
     is never a NASA flight procedure. */
  const GUIDANCE_LIMITATION = 'This guidance works on simulated demo data for a fictional crew member. It supports awareness in this prototype only and is not a medical recommendation.';
  const ALERT_GUIDANCE = {
    'COMPOUND-FATIGUE': { basis: 'Simulation guidance', trigger: 'Sleep under 6 h AND stress above 7/10 AND resting heart rate above 100 bpm at the same time' },
    'HR-HIGH': { basis: 'Simulation guidance', trigger: 'Resting heart rate above 110 bpm' },
    'HR-ELEVATED': { basis: 'Simulation guidance', trigger: 'Resting heart rate above 100 bpm for at least 2 consecutive readings' },
    'SPO2-LOW': { basis: 'Simulation guidance', trigger: 'SpO2 below 94%' },
    'SPO2-WATCH': { basis: 'Simulation guidance', trigger: 'SpO2 below 95%' },
    'SLEEP-CRITICAL': { basis: 'Simulation guidance', trigger: 'Sleep under 5 h last night' },
    'SLEEP-SHORT': { basis: 'Simulation guidance', trigger: 'Sleep under 6 h last night' },
    'STRESS-HIGH': { basis: 'Simulation guidance', trigger: 'Stress score above 8.5 / 10' },
    'STRESS-ELEVATED': { basis: 'Simulation guidance', trigger: 'Stress score above 7 / 10' },
    'EXERCISE-BEHIND': { basis: 'Simulation guidance', trigger: 'Past 60% of the mission day with under 60 exercise minutes logged' },
    'RAD-DAILY': { basis: 'Operationally referenced', trigger: 'Simulated daily dose at or above the environment action level' },
    'RAD-WATCH': { basis: 'Operationally referenced', trigger: 'Simulated daily dose at or above 80% of the environment action level' },
    'SPE-EVENT': { basis: 'Operationally referenced', trigger: 'Solar Particle Event scenario active (simulated dose rate multiplied)' },
    'CO2-DRIFT': { basis: 'Operationally referenced', trigger: 'CO2 Scrubber Drift scenario active (simulated cabin CO2 climbing)' },
  };

  function alertGuidance(alert) {
    const g = ALERT_GUIDANCE[alert.code] || { basis: 'Simulation guidance', trigger: 'Rule threshold crossed' };
    return { trigger: g.trigger, evidence: alert.detail, action: alert.action, basis: g.basis, limitation: GUIDANCE_LIMITATION };
  }

  /* ---------- Chatbot: explainable, state-aware answers ----------
     Third layer, tried FIRST in the app: questions asking WHY something is
     flagged, for trend summaries, scenario effects, hazard explanations,
     dose projections, or about data this dashboard does not hold. Every
     explanation is built from the live state passed in ctx, and carries
     its inputs, the rule used, the data provenance and a limitation.
     Returns null when no explain-intent matches, so the caller falls
     through to the live-state and Q&A-bank layers. ctx = { crew, env,
     scenario, frac, radToday, cabin, minutesOfDay } */
  function answerExplain(question, ctx) {
    const q = ' ' + question.toLowerCase().trim() + ' ';
    const { crew, env, scenario, frac, radToday, cabin } = ctx;
    const v = crew.vitals;
    const prov = 'Data provenance: simulated demo data for a fictional crew member.';
    const limit = 'Limitation: this explains dashboard rules on simulated data. It is not a diagnosis and VitalOrbit is not a NASA medical system.';
    const named = CREW.find((c) => q.includes(c.id) || q.includes(c.name.toLowerCase().split(' ').pop()));
    const who = named || crew;
    const wv = who.vitals;
    const whoRad = who === crew ? radToday : env.doseRate * (SCENARIOS[scenario] ? SCENARIOS[scenario].doseMultiplier : 1) * frac * (who.radFactor || 1);

    // Data the dashboard does not hold: say so plainly instead of guessing.
    if (/\b(blood pressure|bp|systolic|diastolic|blood sugar|glucose|ecg|ekg|body temperature|weight|body mass|medication|medicine|dose of|prescri|diagnos|cholesterol|heart attack|bone density scan|dexa)\b/.test(q)) {
      return { q: null,
        a: 'I cannot answer that from the data this dashboard holds. VitalOrbit tracks only heart rate, blood oxygen (SpO2), sleep, a self-reported stress score, exercise minutes, radiation dose and cabin air for its demo crew. It holds no blood pressure, blood, ECG, medication or diagnostic data, and it never diagnoses or prescribes: for anything medical, the flight surgeon is the right contact.',
        learn: prov + ' ' + limit };
    }

    // Hazard explanations. Matched strictly on the hazard id or distinctive
    // name, so ordinary questions containing the word "space" or "risk" are
    // not hijacked. Runs before the why-alert branch: "why is the radiation
    // hazard a risk?" is a hazard question, not an alert question.
    const hzMatch = HAZARDS.find((h) => q.includes(h.id) || q.includes(h.name.toLowerCase()) ||
      (h.id === 'hostile' && /\bclosed environment/.test(q)) ||
      (h.id === 'distance' && /\bdistance from earth/.test(q)));
    if (hzMatch && /\b(hazard|risk|why|explain)\b/.test(q)) {
      const ex = hazardExplain(hzMatch, who, env);
      return { q: null,
        a: ex.hazard + ' for ' + who.name + ': ' + ex.status + ' Rule: ' + ex.rule + ' Inputs: ' + ex.inputs.join('; ') + '.',
        learn: 'Evidence basis: ' + ex.evidence + ' ' + prov + ' ' + limit };
    }

    // Why is this astronaut flagged / explain the alert.
    if ((/\bwhy\b/.test(q) && /\b(alert|flag|warn|red|amber|attention|risk)/.test(q)) ||
        (/\balert/.test(q) && /\b(explain|reason|mean)\b/.test(q)) ||
        /\b(compound|fatigue alert)\b/.test(q)) {
      const alerts = evaluateAlerts(who, env, frac, scenario);
      if (!alerts.length) {
        return { q: null,
          a: who.name + ' has no active alert right now. Every tracked value is inside its rule range: heart rate ' + wv.hr + ' bpm (rule range 60 to 100), SpO2 ' + wv.spo2 + '% (95 to 100), sleep ' + wv.sleep.toFixed(1) + ' h (target 7 to 9), stress ' + wv.stress.toFixed(1) + ' / 10 (watch above 5), exercise ' + wv.exercise + ' min, and radiation ' + whoRad.toFixed(2) + ' mSv today against a ' + env.radAlertThreshold.toFixed(2) + ' mSv action level.',
          learn: prov + ' ' + limit };
      }
      const top = alerts[0];
      const lines = alerts.map((a) => {
        const g = alertGuidance(a);
        return a.title + ' (' + a.severity + '): trigger: ' + g.trigger + '. Evidence: ' + a.detail;
      });
      let extra = '';
      const compound = alerts.find((a) => a.code === 'COMPOUND-FATIGUE');
      if (compound) {
        extra = ' The compound alert fires because all three contributors cross together: sleep ' + wv.sleep.toFixed(1) + ' h (rule: under 6 h), stress ' + wv.stress.toFixed(1) + ' / 10 (rule: above 7), resting heart rate ' + wv.hr + ' bpm (rule: above 100). While it is active it replaces the three separate warnings, so the problem is shown once, whole.';
      }
      return { q: null,
        a: who.name + ' currently has ' + alerts.length + ' active alert' + (alerts.length > 1 ? 's' : '') + '. ' + lines.join(' ') + extra,
        learn: prov + ' Rules are the dashboard alert rules; thresholds classed as simulation assumptions are labelled in the Methodology section. ' + limit };
    }

    // 7-day trend summary for one astronaut.
    if (/\b(trend|trends|pattern|last 7 days|7-day|7 day|past week|over the week|getting worse|getting better|improving|declining)\b/.test(q)) {
      const t = trendDirections(who);
      const adh = exerciseAdherenceSummary(who, ctx.minutesOfDay);
      return { q: null,
        a: 'Seven-day trend for ' + who.name + ' (comparing the first three days with the last three): heart rate is ' + t.hr.direction + ' (' + who.history.hr[0] + ' to ' + who.history.hr[6] + ' bpm), sleep is ' + t.sleep.direction + ' (' + who.history.sleep[0].toFixed(1) + ' to ' + who.history.sleep[6].toFixed(1) + ' h), SpO2 is ' + t.spo2.direction + '. Overall fatigue direction: ' + t.fatigue + '. Exercise adherence so far today: ' + adh.logged + ' of ' + adh.planned + ' planned minutes in finished sessions.',
        learn: prov + ' Method: direction only, from means of the first vs last three days of the seeded history. This describes the demo history; it is an estimate of direction, not a prediction. ' + limit };
    }

    // Scenario effects.
    if (/\b(scenario|solar particle|solar storm|spe|co2|scrubber|drift)\b/.test(q)) {
      if (scenario === 'spe') {
        return { q: null,
          a: 'The Solar Particle Event scenario is active. It multiplies the simulated dose rate by 6: here that is ' + (env.doseRate * 6).toFixed(1) + ' mSv/day before each astronaut\'s exposure factor, so ' + who.name + ' is at ' + whoRad.toFixed(2) + ' mSv today against a ' + env.radAlertThreshold.toFixed(2) + ' mSv action level. Vitals are not directly changed by this scenario; radiation alerts and the radiation hazard respond to it.',
          learn: prov + ' The x6 multiplier is a simulation assumption; real event strength varies widely. NASA-STD-3001 requires protection to under 250 mSv for a design-reference SPE. ' + limit };
      }
      if (scenario === 'co2') {
        return { q: null,
          a: 'The CO2 Scrubber Drift scenario is active. Cabin CO2 is currently ' + Math.round(cabin.co2Ppm) + ' ppm (demo watch level 1,500 ppm, action level 2,500 ppm) and climbing while the scenario runs; crew SpO2 drifts down and resting heart rate drifts up in the simulation. Leaving the scenario starts a labelled recovery that returns vitals and cabin CO2 to the exact pre-scenario values over about 30 seconds.',
          learn: prov + ' Cabin levels are simulation assumptions; real ISS CO2 runs higher than this demo baseline. ' + limit };
      }
      return { q: null,
        a: 'No scenario is active (Nominal Orbit). The Scenario Simulator can apply a Solar Particle Event (simulated dose rate multiplied by 6) or a CO2 Scrubber Drift (cabin CO2 climbs, crew SpO2 falls and resting heart rate rises). Switching back to Nominal after a CO2 drift runs a labelled, deterministic recovery to the pre-scenario values.',
        learn: prov + ' ' + limit };
    }

    // Dose projection.
    if (/\b(project|forecast|how long|reach|until|career)\b/.test(q) && /\b(dose|radiation|msv|action level)\b/.test(q)) {
      const p = doseProjection(who, env, scenario, frac);
      const hrs = p.hoursToActionLevel == null
        ? 'has already reached the ' + p.actionLevel.toFixed(2) + ' mSv action level'
        : 'reaches the ' + p.actionLevel.toFixed(2) + ' mSv action level in about ' + p.hoursToActionLevel.toFixed(1) + ' h at the current simulated rate';
      return { q: null,
        a: 'Estimate for ' + who.name + ': at the current simulated rate of ' + p.ratePerDay.toFixed(2) + ' mSv/day (dose equivalent), today\'s dose (' + p.todaySoFar.toFixed(2) + ' mSv) ' + hrs + '. ' + p.careerNote,
        learn: 'ESTIMATE: simple rate-times-time extrapolation of simulated data, shown with its method. Real dose rates vary with orbit, shielding, solar activity and EVA schedule, so this is not a forecast. The action level is a demo threshold; the career reference is not projected, for the reason stated above. ' + limit };
    }

    return null;
  }

  return {
    RANGES, ENVIRONMENTS, SCENARIOS, CREW, DAYS, HAZARDS, TIMELINE,
    CHATBOT_QA, SOURCES, PARAMETER_BASIS, REFERENCES, PROVENANCE,
    EXERCISE_TARGET_MIN, EXERCISE_SESSIONS, CABIN,
    vitalStatus, worstStatus, evaluateAlerts, answerChatbot, answerLiveState,
    sessionProgress, exerciseAt, exerciseSessionStates, cabinStatus,
    doseProjection, trendDirections, exerciseAdherenceSummary,
    hazardExplain, alertGuidance, answerExplain,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VITALORBIT;
