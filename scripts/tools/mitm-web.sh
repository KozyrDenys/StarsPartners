#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${MITM_OUT_DIR:-artifacts/mitm}"
PORT="${MITM_PORT:-8080}"
WEB_PORT="${MITM_WEB_PORT:-8081}"
mkdir -p "${OUT_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
FLOW_FILE="${OUT_DIR}/flows-${STAMP}.mitm"

echo "Starting mitmweb proxy:${PORT} ui:${WEB_PORT}"
echo "Flow file: ${FLOW_FILE}"
echo "Open UI: http://127.0.0.1:${WEB_PORT}"

exec mitmweb --listen-port "${PORT}" --web-port "${WEB_PORT}" -w "${FLOW_FILE}"
