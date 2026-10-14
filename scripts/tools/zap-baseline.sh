#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Native ZAP is deprecated for this project; using the reproducible Docker scanner."
exec "${SCRIPT_DIR}/zap-baseline-docker.sh" "$@"
