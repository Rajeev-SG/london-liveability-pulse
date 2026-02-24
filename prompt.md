# LONDON LIVEABILITY PULSE — CONFIG-AS-CODE DASHBOARD (END-TO-END SPEC FOR GPT-5.3-CODEX)

You are GPT-5.3-Codex working in a clean git repo.
Goal: implement an end-to-end dashboard project ("London Liveability Pulse") that collects live data on a schedule, stores a small timeseries, and renders a static web dashboard. Everything must be driven by config-as-code: edits should mostly be config changes, not code changes.

## 0) Hard requirements (must)
- Must be buildable, testable, runnable, and deployable entirely by CLI.
- Must deploy for free using GitHub Pages + GitHub Actions.
- Collector must run server-side in GitHub Actions, not in the browser, so API keys remain secret.
- Dashboard must be static (no backend server required).
- Project must be config-as-code:
  - A YAML config file defines what to collect + how to compute metrics + what to display.
  - A JSON Schema validates the config.
  - CI must validate config on every run.
- Must include tests:
  - Unit tests for config validation, data normalization, and metric calculations.
  - Integration tests for collector using mocked HTTP.
  - E2E tests for the dashboard using Playwright.
- Must include verification targets: a single `make verify` and `pnpm verify` should pass locally and in CI.

## 1) Data sources (use these exact APIs)

### 1.1 TfL Unified API (status + arrivals)
- TfL provides Unified API access; registering for app_id/app_key is recommended/expected. Use secrets in GitHub Actions. 
  Reference: TfL API register page. 
- Example calls (from TfL example PDF):
  - Line status (modes): `https://api.tfl.gov.uk/line/mode/tube/status` and multi-mode `.../line/mode/tube,overground,dlr,tflrail/status`  (case-insensitive path generally works but implement with canonical casing used in examples).
  - Stop arrivals: `https://api.tfl.gov.uk/StopPoint/{id}/arrivals`

### 1.2 Open-Meteo (weather)
- Use Open-Meteo Forecast API endpoint `/v1/forecast` with hourly variables and timezone.
- No API key.

### 1.3 ERG AirQuality (London Air monitoring index)
- Use hourly monitoring index by group:
  - `https://api.erg.ic.ac.uk/AirQuality/Hourly/MonitoringIndex/GroupName=London/Json`
- ERG docs note API is intended to be used from a fixed IP and if used from client-side pages you should proxy/cache server-side. Therefore: ONLY call this from collector (Actions), never from browser.

### 1.4 OPTIONAL: FHRS API v2
- If implemented, all calls MUST include header `x-api-version: 2`.
- Keep this off by default (`enabled: false`).

## 2) Product definition

### 2.1 Dashboard concept (MVP)
A single-page dashboard that answers “How painful is London right now?” using 4 signals:
1) Transit disruption (TfL line status)
2) Local wait time / commute friction (TfL arrivals for configured StopPoints)
3) Weather discomfort next 6 hours (Open-Meteo)
4) Air quality band/index (ERG monitoring index)

### 2.2 Outputs (what gets written)
The collector produces static JSON files consumed by the dashboard:
- `apps/dashboard/public/data/latest.json`  (latest snapshot + computed metrics)
- `apps/dashboard/public/data/history.json` (rolling timeseries of computed metrics; default keep last 7 days)
- `apps/dashboard/public/data/meta.json`    (build + collection metadata)

Constraints:
- Keep `latest.json` under ~200KB.
- Keep `history.json` under ~1MB by retention/trimming.

### 2.3 Liveability score (define it, deterministic)
Compute a 0–100 score where 100 is best.
Use a weighted penalty model with tunable weights from config:

Score = clamp(100 - (w_transit*P_transit + w_wait*P_wait + w_weather*P_weather + w_air*P_air), 0, 100)

Penalty definitions:
- P_transit:
  - For each watched mode/line, map status to severity points:
    - "Good Service" => 0
    - "Minor Delays" => 10
    - "Severe Delays" => 25
    - "Part Suspended" => 35
    - "Suspended" => 50
    - Unknown/other => 15
  - P_transit = average points across watched lines (or across lines returned when watch list empty).
- P_wait:
  - For each watched StopPoint, compute median minutes to next 3 arrivals (if fewer, use available).
  - Convert to penalty: 
    - <=3 min => 0
    - 3–7 => 10
    - 7–12 => 20
    - >12 => 35
  - P_wait = average across StopPoints.
- P_weather (next 6 hours):
  - Use Open-Meteo hourly:
    - precipitation_probability (%)
    - temperature_2m (°C)
    - wind_speed_10m (km/h or m/s depending on API; normalize)
  - Penalty:
    - Rain risk: max precip_prob in next 6h:
      - <=20 => 0
      - 21–50 => 10
      - 51–80 => 20
      - >80 => 30
    - Cold/heat discomfort using temp:
      - 16–22 => 0
      - 10–15 or 23–27 => 8
      - <10 or >27 => 16
    - Wind discomfort:
      - <=20 => 0
      - 21–35 => 5
      - >35 => 10
    - P_weather = sum of these three (max 56).
- P_air:
  - From ERG MonitoringIndex: derive the maximum AirQualityIndex reported across London (conservative).
  - Penalty by index band:
    - 1–3 => 0
    - 4–6 => 10
    - 7–9 => 25
    - 10 => 35

All thresholds & weights must be configurable in YAML.

### 2.4 UX requirements
Dashboard must show:
- Big “Liveability score” with last updated time (UTC and Europe/London display).
- 4 KPI tiles (Transit, Wait, Weather, Air) with short explanations.
- A 24h chart of Liveability score from `history.json`.
- A “What changed?” section listing:
  - Top 3 disrupted lines (if any)
  - Worst StopPoint by median wait
  - Max rain probability next 6h
  - Air quality max index and associated advice string if available (optional; ERG has a health advice feed but not required in MVP)

## 3) Config-as-code design

### 3.1 Config file
Create: `config/liveability.yaml`

### 3.2 Config schema
Create: `config/liveability.schema.json` (JSON Schema Draft 2020-12 or Draft-07, whichever your validator supports easily; Ajv is recommended).

### 3.3 Validation rules
- On every run (local + CI), validate:
  - YAML parses
  - Schema passes
  - Semantic checks pass:
    - at least 1 source enabled
    - weights are non-negative and at least one >0
    - retention_days between 1 and 30
    - collection interval >= 5 minutes for scheduled GitHub Actions compliance (but local can run ad-hoc)

## 4) Repository structure (must match)

/
  config/
    liveability.yaml
    liveability.schema.json
  apps/
    collector/
      src/
      test/
      package.json
      tsconfig.json
    dashboard/
      public/
        data/
          latest.json
          history.json
          meta.json
      src/
      package.json
      tsconfig.json
      vite.config.ts
      playwright.config.ts
  scripts/
    bootstrap-gh.sh
    set-secrets-gh.sh
  .github/
    workflows/
      collect-and-deploy.yml
  Makefile
  package.json
  pnpm-workspace.yaml
  README.md
  .gitignore

Use pnpm workspaces.

## 5) Tooling choices (keep it simple)
- Node.js 20+
- TypeScript
- pnpm workspaces
- Collector:
  - `undici` or native `fetch` (Node 20 has fetch)
  - `yaml` package to parse YAML
  - `ajv` for JSON Schema validation
  - `vitest` for unit/integration tests
  - `nock` (or MSW-node) for HTTP mocking in tests
- Dashboard:
  - Vite + React + TypeScript
  - Charting: use a simple library (e.g., Chart.js) OR minimal SVG charts; keep dependencies light
  - Playwright for E2E
- Formatting/lint:
  - Prettier + ESLint

## 6) CLI commands (must implement)
At repo root:
- `pnpm i` installs all
- `pnpm -w verify` runs:
  - typecheck
  - lint
  - unit + integration tests
  - e2e tests (headless)
  - config validation
- `pnpm -w collect` runs collector once and updates dashboard public data files
- `pnpm -w dev` runs dashboard dev server (uses existing public/data JSON)
- `pnpm -w build` builds dashboard to static dist
- `make verify` runs the same verification as pnpm
- `make deploy-gh-pages` (optional) runs via gh CLI to create repo settings instructions (see scripts)

## 7) GitHub Actions deployment (free)
Implement one workflow: `.github/workflows/collect-and-deploy.yml`
It must:
- run on:
  - schedule every 15 minutes (cron)
  - workflow_dispatch
- Steps:
  1) checkout
  2) setup node 20 + pnpm
  3) install
  4) validate config
  5) run collector (secrets for TfL)
  6) build dashboard
  7) upload pages artifact
  8) deploy pages using official actions

NOTE: scheduled workflows minimum interval is 5 minutes; we’ll use 15 to be polite. (Implement 15-minute default but allow config override.)

Also include README instructions to enable GitHub Pages “Source: GitHub Actions”.

## 8) Testing requirements

### 8.1 Unit tests (collector)
- Config validation:
  - valid config passes
  - invalid config fails with clear error (missing fields, wrong types, invalid weights)
- Metric computation:
  - Use fixture JSON files for:
    - TfL line status response
    - TfL arrivals response
    - Open-Meteo forecast response
    - ERG monitoring index response
  - Ensure penalties and score match expected snapshot values.

### 8.2 Integration tests (collector)
- Mock HTTP calls with nock:
  - ensure collector requests the right URLs/params
  - ensure collector writes `latest.json/history.json/meta.json` in correct shape
  - ensure retention trimming works

### 8.3 E2E tests (dashboard)
- Build and preview the dashboard and run Playwright:
  - page loads with no console errors
  - shows Liveability Score tile
  - shows updated time
  - chart renders (canvas exists, non-zero size)
  - “What changed?” section present

### 8.4 Verification artifacts
- Include a `docs/` or README section explaining:
  - how to run collector locally
  - how to run dashboard locally
  - how to run all tests
  - how to deploy via GitHub Actions

## 9) Implementation details (collector)

### 9.1 Collector output schema
Define a stable JSON shape, versioned:

latest.json:
{
  "schemaVersion": "1.0",
  "generatedAt": "ISO-8601",
  "location": { "name": "...", "lat": ..., "lon": ... },
  "score": { "value": 0-100, "components": { ... penalties ... } },
  "signals": {
    "transit": { "disruptedLines": [...], "modeSummary": ... },
    "wait": { "stoppoints": [...], "worst": ... },
    "weather": { "next6h": {...} },
    "air": { "maxIndex": n, "band": "...", "byAuthority": [...] }
  },
  "debug": { "sourceTimestamps": {...} }
}

history.json:
{
  "schemaVersion": "1.0",
  "retentionDays": n,
  "points": [
    { "t": "ISO-8601", "score": n, "p": { "transit":n, "wait":n, "weather":n, "air":n } }
  ]
}

meta.json:
{
  "schemaVersion": "1.0",
  "builtFrom": { "gitSha": "...", "runId": "...", "runAttempt": ... },
  "collection": { "intervalMinutes": n, "configHash": "..." }
}

### 9.2 Secrets
- TfL requires app_id/app_key in query params for authenticated usage. Use:
  - `TFL_APP_ID`
  - `TFL_APP_KEY`
Never write these into any JSON output.

### 9.3 Reliability rules
- Hard timeout each fetch (e.g., 10s).
- If one source fails, still write outputs but mark that signal as stale and reduce score confidence:
  - Add `debug.sourceErrors` and `signals.<x>.status = "error"`
  - Score must still compute: if a signal missing, use a conservative fallback penalty defined in config (e.g. fallback penalties).

## 10) Deliverables (must be produced in the repo)
- All files in the specified structure.
- Working local dev loop.
- Working `make verify`.
- Working GitHub Actions workflow.

---

# FILE CONTENTS TO CREATE (authoritative)

## A) config/liveability.yaml
(Use this default; it must pass schema)
```

project:
name: "London Liveability Pulse"
timezone: "Europe/London"
historyRetentionDays: 7
collectionIntervalMinutes: 15

location:
name: "Central London"
lat: 51.5074
lon: -0.1278

sources:
tfl:
enabled: true
baseUrl: "[https://api.tfl.gov.uk](https://api.tfl.gov.uk)"
appIdEnv: "TFL_APP_ID"
appKeyEnv: "TFL_APP_KEY"
modes: ["tube", "overground", "dlr", "tflrail"]
watchLines: []   # empty = use all lines returned for the modes
stopPoints:
- id: "940GZZLUKSX"   # King's Cross St Pancras (example; can be changed)
label: "King's Cross St Pancras"
- id: "940GZZLUEUS"   # Euston
label: "Euston"

openMeteo:
enabled: true
baseUrl: "[https://api.open-meteo.com](https://api.open-meteo.com)"
forecastHours: 48
hourlyVariables:
- "temperature_2m"
- "precipitation_probability"
- "wind_speed_10m"

ergAirQuality:
enabled: true
baseUrl: "[https://api.erg.ic.ac.uk](https://api.erg.ic.ac.uk)"
groupName: "London"

fhrs:
enabled: false
baseUrl: "[https://api.ratings.food.gov.uk](https://api.ratings.food.gov.uk)"
apiVersionHeader: 2
localAuthorityIds: []

scoring:
weights:
transit: 1.0
wait: 1.0
weather: 0.8
air: 1.0

fallbacks:
transitPenalty: 15
waitPenalty: 15
weatherPenalty: 10
airPenalty: 10

transitSeverityPoints:
goodService: 0
minorDelays: 10
severeDelays: 25
partSuspended: 35
suspended: 50
unknown: 15

waitPenaltyBands:
- { maxMinutes: 3, penalty: 0 }
- { maxMinutes: 7, penalty: 10 }
- { maxMinutes: 12, penalty: 20 }
- { maxMinutes: 999, penalty: 35 }

weatherPenalty:
rainBands:
- { maxProb: 20, penalty: 0 }
- { maxProb: 50, penalty: 10 }
- { maxProb: 80, penalty: 20 }
- { maxProb: 100, penalty: 30 }
tempComfort:
idealMin: 16
idealMax: 22
shoulderMin: 10
shoulderMax: 27
shoulderPenalty: 8
extremePenalty: 16
windBands:
- { maxSpeed: 20, penalty: 0 }
- { maxSpeed: 35, penalty: 5 }
- { maxSpeed: 999, penalty: 10 }

airPenalty:
- { maxIndex: 3, penalty: 0, band: "Low" }
- { maxIndex: 6, penalty: 10, band: "Moderate" }
- { maxIndex: 9, penalty: 25, band: "High" }
- { maxIndex: 10, penalty: 35, band: "Very High" }

```

## B) config/liveability.schema.json
Create a JSON Schema that enforces:
- required objects and types
- intervalMinutes >= 5
- retentionDays 1..30
- weights >= 0
- stopPoints array items require id+label
- hourlyVariables array non-empty when openMeteo.enabled

## C) .github/workflows/collect-and-deploy.yml
Must use official GitHub Pages actions:
- upload: actions/upload-pages-artifact
- deploy: actions/deploy-pages
Must run on schedule and workflow_dispatch, and set permissions for pages.

## D) Root workspace files
- package.json (workspaces scripts)
- pnpm-workspace.yaml
- Makefile
- README.md
- scripts/bootstrap-gh.sh (uses `gh` CLI to create repo + enable Pages source instructions)
- scripts/set-secrets-gh.sh (uses `gh secret set ...`)

## E) Seed data (so dashboard can run before first collection)
Create initial `apps/dashboard/public/data/latest.json`, `history.json`, `meta.json` with plausible dummy values (schema-valid) so `pnpm dev` works immediately.

---

# CODING RULES
- Do not leave TODOs.
- Make errors actionable (clear messages, exit codes).
- Avoid over-engineering. Prefer readable code.
- All commands must work on macOS + Linux.
- No Docker required.

# ACCEPTANCE CHECKLIST (Definition of Done)
1) `pnpm i`
2) `pnpm -w verify` passes on a clean machine.
3) `pnpm -w collect` updates the JSON files.
4) `pnpm -w dev` renders dashboard using the JSON files.
5) GitHub Actions workflow runs successfully on workflow_dispatch:
   - collects data
   - builds dashboard
   - deploys to Pages
6) No secrets leak into outputs.
```

---

## Authoritative file contents you must generate (include these exactly)

I’m giving you the **exact contents** for the “hard” pieces (config + GitHub Actions + CLI glue). Codex should generate the rest (TypeScript/React) to satisfy the spec and acceptance checklist.

### 1) `.github/workflows/collect-and-deploy.yml`

Uses:

* Scheduled workflows (POSIX cron) ([GitHub Docs][5])
* Official Pages artifact + deploy actions ([GitHub][6])
* Custom workflows for Pages ([GitHub Docs][4])

```yaml
name: Collect data + Deploy dashboard (GitHub Pages)

on:
  schedule:
    # Every 15 minutes (UTC). GitHub scheduled workflows can run as often as every 5 minutes.
    - cron: "*/15 * * * *"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "pnpm"

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: "9"

      - name: Install
        run: pnpm i --frozen-lockfile

      - name: Validate config
        run: pnpm -w validate:config

      - name: Collect data (server-side)
        env:
          TFL_APP_ID: ${{ secrets.TFL_APP_ID }}
          TFL_APP_KEY: ${{ secrets.TFL_APP_KEY }}
        run: pnpm -w collect

      - name: Verify (tests + typecheck)
        run: pnpm -w verify

      - name: Build dashboard
        run: pnpm -w build

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/dashboard/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

### 2) `config/liveability.yaml`

TfL endpoints used in implementation are documented in TfL examples PDF (status + arrivals). 
Open-Meteo forecast endpoint. ([open-meteo.com][2])
ERG monitoring index endpoint. ([api.erg.ic.ac.uk][3])

```yaml
project:
  name: "London Liveability Pulse"
  timezone: "Europe/London"
  historyRetentionDays: 7
  collectionIntervalMinutes: 15

location:
  name: "Central London"
  lat: 51.5074
  lon: -0.1278

sources:
  tfl:
    enabled: true
    baseUrl: "https://api.tfl.gov.uk"
    appIdEnv: "TFL_APP_ID"
    appKeyEnv: "TFL_APP_KEY"
    modes: ["tube", "overground", "dlr", "tflrail"]
    watchLines: [] # empty => use all lines returned for these modes
    stopPoints:
      - id: "940GZZLUKSX"
        label: "King's Cross St Pancras"
      - id: "940GZZLUEUS"
        label: "Euston"

  openMeteo:
    enabled: true
    baseUrl: "https://api.open-meteo.com"
    forecastHours: 48
    hourlyVariables:
      - "temperature_2m"
      - "precipitation_probability"
      - "wind_speed_10m"

  ergAirQuality:
    enabled: true
    baseUrl: "https://api.erg.ic.ac.uk"
    groupName: "London"

  fhrs:
    enabled: false
    baseUrl: "https://api.ratings.food.gov.uk"
    apiVersionHeader: 2
    localAuthorityIds: []

scoring:
  weights:
    transit: 1.0
    wait: 1.0
    weather: 0.8
    air: 1.0

  fallbacks:
    transitPenalty: 15
    waitPenalty: 15
    weatherPenalty: 10
    airPenalty: 10

  transitSeverityPoints:
    goodService: 0
    minorDelays: 10
    severeDelays: 25
    partSuspended: 35
    suspended: 50
    unknown: 15

  waitPenaltyBands:
    - { maxMinutes: 3, penalty: 0 }
    - { maxMinutes: 7, penalty: 10 }
    - { maxMinutes: 12, penalty: 20 }
    - { maxMinutes: 999, penalty: 35 }

  weatherPenalty:
    rainBands:
      - { maxProb: 20, penalty: 0 }
      - { maxProb: 50, penalty: 10 }
      - { maxProb: 80, penalty: 20 }
      - { maxProb: 100, penalty: 30 }
    tempComfort:
      idealMin: 16
      idealMax: 22
      shoulderMin: 10
      shoulderMax: 27
      shoulderPenalty: 8
      extremePenalty: 16
    windBands:
      - { maxSpeed: 20, penalty: 0 }
      - { maxSpeed: 35, penalty: 5 }
      - { maxSpeed: 999, penalty: 10 }

  airPenalty:
    - { maxIndex: 3, penalty: 0, band: "Low" }
    - { maxIndex: 6, penalty: 10, band: "Moderate" }
    - { maxIndex: 9, penalty: 25, band: "High" }
    - { maxIndex: 10, penalty: 35, band: "Very High" }
```

---

### 3) `scripts/bootstrap-gh.sh`

(Uses GitHub CLI. Does not “magic” UI steps; prints exact instructions.)

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-london-liveability-pulse}"
VISIBILITY="${2:-public}" # public is required for free GitHub Pages on many orgs; personal accounts allow public freely.

command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not installed."; exit 1; }

echo "Creating repo: ${REPO_NAME} (${VISIBILITY})"
gh repo create "${REPO_NAME}" --"${VISIBILITY}" --source=. --remote=origin --push

cat <<'EOF'

NEXT STEPS (GitHub Pages):
1) Go to repo Settings -> Pages
2) Under "Build and deployment" -> Source: select "GitHub Actions"
3) Run the workflow: Actions -> "Collect data + Deploy dashboard (GitHub Pages)" -> Run workflow

EOF
```

---

### 4) `scripts/set-secrets-gh.sh`

TfL keys are expected for usage. ([api.tfl.gov.uk][1])

```bash
#!/usr/bin/env bash
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not installed."; exit 1; }

: "${TFL_APP_ID:?Set TFL_APP_ID in your shell}"
: "${TFL_APP_KEY:?Set TFL_APP_KEY in your shell}"

echo "Setting GitHub secrets: TFL_APP_ID, TFL_APP_KEY"
gh secret set TFL_APP_ID --body "${TFL_APP_ID}"
gh secret set TFL_APP_KEY --body "${TFL_APP_KEY}"

echo "Done."
```

---

### 5) `Makefile`

```make
SHELL := /bin/bash

.PHONY: install validate-config collect dev build test e2e verify

install:
	pnpm i

validate-config:
	pnpm -w validate:config

collect:
	pnpm -w collect

dev:
	pnpm -w dev

build:
	pnpm -w build

test:
	pnpm -w test

e2e:
	pnpm -w e2e

verify:
	pnpm -w verify
```

---

## Implementation notes Codex must follow (non-negotiable)

### TfL endpoints to implement

Use the example endpoints shown in TfL’s “Example API requests” PDF for:

* Status: `/line/mode/{modes}/status` (comma-separated modes supported) 
* Arrivals: `/StopPoint/{id}/arrivals` 

### Open-Meteo endpoint to implement

Use `/v1/forecast` and request `hourly=<vars>` for the variables in config. ([open-meteo.com][2])

### ERG endpoint to implement

Use exactly:

* `/AirQuality/Hourly/MonitoringIndex/GroupName=London/Json` ([api.erg.ic.ac.uk][3])

And comply with the “server-side proxy/cache” guidance by never calling ERG from the browser. 

### Optional FHRS

If implemented, enforce the version header `x-api-version: 2` otherwise calls return no data. 

---

## What I expect Codex to generate beyond this spec

* Full TypeScript implementation for collector + dashboard.
* Full JSON Schema `config/liveability.schema.json` + Ajv validator.
* Root `package.json` + `pnpm-workspace.yaml` + per-app package.json scripts:

  * `validate:config`, `collect`, `dev`, `build`, `test`, `e2e`, `verify`
* Seed `apps/dashboard/public/data/{latest,history,meta}.json` (schema-valid)
* Vitest suites + fixtures for all sources
* Playwright E2E tests (headless)
* Vite React dashboard UI meeting UX requirements

---