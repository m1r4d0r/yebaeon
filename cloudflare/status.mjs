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
  const totals = await env.DB.prepare(`SELECT COUNT(*) AS documents, COALESCE(SUM(size),0) AS bytes,
    MAX(updated_at) AS latestUploadAt FROM yebaeon_documents`).first();
  const playlists = await env.DB.prepare('SELECT COUNT(*) AS count FROM yebaeon_playlists').first();
  const recent = (await env.DB.prepare(`SELECT id, path, current_version AS version, updated_by AS author,
    updated_at AS updatedAt, size FROM yebaeon_documents ORDER BY updated_at DESC, path LIMIT 12`).all()).results;
  const workers = (await env.DB.prepare(`SELECT updated_by AS author, COUNT(*) AS documents,
    MAX(updated_at) AS latestUploadAt FROM yebaeon_documents GROUP BY updated_by ORDER BY latestUploadAt DESC`).all()).results;
  const sync = (await env.DB.prepare(`SELECT author, connected_at AS connectedAt, compared_at AS comparedAt
    FROM yebaeon_sync_status ORDER BY COALESCE(compared_at, connected_at) DESC LIMIT 10`).all()).results;
  return json({ ...totals, playlists: playlists.count, recent, workers, sync, observedAt: new Date().toISOString() });
}
