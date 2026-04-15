#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${1:-${BASE_URL:-https://gt.bet/}}"
OUT_DIR="${ZAP_OUT_DIR:-artifacts/zap}"
ZAP_BIN="/Applications/ZAP.app/Contents/Java/zap.sh"
mkdir -p "${OUT_DIR}"
OUT_DIR_ABS="$(cd "${OUT_DIR}" && pwd)"

if [[ ! -x "${ZAP_BIN}" ]]; then
  echo "ZAP CLI is not found at ${ZAP_BIN}"
  echo "Install with: brew install --cask zap"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_HTML="${OUT_DIR}/zap-baseline-${STAMP}.html"
REPORT_HTML_ABS="${OUT_DIR_ABS}/zap-baseline-${STAMP}.html"

echo "Running ZAP baseline-style passive quick scan"
echo "Target: ${TARGET_URL}"
echo "Report: ${REPORT_HTML_ABS}"

"${ZAP_BIN}" -cmd -quickurl "${TARGET_URL}" -quickout "${REPORT_HTML_ABS}"

if [[ ! -f "${REPORT_HTML_ABS}" ]]; then
  echo "ZAP did not produce report at ${REPORT_HTML_ABS}"
  exit 1
fi

echo "Done: ${REPORT_HTML_ABS}"
