import { XMLValidator } from 'fast-xml-parser';
import { HttpError, bytes, headers, json, method, sameOrigin, sha256 } from './http.mjs';
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export function documentPath(value) {
  // The original Mac path is metadata. R2 object keys use document/version IDs,
  // so colons and other printable filename characters never become storage paths.
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_path', '문서 경로가 필요합니다.');
  const path = value.normalize('NFC'), parts = path.split('/');
  if (path.length > 600 || parts.length > 20 || !/\.pro6$/i.test(path) || parts.some(p => !p || p === '.' || p === '..' || p.length > 160 || /[\\\x00-\x1f\x7f]/.test(p) || /[. ]$/.test(p))) {
    throw new HttpError(400, 'invalid_path', '폴더와 .pro6 파일 이름을 확인해 주세요.');
  }
  return path;
}
export async function readDocument(request) {
  const data = await bytes(request, MAX_DOCUMENT_BYTES); let xml;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new HttpError(400, 'invalid_encoding', 'UTF-8 .pro6 문서를 선택해 주세요.'); }
  const leading = xml.replace(/^\s*(?:<\?xml[^?]*\?>)?\s*/, '').replace(/^(?:<!--[\s\S]*?-->\s*)*/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/^<RVPresentationDocument(?:\s|>)/.test(leading) || XMLValidator.validate(xml) !== true) {
    throw new HttpError(400, 'invalid_document', '올바른 PP6 .pro6 문서가 아닙니다.');
  }
  if (/file:\/\/\/PP6-Package\//i.test(xml)) throw new HttpError(422, 'package_media', '새로 교체한 미디어가 포함된 문서는 아직 서버에 저장할 수 없습니다. ZIP으로 보관해 주세요.');
  return { data, hash: await sha256(data), size: data.length };
}
function document(row) {
  return { id: row.id, path: row.path, name: row.path.split('/').pop(), version: row.current_version, updatedAt: row.updated_at, updatedBy: row.updated_by, sha256: row.sha256, size: row.size };
}
async function find(db, id) {
  const row = await db.prepare('SELECT * FROM yebaeon_documents WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'not_found', '문서를 찾지 못했습니다.');
  return row;
}
function conflict() { return new HttpError(409, 'version_conflict', '다른 작업자가 먼저 저장했습니다. 내 작업을 ZIP으로 보관한 뒤 서버의 최신 문서를 다시 열어 주세요.'); }
export async function documentsRoute(request, env, user, id, action) {
  const url = new URL(request.url), db = env.DB;
  if (!id) {
    method(request, ['GET', 'POST']);
    if (request.method === 'GET') {
      const query = url.searchParams.get('q') || '', after = url.searchParams.get('after') || '';
      if (query.length > 120 || after.length > 600) throw new HttpError(400, 'invalid_query', '검색어가 너무 깁니다.');
      const rows = (await db.prepare('SELECT * FROM yebaeon_documents WHERE path > ? AND instr(lower(path), lower(?)) > 0 ORDER BY path LIMIT 101').bind(after, query).all()).results;
      return json({ documents: rows.slice(0, 100).map(document), next: rows.length > 100 ? rows[99].path : null });
    }
    sameOrigin(request);
    const path = documentPath(url.searchParams.get('path')), content = await readDocument(request);
    const existing = await db.prepare('SELECT * FROM yebaeon_documents WHERE path = ?').bind(path).first();
    if (existing) {
      if (existing.sha256 === content.hash) return json({ document: document(existing), unchanged: true });
      throw new HttpError(409, 'path_exists', '같은 경로의 문서가 이미 있습니다. 목록에서 열어 수정하거나 다른 경로로 저장해 주세요.');
    }
    const newId = crypto.randomUUID(), writeId = crypto.randomUUID(), key = `documents/${newId}/${writeId}.pro6`, now = new Date().toISOString();
    const created = { id: newId, path, name: path.split('/').pop(), version: 1, updatedAt: now, updatedBy: user.author, sha256: content.hash, size: content.size };
    await env.FILES.put(key, content.data, { httpMetadata: { contentType: 'application/xml' }, sha256: content.hash });
    try {
      await db.batch([
        db.prepare('INSERT INTO yebaeon_documents(id, path, created_at, current_version, updated_at, updated_by, sha256, size, write_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)').bind(newId, path, now, now, user.author, content.hash, content.size, writeId),
        db.prepare('INSERT INTO yebaeon_versions(document_id, version, object_key, sha256, size, author, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)').bind(newId, key, content.hash, content.size, user.author, now)
      ]);
    } catch (error) {
      const winner = await db.prepare('SELECT * FROM yebaeon_documents WHERE path = ?').bind(path).first();
      if (winner?.id === newId) return json({ document: created }, 201);
      // Do not delete objects after ambiguous commits; a maintenance pass can inspect unreferenced keys.
      if (winner) throw new HttpError(409, 'path_exists', '다른 작업자가 같은 경로로 문서를 올렸습니다. 목록을 새로고침해 주세요.');
      throw error;
    }
    return json({ document: created }, 201);
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'not_found', '문서를 찾지 못했습니다.');
  if (action === 'versions') {
    method(request, ['GET']); await find(db, id);
    const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1) throw new HttpError(400, 'invalid_version', '버전 번호를 확인해 주세요.');
    const rows = (await db.prepare('SELECT version, sha256, size, author, created_at AS createdAt FROM yebaeon_versions WHERE document_id = ? AND version < ? ORDER BY version DESC LIMIT 51').bind(id, before).all()).results;
    return json({ versions: rows.slice(0, 50), next: rows.length > 50 ? rows[49].version : null });
  }
  if (action === 'content') {
    method(request, ['GET', 'HEAD']);
    const row = await find(db, id), number = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : row.current_version;
    if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, 'invalid_version', '버전 번호를 확인해 주세요.');
    const version = await db.prepare('SELECT * FROM yebaeon_versions WHERE document_id = ? AND version = ?').bind(id, number).first();
    if (!version) throw new HttpError(404, 'not_found', '저장 버전을 찾지 못했습니다.');
    const object = await env.FILES.get(version.object_key);
    if (!object) throw new HttpError(503, 'file_unavailable', '문서 파일을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
    const filename = row.path.split('/').pop().replace(/\.pro6$/i, '') + (url.searchParams.has('version') ? `-v${number}` : '') + '.pro6';
    return new Response(request.method === 'HEAD' ? null : object.body, { headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'ETag': `"${number}-${version.sha256}"`, 'X-Yebaeon-Version': String(number), 'X-Yebaeon-SHA256': version.sha256 } });
  }
  if (action) throw new HttpError(404, 'not_found', '없는 요청입니다.');
  method(request, ['GET', 'PUT']);
  const row = await find(db, id);
  if (request.method === 'GET') return json({ document: document(row) });
  sameOrigin(request);
  const match = request.headers.get('If-Match');
  if (!match || !/^"[1-9][0-9]*"$/.test(match)) throw new HttpError(428, 'version_required', '문서의 기준 버전이 필요합니다.');
  const base = Number(match.slice(1, -1));
  if (base !== row.current_version) throw conflict();
  const content = await readDocument(request);
  if (content.hash === row.sha256) return json({ document: document(row), unchanged: true });
  const next = base + 1, writeId = crypto.randomUUID(), key = `documents/${id}/${writeId}.pro6`, now = new Date().toISOString();
  await env.FILES.put(key, content.data, { httpMetadata: { contentType: 'application/xml' }, sha256: content.hash });
  const results = await db.batch([
    db.prepare('UPDATE yebaeon_documents SET current_version = ?, updated_at = ?, updated_by = ?, sha256 = ?, size = ?, write_id = ? WHERE id = ? AND current_version = ?').bind(next, now, user.author, content.hash, content.size, writeId, id, base),
    db.prepare(`INSERT INTO yebaeon_versions(document_id, version, object_key, sha256, size, author, created_at)
      SELECT id, ?, ?, ?, ?, ?, ? FROM yebaeon_documents WHERE id = ? AND write_id = ?`).bind(next, key, content.hash, content.size, user.author, now, id, writeId)
  ]);
  if (results[0].meta.changes !== 1) { await env.FILES.delete(key); throw conflict(); }
  // Return this exact commit, even if another writer saved a later version immediately after it.
  return json({ document: { ...document(row), version: next, updatedAt: now, updatedBy: user.author, sha256: content.hash, size: content.size } });
}
