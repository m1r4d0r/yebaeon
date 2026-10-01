import { XMLParser } from 'fast-xml-parser';
export function usageFromXML(xml) {
  const prefix = xml.replace(/^\uFEFF/, '').replace(/^\s*(?:<\?xml[^?]*\?>)?\s*/, '').replace(/^(?:<!--[\s\S]*?-->\s*)*/, '');
  const root = /^<RVPresentationDocument(?=\s|\/?>)(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(prefix)?.[0];
  if (!root) throw new Error('usage_unavailable');
  const attrs = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false }).parse(root.endsWith('/>') ? root : root + '</RVPresentationDocument>').RVPresentationDocument;
  const value = attrs?.['@_lastDateUsed'];
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}
export function usageStatement(db, id, version, value, error = null) {
  return db.prepare('INSERT OR REPLACE INTO yebaeon_document_usage(document_id, version, last_used, error) VALUES (?, ?, ?, ?)').bind(id, version, value ? new Date(value).toISOString() : null, error);
}
export async function readStoredUsage(env, id, version, key) {
  const saved = await env.DB.prepare('SELECT last_used, error FROM yebaeon_document_usage WHERE document_id = ? AND version = ?').bind(id, version).first();
  if (saved && !saved.error) return saved;
  let value = null, error = null;
  try {
    const object = await env.FILES.get(key, { range: { offset: 0, length: 65536 } });
    if (!object) throw new Error('file_unavailable');
    value = usageFromXML(await object.text());
  } catch (_) { error = 'usage_unavailable'; }
  // A read failure stays retryable. Backfill records it separately to avoid an endless loop.
  if (!error) await usageStatement(env.DB, id, version, value).run();
  return { last_used: value ? new Date(value).toISOString() : null, error };
}
export async function indexUsage(env, query) {
  const join = 'FROM yebaeon_documents d LEFT JOIN yebaeon_document_usage u ON u.document_id=d.id AND u.version=d.current_version';
  const rows = (await env.DB.prepare(`SELECT d.id, d.current_version, v.object_key ${join} JOIN yebaeon_versions v ON v.document_id=d.id AND v.version=d.current_version WHERE u.document_id IS NULL AND instr(lower(d.path),lower(?))>0 ORDER BY d.path LIMIT 12`).bind(query).all()).results;
  for (let i=0; i<rows.length; i+=4) await Promise.all(rows.slice(i,i+4).map(async row => {
    const result = await readStoredUsage(env, row.id, row.current_version, row.object_key);
    if (result.error) await usageStatement(env.DB,row.id,row.current_version,null,result.error).run();
  }));
  return env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(u.document_id IS NULL),0) AS remaining, COALESCE(SUM(u.error IS NOT NULL),0) AS failed ${join} WHERE instr(lower(d.path),lower(?))>0`).bind(query).first();
}
