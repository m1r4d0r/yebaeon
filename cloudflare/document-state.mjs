import { HttpError, bytes, json, method, sameOrigin } from './http.mjs';
import { documentLog } from './sync2.mjs';
import { rewriteDocumentReferences } from './playlists.mjs';

// 문서의 보관함·휴지통·이름 바꾸기. 바이트·버전은 그대로 두고 상태와 경로만 바꾼다.
// 보관(archived): 일반 검색에서 빠지고 보관함에서 꺼내 본다. Mac과는 연결하지 않는다(표시만).
// 휴지통(trashed): 검색·목록에서 빠지고 Mac은 [적용] 때 macOS 휴지통으로 옮긴다. 영구 삭제는 관리자의 휴지통 비우기뿐이다.
const TRANSITIONS = {
  archive: { from: ['active'], to: 'archived', log: 'archived' },
  unarchive: { from: ['archived'], to: 'active', log: 'unarchived' },
  trash: { from: ['active', 'archived'], to: 'trashed', log: 'trashed' },
  untrash: { from: ['trashed'], to: 'active', log: 'untrashed' }
};
async function body(request, limit) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(request, limit))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', '입력값을 확인해 주세요.'); }
}
export async function documentStateRoute(request, env, user, id, action, helpers) {
  method(request, ['POST']); sameOrigin(request);
  const db = env.DB, input = await body(request, 2048);
  if (action === 'state') {
    const step = TRANSITIONS[input?.action];
    if (!step) throw new HttpError(400, 'invalid_state', '보관·휴지통 동작을 확인해 주세요.');
    const row = await helpers.find(db, id);
    if ((row.state || 'active') === step.to) return json({ document: helpers.document(row), unchanged: true });
    if (!step.from.includes(row.state || 'active')) throw new HttpError(409, 'invalid_state', '지금 상태에서는 할 수 없는 동작입니다. 목록을 새로고침해 주세요.');
    const writeId = crypto.randomUUID(), now = new Date().toISOString();
    const results = await db.batch([
      db.prepare(`UPDATE yebaeon_documents SET state=?,state_at=?,state_by=?,write_id=? WHERE id=? AND state IN (${step.from.map(() => '?').join(',')})`).bind(step.to, now, user.author, writeId, id, ...step.from),
      documentLog(db, { id, writeId, action: step.log, author: user.author, now })
    ]);
    if (results[0].meta.changes !== 1) throw new HttpError(409, 'invalid_state', '다른 작업자가 먼저 바꿨습니다. 목록을 새로고침해 주세요.');
    return json({ document: helpers.document({ ...row, state: step.to, state_at: now, state_by: user.author }) });
  }
  // 이름 바꾸기: id·버전·이력은 그대로, 경로만 바뀐다. 모든 재생목록의 참조도 새 경로로 고친다.
  const match = request.headers.get('If-Match');
  if (!match || !/^"[1-9][0-9]*"$/.test(match)) throw new HttpError(428, 'version_required', '문서의 기준 버전이 필요합니다.');
  const row = await helpers.find(db, id), path = helpers.documentPath(input?.path);
  if (Number(match.slice(1, -1)) !== row.current_version) throw new HttpError(409, 'version_conflict', '다른 작업자가 먼저 저장했습니다. 새로고침 뒤 다시 바꿔 주세요.');
  if ((row.state || 'active') === 'trashed') throw new HttpError(409, 'document_trashed', '휴지통에 있는 문서는 이름을 바꿀 수 없습니다.');
  if (path === row.path) return json({ document: helpers.document(row), unchanged: true });
  const taken = await db.prepare('SELECT id FROM yebaeon_documents WHERE path=? UNION ALL SELECT id FROM yebaeon_library_catalog WHERE path=? AND path<>?').bind(path, path, row.path).first();
  if (taken) throw new HttpError(409, 'path_exists', '같은 이름의 문서가 이미 있습니다. 다른 이름을 입력해 주세요.');
  const writeId = crypto.randomUUID(), now = new Date().toISOString();
  let results;
  try {
    results = await db.batch([
      db.prepare('UPDATE yebaeon_documents SET path=?,write_id=? WHERE id=? AND current_version=? AND path=?').bind(path, writeId, id, row.current_version, row.path),
      db.prepare('UPDATE yebaeon_library_catalog SET path=?,original_path=? WHERE path=? AND EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=?)').bind(path, path, row.path, id, writeId),
      documentLog(db, { id, writeId, action: 'renamed', author: user.author, now, previous: row.path })
    ]);
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) throw new HttpError(409, 'path_exists', '같은 이름의 문서가 이미 있습니다. 다른 이름을 입력해 주세요.');
    throw error;
  }
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'version_conflict', '다른 작업자가 먼저 바꿨습니다. 새로고침 뒤 다시 바꿔 주세요.');
  let playlists = [], referencesError = null;
  try { playlists = await rewriteDocumentReferences(env, user, row.path, path); }
  catch (error) { referencesError = error?.message || '재생목록 참조를 고치지 못했습니다.'; }
  return json({ document: helpers.document({ ...row, path }), previousPath: row.path, playlists, ...(referencesError ? { referencesError } : {}) });
}
