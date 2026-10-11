import { HttpError, bodyJSON, bytes, json, method, sameOrigin } from './http.mjs';
import { isAdmin, requireAdmin } from './admin.mjs';

// 질문·답변 창. 작업자가 남긴 질문을 Discord로 알리고, 관리자가 Studio 질문 창이나 Discord 메시지의 [답변하기]로 답한다.
// 작업자는 같은 작업자 이름으로 남긴 질문만, 관리자는 전체를 본다. 표는 isolate마다 처음 쓸 때 한 번 만든다(스키마 버전과 무관한 추가 표).
let ready = false;
const TEXT_MAX = 2000, LIST = 30, ADMIN_LIST = 60, OPEN_MAX = 10;
const ID = /^[0-9a-f-]{36}$/;
async function table(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_questions (id TEXT PRIMARY KEY, author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0, answer TEXT, answered_by TEXT, answered_at TEXT, client TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_questions_author ON yebaeon_questions(author,created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_questions_recent ON yebaeon_questions(created_at)')
  ]);
  // 질문 환경(client) 칸이 생기기 전에 만든 표에 칸을 더한다.
  const columns = (await db.prepare('PRAGMA table_info(yebaeon_questions)').all()).results.map(r => r.name);
  if (!columns.includes('client')) await db.prepare('ALTER TABLE yebaeon_questions ADD COLUMN client TEXT').run().catch(error => { if (!/duplicate column/i.test(error.message)) throw error; });
  ready = true;
}
// 질문한 사람의 환경: Studio가 보낸 값(운영체제·브라우저·창 크기·열린 문서)을 다듬고, 빠진 운영체제·브라우저는 요청 머리글로 채운다.
// 보기: "Mac · macOS 10.13.6 · Chrome 116 · 창 1280×720 · 문서 주님의 은혜".
const clean = (value, max) => typeof value === 'string' ? value.normalize('NFC').replace(/[\x00-\x1f\x7f·]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
function clientOf(request, sent) {
  const ua = request.headers.get('User-Agent') || '', hint = (request.headers.get('Sec-CH-UA-Platform') || '').replace(/"/g, '');
  sent = sent && typeof sent === 'object' && !Array.isArray(sent) ? sent : {};
  let os = clean(sent.os, 40);
  if (!os) os = hint === 'macOS' || /Mac OS X/.test(ua) ? 'macOS' : hint === 'Windows' || /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : clean(hint, 20) || '알 수 없음';
  const kind = /^(macOS|Mac)/i.test(os) ? 'Mac' : /^Windows/i.test(os) ? 'PC' : /Android|iOS|iPhone|iPad/i.test(os) ? '휴대폰·태블릿' : '';
  const match = /(Edg|Chrome|Firefox|Version)\/(\d+)/.exec(ua);
  const browser = clean(sent.browser, 30) || (match ? `${{ Edg: 'Edge', Version: 'Safari' }[match[1]] || match[1]} ${match[2]}` : '');
  const size = v => /^\d{2,5}×\d{2,5}$/.test(v || '') ? v : '';
  return [kind, os, browser, size(sent.window) && `창 ${sent.window}`, clean(sent.doc, 60) && `문서 ${clean(sent.doc, 60)}`].filter(Boolean).join(' · ').slice(0, 200);
}
function text(value, label) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_text', `${label}을(를) 입력해 주세요.`);
  const out = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (!out) throw new HttpError(400, 'invalid_text', `${label}을(를) 입력해 주세요.`);
  if (out.length > TEXT_MAX) throw new HttpError(413, 'too_long', `${label}은(는) ${TEXT_MAX}자까지 쓸 수 있습니다.`);
  return out;
}
const row = r => ({ id: r.id, author: r.author, body: r.body, createdAt: r.created_at, notified: !!r.notified, answer: r.answer, answeredBy: r.answered_by, answeredAt: r.answered_at, client: r.client || '' });

// Discord 알림. 봇(DISCORD_BOT_TOKEN·DISCORD_CHANNEL_ID)이 있으면 [답변하기] 단추가 달린 메시지를 보내고, 없거나 실패하면 웹훅(DISCORD_WEBHOOK_URL)으로 글만 보낸다.
// 멘션은 해석하지 않게 하고(allowed_mentions), 5초 안에 응답이 없으면 알림 실패로 둔다. 질문은 알림과 무관하게 저장된다.
const DISCORD_API = 'https://discord.com/api/v10';
const questionText = q => `**질문** · ${q.author}${q.client ? ` · ${q.client}` : ''}\n${q.body}`.slice(0, 1700);
function messageOf(q, origin) {
  const answered = q.answer ? `\n\n**답변** · ${q.answered_by || ''}\n${q.answer}`.slice(0, 1900 - Math.min(questionText(q).length, 1700)) : '';
  return {
    content: questionText(q) + answered, allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [
      { type: 2, style: q.answer ? 2 : 1, label: q.answer ? '답변 고치기' : '답변하기', custom_id: `qa:answer:${q.id}` },
      { type: 2, style: 5, label: 'Studio에서 보기', url: `${origin}/#qa` }
    ] }]
  };
}
async function notify(env, request, question) {
  const origin = new URL(request.url).origin, post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (typeof env.DISCORD_BOT_TOKEN === 'string' && env.DISCORD_BOT_TOKEN && /^\d{5,30}$/.test(env.DISCORD_CHANNEL_ID || '')
    && await post(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, messageOf(question, origin), { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` })) return true;
  const url = env.DISCORD_WEBHOOK_URL;
  if (typeof url !== 'string' || !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url)) return false;
  return post(url, { username: '예배온 질문', content: `${questionText(question)}\n\n답변: ${origin}/#qa`, allowed_mentions: { parse: [] } });
}

// Discord 상호작용 끝점(개발자 포털의 Interactions Endpoint URL). 세션 대신 DISCORD_PUBLIC_KEY 서명으로 확인한다.
// [답변하기] → 답변 입력 창 → 제출하면 답을 저장하고 같은 메시지에 답을 붙인다. DISCORD_ANSWER_USERS(쉼표로 나눈 사용자 ID)가 있으면 그 사람만 답할 수 있다.
const hexBytes = hex => Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16));
async function signed(request, env, body) {
  const key = env.DISCORD_PUBLIC_KEY, signature = request.headers.get('X-Signature-Ed25519') || '', timestamp = request.headers.get('X-Signature-Timestamp') || '';
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/i.test(key) || !/^[0-9a-f]{128}$/i.test(signature) || !timestamp) return false;
  try {
    const publicKey = await crypto.subtle.importKey('raw', hexBytes(key), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, hexBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch (_) { return false; }
}
const ephemeral = content => json({ type: 4, data: { content, flags: 64 } });
export async function discordInteractionsRoute(request, env) {
  method(request, ['POST']);
  const raw = new TextDecoder().decode(await bytes(request, 64 * 1024));
  if (!await signed(request, env, raw)) return new Response('invalid request signature', { status: 401 });
  const interaction = JSON.parse(raw);
  if (interaction.type === 1) return json({ type: 1 });
  await table(env.DB);
  const person = interaction.member?.user || interaction.user || {}, allowed = (env.DISCORD_ANSWER_USERS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(person.id)) return ephemeral('답변 권한이 없습니다.');
  const [, kind, id] = /^qa:(answer|modal):([0-9a-f-]{36})$/.exec(interaction.data?.custom_id || '') || [];
  const question = id && await env.DB.prepare('SELECT * FROM yebaeon_questions WHERE id=?').bind(id).first();
  if (!question) return ephemeral('질문을 찾지 못했습니다. Studio에서 지워졌을 수 있습니다.');
  if (interaction.type === 3 && kind === 'answer') {
    const field = { type: 4, custom_id: 'answer', label: '답변', style: 2, required: true, max_length: TEXT_MAX, placeholder: question.body.replace(/\s+/g, ' ').slice(0, 100) };
    if (question.answer) field.value = question.answer;
    return json({ type: 9, data: { custom_id: `qa:modal:${id}`, title: `${question.author}님 질문에 답변`.slice(0, 45), components: [{ type: 1, components: [field] }] } });
  }
  if (interaction.type === 5 && kind === 'modal') {
    const value = interaction.data.components?.flatMap(row => row.components || [])?.find(c => c.custom_id === 'answer')?.value;
    let answer; try { answer = text(value, '답변'); } catch (error) { return ephemeral(error.message); }
    const name = authorName(interaction.member?.nick || person.global_name || person.username || 'Discord');
    const updated = await env.DB.prepare('UPDATE yebaeon_questions SET answer=?,answered_by=?,answered_at=? WHERE id=? RETURNING *').bind(answer, name, new Date().toISOString(), id).first();
    if (!updated) return ephemeral('질문을 찾지 못했습니다. Studio에서 지워졌을 수 있습니다.');
    // 단추가 달린 메시지에서 연 입력 창이면 그 메시지를 고쳐 답을 붙인다.
    return interaction.message ? json({ type: 7, data: messageOf(updated, new URL(request.url).origin) }) : ephemeral('답변을 저장했습니다.');
  }
  return ephemeral('지원하지 않는 동작입니다.');
}
function authorName(value) { return String(value).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40) || 'Discord'; }

export async function questionsRoute(request, env, user, id) {
  if (user.device) throw new HttpError(403, 'device_forbidden', '장치 열쇠로는 질문 창을 쓸 수 없습니다.');
  await table(env.DB);
  const db = env.DB;
  if (!id) {
    method(request, ['GET', 'POST']);
    if (request.method === 'GET') {
      const admin = await isAdmin(request, env, user), params = new URL(request.url).searchParams;
      // 관리자 모아보기: ?open=1 이면 답을 기다리는 것만, ?before=<시각> 이면 그보다 오래된 것을 이어서.
      const before = params.get('before') || '9999', open = params.get('open') === '1';
      const rows = admin
        ? (await db.prepare(`SELECT * FROM yebaeon_questions WHERE created_at<?${open ? ' AND answer IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`).bind(before, ADMIN_LIST).all()).results
        : (await db.prepare('SELECT * FROM yebaeon_questions WHERE author=? ORDER BY created_at DESC LIMIT ?').bind(user.author, LIST).all()).results;
      const waiting = admin ? (await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_questions WHERE answer IS NULL').first()).n : undefined;
      return json({ admin, author: user.author, questions: rows.map(row), waiting, next: admin && rows.length === ADMIN_LIST ? rows.at(-1).created_at : null });
    }
    sameOrigin(request);
    const sent = await bodyJSON(request, 16 * 1024), body = text(sent?.body, '질문'), client = clientOf(request, sent?.client);
    const open = await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_questions WHERE author=? AND answer IS NULL').bind(user.author).first();
    if (open.n >= OPEN_MAX) throw new HttpError(429, 'too_many_questions', `답을 기다리는 질문이 ${OPEN_MAX}개입니다. 답을 받은 뒤 다시 남겨 주세요.`);
    const question = { id: crypto.randomUUID(), author: user.author, body, created_at: new Date().toISOString(), notified: 0, answer: null, answered_by: null, answered_at: null, client };
    await db.prepare('INSERT INTO yebaeon_questions(id,author,body,created_at,client) VALUES(?,?,?,?,?)').bind(question.id, question.author, body, question.created_at, client).run();
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
