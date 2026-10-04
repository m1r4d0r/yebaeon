import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';

// 편집 중 표시. 잠그지 않고 알려 주기만 한다. 열 때 한 줄 쓰고 남의 줄을 읽는다(30분 안).
// 닫거나 저장하면 지운다. 하트비트·폴링은 없다. 바이트 보호는 버전·노드 sha CAS가 맡는다.
const KINDS = new Set(['doc', 'node']);
export async function editingRoute(request, env, user) {
  method(request, ['GET', 'POST', 'DELETE']);
  // 열 때는 읽기만(1행 안팎). 고치기 시작할 때 POST로 한 줄 쓴다.
  if (request.method === 'GET') {
    const url = new URL(request.url), kind = url.searchParams.get('kind'), entity = url.searchParams.get('entity') || '';
    if (!KINDS.has(kind) || !entity || entity.length > 200) throw new HttpError(400, 'invalid_editing', '편집 대상을 확인해 주세요.');
    const since = new Date(Date.now() - 30 * 60e3).toISOString();
    const others = (await env.DB.prepare('SELECT author,at FROM yebaeon_editing WHERE kind=? AND entity=? AND session_id<>? AND at>? ORDER BY at DESC LIMIT 5').bind(kind, entity, String(user.id), since).all()).results;
    return json({ others });
  }
  sameOrigin(request);
  const body = await bodyJSON(request);
  if (!KINDS.has(body?.kind) || typeof body?.entity !== 'string' || !body.entity.length || body.entity.length > 200) throw new HttpError(400, 'invalid_editing', '편집 대상을 확인해 주세요.');
  const db = env.DB, session = String(user.id);
  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM yebaeon_editing WHERE kind=? AND entity=? AND session_id=?').bind(body.kind, body.entity, session).run();
    return json({ ok: true });
  }
  const now = new Date(), since = new Date(now - 30 * 60e3).toISOString();
  const [, others] = await db.batch([
    db.prepare('INSERT OR REPLACE INTO yebaeon_editing(kind,entity,session_id,author,at) VALUES (?,?,?,?,?)').bind(body.kind, body.entity, session, user.author, now.toISOString()),
    db.prepare('SELECT author,at FROM yebaeon_editing WHERE kind=? AND entity=? AND session_id<>? AND at>? ORDER BY at DESC LIMIT 5').bind(body.kind, body.entity, session, since)
  ]);
  return json({ others: others.results });
}
