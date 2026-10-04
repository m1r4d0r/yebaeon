import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {observationState,linkedObservation} from '../cloudflare/sync-observations.mjs';
const xml='<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children"><RVPlaylistNode UUID="A" displayName="금요예배"><array rvXMLIvarName="children"><RVHeaderCue UUID="a" displayName="기도"/><RVHeaderCue UUID="b" displayName="찬양"/></array></RVPlaylistNode><RVPlaylistNode UUID="B" displayName="1부예배"><array rvXMLIvarName="children"><RVHeaderCue UUID="c" displayName="기도"/><RVHeaderCue UUID="d" displayName="찬양"/></array></RVPlaylistNode></array></RVPlaylistNode></RVPlaylistDocument>';
test('independent playlist CAS, scoped versions, restore and last observed sync state',{timeout:90000},async t=>{
 const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'node-test'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 const origin='https://example.test';let cookie='';const call=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',...headers}});
 // Read each body exactly once. clone() threw "Body has already been consumed" on a slow CI Mac and hid the real status.
 const ok=async r=>{const text=await r.text();assert.equal(r.status,200,`${r.status} ${text}`);return JSON.parse(text);};
 const login=await call('/session','POST',JSON.stringify({name:'시험',password:'node-test'}));await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
 const registered=await call('/playlists?path=fixture.pro6pl','POST',xml);assert.equal(registered.status,201);const id=(await registered.json()).library.id;
 const plan=node=>call(`/playlists/${id}/plan?node=${node}`).then(ok);const a=await plan('A'),b=await plan('B');
 const patch=(node,p,items)=>call(`/playlists/${id}?node=${node}`,'PATCH',JSON.stringify({baseNodeHash:p.playlist.sha256,items}),{'If-Match':`"${p.library.version}"`});
 await Promise.all([patch('A',a,[{id:'b'},{id:'a'}]).then(ok),patch('B',b,[{id:'d'},{id:'c'}]).then(ok)]);
 const aa=await plan('A'),bb=await plan('B');assert.deepEqual(aa.items.map(x=>x.id),['b','a']);assert.deepEqual(bb.items.map(x=>x.id),['d','c']);assert.equal(aa.playlist.version,2);assert.equal(bb.playlist.version,2);
 assert.equal((await patch('A',a,[{id:'a'}])).status,409);
 const race=await Promise.all([patch('A',aa,[{id:'a'}]),patch('A',aa,[{id:'b'}])].map(p=>p.then(async r=>{await r.text();return r.status;})));assert.deepEqual(race.sort(),[200,409]);
 const ah=await ok(await call(`/playlists/${id}/versions?node=A`)),bh=await ok(await call(`/playlists/${id}/versions?node=B`));assert.deepEqual(ah.versions.map(v=>v.version),[3,2,1]);assert.deepEqual(bh.versions.map(v=>v.version),[2,1]);
 const current=await plan('A');await ok(await call(`/playlists/${id}?node=A`,'PATCH',JSON.stringify({baseNodeHash:current.playlist.sha256,restoreVersion:1}),{'If-Match':`"${current.library.version}"`}));assert.deepEqual((await plan('A')).items.map(x=>x.id),['a','b']);assert.deepEqual((await plan('B')).items.map(x=>x.id),['d','c']);
 const exported=await(await call(`/playlists/${id}/content?node=B&nodeVersion=1`)).text();assert.ok(exported.includes('UUID="c"'));assert.equal((await plan('B')).playlist.version,2);
 const fresh=await plan('A'),device='a'.repeat(64);const report=status=>call('/sync-observations','POST',JSON.stringify({deviceId:device,items:[{kind:'playlist',id,node:'A',serverHash:fresh.playlist.sha256,status}]}));
 assert.equal((await ok(await call('/sync-observations?'+new URLSearchParams({targets:JSON.stringify([{kind:'playlist',id,node:'A'}])})))).items['playlist/'+id+'/A'],undefined);await ok(await report('same'));assert.equal((await ok(await call('/sync-observations?'+new URLSearchParams({targets:JSON.stringify([{kind:'playlist',id,node:'A'}])})))).items['playlist/'+id+'/A'].deviceId,device);assert.equal((await ok(await call('/sync-observations?'+new URLSearchParams({targets:JSON.stringify([{kind:'playlist',id,node:'A'}])})))).items['playlist/'+id+'/A'].state,'synced');
 await ok(await patch('A',fresh,[{id:'b'}]));assert.equal((await ok(await call('/sync-observations?'+new URLSearchParams({targets:JSON.stringify([{kind:'playlist',id,node:'A'}])})))).items['playlist/'+id+'/A'].state,'pending');await ok(await report('upload'));assert.equal((await ok(await call('/sync-observations?'+new URLSearchParams({targets:JSON.stringify([{kind:'playlist',id,node:'A'}])})))).items['playlist/'+id+'/A'].state,'conflict');
 assert.equal((await call('/sync-observations','POST',JSON.stringify({deviceId:device,items:[]}),{Origin:'https://elsewhere.test'})).status,403);
 assert.equal(observationState({status:'same',server_hash:'old'},'new'),'pending');assert.equal(observationState({status:'upload',server_hash:'old'},'new'),'conflict');
});


test('A matching order never hides missing or unknown linked-document observations',()=>{
 const own={state:'synced',observedAt:'2026-10-02',deviceId:'device'};
 assert.equal(linkedObservation(own,['missing'],{}).state,'unknown');
 assert.equal(linkedObservation(own,['unknown','same'],{unknown:{state:'unknown'},same:{state:'synced'}}).state,'unknown');
 assert.equal(linkedObservation({state:'unknown'},['same'],{same:{state:'synced'}}).state,'unknown');
 const changed=linkedObservation(own,['changed'],{changed:{state:'pending',deviceId:'other',observedAt:'later'}});assert.equal(changed.state,'pending');assert.equal(changed.reason,'연결 문서 상태 반영');assert.equal(changed.deviceId,'other');
 assert.equal(linkedObservation({state:'conflict'},['missing'],{}).state,'conflict');
});

