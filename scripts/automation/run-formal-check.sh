#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

OUT_DIR=${FORMAL_OUT_DIR:-artifacts/hermetic-reports/formal}
SPEC_FILE=${FORMAL_SPEC_FILE:-spec/formal/RateLimiterQuota.tla}
CFG_FILE=${FORMAL_CFG_FILE:-spec/formal/RateLimiterQuota.cfg}
TIMEOUT_SEC=${FORMAL_TIMEOUT_SEC:-60}

mkdir -p "$OUT_DIR"

SUMMARY_FILE="$OUT_DIR/formal-summary.json"
LOG_FILE="$OUT_DIR/tlc.log"

write_summary() {
  local status="$1"
  local tool="$2"
  local exit_code="$3"
  local message="$4"

  cat > "$SUMMARY_FILE" <<JSON
{
  "generatedAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "status": "$status",
  "tool": "$tool",
  "exitCode": $exit_code,
  "spec": "$SPEC_FILE",
  "config": "$CFG_FILE",
  "log": "$LOG_FILE",
  "message": "$message"
}
JSON
}

if [[ ! -f "$SPEC_FILE" || ! -f "$CFG_FILE" ]]; then
  write_summary "no_spec" "none" 0 "formal specification or config file not found"
  echo "formal check skipped: spec/config missing"
  exit 0
fi

TLC_TOOL=""
TLC_CMD=()

if command -v tlc2.TLC >/dev/null 2>&1; then
  TLC_TOOL="tlc2.TLC"
  TLC_CMD=(tlc2.TLC -config "$CFG_FILE" "$SPEC_FILE")
elif [[ -n "${TLA_TOOLS_JAR:-}" && -f "${TLA_TOOLS_JAR}" ]]; then
  if command -v java >/dev/null 2>&1; then
    TLC_TOOL="java-tlc"
    TLC_CMD=(java -cp "$TLA_TOOLS_JAR" tlc2.TLC -config "$CFG_FILE" "$SPEC_FILE")
  else
    write_summary "tool_not_available" "java" 0 "java command not found"
    echo "formal check skipped: java not available"
    exit 0
  fi
else
  write_summary "tool_not_available" "tlc" 0 "TLC tool not found. set TLA_TOOLS_JAR or install tlc2.TLC"
  echo "formal check skipped: TLC tool not available"
  exit 0
fi

set +e
if command -v timeout >/dev/null 2>&1; then
  timeout "${TIMEOUT_SEC}s" "${TLC_CMD[@]}" >"$LOG_FILE" 2>&1
  RC=$?
else
  "${TLC_CMD[@]}" >"$LOG_FILE" 2>&1
  RC=$?
fi
set -e

if [[ $RC -eq 0 ]]; then
  write_summary "pass" "$TLC_TOOL" 0 "formal model check completed"
elif [[ $RC -eq 124 ]]; then
  write_summary "timeout" "$TLC_TOOL" 124 "formal model check timed out"
else
  write_summary "fail" "$TLC_TOOL" "$RC" "formal model check failed. inspect tlc.log"
fi

# Formal step is report-only in this project.
exit 0
