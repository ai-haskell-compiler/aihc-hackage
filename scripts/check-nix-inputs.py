#!/usr/bin/env python3
"""Check which Nix outputs change when a build input changes."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    system = subprocess.check_output(
        ["nix", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"], text=True
    ).strip()
    with tempfile.TemporaryDirectory(prefix="aihc-nix-inputs-") as directory:
        root = Path(directory)
        tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).split(b"\0")
        for entry in filter(None, tracked):
            path = Path(entry.decode())
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / path, root / path)

        def derivations():
            return json.loads(subprocess.check_output([
                "nix", "eval", "--json", f"path:{root}#packages.{system}",
                "--apply", "packages: builtins.mapAttrs (_: package: package.drvPath) packages",
            ], text=True))

        baseline = derivations()

        def check(path, expected):
            source = root / path
            original = source.read_bytes()
            try:
                source.write_bytes(original + b"\n")
                changed = {name for name, value in derivations().items() if baseline[name] != value}
                if changed != expected:
                    raise AssertionError(f"{path}: expected {sorted(expected)}, got {sorted(changed)}")
                print(f"Verified Nix inputs: {path}", flush=True)
            finally:
                source.write_bytes(original)

        check("public/style.css", set())
        check("src/worker.js", set())
        check("parser/src/Main.hs", {"parser", "parser-assets", "components", "default"})
        check("haddock/aihc.lock", {"haddock", "haddock-assets", "components", "default"})
        check("scripts/transpile.mjs", {"parser-assets", "components", "default"})
        check("scripts/transpile-haddock.mjs", {"haddock-assets", "components", "default"})


if __name__ == "__main__":
    main()
