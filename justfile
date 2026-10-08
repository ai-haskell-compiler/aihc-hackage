fmt:
    nix develop --quiet --command ormolu --mode inplace parser/src/Main.hs
    nix fmt -- flake.nix nix/*.nix

check:
    nix develop --quiet --command ormolu --mode check parser/src/Main.hs
    nix develop --quiet --command hlint parser/src
    npm run check

build:
    npm run build
