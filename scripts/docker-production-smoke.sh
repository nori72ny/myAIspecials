#!/usr/bin/env bash
set -euo pipefail

readonly expected_sha="${SMOKE_RELEASE_SHA:-}"
readonly image_name="origin-cloud-run-smoke:${expected_sha}"
readonly container_name="origin-cloud-run-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
readonly health_url="http://127.0.0.1:38080/api/health"
readonly synthetic_secret="synthetic-docker-smoke-only"

container_started=false

cleanup() {
  if [[ "${container_started}" == "true" ]]; then
    docker stop --time 5 "${container_name}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

capture_and_check_logs() {
  docker logs "${container_name}" > /tmp/origin-container.log 2>&1 || true
  if grep -Fq "${synthetic_secret}" /tmp/origin-container.log; then
    echo "Synthetic runtime secret was exposed in container logs" >&2
    exit 1
  fi
}

node scripts/assert-origin-release-sha.mjs "${expected_sha}"

if docker build \
  --build-arg ORIGIN_RELEASE_SHA=unknown \
  --tag origin-cloud-run-invalid:smoke \
  . >/tmp/origin-invalid-build.log 2>&1; then
  echo "Invalid release SHA unexpectedly passed the Docker build" >&2
  exit 1
fi
grep -Fq "ORIGIN_RELEASE_SHA must be the exact 40-character lowercase Git commit SHA" \
  /tmp/origin-invalid-build.log

docker build \
  --build-arg "ORIGIN_RELEASE_SHA=${expected_sha}" \
  --tag "${image_name}" \
  .

set +e
timeout 10s docker run --rm \
  --env PORT=8080 \
  --env NODE_ENV=production \
  --env FREE_ONLY=true \
  --env ORIGIN_RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --env "OPENROUTER_API_KEY=${synthetic_secret}" \
  "${image_name}" >/tmp/origin-mismatch-start.log 2>&1
mismatch_status=$?
set -e
if [[ "${mismatch_status}" -eq 0 || "${mismatch_status}" -eq 124 ]]; then
  echo "Mismatched runtime SHA unexpectedly started the container" >&2
  exit 1
fi
grep -Fq "Runtime release SHA does not match the immutable image release SHA" \
  /tmp/origin-mismatch-start.log
if grep -Fq "${synthetic_secret}" /tmp/origin-mismatch-start.log; then
  echo "Synthetic runtime secret was exposed in startup logs" >&2
  exit 1
fi

docker run --detach --rm \
  --name "${container_name}" \
  --publish 127.0.0.1:38080:8080 \
  --env PORT=8080 \
  --env NODE_ENV=production \
  --env FREE_ONLY=true \
  --env "ORIGIN_RELEASE_SHA=${expected_sha}" \
  --env "OPENROUTER_API_KEY=${synthetic_secret}" \
  "${image_name}" >/dev/null
container_started=true

health_payload=""
for _ in {1..30}; do
  if health_payload="$(curl --fail --silent --show-error "${health_url}" 2>/dev/null)"; then
    break
  fi
  sleep 1
done

if [[ -z "${health_payload}" ]]; then
  capture_and_check_logs
  sed 's/^/[container] /' /tmp/origin-container.log >&2
  echo "Cloud Run production container did not become healthy" >&2
  exit 1
fi

printf '%s' "${health_payload}" | node -e '
  const fs = require("node:fs");
  const expected = process.argv[1];
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  if (payload.status !== "ok" || payload.releaseSha !== expected) {
    process.stderr.write("Health response did not contain the exact release SHA\n");
    process.exit(1);
  }
' "${expected_sha}"

if [[ "${health_payload}" == *"${synthetic_secret}"* ]]; then
  echo "Synthetic runtime secret was exposed by /api/health" >&2
  exit 1
fi

capture_and_check_logs
echo "Docker production SHA smoke passed"
