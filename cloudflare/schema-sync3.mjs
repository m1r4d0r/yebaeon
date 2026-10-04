// 3차 추가 전용 이전. 기존 표·행은 지우거나 바꾸지 않는다.
// - 문서 상태(active · archived · trashed)와 그 시각·작업자
// - 일지의 이전 값(이름 바꾸기의 옛 경로·옛 이름)
// - 카테고리 정책표(처음 5개는 기존 고정 정책과 같다)
// - 편집 중 표시, 이미지 경로표
export const SYNC3_MIGRATION = 'sync3-v1';
export const DEFAULT_CATEGORIES = [['가사찬양', 1, 0], ['악보찬양', 1, 0], ['예배순서', 1, 1], ['특별순서', 1, 1], ['옛날자료', 0, 0]];
async function columns(db, table) { return new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(r => r.name)); }
export async function migrateSync3(db) {
  if (await db.prepare(`SELECT name FROM yebaeon_schema_migrations WHERE name='${SYNC3_MIGRATION}'`).first()) return;
  const docs = await columns(db, 'yebaeon_documents'), log = await columns(db, 'yebaeon_sync_log'), now = new Date().toISOString();
  try {
    await db.batch([
      ...(docs.has('state') ? [] : [db.prepare("ALTER TABLE yebaeon_documents ADD COLUMN state TEXT NOT NULL DEFAULT 'active'")]),
      ...(docs.has('state_at') ? [] : [db.prepare('ALTER TABLE yebaeon_documents ADD COLUMN state_at TEXT')]),
      ...(docs.has('state_by') ? [] : [db.prepare('ALTER TABLE yebaeon_documents ADD COLUMN state_by TEXT')]),
      db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_documents_state ON yebaeon_documents(state,path)'),
      ...(log.has('previous') ? [] : [db.prepare('ALTER TABLE yebaeon_sync_log ADD COLUMN previous TEXT')]),
      db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_categories (name TEXT PRIMARY KEY, search_enabled INTEGER NOT NULL, history_enabled INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT, updated_by TEXT)'),
      ...DEFAULT_CATEGORIES.map(([name, search, history]) => db.prepare('INSERT OR IGNORE INTO yebaeon_categories(name,search_enabled,history_enabled,created_at,created_by) VALUES (?,?,?,?,?)').bind(name, search, history, now, '기본')),
      db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_editing (kind TEXT NOT NULL, entity TEXT NOT NULL, session_id TEXT NOT NULL, author TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(kind,entity,session_id))'),
      db.prepare("CREATE TABLE IF NOT EXISTS yebaeon_media_paths (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, size INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active', updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)"),
      db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_media_paths_sha ON yebaeon_media_paths(sha256)'),
      db.prepare(`INSERT INTO yebaeon_schema_migrations(name) VALUES ('${SYNC3_MIGRATION}')`)
    ]);
  } catch (error) {
    if (!await db.prepare(`SELECT name FROM yebaeon_schema_migrations WHERE name='${SYNC3_MIGRATION}'`).first()) throw error;
  }
}
