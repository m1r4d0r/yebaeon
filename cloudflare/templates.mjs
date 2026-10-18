import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
// 사이트에서 저장한 템플릿: PP6 템플릿 그룹 이름(group_name) 아래 슬라이드(RVDisplaySlide XML)를 순서(position)대로 둔다.
// 입장한 모두가 같은 목록을 보고 고친다. 표는 Worker 실행 단위마다 처음 쓸 때 한 번 만든다(스키마 버전과 무관한 추가 표).
let ready = false;
const MAX_TEMPLATES = 1000, MAX_ITEMS = 50, MAX_XML = 500000, MAX_BODY = 5000000;
async function table(db) {
  if (ready) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_templates (id TEXT PRIMARY KEY, group_name TEXT NOT NULL, label TEXT NOT NULL, position INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, format TEXT NOT NULL, xml TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_templates_group ON yebaeon_templates(group_name, position)').run();
  ready = true;
}
const LIST = 'SELECT id,group_name AS "group",label,position,width,height,format,updated_by AS updatedBy,updated_at AS updatedAt FROM yebaeon_templates';
const invalid = message => new HttpError(400, 'invalid_template', message);
// 그룹 이름은 교회 Mac의 템플릿 파일 이름이 되므로 경로 문자와 숨김 파일 이름을 받지 않는다.
function groupName(value) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f/:\\]/.test(name) || name.startsWith('.')) throw invalid('템플릿 그룹 이름을 확인해 주세요. (60자 이내, / : 제외)');
  return name;
}
function labelName(value) {
  const label = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (label.length > 100 || /[\u0000-\u001f\u007f]/.test(label)) throw invalid('템플릿 이름을 확인해 주세요. (100자 이내)');
  return label;
}
function slide(item) {
  const { width, height, format, xml } = item || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 10000 || height > 10000) throw invalid('템플릿 크기를 확인해 주세요.');
  if (typeof format !== 'string' || !/^[a-f0-9]{64}$/.test(format)) throw invalid('템플릿 서식 값을 확인해 주세요.');
  const body = typeof xml === 'string' ? xml.trim() : '';
  if (!body || body.length > MAX_XML || !body.startsWith('<RVDisplaySlide') || !body.endsWith('</RVDisplaySlide>')) throw invalid('템플릿 슬라이드 원본을 확인해 주세요.');
  return { label: labelName(item.label), width, height, format, xml: body };
}
async function one(db, id) {
  const row = await db.prepare(LIST + ' WHERE id=?').bind(id).first();
  if (!row) throw new HttpError(404, 'template_not_found', '템플릿을 찾지 못했습니다. 다른 곳에서 지웠을 수 있습니다.');
  return row;
}
export async function templatesRoute(request, env, user, id) {
  await table(env.DB);
  const db = env.DB, now = new Date().toISOString();
  if (id) {
    method(request, ['GET', 'PATCH', 'DELETE']);
    if (request.method === 'GET') {
      const row = await db.prepare(LIST.replace(' FROM', ',xml FROM') + ' WHERE id=?').bind(id).first();
      if (!row) throw new HttpError(404, 'template_not_found', '템플릿을 찾지 못했습니다. 다른 곳에서 지웠을 수 있습니다.');
      return json({ template: row });
    }
    sameOrigin(request);
    if (request.method === 'DELETE') {
      await one(db, id);
      await db.prepare('DELETE FROM yebaeon_templates WHERE id=?').bind(id).run();
      return json({ id, deleted: true });
    }
    const body = await bodyJSON(request) || {};
    await one(db, id);
    await db.prepare('UPDATE yebaeon_templates SET label=?,updated_by=?,updated_at=? WHERE id=?').bind(labelName(body.label), user.author, now, id).run();
    return json({ template: await one(db, id) });
  }
  method(request, ['GET', 'POST', 'PATCH', 'DELETE']);
  if (request.method === 'GET') return json({ templates: (await db.prepare(LIST + ' ORDER BY group_name, position LIMIT ' + MAX_TEMPLATES).all()).results });
  sameOrigin(request);
  if (request.method === 'DELETE') {
    const group = groupName(new URL(request.url).searchParams.get('group'));
    const result = await db.prepare('DELETE FROM yebaeon_templates WHERE group_name=?').bind(group).run();
    return json({ group, deleted: result.meta?.changes ?? 0 });
  }
  const body = await bodyJSON(request, request.method === 'POST' ? MAX_BODY : 4096) || {};
  const group = groupName(body.group);
  if (request.method === 'PATCH') {
    const target = groupName(body.rename);
    if (target === group) return json({ group });
    const taken = await db.prepare('SELECT 1 FROM yebaeon_templates WHERE group_name=? LIMIT 1').bind(target).first();
    if (taken) throw new HttpError(409, 'template_group_exists', '같은 이름의 템플릿 그룹이 이미 있습니다.');
    await db.prepare('UPDATE yebaeon_templates SET group_name=?,updated_by=?,updated_at=? WHERE group_name=?').bind(target, user.author, now, group).run();
    return json({ group: target });
  }
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_ITEMS) throw invalid(`한 번에 1~${MAX_ITEMS}장을 저장할 수 있습니다.`);
  const items = body.items.map(slide);
  const counts = await db.prepare('SELECT COUNT(*) AS total, MAX(CASE WHEN group_name=? THEN position END) AS last FROM yebaeon_templates').bind(group).first();
  if (counts.total + items.length > MAX_TEMPLATES) throw new HttpError(409, 'template_limit', `사이트 템플릿은 ${MAX_TEMPLATES}장까지 저장할 수 있습니다. 쓰지 않는 것을 지워 주세요.`);
  const start = counts.last == null ? 0 : counts.last + 1, ids = items.map(() => crypto.randomUUID());
  await db.batch(items.map((item, i) => db.prepare('INSERT INTO yebaeon_templates(id,group_name,label,position,width,height,format,xml,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(ids[i], group, item.label, start + i, item.width, item.height, item.format, item.xml, user.author, now, user.author, now)));
  return json({ templates: (await db.prepare(LIST + ' WHERE group_name=? ORDER BY position').bind(group).all()).results }, 201);
}
