#!/usr/bin/env bash
# Build the planner for Cloudflare Workers. No native process is deployed.
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
workspace="$project_root/.planner-workspace"
mkdir -p "$workspace"
for package in aihc-hackage aihc-package-plan; do
  ln -sfn "$compiler_root/tooling/$package" "$workspace/$package"
done
cd "$compiler_root"
nix develop --quiet --command nix run .#aihc -- build "$project_root/planner" \
  -O2 --target wasm32-wasip3 --workspace "$workspace" \
  --build-root "${AIHC_PLANNER_BUILD_ROOT:-$project_root/.planner-build}" --output "$project_root/.planner-output"
cp "$project_root/.planner-output/aihc-doc-plan.wasm" "$project_root/planner.wasm"
