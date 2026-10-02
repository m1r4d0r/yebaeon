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
    updated_at AS updatedAt, size FROM yebaeon_documents ORDER BY updated_at DESC, path LIMIT 12`);
  const sync = await query('sync',`SELECT author, connected_at AS connectedAt, compared_at AS comparedAt
    FROM yebaeon_sync_status ORDER BY COALESCE(compared_at, connected_at) DESC LIMIT 10`);
  let storage;
  if(detailed){
    const documentHistory=await query('document-history',`SELECT COUNT(*) AS count, COALESCE(SUM(v.size),0) AS bytes FROM yebaeon_versions v JOIN yebaeon_documents d ON d.id=v.document_id WHERE v.version<>d.current_version`,true);
    const playlistHistory=await query('playlist-history',`SELECT COUNT(*) AS count, COALESCE(SUM(v.size),0) AS bytes FROM yebaeon_playlist_versions v JOIN yebaeon_playlists p ON p.id=v.library_id WHERE v.version<>p.current_version`,true);
    storage={currentDocuments:{count:totals.documents,bytes:totals.bytes},currentPlaylists:playlists,documentHistory,playlistHistory,trackedBytes:totals.bytes+playlists.bytes+documentHistory.bytes+playlistHistory.bytes};
  }
  console.log(JSON.stringify({event:'d1-read-cost',route:detailed?'status-details':'status',queries:costs}));
  return json({ ...totals,...catalog,playlists:playlists.count,...(storage?{storage}:{}),recent,sync,observedAt:new Date().toISOString() });
}
