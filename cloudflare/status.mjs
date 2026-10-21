import { json, method } from './http.mjs';
import { latest } from './app-update.mjs';
export async function recordSync(request, env, user, kind) {
  if (!(request.headers.get('User-Agent') || '').startsWith('YebaeOn-Sync/')) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO yebaeon_sync_status(session_id, author, connected_at, compared_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET author=excluded.author,
    connected_at=CASE WHEN ?='connect' THEN excluded.connected_at ELSE connected_at END,
    compared_at=CASE WHEN ?='compare' THEN excluded.compared_at ELSE compared_at END`)
    .bind(user.id, user.author, now, kind === 'compare' ? now : null, kind, kind).run();
}
export async function statusRoute(request, env) {
  method(request, ['GET']);
  const detailed = new URL(request.url).searchParams.get('details') === '1';
  // Log only aggregate billing metadata, never document paths or content.
  const costs=[];
  async function query(label,sql,first=false){const result=await env.DB.prepare(sql).all();costs.push({query:label,rowsRead:result.meta?.rows_read||0,rowsWritten:result.meta?.rows_written||0});return first?result.results[0]:result.results;}
  const totals = await query('documents-summary',`SELECT COUNT(*) AS documents, COALESCE(SUM(size),0) AS bytes,
    MAX(updated_at) AS latestUploadAt FROM yebaeon_documents`,true);
  const playlists = await query('playlists-summary','SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM yebaeon_playlists',true);
  const catalog=await query('catalog-summary',`SELECT COUNT(*) AS catalogDocuments, COALESCE(SUM(d.id IS NULL),0) AS unavailableDocuments FROM yebaeon_library_catalog c LEFT JOIN yebaeon_documents d ON d.path=c.path`,true);
  const recent = await query('recent',`SELECT id, path, current_version AS version, updated_by AS author,
    updated_at AS updatedAt, size FROM yebaeon_documents ORDER BY updated_at DESC, path LIMIT 20`);
  const images = await query('media-summary','SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM yebaeon_media_assets',true);
  const devices = await query('devices',"SELECT id,name,status_at AS statusAt,last_seen_at AS lastSeenAt,json_extract(status,'$.build') AS build FROM yebaeon_sync_devices WHERE revoked_at IS NULL");
  const deviceNames = new Set(devices.map(d => d.name));
  // 최근 서버 쓰기 300줄만 읽어 Studio 작업(device_id 없음)과 Mac 올리기(장치 열쇠로 쓴 줄)로 나눈다. 이름이 같아도 섞이지 않는다.
  const log = await query('sync-log',`SELECT seq,kind,entity,action,path,name,author,device_id AS deviceId,at FROM yebaeon_sync_log ORDER BY seq DESC LIMIT 300`);
  const applied = await query('sync-events',`SELECT device_id AS deviceId,kind,summary,at FROM yebaeon_sync_events ORDER BY seq DESC LIMIT 30`);
  const commands = await query('sync-commands',`SELECT device_id AS deviceId,action,args,author,created_at AS at,state FROM yebaeon_sync_commands ORDER BY created_at DESC LIMIT 20`);
  const studio = studioWork(log.filter(r => !r.deviceId));
  const syncEvents = deviceEvents(log.filter(r => r.deviceId), applied, commands, devices);
  // 최근 문서의 Mac/Studio 표시도 그 문서의 마지막 일지 줄로 정한다. 300줄 밖이면 이름으로 짐작한다.
  const lastWriter = new Map();
  for (const r of log) if (r.kind === 'doc' && !lastWriter.has(r.entity)) lastWriter.set(r.entity, !!r.deviceId);
  for (const r of recent) r.device = lastWriter.has(r.id) ? lastWriter.get(r.id) : deviceNames.has(r.author);
  let storage;
  if(detailed){
    const documentHistory=await query('document-history',`SELECT COUNT(*) AS count, COALESCE(SUM(v.size),0) AS bytes FROM yebaeon_versions v JOIN yebaeon_documents d ON d.id=v.document_id WHERE v.version<>d.current_version`,true);
    const playlistHistory=await query('playlist-history',`SELECT COUNT(*) AS count, COALESCE(SUM(v.size),0) AS bytes FROM yebaeon_playlist_versions v JOIN yebaeon_playlists p ON p.id=v.library_id WHERE v.version<>p.current_version`,true);
    // 이미지: 바이트는 sha 하나에 한 번(중복 경로는 한 번만), 폴더별은 경로 수와 그 경로들이 가리키는 크기.
    const folders=await query('media-folders',`SELECT CASE WHEN path>='/Users/Shared/Renewed Vision Media/Images/' AND path<'/Users/Shared/Renewed Vision Media/Images0' THEN 'Images' WHEN path>='/Users/Shared/Renewed Vision Media/ImportedImages/' AND path<'/Users/Shared/Renewed Vision Media/ImportedImages0' THEN 'ImportedImages' WHEN path>='/Users/Shared/Renewed Vision Media/YebaeOn/' AND path<'/Users/Shared/Renewed Vision Media/YebaeOn0' THEN 'YebaeOn' ELSE 'other' END AS folder, COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM yebaeon_media_paths WHERE state='active' GROUP BY folder ORDER BY folder`);
    storage={currentDocuments:{count:totals.documents,bytes:totals.bytes},currentPlaylists:playlists,documentHistory,playlistHistory,images,imageFolders:folders,trackedBytes:totals.bytes+playlists.bytes+documentHistory.bytes+playlistHistory.bytes+images.bytes};
  }
  console.log(JSON.stringify({event:'d1-read-cost',route:detailed?'status-details':'status',queries:costs}));
  return json({ ...totals,...catalog,playlists:playlists.count,images,...(storage?{storage}:{}),recent,studio,syncEvents,devices:devices.map(({id,name,statusAt,lastSeenAt,build})=>({name,code:String(id||'').slice(0,6),statusAt,lastSeenAt,build:Number.isSafeInteger(build)?build:null})),syncApp:await latestBuild(env),observedAt:new Date().toISOString() });
}

// 서버에 게시된 최신 Sync 2 빌드(R2 latest.json, D1 읽기 없음). 없거나 읽지 못하면 null.
async function latestBuild(env) { try { const v = await latest(env); return v ? { build: v.build, createdAt: v.createdAt || null } : null; } catch { return null; } }

const docName = path => (path || '').split('/').pop().replace(/\.pro6$/i, '');
// 한국 날짜(UTC+9)로 묶는다.
const day = at => new Date(Date.parse(at || 0) + 9 * 3600e3).toISOString().slice(0, 10);
// 작업자마다 가장 최근 저장 시각과, 그날 손댄 문서·예배 이름(앞 3개와 나머지 수).
function studioWork(rows) {
  const people = new Map();
  for (const r of rows) {
    if (r.action === 'purged') continue;
    let p = people.get(r.author);
    if (!p) people.set(r.author, p = { author: r.author, at: r.at, docs: [], nodes: [], images: 0 });
    if (day(r.at) !== day(p.at)) continue;
    if (r.kind === 'doc') { const n = docName(r.path); if (n && !p.docs.includes(n)) p.docs.push(n); }
    else if (r.kind === 'media') p.images++;
    else if (r.name && !p.nodes.includes(r.name)) p.nodes.push(r.name);
  }
  return [...people.values()].slice(0, 10).map(p => ({ author: p.author, at: p.at, docs: p.docs.slice(0, 3), docCount: p.docs.length, nodes: p.nodes.slice(0, 3), nodeCount: p.nodes.length, images: p.images }));
}
const COMMAND = { check: '다시 비교', fullCheck: '전체 확인', undo: '마지막 적용 되돌리기', apply: '적용', organizer: '정리', force: '강제 동작', message: '안내' };
const label = r => r.kind === 'doc' ? docName(r.path) : r.kind === 'media' ? null : r.name;
const countKey = kind => kind === 'doc' ? 'documents' : kind === 'media' ? 'images' : 'nodes';
// 받기 요약(sync_events.summary)을 화면 모양으로. 'received'는 Sync가 [적용]마다 보낸 보고, 'applied'는 옛 빌드의 커서 기준 줄이다.
function receivedView(kind, s) {
  if (kind === 'received') {
    const nodes = Array.isArray(s.nodes) ? s.nodes : [];
    return { counts: { documents: s.documents || 0, nodes: nodes.length, images: s.images || 0 }, names: (nodes.length ? nodes : s.documentNames || []).slice(0, 8), all: [...nodes, ...(s.documentNames || [])].slice(0, 100), held: s.held || 0, revisions: s.revisions || 0 };
  }
  // 종류별 수가 있는 줄(counts)과, 그 전 모양(count 안에 그림 수 포함)
  const counts = s.counts || { documents: Math.max(0, (s.count || 0) - (s.images || 0)), nodes: 0, images: s.images || 0, ...(s.more ? { more: true } : {}) };
  return { counts, names: (s.names || []).slice(0, 8), all: s.names || [] };
}
// Mac이 올린 것(같은 장치·같은 분은 한 줄), 받아 적용한 것, 원격 명령을 시각순 한 목록으로.
// 올리기 줄은 문서·예배·그림 수를 따로 세고, 문서·예배 이름 전체(최대 100)를 펼쳐 볼 수 있게 준다.
function deviceEvents(uploads, applied, commands, devices) {
  const names = new Map(devices.map(d => [d.id, d.name])), out = [];
  for (const r of uploads) {
    const minute = (r.at || '').slice(0, 16), last = out[out.length - 1], name = label(r);
    let line = last && last.kind === 'uploaded' && last.deviceId === r.deviceId && last.minute === minute ? last : null;
    if (!line) out.push(line = { kind: 'uploaded', deviceId: r.deviceId, device: names.get(r.deviceId) || r.author, at: r.at, minute, counts: { documents: 0, nodes: 0, images: 0 }, all: [] });
    line.counts[countKey(r.kind)]++;
    if (name && !line.all.includes(name) && line.all.length < 100) line.all.push(name);
  }
  for (const e of applied) { let s = {}; try { s = JSON.parse(e.summary); } catch (_) {} out.push({ kind: e.kind, deviceId: e.deviceId, device: names.get(e.deviceId) || '', at: e.at, ...receivedView(e.kind, s) }); }
  for (const c of commands) { let a = {}; try { a = JSON.parse(c.args); } catch (_) {} out.push({ kind: 'remote', deviceId: c.deviceId, device: names.get(c.deviceId) || '', at: c.at, action: COMMAND[c.action] || c.action, target: a.path ? docName(a.path) : (a.nodes || []).join(', ') || a.text || '', author: c.author, state: c.state }); }
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 30).map(({ minute, deviceId, ...e }) => ({ ...e, code: String(deviceId || '').slice(0, 6), ...(e.all ? { names: e.names || e.all.slice(0, 8) } : {}) }));
}
