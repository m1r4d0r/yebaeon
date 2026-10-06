import { json, method } from './http.mjs';
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
  const devices = await query('devices','SELECT id,name,status_at AS statusAt FROM yebaeon_sync_devices WHERE revoked_at IS NULL');
  const deviceNames = new Set(devices.map(d => d.name));
  // 최근 서버 쓰기 300줄만 읽어 Studio 작업(사람)과 Mac 올리기(장치 이름)로 나눈다.
  const log = await query('sync-log',`SELECT seq,kind,action,path,name,author,at FROM yebaeon_sync_log ORDER BY seq DESC LIMIT 300`);
  const applied = await query('sync-events',`SELECT device_id AS deviceId,kind,summary,at FROM yebaeon_sync_events ORDER BY seq DESC LIMIT 30`);
  const commands = await query('sync-commands',`SELECT device_id AS deviceId,action,args,author,created_at AS at,state FROM yebaeon_sync_commands ORDER BY created_at DESC LIMIT 20`);
  const studio = studioWork(log.filter(r => !deviceNames.has(r.author)));
  const syncEvents = deviceEvents(log.filter(r => deviceNames.has(r.author)), applied, commands, devices);
  for (const r of recent) r.device = deviceNames.has(r.author);
  let storage;
  if(detailed){
    const documentHistory=await query('document-history',`SELECT COUNT(*) AS count, COALESCE(SUM(v.size),0) AS bytes FROM yebaeon_versions v JOIN yebaeon_documents d ON d.id=v.document_id WHERE v.version<>d.current_version`,true);
    const playlistHistory=await query('playlist-history',`SELECT COUNT(*) AS count, COALESCE(SUM(v.size),0) AS bytes FROM yebaeon_playlist_versions v JOIN yebaeon_playlists p ON p.id=v.library_id WHERE v.version<>p.current_version`,true);
    // 이미지: 바이트는 sha 하나에 한 번(중복 경로는 한 번만), 폴더별은 경로 수와 그 경로들이 가리키는 크기.
    const folders=await query('media-folders',`SELECT CASE WHEN path>='/Users/Shared/Renewed Vision Media/Images/' AND path<'/Users/Shared/Renewed Vision Media/Images0' THEN 'Images' WHEN path>='/Users/Shared/Renewed Vision Media/ImportedImages/' AND path<'/Users/Shared/Renewed Vision Media/ImportedImages0' THEN 'ImportedImages' WHEN path>='/Users/Shared/Renewed Vision Media/YebaeOn/' AND path<'/Users/Shared/Renewed Vision Media/YebaeOn0' THEN 'YebaeOn' ELSE 'other' END AS folder, COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM yebaeon_media_paths WHERE state='active' GROUP BY folder ORDER BY folder`);
    storage={currentDocuments:{count:totals.documents,bytes:totals.bytes},currentPlaylists:playlists,documentHistory,playlistHistory,images,imageFolders:folders,trackedBytes:totals.bytes+playlists.bytes+documentHistory.bytes+playlistHistory.bytes+images.bytes};
  }
  console.log(JSON.stringify({event:'d1-read-cost',route:detailed?'status-details':'status',queries:costs}));
  return json({ ...totals,...catalog,playlists:playlists.count,images,...(storage?{storage}:{}),recent,studio,syncEvents,devices:devices.map(({name,statusAt})=>({name,statusAt})),observedAt:new Date().toISOString() });
}

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
// Mac이 올린 것(같은 분은 한 줄), 받아 적용한 것, 원격 명령을 시각순 한 목록으로.
function deviceEvents(uploads, applied, commands, devices) {
  const names = new Map(devices.map(d => [d.id, d.name])), out = [];
  for (const r of uploads) {
    const minute = (r.at || '').slice(0, 16), last = out[out.length - 1], label = r.kind === 'doc' ? docName(r.path) : r.kind === 'media' ? null : r.name;
    if (last && last.kind === 'uploaded' && last.device === r.author && last.minute === minute) { if (label && !last.names.includes(label)) last.names.push(label); last.count++; continue; }
    out.push({ kind: 'uploaded', device: r.author, at: r.at, minute, names: label ? [label] : [], count: 1 });
  }
  for (const e of applied) { let s = {}; try { s = JSON.parse(e.summary); } catch (_) {} out.push({ kind: e.kind, device: names.get(e.deviceId) || '', at: e.at, names: s.names || [], count: s.count || 0, more: !!s.more, images: s.images || 0 }); }
  for (const c of commands) { let a = {}; try { a = JSON.parse(c.args); } catch (_) {} out.push({ kind: 'remote', device: names.get(c.deviceId) || '', at: c.at, action: COMMAND[c.action] || c.action, target: a.path ? docName(a.path) : (a.nodes || []).join(', ') || a.text || '', author: c.author, state: c.state }); }
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 30).map(({ minute, ...e }) => ({ ...e, names: e.names?.slice(0, 8) }));
}
