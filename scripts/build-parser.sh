#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
nix build .#parser-assets --out-link result-parser
cp result-parser/parser.wasm parser.wasm
mkdir -p generated
cp -R result-parser/generated/. generated/
chmod -R u+w parser.wasm generated
