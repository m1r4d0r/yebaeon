import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRs0AAAAASUVORK5CYII=','base64');
const hash=value=>createHash('sha256').update(value).digest('hex');
const ROOT='/Users/Shared/Renewed Vision Media/';
test('media library: folder listing without ImportedImages, cacheable bytes, shared favorites, status image totals',{timeout:90000},async t=>{
  const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'media-test'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
  t.after(()=>mf.dispose());
  const origin='https://example.test';let cookie='';
  const call=(path,method='GET',body,extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,...method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'},...extra}});
  const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  const login=await call('/session','POST',JSON.stringify({name:'시험',password:'media-test'}));await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
  const a=png,b=Buffer.concat([png,Buffer.from([0])]);
  for(const bytes of [a,b])assert.ok([200,201].includes((await call('/media/'+hash(bytes)+'/content','PUT',bytes,{'Content-Type':'application/octet-stream','X-Yebaeon-SHA256':hash(bytes)})).status));
  const items=[['Images/배경 하늘.png',a],['Images/광고 가을.png',b],['ImportedImages/X/Slide01.jpg',a],['YebaeOn/설교-1.png',b]].map(([p,bytes])=>({path:ROOT+p,sha256:hash(bytes),size:bytes.length}));
  await ok(await call('/media/paths','PUT',JSON.stringify({items})));
  const images=await ok(await call('/media/paths?folder=Images'));
  assert.deepEqual(images.paths.map(p=>p.path),[ROOT+'Images/광고 가을.png',ROOT+'Images/배경 하늘.png']);assert.equal(images.next,null);
  assert.deepEqual((await ok(await call('/media/paths?folder=Images&q='+encodeURIComponent('하늘')))).paths.map(p=>p.path),[ROOT+'Images/배경 하늘.png']);
  assert.deepEqual((await ok(await call('/media/paths?folder=Images&q=%25'))).paths,[],'a literal % does not match everything');
  assert.deepEqual((await ok(await call('/media/paths?folder=YebaeOn'))).paths.map(p=>p.path),[ROOT+'YebaeOn/설교-1.png']);
  assert.equal((await call('/media/paths?folder=ImportedImages')).status,400,'imported slide images are not listed');
  assert.equal((await call('/media/paths?folder=Images&after='+encodeURIComponent(ROOT+'YebaeOn/'))).status,400,'the cursor stays inside the folder');
  const bytes=await call('/media/'+hash(a)+'/content');assert.match(bytes.headers.get('Cache-Control'),/private, max-age=31536000, immutable/);
  assert.deepEqual((await ok(await call('/favorites'))).items,[]);
  await ok(await call('/favorites','PUT',JSON.stringify({kind:'media',key:hash(a),label:'배경 하늘.png',on:true})));
  await ok(await call('/favorites','PUT',JSON.stringify({kind:'template',key:'104',label:'성경 · 본문',on:true})));
  assert.equal((await call('/favorites','PUT',JSON.stringify({kind:'media',key:'not-a-sha',on:true}))).status,400);
  assert.equal((await call('/favorites','PUT',JSON.stringify({kind:'media',key:hash(a),on:true}),{Origin:'https://other.test'})).status,403);
  let favorites=(await ok(await call('/favorites'))).items;assert.deepEqual(favorites.map(f=>[f.kind,f.key,f.addedBy]).sort(),[['media',hash(a),'시험'],['template','104','시험']]);
  await ok(await call('/favorites','PUT',JSON.stringify({kind:'template',key:'104',on:false})));
  favorites=(await ok(await call('/favorites'))).items;assert.deepEqual(favorites.map(f=>f.kind),['media']);
  // 미리보기: 원본이 있을 때만 받는다(R2만), 있는지 묻기, 캐시 허용, PNG/JPEG/WebP만.
  assert.equal((await call('/media/'+hash(a)+'/thumbnail')).status,404);
  assert.deepEqual((await ok(await call('/media?thumbnails=1&hash='+hash(a)+'&hash='+hash(b)))).thumbnails,[]);
  await ok(await call('/media/'+hash(a)+'/thumbnail','PUT',png,{'Content-Type':'image/png'}));
  assert.equal((await call('/media/'+'c'.repeat(64)+'/thumbnail','PUT',png,{'Content-Type':'image/png'})).status,404,'no thumbnail without an original');
  assert.equal((await call('/media/'+hash(b)+'/thumbnail','PUT',Buffer.from('not an image'),{'Content-Type':'image/png'})).status,415);
  assert.equal((await call('/media/'+hash(b)+'/thumbnail','PUT',png,{'Content-Type':'image/png',Origin:'https://other.test'})).status,403);
  const thumb=await call('/media/'+hash(a)+'/thumbnail');assert.equal(thumb.status,200);assert.match(thumb.headers.get('Cache-Control'),/immutable/);assert.deepEqual(Buffer.from(await thumb.arrayBuffer()),png);
  assert.deepEqual((await ok(await call('/media?thumbnails=1&hash='+hash(a)+'&hash='+hash(b)))).thumbnails,[hash(a)]);
  // 그림 추가는 원본 확장자 그대로 경로를 받는다.
  const jpg=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4]);await ok(await call('/media/'+hash(jpg)+'/content','PUT',jpg,{'Content-Type':'image/jpeg','X-Yebaeon-SHA256':hash(jpg)}),201);
  const allocated=await ok(await call('/media/paths','POST',JSON.stringify({name:'가을 배경',ext:'jpeg',items:[{sha256:hash(jpg)}]})));assert.deepEqual(allocated.paths.map(p=>p.path),[ROOT+'YebaeOn/가을 배경-1.jpg']);
  assert.equal((await call('/media/paths','POST',JSON.stringify({name:'x',ext:'exe',items:[{sha256:hash(jpg)}]}))).status,400);
  const status=await ok(await call('/status?details=1'));
  assert.deepEqual(status.storage.images,{count:3,bytes:a.length+b.length+8});
  assert.deepEqual(status.storage.imageFolders.map(f=>[f.folder,f.count]),[['Images',2],['ImportedImages',1],['YebaeOn',2]]);
  // Local D1 dates deliberately differ from filename order; equal dates cross a page boundary.
  const db=await mf.getD1Database('DB');
  await db.prepare("UPDATE yebaeon_media_paths SET updated_at='2026-01-01T00:00:00Z'").run();
  const recent=Array.from({length:65},(_,i)=>({path:ROOT+'Images/recent-'+String(i).padStart(2,'0')+'.png',date:i<62?'2026-10-09T00:00:00Z':'2026-10-10T00:00:00Z'}));
  await db.batch(recent.map(x=>db.prepare("INSERT INTO yebaeon_media_paths(path,sha256,size,state,updated_at,updated_by) VALUES(?,?,?,'active',?,'test')").bind(x.path,hash(a),a.length,x.date)));
  const first=await ok(await call('/media/paths?folder=Images&sort=updated'));
  const second=await ok(await call('/media/paths?folder=Images&sort=updated&after='+encodeURIComponent(first.next)));
  assert.equal(first.paths.length,60);assert.equal(second.next,null);
  const expected=[...recent.slice(62),...recent.slice(0,62)].map(x=>x.path);
  assert.deepEqual([...first.paths,...second.paths].map(x=>x.path),[...expected,...images.paths.map(x=>x.path)]);
  assert.deepEqual((await ok(await call('/media/paths?folder=Images&sort=updated&q=recent-64'))).paths.map(x=>x.path),[recent[64].path]);
  assert.equal((await call('/media/paths?folder=YebaeOn&sort=updated&after='+encodeURIComponent(first.next))).status,400);
  assert.equal((await call('/media/paths?folder=Images&sort=updated&after=invalid')).status,400);

});
