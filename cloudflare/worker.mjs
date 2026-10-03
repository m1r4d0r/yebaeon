import { deviceSession, sync2Route } from './sync2.mjs';
import {dropboxRoute} from './dropbox.mjs';
import { measuredDB } from './db-cost.mjs';
import {inventoryRoute} from './inventory.mjs';
import {syncObservationsRoute} from './sync-observations.mjs';
import { bootstrapPlaylist } from './playlist-bootstrap.mjs';
import { activityRoute } from './activity.mjs';
import { recordSync, statusRoute } from './status.mjs';
import { ensureSchema } from './schema.mjs';
import { configured, requireSession, sessionRoute } from './auth.mjs';
import { playlistsRoute } from './playlists.mjs';
import { documentsRoute } from './documents.mjs';
import { indexSearch } from './document-search.mjs';
import { mediaReferencesRoute, mediaRoute } from './media-assets.mjs';
import { HttpError, headers, json, method, sameOrigin } from './http.mjs';
export default {
  async fetch(request, env) {
    let pathname, costDB;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch (_) { return json({ error: 'not_found', message: '없는 요청입니다.' }, 404); }
    const resource = pathname === '/resources' || pathname.startsWith('/resources/');
    if (!resource && pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (pathname === '/api/health') {
        method(request, ['GET', 'HEAD']);
        return request.method === 'HEAD' ? new Response(null, { headers }) : json({ ok: true, service: 'yebaeon', mode: 'document-library' });
      }
      const route = /^\/api\/documents(?:\/([^/]+)(?:\/(content|versions|usage|policy))?)?$/.exec(pathname);
      const playlist = /^\/api\/playlists(?:\/([^/]+)(?:\/(content|versions|plan|nodes|archive|restore|structure))?)?$/.exec(pathname);
      const media = /^\/api\/media(?:\/([a-f0-9]{64})(?:\/(content|protection))?)?$/.exec(pathname);
      const dropbox = /^\/api\/dropbox\/(config|list|file)$/.exec(pathname);
      const mediaReferences = pathname === '/api/media/references';
      const sync2 = /^\/api\/sync\/(devices|changes|manifest|usage|revisions)(?:\/([0-9a-f-]{32,36})(?:\/(applied|content))?)?$/.exec(pathname);
      if (pathname !== '/api/session' && pathname !== '/api/status' && pathname !== '/api/activity' && pathname !== '/api/playlist-bootstrap' && pathname !== '/api/search-index' && pathname !== '/api/sync-observations' && pathname !== '/api/inventory' && !resource && !route && !playlist && !media && !mediaReferences && !dropbox && !sync2) throw new HttpError(404, 'not_found', '없는 요청입니다.');
      if (!configured(env)) {
        if (pathname === '/api/session' && request.method === 'GET') return json({ authenticated: false, ready: false });
        throw new HttpError(503, 'setup_required', '서버의 공용 비밀번호 설정이 아직 완료되지 않았습니다.');
      }
      await ensureSchema(env.DB);
      costDB=measuredDB(env.DB,route ? `documents/${route[2]|| (route[1] ? "item" : "list")}` : playlist ? `playlists/${playlist[2]|| (playlist[1] ? "item" : "list")}` : media ? `media/${media[2]|| (media[1] ? "item" : "list")}` : resource ? "resource" : pathname);
      env={...env,DB:costDB};
      if (pathname === '/api/session') {
        const response = await sessionRoute(request, env);
        if (response.ok && request.method === 'GET' && (request.headers.get('User-Agent') || '').startsWith('YebaeOn-Sync/')) {
          const user = await requireSession(request, env).catch(() => null);
          if (user) await recordSync(request, env, user, 'connect').catch(() => {});
        }
        return response;
      }
      // 상주 Sync는 장치 열쇠(Bearer)로, 사람은 쿠키 세션으로 들어온다.
      const user = await deviceSession(request, env) || await requireSession(request, env);
      if (sync2) return await sync2Route(request, env, user, sync2[1], sync2[2], sync2[3]);
      if(dropbox)return await dropboxRoute(request,env,dropbox[1]);
      if(pathname==='/api/inventory')return await inventoryRoute(request,env,user);
      if(pathname==='/api/sync-observations')return await syncObservationsRoute(request,env,user);
      if(pathname==='/api/search-index'){method(request,['POST']);sameOrigin(request);return json(await indexSearch(env,8,new URL(request.url).searchParams.get('after')||''));}
      if (pathname === '/api/playlist-bootstrap') return await bootstrapPlaylist(request, env, user);
      if (resource) {
        method(request, ['GET', 'HEAD']);
        const response = await env.ASSETS.fetch(request);
        const secured = new Response(response.body, response);
        secured.headers.set('Cache-Control', 'private, no-store');
        return secured;
      }
      if (pathname === '/api/activity') return await activityRoute(request, env, user);
      if (pathname === '/api/status') return await statusRoute(request, env);
      if (mediaReferences) return await mediaReferencesRoute(request,env,user);
      if (media) return await mediaRoute(request,env,user,media[1],media[2]);
      if (route && !route[1] && request.method === 'GET' && !new URL(request.url).searchParams.has('after')) await recordSync(request, env, user, 'compare').catch(() => {});
      if (playlist) return await playlistsRoute(request, env, user, playlist[1], playlist[2]);
      return await documentsRoute(request, env, user, route[1], route[2]);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status, error.headers);
      console.error('YebaeOn API operation failed:', error?.name || 'Error');
      return json({ error: 'server_error', message: '서버 작업을 완료하지 못했습니다. 내 편집 내용을 보관하고 다시 시도해 주세요.' }, 503);
    } finally { costDB?.report(); }
  }
};


