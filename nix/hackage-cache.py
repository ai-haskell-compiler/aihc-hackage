"""Prepare the AIHC download cache and an index of the locked Cabal files."""

from datetime import datetime
import io
import json
from pathlib import Path
import sys
import tarfile


def prepare(manifest, destination):
    packages = destination / "hackage"
    index = destination / "hackage-index"
    packages.mkdir(parents=True)
    index.mkdir(parents=True)
    timestamp = int(datetime.fromisoformat(manifest["index-state"].replace("Z", "+00:00")).timestamp())
    lines = ["aihc-hackage-index 1", f"state {timestamp}"]
    with tarfile.open(index / "01-index.tar", "w", format=tarfile.USTAR_FORMAT) as archive:
        for package in sorted(manifest["packages"], key=lambda item: item["name"]):
            name, version = package["name"], package["version"]
            with tarfile.open(package["tarball"], "r:gz") as source:
                source.extractall(packages, filter="data")
            (packages / f"{name}-{version}" / ".complete").touch()
            cabal = Path(package["cabal"]).read_bytes()
            entry = tarfile.TarInfo(f"{name}/{version}/{name}.cabal")
            entry.size = len(cabal)
            entry.mtime = timestamp
            # AIHC reads the revision and the tar block offset from this table.
            lines.append(f"{name} {version} {package['revision']} {archive.offset // 512}")
            archive.addfile(entry, io.BytesIO(cabal))
    (index / "index.txt").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    prepare(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]))
