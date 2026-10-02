import { bytes, headers, HttpError, method, sameOrigin } from './http.mjs';
import { playlistsRoute } from './playlists.mjs';

// Initial data repair only; Studio has no registration control.
export async function bootstrapPlaylist(request, env, user) {
  method(request, ['GET', 'POST']);
  if (request.method === 'POST') sameOrigin(request);
  const existing = await env.DB.prepare('SELECT id FROM yebaeon_playlists LIMIT 1').first();
  if (existing) throw new HttpError(409, 'already_initialized', '서버 재생목록이 이미 있습니다. 기존 원본은 변경하지 않았습니다.');
  if (request.method === 'GET') return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>예배온 초기 자료 복구</title><h1>기본 재생목록 최초 등록</h1><p>서버 목록이 비어 있을 때만 원본을 등록합니다. 이후 갱신은 Sync가 담당합니다.</p><form action="/api/playlist-bootstrap" method="post" enctype="multipart/form-data"><label>서버 원본 이름 <input name="path" value="기본 .pro6pl" required></label><label>제공한 원본 <input name="file" type="file" accept=".pro6pl" required></label><button>원본 등록</button></form></html>`, {headers:{...headers,'Referrer-Policy':'same-origin','Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'"}});
  const data = await bytes(request, 5 * 1024 * 1024 + 65536);
  let form;
  try { form = await new Response(data, {headers:{'Content-Type':request.headers.get('Content-Type') || ''}}).formData(); }
  catch { throw new HttpError(400,'invalid_form','원본 파일을 선택해 주세요.'); }
  const file = form.get('file'), path = form.get('path');
  if (!file || typeof file.arrayBuffer !== 'function' || typeof path !== 'string') throw new HttpError(400,'invalid_form','원본 파일과 이름이 필요합니다.');
  const url = new URL('/api/playlists', request.url); url.searchParams.set('path',path);
  const h = new Headers(request.headers); h.set('Content-Type','application/xml'); h.delete('Content-Length');
  const result = await playlistsRoute(new Request(url,{method:'POST',headers:h,body:await file.arrayBuffer()}),env,user);
  if (!result.ok) return result;
  return new Response(null,{status:303,headers:{...headers,Location:'/'}});
}
