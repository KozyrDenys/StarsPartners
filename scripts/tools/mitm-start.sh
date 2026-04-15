#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${MITM_OUT_DIR:-artifacts/mitm}"
PORT="${MITM_PORT:-8080}"
mkdir -p "${OUT_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
FLOW_FILE="${OUT_DIR}/flows-${STAMP}.mitm"

echo "Starting mitmdump on port ${PORT}"
echo "Flow file: ${FLOW_FILE}"
echo "Use this proxy in browser: http://127.0.0.1:${PORT}"

exec mitmdump --listen-port "${PORT}" -w "${FLOW_FILE}"
