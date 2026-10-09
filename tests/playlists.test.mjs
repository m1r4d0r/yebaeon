import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { parsePlaylist, catalog, referencePath, editPlaylist } from '../cloudflare/playlist-format.mjs';
const cue = (id,name,path=name+'.pro6') => `<RVDocumentCue UUID="${id}" displayName="${name}" filePath="~/Documents/ProPresenter6/${path}" selectedArrangementID="" enabled="1"/>`;
const xml = `<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children"><RVPlaylistNode UUID="A" displayName="주일"><array rvXMLIvarName="children">${cue('a','찬양')}${cue('b','말씀')}<RVHeaderCue UUID="header" displayName="기도"/></array><array rvXMLIvarName="metadata"><NSString>preserve</NSString></array></RVPlaylistNode><RVPlaylistNode UUID="B" displayName="수요"><array rvXMLIvarName="children">${cue('c','찬양')}</array></RVPlaylistNode></array></RVPlaylistNode><array rvXMLIvarName="deletions"/></RVPlaylistDocument>`;
test('PP6 original structure, raw preservation, aliases and ambiguous input', async () => {
  assert.equal(catalog(parsePlaylist(await readFile('tests/fixtures/dummy_old.xml','utf8'))).length,2);
  const p=parsePlaylist(xml);assert.equal(p.playlists.length,2);assert.equal(p.playlists[0].items[2].kind,'header');
  const next=editPlaylist(p,'A',[{id:'b'},{id:'header'},{id:'a'}],new Map(),'~/Documents/ProPresenter6');
  assert.equal(next.slice(next.indexOf('<RVPlaylistNode UUID="B"')),xml.slice(xml.indexOf('<RVPlaylistNode UUID="B"')));
  assert.ok(next.includes('<array rvXMLIvarName="metadata"><NSString>preserve</NSString></array>'));
  assert.deepEqual(parsePlaylist(next).playlists[0].items.map(x=>x.id),['b','header','a']);
  assert.equal(referencePath('~/Documents/ProPresenter6/'+ '찬양'.normalize('NFD')+'.pro6','~/Documents/ProPresenter6'),'찬양.pro6');
  assert.equal(referencePath('file:///Users/person/Documents/ProPresenter6/%EC%B0%AC%EC%96%91.pro6','~/Documents/ProPresenter6'),'찬양.pro6');
  for(const value of ['~/Other/찬양.pro6','~/Documents/ProPresenter6/../secret.pro6','file://other/Users/person/Documents/ProPresenter6/x.pro6'])assert.equal(referencePath(value,'~/Documents/ProPresenter6'),null);
  for(const bad of ['<!DOCTYPE RVPlaylistDocument><RVPlaylistDocument/>','<html/>',xml.replace('UUID="B"','UUID="A"'),xml.replace('UUID="b"','UUID="a"')])assert.throws(()=>parsePlaylist(bad));
  assert.throws(()=>editPlaylist(p,'A',[{id:'a'},{id:'a'}],new Map(),'~/Documents/ProPresenter6'));
  assert.throws(()=>editPlaylist(p,'A',[{documentId:'missing'}],new Map(),'~/Documents/ProPresenter6'));
  const empty=parsePlaylist('<RVPlaylistDocument><RVPlaylistNode><array rvXMLIvarName="children"><RVPlaylistNode UUID="A" displayName="empty"><array rvXMLIvarName="children"/></RVPlaylistNode></array></RVPlaylistNode></RVPlaylistDocument>');
  assert.equal(parsePlaylist(editPlaylist(empty,'A',[{documentId:'x'}],new Map([['x',{path:'new.pro6',name:'new.pro6'}]]),'~/Documents/ProPresenter6')).playlists[0].items.length,1);
  const special = "찬양 : & \"피\" %3A $& $` $' $$";
  const replaced = editPlaylist(parsePlaylist(xml.replace('filePath=', 'filePath = ')), 'A', [{id:'a', documentId:'x'}], new Map([['x',{path:special+'.pro6',name:special+'.pro6'}]]), '~/Documents/ProPresenter6');
  assert.equal(parsePlaylist(replaced).playlists[0].items[0].sourcePath, '~/Documents/ProPresenter6/'+special+'.pro6');
  const odd=xml.replace('displayName="주일"','displayName="주일 &amp; &quot; &gt; 예배"').replace('<array rvXMLIvarName="deletions"/>','<!-- <RVPlaylistNode UUID="bad"> --><array rvXMLIvarName="deletions"/>');
  assert.equal(parsePlaylist(odd).playlists[0].name,'주일 & " > 예배');
});
test('playlist server, linked edits, structural edits, history and conflicts', {timeout:90000}, async t => {
  const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'playlist-tests-only'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
  const origin='https://example.test';let cookie='';
  const call=(path,method='GET',body,extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:origin}),...extra}});
  const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  await t.test('private upload and read, same-origin, validation', async()=>{
    assert.equal((await call('/playlists')).status,401);
    const login=await call('/session','POST',JSON.stringify({name:'재생목록 시험',password:'playlist-tests-only'}),{'Content-Type':'application/json'});await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await call('/playlists?path=x.pro6pl','POST',xml,{Origin:'https://elsewhere.test'})).status,403);
    assert.equal((await call('/playlists?path=x.pro6','POST',xml)).status,400);
    assert.equal((await call('/playlists?path=x.pro6pl','POST','<broken>')).status,400);
  });
  let library,song,word,other,plan;
  await t.test('original registered once, missing references then precise normalized links',async()=>{
    library=(await ok(await call('/playlists?path=fixture.pro6pl','POST',xml),201)).library;
    assert.equal(library.playlists.length,2);assert.equal((await ok(await call('/playlists?path=fixture.pro6pl','POST',xml))).unchanged,true);
    plan=await ok(await call(`/playlists/${library.id}/plan?node=A`));assert.equal(plan.ready,false);assert.equal(plan.items[0].issue,'missing');
    const put=async name=>(await ok(await call('/documents?path='+encodeURIComponent(name+'.pro6'),'POST',`<RVPresentationDocument><text>${name}</text></RVPresentationDocument>`),201)).document;
    song=await put('찬양');word=await put('말씀');other=await put('새곡');
    plan=await ok(await call(`/playlists/${library.id}/plan?node=A`));assert.equal(plan.ready,true);assert.equal(plan.documents.length,2);assert.equal(plan.items[0].document.id,song.id);assert.deepEqual(plan.items[0].sharedWith,['수요']);
    assert.equal((await ok(await call('/playlists'))).libraries[0].id,library.id);
    assert.equal(await (await call(`/playlists/${library.id}/content?version=1`)).text(),xml);
  });
  await t.test('song-only change changes sync fingerprint with identical playlist bytes',async()=>{
    const previous=plan.fingerprint;
    song=(await ok(await call('/documents/'+song.id,'PUT','<RVPresentationDocument><text>edited lyrics</text></RVPresentationDocument>',{'If-Match':'"1"'}))).document;
    plan=await ok(await call(`/playlists/${library.id}/plan?node=A`));assert.notEqual(plan.fingerprint,previous);assert.equal(plan.library.version,1);assert.equal(plan.items[0].document.version,2);assert.equal(plan.playlist.xml,parsePlaylist(xml).xml.slice(parsePlaylist(xml).playlists[0].node.start,parsePlaylist(xml).playlists[0].node.end));
  });
  await t.test('trashed referenced documents are never download targets; restore opts back in',async()=>{
    const before=await ok(await call(`/playlists/${library.id}/plan?node=A`));
    await ok(await call(`/documents/${song.id}/state`,'POST',JSON.stringify({action:'trash'}),{'Content-Type':'application/json'}));
    const trashed=await ok(await call(`/playlists/${library.id}/plan?node=A`));
    assert.equal(trashed.documents.some(d=>d.id===song.id),false);
    assert.equal(trashed.items.find(i=>i.document?.id===song.id).issue,'trashed');
    assert.equal(trashed.applicable,true);
    assert.equal(trashed.playlist.xml,before.playlist.xml);
    assert.notEqual(trashed.fingerprint,before.fingerprint);
    await ok(await call(`/documents/${song.id}/state`,'POST',JSON.stringify({action:'untrash'}),{'Content-Type':'application/json'}));
    const restored=await ok(await call(`/playlists/${library.id}/plan?node=A`));
    assert.equal(restored.documents.some(d=>d.id===song.id),true);
    assert.equal(restored.items.find(i=>i.document?.id===song.id).issue,null);
  });
  await t.test('reorder, add, remove preserve unrelated nodes and documents; CAS/history',async()=>{
    const endpoint=`/playlists/${library.id}?node=A`, body=JSON.stringify({items:[{id:'header'},{id:'b'},{id:'a'},{documentId:other.id}]});
    assert.equal((await call(endpoint,'PATCH',body)).status,428);
    const results=await Promise.all([call(endpoint,'PATCH',body,{'If-Match':'"1"'}),call(endpoint,'PATCH',body,{'If-Match':'"1"'})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
    plan=await ok(await call(`/playlists/${library.id}/plan?node=A`));assert.deepEqual(plan.items.map(x=>x.name),['기도','말씀','찬양','새곡']);assert.equal(plan.documents.length,3);
    const current=await (await call(`/playlists/${library.id}/content`)).text();assert.equal(current.slice(current.indexOf('<RVPlaylistNode UUID="B"')),xml.slice(xml.indexOf('<RVPlaylistNode UUID="B"')));
    const removed=JSON.stringify({items:[{id:plan.items[3].id}]});await ok(await call(endpoint,'PATCH',removed,{'If-Match':'"2"'}));
    assert.equal((await ok(await call('/documents/'+song.id))).document.version,2);
    assert.equal(await (await call(`/playlists/${library.id}/content?version=1`)).text(),xml);
    assert.deepEqual((await ok(await call(`/playlists/${library.id}/versions`))).versions.map(x=>x.version),[3,2,1]);
    assert.equal((await call(endpoint,'PATCH','null',{'If-Match':'"3"'})).status,400);
  });
  await t.test('activity scope, stable pagination, reference cache follows current playlist',async()=>{
    const before=await ok(await call('/documents?includeUses=1'));assert.equal(before.documents.find(x=>x.id===other.id).useCount,1);assert.equal(before.documents.find(x=>x.id===song.id).useCount,1);
    const timeline=await ok(await call('/activity?scope=all'));assert.ok(timeline.items.some(x=>x.kind==='playlist'));assert.ok(timeline.items.some(x=>x.kind==='document'));assert.equal((await ok(await call('/activity?scope=mine'))).items.length,timeline.items.length);
    await ok(await call('/session','PATCH',JSON.stringify({name:'다른 작업자'}),{'Content-Type':'application/json'}));assert.equal((await ok(await call('/activity?scope=mine'))).items.length,0);
    assert.equal((await call('/activity?cursor=bad')).status,400);assert.equal((await call('/activity?scope=unknown')).status,400);
    const db=await mf.getD1Database('DB');const date='2099-01-01T00:00:00Z';
    for(let v=100;v<155;v++)await db.prepare('INSERT INTO yebaeon_versions(document_id,version,object_key,sha256,size,author,created_at) VALUES (?,?,?,?,?,?,?)').bind(song.id,v,'fixture/'+v,'a',1,'페이지 시험',date).run();
    const first=await ok(await call('/activity?scope=all'));assert.equal(first.items.length,50);assert.ok(first.next);const second=await ok(await call('/activity?scope=all&cursor='+encodeURIComponent(first.next)));const all=[...first.items,...second.items].filter(x=>x.createdAt===date);assert.equal(all.length,55);assert.equal(new Set(all.map(x=>x.kind+x.id+x.version)).size,55);
  });

});

test('authenticated initial playlist repair stores original and never replaces an existing library', {timeout:90000}, async t => {
  const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'bootstrap-tests-only'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
  const origin='https://example.test';let cookie='';
  const call=async(path,method='GET',body,extra={})=>{
    const h={Cookie:cookie,...(method==='GET'?{}:{Origin:origin}),...extra};
    if(body instanceof FormData){const encoded=new Request(origin,{method:'POST',body});h['Content-Type']=encoded.headers.get('Content-Type');body=await encoded.arrayBuffer();}
    return mf.dispatchFetch(origin+'/api'+path,{method,body,redirect:'manual',headers:h});
  };
  assert.equal((await call('/playlist-bootstrap')).status,401);
  const login=await call('/session','POST',JSON.stringify({name:'초기 등록 시험',password:'bootstrap-tests-only'}),{'Content-Type':'application/json'});
  assert.equal(login.status,200);cookie=login.headers.get('Set-Cookie').split(';')[0];
  const formPage=await call('/playlist-bootstrap');assert.equal(formPage.status,200);assert.equal(formPage.headers.get('Referrer-Policy'),'same-origin');assert.ok((await formPage.text()).includes('action="/api/playlist-bootstrap"'));
  const form=()=>{const f=new FormData();f.set('path','기본 .pro6pl');f.set('file',new Blob([xml],{type:'application/xml'}),'기본 (3).pro6pl');return f;};
  assert.equal((await call('/playlist-bootstrap','POST',form(),{Origin:'https://elsewhere.test'})).status,403);
  assert.equal((await call('/playlist-bootstrap','POST',new FormData())).status,400);
  const response=await call('/playlist-bootstrap','POST',form());assert.equal(response.status,303,await response.clone().text());assert.equal(response.headers.get('Location'),'/');
  const listed=await(await call('/playlists')).json();assert.equal(listed.libraries.length,1);assert.equal(listed.libraries[0].path,'기본 .pro6pl');assert.equal(listed.libraries[0].playlists.length,2);
  const id=listed.libraries[0].id;assert.equal(await(await call('/playlists/'+id+'/content')).text(),xml);
  assert.equal((await call('/playlist-bootstrap','POST',form())).status,409);
  assert.equal((await call('/playlist-bootstrap')).status,409);
  assert.equal((await(await call('/playlists')).json()).libraries[0].version,1);
});
