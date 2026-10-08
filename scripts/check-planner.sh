#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --experimental-wasm-jspi --test planner/test.mjs
nix develop .compiler-haddock --quiet --command ormolu --mode check planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs
nix develop .compiler-haddock --quiet --command hlint planner/src haddock/web
