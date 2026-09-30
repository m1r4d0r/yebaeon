import { ensureSchema } from './schema.mjs';
import { configured, requireSession, sessionRoute } from './auth.mjs';
import { documentsRoute } from './documents.mjs';
import { HttpError, headers, json, method } from './http.mjs';
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (pathname === '/api/health') {
        method(request, ['GET', 'HEAD']);
        return request.method === 'HEAD' ? new Response(null, { headers }) : json({ ok: true, service: 'yebaeon', mode: 'document-library' });
      }
      const route = /^\/api\/documents(?:\/([^/]+)(?:\/(content|versions))?)?$/.exec(pathname);
      if (pathname !== '/api/session' && !route) throw new HttpError(404, 'not_found', '없는 요청입니다.');
      if (!configured(env)) {
        if (pathname === '/api/session' && request.method === 'GET') return json({ authenticated: false, ready: false });
        throw new HttpError(503, 'setup_required', '서버의 공용 비밀번호 설정이 아직 완료되지 않았습니다.');
      }
      await ensureSchema(env.DB);
      if (pathname === '/api/session') return await sessionRoute(request, env);
      return await documentsRoute(request, env, await requireSession(request, env), route[1], route[2]);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.code, message: error.message }, error.status, error.headers);
      console.error('YebaeOn API operation failed:', error?.name || 'Error');
      return json({ error: 'server_error', message: '서버 작업을 완료하지 못했습니다. 내 편집 내용을 보관하고 다시 시도해 주세요.' }, 503);
    }
  }
};
