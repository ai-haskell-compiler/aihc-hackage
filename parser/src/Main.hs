module Main where

import qualified Aihc.Cabal as C
import qualified Data.ByteString as B
import Data.Char (ord)
import Data.Foldable (toList)
import Data.List (intercalate)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Numeric (showHex)

quote :: String -> String
quote value = "\"" ++ concatMap escape value ++ "\""
  where
    escape '"' = "\\\""
    escape '\\' = "\\\\"
    escape c | ord c < 32 = "\\u" ++ replicate (4 - length hex) '0' ++ hex
      where
        hex = showHex (ord c) ""
    escape c = [c]

text :: T.Text -> String
text = quote . T.unpack

object :: [(String, String)] -> String
object fields = "{" ++ intercalate "," [quote key ++ ":" ++ value | (key, value) <- fields] ++ "}"

array :: [String] -> String
array values = "[" ++ intercalate "," values ++ "]"

fieldsJSON :: M.Map T.Text [C.FieldValue] -> String
fieldsJSON values = object [(T.unpack key, array (map (text . C.fieldText) items)) | (key, items) <- M.toList values]

bool :: Bool -> String
bool True = "true"
bool False = "false"

dependencyJSON :: C.Dependency -> String
dependencyJSON value =
  object
    [ ("package", text (C.dependencyPackage value)),
      ("range", text (C.renderVersionRange (C.dependencyRange value))),
      ("libraries", array (map libraryJSON (toList (C.dependencyLibraries value))))
    ]

libraryJSON :: C.LibraryTarget -> String
libraryJSON C.MainLibrary = quote "main"
libraryJSON (C.NamedLibrary name) = text name

buildJSON :: C.BuildInfo -> String
buildJSON value =
  object
    [ ("buildable", maybe "null" bool (C.buildable value)),
      ("exposedModules", array (map text (C.exposedModules value))),
      ("otherModules", array (map text (C.otherModules value))),
      ("dependencies", array (map dependencyJSON (C.dependencies value))),
      ("fields", fieldsJSON (C.extraFields value))
    ]

conditionJSON :: C.Condition -> String
conditionJSON value = case value of
  C.Literal b -> object [("literal", bool b)]
  C.OS name -> object [("os", text name)]
  C.Arch name -> object [("arch", text name)]
  C.Impl name range -> object [("compiler", text name), ("range", text (C.renderVersionRange range))]
  C.FlagValue name -> object [("flag", text name)]
  C.Not a -> object [("not", conditionJSON a)]
  C.And a b -> object [("and", array [conditionJSON a, conditionJSON b])]
  C.Or a b -> object [("or", array [conditionJSON a, conditionJSON b])]

conditionalJSON :: C.Conditional C.BuildInfo -> String
conditionalJSON value =
  object
    [ ("data", buildJSON (C.unconditional value)),
      ("branches", array (map branchJSON (C.branches value)))
    ]
  where
    branchJSON branch =
      object
        [ ("condition", conditionJSON (C.condition branch)),
          ("then", conditionalJSON (C.whenTrue branch)),
          ("else", maybe "null" conditionalJSON (C.whenFalse branch))
        ]

componentJSON :: C.Component (C.Conditional C.BuildInfo) -> String
componentJSON value =
  object
    [("kind", quote kind), ("name", text name), ("tree", conditionalJSON (C.componentData value))]
  where
    (kind, name) = case C.componentKind value of
      C.Library C.MainLibrary -> ("library", T.pack "main")
      C.Library (C.NamedLibrary n) -> ("library", n)
      C.Executable n -> ("executable", n)
      C.TestSuite n -> ("test-suite", n)
      C.Benchmark n -> ("benchmark", n)
      C.ForeignLibrary n -> ("foreign-library", n)

packageJSON :: C.Package -> [C.Diagnostic] -> String
packageJSON value warnings =
  object
    [ ("schemaVersion", "1"),
      ("name", text (C.packageName value)),
      ("version", text (C.renderVersion (C.packageVersion value))),
      ("cabalVersion", text (C.renderVersion (C.cabalVersion value))),
      ("buildType", text (C.buildType value)),
      ("fields", fieldsJSON (C.packageFields value)),
      ("components", array (map componentJSON (C.packageComponents value))),
      ("setupDependencies", array (maybe [] (map dependencyJSON) (C.packageSetupDependencies value))),
      ("flags", array (map flagJSON (C.packageFlags value))),
      ("sourceRepositories", array (map repositoryJSON (C.packageSourceRepositories value))),
      ("warnings", array (map (text . C.renderDiagnostic) warnings))
    ]
  where
    flagJSON flag =
      object
        [("name", text (C.flagName flag)), ("default", bool (C.flagDefault flag)), ("manual", bool (C.flagManual flag)), ("description", text (C.flagDescription flag))]
    repositoryJSON repo =
      object
        [("kind", text (C.sourceRepositoryKind repo)), ("fields", fieldsJSON (C.sourceRepositoryFields repo))]

main :: IO ()
main = do
  bytes <- B.getContents
  let result = C.parsePackage bytes
  putStrLn $ case C.parseValue result of
    Left err -> object [("error", text (C.renderDiagnostic err))]
    Right value -> packageJSON value (C.parseWarnings result)
