/* VitalOrbit — data layer (pure data + pure logic, no DOM access).
   All live values are SIMULATED demo data. Reference ranges are grounded in
   NASA Human Research Program material (see ABOUT / sources in index.html):
   - The 5 Hazards of Human Spaceflight (NASA HRP)
   - ISS crew effective dose ~0.2-0.5 mSv/day; NASA career limit 600 mSv
     (NASA-STD-3001, 2022)
   - Resting heart rate 60-100 bpm; SpO2 95-100%; sleep target 7-9 h.
   Demo crew members are fictional.
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
      context: 'Deep-space transit: highest radiation exposure of any phase, microgravity throughout, and no quick return. Health checks are self-reliant — the crew is the first responder.',
      countermeasures: 'Daily 2 h exercise, strict sleep schedule, radiation shelter drills, dosimeter checks at every check-in.',
    },
    iss: {
      id: 'iss', label: 'ISS (low Earth orbit)', gravity: 'Microgravity',
      doseRate: 0.4, radAlertThreshold: 0.36, commDelay: 'Near-real-time',
      context: 'Low Earth orbit: partly shielded by Earth\u2019s magnetic field, so daily radiation dose is lower (~0.2–0.5 mSv/day effective dose). Microgravity still drives bone and muscle loss; mission control is minutes away.',
      countermeasures: '2 h daily exercise (ARED + treadmill), weekly bone/muscle countermeasure checks, regular video contact with ground and family.',
    },
    moon: {
      id: 'moon', label: 'Moon (surface)', gravity: '1/6 g',
      doseRate: 1.4, radAlertThreshold: 1.26, commDelay: '~1.3 s one-way',
      context: 'Lunar surface: no atmosphere and no magnetic field, so radiation dose is several times higher than on the ISS. Partial gravity (1/6 g) helps, but does not replace exercise.',
      countermeasures: 'Regolith-shielded habitat time, surface-EVA dose budgeting, partial-gravity exercise, dust-exposure checks after every EVA.',
    },
    mars: {
      id: 'mars', label: 'Mars (transit + surface)', gravity: 'Microgravity, then 3/8 g',
      doseRate: 1.8, radAlertThreshold: 1.62, commDelay: '4–24 min one-way',
      context: 'Mars mission: the hardest case — months of transit radiation, then up to two years at 3/8 g, with help 4–24 light-minutes away. The crew must detect and act on health changes alone.',
      countermeasures: 'Autonomous health monitoring (this dashboard), pre-planned medical protocols, shielded transit habitat, strict exercise and sleep discipline.',
    },
  };

  /* ---------- Demo crew (fictional) ---------- */
  // history arrays: 7 days, oldest -> newest (today = last entry)
  const DAYS = ['Sol 136', 'Sol 137', 'Sol 138', 'Sol 139', 'Sol 140', 'Sol 141', 'Sol 142'];

  const CREW = [
    {
      id: 'reyes', name: 'Cmdr. A. Reyes', role: 'Commander', initials: 'AR',
      vitals: { hr: 62, spo2: 98, sleep: 7.6, stress: 3.1, exercise: 95, radCumulative: 58.4 },
      history: {
        hr:    [61, 63, 60, 62, 64, 61, 62],
        spo2:  [98, 98, 99, 98, 98, 97, 98],
        sleep: [7.4, 7.8, 7.2, 7.6, 7.9, 7.5, 7.6],
        radDay:[0.38, 0.41, 0.39, 0.42, 0.38, 0.40, 0.28],
      },
      note: 'Steady across all vitals. No open alerts.',
    },
    {
      id: 'chen', name: 'Dr. L. Chen', role: 'Flight Surgeon', initials: 'LC',
      vitals: { hr: 68, spo2: 97, sleep: 7.1, stress: 4.0, exercise: 110, radCumulative: 57.9 },
      history: {
        hr:    [66, 68, 67, 69, 68, 67, 68],
        spo2:  [98, 97, 98, 97, 98, 98, 97],
        sleep: [7.0, 7.3, 6.9, 7.2, 7.1, 7.0, 7.1],
        radDay:[0.39, 0.40, 0.38, 0.41, 0.39, 0.42, 0.28],
      },
      note: 'Steady. Sleep at the low end of target — watch the trend.',
    },
    {
      id: 'okafor', name: 'Eng. M. Okafor', role: 'Flight Engineer', initials: 'MO',
      vitals: { hr: 104, spo2: 96, sleep: 5.4, stress: 7.2, exercise: 45, radCumulative: 59.1 },
      history: {
        hr:    [96, 97, 99, 100, 101, 103, 104],
        spo2:  [98, 97, 97, 96, 97, 96, 96],
        sleep: [6.8, 6.5, 6.2, 6.0, 5.8, 5.6, 5.4],
        radDay:[0.40, 0.39, 0.41, 0.38, 0.42, 0.40, 0.28],
      },
      note: 'Elevated resting heart rate trending up for 7 days, sleep falling. Two active alerts — see Alerts panel.',
      highHrStreak: 2, // consecutive readings above 100 bpm at load, so the rule fires immediately
    },
    {
      id: 'novak', name: 'Pilot S. Novak', role: 'Pilot', initials: 'SN',
      vitals: { hr: 71, spo2: 98, sleep: 7.0, stress: 3.8, exercise: 95, radCumulative: 58.0 },
      history: {
        hr:    [70, 72, 71, 69, 72, 70, 71],
        spo2:  [98, 99, 98, 98, 99, 98, 98],
        sleep: [6.9, 7.0, 6.7, 6.8, 7.1, 6.9, 7.0],
        radDay:[0.38, 0.40, 0.39, 0.41, 0.38, 0.39, 0.28],
      },
      note: 'Steady across all vitals. No open alerts.',
    },
  ];

  /* ---------- 5 Hazards (NASA HRP) ---------- */
  const HAZARDS = [
    {
      id: 'radiation', name: 'Space Radiation', icon: 'RAD',
      blurb: 'Invisible, and the most menacing of the five hazards: it raises cancer risk, can damage the central nervous system and impair cognition.',
      vitals: ['Radiation dose (today + cumulative)', 'Heart rate', 'Immune markers (tracked via health log)'],
      countermeasure: 'Dosimeter checks at every check-in, shielded-habitat time, EVA dose budgeting.',
      riskFn: (crew, env) => {
        const today = crew.vitals.radDayToday != null ? crew.vitals.radDayToday : env.doseRate * 0.7;
        if (today >= env.radAlertThreshold) return 'red';
        if (today >= env.radAlertThreshold * 0.8 || env.doseRate >= 1.4) return 'amber';
        return 'green';
      },
    },
    {
      id: 'isolation', name: 'Isolation & Confinement', icon: 'ISO',
      blurb: 'Months in a small crew, far from home: sleep loss, circadian disruption and work overload can compound into mood and performance problems.',
      vitals: ['Stress score', 'Sleep hours', 'Mood check-ins'],
      countermeasure: 'Scheduled family video calls, private psychological support time, protected sleep window.',
      riskFn: (crew) => {
        const avgStress = CREW.reduce((s, c) => s + c.vitals.stress, 0) / CREW.length;
        if (avgStress > 6.5) return 'red';
        if (avgStress > 5) return 'amber';
        return 'green';
      },
    },
    {
      id: 'distance', name: 'Distance from Earth', icon: 'DST',
      blurb: 'Mars averages about 140 million miles away — a three-year round trip with help minutes to hours away. The crew must be self-sufficient.',
      vitals: ['All vitals (autonomous monitoring)', 'Alert response time'],
      countermeasure: 'Onboard medical protocols, autonomous alerts, pre-packed treatment kits.',
      riskFn: (crew, env) => (env.id === 'mars' ? 'amber' : env.id === 'moon' ? 'green' : 'green'),
    },
    {
      id: 'gravity', name: 'Gravity Fields', icon: 'GRV',
      blurb: 'Microgravity, then 1/6 g or 3/8 g: muscles atrophy, bones lose density, fluids shift — vision and balance change too.',
      vitals: ['Exercise minutes', 'Heart rate', 'Sleep (fluid-shift effects)'],
      countermeasure: '2 h daily exercise (resistive + aerobic), bone-density tracking, fluid-shift monitoring.',
      riskFn: () => {
        const worst = Math.min(...CREW.map((c) => c.vitals.exercise));
        if (worst < 60) return 'amber';
        return 'green';
      },
    },
    {
      id: 'hostile', name: 'Hostile / Closed Environments', icon: 'ENV',
      blurb: 'The spacecraft is a sealed ecosystem: temperature, pressure, lighting, noise, microbes and air quality all affect health every day.',
      vitals: ['Blood oxygen (SpO2)', 'Sleep quality', 'Stress score'],
      countermeasure: 'Continuous cabin air and CO2 monitoring, lighting tuned to circadian rhythm, noise limits.',
      riskFn: () => {
        const minSpo2 = Math.min(...CREW.map((c) => c.vitals.spo2));
        if (minSpo2 < 94) return 'red';
        if (minSpo2 < 95) return 'amber';
        return 'green';
      },
    },
  ];

  /* ---------- Daily health timeline (mission day, Sol 142) ---------- */
  const TIMELINE = [
    { time: '06:00', title: 'Wake + morning health check-in', detail: 'Vitals snapshot, mood log, dosimeter read', done: true },
    { time: '07:00', title: 'Breakfast + hydration', detail: 'Calorie and fluid targets logged', done: true },
    { time: '08:00', title: 'Exercise block 1 — resistive (ARED)', detail: '60 min · bone & muscle countermeasure', done: true },
    { time: '10:00', title: 'Work / science operations', detail: 'Task blocks with 10-min movement breaks', done: true },
    { time: '12:30', title: 'Lunch', detail: 'Nutrition log + fluid top-up', done: true },
    { time: '14:00', title: 'Midday vitals check-in', detail: 'HR + SpO2 re-check (missed — see alerts)', done: false },
    { time: '16:00', title: 'Exercise block 2 — aerobic', detail: '30 min · cardiovascular countermeasure', done: true },
    { time: '17:30', title: 'Evening health log + mood check', detail: 'End-of-day symptom and mood log', done: false },
    { time: '18:00', title: 'Dinner + crew time', detail: 'Shared meal — isolation countermeasure', done: false },
    { time: '19:30', title: 'Video call home', detail: 'Family contact — isolation countermeasure', done: false },
    { time: '21:00', title: 'Wind-down: lights dim, screens off', detail: 'Circadian wind-down routine', done: false },
    { time: '22:00', title: 'Sleep window opens', detail: 'Target 7–9 h · cabin lights to night mode', done: false },
  ];

  /* ---------- Alert engine (pure rules) ---------- */
  // state: per-crew consecutive high-HR readings (seeded in crew data)
  function evaluateAlerts(crew, env, missionDayFraction) {
    const v = crew.vitals;
    const alerts = [];
    const streak = crew.highHrStreak || 0;

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
    if (missionDayFraction > 0.6 && v.exercise < 60) {
      alerts.push({ severity: 'amber', code: 'EXERCISE-BEHIND',
        title: 'Exercise behind schedule',
        detail: crew.name + ': only ' + v.exercise + ' min today (target 120 min).',
        action: 'Fit in a 30-min aerobic session before dinner — exercise is the main countermeasure for bone and muscle loss.' });
    }
    const radToday = env.doseRate * missionDayFraction;
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
    return alerts;
  }

  /* ---------- Health chatbot Q&A (rule-based) ---------- */
  const CHATBOT_QA = [
    { keys: ['heart rate', 'heart', 'pulse', 'hr high', 'bpm'],
      q: 'Why is my heart rate high in space?',
      a: 'Fluid shifts and deconditioning in microgravity change how hard your heart works, and stress, poor sleep or dehydration can push resting heart rate up. A short rise after exercise is normal; a resting rate above 100 bpm needs a rest and a re-check.',
      learn: 'Heart rate is a window into cardiovascular deconditioning — one of the effects the Human Research Program tracks.' },
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
      a: 'Check your vitals panel: it shows today\u2019s dose and your cumulative mission dose. On the ISS the effective dose is roughly 0.2–0.5 mSv per day; deep-space transit is higher. Your daily action level is shown for the current environment.',
      learn: 'NASA\u2019s career exposure limit is 600 mSv (NASA-STD-3001).' },
    { keys: ['oxygen', 'spo2', 'sp o2', 'breath', 'low oxygen'],
      q: 'What if my blood oxygen (SpO2) is low?',
      a: 'First check the sensor is fitted properly, sit down and take slow deep breaths, then re-measure in 5 minutes. Below 95% is a watch level; below 94% is an alert — tell the flight surgeon.',
      learn: 'SpO2 is a fast check on how well the closed cabin environment is supporting you.' },
    { keys: ['bone', 'bones', 'bone loss', 'density'],
      q: 'Why do astronauts lose bone in space?',
      a: 'Without gravity loading your skeleton, bone is broken down faster than it is rebuilt — especially in the hips and spine. Resistive exercise, good nutrition (calcium, vitamin D) and, in future, artificial gravity are the countermeasures.',
      learn: 'Bone loss is a core effect of the gravity-fields hazard.' },
    { keys: ['muscle', 'atrophy', 'weak'],
      q: 'How do I stop muscle loss in space?',
      a: 'Daily resistive exercise on ARED plus aerobic work, enough protein, and moving often during the day. Your exercise minutes are tracked on this dashboard for exactly this reason.',
      learn: 'Muscle atrophy is fastest in the legs and back — the muscles gravity normally loads.' },
    { keys: ['lonely', 'isolation', 'alone', 'mood', 'homesick', 'depressed', 'sad'],
      q: 'I feel isolated. What helps?',
      a: 'Talk to a crewmate, use your scheduled video call home (19:30), keep a routine, and get daylight-spectrum light in the morning. If low mood lasts more than a few days, tell the flight surgeon — it is a health issue, not a weakness.',
      learn: 'Isolation and confinement is one of the five hazards; crew cohesion is a countermeasure.' },
    { keys: ['food', 'eat', 'meal', 'nutrition', 'diet'],
      q: 'What should I eat on a mission?',
      a: 'Follow the planned menu: enough calories for your workload, good protein for muscle, calcium and vitamin D for bone, and plenty of fluids. Log every meal in the timeline so intake stays visible.',
      learn: 'Nutrition is a countermeasure — it works together with exercise, not instead of it.' },
    { keys: ['water', 'hydration', 'drink', 'dehydrated', 'thirsty'],
      q: 'How much water do I need?',
      a: 'Roughly 2–3 litres a day, more on heavy exercise days. In space, thirst is a poor guide — drink on schedule and log it. Dark urine or a headache can mean you are behind on fluids.',
      learn: 'Dehydration raises heart rate and worsens fatigue, so it shows up in your vitals first.' },
    { keys: ['eye', 'vision', 'eyesight', 'blurry', 'sans'],
      q: 'Why is my vision changing?',
      a: 'Fluid shifting towards the head in microgravity can change eye shape and pressure (spaceflight-associated neuro-ocular syndrome). Report any blurry vision or headaches promptly — do not wait for the next check-in.',
      learn: 'Vision changes are one of the effects the Human Research Program studies under gravity fields.' },
    { keys: ['stress', 'anxious', 'anxiety', 'worried', 'overwhelmed'],
      q: 'I feel stressed. What can I do right now?',
      a: 'Stop, breathe slowly for two minutes, step away from the task, and talk to a crewmate. Then check the timeline — a break, a meal or the video call home often helps. Persistent stress above 7/10 raises an alert here.',
      learn: 'Stress is tracked because it affects sleep, heart rate and performance together.' },
    { keys: ['emergency', 'chest pain', 'unwell', 'sick', 'help', 'pain', 'hurt', 'injured'],
      q: 'I feel unwell — what do I do?',
      a: 'Stop what you are doing, sit or lie down, and alert the flight surgeon and the commander immediately. Do not try to diagnose yourself. This dashboard is an awareness tool, not a medical device — a real person must respond.',
      learn: 'Distance from Earth means the crew is the first responder; that is why alerts here are plain-language actions.' },
    { keys: ['vitalorbit', 'how does this work', 'how it works', 'what is this', 'dashboard'],
      q: 'How does VitalOrbit work?',
      a: 'It watches the crew\u2019s vitals (heart rate, oxygen, sleep, stress, exercise, radiation), colours each one green, amber or red against safe ranges, charts 7-day trends, and fires plain-language alerts with an action. All values here are clearly labelled simulated data.',
      learn: 'Colour-first status means a problem is visible at a glance — the challenge asked for exactly that.' },
    { keys: ['missed exercise', 'behind', 'skipped', 'no exercise'],
      q: 'I missed my exercise session. Does it matter?',
      a: 'One missed session is not a crisis, but exercise is your main defence against bone and muscle loss, so catch up with a shorter session today and keep the next one. If you are behind schedule, VitalOrbit raises an amber alert.',
      learn: 'Consistency matters more than any single session — the 7-day chart shows the pattern.' },
    { keys: ['mars', 'moon', 'difference', 'environment'],
      q: 'How does health risk change between the ISS, Moon and Mars?',
      a: 'Use the environment switcher above: radiation dose rises sharply beyond low Earth orbit, gravity changes from zero to 1/6 g (Moon) to 3/8 g (Mars), and help goes from minutes away to 4–24 light-minutes away on Mars.',
      learn: 'That is why the same dashboard shows a different hazard picture for each environment.' },
    { keys: ['immune', 'immunity', 'sick', 'infection', 'cold'],
      q: 'Does spaceflight affect my immune system?',
      a: 'Yes — stress, disrupted sleep and radiation can all weaken immune responses, and a closed cabin means germs circulate. Sleep, exercise, good food and hand hygiene are the practical defences.',
      learn: 'Immune changes are studied through the Human Research Program and the Open Science Data Repository.' },
    { keys: ['circadian', 'body clock', 'jet lag', 'light', 'schedule'],
      q: 'How do I keep my body clock on track?',
      a: 'Fixed wake/sleep times, bright light in the morning, dim light after 21:00, meals at the same times each day, and exercise earlier rather than right before bed.',
      learn: 'On the ISS the sun rises every 90 minutes, so the schedule — not the window — sets your clock.' },
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
      learn: 'If you feel unwell, alert the flight surgeon — this chatbot gives general information only.',
    };
  }

  /* ---------- Sources ----------
     Resource links as listed on the challenge's official Resources tab
     (verified live from spaceappschallenge.org), plus the open HRP data
     portals. No logos or branding — text links only. */
  const SOURCES = [
    { name: '5 Hazards of Human Spaceflight — NASA Human Research Program', url: 'https://www.nasa.gov/hrp/hazards/' },
    { name: 'Risks of Human Spaceflight — NASA Human Research Program', url: 'https://www.nasa.gov/hrp/risks/' },
    { name: 'Ongoing HRP Research in Space — NASA Human Research Program', url: 'https://www.nasa.gov/hrp/ongoing-hrp-research/' },
    { name: 'Monitoring Radiation for Astronaut Health — Canadian Space Agency', url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp' },
    { name: 'NASA Open Science Data Repository (OSDR)', url: 'https://osdr.nasa.gov' },
    { name: 'NASA Life Sciences Portal (NLSP)', url: 'https://nlsp.nasa.gov' },
  ];

  return {
    RANGES, ENVIRONMENTS, CREW, DAYS, HAZARDS, TIMELINE,
    CHATBOT_QA, SOURCES, vitalStatus, worstStatus, evaluateAlerts, answerChatbot,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VITALORBIT;
