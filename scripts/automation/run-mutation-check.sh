#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

OUT_DIR=${MUTATION_OUT_DIR:-artifacts/summary}
SUMMARY_FILE="$OUT_DIR/mutation-summary.json"
DETAIL_FILE="$OUT_DIR/mutation-detail.log"

mkdir -p "$OUT_DIR"

write_summary() {
  local status="$1"
  local message="$2"
  local score="$3"
  cat > "$SUMMARY_FILE" <<JSON
{
  "generatedAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "status": "$status",
  "score": $score,
  "message": "$message",
  "detailLog": "$DETAIL_FILE"
}
JSON
}

has_mutation_script=$(node -e "const p=require('./package.json'); process.stdout.write(p.scripts && p.scripts.mutation ? 'yes' : 'no');")

if [[ "$has_mutation_script" != "yes" ]]; then
  echo "mutation script is not defined in package.json" > "$DETAIL_FILE"
  write_summary "no_script" "mutation script is not configured in this repository" null
  exit 0
fi

set +e
if command -v timeout >/dev/null 2>&1; then
  timeout 180s pnpm run mutation > "$DETAIL_FILE" 2>&1
  RC=$?
else
  pnpm run mutation > "$DETAIL_FILE" 2>&1
  RC=$?
fi
set -e

if [[ $RC -eq 0 ]]; then
  write_summary "pass" "mutation run completed" null
elif [[ $RC -eq 124 ]]; then
  write_summary "timeout" "mutation run timed out" null
else
  write_summary "fail" "mutation run failed" null
fi

# report-only
exit 0
