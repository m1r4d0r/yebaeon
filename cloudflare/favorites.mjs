import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
// 공용 즐겨찾기: 입장한 모두가 같은 목록을 본다. kind는 media(이미지 sha256) 또는 template(템플릿 id).
// 표는 처음 쓸 때 만든다(스키마 버전과 무관한 추가 표).
const KINDS = new Set(['media', 'template']), ready = new WeakSet();
async function table(db) {
  if (ready.has(db)) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_favorites (kind TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY(kind,key))').run();
  ready.add(db);
}
export async function favoritesRoute(request, env, user) {
  method(request, ['GET', 'PUT']);
  await table(env.DB);
  if (request.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT kind,key,label,added_by AS addedBy,added_at AS addedAt FROM yebaeon_favorites ORDER BY added_at DESC LIMIT 500').all()).results;
    return json({ items: rows });
  }
  sameOrigin(request);
  const body = await bodyJSON(request) || {}, { kind, key, label = '', on } = body;
  if (!KINDS.has(kind) || typeof key !== 'string' || !key || key.length > 200 || typeof label !== 'string' || label.length > 300 || typeof on !== 'boolean' || /[\u0000-\u001f\u007f]/.test(key + label)) throw new HttpError(400, 'invalid_favorite', '즐겨찾기 항목을 확인해 주세요.');
  if (kind === 'media' && !/^[a-f0-9]{64}$/.test(key)) throw new HttpError(400, 'invalid_favorite', '이미지 sha256을 확인해 주세요.');
  if (on) await env.DB.prepare('INSERT INTO yebaeon_favorites(kind,key,label,added_by,added_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET label=excluded.label').bind(kind, key, label, user.author, new Date().toISOString()).run();
  else await env.DB.prepare('DELETE FROM yebaeon_favorites WHERE kind=? AND key=?').bind(kind, key).run();
  return json({ kind, key, on });
}
