import { documentAttributes } from './document-usage.mjs';

// Only explicitly approved PP6 categories are authoritative. Legacy names and
// pending documents keep their existing independent search/history settings.
const policies = new Map([
  ['가사찬양', [true, false]], ['악보찬양', [true, false]],
  ['예배순서', [true, true]], ['특별순서', [true, true]],
  ['옛날자료', [false, false]]
]);
export function categoryPolicy(category) {
  const flags = policies.get(category);
  return flags ? { searchEnabled: flags[0], historyEnabled: flags[1] } : null;
}
export function categoryFromXML(xml) {
  const value = documentAttributes(xml)?.['@_category'];
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}
export function categoryMetadata(category, previous = null, version = 1) {
  const policy = categoryPolicy(category);
  const search = policy ? +policy.searchEnabled : +(previous?.search_enabled !== 0);
  const history = policy ? +policy.historyEnabled : +(previous?.history_enabled !== 0);
  const changed = previous && (previous.category !== category || previous.search_enabled !== search || previous.history_enabled !== history);
  return {
    category, search_enabled: search, history_enabled: history,
    history_start: history ? null : previous?.history_enabled === 0 ? previous.history_start : version,
    policy_revision: (previous?.policy_revision || 0) + (changed ? 1 : 0)
  };
}
// Compare calendar dates in the church's timezone. The anniversary day remains
// visible; a missing/unreadable/current-version-mismatched usage date never hides.
export function oldMaterialCutoff(now = new Date()) {
  const korea = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = korea.getUTCFullYear() - 2, month = korea.getUTCMonth();
  const day = Math.min(korea.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day) - 9 * 60 * 60 * 1000).toISOString();
}
export const generalSearchVisibility = "COALESCE(d.category='옛날자료' AND d.usage_version=d.current_version AND d.usage_error IS NULL AND d.last_used < ?, 0)=0";
