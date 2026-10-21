import { HttpError, bytes, json, method, sameOrigin } from './http.mjs';
import { loadPlaylist } from './playlists.mjs';
import { referencePath } from './playlist-format.mjs';

// 점검 목록 보고서: Sync 정리 창의 '확인 필요' 목록과 그 항목들의 서버 상태를 한 덩어리 글로 만든다.
// 사람이 이 글을 복사해 Claude에게 보내면 docs/guides/sync-review.md 기준으로 항목마다 처리 방안을 제안받는다.
// POST /api/sync/devices/:id/review
//   body {} → 장치가 마지막으로 보고한 현황(status.review·rows)으로 만든다(Studio 교회 Mac 창).
//   body {items, rows, device} → Sync가 보낸 목록과 Mac 쪽 사실(파일 크기·수정 시각·sha·영수증)로 만든다(Sync 정리 창).
// 버튼을 누를 때만 부른다. D1: 장치 1행 + 문서·버전 수·보관본 수·경로표·그림 원본 각 1문장 + 문서마다 일지 3행 + 재생목록마다 1행.
const LIMIT = 256 * 1024, MAX_ITEMS = 200;
const KST = at => { const t = Date.parse(at || ''); return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : ''; };
const size = n => !Number.isFinite(n) ? '' : n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
const short = sha => typeof sha === 'string' && sha ? sha.slice(0, 8) : '';
const str = (v, n = 300) => typeof v === 'string' ? v.normalize('NFC').slice(0, n) : '';
const DOCUMENT_STATE = { active: '사용 중', archived: '보관함', trashed: '휴지통' }, MEDIA_STATE = { active: '사용 중', trashed: '휴지통' };
const ACTIONS = { server: '서버 것 받기', mac: 'Mac 것 올리기', number: '둘 다 두기', trash: '서버 휴지통으로', image: '이미지 받기', import: '그림 가져오기', removeNumbered: '번호 사본 지우기' };

function cleanItem(item) {
  if (!item || typeof item !== 'object') return null;
  const mac = item.mac && typeof item.mac === 'object' ? item.mac : null;
  return {
    list: str(item.list, 40), title: str(item.title), path: str(item.path), detail: str(item.detail, 600),
    actions: Array.isArray(item.actions) ? item.actions.filter(a => typeof a === 'string').slice(0, 8) : [],
    references: Array.isArray(item.references) ? item.references.map(r => str(r)).filter(Boolean).slice(0, 20) : null,
    mac: mac && { exists: mac.exists === true, size: Number.isSafeInteger(mac.size) ? mac.size : null, modifiedAt: str(mac.modifiedAt, 40), sha256: str(mac.sha256, 64),
      ledger: mac.ledger && typeof mac.ledger === 'object' ? { version: Number.isSafeInteger(mac.ledger.version) ? mac.ledger.version : null, sha256: str(mac.ledger.sha256, 64), state: str(mac.ledger.state, 20) } : null }
  };
}
const isDocument = path => /\.pro6$/i.test(path);
const imagePaths = item => item.list === '외부 참조' ? (item.references || item.detail.split(', ').filter(Boolean)) : item.list === '이미지 보충' && item.path ? [item.path] : [];

async function inList(db, sql, values) {
  if (!values.length) return [];
  return (await db.prepare(sql).bind(JSON.stringify(values)).all()).results;
}
// 문서 경로가 든 사용 중 예배 이름. 재생목록 파일마다 현재 버전 1행 + R2 1회.
async function usedIn(env, paths) {
  const wanted = new Set(paths), found = new Map();
  if (!wanted.size) return found;
  for (const r of (await env.DB.prepare('SELECT * FROM yebaeon_playlists').all()).results) {
    let parsed; try { parsed = await loadPlaylist(env, r); } catch (_) { continue; }
    for (const p of parsed.playlists) for (const item of p.items) {
      const path = item.kind === 'document' && referencePath(item.sourcePath, r.source_root);
      if (path && wanted.has(path)) { const list = found.get(path) || []; if (!list.includes(p.name)) list.push(p.name); found.set(path, list); }
    }
  }
  return found;
}
async function serverFacts(env, items) {
  const db = env.DB;
  const docPaths = [...new Set(items.map(i => i.path).filter(isDocument))];
  const docs = new Map((await inList(db, 'SELECT id,path,state,state_at AS stateAt,state_by AS stateBy,current_version AS version,sha256,size,updated_at AS updatedAt,updated_by AS updatedBy,category,history_enabled AS history FROM yebaeon_documents WHERE path IN (SELECT value FROM json_each(?))', docPaths)).map(d => [d.path, d]));
  const ids = [...docs.values()].map(d => d.id);
  const versions = new Map((await inList(db, 'SELECT document_id AS id,COUNT(*) AS n FROM yebaeon_versions WHERE document_id IN (SELECT value FROM json_each(?)) GROUP BY document_id', ids)).map(r => [r.id, r.n]));
  const revisions = new Map((await inList(db, 'SELECT entity,COUNT(*) AS n FROM yebaeon_sync_revisions WHERE resolved_at IS NULL AND entity IN (SELECT value FROM json_each(?)) GROUP BY entity', ids)).map(r => [r.entity, r.n]));
  const logs = new Map();
  if (ids.length) {
    const results = await db.batch(ids.map(id => db.prepare("SELECT action,author,device_id AS device,previous,at FROM yebaeon_sync_log WHERE kind='doc' AND entity=? ORDER BY seq DESC LIMIT 3").bind(id)));
    ids.forEach((id, i) => logs.set(id, results[i].results));
  }
  const mediaList = [...new Set(items.flatMap(imagePaths))].slice(0, 400);
  const media = new Map((await inList(db, 'SELECT path,sha256,size,state,updated_at AS updatedAt,updated_by AS updatedBy FROM yebaeon_media_paths WHERE path IN (SELECT value FROM json_each(?))', mediaList)).map(m => [m.path, m]));
  const assets = new Set((await inList(db, 'SELECT sha256 FROM yebaeon_media_assets WHERE sha256 IN (SELECT value FROM json_each(?))', [...new Set([...media.values()].map(m => m.sha256))])).map(a => a.sha256));
  return { docs, versions, revisions, logs, media, assets, used: await usedIn(env, [...docs.keys()]) };
}

const LOG = { created: '만듦', updated: '저장', renamed: '이름 바꿈', trashed: '휴지통', untrashed: '휴지통에서 꺼냄', archived: '보관', unarchived: '보관에서 꺼냄', purged: '영구 삭제' };
function documentLine(path, f) {
  const d = f.docs.get(path);
  if (!d) return '서버: 같은 경로의 문서 없음';
  const parts = [`문서 v${d.version}`, DOCUMENT_STATE[d.state] || d.state || '사용 중', `${KST(d.updatedAt)} ${d.updatedBy} 저장`, size(d.size), `sha ${short(d.sha256)}`,
    d.category ? `카테고리 ${d.category}` : '', d.history === 0 ? '이력 끔' : `이력 켬(버전 ${f.versions.get(d.id) || 1}개)`,
    f.revisions.get(d.id) ? `열린 교회 Mac 보관본 ${f.revisions.get(d.id)}개` : '', d.state && d.state !== 'active' ? `${KST(d.stateAt)} ${d.stateBy || ''} ${DOCUMENT_STATE[d.state]}로`.trim() : ''];
  const used = f.used.get(path);
  const lines = ['서버: ' + parts.filter(Boolean).join(' · '), '서버 예배: ' + (used?.length ? used.join(', ') : '사용 중 예배에 없음')];
  const log = f.logs.get(d.id) || [];
  if (log.length) lines.push('최근 일지: ' + log.map(r => `${KST(r.at)} ${LOG[r.action] || r.action} ${r.author}(${r.device ? 'Mac' : 'Studio'})${r.previous ? ' ← ' + r.previous : ''}`).join(' / '));
  return lines.join('\n   ');
}
function macLine(mac) {
  if (!mac) return '';
  const parts = [mac.exists ? 'Mac 파일 있음' : 'Mac 파일 없음', mac.exists && mac.size !== null ? size(mac.size) : '', mac.modifiedAt ? '수정 ' + KST(mac.modifiedAt) : '', mac.sha256 ? 'sha ' + short(mac.sha256) : '',
    mac.ledger ? `영수증 기준 v${mac.ledger.version ?? '?'}${mac.ledger.sha256 ? ' sha ' + short(mac.ledger.sha256) : ''}${mac.ledger.state && mac.ledger.state !== 'active' ? ' ' + mac.ledger.state : ''}` : '영수증 기록 없음'];
  return 'Mac: ' + parts.filter(Boolean).join(' · ');
}
function mediaLine(path, f) {
  const m = f.media.get(path);
  if (!m) return `${path} → 서버 경로표에 없음`;
  return `${path} → 서버 ${MEDIA_STATE[m.state] || m.state} · ${size(m.size)} · sha ${short(m.sha256)} · ${KST(m.updatedAt)} ${m.updatedBy}${f.assets.has(m.sha256) ? '' : ' · 원본 그림 없음'}`;
}
const STATUS = { receive: '받을 것', mac: 'Mac 수정 올리기 대기', macNew: 'Mac에서 만듦', hold: '보류', trash: '서버 휴지통', archived: '보관함', actions: '정리 창에서 정할 것', same: '같음' };

export function reviewText({ device, status, items, rows, head, facts, now }) {
  const lines = ['# 예배온 Sync 점검 목록', '',
    'Claude에게: 저장소 m1r4d0r/yebaeon의 docs/guides/sync-review.md 기준으로 항목마다 추천 처리(어느 버튼을 누를지, 그 까닭, 먼저 확인할 것)를 제안해 주세요. 서버 상태는 아래에 이미 들어 있습니다.', '',
    `만든 때: ${KST(now)} (한국시간)`,
    `장치: ${device.name} (${device.id.slice(0, 6)}) · Sync 빌드 ${status.build || '모름'} · 현황 보고 ${KST(device.status_at) || '없음'} · 마지막 접속 ${KST(device.last_seen_at) || '없음'}`,
    `Mac 상태: ${status.summary || '요약 없음'}${status.presenter ? ' · PP6 실행 중' : ''}${status.busy ? ' · Sync 작업 중' : ''}${status.fullCheckAt ? ' · 지난 전체 확인 ' + KST(status.fullCheckAt) : ''}${status.lastApplyAt ? ' · 마지막 적용 ' + KST(status.lastApplyAt) : ''}${status.error ? ' · 마지막 오류: ' + status.error : ''}`,
    `서버: 변경 일지 마지막 번호 ${head} · 이 장치가 적용한 번호 ${device.applied_seq}${head > device.applied_seq ? ` (${head - device.applied_seq}줄 뒤)` : ''} · 적용 보고 ${KST(device.applied_at) || '없음'}`];
  const groups = new Map();
  for (const item of items) { const list = item.list || '기타'; if (!groups.has(list)) groups.set(list, []); groups.get(list).push(item); }
  lines.push('', `## 확인 필요 ${items.length}개`);
  if (!items.length) lines.push('', '정리 창에 확인할 항목이 없습니다.');
  for (const [list, group] of groups) {
    lines.push('', `### ${list} (${group.length})`);
    group.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title || item.path}${item.path && item.path !== item.title ? ` [${item.path}]` : ''}`);
      if (item.detail) lines.push(`   Sync 설명: ${item.detail}`);
      const mac = macLine(item.mac); if (mac) lines.push('   ' + mac);
      if (isDocument(item.path)) lines.push('   ' + documentLine(item.path, facts));
      for (const path of imagePaths(item)) lines.push('   그림: ' + mediaLine(path, facts));
      if (item.actions.length) lines.push('   정리 창 버튼: ' + item.actions.map(a => ACTIONS[a] || a).join(', '));
    });
  }
  const open = rows.filter(r => r && r.status && r.status !== 'same');
  if (open.length) {
    lines.push('', `## 예배 비교에서 같지 않은 줄 ${open.length}개`);
    for (const r of open.slice(0, 80)) lines.push(`- ${str(r.name, 200)} · ${STATUS[r.status] || r.status}${r.text ? ' · ' + str(r.text, 300) : ''}${r.updatedAt ? ` · 서버 ${KST(r.updatedAt)} ${str(r.updatedBy, 40)}` : ''}`);
  }
  let pending = []; try { pending = JSON.parse(device.pending || '[]'); } catch (_) {}
  if (pending.length) lines.push('', `## 적용 보고의 기다림 ${pending.length}개`, ...pending.slice(0, 50).map(p => `- ${p.entity}${p.reason ? ' · ' + p.reason : ''}`));
  return lines.join('\n') + '\n';
}

export async function reviewRoute(request, env, user, id) {
  method(request, ['POST']); sameOrigin(request);
  if (user.device && user.device !== id) throw new HttpError(403, 'device_forbidden', '이 장치의 열쇠로만 보낼 수 있습니다.');
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(request, LIMIT)) || '{}'); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', '입력값을 확인해 주세요.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_review', '점검 목록을 확인해 주세요.');
  const db = env.DB;
  const device = await db.prepare('SELECT id,name,status,status_at,last_seen_at,applied_seq,applied_at,pending FROM yebaeon_sync_devices WHERE id=? AND revoked_at IS NULL').bind(id).first();
  if (!device) throw new HttpError(404, 'not_found', '장치를 찾지 못했습니다.');
  let status = {}; try { status = device.status ? JSON.parse(device.status) : {}; } catch (_) {}
  // Sync가 보낸 목록이 있으면 그것(Mac 쪽 사실 포함), 없으면 마지막 현황 보고의 목록.
  const sent = Array.isArray(input.items);
  const items = (sent ? input.items : status.review || []).slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 200) : status.rows || [];
  if (sent && input.status && typeof input.status === 'object' && !Array.isArray(input.status)) status = { ...status, ...input.status };
  const head = (await db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM yebaeon_sync_log').first()).seq;
  const facts = await serverFacts(env, items);
  const text = reviewText({ device, status, items, rows, head, facts, now: new Date().toISOString() });
  return json({ text, items: items.length, source: sent ? 'sync' : 'status' });
}
