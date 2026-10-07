import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
import { referencedDocumentPaths } from './playlists.mjs';

// 관리자 잠금. 되돌릴 수 없는 일(휴지통 비우기, 카테고리 정책 변경, 보관본 해결, 고아 이미지 정리)만 요구한다.
// Worker 비밀값 ADMIN_PASSWORD 하나. 맞으면 하루짜리 서명 쿠키를 준다. 계정·D1 행은 쓰지 않는다.
export const ADMIN_COOKIE = '__Host-yebaeon-admin';
const TTL = 24 * 60 * 60;
const hex = buffer => Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2, '0')).join('');
async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('yebaeon-admin-v1:' + value)));
}
function same(a, b) { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }
export function adminConfigured(env) { return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length > 0; }
function cookieValue(request) { return (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(ADMIN_COOKIE + '='))?.slice(ADMIN_COOKIE.length + 1); }
// 관리자 표시는 그 입장 세션에 묶인다. 다른 세션·장치 열쇠로는 쓸 수 없다.
// 유효한 관리자 쿠키면 만료 시각(초), 아니면 null.
async function adminExpiry(request, env, user) {
  if (!adminConfigured(env) || user.device) return null;
  const value = cookieValue(request), match = /^(\d{10})\.([0-9a-f]{64})$/.exec(value || '');
  if (!match || Number(match[1]) < Math.floor(Date.now() / 1000)) return null;
  return same(match[2], await sign(env.ADMIN_PASSWORD, `${user.id}:${match[1]}`)) ? Number(match[1]) : null;
}
export async function isAdmin(request, env, user) { return await adminExpiry(request, env, user) !== null; }
export async function requireAdmin(request, env, user) {
  if (!adminConfigured(env)) throw new HttpError(503, 'admin_unavailable', '관리자 비밀번호가 서버에 설정되지 않았습니다.');
  if (!await isAdmin(request, env, user)) throw new HttpError(403, 'admin_required', '관리자 확인이 필요합니다. 관리자 비밀번호를 입력해 주세요.');
}
export async function adminRoute(request, env, user) {
  method(request, ['GET', 'POST', 'DELETE']);
  if (request.method === 'GET') { const expiresAt = await adminExpiry(request, env, user); return json({ configured: adminConfigured(env), admin: expiresAt !== null, expiresAt }); }
  sameOrigin(request);
  const clear = `${ADMIN_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
  if (request.method === 'DELETE') return json({ admin: false }, 200, { 'Set-Cookie': clear });
  if (!adminConfigured(env)) throw new HttpError(503, 'admin_unavailable', '관리자 비밀번호가 서버에 설정되지 않았습니다.');
  if (user.device) throw new HttpError(403, 'device_forbidden', '장치 열쇠로는 관리자 확인을 할 수 없습니다.');
  const body = await bodyJSON(request);
  if (typeof body?.password !== 'string' || !body.password.length || body.password.length > 1024) throw new HttpError(400, 'password_required', '관리자 비밀번호를 입력해 주세요.');
  // 입장과 같은 시도 제한(10분에 8번).
  const now = Math.floor(Date.now() / 1000), window = Math.floor(now / 600) * 600, limitKey = 'admin:' + await sign(env.ADMIN_PASSWORD, 'ip:' + (request.headers.get('CF-Connecting-IP') || 'local'));
  const attempt = await env.DB.prepare(`INSERT INTO yebaeon_login_limits(key, attempts, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END, window_start = excluded.window_start RETURNING attempts`).bind(limitKey, window).first();
  if (attempt.attempts > 8) throw new HttpError(429, 'too_many_attempts', '시도가 많습니다. 잠시 후 다시 시도해 주세요.', { 'Retry-After': String(window + 600 - now) });
  if (!same(await sign(env.ADMIN_PASSWORD, 'check'), await sign(body.password, 'check'))) throw new HttpError(401, 'wrong_password', '관리자 비밀번호가 맞지 않습니다.');
  const expires = now + TTL, value = `${expires}.${await sign(env.ADMIN_PASSWORD, `${user.id}:${expires}`)}`;
  return json({ admin: true, expiresAt: expires }, 200, { 'Set-Cookie': `${ADMIN_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${TTL}` });
}

// 휴지통 비우기(영구 삭제). 한 번에 정해진 수만큼 지우고 남은 수를 돌려준다. 화면이 0이 될 때까지 다시 부른다.
const BATCH = 20;
export async function emptyTrashRoute(request, env, user) {
  method(request, ['POST']); sameOrigin(request); await requireAdmin(request, env, user);
  const body = await bodyJSON(request), db = env.DB;
  if (body?.kind === 'documents') {
    // 사용 중·보관함 예배에 들어 있는 문서는 비우지 않는다(목록이 깨진다). 순서에서 빼거나 그 예배를 휴지통에 넣은 뒤 다시 비운다.
    const used = await referencedDocumentPaths(env);
    const trashed = (await db.prepare("SELECT id,path FROM yebaeon_documents WHERE state='trashed' ORDER BY state_at").all()).results;
    const kept = trashed.filter(r => used.has(r.path)), ids = trashed.filter(r => !used.has(r.path)).slice(0, BATCH).map(r => r.id);
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      const keys = (await db.prepare(`SELECT object_key FROM yebaeon_versions WHERE document_id IN (${marks})`).bind(...ids).all()).results.map(r => r.object_key);
      // 행을 먼저 지운다. R2 객체가 남아도 가리키는 행이 없으므로 다시 보이지 않는다.
      await db.batch([
        db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,version,sha256,size,path,author,at) SELECT 'doc',id,'purged',current_version,sha256,size,path,?,? FROM yebaeon_documents WHERE state='trashed' AND id IN (${marks})`).bind(user.author, new Date().toISOString(), ...ids),
        ...['yebaeon_versions', 'yebaeon_document_search', 'yebaeon_document_usage', 'yebaeon_media_references', 'yebaeon_document_media', 'yebaeon_document_media_state'].map(table => db.prepare(`DELETE FROM ${table} WHERE document_id IN (${marks})`).bind(...ids)),
        db.prepare(`DELETE FROM yebaeon_editing WHERE kind='doc' AND entity IN (${marks})`).bind(...ids),
        db.prepare(`DELETE FROM yebaeon_documents WHERE state='trashed' AND id IN (${marks})`).bind(...ids)
      ]);
      for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
    }
    return json({ purged: ids.length, remaining: trashed.length - ids.length, kept: kept.map(r => r.path) });
  }
  if (body?.kind === 'playlists') {
    const rows = (await db.prepare("SELECT library_id,node_id,snapshot_key FROM yebaeon_playlist_controls WHERE state='trashed' ORDER BY updated_at LIMIT ?").bind(BATCH).all()).results;
    for (const r of rows) {
      const prefix = r.snapshot_key?.replace(/\/manifest\.json$/, '/');
      if (prefix && prefix.startsWith('playlist-archives/')) {
        let cursor;
        do { const list = await env.FILES.list({ prefix, cursor }); if (list.objects.length) await env.FILES.delete(list.objects.map(o => o.key)); cursor = list.truncated ? list.cursor : undefined; } while (cursor);
      }
      await db.batch([
        db.prepare("UPDATE yebaeon_playlist_controls SET state='removed',snapshot_key=NULL,updated_at=?,updated_by=? WHERE library_id=? AND node_id=? AND state='trashed'").bind(new Date().toISOString(), user.author, r.library_id, r.node_id),
        db.prepare('DELETE FROM yebaeon_playlist_node_versions WHERE library_id=? AND node_id=?').bind(r.library_id, r.node_id)
      ]);
    }
    const remaining = (await db.prepare("SELECT COUNT(*) AS n FROM yebaeon_playlist_controls WHERE state='trashed'").first()).n;
    return json({ purged: rows.length, remaining });
  }
  throw new HttpError(400, 'invalid_trash', '비울 휴지통 종류를 확인해 주세요.');
}

// 교회 Mac 수정본(보관본) 해결 표시. 현재본으로 채택하는 저장은 Studio가 일반 저장으로 하고, 여기서는 표시만 남긴다.
export async function resolveRevisionRoute(request, env, user, id) {
  method(request, ['POST']); sameOrigin(request); await requireAdmin(request, env, user);
  const body = await bodyJSON(request);
  if (!['adopted', 'dismissed'].includes(body?.resolution)) throw new HttpError(400, 'invalid_resolution', '처리 방법을 확인해 주세요.');
  const result = await env.DB.prepare('UPDATE yebaeon_sync_revisions SET resolved_at=?,resolution=? WHERE id=? AND resolved_at IS NULL').bind(new Date().toISOString(), body.resolution, id).run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found', '열린 보관본을 찾지 못했습니다.');
  return json({ resolved: true, resolution: body.resolution });
}
