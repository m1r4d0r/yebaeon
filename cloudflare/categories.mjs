import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
import { refreshCategories } from './document-category.mjs';
import { requireAdmin } from './admin.mjs';

// 카테고리 정책표. 추가는 누구나, 기존 카테고리의 검색·이력 설정 변경은 관리자만.
// 설정을 바꾸면 그 카테고리 문서는 다음 저장 때 새 설정을 따른다(전체 일괄 갱신은 하지 않는다).
const NAME = /^[^\x00-\x1f\x7f/\\]{1,40}$/;
function view(r) { return { name: r.name, searchEnabled: !!r.search_enabled, historyEnabled: !!r.history_enabled, createdBy: r.created_by, updatedAt: r.updated_at || null, updatedBy: r.updated_by || null }; }
export async function categoriesRoute(request, env, user, name) {
  const db = env.DB;
  if (name) {
    method(request, ['PUT']); sameOrigin(request); await requireAdmin(request, env, user);
    const body = await bodyJSON(request);
    if (typeof body?.searchEnabled !== 'boolean' || typeof body?.historyEnabled !== 'boolean') throw new HttpError(400, 'invalid_category', '검색·이력 설정을 확인해 주세요.');
    const result = await db.prepare('UPDATE yebaeon_categories SET search_enabled=?,history_enabled=?,updated_at=?,updated_by=? WHERE name=?').bind(+body.searchEnabled, +body.historyEnabled, new Date().toISOString(), user.author, name).run();
    if (!result.meta.changes) throw new HttpError(404, 'not_found', '카테고리를 찾지 못했습니다.');
    await refreshCategories(db, true);
    return json({ category: view(await db.prepare('SELECT * FROM yebaeon_categories WHERE name=?').bind(name).first()) });
  }
  method(request, ['GET', 'POST']);
  if (request.method === 'GET') return json({ categories: (await db.prepare('SELECT * FROM yebaeon_categories ORDER BY created_at,rowid').all()).results.map(view) });
  sameOrigin(request);
  const body = await bodyJSON(request), clean = typeof body?.name === 'string' ? body.name.normalize('NFC').trim() : '';
  if (!NAME.test(clean)) throw new HttpError(400, 'invalid_category', '카테고리 이름은 1~40자로 입력해 주세요.');
  const search = body.searchEnabled !== false, history = body.historyEnabled !== false;
  const result = await db.prepare('INSERT OR IGNORE INTO yebaeon_categories(name,search_enabled,history_enabled,created_at,created_by) VALUES (?,?,?,?,?)').bind(clean, +search, +history, new Date().toISOString(), user.author).run();
  if (!result.meta.changes) throw new HttpError(409, 'category_exists', '이미 있는 카테고리입니다.');
  await refreshCategories(db, true);
  return json({ category: view(await db.prepare('SELECT * FROM yebaeon_categories WHERE name=?').bind(clean).first()) }, 201);
}
