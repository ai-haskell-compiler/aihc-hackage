#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
nix build .#components --out-link result-components "$@"
cp -RL result-components/. .
chmod -R u+w generated public/shell/haddock public/shell/toolchain parser.wasm haddock.wasm
