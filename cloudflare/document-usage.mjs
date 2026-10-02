import { XMLParser } from 'fast-xml-parser';
export function documentAttributes(xml) {
  const prefix = xml.replace(/^\uFEFF/, '').replace(/^\s*(?:<\?xml[^?]*\?>)?\s*/, '').replace(/^(?:<!--[\s\S]*?-->\s*)*/, '');
  const root = /^<RVPresentationDocument(?=\s|\/?>)(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(prefix)?.[0];
  if (!root) throw new Error('usage_unavailable');
  return new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, htmlEntities: true }).parse(root.endsWith('/>') ? root : root + '</RVPresentationDocument>').RVPresentationDocument;
}
export function usageFromXML(xml) {
  const attrs = documentAttributes(xml);
  const value = attrs?.['@_lastDateUsed'];
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
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
  if (!error) await env.DB.prepare('UPDATE yebaeon_documents SET last_used=?,usage_error=NULL,usage_version=? WHERE id=? AND current_version=?').bind(value?new Date(value).toISOString():null,version,id,version).run();
  return { last_used: value ? new Date(value).toISOString() : null, error };
}
