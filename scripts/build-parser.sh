#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
compiler_root="${AIHC_ROOT:-$project_root/.compiler}"
compiler_revision=bf991343a626e758a7d6d616770824fb55aaac92
if [[ ! -e "$compiler_root/.git" ]]; then
  git clone https://github.com/ai-haskell-compiler/aihc.git "$compiler_root"
  git -C "$compiler_root" checkout "$compiler_revision"
fi
if [[ "$(git -C "$compiler_root" rev-parse HEAD)" != "$compiler_revision" ]]; then
  echo 'The AIHC source does not match the required revision.' >&2
  exit 1
fi
cd "$compiler_root"
nix develop --quiet --command cabal update
nix develop --quiet --command cabal run -v0 exe:aihc -- build "$project_root/parser" \
  -O2 --target wasm32-wasip3 --build-root "$project_root/.parser-build" --output "$project_root/.parser-output"
cp "$project_root/.parser-output/aihc-hackage-parser.wasm" "$project_root/parser.wasm"
