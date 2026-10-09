import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("hackage_cache", ROOT / "nix/hackage-cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class NixSourcesTest(unittest.TestCase):
    def test_component_copy_removes_old_modules_and_keeps_site_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, output = root / "repo", root / "output"
            (repo / "scripts").mkdir(parents=True)
            shutil.copyfile(ROOT / "scripts/use-components.sh", repo / "scripts/use-components.sh")
            (repo / "generated").mkdir()
            (repo / "generated/old.wasm").write_bytes(b"old")
            (repo / "public").mkdir()
            (repo / "public/style.css").write_text("site")
            for path in ("generated/parser.js", "public/shell/haddock/module.wasm.gz",
                         "public/shell/toolchain/clang.gz", "parser.wasm", "haddock.wasm", "planner.wasm"):
                target = output / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"component")
                target.chmod(0o444)
            command = ["bash", str(repo / "scripts/use-components.sh"), str(output)]
            for _ in range(2):
                subprocess.run(command, check=True)
                self.assertFalse((repo / "generated/old.wasm").exists())
                self.assertEqual((repo / "public/style.css").read_text(), "site")
                self.assertEqual((repo / "generated/parser.js").read_bytes(), b"component")
                self.assertTrue((repo / "parser.wasm").stat().st_mode & 0o200)
            (output / "haddock.wasm").unlink()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertTrue((repo / "generated/parser.js").exists())

    def test_all_locked_downloads_have_hashes(self):
        sources = json.loads((ROOT / "nix/sources.json").read_text())
        expected = set()
        for component in ("parser", "haddock", "planner"):
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
