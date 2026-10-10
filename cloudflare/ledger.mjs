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
// Studio에서 가져온 이미지의 파일 이름 앞부분. 문서 이름에서 폴더 구분·제어 문자를 빼고 60자로 자른다(Mac 파일 이름 255바이트 한도).
export function importStem(name) {
  const stem = [...String(name || '').normalize('NFC').replace(/\.pro6$/i, '').replace(/[\x00-\x1f\x7f/\\:]/g, '-').replace(/\s+/g, ' ').trim()].slice(0, 60).join('').trim().replace(/^\.+/, '');
  return stem || 'image';
}
const IMPORT_FOLDER = MEDIA_ROOT + 'YebaeOn/';
// POST: Studio 가져오기의 이미지마다 `YebaeOn/<문서이름>-<n>.png` 경로를 정해 경로표에 넣는다(sync.md 5.4).
// 같은 sha가 이미 `YebaeOn/`에 있으면 그 경로를 그대로 쓴다. 번호는 같은 이름의 가장 큰 번호 다음부터다. 기존 경로는 바꾸지 않는다.
async function allocateImportPaths(request, db, user) {
  sameOrigin(request);
  const body = await bodyJSON(request, 64 * 1024), hashes = Array.isArray(body?.items) ? [...new Set(body.items.map(i => i?.sha256))] : [];
  if (!hashes.length || hashes.length > 200 || hashes.some(h => !SHA.test(h || ''))) throw new HttpError(400, 'invalid_media_paths', '이미지 sha256은 200개씩 보내 주세요.');
  // ext: 올린 원본의 확장자(그림 추가는 원본을 그대로 올린다). 없으면 png(PPT·PDF 가져오기).
  const ext = body.ext === undefined ? 'png' : String(body.ext).toLowerCase().replace(/^jpeg$/, 'jpg');
  if (!['png', 'jpg', 'webp', 'gif', 'bmp'].includes(ext)) throw new HttpError(400, 'invalid_media_paths', '그림 확장자를 확인해 주세요.');
  const stem = importStem(body.name), input = JSON.stringify(hashes);
  const sizes = new Map((await db.prepare('SELECT sha256,size FROM yebaeon_media_assets WHERE sha256 IN (SELECT value FROM json_each(?))').bind(input).all()).results.map(r => [r.sha256, r.size]));
  if (sizes.size !== hashes.length) throw new HttpError(409, 'import_image_missing', '이미지 업로드가 완료되지 않았습니다. 다시 시도해 주세요.');
  const own = IMPORT_FOLDER + stem + '-', found = new Map();
  for (const r of (await db.prepare("SELECT path,sha256 FROM yebaeon_media_paths WHERE sha256 IN (SELECT value FROM json_each(?)) AND state='active' AND substr(path,1,?)=? ORDER BY path").bind(input, IMPORT_FOLDER.length, IMPORT_FOLDER).all()).results)
    if (!found.has(r.sha256) || (r.path.startsWith(own) && !found.get(r.sha256).startsWith(own))) found.set(r.sha256, r.path);
  const fresh = hashes.filter(h => !found.has(h));
  if (fresh.length) {
    const numbered = new RegExp('^' + own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([1-9][0-9]{0,5})\\.(?:png|jpg|webp|gif|bmp)$');
    let last = 0;
    for (const r of (await db.prepare('SELECT path FROM yebaeon_media_paths WHERE path>=? AND path<?').bind(own, own + '\uffff').all()).results) { const m = numbered.exec(r.path); if (m) last = Math.max(last, Number(m[1])); }
    const items = fresh.map((sha256, i) => ({ path: `${own}${last + i + 1}.${ext}`, sha256, size: sizes.get(sha256) }));
    const now = new Date().toISOString(), rows = JSON.stringify(items);
    const newOnly = `FROM (SELECT json_extract(j.value,'$.path') AS path, json_extract(j.value,'$.sha256') AS sha256, json_extract(j.value,'$.size') AS size FROM json_each(?) j) i WHERE NOT EXISTS (SELECT 1 FROM yebaeon_media_paths m WHERE m.path=i.path)`;
    const [, written] = await db.batch([
      db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,at) SELECT 'media',i.path,'created',i.sha256,i.size,i.path,?,? ${newOnly}`).bind(user.author, now, rows),
      db.prepare(`INSERT INTO yebaeon_media_paths(path,sha256,size,state,updated_at,updated_by) SELECT i.path,i.sha256,i.size,'active',?,? ${newOnly}`).bind(now, user.author, rows)
    ]);
    // 같은 이름으로 동시에 가져오면 번호가 겹칠 수 있다. 그때는 아무것도 덮지 않고 다시 시도하게 한다.
    if ((written.meta.changes || 0) !== items.length) throw new HttpError(409, 'media_path_busy', '이미지 이름을 정하는 중 겹쳤습니다. 다시 시도해 주세요.');
    for (const item of items) found.set(item.sha256, item.path);
  }
  return json({ paths: hashes.map(sha256 => ({ sha256, path: found.get(sha256), size: sizes.get(sha256) })) });
}
export async function mediaPathsRoute(request, env, user) {
  method(request, ['GET', 'PUT', 'POST']);
  if (request.method === 'POST') return allocateImportPaths(request, env.DB, user);
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
    // ?folder=Images|YebaeOn: Studio 미디어 창의 서버 그림 목록. 그 폴더의 경로 범위만 읽는다(ImportedImages는 읽지 않음). 쪽마다 최대 60행.
    const params = new URL(request.url).searchParams, folder = params.get('folder');
    if (folder !== null) {
      if (!['Images', 'YebaeOn', 'All'].includes(folder) || (folder === 'All' && params.get('sort') !== 'updated')) throw new HttpError(400, 'invalid_media_folder', '이미지 폴더를 확인해 주세요.');
      if (params.get('sort') === 'updated') {
        const base = MEDIA_ROOT + folder + '/', q = (params.get('q') || '').normalize('NFC').trim(), after = params.get('after');
        let cursor = null;
        if (after) { try { cursor = JSON.parse(after); } catch { throw new HttpError(400, 'invalid_cursor', '목록 위치를 확인해 주세요.'); } }
        if (q.length > 80 || (after && (!cursor || typeof cursor.path !== 'string' || cursor.path.length > 1024 || !(folder === 'All' ? ['Images/','YebaeOn/'].some(f=>cursor.path.startsWith(MEDIA_ROOT+f)) : cursor.path.startsWith(base)) || typeof cursor.updatedAt !== 'string' || cursor.updatedAt.length > 40 || !Number.isFinite(Date.parse(cursor.updatedAt))))) throw new HttpError(400, 'invalid_cursor', '목록 위치를 확인해 주세요.');
        const ranges = folder === 'All' ? [MEDIA_ROOT+'Images/', MEDIA_ROOT+'Images0', MEDIA_ROOT+'YebaeOn/', MEDIA_ROOT+'YebaeOn0'] : [base, MEDIA_ROOT+folder+'0'];
        const scope = folder === 'All' ? '((path>? AND path<?) OR (path>? AND path<?))' : '(path>? AND path<?)';
        const rows = (await db.prepare("SELECT path,sha256,size,updated_at AS updatedAt FROM yebaeon_media_paths WHERE " + scope + " AND state='active' AND (?='' OR instr(lower(substr(path,?)),lower(?))>0)" + (cursor ? " AND (updated_at<? OR (updated_at=? AND path>?))" : '') + " ORDER BY updated_at DESC,path ASC LIMIT 61").bind(...ranges, q, folder === 'All' ? MEDIA_ROOT.length + 1 : base.length + 1, q, ...(cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.path] : [])).all()).results;
        return json({ paths: rows.slice(0, 60), next: rows.length > 60 ? JSON.stringify({updatedAt: rows[59].updatedAt, path: rows[59].path}) : null });
      }
      const base = MEDIA_ROOT + folder + '/', after = params.get('after') || base, q = (params.get('q') || '').normalize('NFC').trim();
      if (after.length > 1024 || q.length > 80 || !after.startsWith(base)) throw new HttpError(400, 'invalid_cursor', '목록 위치를 확인해 주세요.');
      const rows = (await db.prepare("SELECT path,sha256,size FROM yebaeon_media_paths WHERE path>? AND path<? AND state='active' AND (?='' OR instr(lower(substr(path,?)),lower(?))>0) ORDER BY path LIMIT 61").bind(after, MEDIA_ROOT + folder + '0', q, base.length + 1, q).all()).results;
      return json({ paths: rows.slice(0, 60), next: rows.length > 60 ? rows[59].path : null });
    }
    const after = params.get('after') || '';
    if (after.length > 1024) throw new HttpError(400, 'invalid_cursor', '목록 위치를 확인해 주세요.');
    const rows = (await db.prepare("SELECT path,sha256,size,state FROM yebaeon_media_paths WHERE path>? ORDER BY path LIMIT 501").bind(after).all()).results;
    return json({ paths: rows.slice(0, 500), next: rows.length > 500 ? rows[499].path : null });
  }
  sameOrigin(request);
  // 200개 묶음은 4KB 공통 한도를 넘는다. 이 경로만 256KB까지 받는다.
  const items = (await bodyJSON(request, 256 * 1024))?.items;
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new HttpError(400, 'invalid_media_paths', '이미지 경로는 200개씩 보내 주세요.');
  const clean = new Map(), outside = [];
  for (const item of items) {
    const path = mediaPathKey(item?.path);
    if (!path) { outside.push(String(item?.path || '').slice(0, 300)); continue; }
    if (!SHA.test(item.sha256 || '') || !Number.isSafeInteger(item.size) || item.size < 0) throw new HttpError(400, 'invalid_media_paths', '이미지 sha256·크기를 확인해 주세요.');
    clean.set(path, { path, sha256: item.sha256, size: item.size });   // 같은 경로가 겹치면 마지막 것
  }
  if (!clean.size) return json({ registered: 0, outside });
  // 이미지 바이트가 서버에 먼저 있어야 경로를 등록한다. 묶음 전체를 json_each 한 문장으로 확인한다.
  const all = [...clean.values()];
  const known = new Set((await db.prepare('SELECT sha256 FROM yebaeon_media_assets WHERE sha256 IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(all.map(i => i.sha256))])).all()).results.map(r => r.sha256));
  const missing = all.filter(i => !known.has(i.sha256)).map(i => i.path), ready = all.filter(i => known.has(i.sha256));
  if (!ready.length) return json({ registered: 0, changed: 0, missing, outside });
  // 두 문장: 바뀐 것만 일지에 남기고(Mac 장부가 따라온다), 바뀐 것만 경로표에 쓴다. 같은 경로·같은 sha·사용 중이면 쓰지 않는다.
  const now = new Date().toISOString(), input = JSON.stringify(ready);
  const incoming = `SELECT json_extract(j.value,'$.path') AS path, json_extract(j.value,'$.sha256') AS sha256, json_extract(j.value,'$.size') AS size FROM json_each(?) j`;
  const changedOnly = `FROM (${incoming}) i LEFT JOIN yebaeon_media_paths m ON m.path=i.path WHERE m.path IS NULL OR m.sha256<>i.sha256 OR m.state<>'active'`;
  const [, written] = await db.batch([
    db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,at) SELECT 'media',i.path,CASE WHEN m.path IS NULL THEN 'created' ELSE 'updated' END,i.sha256,i.size,i.path,?,? ${changedOnly}`).bind(user.author, now, input),
    db.prepare(`INSERT OR REPLACE INTO yebaeon_media_paths(path,sha256,size,state,updated_at,updated_by) SELECT i.path,i.sha256,i.size,'active',?,? ${changedOnly}`).bind(now, user.author, input)
  ]);
  return json({ registered: ready.length, changed: written.meta.changes || 0, missing, outside });
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
