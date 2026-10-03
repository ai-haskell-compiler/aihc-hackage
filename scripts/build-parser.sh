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
zlib_include=$(nix eval --impure --raw --expr 'let compiler = builtins.getFlake (toString ./.); pkgs = import compiler.inputs.nixpkgs { system = builtins.currentSystem; }; in "${pkgs.zlib.dev}/include"')
zlib_lib=$(nix eval --impure --raw --expr 'let compiler = builtins.getFlake (toString ./.); pkgs = import compiler.inputs.nixpkgs { system = builtins.currentSystem; }; in "${pkgs.zlib.out}/lib"')
native_libraries=$(nix eval --impure --raw --expr 'let compiler = builtins.getFlake (toString ./.); pkgs = import compiler.inputs.nixpkgs { system = builtins.currentSystem; }; in pkgs.lib.makeLibraryPath [ pkgs.zlib pkgs.zstd ]')
export LD_LIBRARY_PATH="$native_libraries${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
nix develop --quiet --command cabal run -v1 \
  --extra-include-dirs="$zlib_include" --extra-lib-dirs="$zlib_lib" exe:aihc -- build "$project_root/parser" \
  -O2 --target wasm32-wasip3 --build-root "$project_root/.parser-build" --output "$project_root/.parser-output"
cp "$project_root/.parser-output/aihc-hackage-parser.wasm" "$project_root/parser.wasm"
