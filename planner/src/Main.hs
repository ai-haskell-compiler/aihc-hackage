{-# LANGUAGE ImportQualifiedPost #-}
{-# LANGUAGE OverloadedStrings #-}

-- Return the next missing input from a request in the virtual filesystem.
module Main (main) where

import Aihc.Cabal (flagDefault, flagName, packageFlags, packageVersion)
import Aihc.Hackage.Package
import Aihc.Hackage.Release
import Aihc.PackagePlan.Solver
import Data.Aeson
import Data.ByteString.Lazy qualified as BL
import Data.Map.Strict qualified as Map
import Data.Set qualified as Set
import Data.Text (Text)
import Data.Text qualified as T
import Data.Text.Encoding qualified as TE

data Description = Description Text Int Bool deriving (Show)

instance FromJSON Description where
  parseJSON = withObject "description" $ \o -> Description <$> o .: "cabal" <*> o .: "revision" <*> o .:? "core" .!= False

data Request = Request String String (Map.Map String (Map.Map String String)) (Map.Map String Description)

instance FromJSON Request where
  parseJSON = withObject "request" $ \o -> Request <$> o .: "name" <*> o .: "version" <*> o .: "versions" <*> o .: "descriptions"

main :: IO ()
main = do
  bytes <- BL.readFile "/request.json"
  let result = case eitherDecode bytes of
        Left err -> problem err
        Right request -> either id id (plan request)
  BL.putStr (encode result)

problem :: String -> Value
problem err = object ["error" .= err]

plan :: Request -> Either Value Value
plan (Request root rootVersion versions descriptions) = do
  wanted <- maybe (Left (problem "The root version is invalid.")) Right (parseVersionString rootVersion)
  let name = mkPackageName root
      aliases = Map.fromList [(mkPackageName (bootLibraryName lib), mkPackageName (bootLibraryStandin lib)) | lib <- releaseBootLibraries emulatedGhc, bootLibraryName lib /= bootLibraryStandin lib]
      config =
        SolverConfig
          (Linux, X86_64)
          aliases
          [ConstraintVersion name (thisVersion wanted)]
          Map.empty
          (Map.singleton name noStanzas {stanzasExecutables = Just Set.empty})
          [(mkPackageName "aihc-prim", anyVersion)]
          1000
      inputs = SolverInputs candidates description
  solved <- solve inputs config
  case solved of
    Left failure -> pure (problem (renderSolveFailure failure))
    Right solution -> do
      packages <- mapM entry (Map.toList solution)
      pure (object ["packages" .= packages])
  where
    key name ver = unPackageName name <> "-" <> showVersion ver
    need kind name ver = Left (object ["need" .= object ["kind" .= kind, "name" .= name, "version" .= ver]])
    candidates name _ = case Map.lookup (unPackageName name) versions of
      Nothing -> need ("versions" :: String) (unPackageName name) ("" :: String)
      Just items -> mapM (makeCandidate name) (Map.toList items)
    makeCandidate name (ver, status) = do
      version <- maybe (Left (problem "A candidate version is invalid.")) Right (parseVersionString ver)
      let (revision, source) = case Map.lookup (key name version) descriptions of
            Just (Description _ rev True) -> (rev, CandidateCore "")
            Just (Description _ rev False) -> (rev, CandidateHackage)
            Nothing -> (0, CandidateHackage)
      pure (Candidate name version revision (status /= "normal") source)
    description candidate = do
      Description cabal _ _ <- getDescription (candidateName candidate) (candidateVersion candidate)
      pkg <- either (Left . problem) Right (parsePackageDescription (TE.encodeUtf8 cabal))
      if packageNameOf pkg == candidateName candidate && packageVersion pkg == candidateVersion candidate
        then Right pkg
        else Left (problem "The Cabal file does not match its package.")
    getDescription name version = maybe (need ("cabal" :: String) (unPackageName name) (showVersion version)) Right (Map.lookup (key name version) descriptions)
    entry (name, assignment) = do
      let version = assignmentVersion assignment
      Description cabal revision core <- getDescription name version
      pkg <- either (Left . problem) Right (parsePackageDescription (TE.encodeUtf8 cabal))
      let flags =
            Map.union
              (Map.fromList [(T.pack (unFlagName flag), value) | (flag, value) <- unFlagAssignment (assignmentFlags assignment)])
              (Map.fromList [(flagName flag, flagDefault flag) | flag <- packageFlags pkg])
          dependencies = map unPackageName (Map.keys (assignmentDependencies assignment))
          allDependencies = if unPackageName name `elem` ["aihc-prim", "aihc-rts"] || "aihc-prim" `elem` dependencies then dependencies else "aihc-prim" : dependencies
      pure $
        object
          [ "name" .= unPackageName name,
            "version" .= showVersion version,
            "revision" .= (if core then Nothing else Just revision),
            "source" .= (if core then ("core" :: String) else "hackage"),
            "flags" .= flags,
            "dependencies" .= allDependencies
          ]
