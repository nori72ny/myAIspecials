#!/bin/bash
set -uo pipefail

COMMIT=$(git rev-parse HEAD)
DIR="evidence/release/$COMMIT"
mkdir -p "$DIR"

STATUS="PASSED"
FAILED_GATES=()

run_gate() {
  local name="$1"
  local command="$2"
  local log_file="$3"

  echo "Running $name..."
  if ! bash -o pipefail -c "$command" > "$DIR/$log_file" 2>&1; then
    STATUS="FAILED"
    FAILED_GATES+=("$name")
  fi
}

run_gate "ESLint" "npm run lint" "lint.log"
run_gate "TypeCheck" "npm run typecheck" "typecheck.log"
run_gate "Unit Tests" "npm run test" "unit-tests.log"
run_gate "Build" "npm run build" "build.log"

echo "Generating manifest.json..."
cat << MANIFEST > "$DIR/manifest.json"
{
  "project": "ACOS 2.0",
  "sprint": "7.4",
  "branch": "$(git rev-parse --abbrev-ref HEAD)",
  "commit": "$COMMIT",
  "timestamp": "$(date -Iseconds)"
}
MANIFEST

if [ "$STATUS" = "PASSED" ]; then
  REASON="All required quality gates completed successfully."
else
  FAILED_LIST=$(IFS=', '; echo "${FAILED_GATES[*]}")
  REASON="One or more required quality gates failed: $FAILED_LIST. Review the corresponding log files."
fi

echo "Generating release-verdict.json..."
cat << VERDICT > "$DIR/release-verdict.json"
{
  "status": "$STATUS",
  "reason": "$REASON"
}
VERDICT

# These checks are not executed by this script. Record them honestly instead of
# manufacturing successful evidence.
echo '{"status":"NOT_RUN"}' > "$DIR/live-openrouter-results.json"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/chat-results.xml"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/conversation-results.xml"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/weather-results.xml"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/retry-results.xml"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/localization-results.xml"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/api-connectivity-results.xml"
echo '<results><status>NOT_RUN</status></results>' > "$DIR/playwright-results.xml"
echo '{"status":"NOT_RUN"}' > "$DIR/accessibility-results.json"

if [ "$STATUS" != "PASSED" ]; then
  echo "Evidence generation failed because required quality gates did not pass." >&2
  exit 1
fi
