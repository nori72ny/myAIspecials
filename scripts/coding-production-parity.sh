#!/usr/bin/env bash
# Public, credential-free CI checkout only: reproduce the worker's full test check.
set -euo pipefail
root=$(pwd -P)
verify_root=$(mktemp -d)
name="origin-coding-parity-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$verify_root"
}
trap cleanup EXIT INT TERM
node --import tsx --input-type=module -e '
  import { copyTrustedCodingCheckoutV14 } from "./src/agent/codingWorkerCheckoutV14.ts";
  await copyTrustedCodingCheckoutV14(process.cwd(), process.argv[1]);
' "$verify_root"
# Match the actual production worker's single-check deadline. Do not let CI
# pass with 300s while the live worker would time out earlier.
check_timeout_seconds=$(node --import tsx --input-type=module -e '
  import { CODING_CHECK_TIMEOUT_MS } from "./src/agent/codingWorkerTimingV14.ts";
  if (!Number.isSafeInteger(CODING_CHECK_TIMEOUT_MS) || CODING_CHECK_TIMEOUT_MS <= 0 || CODING_CHECK_TIMEOUT_MS % 1000) process.exit(1);
  process.stdout.write(String(CODING_CHECK_TIMEOUT_MS / 1000));
')
[[ "$check_timeout_seconds" =~ ^[0-9]+$ ]] || exit 1
timeout --signal=TERM --kill-after=10s "${check_timeout_seconds}s" docker run --rm --name "$name" \
  --network none --cap-drop ALL --security-opt no-new-privileges \
  --read-only --user "$(id -u):$(id -g)" --pids-limit 128 --cpus 2 --memory 3g \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
  --mount "type=bind,src=$verify_root,dst=/work" \
  --mount "type=bind,src=$root/node_modules,dst=/work/node_modules,readonly" \
  --workdir /work --env HOME=/tmp --env CI=true --env NODE_ENV=test \
  --env FREE_ONLY=false --env ORIGIN_ISOLATED_VERIFY=true \
  --env PATH=/work/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  node:22-bookworm-slim sh -eu -c \
  "vitest run --configLoader runner --maxWorkers=2 --exclude 'tests/e2e/**' --exclude 'tests/api/**' --reporter=default"
