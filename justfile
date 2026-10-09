fmt:
    nix develop --quiet --command ormolu --mode inplace parser/src/Main.hs planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs
    nix fmt -- flake.nix nix/*.nix

check:
    nix develop --quiet --command ormolu --mode check parser/src/Main.hs planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs
    nix develop --quiet --command hlint parser/src planner/src haddock/web
    npm run check

build:
    npm run build
