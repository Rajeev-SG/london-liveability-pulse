# London Liveability Pulse

Static GitHub Pages dashboard + GitHub Actions collector for TfL, weather, and London air-quality signals.

## Quick start

```bash
pnpm i
pnpm -w validate:config
pnpm -w collect
pnpm -w dev
```

## Verify

```bash
pnpm -w verify
# or
make verify
```

## Required secrets (for GitHub Actions collector)

- `TFL_APP_KEY`

## Local secrets with dotenv

Create a `.env` file in the repo root:

```bash
TFL_APP_KEY=your_tfl_key_here
```

## GitHub Pages deploy (gh CLI)

```bash
./scripts/bootstrap-gh.sh <repo-name> public
./scripts/set-secrets-gh.sh .env
```

Then set Pages source to `GitHub Actions` in repository settings and run the workflow.
