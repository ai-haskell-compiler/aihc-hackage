#!/usr/bin/env python3
"""Record SHA-256 hashes for the dependencies in the AIHC lock files."""

import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def digest(url):
    checksum = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=120) as response:
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            checksum.update(chunk)
    return "sha256-" + base64.b64encode(checksum.digest()).decode()


def fetch(package):
    name = f"{package['name']}-{package['version']}"
    revision = package["revision"]
    base = f"https://hackage.haskell.org/package/{name}"
    return f"{name}-r{revision}", {
        "tarball": digest(f"{base}/{name}.tar.gz"),
        "cabal": digest(f"{base}/revision/{revision}.cabal"),
    }


def main():
    packages = {}
    for component in ("parser", "haddock", "planner"):
        lock = json.loads((ROOT / component / "aihc.lock").read_text())
        for package in lock["platforms"]["wasi-wasm32"]:
            if package["source"] == "hackage":
                packages[(package["name"], package["version"], package["revision"])] = package
    with ThreadPoolExecutor(max_workers=8) as pool:
        sources = dict(pool.map(fetch, packages.values()))
    destination = ROOT / "nix" / "sources.json"
    destination.write_text(json.dumps(sources, indent=2, sort_keys=True) + "\n")
    print(f"Recorded hashes for {len(sources)} packages in {destination}.")


if __name__ == "__main__":
    main()
