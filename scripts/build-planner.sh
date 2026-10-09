#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
nix build .#planner-assets --out-link result-planner
cp result-planner/planner.wasm planner.wasm
mkdir -p generated/planner
cp -R result-planner/generated/planner/. generated/planner/
chmod -R u+w planner.wasm generated/planner
