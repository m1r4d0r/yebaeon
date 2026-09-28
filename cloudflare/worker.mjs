// The initial deployment serves the editor and a health check only.
// Library/authentication APIs must be added before accessing DB or FILES.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      };
      if (pathname !== '/api/health') {
        return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'not_found' }), { status: 404, headers });
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405, headers: { ...headers, Allow: 'GET, HEAD' }
        });
      }
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({
        ok: true, service: 'yebaeon', mode: 'local-editor'
      }), { headers });
    }
    return env.ASSETS.fetch(request);
  }
};
