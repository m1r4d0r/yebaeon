import { HttpError, bytes, json, method, sameOrigin } from './http.mjs';
import { requireAdmin } from './admin.mjs';

// 교회 Mac 현황과 원격 지원(sync.md 13.6).
// - 현황: 상주 Sync가 비교 결과·PP6 상태·마지막 오류를 장치 한 줄에 덮어쓴다. 바뀌었을 때와 한 시간에 한 번만 보낸다.
// - 원격 지원: Mac 앞에서 [원격 지원]을 누르면 지원 시간이 열린다. 그 시간 안에서만 관리자가 명령을 남기고, Mac이 가져가 실행한 뒤 결과를 보고한다.
//   명령은 Mac 창·정리 창에 있는 버튼과 같은 동작뿐이다. 경로·셸 명령을 받지 않고, Mac은 대상을 자기 비교 결과와 맞춰 본 뒤 실행한다.
export const REMOTE_MIGRATION = 'remote-support-v1';
export async function migrateRemoteSupport(db) {
  if (await db.prepare(`SELECT name FROM yebaeon_schema_migrations WHERE name='${REMOTE_MIGRATION}'`).first()) return;
  const columns = new Set((await db.prepare('PRAGMA table_info(yebaeon_sync_devices)').all()).results.map(r => r.name));
  try {
    await db.batch([
      ...(columns.has('status') ? [] : [db.prepare('ALTER TABLE yebaeon_sync_devices ADD COLUMN status TEXT')]),
      ...(columns.has('status_at') ? [] : [db.prepare('ALTER TABLE yebaeon_sync_devices ADD COLUMN status_at TEXT')]),
      ...(columns.has('support_until') ? [] : [db.prepare('ALTER TABLE yebaeon_sync_devices ADD COLUMN support_until TEXT')]),
      db.prepare(`CREATE TABLE IF NOT EXISTS yebaeon_sync_commands (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, action TEXT NOT NULL, args TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', taken_at TEXT, finished_at TEXT, result TEXT)`),
      db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_sync_commands_device ON yebaeon_sync_commands(device_id,state,created_at)'),
      db.prepare(`INSERT INTO yebaeon_schema_migrations(name) VALUES ('${REMOTE_MIGRATION}')`)
    ]);
  } catch (error) {
    if (!await db.prepare(`SELECT name FROM yebaeon_schema_migrations WHERE name='${REMOTE_MIGRATION}'`).first()) throw error;
  }
}

const STATUS_LIMIT = 64 * 1024, COMMAND_TTL = 10 * 60e3, SUPPORT_MAX = 60, PENDING_MAX = 20;
const COMMAND_ID = /^[0-9a-f-]{36}$/;
// 명령 종류와 인자. Mac 창의 버튼과 같은 이름을 쓴다.
const ORGANIZER = new Set(['server', 'mac', 'number', 'trash', 'image', 'import', 'removeNumbered']);
const FORCE = new Set(['server', 'mac', 'trashServer', 'trashMac']);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
function commandArgs(action, args) {
  const bad = () => { throw new HttpError(400, 'invalid_command', '원격 명령을 확인해 주세요.'); };
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) bad();
  args = args || {};
  if (action === 'check' || action === 'fullCheck' || action === 'undo') return {};
  if (action === 'apply') {
    if (!Array.isArray(args.nodes) || !args.nodes.length || args.nodes.length > 20 || args.nodes.some(n => !text(n, 160))) bad();
    return { nodes: [...new Set(args.nodes)] };
  }
  if (action === 'organizer' || action === 'force') {
    if (!text(args.path, 600) || !(action === 'organizer' ? ORGANIZER : FORCE).has(args.do)) bad();
    return { path: args.path.normalize('NFC'), do: args.do };
  }
  if (action === 'message') {
    if (!text(args.text, 200)) bad();
    return { text: args.text };
  }
  bad();
}
const iso = ms => new Date(ms).toISOString();
const open = row => !!row.support_until && Date.parse(row.support_until) > Date.now();
function commandView(r) {
  return { id: r.id, action: r.action, args: JSON.parse(r.args), author: r.author, createdAt: r.created_at, expiresAt: r.expires_at, state: r.state, takenAt: r.taken_at || null, finishedAt: r.finished_at || null, result: r.result || null };
}
async function deviceRow(db, id) {
  const row = await db.prepare('SELECT id,name,revoked_at,support_until FROM yebaeon_sync_devices WHERE id=?').bind(id).first();
  if (!row || row.revoked_at) throw new HttpError(404, 'not_found', '장치를 찾지 못했습니다.');
  return row;
}
const own = (user, id) => { if (user.device !== id) throw new HttpError(403, 'device_forbidden', '이 장치의 열쇠로만 할 수 있습니다.'); };
const person = user => { if (user.device) throw new HttpError(403, 'device_forbidden', '장치 열쇠로는 할 수 없습니다.'); };
async function body(request, limit) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'json_required', 'JSON 요청이 필요합니다.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(request, limit))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', '입력값을 확인해 주세요.'); }
}

// POST /api/sync/devices/:id/status  (장치) 현황 덮어쓰기
async function statusRoute(request, env, user, id) {
  method(request, ['POST']); sameOrigin(request); own(user, id);
  const input = await body(request, STATUS_LIMIT);
  if (!input || typeof input.status !== 'object' || input.status === null || Array.isArray(input.status)) throw new HttpError(400, 'invalid_status', '현황을 확인해 주세요.');
  const now = iso(Date.now());
  await env.DB.prepare('UPDATE yebaeon_sync_devices SET status=?,status_at=? WHERE id=? AND revoked_at IS NULL').bind(JSON.stringify(input.status), now, id).run();
  return json({ ok: true, statusAt: now });
}

// POST /api/sync/devices/:id/support  {minutes} 열기(장치만) · {close:true} 닫기(장치 또는 관리자)
// 닫으면 아직 가져가지 않은 명령은 만료로 바꾼다.
async function supportRoute(request, env, user, id) {
  method(request, ['POST']); sameOrigin(request);
  const input = await body(request, 1024), db = env.DB;
  if (input?.close === true) {
    if (!user.device) await requireAdmin(request, env, user); else own(user, id);
    await deviceRow(db, id);
    const now = iso(Date.now());
    await db.batch([
      db.prepare('UPDATE yebaeon_sync_devices SET support_until=NULL WHERE id=?').bind(id),
      db.prepare("UPDATE yebaeon_sync_commands SET state='expired',finished_at=? WHERE device_id=? AND state='pending'").bind(now, id)
    ]);
    return json({ supportUntil: null });
  }
  // 지원 시간은 Mac 앞에서 누른 사람만 연다.
  own(user, id);
  const minutes = input?.minutes;
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > SUPPORT_MAX) throw new HttpError(400, 'invalid_support', `지원 시간은 1~${SUPPORT_MAX}분입니다.`);
  const until = iso(Date.now() + minutes * 60e3);
  await db.prepare('UPDATE yebaeon_sync_devices SET support_until=? WHERE id=? AND revoked_at IS NULL').bind(until, id).run();
  return json({ supportUntil: until });
}

// /api/sync/devices/:id/commands
//   GET  장치: 기다리는 명령을 가져가며 'taken'으로 바꾼다(한 문장). 지원 시간이 아니면 빈 목록.
//   GET  사람: 최근 명령 30개와 결과
//   POST 관리자: 명령 남기기. 지원 시간 안에서만, 10분 뒤 만료.
// /api/sync/devices/:id/commands/:command  POST 장치: 결과 보고 {state:'done'|'failed'|'rejected', message}
async function commandsRoute(request, env, user, id, commandId) {
  const db = env.DB;
  if (commandId) {
    method(request, ['POST']); sameOrigin(request); own(user, id);
    if (!COMMAND_ID.test(commandId)) throw new HttpError(404, 'not_found', '명령을 찾지 못했습니다.');
    const input = await body(request, 8 * 1024);
    if (!['done', 'failed', 'rejected'].includes(input?.state) || (input.message !== undefined && (typeof input.message !== 'string' || input.message.length > 4000))) throw new HttpError(400, 'invalid_result', '명령 결과를 확인해 주세요.');
    const result = await db.prepare("UPDATE yebaeon_sync_commands SET state=?,result=?,finished_at=? WHERE id=? AND device_id=? AND state='taken'").bind(input.state, input.message || null, iso(Date.now()), commandId, id).run();
    if (!result.meta.changes) throw new HttpError(409, 'command_closed', '이미 끝났거나 가져가지 않은 명령입니다.');
    return json({ ok: true });
  }
  method(request, ['GET', 'POST']);
  if (request.method === 'GET' && user.device) {
    own(user, id);
    const device = await deviceRow(db, id), now = Date.now();
    if (!open(device)) return json({ commands: [], supportUntil: null });
    const rows = (await db.prepare("UPDATE yebaeon_sync_commands SET state='taken',taken_at=? WHERE device_id=? AND state='pending' AND expires_at>? RETURNING *").bind(iso(now), id, iso(now)).all()).results;
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    return json({ commands: rows.map(commandView), supportUntil: device.support_until });
  }
  person(user);
  if (request.method === 'GET') {
    const device = await deviceRow(db, id);
    const rows = (await db.prepare('SELECT * FROM yebaeon_sync_commands WHERE device_id=? ORDER BY created_at DESC LIMIT 30').bind(id).all()).results;
    const now = Date.now();
    return json({ supportUntil: open(device) ? device.support_until : null, commands: rows.map(r => ({ ...commandView(r), state: r.state === 'pending' && Date.parse(r.expires_at) <= now ? 'expired' : r.state })) });
  }
  sameOrigin(request); await requireAdmin(request, env, user);
  const input = await body(request, 4096);
  if (typeof input?.action !== 'string') throw new HttpError(400, 'invalid_command', '원격 명령을 확인해 주세요.');
  const args = commandArgs(input.action, input.args);
  const device = await deviceRow(db, id);
  if (!open(device)) throw new HttpError(409, 'support_closed', '원격 지원 시간이 아닙니다. 교회 Mac에서 [원격 지원]을 눌러 달라고 해 주세요.');
  const now = Date.now(), waiting = await db.prepare("SELECT COUNT(*) AS n FROM yebaeon_sync_commands WHERE device_id=? AND state='pending' AND expires_at>?").bind(id, iso(now)).first();
  if (waiting.n >= PENDING_MAX) throw new HttpError(429, 'too_many_commands', '기다리는 명령이 많습니다. Mac이 처리한 뒤 다시 보내 주세요.');
  const row = { id: crypto.randomUUID(), device_id: id, action: input.action, args: JSON.stringify(args), author: user.author, created_at: iso(now), expires_at: iso(Math.min(now + COMMAND_TTL, Date.parse(device.support_until))), state: 'pending' };
  await db.prepare('INSERT INTO yebaeon_sync_commands(id,device_id,action,args,author,created_at,expires_at,state) VALUES (?,?,?,?,?,?,?,?)').bind(row.id, row.device_id, row.action, row.args, row.author, row.created_at, row.expires_at, row.state).run();
  return json({ command: commandView(row) }, 201);
}

export async function remoteSupportRoute(request, env, user, deviceId, resource, commandId) {
  if (resource === 'status' && !commandId) return statusRoute(request, env, user, deviceId);
  if (resource === 'support' && !commandId) return supportRoute(request, env, user, deviceId);
  if (resource === 'commands') return commandsRoute(request, env, user, deviceId, commandId);
  throw new HttpError(404, 'not_found', '없는 요청입니다.');
}
