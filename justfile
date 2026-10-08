fmt:
    nix develop .compiler --quiet --command ormolu --mode inplace parser/src/Main.hs planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs

check:
    nix develop .compiler --quiet --command ormolu --mode check parser/src/Main.hs planner/src/Main.hs haddock/web/Aihc/Haddock/Web.hs
    nix develop .compiler --quiet --command hlint parser/src planner/src haddock/web
    npm run check

build:
    scripts/build-parser.sh
    scripts/build-haddock.sh
    scripts/build-planner.sh
    npm run build
