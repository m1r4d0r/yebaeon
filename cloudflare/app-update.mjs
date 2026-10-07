import { HttpError, headers, json, method } from './http.mjs';

// Sync 2 앱 업데이트. main에서 Mac 검사를 통과한 빌드만 CI가 R2에 올린다(apps/sync2/latest.json + ZIP).
// 앱은 장치 열쇠로 최신 빌드 번호를 묻고, 사람이 [지금 설치]를 누를 때만 ZIP을 받는다.
const LATEST = 'apps/sync2/latest.json';
const SHA = /^[0-9a-f]{64}$/;
export async function latest(env) {
  const object = await env.FILES.get(LATEST);
  if (!object) return null;
  const value = await object.json();
  if (!Number.isSafeInteger(value?.build) || value.build < 1 || !SHA.test(value.sha256 || '') || !Number.isSafeInteger(value.size) || typeof value.key !== 'string' || !value.key.startsWith('apps/sync2/')) return null;
  return value;
}
export async function appUpdateRoute(request, env, download) {
  method(request, ['GET']);
  const value = await latest(env);
  if (!value) throw new HttpError(404, 'no_release', '내려받을 Sync 2 빌드가 아직 없습니다.');
  if (!download) return json({ build: value.build, sha256: value.sha256, size: value.size, notes: typeof value.notes === 'string' ? value.notes.slice(0, 500) : '', createdAt: value.createdAt || null });
  const object = await env.FILES.get(value.key);
  if (!object) throw new HttpError(404, 'no_release', 'Sync 2 빌드 파일을 찾지 못했습니다.');
  return new Response(object.body, { headers: { ...headers, 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store', 'X-Yebaeon-SHA256': value.sha256, 'Content-Length': String(object.size) } });
}
