{
  description = "AIHC Hackage components";

  inputs = {
    parserCompiler.url = "github:ai-haskell-compiler/aihc/bf991343a626e758a7d6d616770824fb55aaac92";
    haddockCompiler.url = "github:ai-haskell-compiler/aihc/7b0c849328ad36de9135bcc215c706187d6beb0c";
    nixpkgs.follows = "haddockCompiler/nixpkgs";
  };

  outputs = {
    self,
    nixpkgs,
    parserCompiler,
    haddockCompiler,
  }: let
    systems = ["x86_64-linux" "aarch64-linux"];
    forAllSystems = nixpkgs.lib.genAttrs systems;
  in {
    packages = forAllSystems (system: let
      pkgs = import nixpkgs {inherit system;};
      parser = import ./nix/component.nix {
        inherit pkgs system;
        compiler = parserCompiler;
        name = "aihc-hackage-parser";
        source = ./parser;
        lockFile = ./parser/aihc.lock;
      };
      haddock = import ./nix/component.nix {
        inherit pkgs system;
        compiler = haddockCompiler;
        name = "aihc-haddock";
        source = haddockCompiler + /bin/aihc-haddock;
        lockFile = ./haddock/aihc.lock;
        localPackages = ["aihc-hackage" "aihc-package-plan" "aihc-http"];
      };
      transpile = name: component: script:
        pkgs.buildNpmPackage {
          pname = "${name}-assets";
          version = "1";
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [./package.json ./package-lock.json script];
          };
          nodejs = pkgs.nodejs_24;
          npmDepsHash = "sha256-xS4Bzc5EUPA9HMWfTYmbZ5ercHJE5+gs6MqDfJfFJno=";
          dontNpmBuild = true;
          buildPhase = ''
            runHook preBuild
            cp ${component}/*.wasm ${name}.wasm
            ${pkgs.lib.optionalString (name == "haddock") ''export AIHC_HADDOCK_ROOT=${haddockCompiler}''}
            node scripts/${baseNameOf script}
            runHook postBuild
          '';
          installPhase = ''
            mkdir -p "$out"
            cp -R generated "$out/"
            ${pkgs.lib.optionalString (name == "haddock") ''cp -R public "$out/"''}
            cp ${name}.wasm "$out/"
          '';
          allowedReferences = [];
        };
      parserAssets = transpile "parser" parser ./scripts/transpile.mjs;
      haddockAssets = transpile "haddock" haddock ./scripts/transpile-haddock.mjs;
      toolchain = import ./nix/toolchain.nix {inherit pkgs;};
      components = pkgs.runCommand "aihc-hackage-components" {allowedReferences = [];} ''
        mkdir -p "$out"
        cp -R --no-preserve=mode ${parserAssets}/. "$out/"
        cp -R --no-preserve=mode ${haddockAssets}/. "$out/"
        cp -R --no-preserve=mode ${toolchain}/. "$out/"
      '';
    in {
      inherit parser haddock components toolchain;
      parser-assets = parserAssets;
      haddock-assets = haddockAssets;
      default = components;
    });
    devShells = nixpkgs.lib.genAttrs (systems ++ ["aarch64-darwin" "x86_64-darwin"]) (system: let
      pkgs = import nixpkgs {inherit system;};
    in {default = pkgs.mkShell {packages = [pkgs.nodejs_24 pkgs.just pkgs.ormolu pkgs.hlint];};});
    formatter =
      nixpkgs.lib.genAttrs (systems ++ ["aarch64-darwin" "x86_64-darwin"])
      (system: (import nixpkgs {inherit system;}).alejandra);
  };
}
