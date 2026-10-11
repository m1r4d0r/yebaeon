import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
import { isAdmin, requireAdmin } from './admin.mjs';

// 질문·답변 창. 작업자가 남긴 질문을 Discord 웹훅(Worker 비밀값 DISCORD_WEBHOOK_URL)으로 알리고, 관리자가 Studio에서 답한다.
// 작업자는 같은 작업자 이름으로 남긴 질문만, 관리자는 전체를 본다. 표는 isolate마다 처음 쓸 때 한 번 만든다(스키마 버전과 무관한 추가 표).
let ready = false;
const TEXT_MAX = 2000, LIST = 30, ADMIN_LIST = 60, OPEN_MAX = 10;
const ID = /^[0-9a-f-]{36}$/;
async function table(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_questions (id TEXT PRIMARY KEY, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, answer TEXT, answered_by TEXT, answered_at TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_questions_author ON yebaeon_questions(author,created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_questions_recent ON yebaeon_questions(created_at)')
  ]);
  ready = true;
}
function text(value, label) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_text', `${label}을(를) 입력해 주세요.`);
  const out = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (!out) throw new HttpError(400, 'invalid_text', `${label}을(를) 입력해 주세요.`);
  if (out.length > TEXT_MAX) throw new HttpError(413, 'too_long', `${label}은(는) ${TEXT_MAX}자까지 쓸 수 있습니다.`);
  return out;
}
const row = r => ({ id: r.id, author: r.author, body: r.body, createdAt: r.created_at, notified: !!r.notified, answer: r.answer, answeredBy: r.answered_by, answeredAt: r.answered_at });

// Discord가 멘션을 해석하지 않게 하고(allowed_mentions), 5초 안에 응답이 없으면 알림 실패로 둔다. 질문은 알림과 무관하게 저장된다.
async function notify(env, request, question) {
  const url = env.DISCORD_WEBHOOK_URL;
  if (typeof url !== 'string' || !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url)) return false;
  const link = `${new URL(request.url).origin}/#qa`;
  const content = `**질문** · ${question.author}\n${question.body}`.slice(0, 1800) + `\n\n답변: ${link}`;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '예배온 질문', content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch (_) { return false; }
}

export async function questionsRoute(request, env, user, id) {
  if (user.device) throw new HttpError(403, 'device_forbidden', '장치 열쇠로는 질문 창을 쓸 수 없습니다.');
  await table(env.DB);
  const db = env.DB;
  if (!id) {
    method(request, ['GET', 'POST']);
    if (request.method === 'GET') {
      const admin = await isAdmin(request, env, user);
      const rows = admin
        ? (await db.prepare('SELECT * FROM yebaeon_questions ORDER BY created_at DESC LIMIT ?').bind(ADMIN_LIST).all()).results
        : (await db.prepare('SELECT * FROM yebaeon_questions WHERE author=? ORDER BY created_at DESC LIMIT ?').bind(user.author, LIST).all()).results;
      return json({ admin, author: user.author, questions: rows.map(row) });
    }
    sameOrigin(request);
    const body = text((await bodyJSON(request, 16 * 1024))?.body, '질문');
    const open = await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_questions WHERE author=? AND answer IS NULL').bind(user.author).first();
    if (open.n >= OPEN_MAX) throw new HttpError(429, 'too_many_questions', `답을 기다리는 질문이 ${OPEN_MAX}개입니다. 답을 받은 뒤 다시 남겨 주세요.`);
    const question = { id: crypto.randomUUID(), author: user.author, body, created_at: new Date().toISOString(), notified: 0, answer: null, answered_by: null, answered_at: null };
    await db.prepare('INSERT INTO yebaeon_questions(id,author,body,created_at) VALUES(?,?,?,?)').bind(question.id, question.author, body, question.created_at).run();
    if (await notify(env, request, question)) {
      question.notified = 1;
      await db.prepare('UPDATE yebaeon_questions SET notified=1 WHERE id=?').bind(question.id).run();
    }
    return json({ question: row(question) }, 201);
  }
  if (!ID.test(id)) throw new HttpError(404, 'not_found', '질문을 찾지 못했습니다.');
  method(request, ['POST', 'DELETE']); sameOrigin(request); await requireAdmin(request, env, user);
  if (request.method === 'DELETE') {
    const result = await db.prepare('DELETE FROM yebaeon_questions WHERE id=?').bind(id).run();
    if (!result.meta.changes) throw new HttpError(404, 'not_found', '질문을 찾지 못했습니다.');
    return json({ deleted: true });
  }
  const answer = text((await bodyJSON(request, 16 * 1024))?.answer, '답변');
  const updated = await db.prepare('UPDATE yebaeon_questions SET answer=?,answered_by=?,answered_at=? WHERE id=? RETURNING *').bind(answer, user.author, new Date().toISOString(), id).first();
  if (!updated) throw new HttpError(404, 'not_found', '질문을 찾지 못했습니다.');
  return json({ question: row(updated) });
}
