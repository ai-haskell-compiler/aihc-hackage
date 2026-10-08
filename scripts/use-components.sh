#!/usr/bin/env bash
set -euo pipefail
components="$(cd "$1" && pwd)"
cd "$(dirname "$0")/.."
for path in generated public/shell/haddock public/shell/toolchain parser.wasm haddock.wasm; do
  test -e "$components/$path"
done
# Remove old generated files before a component changes its module list.
rm -rf generated public/shell/haddock public/shell/toolchain
mkdir -p public/shell
cp -R "$components/generated" generated
cp -R "$components/public/shell/haddock" public/shell/haddock
cp -R "$components/public/shell/toolchain" public/shell/toolchain
cp "$components/parser.wasm" "$components/haddock.wasm" .
chmod -R u+w generated public/shell/haddock public/shell/toolchain parser.wasm haddock.wasm
