#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
nix build .#haddock-assets --out-link result-haddock
cp result-haddock/haddock.wasm haddock.wasm
mkdir -p generated/haddock public/shell/haddock
cp -R result-haddock/generated/haddock/. generated/haddock/
cp -R result-haddock/public/shell/haddock/. public/shell/haddock/
chmod -R u+w haddock.wasm generated/haddock public/shell/haddock
