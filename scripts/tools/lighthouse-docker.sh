#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-collect}"
case "${MODE}" in
  autorun|collect|assert|healthcheck)
    shift || true
    ;;
  *)
    echo "Usage: $0 [collect|autorun|assert|healthcheck] [extra lhci args]"
    echo "Example: BASE_URL=https://gt.bet bash scripts/tools/lighthouse-docker.sh collect"
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is not installed."
  echo "Install Docker Desktop (or docker + colima) and rerun."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running/reachable."
  echo "Start Docker and rerun."
  exit 1
fi

IMAGE="${LHCI_DOCKER_IMAGE:-mcr.microsoft.com/playwright:v1.58.0-jammy}"
CONFIG_FILE="${LHCI_CONFIG_FILE:-.lighthouserc.js}"
TARGET_URL="${BASE_URL:-https://gt.bet}"
WORKDIR_IN_CONTAINER="${LHCI_WORKDIR_IN_CONTAINER:-/workspace}"
SHM_SIZE="${LHCI_DOCKER_SHM_SIZE:-1g}"
DOCKER_PLATFORM="${LHCI_DOCKER_PLATFORM:-}"
CHROME_PATH_IN_CONTAINER="${LHCI_CHROME_PATH:-/ms-playwright/chromium-1208/chrome-linux/chrome}"
CHROME_FLAGS="${LHCI_CHROME_FLAGS:---headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --no-zygote}"
PWD_ABS="$(pwd)"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "LHCI config file not found: ${CONFIG_FILE}"
  exit 1
fi

echo "Running Lighthouse CI in Docker"
echo "Image: ${IMAGE}"
echo "Mode: ${MODE}"
echo "BASE_URL: ${TARGET_URL}"
echo "Config: ${CONFIG_FILE}"
echo "Chrome path: ${CHROME_PATH_IN_CONTAINER}"

lhci_args=(npx lhci "${MODE}" --config="${CONFIG_FILE}")
if [[ "${MODE}" == "collect" || "${MODE}" == "autorun" ]]; then
  lhci_args+=(--collect.settings.chromeFlags="${CHROME_FLAGS}")
fi
if [[ "$#" -gt 0 ]]; then
  lhci_args+=("$@")
fi

if [[ -n "${DOCKER_PLATFORM}" ]]; then
  docker run --rm \
    --platform "${DOCKER_PLATFORM}" \
    --shm-size="${SHM_SIZE}" \
    -e "BASE_URL=${TARGET_URL}" \
    -e "CHROME_PATH=${CHROME_PATH_IN_CONTAINER}" \
    -e "CI=${CI:-}" \
    -v "${PWD_ABS}:${WORKDIR_IN_CONTAINER}" \
    -w "${WORKDIR_IN_CONTAINER}" \
    "${IMAGE}" \
    "${lhci_args[@]}"
else
  docker run --rm \
    --shm-size="${SHM_SIZE}" \
    -e "BASE_URL=${TARGET_URL}" \
    -e "CHROME_PATH=${CHROME_PATH_IN_CONTAINER}" \
    -e "CI=${CI:-}" \
    -v "${PWD_ABS}:${WORKDIR_IN_CONTAINER}" \
    -w "${WORKDIR_IN_CONTAINER}" \
    "${IMAGE}" \
    "${lhci_args[@]}"
fi

echo "Lighthouse Docker run completed."
