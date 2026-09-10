#!/usr/bin/env bash
set -euo pipefail
# PW_VERSION MUST equal the @playwright/test version npm ci installs. It is
# pinned EXACT in web/package.json; bump both in lockstep.
PW_VERSION="1.61.1"
# Run-scoped webServer port so concurrent runs on a shared host never collide.
E2E_PORT="${E2E_PORT:-$((3100 + RANDOM % 800))}"
cd "$(dirname "$0")/.."
# The app uses an in-process PGlite database for tests, so there is no db
# container to start or tear down. Run as the host user, HOME/npm cache in
# /tmp. --network host lets the config's production webServer bind 127.0.0.1.
docker run --rm --init --ipc=host --network host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -e CI=1 -e E2E_PORT="$E2E_PORT" -v "$PWD":/work -w /work \
  "mcr.microsoft.com/playwright:v${PW_VERSION}-noble" \
  sh -c 'npm ci && npm run test:e2e'
