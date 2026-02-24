#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-london-liveability-pulse}"
VISIBILITY="${2:-public}" # public is required for free GitHub Pages on many orgs; personal accounts allow public freely.

command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not installed."; exit 1; }

echo "Creating repo: ${REPO_NAME} (${VISIBILITY})"
gh repo create "${REPO_NAME}" --"${VISIBILITY}" --source=. --remote=origin --push

cat <<'EOF2'

NEXT STEPS (GitHub Pages):
1) Go to repo Settings -> Pages
2) Under "Build and deployment" -> Source: select "GitHub Actions"
3) Run the workflow: Actions -> "Collect data + Deploy dashboard (GitHub Pages)" -> Run workflow

EOF2
