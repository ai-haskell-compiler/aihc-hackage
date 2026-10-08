CREATE TABLE documentation_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  cabal_sha256 TEXT NOT NULL,
  generator TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'ready', 'failed')),
  plan_id TEXT,
  error TEXT,
  workflow_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (name, version) REFERENCES releases(name, version)
);
CREATE INDEX documentation_jobs_queue ON documentation_jobs(state, updated_at);
CREATE TABLE documentation_metadata (id TEXT PRIMARY KEY, object_key TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE documentation_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE documentation_objects (
  sha256 TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('source', 'cabal')),
  size INTEGER NOT NULL,
  object_key TEXT NOT NULL
);
CREATE TABLE documentation_uploads (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES documentation_plans(id),
  token_hash TEXT NOT NULL,
  model_sha256 TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  result_id TEXT
);
CREATE TABLE documentation_results (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES documentation_plans(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  model_sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('community', 'verified')),
  diagnostics INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (plan_id, model_sha256)
);
CREATE INDEX documentation_results_package ON documentation_results(name, version, provenance, created_at DESC);
