#!/usr/bin/env bash
# Build aihc-haddock as a WASI P3 component without the Hackage index.
# A case-sensitive filesystem is required. The default macOS filesystem is not case-sensitive.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
compiler_root="${AIHC_HADDOCK_ROOT:-$project_root/.compiler-haddock}"
compiler_revision=7b0c849328ad36de9135bcc215c706187d6beb0c
if [[ ! -e "$compiler_root/.git" ]]; then
  git clone https://github.com/ai-haskell-compiler/aihc.git "$compiler_root"
  git -C "$compiler_root" checkout "$compiler_revision"
fi
if [[ "$(git -C "$compiler_root" rev-parse HEAD)" != "$compiler_revision" ]]; then
  echo 'The AIHC source does not match the required revision.' >&2
  exit 1
fi
# The compiler finds local packages in a workspace directory with one subdirectory for each package.
workspace="$project_root/.haddock-workspace"
rm -rf "$workspace"
mkdir "$workspace"
for package in aihc-hackage aihc-package-plan aihc-http; do
  ln -s "$compiler_root/tooling/$package" "$workspace/$package"
done
# The lock file fixes the dependency versions and the Cabal file revisions.
cp "$project_root/haddock/aihc.lock" "$compiler_root/bin/aihc-haddock/aihc.lock"
cd "$compiler_root"
nix develop --quiet --command cabal update
nix develop --quiet --command nix run .#aihc -- build bin/aihc-haddock \
  -O2 --target wasm32-wasip3 --constraint "aihc-haddock -hackage" --workspace "$workspace" \
  --build-root "$project_root/.haddock-build" --output "$project_root/.haddock-output"
cp "$project_root/.haddock-output/aihc-haddock.wasm" "$project_root/haddock.wasm"
