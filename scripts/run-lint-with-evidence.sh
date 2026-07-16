#!/usr/bin/env bash
set +e

output_file="$(mktemp)"

npx tsc --noEmit --pretty false >"$output_file" 2>&1
tsc_status=$?

node scripts/design-token-lock.js >>"$output_file" 2>&1
token_status=$?

{
  echo "# Sprint 8.4 temporary lint diagnostics"
  echo
  echo '```text'
  cat "$output_file"
  echo '```'
} > PRODUCTION_EVIDENCE_REPORT.md

cat "$output_file"
rm -f "$output_file"

if [ "$tsc_status" -ne 0 ] || [ "$token_status" -ne 0 ]; then
  exit 1
fi
