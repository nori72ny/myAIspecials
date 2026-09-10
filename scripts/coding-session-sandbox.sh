#!/usr/bin/env bash
# Run only the public repository's coding-session regression suite.
set -euo pipefail
root=$(pwd -P)
image=node:22-bookworm-slim
name="origin-coding-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker image inspect "$image" >/dev/null
timeout --signal=TERM --kill-after=10s 300s docker run --rm --name "$name" \
  --network none --cap-drop ALL --security-opt no-new-privileges \
  --read-only --user 1000:1000 --pids-limit 128 --cpus 2 --memory 3g \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  --tmpfs /work:rw,nosuid,nodev,size=512m,mode=1777 \
  --mount "type=bind,src=$root/src,dst=/source/src,readonly" \
  --mount "type=bind,src=$root/node_modules,dst=/deps/node_modules,readonly" \
  --mount "type=bind,src=$root/scripts/coding-session-vitest.config.mjs,dst=/source/config.mjs,readonly" \
  --workdir /work --env HOME=/tmp --env CI=true \
  "$image" sh -eu -c '
    cp -r /source/src /work/src
    cp /source/config.mjs /work/vitest.config.mjs
    ln -s /deps/node_modules /work/node_modules
    node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --configLoader runner
  '
