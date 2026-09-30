export class HttpError extends Error {
  constructor(status, code, message, headers = {}) { super(message); Object.assign(this, { status, code, headers }); }
}
export const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
export function method(request, allowed) {
  if (!allowed.includes(request.method)) throw new HttpError(405, 'method_not_allowed', '지원하지 않는 요청입니다.', { Allow: allowed.join(', ') });
}
export function sameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403, 'origin_required', '예배온 사이트에서 다시 시도해 주세요.');
  }
}
export async function bytes(request, limit) {
  const length = Number(request.headers.get('Content-Length'));
  if (length > limit) throw new HttpError(413, 'too_large', '파일이 허용 크기를 넘습니다.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), parts = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, 'too_large', '파일이 허용 크기를 넘습니다.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
export async function bodyJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'json_required', 'JSON 요청이 필요합니다.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(request, 4096))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', '입력값을 확인해 주세요.'); }
}
export async function sha256(value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
}
