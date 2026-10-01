// Version 1: additive initialization; existing rows and other tables are untouched.
export const schema = [
  `CREATE TABLE IF NOT EXISTS yebaeon_document_usage (document_id TEXT NOT NULL, version INTEGER NOT NULL, last_used TEXT, error TEXT, PRIMARY KEY(document_id,version))`,
  `CREATE TABLE IF NOT EXISTS yebaeon_sync_status (session_id TEXT PRIMARY KEY, author TEXT NOT NULL, connected_at TEXT NOT NULL, compared_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_playlists (
    id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, source_root TEXT NOT NULL,
    current_version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
    sha256 TEXT NOT NULL, size INTEGER NOT NULL, write_id TEXT NOT NULL, catalog TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS yebaeon_playlist_versions (
    library_id TEXT NOT NULL REFERENCES yebaeon_playlists(id), version INTEGER NOT NULL,
    object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
    author TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(library_id,version)
  )`,
  `CREATE TABLE IF NOT EXISTS yebaeon_sessions (
    id TEXT PRIMARY KEY, author TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS yebaeon_sessions_expiry ON yebaeon_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_login_limits (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS yebaeon_login_limits_window ON yebaeon_login_limits(window_start)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_documents (
    id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
    current_version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
    sha256 TEXT NOT NULL, size INTEGER NOT NULL, write_id TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS yebaeon_versions (
    document_id TEXT NOT NULL REFERENCES yebaeon_documents(id), version INTEGER NOT NULL,
    object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
    author TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(document_id, version)
  )`
];
const pending = new WeakMap();
export function ensureSchema(db) {
  if (!pending.has(db)) {
    const job = db.batch(schema.map(sql => db.prepare(sql))).catch(error => { pending.delete(db); throw error; });
    pending.set(db, job);
  }
  return pending.get(db);
}
