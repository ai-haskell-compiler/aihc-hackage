#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
nix build .#components --out-link result-components "$@"
scripts/use-components.sh result-components
