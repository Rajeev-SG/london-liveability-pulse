# London Liveability Pulse

A static, trust-first dashboard that answers: **"How painful is London right now?"** using live transit, arrivals, weather, and air-quality signals.

**Live site:** https://rajeev-sg.github.io/london-liveability-pulse/  
**Repo:** https://github.com/Rajeev-SG/london-liveability-pulse

## What This Project Demonstrates

- **Config-as-code analytics product**: YAML config + JSON Schema + semantic validation
- **Server-side data collection for a static site**: API keys stay in GitHub Actions, not in the browser
- **Trust & explainability UX**: provenance panel + metric lineage popovers
- **Production-style CI/CD**: GitHub Actions scheduled collector + GitHub Pages deployment
- **Testing discipline**: unit, integration (mocked HTTP), and Playwright E2E in one `verify` target
- **CLI-first automation**: `pnpm`, `make`, shell scripts, `gh` CLI bootstrap and secret setup

> Design decision: this project intentionally avoids a backend server. It uses a scheduled collector to generate static JSON snapshots, then deploys a static dashboard that reads those files.

## Why This Project Is Interesting

Many dashboards are either:
- fully static demos with hardcoded data, or
- full-stack apps with unnecessary backend complexity for read-only monitoring.

This project takes a middle path:
- **real data**, collected on a schedule,
- **no runtime backend**, and
- **clear provenance and lineage** so users can inspect how each metric was computed.

That combination is useful for portfolios, internal ops dashboards, civic monitoring tools, and lightweight observability surfaces.

## Architecture At A Glance

```text
TfL API (status + arrivals)      Open-Meteo API            ERG Air Quality API
          │                            │                           │
          └──────────────┬─────────────┴──────────────┬────────────┘
                         │                            │
               GitHub Actions scheduled workflow (every 15 min)
                         │
                         ├─ validate config (YAML + JSON Schema + semantic checks)
                         ├─ collect + normalize + score
                         ├─ emit provenance + lineage metadata
                         ├─ write static JSON files
                         │    ├─ apps/dashboard/public/data/latest.json
                         │    ├─ apps/dashboard/public/data/history.json
                         │    └─ apps/dashboard/public/data/meta.json
                         ├─ run verify (typecheck/lint/tests/e2e)
                         └─ build + deploy static dashboard to GitHub Pages
                                              │
                                              ▼
                           Vite + React static UI loads ./data/*.json at runtime
```

## Data Sources

| Source | Used For | Auth | Browser Direct? | Notes |
|---|---|---:|---:|---|
| TfL Unified API | line status + arrivals | `app_key` | No | Called by collector; `app_key` appended as query param |
| Open-Meteo | hourly forecast | none | No (by design here) | Collected server-side for consistency + lineage tracking |
| ERG Air Quality | London monitoring index | none | No | Intentionally server-side only (proxy/cache guidance) |
| FHRS (optional) | future extension | API version header | No | Disabled by default |

## Config-As-Code (How It Works)

### Core files

- `config/liveability.yaml`: product config (sources, stops, weights, thresholds, retention)
- `config/liveability.schema.json`: schema validation rules
- `apps/collector/src/config.ts`: YAML parsing + schema validation + semantic checks

### Validation layers

1. **YAML parse**
2. **JSON Schema validation** (shape, types, ranges)
3. **Semantic validation** (business rules), including:
   - at least one source enabled
   - non-negative weights and at least one weight > 0
   - retention days within allowed range
   - collection interval >= 5 minutes

### Why this matters

Most behavior changes are config changes, not code changes. Example modifications that require no code edits:
- add/remove watched TfL stop points
- tune scoring weights
- tune transit/weather/air thresholds
- adjust retention days
- enable/disable sources

## Scoring Model (Liveability Score)

The project computes a deterministic **0–100 score** (100 is best) using weighted penalties.

```text
Score = clamp(100 - (w_transit*P_transit + w_wait*P_wait + w_weather*P_weather + w_air*P_air), 0, 100)
```

Where penalties come from:
- **Transit**: TfL line statuses mapped to severity points, averaged across watched lines
- **Wait**: median wait for next 3 arrivals per watched stop, mapped to bands, averaged
- **Weather**: rain risk + temp comfort + wind discomfort (next 6h)
- **Air**: max London AQI mapped to configured penalty bands

All thresholds and weights are defined in `config/liveability.yaml`.

## Trust & Authenticity: How To Tell The Data Is Real

This dashboard is a static site, so the key question is fair:

**"How do I know this isn’t hardcoded?"**

### 1) The UI fetches runtime JSON, not embedded values
The frontend loads data from files at runtime:
- `./data/latest.json`
- `./data/history.json`
- `./data/meta.json`

See `apps/dashboard/src/App.tsx`.

### 2) The collector runs server-side before each deploy
The GitHub Actions workflow does this in order:
1. validate config
2. collect data (`pnpm -w collect`)
3. verify tests/typecheck
4. build dashboard
5. deploy to Pages

See `.github/workflows/collect-and-deploy.yml`.

### 3) The dashboard now includes a **Data Provenance** panel
The provenance panel shows:
- generator (`GitHub Actions` vs `Local CLI`)
- collection timestamp
- build timestamp
- freshness badge (`Fresh` / `Stale` / `Outdated`)
- commit SHA
- workflow run link (when collected in GitHub Actions)
- source statuses (`ok`, `error`, `disabled`)

This makes the "static site but real data" pipeline visible directly in the product.

### 4) You can inspect the live JSON directly
Open these in the browser:
- `/data/latest.json`
- `/data/history.json`
- `/data/meta.json`

On the live site:
- `https://rajeev-sg.github.io/london-liveability-pulse/data/latest.json`
- `https://rajeev-sg.github.io/london-liveability-pulse/data/history.json`
- `https://rajeev-sg.github.io/london-liveability-pulse/data/meta.json`

Check:
- `latest.json.collectedAtUtc` (freshness)
- `meta.json.buildTimeUtc` (deployment time)
- `history.json.points` (growing time series, not static demo values)
- `sourceStatuses` and `warnings` (failure transparency)

## Educational Lineage Tooltips (Explainability UI)

Each metric now has a **"How calculated"** popover that explains its data lineage.

### What the tooltip shows
For the hovered/focused metric (score, transit, wait, weather, air):
- API query (sanitized)
- ingestion steps
- transforms/normalization
- calculation steps
- config paths used
- current derived outputs
- fallback status and reason (if a fallback was used)

### Why this feature exists
- **Trust**: users can inspect derivation, not just outcomes
- **Debuggability**: easier to explain unexpected numbers
- **Educational value**: demonstrates data engineering lineage on a static product

### Secret redaction
TfL query strings shown in the UI are sanitized. Any `app_key` is redacted before being written to lineage metadata.

## Local Development

### Prerequisites
- Node.js 20+
- `pnpm` (or use `npx pnpm@9.15.9 ...` if Corepack is failing)

### `.env` (dotenv)
Create a repo-root `.env` file:

```bash
TFL_APP_KEY=your_tfl_key_here
```

### Install + run

```bash
# If Corepack/pnpm works on your machine
pnpm i
pnpm -w collect
pnpm -w dev

# If Corepack fails with a signature/key mismatch
npx pnpm@9.15.9 i
npx pnpm@9.15.9 -w collect
npx pnpm@9.15.9 -w dev
```

### Verify everything locally

```bash
pnpm -w verify
# or
make verify
```

`verify` runs:
- config validation
- typecheck
- lint
- unit/integration tests
- dashboard build
- Playwright E2E

## Testing Strategy

### Unit tests (collector)
Covers:
- config validation semantics
- normalization logic
- scoring calculations
- lineage URL sanitization (`app_key` redaction)

### Integration tests (collector + mocked HTTP)
Uses `nock` to verify:
- API requests and query params
- output JSON generation
- provenance metadata population
- lineage structure generation

### E2E tests (dashboard)
Uses Playwright to verify:
- dashboard renders from static JSON
- provenance panel appears
- lineage popovers open and display educational sections
- sanitized query strings are shown (no secret leakage)

## Deployment (GitHub Pages + GitHub Actions + gh CLI)

### 1) Bootstrap the repo on GitHub

```bash
./scripts/bootstrap-gh.sh london-liveability-pulse public
```

### 2) Set the TfL key from `.env`

```bash
./scripts/set-secrets-gh.sh .env
```

### 3) Enable Pages (workflow deployment mode)

You can do this in either way:

- UI: Repo Settings -> Pages -> Source = `GitHub Actions`
- CLI:

```bash
gh api --method POST repos/<owner>/<repo>/pages -f build_type=workflow
```

### 4) Trigger the workflow manually

```bash
gh workflow run collect-and-deploy.yml --repo <owner>/<repo>
```

### 5) Monitor the run

```bash
gh run list --repo <owner>/<repo> --workflow collect-and-deploy.yml --limit 3
gh run watch <run-id> --repo <owner>/<repo> --exit-status
```

### Scheduled collection
The workflow runs every **15 minutes (UTC)** via cron in `.github/workflows/collect-and-deploy.yml`.

## How To Modify / Extend This Project

### 1) Add a new watched TfL stop point (no code change)
Edit `config/liveability.yaml`:

```yaml
sources:
  tfl:
    stopPoints:
      - id: "940GZZLUKSX"
        label: "King's Cross St Pancras"
      - id: "940GZZLUEUS"
        label: "Euston"
      - id: "<NEW_STOP_ID>"
        label: "<New Stop Label>"
```

Then run:

```bash
pnpm -w validate:config
pnpm -w collect
pnpm -w dev
```

### 2) Tune scoring weights/thresholds (no code change)
Edit `config/liveability.yaml`:
- `scoring.weights.*`
- `scoring.transitSeverityPoints`
- `scoring.waitPenaltyBands`
- `scoring.weatherPenalty.*`
- `scoring.airPenalty`

### 3) Disable a source temporarily (no code change)
Set `enabled: false` in config for a source. The collector will:
- mark the source as `disabled`
- use fallback penalties where applicable
- expose this in `sourceStatuses`, `warnings` (if relevant), provenance/lineage UI

### 4) Add a new source (code + config)
Suggested workflow:
1. Add config fields in `config/liveability.yaml`
2. Update `config/liveability.schema.json`
3. Extend `LiveabilityConfig` in `apps/collector/src/types.ts`
4. Implement fetch client in `apps/collector/src/sources.ts`
5. Normalize payload in collector/normalize helpers
6. Add scoring logic
7. Emit lineage metadata for the new metric/source
8. Add UI tile / panel and explainability popover content
9. Add unit + integration + e2e tests

### 5) Add a new KPI tile with lineage tooltip
- Add metric output to `latest.json` contract (collector)
- Add lineage block under `latest.lineage.metrics.*`
- Extend dashboard `LatestData` / `LineagePayload` types
- Add `KpiTile` usage in `apps/dashboard/src/App.tsx`
- Add styles and Playwright assertion

## Repository Structure

```text
config/
  liveability.yaml              # Config-as-code: sources, thresholds, weights, retention
  liveability.schema.json       # JSON Schema validation for config
apps/
  collector/
    src/                        # Fetching, normalization, scoring, JSON output generation
    test/                       # Unit + integration tests (mocked HTTP)
  dashboard/
    public/data/                # Generated static JSON consumed by the UI
    src/                        # React/Vite dashboard + provenance + lineage popovers
    test/e2e/                   # Playwright E2E tests
scripts/
  bootstrap-gh.sh               # gh CLI repo bootstrap + push
  set-secrets-gh.sh             # Loads .env and sets GitHub secrets
.github/workflows/
  collect-and-deploy.yml        # Scheduled collect + verify + build + Pages deploy
Makefile                        # CLI aliases (install/collect/verify/etc)
package.json                    # Workspace scripts and shared dev tooling
```

## Limitations / Future Improvements

- **Static freshness lag**: the UI is only as fresh as the latest successful collector run/deploy.
- **Fallback tradeoffs**: if a source fails, the score stays available using configured fallbacks, but precision decreases.
- **Lineage verbosity vs file size**: rich educational metadata increases `latest.json` size; keep an eye on payload growth.
- **Optional future trust upgrade**: signed snapshots/attestation could strengthen authenticity guarantees further.

## Useful Commands (Copy/Paste)

```bash
# Validate config
pnpm -w validate:config

# Collect once (updates apps/dashboard/public/data/*.json)
pnpm -w collect

# Run dashboard locally
pnpm -w dev

# Full verification
pnpm -w verify

# Deploy helper scripts (gh CLI)
./scripts/bootstrap-gh.sh london-liveability-pulse public
./scripts/set-secrets-gh.sh .env
```
