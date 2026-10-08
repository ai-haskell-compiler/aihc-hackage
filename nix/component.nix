{
  pkgs,
  compiler,
  system,
  name,
  source,
  lockFile,
  localPackages ? [],
}: let
  lib = pkgs.lib;
  lock = builtins.fromJSON (builtins.readFile lockFile);
  hashes = builtins.fromJSON (builtins.readFile ./sources.json);
  dependencies = builtins.filter (package: package.source == "hackage") lock.platforms.wasi-wasm32;
  manifest = pkgs.writeText "${name}-sources.json" (builtins.toJSON {
    inherit (lock) index-state;
    packages =
      map (package: let
        id = "${package.name}-${package.version}";
        hash = hashes."${id}-r${toString package.revision}";
        base = "https://hackage.haskell.org/package/${id}";
      in {
        inherit (package) name version revision;
        tarball = pkgs.fetchurl {
          url = "${base}/${id}.tar.gz";
          hash = hash.tarball;
        };
        cabal = pkgs.fetchurl {
          url = "${base}/revision/${toString package.revision}.cabal";
          hash = hash.cabal;
        };
      })
      dependencies;
  });
  cache = pkgs.runCommand "${name}-sources" {nativeBuildInputs = [pkgs.python3];} ''
    python ${./hackage-cache.py} ${manifest} "$out"
  '';
  wasmSysroot = import (compiler + /scripts/nix/wasi-sysroot.nix) pkgs;
in
  pkgs.runCommand "${name}-wasm" {
    nativeBuildInputs = [
      pkgs.llvmPackages.clang-unwrapped
      pkgs.llvmPackages.bintools
      pkgs.lld
      pkgs.wasm-tools
      pkgs.wasm-component-ld
      pkgs.haskellPackages.hsc2hs
    ];
    # A component must not retain the compiler or its build dependencies.
    allowedReferences = [];
  } ''
    export HOME="$TMPDIR/home"
    export XDG_CACHE_HOME="$HOME/.cache"
    export LANG=C.UTF-8
    export LC_ALL=C.UTF-8
    export AIHC_WASM_CLANG=${pkgs.llvmPackages.clang-unwrapped}/bin/clang
    export AIHC_WASM_SYSROOT=${wasmSysroot}
    export AIHC_HSC2HS=${pkgs.haskellPackages.hsc2hs}/bin/hsc2hs
    export AIHC_CORE_LIBS_ROOT="$TMPDIR/compiler"
    mkdir -p "$XDG_CACHE_HOME/aihc" "$AIHC_CORE_LIBS_ROOT" workspace "$out"
    cp -R ${compiler}/core-libs "$AIHC_CORE_LIBS_ROOT/core-libs"
    cp -R ${cache}/. "$XDG_CACHE_HOME/aihc/"
    chmod -R u+w "$HOME"
    # The compiler checks the table age before it reads the fixed index.
    touch "$XDG_CACHE_HOME/aihc/hackage-index/index.txt"
    cp -R ${source} workspace/${name}
    chmod -R u+w workspace/${name}
    cp ${lockFile} workspace/${name}/aihc.lock
    ${lib.concatMapStringsSep "\n" (package: ''
        cp -R ${compiler}/tooling/${package} workspace/${package}
      '')
      localPackages}
    ${compiler.apps.${system}.aihc.program} build "$PWD/workspace/${name}" \
      --locked -O2 --target wasm32-wasip3 --workspace "$PWD/workspace" \
      ${lib.optionalString (name == "aihc-haddock") ''--constraint "aihc-haddock -hackage"''} \
      --build-root "$TMPDIR/build" --output "$out"
    test -s "$out/${name}.wasm"
  ''
