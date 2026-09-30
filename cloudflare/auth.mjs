import { HttpError, bodyJSON, json, sha256, sameOrigin, method } from './http.mjs';
export const COOKIE = '__Host-yebaeon';
const DAY = 86400;
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`;
export function configured(env) { return typeof env.SITE_PASSWORD === 'string' && env.SITE_PASSWORD.length >= 8; }
export function authorName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'name_required', '작업자 이름을 입력해 주세요.');
  const name = value.normalize('NFC').trim();
  if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw new HttpError(400, 'invalid_name', '작업자 이름은 1~40자로 입력해 주세요.');
  return name;
}
async function key(env) { return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SITE_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function signature(env, value) {
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode('yebaeon-session-v1:' + value))), n => n.toString(16).padStart(2, '0')).join('');
}
function tokenOf(request) { return (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1); }
export async function session(request, env) {
  if (!configured(env)) return null;
  const token = tokenOf(request);
  if (!token || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return null;
  const [random, mac] = token.split('.');
  const valid = await crypto.subtle.verify('HMAC', await key(env), Uint8Array.from(mac.match(/../g), s => parseInt(s, 16)), new TextEncoder().encode('yebaeon-session-v1:' + random));
  if (!valid) return null;
  return env.DB.prepare('SELECT id, author, expires_at FROM yebaeon_sessions WHERE id = ? AND expires_at > ?').bind(await sha256(random), Math.floor(Date.now() / 1000)).first();
}
export async function requireSession(request, env) {
  const user = await session(request, env);
  if (!user) throw new HttpError(401, 'login_required', '공용 비밀번호와 작업자 이름으로 입장해 주세요.');
  return user;
}
export async function sessionRoute(request, env) {
  method(request, ['GET', 'POST', 'PATCH', 'DELETE']);
  if (request.method === 'GET') {
    const user = await session(request, env);
    return json(user ? { authenticated: true, ready: true, name: user.author, expiresAt: user.expires_at } : { authenticated: false, ready: true });
  }
  sameOrigin(request);
  if (request.method === 'DELETE') {
    const user = await session(request, env);
    if (user) await env.DB.prepare('DELETE FROM yebaeon_sessions WHERE id = ?').bind(user.id).run();
    return json({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (request.method === 'PATCH') {
    const user = await requireSession(request, env), body = await bodyJSON(request), name = authorName(body?.name);
    await env.DB.prepare('UPDATE yebaeon_sessions SET author = ? WHERE id = ?').bind(name, user.id).run();
    return json({ authenticated: true, name, expiresAt: user.expires_at });
  }
  const body = await bodyJSON(request), name = authorName(body?.name);
  if (typeof body?.password !== 'string' || !body.password.length || body.password.length > 1024) throw new HttpError(400, 'password_required', '공용 비밀번호를 입력해 주세요.');
  const now = Math.floor(Date.now() / 1000), window = Math.floor(now / 600) * 600;
  const ipKey = await signature(env, 'login-ip:' + (request.headers.get('CF-Connecting-IP') || 'local'));
  const attempt = await env.DB.prepare(`INSERT INTO yebaeon_login_limits(key, attempts, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
    window_start = excluded.window_start RETURNING attempts`).bind(ipKey, window).first();
  if (attempt.attempts > 8) throw new HttpError(429, 'too_many_attempts', '입장 시도가 많습니다. 잠시 후 다시 시도해 주세요.', { 'Retry-After': String(window + 600 - now) });
  const expected = await signature(env, 'password-check'), actualKey = { SITE_PASSWORD: body.password };
  // Fixed-length digests avoid comparing plaintext character by character.
  const actual = await signature(actualKey, 'password-check'); let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (difference !== 0) throw new HttpError(401, 'wrong_password', '공용 비밀번호가 맞지 않습니다.');
  const random = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  const ttl = body.remember === true ? 30 * DAY : DAY / 2;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO yebaeon_sessions(id, author, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(random), name, now, now + ttl),
    env.DB.prepare('DELETE FROM yebaeon_login_limits WHERE key = ? OR window_start < ?').bind(ipKey, now - 3600),
    env.DB.prepare('DELETE FROM yebaeon_sessions WHERE expires_at <= ?').bind(now)
  ]);
  return json({ authenticated: true, name, expiresAt: now + ttl }, 200, { 'Set-Cookie': cookie(random + '.' + await signature(env, random), body.remember === true ? ttl : undefined) });
}
