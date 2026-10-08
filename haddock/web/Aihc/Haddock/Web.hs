{-# LANGUAGE ImportQualifiedPost #-}
{-# LANGUAGE OverloadedStrings #-}

-- Consume a server plan without dependency resolution or network access.
module Aihc.Haddock.Web (buildFromPlan) where

import Aihc.Hackage.Cabal (BuildContext (..))
import Aihc.Hackage.Headers (writeCompilerHeaders)
import Aihc.Hackage.Package (Arch (X86_64), OS (Linux))
import Aihc.Hackage.Types (PackageSpec (..))
import Aihc.Haddock.Hoogle (renderHoogle)
import Aihc.Haddock.Model (encodePackageDoc)
import Aihc.Haddock.Package (documentationHeaderTarget, loadPackageDocIn)
import Control.Monad (unless)
import Data.Aeson (FromJSON (..), eitherDecode, withObject, (.:))
import Data.ByteString.Lazy qualified as BL
import Data.List (find)
import Data.Map.Strict (Map)
import Data.Text (Text)
import Data.Text.IO qualified as TIO

data Entry = Entry String String (Map Text Bool) [String]

instance FromJSON Entry where
  parseJSON = withObject "package" $ \obj ->
    Entry <$> obj .: "name" <*> obj .: "version" <*> obj .: "flags" <*> obj .: "dependencies"

data Plan = Plan Int String String String [Entry]

instance FromJSON Plan where
  parseJSON = withObject "plan" $ \obj -> do
    root <- obj .: "root"
    Plan <$> obj .: "format" <*> obj .: "generator" <*> obj .: "target" <*> root .: "name" <*> obj .: "packages"

buildFromPlan :: FilePath -> FilePath -> FilePath -> IO ()
buildFromPlan file jsonFile hoogleFile = do
  Plan format generator target root entries <- BL.readFile file >>= either fail pure . eitherDecode
  unless (format == 1 && generator == "aihc-haddock-7b0c8493-web-1" && target == "linux-x86_64") $
    fail "The documentation plan is not supported."
  Entry name _ flags dependencies <- lookupEntry root entries
  specs <- mapM (fmap spec . (`lookupEntry` entries)) dependencies
  headers <- writeCompilerHeaders documentationHeaderTarget "/.headers"
  model <- loadPackageDocIn (BuildContext Linux X86_64 flags) headers ("/packages/" <> name) specs
  BL.writeFile jsonFile (encodePackageDoc model)
  TIO.writeFile hoogleFile (renderHoogle model)
  where
    spec (Entry name version _ _) = PackageSpec name version
    lookupEntry name entries = maybe (fail "A package is missing from the plan.") pure (find (\(Entry candidate _ _ _) -> name == candidate) entries)
