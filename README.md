# VitalOrbit · Astronaut Health Command Dashboard

**Team VitalOrbit India · NASA Space Apps Challenge 2026 (Universal Event)**
Challenge: **Create Health Monitoring Software for Astronauts on Space Missions**

VitalOrbit is a colour-first health monitoring dashboard that lets an astronaut see their own health at a glance: green / amber / red status, 7-day trend charts, smart alerts with plain-language actions, a daily health timeline, and a rule-based health chatbot. It is built for the astronaut, not the doctor: on a long mission the astronaut *is* the first responder.

## Live demo

- **Live app:** https://iamartya15.github.io/vitalorbit-space-apps-2026/
- **Demo deck (7 slides):** https://iamartya15.github.io/vitalorbit-space-apps-2026/deck/VitalOrbit-Demo-Deck.pdf
- **Demo deck (PPTX):** [deck/VitalOrbit-Demo-Deck.pptx](deck/VitalOrbit-Demo-Deck.pptx)

## How to run

No build step, no server, no install. Open `index.html` in any modern browser (or serve the folder with any static server, e.g. `python3 -m http.server`). Everything, including Chart.js, vendored in `vendor/`, runs locally and offline.

## What it does

- **Six views, one mission**: a sidebar organises the dashboard into Overview, Crew Health, Environment, Radiation & Mission, Risk & Alerts and Methodology. The Overview shows summaries only (mission status, crew health, alerts, cabin, radiation, risk), computed from the same live state and the same rule functions as the detail views, so a summary can never disagree with its detail; it also carries the mission controls, quick-navigation cards and a short "About this demo" note. On mobile the sidebar becomes a horizontal nav strip. The Overview opens with an authentic NASA photograph (Earth at night from the ISS), bundled locally in `assets/` so the app stays fully offline.
- **Crew overview**: 4 fictional demo astronauts, each with an overall green / amber / red status. Click a crew member to inspect them.
- **Vitals panel**: heart rate, blood oxygen (SpO₂), sleep, stress/mood score, exercise minutes, radiation dose. Each vital shows its current value, its safe-range band, and its status. Values update every 3 seconds (simulated feed).
- **Per-crew radiation**: daily dose is tracked per astronaut, not per spacecraft. Each crew member has an exposure factor (EVA work, time in shielded modules), so the engineer who did the spacewalk carries a higher dose than the surgeon in the shielded lab.
- **7-day trend charts**: heart rate, SpO₂, sleep and radiation dose, with the safe range shown as a green band, so a drift is visible before it becomes an alert. The radiation history is stored canonically (unit days of ISS-rate exposure) and re-derived for each environment, so switching environments never compounds rounding: ISS → Mars → ISS returns the exact original history.
- **Alert engine**: rule-based thresholds evaluated on every reading (e.g. resting HR above 100 bpm for consecutive readings → amber alert). Every alert carries a plain-language recommended action. Alerts are ordered red before amber, raised/cleared events are logged once, and new critical alerts are announced to screen readers.
- **Composite risk alerts**: combined signals raise a single high-priority alert that consolidates its parts. Short sleep (< 6 h) plus high stress (> 7/10) plus elevated resting heart rate (> 100 bpm) fires one "Compound Fatigue & Cardiovascular Strain" alert *instead of* the three overlapping component warnings; independent alerts (oxygen, radiation, exercise, scenario events) still fire separately.
- **Scenario Simulator**: what-if controls in the Overview, next to the environment switcher: Nominal Orbit, Solar Particle Event (radiation dose rate surges, shielded-module alert fires) and CO2 Scrubber Drift (crew SpO2 falls, resting heart rate rises, cabin CO2 climbs, scrubber alert fires). Leaving the CO2 scenario runs an explicit, labelled **recovery state**: vitals and cabin air interpolate deterministically back to the exact pre-scenario baseline over about 30 seconds.
- **Cabin Environment panel**: simulated cabin CO2, oxygen partial pressure, pressure, temperature and humidity, with a cabin status badge. The CO2 scenario visibly drives the CO2 channel.
- **Session-based exercise**: exercise minutes are not random. The day has four planned sessions (morning mobility, resistive block, aerobic block, evening top-up; 150 planned minutes against the 120 min/day target), each crew member completes a per-crew fraction of each session, and minutes accrue only while a session is actually running. The vitals tile, the timeline and the exercise alert all read the same session model.
- **Per-astronaut hazard risk**: each hazard card shows the risk for the *selected* astronaut, computed from that astronaut's own values, plus the crew worst case as a separate line.
- **Environment switcher**: Spacecraft / ISS / Moon / Mars. Switching changes the hazard context, radiation dose rates, and the countermeasures tracked.
- **5-Hazards risk view**: each of NASA's five hazards of human spaceflight mapped to the vitals it affects, its current risk level, and the countermeasure being tracked, with hand-drawn inline SVG icons.
- **Daily health timeline**: exercise, meals, sleep window and check-ins across the day; overdue items are flagged from the mission clock, and items can be ticked off.
- **Health chatbot**: four layers. (1) An explainable layer answers "Why is Okafor flagged?", trend, scenario, hazard and dose-projection questions from the live state, showing inputs, the rule used, data provenance and a limitation; questions about data the dashboard does not hold (blood pressure, medication, diagnosis) get an explicit "insufficient data" answer. (2) Live-state answers: "How am I doing?" or "Is my heart rate normal?" are answered from the selected crew member's live values with range comparisons and advice. (3) A rule-based Q&A bank on ~18 topics (heart rate, sleep, exercise, radiation, bone loss, isolation…), with a short education note under each answer. The chatbot never diagnoses or prescribes, and a safety line in the panel says so. (4) A project layer explains what VitalOrbit is, how the dashboard works, how alerts and scenarios work, and that all live data is simulated, so a newcomer can understand the whole project just by asking. The chatbot lives in a floating panel: an AI Assistant button at the bottom right opens it as a compact floating card, anchored at the bottom right on desktop and mobile alike, from any view.
- **Per-alert decision support**: every alert shows, in a fixed shape, its trigger condition, the live evidence, a suggested informational action, a basis label (simulation guidance, or operationally referenced where the action follows tracked countermeasure practice) and its limitation. Cabin CO2 out-of-range states show the same guidance shape. Guidance is display-only: it never changes a simulated value and is never presented as a NASA flight procedure.
- **Explainable hazards**: each hazard card opens a "Why this risk?" detail with the exact inputs for the selected astronaut, the rule in plain words, the threshold state, the evidence basis and the countermeasure information. Individual risk stays separate from the crew worst-case line.

## Simulation model and data provenance

No value in VitalOrbit is a real measurement. Every displayed value carries a provenance tag in the UI:

- **SIMULATED** — a generated demo reading (vitals, cabin channels).
- **DERIVED** — computed from simulated inputs by a stated rule (today's radiation dose = environment dose rate × fraction of day elapsed × the astronaut's exposure factor; exercise minutes from the session model; hazard risk from the hazard rules).
- **ESTIMATE** — an arithmetic extrapolation of a simulated rate (the dose projection: rate × time to the daily action level). It is shown with its method and is not a forecast. No time-to-career-limit estimate is computed: the 600 mSv career reference is an *effective* dose, while the simulated rates are *dose equivalent*, and dividing one quantity by the other would not be valid without a validated conversion model, which this demo does not apply. The app states this plainly wherever the projection appears.

How the simulated values are generated:

- **Seeded history (deterministic):** each fictional crew member has a fixed 7-day history per vital, written into `data.js`. The radiation history is stored canonically (unit days of ISS-rate exposure) and re-derived per environment, so environment switches are exact and reversible.
- **Deterministic models:** exercise minutes are a pure function of mission time and the four-session schedule with per-crew adherence fractions; radiation dose is a pure function of environment, scenario multiplier, day fraction and exposure factor; scenario recovery interpolates linearly back to the exact pre-scenario snapshot over 10 ticks.
- **Variable parts (bounded random walks):** heart rate, SpO2, stress and the cabin channels take small clamped random steps each 3-second tick around per-crew baselines. They make the display live without changing any rule outcome qualitatively; alert thresholds, hazard rules and projections do not depend on the walk.
- **Scenario reproducibility:** given the same starting state, the scenario effects are reproducible: a Solar Particle Event always multiplies the dose rate by 6, a CO2 drift always pushes cabin CO2 up by a fixed step per tick, and leaving CO2 always restores the exact snapshot. Only the small background walks vary between runs.

**Real datasets:** the challenge points to NASA's Open Science Data Repository (OSDR) and Life Sciences Portal (NLSP). Those portals hold real spaceflight data (for example the Inspiration4 civilian-astronaut dataset on OSDR), but this demo does not integrate a dataset: the releasable human datasets are omics/imaging-centred or access-restricted for privacy, and none provides a clean, openly licensed, per-vital time series that maps honestly onto these six dashboard vitals. Rather than fabricate a mapping, VitalOrbit keeps its clearly labelled simulation and grounds its *reference ranges* in the published sources listed below. Integrating OSDR data properly is future work, not a claim made here.

## Architecture

```
index.html  · six-view dashboard layout: sidebar navigation + views (no NASA logos, branding, flags or mission identifiers)
styles.css  · dark (default) and light "mission control" themes with a header toggle, persisted in localStorage; colour-first status
app.js      · live simulation loop, scenario simulator, charts, timeline, chatbot UI
data.js     · crew profiles, 7-day seeded histories, hazard model, reference ranges,
              environment profiles, alert rules, chatbot Q&A + live-state answers
assets/     · one NASA photograph used in the UI (Earth at night from the ISS,
              NASA Image and Video Library), bundled locally for offline use and
              credited in the Methodology view; two further NASA images from an
              earlier design remain in the folder but are not displayed
vendor/     · Chart.js 4.4.1 (MIT, vendored so the app works fully offline)
```

Static HTML/CSS/JS only: no backend, no accounts, no tracking. The alert engine and chatbot are plain rule-based JavaScript; nothing is sent anywhere.

## Risk model and thresholds

Thresholds and reference ranges are grounded in NASA Human Research Program material:

| Vital | Safe range used | Basis |
|---|---|---|
| Resting heart rate | 60–100 bpm | Published reference range: standard clinical resting range; HRP cardiovascular risk context |
| Blood oxygen (SpO₂) | 95–100% | Published reference range: standard healthy saturation range |
| Sleep | 7–9 h / night | Published reference range; NASA schedules an 8.5 h sleep opportunity aboard ISS |
| Radiation dose | ISS 0.4 mSv/day (dose equivalent, simulation assumption); career limit 600 mSv (effective dose) | Career limit is a NASA requirement: NASA-STD-3001 Vol 1 §4.8.2. The limit is an effective dose; every dose figure simulated in the app is dose equivalent, so the app shows no time-to-career-limit estimate (the two quantities cannot be divided without a validated conversion). The ISS rate is a labelled simulation assumption, NOT the published ~0.2–0.5 mSv/day figure: that range is an effective-dose planning range (NASA OCHMO TB-020), a different quantity. Measured dose equivalent inside the Columbus laboratory runs higher and varies with location, shielding and solar cycle: up to 647 µSv/day (DOSIS/DOSIS 3D DOSTEL, Berger et al., J Space Weather Space Clim 7:A8, 2017) and 731 µSv/day in early 2019 (DOSIS 3D, reported in Zhang et al., Science Advances 6:eaaz1334, 2020) |
| Lunar surface dose | 1.4 mSv/day dose equivalent | Published measurement: Chang'E-4 LND, ~1,369 µSv/day (Science Advances, 2020) |
| Mars surface dose | 0.64 mSv/day dose equivalent | Published measurement: MSL/RAD at Gale Crater, 0.64 ± 0.12 mSv/day (Hassler et al., Science, 2014). The MSL/RAD cruise value of 1.84 ± 0.30 mSv/day (Zeitlin et al., Science, 2013) is a transit measurement and is NOT used for the surface environment |
| Exercise | 120 min/day target | NASA operational practice: ISS crew exercise ~2 h/day (ARED + aerobic) |
| Stress / mood | ≤ 5 / 10 self-reported | Simulation assumption: demo cut-offs on a self-reported scale |
| SPE dose surge | ×6 dose rate | Simulation assumption: event strength varies widely; NASA-STD-3001 protects crew to < 250 mSv for a design-reference SPE |
| Daily dose action levels | 90% of a nominal day's dose | Simulation assumption: internal demo thresholds, not NASA limits |
| Cabin CO2 watch / action | 1,500 / 2,500 ppm | Simulation assumption: demo cabin levels; real ISS CO2 runs higher than terrestrial indoor levels |

The app itself carries the full classification under **Methodology & parameter basis** (Data & resources section): every parameter is labelled a published reference range, a NASA requirement or operational practice, a published measurement, or a simulation assumption.

The five hazards (space radiation, isolation and confinement, distance from Earth, gravity fields, hostile/closed environments) and their effects (cardiovascular changes, muscle atrophy, bone loss, mental-health effects, vision and sleep problems) follow the NASA Human Research Program framework.

## NASA data and resources used

These are the resources listed on the challenge's official Resources tab, plus the open HRP data portals the challenge points to:

- **5 Hazards of Human Spaceflight** · https://www.nasa.gov/hrp/hazards/
- **Risks of Human Spaceflight** · https://www.nasa.gov/hrp/risks/
- **Ongoing HRP Research in Space** · https://www.nasa.gov/hrp/ongoing-hrp-research/
- **Monitoring Radiation for Astronaut Health (Canadian Space Agency)** · https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp
- **Why Do We Conduct Science Experiments in Space? (Canadian Space Agency)** · https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp
- **NASA Open Science Data Repository (OSDR)** · https://osdr.nasa.gov · open space-biology data; used for background reference ranges and findings (e.g. Inspiration4 civilian-astronaut dataset summaries)
- **NASA Life Sciences Portal (NLSP)** · https://nlsp.nasa.gov · gateway to HRP archive data
- **NASA Image and Video Library** · https://images.nasa.gov · the source of the one photograph the UI displays, downloaded and bundled locally in `assets/`: Earth at night from the ISS (iss043e218074, NASA/JSC). Two further images from the same library (an astronaut in the ISS Cupola, iss030e033294, NASA/ESA; the surface of Mars at Gale Crater, PIA16018, NASA/JPL-Caltech/MSSS) are bundled in `assets/` from an earlier design but are not displayed. NASA does not endorse this project.

No NASA logos, branding, flags or mission identifiers are used anywhere in this project.

## Use of Super Intelligence (AI) disclosure

AI assistants were used for **coding support and text drafting under team direction**; the project idea, design decisions, thresholds and content are the team's own. No AI-generated images, video or audio are used. No NASA branding was generated or used.

## Team

Team **VitalOrbit India** · Amartya Kushwaha (owner), Mohd Sahil, Babalu Kumar Bharti, Aditya Kumar Bharti, Saurabh Yadav, Sanvi Jain.

Built during the NASA Space Apps Challenge 2026 event window, 14–15 November 2026.

## Licence

Code: MIT. Chart.js in `vendor/` is under its own MIT licence (see `vendor/CHARTJS-LICENSE.md`).
