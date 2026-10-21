import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const xml='<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children"><RVPlaylistNode UUID="A" displayName="연례 행사"><array rvXMLIvarName="children"><RVDocumentCue UUID="cue" displayName="찬양" filePath="~/Documents/ProPresenter6/song.pro6"/></array></RVPlaylistNode><RVPlaylistNode UUID="B" displayName="주일"><array rvXMLIvarName="children"/></RVPlaylistNode></array></RVPlaylistNode></RVPlaylistDocument>';
test('playlist create, archive snapshot, restoration and stale Sync protection', {timeout:90000},async t=>{
 const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'archives-only'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 const origin='https://example.test';let cookie='';
 const call=(path,method='GET',body,extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,...method==='GET'?{}:{Origin:origin},'Content-Type':'application/json',...extra}});
 const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 assert.equal((await call('/playlists?scope=archived')).status,401);
 const login=await call('/session','POST',JSON.stringify({name:'시험',password:'archives-only'}));await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
 let lib=(await ok(await call('/playlists?path=fixture.pro6pl','POST',xml),201)).library;
 const path='/playlists/'+lib.id,tag=()=>({'If-Match':`"${lib.version}"`,'X-YebaeOn-Sync':'2'});
 // Whole-file PUT without the Sync 2 header is refused before any structure check (older Sync builds).
 const legacy=await call(path,'PUT',xml,{'If-Match':`"${lib.version}"`});
 assert.equal(legacy.status,426);assert.equal((await legacy.json()).error,'sync_upgrade_required');
 // Imported nodes have no controls rows. An old client with a current CAS
 // must still not remove them by omitting them from its whole-file upload.
 const imported=await(await call(path+'/content')).text();
 const omitted=imported.replace(/<RVPlaylistNode UUID="B"[\s\S]*?<\/RVPlaylistNode>/,'');
 const rejected=await call(path,'PUT',omitted,tag());
 assert.equal(rejected.status,409);assert.equal((await rejected.json()).error,'playlist_structure_changed');
 assert.equal(await(await call(path+'/content')).text(),imported,'rejected omission leaves the file untouched');
 assert.equal((await ok(await call(path))).library.version,lib.version,'rejected omission creates no version');
 const original='<RVPresentationDocument category="가사찬양"><text>original song</text></RVPresentationDocument>';
 let song=(await ok(await call('/documents?path=song.pro6','POST',original),201)).document;
 const id='88888888-8888-4888-a888-888888888888',body=JSON.stringify({id,name:'새 예배 & 기도'});
 assert.equal((await call(path+'/nodes','POST','null',tag())).status,400);
 assert.equal((await call(path+'/nodes','POST',body,{...tag(),Origin:'https://other.test'})).status,403);
 lib=(await ok(await call(path+'/nodes','POST',body,tag()),201)).library;
 assert.equal(lib.playlists.length,3);
 assert.equal((await ok(await call(path+'/nodes','POST',body,{'If-Match':'"1"'}))).unchanged,true);
 assert.equal((await call(path,'PUT',xml,tag())).status,409,'old full uploads cannot drop new nodes');
 const current=await(await call(path+'/content')).text();
 assert.equal((await call(path+'/archive?node=A','POST','{}',{'If-Match':'"1"'})).status,409);
 lib=(await ok(await call(path+'/archive?node=A','POST','{}',tag()))).library;
 assert.deepEqual(lib.playlists.map(p=>p.id),['B',id]);
 assert.equal((await ok(await call('/playlists?scope=archived'))).archives[0].id,'A');
 const frozen=await ok(await call(path+'/archive?node=A'));assert.equal(frozen.documents.length,1);assert.equal(frozen.media,'references-only');assert.equal(frozen.documents[0].objectKey,undefined);
 const download=path+'/archive?node=A&document='+song.id;
 assert.equal(await(await call(download)).text(),original);
 song=(await ok(await call('/documents/'+song.id,'PUT',original.replace('original','changed'),{'If-Match':'"1"'}))).document;
 assert.equal(song.historyEnabled,false);assert.equal(await(await call(download)).text(),original,'archive copy survives disabled song history');
 assert.equal((await call(path,'PUT',current,tag())).status,409,'old full uploads cannot resurrect archived nodes');
 assert.equal((await ok(await call(path+'/archive?node=A','POST','{}',{'If-Match':'"1"'}))).unchanged,true);
 // A missing current original blocks restoration without dropping the archive.
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('FILES');
 const v=await db.prepare('SELECT object_key FROM yebaeon_versions WHERE document_id=? AND version=?').bind(song.id,song.version).first();
 const saved=await(await bucket.get(v.object_key)).arrayBuffer();await bucket.delete(v.object_key);
 assert.equal((await call(path+'/restore?node=A','POST','{}',tag())).status,409);
 assert.equal((await ok(await call('/playlists?scope=archived'))).archives.length,1);
 await bucket.put(v.object_key,saved);
 lib=(await ok(await call(path+'/restore?node=A','POST','{}',tag()))).library;
 assert.equal(lib.playlists.length,3);assert.equal((await ok(await call('/playlists?scope=archived'))).archives.length,0);
 assert.equal((await ok(await call(path+'/plan?node=A'))).documents[0].version,2);
 assert.equal((await ok(await call(path+'/restore?node=A','POST','{}',{'If-Match':'"1"'}))).unchanged,true);
 // Intentional removals still use the explicit API and cannot be resurrected
 // by a later whole-file upload with the new file version.
 const beforeRemoval=await(await call(path+'/content')).text();
 lib=(await ok(await call(path+'/nodes?node='+id,'DELETE',undefined,tag()))).library;
 assert.equal(lib.playlists.some(p=>p.id===id),false);
 assert.equal((await call(path,'PUT',beforeRemoval,tag())).status,409);
 // Two writers sharing a file version cannot both change structure or controls.
 const candidates=['77777777-7777-4777-a777-777777777777','66666666-6666-4666-a666-666666666666'];
 const results=await Promise.all(candidates.map((id,i)=>call(path+'/nodes','POST',JSON.stringify({id,name:'동시 '+i}),tag())));
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const controls=(await db.prepare('SELECT node_id FROM yebaeon_playlist_controls WHERE library_id=?').bind(lib.id).all()).results;
 assert.equal(controls.filter(c=>candidates.includes(c.node_id)).length,1);
});
test('playlist trash keeps only the order and document list', {timeout:120000},async t=>{
 const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'trash-only'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 const origin='https://example.test';let cookie='';
 const call=(path,method='GET',body,extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,...method==='GET'?{}:{Origin:origin},'Content-Type':'application/json',...extra}});
 const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 const login=await call('/session','POST',JSON.stringify({name:'시험',password:'trash-only'}));await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
 const names=Array.from({length:100},(_,i)=>'곡 '+String(i).padStart(3,'0'));
 const ids=[];for(const name of names)ids.push((await ok(await call('/documents?path='+encodeURIComponent(name+'.pro6'),'POST',`<RVPresentationDocument category="가사찬양"><text>${name}</text></RVPresentationDocument>`),201)).document.id);
 const cues=names.map((name,i)=>`<RVDocumentCue UUID="cue${i}" displayName="${name}" filePath="~/Documents/ProPresenter6/${name}.pro6"/>`).join('');
 const xml=`<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children"><RVPlaylistNode UUID="C" displayName="큰 예배"><array rvXMLIvarName="children">${cues}</array></RVPlaylistNode><RVPlaylistNode UUID="D" displayName="보관할 예배"><array rvXMLIvarName="children">${cues.slice(0,cues.indexOf('<RVDocumentCue',10))}</array></RVPlaylistNode></array></RVPlaylistNode></RVPlaylistDocument>`;
 let lib=(await ok(await call('/playlists?path=trash.pro6pl','POST',xml),201)).library;
 const path='/playlists/'+lib.id,tag=()=>({'If-Match':`"${lib.version}"`,'X-YebaeOn-Sync':'2'}),bucket=await mf.getR2Bucket('FILES');
 const objects=async()=>(await bucket.list({prefix:'playlist-archives/'+lib.id+'/'})).objects.map(o=>o.key);
 const trashed=await ok(await call(path+'/nodes?node=C','DELETE',undefined,tag()));lib=trashed.library;
 assert.equal(trashed.trashed,true);
 const keys=await objects();assert.equal(keys.length,1,'trash writes only the manifest');assert.match(keys[0],/manifest\.json$/);
 const manifest=await(await bucket.get(keys[0])).json();
 assert.equal(manifest.documents.length,100);assert.equal(manifest.documentCopies,false);
 assert.deepEqual(Object.keys(manifest.documents[0]).sort(),['id','path','sha256','size','version']);
 const listed=await ok(await call(path+'/trash?node=C'));assert.equal(listed.documents.length,100);
 const download=await call(path+'/trash?node=C&document='+ids[0]);assert.equal(download.status,404);assert.match((await download.json()).message,/휴지통 예배는 문서 사본을 두지 않습니다/);
 lib=(await ok(await call(path+'/untrash?node=C','POST','{}',tag()))).library;
 assert.ok(lib.playlists.some(p=>p.id==='C'),'untrash reconnects the current documents');
 assert.equal((await ok(await call(path+'/plan?node=C'))).documents.length,100);
 // 보관은 지금처럼 문서 원본을 복사하고 보관 당시 원본을 내려받는다.
 lib=(await ok(await call(path+'/archive?node=D','POST','{}',tag()))).library;
 assert.equal((await objects()).length,1+1+1,'archive copies its one document beside its manifest');
 assert.equal(await(await call(path+'/archive?node=D&document='+ids[0])).text(),`<RVPresentationDocument category="가사찬양"><text>${names[0]}</text></RVPresentationDocument>`);
});
