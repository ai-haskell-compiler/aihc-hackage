CREATE TABLE package_documents (
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('readme', 'changelog')),
  status TEXT NOT NULL CHECK (status IN ('available', 'missing', 'failed')),
  object_key TEXT,
  sha256 TEXT,
  error TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (name, version, kind),
  FOREIGN KEY (name, version) REFERENCES releases(name, version) ON DELETE CASCADE,
  CHECK ((status = 'available' AND object_key IS NOT NULL AND sha256 IS NOT NULL AND error IS NULL)
    OR (status = 'missing' AND object_key IS NULL AND sha256 IS NULL AND error IS NULL)
    OR (status = 'failed' AND object_key IS NULL AND sha256 IS NULL AND error IS NOT NULL))
);
