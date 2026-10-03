CREATE TABLE releases (
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  version_sort TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  description TEXT NOT NULL,
  license TEXT NOT NULL,
  modules TEXT NOT NULL,
  metadata_key TEXT NOT NULL,
  cabal_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (name, version)
);
CREATE INDEX releases_latest ON releases(name, version_sort DESC);
CREATE TABLE dependencies (
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  dependency TEXT NOT NULL,
  component TEXT NOT NULL,
  version_range TEXT NOT NULL,
  condition TEXT NOT NULL,
  libraries TEXT NOT NULL,
  FOREIGN KEY (name, version) REFERENCES releases(name, version) ON DELETE CASCADE
);
CREATE INDEX dependencies_reverse ON dependencies(dependency, name, version);
CREATE VIRTUAL TABLE releases_fts USING fts5(name, synopsis, description, modules, content='releases', content_rowid='rowid');
CREATE TRIGGER releases_insert AFTER INSERT ON releases BEGIN
  INSERT INTO releases_fts(rowid, name, synopsis, description, modules) VALUES (new.rowid, new.name, new.synopsis, new.description, new.modules);
END;
CREATE TRIGGER releases_delete AFTER DELETE ON releases BEGIN
  INSERT INTO releases_fts(releases_fts, rowid, name, synopsis, description, modules) VALUES ('delete', old.rowid, old.name, old.synopsis, old.description, old.modules);
END;
CREATE TRIGGER releases_update AFTER UPDATE ON releases BEGIN
  INSERT INTO releases_fts(releases_fts, rowid, name, synopsis, description, modules) VALUES ('delete', old.rowid, old.name, old.synopsis, old.description, old.modules);
  INSERT INTO releases_fts(rowid, name, synopsis, description, modules) VALUES (new.rowid, new.name, new.synopsis, new.description, new.modules);
END;
