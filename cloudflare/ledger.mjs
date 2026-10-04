import { HttpError, bodyJSON, headers, json, method, sameOrigin } from './http.mjs';

// ── 이미지 경로표 ──────────────────────────────────────────
// 경로 키는 Mac 절대경로(NFC)다. 서버와 교신하는 허용 폴더 세 개 아래만 받는다(sync.md 5.4).
export const MEDIA_ROOT = '/Users/Shared/Renewed Vision Media/';
export const MEDIA_FOLDERS = ['Images/', 'ImportedImages/', 'YebaeOn/'];
const SHA = /^[0-9a-f]{64}$/;
export function mediaPathKey(value) {
  if (typeof value !== 'string' || !value.length || value.length > 1024) return null;
  let path = value;
  if (path.startsWith('file:')) { try { const url = new URL(path); if (url.host || url.search || url.hash) return null; path = decodeURIComponent(url.pathname); } catch { return null; } }
  path = path.normalize('NFC');
  if (/[\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => p === '..' || p === '.')) return null;
  return MEDIA_FOLDERS.some(folder => path.startsWith(MEDIA_ROOT + folder) && path.length > (MEDIA_ROOT + folder).length) ? path : null;
}
export async function mediaPathsRoute(request, env, user) {
  method(request, ['GET', 'PUT']);
  const db = env.DB;
  if (request.method === 'GET') {
    // ?path= (여러 번, 최대 50): Studio가 문서의 이미지 경로로 sha를 찾는다. 경로마다 1행.
    const asked = new URL(request.url).searchParams.getAll('path');
    if (asked.length) {
      if (asked.length > 50) throw new HttpError(400, 'invalid_media_paths', '이미지 경로는 50개씩 물어 주세요.');
      const keys = [...new Set(asked.map(mediaPathKey).filter(Boolean))];
      const rows = keys.length ? (await db.prepare(`SELECT path,sha256,size,state FROM yebaeon_media_paths WHERE path IN (${keys.map(() => '?').join(',')})`).bind(...keys).all()).results : [];
      return json({ paths: rows });
    }
    const after = new URL(request.url).searchParams.get('after') || '';
    if (after.length > 1024) throw new HttpError(400, 'invalid_cursor', '목록 위치를 확인해 주세요.');
    const rows = (await db.prepare("SELECT path,sha256,size,state FROM yebaeon_media_paths WHERE path>? ORDER BY path LIMIT 501").bind(after).all()).results;
    return json({ paths: rows.slice(0, 500), next: rows.length > 500 ? rows[499].path : null });
  }
  sameOrigin(request);
  const body = await bodyJSON(request).catch(error => { throw error; });
  const items = body?.items;
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new HttpError(400, 'invalid_media_paths', '이미지 경로는 200개씩 보내 주세요.');
  const clean = [], outside = [];
  for (const item of items) {
    const path = mediaPathKey(item?.path);
    if (!path) { outside.push(String(item?.path || '').slice(0, 300)); continue; }
    if (!SHA.test(item.sha256 || '') || !Number.isSafeInteger(item.size) || item.size < 0) throw new HttpError(400, 'invalid_media_paths', '이미지 sha256·크기를 확인해 주세요.');
    clean.push({ path, sha256: item.sha256, size: item.size });
  }
  if (!clean.length) return json({ registered: 0, outside });
  // 이미지 바이트가 서버에 먼저 있어야 경로를 등록한다.
  const hashes = [...new Set(clean.map(i => i.sha256))], known = new Set();
  for (let i = 0; i < hashes.length; i += 80) {
    const part = hashes.slice(i, i + 80);
    for (const r of (await db.prepare(`SELECT sha256 FROM yebaeon_media_assets WHERE sha256 IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results) known.add(r.sha256);
  }
  const missing = clean.filter(i => !known.has(i.sha256)).map(i => i.path);
  const ready = clean.filter(i => known.has(i.sha256)), now = new Date().toISOString();
  // 같은 경로·같은 sha면 쓰지 않는다. 바뀐 것만 일지에 남긴다(Mac 장부가 따라온다).
  const statements = ready.flatMap(i => [
    db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,at) SELECT 'media',?,CASE WHEN EXISTS(SELECT 1 FROM yebaeon_media_paths WHERE path=?) THEN 'updated' ELSE 'created' END,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM yebaeon_media_paths WHERE path=? AND sha256=? AND state='active')`).bind(i.path, i.path, i.sha256, i.size, i.path, user.author, now, i.path, i.sha256),
    db.prepare(`INSERT INTO yebaeon_media_paths(path,sha256,size,state,updated_at,updated_by) VALUES (?,?,?,'active',?,?) ON CONFLICT(path) DO UPDATE SET sha256=excluded.sha256,size=excluded.size,state='active',updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE yebaeon_media_paths.sha256<>excluded.sha256 OR yebaeon_media_paths.state<>'active'`).bind(i.path, i.sha256, i.size, now, user.author)
  ]);
  const results = statements.length ? await db.batch(statements) : [];
  const changed = results.filter((_, n) => n % 2 === 1).reduce((sum, r) => sum + (r.meta.changes || 0), 0);
  return json({ registered: ready.length, changed, missing, outside });
}

// ── R2 장부 파일 ───────────────────────────────────────────
// 새 Mac·영수증 유실 때의 초기 구축용. 문서(id·경로·버전·sha·크기·상태)와 이미지 경로표를 한 파일로 둔다.
// 파일에 반영한 일지 번호를 적고, 요청 때 뒤처졌으면 그 사이 일지 줄만 읽어 고친다. 전체 재생성·예약 작업은 없다.
const KEY = 'ledger/library.json';
async function head(db) { return (await db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM yebaeon_sync_log').first()).seq; }
async function build(db) {
  const seq = await head(db);
  const documents = (await db.prepare('SELECT id,path,current_version AS version,sha256,size,state FROM yebaeon_documents ORDER BY path').all()).results;
  const media = (await db.prepare('SELECT path,sha256,size,state FROM yebaeon_media_paths ORDER BY path').all()).results;
  return { schema: 1, seq, documents, media };
}
async function catchUp(db, ledger) {
  const top = await head(db);
  if (top <= ledger.seq) return false;
  const docIds = new Set(), mediaPaths = new Set();
  let since = ledger.seq;
  for (;;) {
    const rows = (await db.prepare("SELECT seq,kind,entity FROM yebaeon_sync_log WHERE seq>? AND kind IN ('doc','media') ORDER BY seq LIMIT 1000").bind(since).all()).results;
    for (const r of rows) (r.kind === 'doc' ? docIds : mediaPaths).add(r.entity);
    if (rows.length < 1000) break;
    since = rows.at(-1).seq;
  }
  const docs = new Map(ledger.documents.map(d => [d.id, d])), media = new Map(ledger.media.map(m => [m.path, m]));
  const ids = [...docIds], paths = [...mediaPaths];
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80), found = new Map((await db.prepare(`SELECT id,path,current_version AS version,sha256,size,state FROM yebaeon_documents WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results.map(r => [r.id, r]));
    for (const id of part) found.has(id) ? docs.set(id, found.get(id)) : docs.delete(id);
  }
  for (let i = 0; i < paths.length; i += 80) {
    const part = paths.slice(i, i + 80), found = new Map((await db.prepare(`SELECT path,sha256,size,state FROM yebaeon_media_paths WHERE path IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results.map(r => [r.path, r]));
    for (const p of part) found.has(p) ? media.set(p, found.get(p)) : media.delete(p);
  }
  ledger.seq = top;
  ledger.documents = [...docs.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  ledger.media = [...media.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return true;
}
export async function ledgerRoute(request, env) {
  method(request, ['GET']);
  const db = env.DB;
  let object = await env.FILES.get(KEY), ledger, etag;
  if (object) { ledger = await object.json(); etag = object.etag; }
  if (!ledger || ledger.schema !== 1) {
    ledger = await build(db);
    const put = await env.FILES.put(KEY, JSON.stringify(ledger), { httpMetadata: { contentType: 'application/json' } });
    etag = put.etag;
  } else if (await catchUp(db, ledger)) {
    // 다른 요청이 먼저 고쳐 썼으면 덮지 않는다. 그 쪽 파일이 같거나 더 앞선 일지 번호를 담고 있다.
    const put = await env.FILES.put(KEY, JSON.stringify(ledger), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag } });
    if (put) etag = put.etag;
  }
  const tag = `"ledger-${ledger.seq}"`;
  if (request.headers.get('If-None-Match') === tag) return new Response(null, { status: 304, headers: { ...headers, ETag: tag } });
  return new Response(JSON.stringify(ledger), { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ETag: tag } });
}
