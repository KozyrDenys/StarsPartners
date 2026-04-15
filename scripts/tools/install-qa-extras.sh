#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for qa extras installation."
  exit 1
fi

FORMULAE=(
  fd
  bat
  git-delta
  fzf
  httpie
  hyperfine
  gron
  htop
  watchman
)

echo "Installing QA extra tools with Homebrew..."
for formula in "${FORMULAE[@]}"; do
  if brew list --versions "$formula" >/dev/null 2>&1; then
    echo "  - $formula already installed"
    continue
  fi
  echo "  - installing $formula"
  brew install "$formula"
done

echo "QA extra tools installation completed."
