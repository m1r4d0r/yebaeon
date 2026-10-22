import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
import { requireAdmin } from './admin.mjs';
import { MEDIA_ROOT, mediaPathKey } from './ledger.mjs';
import { mediaKey, thumbnailKey } from './media-assets.mjs';

// 고아 이미지 정리(sync.md 13). 문서가 쓰는 이미지 경로를 문서별로 적어 두고(저장할 때마다 현재본 기준),
// 어느 문서(사용 중·보관·휴지통)도 쓰지 않는 이미지 경로를 관리자가 골라 휴지통에 넣는다.
// 휴지통에 넣으면 경로표 상태가 `trashed`가 되고 일지에 `media trashed`가 남는다. 교회 Mac은 다음 [적용] 때 그 파일을 macOS 휴지통으로 옮긴다.
// 기본 대상 폴더는 슬라이드에서 가져온 그림(ImportedImages·YebaeOn)이다. Images(미디어 서랍)는 PP6에서 직접 쓰므로 관리자가 `images`를 켤 때만(처음 한 번 정리용) 함께 고른다.
export const ORPHAN_FOLDERS = ['ImportedImages/', 'YebaeOn/'];
const folders = images => images ? [...ORPHAN_FOLDERS, 'Images/'] : ORPHAN_FOLDERS;
const PATTERN = /(file:\/\/(?:localhost)?\/Users\/Shared\/Renewed(?:%20| )Vision(?:%20| )Media\/[^"'<>]+|\/Users\/Shared\/Renewed Vision Media\/[^"'<>]+)/g;
const entity = value => value.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"');

// 문서 XML에 나오는 교회 이미지 경로(Sync 2의 MediaPaths와 같은 규칙). 경로표 키와 같은 모양(NFC 절대경로)으로 돌려준다.
export function documentMediaPaths(bytes) {
  const xml = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes), out = new Set();
  for (const match of xml.matchAll(PATTERN)) {
    let value = entity(match[0]);
    if (value.startsWith('file:')) { try { value = decodeURIComponent(new URL(value.replace(/^file:\/\/localhost\//, 'file:///')).pathname); } catch { continue; } }
    else { try { value = decodeURIComponent(value); } catch { /* 퍼센트가 섞인 실제 이름 */ } }
    const path = mediaPathKey(value);
    if (path) out.add(path);
  }
  return [...out];
}
// 저장 문장들과 같은 batch에 넣는다. write_id가 맞을 때만(같은 저장이 이겼을 때만) 바뀐다.
export function documentMediaStatements(db, id, version, paths, writeId) {
  const guard = 'EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=?)';
  return [
    db.prepare(`DELETE FROM yebaeon_document_media WHERE document_id=? AND ${guard}`).bind(id, id, writeId),
    db.prepare(`INSERT OR IGNORE INTO yebaeon_document_media(document_id,path) SELECT ?,value FROM json_each(?) WHERE ${guard}`).bind(id, JSON.stringify(paths), id, writeId),
    db.prepare(`INSERT OR REPLACE INTO yebaeon_document_media_state(document_id,version) SELECT ?,? WHERE ${guard}`).bind(id, version, id, writeId)
  ];
}

const pending = db => db.prepare('SELECT d.id,d.current_version AS version,d.write_id AS writeId,v.object_key AS objectKey FROM yebaeon_documents d JOIN yebaeon_versions v ON v.document_id=d.id AND v.version=d.current_version LEFT JOIN yebaeon_document_media_state s ON s.document_id=d.id WHERE s.version IS NULL OR s.version<>d.current_version LIMIT ?');
const unindexed = async db => (await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_documents d LEFT JOIN yebaeon_document_media_state s ON s.document_id=d.id WHERE s.version IS NULL OR s.version<>d.current_version').first()).n;
async function candidates(db, images) {
  const list = folders(images), folder = list.map(() => '(p.path>=? AND p.path<?)').join(' OR ');
  const bounds = list.flatMap(f => [MEDIA_ROOT + f, MEDIA_ROOT + f.slice(0, -1) + '0']);
  let favorites = new Set();
  try { favorites = new Set((await db.prepare("SELECT key FROM yebaeon_favorites WHERE kind='media'").all()).results.map(r => r.key)); } catch { /* 즐겨찾기 표가 아직 없다 */ }
  const rows = (await db.prepare(`SELECT p.path,p.sha256,p.size,p.updated_at AS updatedAt FROM yebaeon_media_paths p WHERE p.state='active' AND (${folder}) AND NOT EXISTS(SELECT 1 FROM yebaeon_document_media m WHERE m.path=p.path) ORDER BY p.path`).bind(...bounds).all()).results;
  return rows.filter(r => !favorites.has(r.sha256));
}

// 고른 경로 중 지금도 고아인 것(그 경로만 확인한다. 후보 전체를 다시 계산하지 않는다).
const UNUSED = 'NOT EXISTS(SELECT 1 FROM yebaeon_document_media m WHERE m.path=p.path)';
async function stillOrphan(db, paths, images) {
  const allowed = folders(images).map(f => MEDIA_ROOT + f);
  let favorites = new Set();
  try { favorites = new Set((await db.prepare("SELECT key FROM yebaeon_favorites WHERE kind='media'").all()).results.map(r => r.key)); } catch { /* 즐겨찾기 표가 아직 없다 */ }
  const rows = (await db.prepare(`SELECT p.path,p.sha256 FROM yebaeon_media_paths p WHERE p.state='active' AND p.path IN (SELECT value FROM json_each(?)) AND ${UNUSED}`).bind(JSON.stringify(paths)).all()).results;
  return rows.filter(r => allowed.some(prefix => r.path.startsWith(prefix)) && !favorites.has(r.sha256));
}
// 한 번에 보내는 경로 수와 요청 크기. 경로 하나가 한글로 수백 바이트라 500개면 수십 KB다. 비우기도 500개(R2 한 번에 지우는 키 1000개 = 원본+미리보기).
const BATCH = 500, PURGE_BATCH = 500, BODY_LIMIT = 512 * 1024;

// GET  /api/admin/orphans[?images=1]   색인 진행과 후보 목록(색인이 끝났을 때만 후보를 준다). images=1이면 Images 폴더도
// POST /api/admin/orphans {index:true}  아직 색인하지 않은 문서 40개를 R2에서 읽어 이미지 경로를 적는다
// POST /api/admin/orphans {trash:[path…], images?}  고른 경로(최대 500)를 그 경로만 다시 확인해 휴지통에 넣는다
// POST /api/admin/orphans {untrash|purge:[path…]}  그림 휴지통에서 꺼내기·비우기(최대 500)
// POST /api/admin/orphans {purgeAll:true}  그림 휴지통에서 아무 문서도 쓰지 않는 것 500개를 비우고 남은 수를 돌려준다(화면이 0이 될 때까지 다시 부른다)
export async function orphansRoute(request, env, user) {
  method(request, ['GET', 'POST']); await requireAdmin(request, env, user);
  const db = env.DB;
  if (request.method === 'GET' && new URL(request.url).searchParams.get('trashed') === '1') {
    const list = (await db.prepare("SELECT path,sha256,size,updated_at AS updatedAt,updated_by AS updatedBy FROM yebaeon_media_paths WHERE state='trashed' ORDER BY updated_at DESC,path LIMIT 2000").all()).results;
    return json({ trashed: list, bytes: list.reduce((n, r) => n + (r.size || 0), 0) });
  }
  if (request.method === 'GET') {
    const remaining = await unindexed(db);
    if (remaining) return json({ remaining, candidates: null });
    const list = await candidates(db, new URL(request.url).searchParams.get('images') === '1');
    return json({ remaining: 0, candidates: list, bytes: list.reduce((n, r) => n + (r.size || 0), 0) });
  }
  sameOrigin(request);
  const body = await bodyJSON(request, BODY_LIMIT);
  if (body?.index === true) {
    const rows = (await pending(db).bind(40).all()).results;
    for (const row of rows) {
      const object = await env.FILES.get(row.objectKey);
      if (!object) continue;
      await db.batch(documentMediaStatements(db, row.id, row.version, documentMediaPaths(new Uint8Array(await object.arrayBuffer())), row.writeId));
    }
    return json({ indexed: rows.length, remaining: await unindexed(db) });
  }
  if (Array.isArray(body?.trash)) {
    const paths = [...new Set(body.trash.map(mediaPathKey).filter(Boolean))];
    if (!paths.length || paths.length > BATCH || paths.length !== body.trash.length) throw new HttpError(400, 'invalid_paths', '정리할 이미지 경로를 확인해 주세요.');
    if (await unindexed(db)) throw new HttpError(409, 'index_pending', '문서 이미지 색인이 끝나지 않았습니다. 다시 확인해 주세요.');
    const allowed = new Set((await stillOrphan(db, paths, body.images === true)).map(r => r.path)), chosen = paths.filter(p => allowed.has(p)), now = new Date().toISOString();
    if (chosen.length) {
      const list = JSON.stringify(chosen);
      await db.batch([
        db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,device_id,at) SELECT 'media',path,'trashed',sha256,size,path,?,?,? FROM yebaeon_media_paths WHERE state='active' AND path IN (SELECT value FROM json_each(?))`).bind(user.author, user.device || null, now, list),
        db.prepare(`UPDATE yebaeon_media_paths SET state='trashed',updated_at=?,updated_by=? WHERE state='active' AND path IN (SELECT value FROM json_each(?))`).bind(now, user.author, list)
      ]);
    }
    return json({ trashed: chosen.length, skipped: paths.filter(p => !allowed.has(p)) });
  }
  if (body?.purgeAll === true) {
    const rows = (await db.prepare(`SELECT p.path FROM yebaeon_media_paths p WHERE p.state='trashed' AND ${UNUSED} ORDER BY p.path LIMIT ?`).bind(PURGE_BATCH).all()).results;
    const result = rows.length ? await purge(env, user, rows.map(r => r.path)) : { purged: 0, deleted: 0 };
    const remaining = (await db.prepare(`SELECT COUNT(*) AS n FROM yebaeon_media_paths p WHERE p.state='trashed' AND ${UNUSED}`).first()).n;
    return json({ ...result, remaining });
  }
  for (const action of ['untrash', 'purge']) if (Array.isArray(body?.[action])) {
    const paths = [...new Set(body[action].map(mediaPathKey).filter(Boolean))];
    if (!paths.length || paths.length > (action === 'purge' ? PURGE_BATCH : BATCH) || paths.length !== body[action].length) throw new HttpError(400, 'invalid_paths', '이미지 경로를 확인해 주세요.');
    return json(await (action === 'untrash' ? untrash : purge)(env, user, paths));
  }
  throw new HttpError(400, 'invalid_request', '요청을 확인해 주세요.');
}

// 그림 휴지통에서 꺼내기: 경로표를 다시 `active`로, 일지에 `media untrashed`. 교회 Mac은 기다리던 휴지통 이동을 지운다.
async function untrash(env, user, paths) {
  const db = env.DB, list = JSON.stringify(paths), now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,device_id,at) SELECT 'media',path,'untrashed',sha256,size,path,?,?,? FROM yebaeon_media_paths WHERE state='trashed' AND path IN (SELECT value FROM json_each(?))`).bind(user.author, user.device || null, now, list),
    db.prepare(`UPDATE yebaeon_media_paths SET state='active',updated_at=?,updated_by=? WHERE state='trashed' AND path IN (SELECT value FROM json_each(?))`).bind(now, user.author, list)
  ]);
  return { untrashed: results[1].meta.changes || 0 };
}
// 그림 휴지통 비우기: 경로표에서 지우고 일지에 `media purged`. 그 바이트(sha)를 가리키는 경로·문서 버전 참조·즐겨찾기가 하나도 남지 않으면 R2 원본·미리보기와 자산 행도 지운다.
// 그사이 어느 문서가 다시 쓰기 시작한 경로는 비우지 않는다. 교회 Mac은 기다리던 휴지통 이동을 그대로 한다.
async function purge(env, user, paths) {
  const db = env.DB, list = JSON.stringify(paths), now = new Date().toISOString();
  const rows = (await db.prepare(`SELECT p.path,p.sha256 FROM yebaeon_media_paths p WHERE p.state='trashed' AND p.path IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM yebaeon_document_media m WHERE m.path=p.path)`).bind(list).all()).results;
  if (!rows.length) return { purged: 0, deleted: 0, skipped: paths };
  const chosen = JSON.stringify(rows.map(r => r.path));
  await db.batch([
    db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,device_id,at) SELECT 'media',path,'purged',sha256,size,path,?,?,? FROM yebaeon_media_paths WHERE state='trashed' AND path IN (SELECT value FROM json_each(?))`).bind(user.author, user.device || null, now, chosen),
    db.prepare(`DELETE FROM yebaeon_media_paths WHERE state='trashed' AND path IN (SELECT value FROM json_each(?))`).bind(chosen)
  ]);
  let favorites = new Set();
  try { favorites = new Set((await db.prepare("SELECT key FROM yebaeon_favorites WHERE kind='media'").all()).results.map(r => r.key)); } catch { /* 즐겨찾기 표가 아직 없다 */ }
  // 남은 경로·문서 버전 참조가 없는 바이트만 지운다. 그림마다 묻지 않고 한 문장으로 고르고, R2는 1000개씩 한 번에, 자산 행도 한 문장으로.
  const shas = [...new Set(rows.map(r => r.sha256))].filter(sha => !favorites.has(sha));
  const unused = shas.length ? (await db.prepare(`SELECT j.value AS sha256,a.object_key AS objectKey FROM json_each(?) j LEFT JOIN yebaeon_media_assets a ON a.sha256=j.value WHERE NOT EXISTS(SELECT 1 FROM yebaeon_media_paths p WHERE p.sha256=j.value) AND NOT EXISTS(SELECT 1 FROM yebaeon_media_references r WHERE r.asset_sha256=j.value)`).bind(JSON.stringify(shas)).all()).results : [];
  const keys = unused.flatMap(u => [u.objectKey || mediaKey(u.sha256), thumbnailKey(u.sha256)]);
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  if (unused.length) await db.prepare('DELETE FROM yebaeon_media_assets WHERE sha256 IN (SELECT value FROM json_each(?))').bind(JSON.stringify(unused.map(u => u.sha256))).run();
  const deleted = unused.length;
  const done = new Set(rows.map(r => r.path));
  return { purged: rows.length, deleted, skipped: paths.filter(p => !done.has(p)) };
}
