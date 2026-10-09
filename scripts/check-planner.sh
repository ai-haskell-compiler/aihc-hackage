#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --experimental-wasm-jspi --test planner/test.mjs
nix develop --quiet --command ormolu --mode check planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs
nix develop --quiet --command hlint planner/src haddock/web
