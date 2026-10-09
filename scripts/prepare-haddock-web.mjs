import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

// Apply a small adapter to the pinned upstream source. Keep the shell CLI.
const root = process.env.AIHC_HADDOCK_ROOT || '.compiler-haddock';
const base = join(root, 'bin/aihc-haddock');
async function replace(file, before, after) {
  const text = await readFile(file, 'utf8');
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`The pinned Haddock source changed: ${file}`);
  await writeFile(file, text.replace(before, after));
}
await mkdir(join(base, 'src/Aihc/Haddock'), { recursive: true });
await copyFile('haddock/web/Aihc/Haddock/Web.hs', join(base, 'src/Aihc/Haddock/Web.hs'));
await replace(join(base, 'aihc-haddock.cabal'), '    Aihc.Haddock.Build\n', '    Aihc.Haddock.Web\n    Aihc.Haddock.Build\n');
await writeFile(join(base, 'app/Main.hs'), `module Main (main) where
import qualified Aihc.Haddock.Cli as Cli
import Aihc.Haddock.Web (buildFromPlan)
import System.Environment (getArgs)
main :: IO ()
main = do
  args <- getArgs
  case args of
    ["web-build", plan, json, hoogle] -> buildFromPlan plan json hoogle
    _ -> Cli.main
`);
const packageFile = join(base, 'src/Aihc/Haddock/Package.hs');
await replace(packageFile, '    loadPackageDoc,', '    loadPackageDoc,\n    loadPackageDocIn,');
await replace(packageFile, 'loadPackageDoc headerDir root dependencies = do', `loadPackageDoc = loadPackageDocIn HackageCabal.hostBuildContext

loadPackageDocIn :: HackageCabal.BuildContext -> FilePath -> FilePath -> [PackageDoc] -> IO PackageDoc
loadPackageDocIn context headerDir root dependencies = do`);
await replace(packageFile, 'HackageCabal.collectLibraryFiles gpd root', 'HackageCabal.collectLibraryFilesIn context gpd root');
await replace(packageFile, 'HackageCabal.collectLibraryExposedModules gpd', 'HackageCabal.collectLibraryExposedModulesIn context gpd');
