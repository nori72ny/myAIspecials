#!/usr/bin/env bash
# Read-only assessment of the free-model evidence lifetime recorded on a
# catalog file (normally the one committed on main).
#
# Usage:
#   check-free-model-expiry.sh <catalog-path> [threshold-days]
#
# Stdout (machine-readable, one key=value per line):
#   review_after=<ISO timestamp from the catalog>
#   remaining_seconds=<signed integer; negative once expired>
#   expired=true|false
#   alert=true|false        (true when expired or remaining <= threshold)
#
# Environment:
#   ORIGIN_EVIDENCE_NOW_EPOCH  Override "now" (seconds since epoch) so the
#                              assessment can be reproduced deterministically.
#
# Exit codes:
#   0  assessment completed (inspect the alert flag)
#   2  reviewAfter could not be read unambiguously from the catalog
#
# This script never writes to the catalog and never calls the network or gh.
set -euo pipefail

catalog_path="${1:?usage: check-free-model-expiry.sh <catalog-path> [threshold-days]}"
threshold_days="${2:-3}"

if ! [[ "$threshold_days" =~ ^[0-9]+$ ]]; then
  echo "check-free-model-expiry: threshold-days must be a non-negative integer (got: $threshold_days)" >&2
  exit 2
fi

# Only the quoted evidence value matches; the `reviewAfter: string` type
# declaration in the catalog does not.
matches="$(grep -o 'reviewAfter: "[^"]*"' "$catalog_path" | sed 's/^reviewAfter: "//; s/"$//' || true)"
match_count="$(printf '%s' "$matches" | grep -c . || true)"
if [ "$match_count" != "1" ]; then
  echo "check-free-model-expiry: expected exactly one quoted reviewAfter in $catalog_path, found $match_count" >&2
  exit 2
fi
review_after="$matches"

if ! review_epoch="$(date -u -d "$review_after" +%s 2>/dev/null)"; then
  echo "check-free-model-expiry: could not parse reviewAfter timestamp: $review_after" >&2
  exit 2
fi

now_epoch="${ORIGIN_EVIDENCE_NOW_EPOCH:-$(date -u +%s)}"
if ! [[ "$now_epoch" =~ ^-?[0-9]+$ ]]; then
  echo "check-free-model-expiry: ORIGIN_EVIDENCE_NOW_EPOCH must be an integer (got: $now_epoch)" >&2
  exit 2
fi

remaining_seconds=$((review_epoch - now_epoch))
threshold_seconds=$((threshold_days * 86400))

expired=false
if [ "$remaining_seconds" -le 0 ]; then
  expired=true
fi

alert=false
if [ "$remaining_seconds" -le "$threshold_seconds" ]; then
  alert=true
fi

printf 'review_after=%s\n' "$review_after"
printf 'remaining_seconds=%s\n' "$remaining_seconds"
printf 'expired=%s\n' "$expired"
printf 'alert=%s\n' "$alert"
