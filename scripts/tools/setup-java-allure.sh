#!/usr/bin/env bash
set -euo pipefail

OS_NAME="$(uname -s)"

has_java() {
  if ! command -v java >/dev/null 2>&1; then
    return 1
  fi
  local output
  output="$(java -version 2>&1 || true)"
  if echo "${output}" | grep -qi "unable to locate a java runtime"; then
    return 1
  fi
  return 0
}

has_allure() {
  if command -v allure >/dev/null 2>&1; then
    return 0
  fi
  npx --yes allure --version >/dev/null 2>&1
}

if [[ "${OS_NAME}" != "Darwin" ]]; then
  echo "This setup helper currently supports macOS/Homebrew."
  echo "Install manually on your OS:"
  echo "  - Java (OpenJDK 21 recommended)"
  echo "  - Allure CLI (or use project dependency via: npx allure ...)"
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required on macOS for this setup helper."
  echo "Install Homebrew first, then rerun."
  exit 1
fi

install_formula_if_missing() {
  local formula="$1"
  if brew list --versions "${formula}" >/dev/null 2>&1; then
    echo "Already installed: ${formula}"
    return 0
  fi
  echo "Installing ${formula}..."
  brew install "${formula}"
}

if has_java; then
  echo "Java runtime is already available."
else
  install_formula_if_missing openjdk
fi

if has_allure; then
  echo "Allure CLI is already available (global or via npx)."
else
  install_formula_if_missing allure
fi

OPENJDK_BIN=""
if [[ -d "/opt/homebrew/opt/openjdk/bin" ]]; then
  OPENJDK_BIN="/opt/homebrew/opt/openjdk/bin"
elif [[ -d "/usr/local/opt/openjdk/bin" ]]; then
  OPENJDK_BIN="/usr/local/opt/openjdk/bin"
fi

if [[ -n "${OPENJDK_BIN}" ]]; then
  echo ""
  echo "If Java is still not found in PATH, add this line to your shell profile:"
  echo "export PATH=\"${OPENJDK_BIN}:\$PATH\""
fi

echo ""
echo "Verification:"
if has_java; then
  java -version 2>&1 | head -n 2
else
  echo "Java runtime is still not available in current PATH."
fi

if command -v allure >/dev/null 2>&1; then
  if has_java; then
    allure --version || true
  elif [[ -n "${OPENJDK_BIN}" ]]; then
    PATH="${OPENJDK_BIN}:${PATH}" allure --version || true
  else
    echo "Allure is installed, but Java is not in PATH yet."
  fi
else
  npx --yes allure --version || true
fi

exit 0
