import { HttpError, bytes, headers, json, method, sameOrigin, sha256 } from './http.mjs';
import { documentAttributes } from './document-usage.mjs';
import { ledgerRoute } from './ledger.mjs';
import { resolveRevisionRoute } from './admin.mjs';

// Sync 2 · 서버 2단계 (재설계안 7.1).
// - 변경 일지(sync_log): 문서·예배 쓰기와 같은 batch 안에서 write_id 조건으로 한 줄씩 쌓는다. CAS가 실패한 저장은 남지 않는다.
//   Mac은 마지막 번호 뒤만 읽는다. 변경이 없으면 D1 읽기는 일지 0행 + head 1행이다.
// - 장치 열쇠: 상주 Mac이 비밀번호·30일 쿠키 없이 들어오는 열쇠. 원문은 발급 때 한 번만 돌려주고 해시만 저장한다.
// - manifest: 처음 연결 때 Mac 파일 50개씩 같음·다름·없음을 한 문장으로 판정한다.
// - usage: PP6가 바꾼 lastDateUsed·usedCount를 새 버전 없이 반영한다. 더 큰 값(MAX)만 남긴다.
// - revisions: 교회 Mac 수정본을 현재본이 아닌 보관본으로 둔다. 이력 끔 정리에 걸리지 않는다.

export const SYNC2_MIGRATION = 'sync2-v1';
// 기본 스키마와 분리된 추가 전용 이전. 기존 표·행은 지우거나 바꾸지 않는다.
export async function migrateSync2(db) {
  if (await db.prepare(`SELECT name FROM yebaeon_schema_migrations WHERE name='${SYNC2_MIGRATION}'`).first()) return;
  const columns = new Set((await db.prepare('PRAGMA table_info(yebaeon_documents)').all()).results.map(r => r.name));
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS yebaeon_sync_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entity TEXT NOT NULL, action TEXT NOT NULL, version INTEGER, sha256 TEXT, size INTEGER, path TEXT, name TEXT, author TEXT NOT NULL, at TEXT NOT NULL)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS yebaeon_sync_log_entity ON yebaeon_sync_log(kind,entity,seq)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS yebaeon_sync_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT, applied_seq INTEGER NOT NULL DEFAULT 0, applied_at TEXT, pending TEXT NOT NULL DEFAULT '[]')`),
      db.prepare(`CREATE TABLE IF NOT EXISTS yebaeon_sync_revisions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity TEXT NOT NULL, path TEXT, base_version INTEGER, base_sha TEXT, sha256 TEXT NOT NULL, size INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE, reason TEXT NOT NULL, device_id TEXT, author TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS yebaeon_sync_revisions_open ON yebaeon_sync_revisions(resolved_at,entity,created_at)`),
      ...(columns.has('used_count') ? [] : [db.prepare('ALTER TABLE yebaeon_documents ADD COLUMN used_count INTEGER')]),
      // Mac이 usage로 보고한 가장 최근 사용일. 문서 저장은 XML 사용일과 이 값 중 큰 쪽을 남긴다.
      ...(columns.has('reported_used') ? [] : [db.prepare('ALTER TABLE yebaeon_documents ADD COLUMN reported_used TEXT')]),
      db.prepare(`INSERT INTO yebaeon_schema_migrations(name) VALUES ('${SYNC2_MIGRATION}')`)
    ]);
  } catch (error) {
    if (!await db.prepare(`SELECT name FROM yebaeon_schema_migrations WHERE name='${SYNC2_MIGRATION}'`).first()) throw error;
  }
}

// 일지 한 줄. 쓰기가 실제로 커밋됐을 때만 남도록 write_id 조건을 단다.
export function documentLog(db, { id, writeId, action, author, now, previous = null }) {
  return db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,version,sha256,size,path,previous,author,at) SELECT 'doc',id,?,current_version,sha256,size,path,?,?,? FROM yebaeon_documents WHERE id=? AND write_id=?`).bind(action, previous, author, now, id, writeId);
}
// 예배(노드)는 entity = '<재생목록 id>:<노드 id>'. 순서가 바뀌면 kind 'node', 보관·삭제는 'node-state'.
export function nodeLog(db, { libraryId, writeId, nodeId, name, sha, kind = 'node', action, author, now, previous = null }) {
  return db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,version,sha256,name,previous,author,at) SELECT ?,id||':'||?,?,current_version,?,?,?,?,? FROM yebaeon_playlists WHERE id=? AND write_id=?`).bind(kind, nodeId, action, sha, name, previous, author, now, libraryId, writeId);
}
const head = async db => (await db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM yebaeon_sync_log').first()).seq;

async function jsonBody(request, limit) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'json_required', 'JSON 요청이 필요합니다.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(request, limit))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', '입력값을 확인해 주세요.'); }
}

// ── 장치 열쇠 ──────────────────────────────────────────────
const TOKEN = /^ybd_([0-9a-f]{32})_([0-9a-f]{64})$/;
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
// Authorization: Bearer ybd_<장치번호>_<비밀>. 맞으면 세션과 같은 모양의 사용자를 돌려준다. 작성자는 장치 이름이다.
export async function deviceSession(request, env) {
  const value = request.headers.get('Authorization') || '';
  if (!value.startsWith('Bearer ')) return null;
  const match = TOKEN.exec(value.slice(7).trim());
  if (!match) throw new HttpError(401, 'device_token_invalid', '장치 열쇠가 올바르지 않습니다. Sync에서 다시 연결해 주세요.');
  const row = await env.DB.prepare('SELECT id,name,token_hash,last_seen_at,revoked_at FROM yebaeon_sync_devices WHERE id=?').bind(match[1]).first();
  if (!row || row.revoked_at || row.token_hash !== await sha256(match[2])) throw new HttpError(401, 'device_token_invalid', '장치 열쇠가 해제됐거나 맞지 않습니다. Sync에서 다시 연결해 주세요.');
  // 마지막 접속은 한 시간에 한 번만 쓴다(15분 확인마다 쓰지 않는다).
  const now = new Date();
  if (!row.last_seen_at || now - Date.parse(row.last_seen_at) > 3600e3) await env.DB.prepare('UPDATE yebaeon_sync_devices SET last_seen_at=? WHERE id=?').bind(now.toISOString(), row.id).run();
  return { id: 'device:' + row.id, author: row.name, device: row.id };
}
const DEVICE_NAME = /^[^\x00-\x1f\x7f]{1,40}$/;
async function devicesRoute(request, env, user, id, sub) {
  if (id && sub === 'applied') return appliedRoute(request, env, user, id);
  if (sub) throw new HttpError(404, 'not_found', '없는 요청입니다.');
  // 발급·목록·해제는 사람이 비밀번호로 들어온 세션만 한다. 장치 열쇠로는 장치를 만들거나 지우지 못한다.
  if (user.device) throw new HttpError(403, 'device_forbidden', '장치 열쇠로는 장치를 관리할 수 없습니다.');
  if (id) {
    method(request, ['DELETE']); sameOrigin(request);
    const result = await env.DB.prepare('UPDATE yebaeon_sync_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(new Date().toISOString(), id).run();
    if (!result.meta.changes) throw new HttpError(404, 'not_found', '장치를 찾지 못했습니다.');
    return json({ revoked: true });
  }
  method(request, ['GET', 'POST']);
  if (request.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT id,name,created_at AS createdAt,created_by AS createdBy,last_seen_at AS lastSeenAt,applied_seq AS appliedSeq,applied_at AS appliedAt,pending,status,status_at AS statusAt,support_until AS supportUntil FROM yebaeon_sync_devices WHERE revoked_at IS NULL ORDER BY created_at LIMIT 50').all()).results;
    const now = Date.now();
    return json({ head: await head(env.DB), devices: rows.map(r => ({ ...r, pending: JSON.parse(r.pending), status: r.status ? JSON.parse(r.status) : null, supportUntil: r.supportUntil && Date.parse(r.supportUntil) > now ? r.supportUntil : null })) });
  }
  sameOrigin(request);
  const body = await jsonBody(request, 1024), name = typeof body?.name === 'string' ? body.name.normalize('NFC').trim() : '';
  if (!DEVICE_NAME.test(name)) throw new HttpError(400, 'invalid_name', '장치 이름은 1~40자로 입력해 주세요.');
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM yebaeon_sync_devices WHERE revoked_at IS NULL').first();
  if (active.n >= 20) throw new HttpError(409, 'too_many_devices', '연결된 장치가 많습니다. 쓰지 않는 장치를 먼저 해제해 주세요.');
  const deviceId = hex(16), secret = hex(32), now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO yebaeon_sync_devices(id,name,token_hash,created_at,created_by) VALUES (?,?,?,?,?)').bind(deviceId, name, await sha256(secret), now, user.author).run();
  return json({ device: { id: deviceId, name, createdAt: now }, token: `ybd_${deviceId}_${secret}` }, 201);
}
// 장치가 "어디까지 적용했나 + 보류 목록"을 한 줄로 보고한다. Studio는 이것과 일지 번호로 적용 상태를 계산한다.
async function appliedRoute(request, env, user, id) {
  method(request, ['POST']); sameOrigin(request);
  if (user.device !== id) throw new HttpError(403, 'device_forbidden', '이 장치의 열쇠로만 보고할 수 있습니다.');
  const body = await jsonBody(request, 32 * 1024), seq = body?.seq, pending = body?.pending ?? [];
  if (!Number.isSafeInteger(seq) || seq < 0 || !Array.isArray(pending) || pending.length > 200 || pending.some(p => typeof p?.kind !== 'string' || p.kind.length > 20 || typeof p?.entity !== 'string' || p.entity.length > 200 || (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.length > 200)))) throw new HttpError(400, 'invalid_report', '적용 보고를 확인해 주세요.');
  const now = new Date().toISOString();
  // 커서는 뒤로 가지 않는다(늦게 도착한 옛 보고가 덮지 않게).
  await env.DB.prepare('UPDATE yebaeon_sync_devices SET applied_seq=MAX(applied_seq,?),applied_at=?,pending=? WHERE id=?').bind(seq, now, JSON.stringify(pending.map(({ kind, entity, reason }) => ({ kind, entity, ...(reason ? { reason } : {}) }))), id).run();
  return json({ ok: true, appliedAt: now });
}

// ── 변경 일지 ──────────────────────────────────────────────
async function changesRoute(request, env) {
  method(request, ['GET']);
  const url = new URL(request.url), since = Number(url.searchParams.get('since') || 0), limit = Number(url.searchParams.get('limit') || 200);
  if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 0 || limit > 500) throw new HttpError(400, 'invalid_cursor', '변경 일지 번호를 확인해 주세요.');
  // limit=0은 지금 번호(head)만 묻는다. 처음 붙는 Mac이 지난 일지를 훑지 않게 한다.
  const rows = limit ? (await env.DB.prepare('SELECT seq,kind,entity,action,version,sha256,size,path,name,previous,author,at FROM yebaeon_sync_log WHERE seq>? ORDER BY seq LIMIT ?').bind(since, limit + 1).all()).results : [];
  const changes = rows.slice(0, limit).map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));
  const more = rows.length > limit;
  return json({ changes, next: changes.length ? changes.at(-1).seq : since, head: await head(env.DB), more });
}

// ── 처음 연결 대조 ─────────────────────────────────────────
const SHA = /^[0-9a-f]{64}$/;
async function manifestRoute(request, env) {
  method(request, ['POST']); sameOrigin(request);
  const body = await jsonBody(request, 64 * 1024), items = body?.items;
  if (!Array.isArray(items) || !items.length || items.length > 50 || items.some(i => typeof i?.path !== 'string' || !i.path.length || i.path.length > 600 || !SHA.test(i.sha256 || ''))) throw new HttpError(400, 'invalid_manifest', 'Mac 파일 목록은 50개씩 경로와 SHA-256으로 보내 주세요.');
  const input = JSON.stringify(items.map(i => ({ path: i.path.normalize('NFC'), sha256: i.sha256 })));
  // 한 문장. 경로 UNIQUE 색인으로 문서·장부를 한 줄씩만 읽는다.
  const rows = (await env.DB.prepare(`SELECT CAST(j.key AS INTEGER) AS i, d.id, d.current_version AS version, d.sha256, d.size, c.id AS catalogId
    FROM json_each(?) j LEFT JOIN yebaeon_documents d ON d.path=json_extract(j.value,'$.path') LEFT JOIN yebaeon_library_catalog c ON c.path=json_extract(j.value,'$.path') ORDER BY i`).bind(input).all()).results;
  const parsed = JSON.parse(input);
  return json({ head: await head(env.DB), items: rows.map(r => {
    const mine = parsed[r.i];
    if (!r.id) return { path: mine.path, status: 'missing', catalog: !!r.catalogId };
    return { path: mine.path, status: r.sha256 === mine.sha256 ? 'same' : 'different', id: r.id, version: r.version, sha256: r.sha256, size: r.size };
  }) });
}

// ── 사용일 ─────────────────────────────────────────────────
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f-]{36}$/i;
async function usageRoute(request, env) {
  method(request, ['POST']); sameOrigin(request);
  const body = await jsonBody(request, 64 * 1024), items = body?.items;
  if (!Array.isArray(items) || items.length > 200) throw new HttpError(400, 'invalid_usage', '사용일 목록은 200개까지 보낼 수 있습니다.');
  const clean = items.map(item => {
    if (typeof item?.id !== 'string' || !UUID.test(item.id)) throw new HttpError(400, 'invalid_usage', '사용일 항목의 문서 번호를 확인해 주세요.');
    const used = item.lastDateUsed == null ? null : typeof item.lastDateUsed === 'string' && DATE.test(item.lastDateUsed) && Number.isFinite(Date.parse(item.lastDateUsed)) ? new Date(item.lastDateUsed).toISOString() : undefined;
    const count = item.usedCount == null ? null : Number.isSafeInteger(item.usedCount) && item.usedCount >= 0 ? item.usedCount : undefined;
    if (used === undefined || count === undefined || (used === null && count === null)) throw new HttpError(400, 'invalid_usage', '사용일 항목을 확인해 주세요.');
    return { id: item.id, used, count };
  });
  if (!clean.length) return json({ updated: 0 });
  // 한 문장. 같은 문서가 여러 번 오면 큰 값만 쓴다. 문서 버전·원본은 바꾸지 않는다.
  // 서버의 사용일이 현재 버전 것이 아니면(usage_version 불일치) 보낸 값으로 채운다.
  const result = await env.DB.prepare(`UPDATE yebaeon_documents SET
      last_used=CASE WHEN u.used IS NOT NULL AND (usage_version IS NOT current_version OR last_used IS NULL OR last_used<u.used) THEN u.used WHEN usage_version IS NOT current_version THEN NULL ELSE last_used END,
      usage_error=NULL, usage_version=current_version,
      reported_used=CASE WHEN u.used IS NOT NULL AND (reported_used IS NULL OR reported_used<u.used) THEN u.used ELSE reported_used END,
      used_count=CASE WHEN u.count IS NOT NULL AND (used_count IS NULL OR used_count<u.count) THEN u.count ELSE used_count END
    FROM (SELECT json_extract(value,'$.id') AS id, MAX(json_extract(value,'$.used')) AS used, MAX(json_extract(value,'$.count')) AS count FROM json_each(?) GROUP BY 1) u
    WHERE yebaeon_documents.id=u.id AND ((u.used IS NOT NULL AND (usage_version IS NOT current_version OR last_used IS NULL OR last_used<u.used)) OR (u.count IS NOT NULL AND (used_count IS NULL OR used_count<u.count)))`).bind(JSON.stringify(clean)).run();
  return json({ updated: result.meta.changes || 0 });
}

// ── 교회 Mac 수정본(보관본) ─────────────────────────────────
const REASONS = new Set(['both-changed', 'technical', 'removed-node', 'reverted']);
async function revisionsRoute(request, env, user, id, sub) {
  const db = env.DB;
  if (id) {
    method(request, ['GET']);
    const row = await db.prepare('SELECT * FROM yebaeon_sync_revisions WHERE id=?').bind(id).first();
    if (!row) throw new HttpError(404, 'not_found', '보관본을 찾지 못했습니다.');
    if (sub !== 'content') return json({ revision: revisionView(row) });
    const object = await env.FILES.get(row.object_key);
    if (!object) throw new HttpError(503, 'file_unavailable', '보관본 원본을 읽지 못했습니다.');
    return new Response(object.body, { headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Yebaeon-SHA256': row.sha256 } });
  }
  method(request, ['GET', 'POST']);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    // 열린 것만, 기술적 차이 보관본은 기본으로 숨긴다.
    const entity = url.searchParams.get('entity'), technical = url.searchParams.get('technical') === '1';
    if (entity && entity.length > 200) throw new HttpError(400, 'invalid_query', '대상을 확인해 주세요.');
    const rows = (await db.prepare(`SELECT * FROM yebaeon_sync_revisions WHERE resolved_at IS NULL ${entity ? 'AND entity=?' : ''} ${technical ? '' : "AND reason<>'technical'"} ORDER BY created_at DESC LIMIT 100`).bind(...(entity ? [entity] : [])).all()).results;
    return json({ revisions: rows.map(revisionView) });
  }
  sameOrigin(request);
  const kind = url.searchParams.get('kind'), reason = url.searchParams.get('reason') || 'both-changed';
  if (!REASONS.has(reason)) throw new HttpError(400, 'invalid_revision', '보관 이유를 확인해 주세요.');
  let entity, path = null, baseVersion = null, baseSha = null, data;
  if (kind === 'doc') {
    entity = url.searchParams.get('id') || '';
    const doc = UUID.test(entity) && await db.prepare('SELECT id,path FROM yebaeon_documents WHERE id=?').bind(entity).first();
    if (!doc) throw new HttpError(404, 'not_found', '서버에 없는 문서입니다.');
    path = doc.path; baseVersion = Number(url.searchParams.get('baseVersion'));
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) throw new HttpError(400, 'invalid_revision', '기준 버전이 필요합니다.');
    data = await bytes(request, 25 * 1024 * 1024);
    try { documentAttributes(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw new HttpError(400, 'invalid_document', '올바른 PP6 .pro6 문서가 아닙니다.'); }
  } else if (kind === 'node') {
    const library = url.searchParams.get('library') || '', node = url.searchParams.get('node') || '';
    if (!UUID.test(library) || !node || node.length > 160) throw new HttpError(400, 'invalid_revision', '예배 번호가 필요합니다.');
    if (!await db.prepare('SELECT id FROM yebaeon_playlists WHERE id=?').bind(library).first()) throw new HttpError(404, 'not_found', '재생목록을 찾지 못했습니다.');
    entity = library + ':' + node; baseSha = url.searchParams.get('baseSha');
    if (baseSha !== null && !SHA.test(baseSha)) throw new HttpError(400, 'invalid_revision', '기준 sha를 확인해 주세요.');
    data = await bytes(request, 1024 * 1024);
    let xml; try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new HttpError(400, 'invalid_playlist', 'UTF-8 예배 순서가 아닙니다.'); }
    if (!/^\s*<RVPlaylistNode[\s>]/.test(xml)) throw new HttpError(400, 'invalid_playlist', '예배 노드 XML이 아닙니다.');
  } else throw new HttpError(400, 'invalid_revision', '보관본 종류를 확인해 주세요.');
  const revisionId = crypto.randomUUID(), hash = await sha256(data), key = `revisions/${revisionId}.xml`, now = new Date().toISOString();
  // 같은 바이트를 두 번 보내면(재시도) 새로 만들지 않는다.
  const existing = await db.prepare('SELECT * FROM yebaeon_sync_revisions WHERE entity=? AND sha256=? AND resolved_at IS NULL').bind(entity, hash).first();
  if (existing) return json({ revision: revisionView(existing), unchanged: true });
  await env.FILES.put(key, data, { httpMetadata: { contentType: 'application/xml' }, sha256: hash });
  await db.prepare('INSERT INTO yebaeon_sync_revisions(id,kind,entity,path,base_version,base_sha,sha256,size,object_key,reason,device_id,author,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(revisionId, kind, entity, path, baseVersion, baseSha, hash, data.length, key, reason, user.device || null, user.author, now).run();
  return json({ revision: revisionView({ id: revisionId, kind, entity, path, base_version: baseVersion, base_sha: baseSha, sha256: hash, size: data.length, reason, device_id: user.device || null, author: user.author, created_at: now }) }, 201);
}
function revisionView(r) {
  return { id: r.id, kind: r.kind, entity: r.entity, path: r.path, baseVersion: r.base_version, baseSha: r.base_sha, sha256: r.sha256, size: r.size, reason: r.reason, deviceId: r.device_id, author: r.author, createdAt: r.created_at, resolvedAt: r.resolved_at || null, resolution: r.resolution || null };
}

export async function sync2Route(request, env, user, resource, id, sub) {
  if (resource === 'devices') return devicesRoute(request, env, user, id, sub);
  if (resource === 'revisions' && id && sub === 'resolve') return resolveRevisionRoute(request, env, user, id);
  if (resource === 'revisions') return revisionsRoute(request, env, user, id, sub);
  if (resource === 'ledger' && !id && !sub) return ledgerRoute(request, env);
  if (id || sub) throw new HttpError(404, 'not_found', '없는 요청입니다.');
  if (resource === 'changes') return changesRoute(request, env);
  if (resource === 'manifest') return manifestRoute(request, env);
  if (resource === 'usage') return usageRoute(request, env);
  throw new HttpError(404, 'not_found', '없는 요청입니다.');
}
