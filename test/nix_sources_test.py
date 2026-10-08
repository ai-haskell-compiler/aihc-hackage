import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("hackage_cache", ROOT / "nix/hackage-cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class NixSourcesTest(unittest.TestCase):
    def test_all_locked_downloads_have_hashes(self):
        sources = json.loads((ROOT / "nix/sources.json").read_text())
        expected = set()
        for component in ("parser", "haddock"):
            lock = json.loads((ROOT / component / "aihc.lock").read_text())
            for package in lock["platforms"]["wasi-wasm32"]:
                if package["source"] != "hackage":
                    continue
                key = f"{package['name']}-{package['version']}-r{package['revision']}"
                expected.add(key)
                for kind in ("tarball", "cabal"):
                    self.assertRegex(sources[key][kind], r"^sha256-[A-Za-z0-9+/]{43}=$")
        self.assertEqual(set(sources), expected)

    def test_index_offsets_revisions_and_source_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            packages = []
            for name, revision, size in (("zeta", 5, 1025), ("alpha", 0, 37)):
                cabal = root / f"{name}.cabal"
                cabal.write_bytes(b"x" * size)
                tarball = root / f"{name}.tar.gz"
                with tarfile.open(tarball, "w:gz") as archive:
                    entry = tarfile.TarInfo(f"{name}-1.0/src/Main.hs")
                    entry.size = 4
                    archive.addfile(entry, io.BytesIO(b"main"))
                packages.append(dict(name=name, version="1.0", revision=revision,
                                     tarball=str(tarball), cabal=str(cabal)))
            destination = root / "cache"
            cache.prepare({"index-state": "2026-10-02T22:18:55Z", "packages": packages}, destination)
            lines = (destination / "hackage-index/index.txt").read_text().splitlines()
            self.assertEqual(lines[0], "aihc-hackage-index 1")
            self.assertEqual([line.split()[0] for line in lines[2:]], ["alpha", "zeta"])
            with (destination / "hackage-index/01-index.tar").open("rb") as archive:
                for line in lines[2:]:
                    name, version, revision, offset = line.split()
                    archive.seek(int(offset) * 512)
                    entry = tarfile.TarInfo.frombuf(archive.read(512), "utf-8", "strict")
                    self.assertEqual(entry.name, f"{name}/{version}/{name}.cabal")
                    self.assertEqual(archive.read(entry.size), (root / f"{name}.cabal").read_bytes())
                    self.assertEqual(int(revision), 5 if name == "zeta" else 0)
                    self.assertTrue((destination / "hackage" / f"{name}-1.0/.complete").exists())
                    self.assertEqual((destination / "hackage" / f"{name}-1.0/src/Main.hs").read_bytes(), b"main")


if __name__ == "__main__":
    unittest.main()
