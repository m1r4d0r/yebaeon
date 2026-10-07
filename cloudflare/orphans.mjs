import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
import { requireAdmin } from './admin.mjs';
import { MEDIA_ROOT, mediaPathKey } from './ledger.mjs';

// 고아 이미지 정리(sync.md 13). 문서가 쓰는 이미지 경로를 문서별로 적어 두고(저장할 때마다 현재본 기준),
// 어느 문서(사용 중·보관·휴지통)도 쓰지 않는 이미지 경로를 관리자가 골라 휴지통에 넣는다.
// 휴지통에 넣으면 경로표 상태가 `trashed`가 되고 일지에 `media trashed`가 남는다. 교회 Mac은 다음 [적용] 때 그 파일을 macOS 휴지통으로 옮긴다.
// 대상 폴더는 슬라이드에서 가져온 그림(ImportedImages·YebaeOn)뿐이다. Images(미디어 서랍)는 PP6에서 직접 쓰므로 고르지 않는다.
export const ORPHAN_FOLDERS = ['ImportedImages/', 'YebaeOn/'];
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
async function candidates(db) {
  const folder = ORPHAN_FOLDERS.map(() => '(p.path>=? AND p.path<?)').join(' OR ');
  const bounds = ORPHAN_FOLDERS.flatMap(f => [MEDIA_ROOT + f, MEDIA_ROOT + f.slice(0, -1) + '0']);
  let favorites = new Set();
  try { favorites = new Set((await db.prepare("SELECT key FROM yebaeon_favorites WHERE kind='media'").all()).results.map(r => r.key)); } catch { /* 즐겨찾기 표가 아직 없다 */ }
  const rows = (await db.prepare(`SELECT p.path,p.sha256,p.size,p.updated_at AS updatedAt FROM yebaeon_media_paths p WHERE p.state='active' AND (${folder}) AND NOT EXISTS(SELECT 1 FROM yebaeon_document_media m WHERE m.path=p.path) ORDER BY p.path`).bind(...bounds).all()).results;
  return rows.filter(r => !favorites.has(r.sha256));
}

// GET  /api/admin/orphans              색인 진행과 후보 목록(색인이 끝났을 때만 후보를 준다)
// POST /api/admin/orphans {index:true}  아직 색인하지 않은 문서 40개를 R2에서 읽어 이미지 경로를 적는다
// POST /api/admin/orphans {trash:[path…]}  고른 경로를 다시 확인해 휴지통에 넣는다
export async function orphansRoute(request, env, user) {
  method(request, ['GET', 'POST']); await requireAdmin(request, env, user);
  const db = env.DB;
  if (request.method === 'GET') {
    const remaining = await unindexed(db);
    if (remaining) return json({ remaining, candidates: null });
    const list = await candidates(db);
    return json({ remaining: 0, candidates: list, bytes: list.reduce((n, r) => n + (r.size || 0), 0) });
  }
  sameOrigin(request);
  const body = await bodyJSON(request);
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
    if (!paths.length || paths.length > 200 || paths.length !== body.trash.length) throw new HttpError(400, 'invalid_paths', '정리할 이미지 경로를 확인해 주세요.');
    if (await unindexed(db)) throw new HttpError(409, 'index_pending', '문서 이미지 색인이 끝나지 않았습니다. 다시 확인해 주세요.');
    const allowed = new Set((await candidates(db)).map(r => r.path)), chosen = paths.filter(p => allowed.has(p)), now = new Date().toISOString();
    if (chosen.length) {
      const list = JSON.stringify(chosen);
      await db.batch([
        db.prepare(`INSERT INTO yebaeon_sync_log(kind,entity,action,sha256,size,path,author,at) SELECT 'media',path,'trashed',sha256,size,path,?,? FROM yebaeon_media_paths WHERE state='active' AND path IN (SELECT value FROM json_each(?))`).bind(user.author, now, list),
        db.prepare(`UPDATE yebaeon_media_paths SET state='trashed',updated_at=?,updated_by=? WHERE state='active' AND path IN (SELECT value FROM json_each(?))`).bind(now, user.author, list)
      ]);
    }
    return json({ trashed: chosen.length, skipped: paths.filter(p => !allowed.has(p)) });
  }
  throw new HttpError(400, 'invalid_request', '요청을 확인해 주세요.');
}
