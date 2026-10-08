{pkgs}: let
  manifest = builtins.fromJSON (builtins.readFile ../shell/toolchain.json);
  downloads = pkgs.lib.mapAttrs (name: sha256:
    pkgs.fetchurl {
      url = "https://raw.githubusercontent.com/binji/wasm-clang/${manifest.revision}/${name}";
      inherit sha256;
    })
  manifest.files;
in
  pkgs.runCommand "browser-c-toolchain" {
    nativeBuildInputs = [pkgs.gzip];
    allowedReferences = [];
  } ''
    mkdir -p "$out/public/shell/toolchain"
    ${pkgs.lib.concatStringsSep "\n" (pkgs.lib.mapAttrsToList (name: source: ''
        gzip -n -9 -c ${source} > "$out/public/shell/toolchain/${name}.gz"
      '')
      downloads)}
  ''
