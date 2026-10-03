fmt:
    nix develop .compiler --quiet --command ormolu --mode inplace parser/src/Main.hs

check:
    nix develop .compiler --quiet --command ormolu --mode check parser/src/Main.hs
    nix develop .compiler --quiet --command hlint parser/src
    npm run check

build:
    scripts/build-parser.sh
    npm run build
