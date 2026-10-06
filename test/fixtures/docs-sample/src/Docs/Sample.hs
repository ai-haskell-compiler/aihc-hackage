-- | A sample module with documentation.
module Docs.Sample
  ( greet,
    Color (..),
  )
where

-- | Make a greeting for a name.
greet :: String -> String
greet name = "Hello, " ++ name

-- | The colors of the sample.
data Color
  = -- | The color of the sky.
    Blue
  | -- | The color of grass.
    Green
