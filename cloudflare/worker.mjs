import { recordSync, statusRoute } from './status.mjs';
import { ensureSchema } from './schema.mjs';
import { configured, requireSession, sessionRoute } from './auth.mjs';
import { playlistsRoute } from './playlists.mjs';
import { documentsRoute } from './documents.mjs';
import { HttpError, headers, json, method } from './http.mjs';
export default {
  async fetch(request, env) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch (_) { return json({ error: 'not_found', message: '없는 요청입니다.' }, 404); }
    const resource = pathname === '/resources' || pathname.startsWith('/resources/');
    if (!resource && pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (pathname === '/api/health') {
        method(request, ['GET', 'HEAD']);
        return request.method === 'HEAD' ? new Response(null, { headers }) : json({ ok: true, service: 'yebaeon', mode: 'document-library' });
      }
      const route = /^\/api\/documents(?:\/([^/]+)(?:\/(content|versions))?)?$/.exec(pathname);
      const playlist = /^\/api\/playlists(?:\/([^/]+)(?:\/(content|versions|plan))?)?$/.exec(pathname);
      if (pathname !== '/api/session' && pathname !== '/api/status' && !resource && !route && !playlist) throw new HttpError(404, 'not_found', '없는 요청입니다.');
      if (!configured(env)) {
        if (pathname === '/api/session' && request.method === 'GET') return json({ authenticated: false, ready: false });
        throw new HttpError(503, 'setup_required', '서버의 공용 비밀번호 설정이 아직 완료되지 않았습니다.');
      }
      await ensureSchema(env.DB);
      if (pathname === '/api/session') {
        const response = await sessionRoute(request, env);
        if (response.ok && request.method === 'GET' && (request.headers.get('User-Agent') || '').startsWith('YebaeOn-Sync/')) {
          const user = await requireSession(request, env).catch(() => null);
          if (user) await recordSync(request, env, user, 'connect').catch(() => {});
        }
        return response;
      }
      const user = await requireSession(request, env);
      if (resource) {
        method(request, ['GET', 'HEAD']);
        const response = await env.ASSETS.fetch(request);
        const secured = new Response(response.body, response);
        secured.headers.set('Cache-Control', 'private, no-store');
        return secured;
      }
      if (pathname === '/api/status') return statusRoute(request, env);
      if (route && !route[1] && request.method === 'GET' && !new URL(request.url).searchParams.has('after')) await recordSync(request, env, user, 'compare').catch(() => {});
      if (playlist) return await playlistsRoute(request, env, user, playlist[1], playlist[2]);
      return await documentsRoute(request, env, user, route[1], route[2]);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status, error.headers);
      console.error('YebaeOn API operation failed:', error?.name || 'Error');
      return json({ error: 'server_error', message: '서버 작업을 완료하지 못했습니다. 내 편집 내용을 보관하고 다시 시도해 주세요.' }, 503);
    }
  }
};
