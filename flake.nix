{
  description = "AIHC Hackage components";

  inputs = {
    parserCompiler.url = "github:ai-haskell-compiler/aihc/bf991343a626e758a7d6d616770824fb55aaac92";
    haddockCompiler.url = "github:ai-haskell-compiler/aihc/aa6debbd8e6a1486de1d6c1766e12e226c4a3b61";
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
      parserStyleSource = pkgs.lib.fileset.toSource {
        root = ./parser/src;
        fileset = ./parser/src;
      };
      parserStyle =
        pkgs.runCommand "parser-style" {
          nativeBuildInputs = [pkgs.ormolu pkgs.hlint];
          allowedReferences = [];
        } ''
          ormolu --mode check ${parserStyleSource}/Main.hs
          hlint ${parserStyleSource}
          touch "$out"
        '';
      plannerStyleSource = pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [./planner/src ./haddock/web];
      };
      plannerStyle =
        pkgs.runCommand "planner-style" {
          nativeBuildInputs = [pkgs.ormolu pkgs.hlint];
          allowedReferences = [];
        } ''
          cd ${plannerStyleSource}
          ormolu --mode check planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs
          hlint planner/src haddock/web
          touch "$out"
        '';
      parser = import ./nix/component.nix {
        inherit pkgs system;
        compiler = parserCompiler;
        name = "aihc-hackage-parser";
        source = pkgs.lib.fileset.toSource {
          root = ./parser;
          fileset = ./parser;
        };
        lockFile = builtins.path {
          path = ./parser/aihc.lock;
          name = "parser-aihc.lock";
        };
      };
      haddock = import ./nix/component.nix {
        inherit pkgs system;
        compiler = haddockCompiler;
        name = "aihc-haddock";
        source =
          pkgs.runCommand "aihc-haddock-web-source" {
            nativeBuildInputs = [pkgs.nodejs_24];
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset = pkgs.lib.fileset.unions [./haddock/web ./scripts/prepare-haddock-web.mjs];
            };
          } ''
            cp -R "$src"/. .
            mkdir -p compiler/bin
            cp -R ${haddockCompiler}/bin/aihc-haddock compiler/bin/
            chmod -R u+w compiler
            AIHC_HADDOCK_ROOT="$PWD/compiler" node scripts/prepare-haddock-web.mjs
            cp -R compiler/bin/aihc-haddock "$out"
          '';
        lockFile = builtins.path {
          path = ./haddock/aihc.lock;
          name = "haddock-aihc.lock";
        };
        localPackages = ["tooling/aihc-hackage" "tooling/aihc-package-plan" "tooling/aihc-http" "components/aihc-resolve"];
      };
      planner = import ./nix/component.nix {
        inherit pkgs system;
        compiler = haddockCompiler;
        name = "aihc-doc-plan";
        source = pkgs.lib.fileset.toSource {
          root = ./planner;
          fileset = pkgs.lib.fileset.unions [./planner/aihc-doc-plan.cabal ./planner/src];
        };
        lockFile = builtins.path {
          path = ./planner/aihc.lock;
          name = "planner-aihc.lock";
        };
        localPackages = ["tooling/aihc-hackage" "tooling/aihc-package-plan"];
      };
      transpile = name: component: script:
        pkgs.buildNpmPackage {
          pname = "${name}-assets";
          version = "1";
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset =
              pkgs.lib.fileset.unions ([./package.json ./package-lock.json script]
                ++ pkgs.lib.optional (name != "parser") ./scripts/externalize-wasm.mjs);
          };
          nodejs = pkgs.nodejs_24;
          npmDepsHash = "sha256-xS4Bzc5EUPA9HMWfTYmbZ5ercHJE5+gs6MqDfJfFJno=";
          dontNpmBuild = true;
          buildPhase = ''
            runHook preBuild
            cp ${component}/*.wasm ${name}.wasm
            ${pkgs.lib.optionalString (name != "parser") ''export AIHC_HADDOCK_ROOT=${haddockCompiler}''}
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
      plannerAssets = transpile "planner" planner ./scripts/transpile-planner.mjs;
      toolchain = import ./nix/toolchain.nix {inherit pkgs;};
      components = pkgs.runCommand "aihc-hackage-components" {allowedReferences = [];} ''
        mkdir -p "$out"
        cp -R --no-preserve=mode ${parserAssets}/. "$out/"
        cp -R --no-preserve=mode ${haddockAssets}/. "$out/"
        cp -R --no-preserve=mode ${plannerAssets}/. "$out/"
        cp -R --no-preserve=mode ${toolchain}/. "$out/"
      '';
    in {
      inherit parser haddock planner components toolchain;
      parser-assets = parserAssets;
      haddock-assets = haddockAssets;
      planner-assets = plannerAssets;
      parser-style = parserStyle;
      planner-style = plannerStyle;
      default = components;
    });
    checks = forAllSystems (system: {
      inherit (self.packages.${system}) parser-style planner-style;
    });
    devShells = nixpkgs.lib.genAttrs (systems ++ ["aarch64-darwin" "x86_64-darwin"]) (system: let
      pkgs = import nixpkgs {inherit system;};
    in {default = pkgs.mkShell {packages = [pkgs.nodejs_24 pkgs.just pkgs.ormolu pkgs.hlint];};});
    formatter =
      nixpkgs.lib.genAttrs (systems ++ ["aarch64-darwin" "x86_64-darwin"])
      (system: (import nixpkgs {inherit system;}).alejandra);
  };
}
