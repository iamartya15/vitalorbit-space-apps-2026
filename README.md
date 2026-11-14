# VitalOrbit — Astronaut Health Command Dashboard

**Team VitalOrbit India · NASA Space Apps Challenge 2026 (Universal Event)**
Challenge: **Create Health Monitoring Software for Astronauts on Space Missions**

VitalOrbit is a colour-first health monitoring dashboard that lets an astronaut see their own health at a glance — green / amber / red status, 7-day trend charts, smart alerts with plain-language actions, a daily health timeline, and a rule-based health chatbot. It is built for the astronaut, not the doctor: on a long mission the astronaut *is* the first responder.

> **SIMULATED DATA.** Every live value is simulated demo data for fictional crew members — it is not real astronaut data and not a live medical feed. VitalOrbit is a monitoring and awareness tool, **not a medical device and not a diagnosis**.

## Live demo

- **Live app:** https://iamartya15.github.io/vitalorbit-space-apps-2026/
- **Demo deck (7 slides):** https://iamartya15.github.io/vitalorbit-space-apps-2026/deck/VitalOrbit-Demo-Deck.pdf
- **Demo deck (PPTX):** [deck/VitalOrbit-Demo-Deck.pptx](deck/VitalOrbit-Demo-Deck.pptx)

## How to run

No build step, no server, no install. Open `index.html` in any modern browser (or serve the folder with any static server, e.g. `python3 -m http.server`). Everything — including Chart.js, vendored in `vendor/` — runs locally and offline.

## What it does

- **Crew overview** — 4 fictional demo astronauts, each with an overall green / amber / red status. Click a crew member to inspect them.
- **Vitals panel** — heart rate, blood oxygen (SpO₂), sleep, stress/mood score, exercise minutes, radiation dose. Each vital shows its current value, its safe-range band, and its status. Values update every 3 seconds (simulated feed).
- **7-day trend charts** — heart rate, SpO₂, sleep and radiation dose, with the safe range shown as a green band, so a drift is visible before it becomes an alert.
- **Alert engine** — rule-based thresholds evaluated on every reading (e.g. resting HR above 100 bpm for consecutive readings → amber alert). Every alert carries a plain-language recommended action.
- **Environment switcher** — Spacecraft / ISS / Moon / Mars. Switching changes the hazard context, radiation dose rates, and the countermeasures tracked.
- **5-Hazards risk view** — each of NASA's five hazards of human spaceflight mapped to the vitals it affects, its current risk level, and the countermeasure being tracked.
- **Daily health timeline** — exercise, meals, sleep window and check-ins across the day; overdue items are flagged.
- **Health chatbot** — rule-based Q&A on ~15 common questions (heart rate, sleep, exercise, radiation, bone loss, isolation…), with a short education note under each answer. General information only — never a diagnosis.

## Architecture

```
index.html  — dashboard layout (no NASA logos, branding, flags or mission identifiers)
styles.css  — dark "mission control" theme, colour-first status
app.js      — live simulation loop, alert engine, charts, timeline, chatbot
data.js     — crew profiles, 7-day seeded histories, hazard model, reference ranges,
              environment profiles, chatbot Q&A
vendor/     — Chart.js 4.4.1 (MIT, vendored so the app works fully offline)
```

Static HTML/CSS/JS only — no backend, no accounts, no tracking. The alert engine and chatbot are plain rule-based JavaScript; nothing is sent anywhere.

## Risk model and thresholds

Thresholds and reference ranges are grounded in NASA Human Research Program material:

| Vital | Safe range used | Basis |
|---|---|---|
| Resting heart rate | 60–100 bpm | Standard clinical resting range; HRP cardiovascular risk context |
| Blood oxygen (SpO₂) | 95–100% | Standard healthy saturation range |
| Sleep | 7–9 h / night | NASA-recommended sleep target for crew |
| Radiation dose | ISS ~0.2–0.5 mSv/day; career limit 600 mSv | NASA-STD-3001 (2022); ISS dose rates from HRP material |
| Exercise | 120 min/day target | ISS countermeasure exercise protocol (ARED + treadmill) |
| Stress / mood | ≤ 5 / 10 self-reported | Behavioural-health watch threshold used by the alert engine |

The five hazards (space radiation, isolation and confinement, distance from Earth, gravity fields, hostile/closed environments) and their effects (cardiovascular changes, muscle atrophy, bone loss, mental-health effects, vision and sleep problems) follow the NASA Human Research Program framework.

## NASA data and resources used

These are the resources listed on the challenge's official Resources tab, plus the open HRP data portals the challenge points to:

- **5 Hazards of Human Spaceflight** — https://www.nasa.gov/hrp/hazards/
- **Risks of Human Spaceflight** — https://www.nasa.gov/hrp/risks/
- **Ongoing HRP Research in Space** — https://www.nasa.gov/hrp/ongoing-hrp-research/
- **Monitoring Radiation for Astronaut Health (Canadian Space Agency)** — https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp
- **Why Do We Conduct Science Experiments in Space? (Canadian Space Agency)** — https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp
- **NASA Open Science Data Repository (OSDR)** — https://osdr.nasa.gov — open space-biology data; used for background reference ranges and findings (e.g. Inspiration4 civilian-astronaut dataset summaries)
- **NASA Life Sciences Portal (NLSP)** — https://nlsp.nasa.gov — gateway to HRP archive data

No NASA logos, branding, flags or mission identifiers are used anywhere in this project.

## Use of Super Intelligence (AI) disclosure

AI assistants were used for **coding support and text drafting under team direction**; the project idea, design decisions, thresholds and content are the team's own. No AI-generated images, video or audio are used. No NASA branding was generated or used.

## Team

Team **VitalOrbit India** — Amartya Kushwaha (owner), Mohd Sahil, Babalu Kumar Bharti, Aditya Kumar Bharti, Saurabh Yadav, Sanvi Jain.

Built during the NASA Space Apps Challenge 2026 event window, 14–15 November 2026.

## Licence

Code: MIT. Chart.js in `vendor/` is under its own MIT licence (see `vendor/CHARTJS-LICENSE.md`).
