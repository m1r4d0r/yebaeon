import { migrateSync2 } from './sync2.mjs';
import { migrateSync3 } from './schema-sync3.mjs';
import { migrateRemoteSupport } from './remote-support.mjs';
// Version 1: additive initialization; existing rows and other tables are untouched.
export const schema = [
  `CREATE TABLE IF NOT EXISTS yebaeon_playlist_controls (library_id TEXT NOT NULL,node_id TEXT NOT NULL,state TEXT NOT NULL,name TEXT NOT NULL,snapshot_key TEXT,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL,PRIMARY KEY(library_id,node_id))`,
  `CREATE INDEX IF NOT EXISTS yebaeon_playlist_control_state ON yebaeon_playlist_controls(state,library_id,node_id)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_inventory_devices (device_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at TEXT NOT NULL, author TEXT NOT NULL, count INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_inventory_members (device_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY(device_id,path))`,
  `CREATE INDEX IF NOT EXISTS yebaeon_inventory_path ON yebaeon_inventory_members(path)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_playlist_node_versions (library_id TEXT NOT NULL, node_id TEXT NOT NULL, version INTEGER NOT NULL, file_version INTEGER NOT NULL, name TEXT NOT NULL, xml TEXT NOT NULL, sha256 TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(library_id,node_id,version), UNIQUE(library_id,node_id,file_version))`,
  `CREATE TABLE IF NOT EXISTS yebaeon_sync_observations (device_id TEXT NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL, node_id TEXT NOT NULL DEFAULT '', server_hash TEXT NOT NULL, status TEXT NOT NULL, observed_at TEXT NOT NULL, author TEXT NOT NULL, PRIMARY KEY(device_id,kind,resource_id,node_id))`,
  `CREATE TABLE IF NOT EXISTS yebaeon_library_catalog (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, original_path TEXT NOT NULL, size INTEGER NOT NULL, slide_count INTEGER NOT NULL, snapshot TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_document_search (document_id TEXT NOT NULL, version INTEGER NOT NULL, search_text TEXT NOT NULL, error TEXT, PRIMARY KEY(document_id,version))`,
  `CREATE TABLE IF NOT EXISTS yebaeon_reference_cache (library_id TEXT PRIMARY KEY, version INTEGER NOT NULL, refs TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_media_assets (sha256 TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, content_type TEXT NOT NULL, protected INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS yebaeon_media_references (document_id TEXT NOT NULL, document_version INTEGER NOT NULL, reference_id TEXT NOT NULL, asset_sha256 TEXT NOT NULL, source TEXT NOT NULL, slide_index INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(document_id,document_version,reference_id))`,
  `CREATE INDEX IF NOT EXISTS yebaeon_media_refs_asset ON yebaeon_media_references(asset_sha256)`,
  `CREATE INDEX IF NOT EXISTS yebaeon_media_refs_document ON yebaeon_media_references(document_id,document_version)`,
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
schema.push(`CREATE INDEX IF NOT EXISTS yebaeon_documents_recent ON yebaeon_documents(updated_at DESC,path)`);
schema.push(`CREATE INDEX IF NOT EXISTS yebaeon_sync_recent ON yebaeon_sync_status(COALESCE(compared_at,connected_at) DESC)`);
// 교회 Mac이 서버 변경을 받아 적용한 기록. 적용 보고에서 커서가 앞으로 갈 때만 한 줄 쓴다(서버 현황의 Sync 기록).
schema.push(`CREATE TABLE IF NOT EXISTS yebaeon_sync_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, at TEXT NOT NULL)`);
// Additive, one-time metadata migration. It never deletes originals or old backups.
async function migrateCurrentMetadata(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_schema_migrations (name TEXT PRIMARY KEY)').run();
  if (await db.prepare("SELECT name FROM yebaeon_schema_migrations WHERE name='document-policy-v1'").first()) return;
  const columns = new Set((await db.prepare('PRAGMA table_info(yebaeon_documents)').all()).results.map(r=>r.name));
  const additions = {last_used:'TEXT',usage_error:'TEXT',usage_version:'INTEGER',search_enabled:'INTEGER NOT NULL DEFAULT 1',history_enabled:'INTEGER NOT NULL DEFAULT 1',history_start:'INTEGER',policy_revision:'INTEGER NOT NULL DEFAULT 0'};
  const statements=Object.entries(additions).filter(([name])=>!columns.has(name)).map(([name,type])=>db.prepare(`ALTER TABLE yebaeon_documents ADD COLUMN ${name} ${type}`));
  statements.push(db.prepare(`UPDATE yebaeon_documents SET
    last_used=(SELECT u.last_used FROM yebaeon_document_usage u WHERE u.document_id=yebaeon_documents.id AND u.version=current_version),
    usage_error=(SELECT u.error FROM yebaeon_document_usage u WHERE u.document_id=yebaeon_documents.id AND u.version=current_version),
    usage_version=(SELECT u.version FROM yebaeon_document_usage u WHERE u.document_id=yebaeon_documents.id AND u.version=current_version)`),
    db.prepare("CREATE INDEX IF NOT EXISTS yebaeon_documents_used ON yebaeon_documents(COALESCE(last_used,'') DESC,path)"),
    db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_observations_resource ON yebaeon_sync_observations(kind,resource_id,node_id)'),
    db.prepare("INSERT INTO yebaeon_schema_migrations(name) VALUES ('document-policy-v1')"));
  try {
    const results=await db.batch(statements);
    console.log(JSON.stringify({event:'d1-migration-cost',migration:'document-policy-v1',rowsRead:results.reduce((n,r)=>n+(r.meta?.rows_read||0),0),rowsWritten:results.reduce((n,r)=>n+(r.meta?.rows_written||0),0)}));
  } catch(error) {
    // Another isolate may have committed the same transaction first.
    if(!await db.prepare("SELECT name FROM yebaeon_schema_migrations WHERE name='document-policy-v1'").first())throw error;
  }
}
async function migrateCategoryMetadata(db) {
  if (await db.prepare("SELECT name FROM yebaeon_schema_migrations WHERE name='document-category-v1'").first()) return;
  const columns = new Set((await db.prepare('PRAGMA table_info(yebaeon_documents)').all()).results.map(r=>r.name));
  const statements = columns.has('category') ? [] : [db.prepare('ALTER TABLE yebaeon_documents ADD COLUMN category TEXT')];
  // No whole-library extraction on startup or search. Existing rows are learned
  // from their original XML on the next explicit upload/save, including no-ops.
  statements.push(db.prepare("INSERT INTO yebaeon_schema_migrations(name) VALUES ('document-category-v1')"));
  try { await db.batch(statements); }
  catch(error) { if(!await db.prepare("SELECT name FROM yebaeon_schema_migrations WHERE name='document-category-v1'").first())throw error; }
}
const pending = new WeakMap();
// 요청 경로에서는 표시 행 1개만 확인한다(예전에는 isolate 첫 요청마다 약 29개 문장).
// 표시가 없을 때만(새 DB, 새 배포의 첫 요청) 전체 초기화·이전을 돌리고 표시를 남긴다.
// 스키마나 이전을 더하면 이 이름을 올려야 새 배포에서 한 번 실행된다.
export const SCHEMA_READY = 'schema-ready-events-v1';
export function ensureSchema(db) {
  if (!pending.has(db)) {
    const job = (async () => {
      try { if (await db.prepare('SELECT name FROM yebaeon_schema_migrations WHERE name=?').bind(SCHEMA_READY).first()) return; } catch (_) { /* 새 DB: 표가 아직 없다 */ }
      await db.batch(schema.map(sql => db.prepare(sql)));
      await migrateCurrentMetadata(db); await migrateCategoryMetadata(db); await migrateSync2(db); await migrateSync3(db); await migrateRemoteSupport(db);
      await db.prepare('INSERT OR IGNORE INTO yebaeon_schema_migrations(name) VALUES (?)').bind(SCHEMA_READY).run();
    })().catch(error => { pending.delete(db); throw error; });
    pending.set(db, job);
  }
  return pending.get(db);
}
