#!/usr/bin/env bash
set -euo pipefail

command -v gh >/dev/null 2>&1 || { echo "ERROR: gh CLI not installed."; exit 1; }

ENV_FILE="${1:-.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${TFL_APP_KEY:?Set TFL_APP_KEY in ${ENV_FILE} (or your shell)}"

echo "Setting GitHub secret: TFL_APP_KEY"
gh secret set TFL_APP_KEY --body "${TFL_APP_KEY}"

echo "Done."
