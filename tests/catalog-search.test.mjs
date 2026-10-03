import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { rtfText,searchFromXML } from '../cloudflare/document-search.mjs';
const rtf=text=>Buffer.from('{\\rtf1\\ansi\\uc1 '+Array.from(text).map(c=>c.charCodeAt(0)>127?'\\u'+c.charCodeAt(0)+'?':c).join('')+'}','latin1').toString('base64');
const xml=text=>`<RVPresentationDocument width="1920" height="1080"><RVTextElement><NSString rvXMLIvarName="RTFData">${rtf(text)}</NSString></RVTextElement></RVPresentationDocument>`;
test('content extraction handles Korean Unicode, CP949, escaped punctuation and ignored RTF tables',()=>{
  assert.equal(rtfText(rtf('하나님 사랑')), '하나님 사랑');
  assert.equal(rtfText(Buffer.from("{\\rtf1\\ansi\\ansicpg949 {\\fonttbl{\\f0 SecretFont;}}\\'c7\\'cf\\'b3\\'aa\\'b4\\'d4}",'latin1').toString('base64')),'하나님');
  assert.equal(searchFromXML(xml('하나님\n사 랑')),'하나님사랑');
});
test('catalog-only playlist entries and current-version content search preserve actual-file semantics',{timeout:90000},async t=>{
  const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'catalog-test-only'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
  const origin='https://example.test';let cookie='';
  const call=(path,method='GET',body,extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,...(method==='GET'?{}:{Origin:origin}),...extra}});
  const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  assert.equal((await call('/documents?includeIndexed=1')).status,401);assert.equal((await call('/search-index','POST')).status,401);
  const login=await call('/session','POST',JSON.stringify({name:'시험',password:'catalog-test-only'}),{'Content-Type':'application/json'});await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
  assert.deepEqual((await ok(await call('/documents?includeIndexed=1'))).documents,[]);
  const db=await mf.getD1Database('DB');
  // A fresh server remains empty until a Mac explicitly supplies an inventory.
  assert.deepEqual((await ok(await call('/documents?includeIndexed=1&q=.pro6'))).documents,[]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM yebaeon_library_catalog').first()).total,0);
  const fixtures=Array.from({length:105},(_,i)=>({originalPath:`합성 목록 ${String(i).padStart(3,'0')}.pro6`,size:100}));
  await ok(await call('/inventory','POST',JSON.stringify({deviceId:'c'.repeat(64),documents:fixtures}),{'Content-Type':'application/json'}));
  const first=await ok(await call('/documents?includeIndexed=1&q=.pro6&sort=name'));assert.equal(first.documents.length,100);assert.ok(first.documents.every(d=>d.available===false));
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM yebaeon_library_catalog').first()).total,105);
  const second=await ok(await call('/documents?includeIndexed=1&q=.pro6&sort=name&after='+encodeURIComponent(first.next)));assert.ok(second.documents[0].path>first.documents.at(-1).path);assert.equal((await ok(await call('/documents'))).documents.length,0);
  // Clearing both old seed markers and catalog entries cannot reimport old names.
  await db.exec('CREATE TABLE yebaeon_catalog_imports (snapshot TEXT PRIMARY KEY, imported_at TEXT NOT NULL);');
  await db.batch([
    db.prepare('DELETE FROM yebaeon_library_catalog'),
    db.prepare('DELETE FROM yebaeon_catalog_imports'),
    db.prepare('DELETE FROM yebaeon_inventory_members'),
    db.prepare('DELETE FROM yebaeon_inventory_devices')
  ]);
  assert.deepEqual((await ok(await call('/documents?includeIndexed=1&q=.pro6'))).documents,[]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM yebaeon_library_catalog').first()).total,0);
  const id='33333333-3333-4333-a333-333333333333',path='미업로드 시험 : & %3A.pro6',original=path.normalize('NFD');
  await db.prepare('INSERT INTO yebaeon_library_catalog(id,path,original_path,size,slide_count,snapshot) VALUES (?,?,?,?,?,?)').bind(id,path,original,100,3,'fixture').run();
  let results=await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('미업로드 시험')));assert.equal(results.documents.length,1);assert.equal(results.documents[0].available,false);assert.equal((await call('/documents/'+id+'/content')).status,404);
  const listXML='<RVPlaylistDocument><RVPlaylistNode><array rvXMLIvarName="children"><RVPlaylistNode UUID="A" displayName="시험"><array rvXMLIvarName="children"/></RVPlaylistNode></array></RVPlaylistNode></RVPlaylistDocument>';
  const library=(await ok(await call('/playlists?path=test.pro6pl','POST',listXML),201)).library;
  await ok(await call(`/playlists/${library.id}?node=A`,'PATCH',JSON.stringify({items:[{documentId:id}]}),{'If-Match':'"1"'}));
  let plan=await ok(await call(`/playlists/${library.id}/plan?node=A&includeIndexed=1`));assert.equal(plan.ready,false);assert.equal(plan.applicable,true,'a missing original never blocks Mac installation');assert.equal(plan.missing,1);assert.equal(plan.items[0].document,null);assert.equal(plan.items[0].indexedDocument.id,id);assert.equal(plan.documents.length,0);assert.equal(plan.items[0].sourcePath,'~/Documents/ProPresenter6/'+original);
  const syncPlan=await ok(await call(`/playlists/${library.id}/plan?node=A`));assert.equal(syncPlan.items[0].indexedDocument,undefined);assert.equal(syncPlan.documents.length,0);assert.equal(syncPlan.ready,false);
  let doc=(await ok(await call('/documents?path='+encodeURIComponent(path),'POST',xml('검색전용 본문 옛문장')),201)).document;
  results=await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('미업로드 시험')));assert.equal(results.documents.length,1);assert.equal(results.documents[0].id,doc.id);assert.equal(results.documents[0].available,true);
  results=await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('검색전용본문')));assert.equal(results.documents[0].id,doc.id);assert.equal(results.documents[0].matchedBy,'content');
  plan=await ok(await call(`/playlists/${library.id}/plan?node=A&includeIndexed=1`));assert.equal(plan.ready,true);assert.equal(plan.items[0].document.id,doc.id);assert.equal(plan.items[0].indexedDocument,undefined);
  doc=(await ok(await call('/documents/'+doc.id,'PUT',xml('검색전용 새문장'),{'If-Match':'"1"'}))).document;
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('옛문장')))).documents.length,0);
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새문장')))).documents[0].version,2);
  await db.prepare('DELETE FROM yebaeon_document_search WHERE document_id=? AND version=2').bind(doc.id).run();
  assert.equal((await ok(await call('/documents?includeIndexed=1&q=새문장'))).searchIndex,undefined);
  assert.equal((await call('/search-index','POST',undefined,{Origin:'https://elsewhere.test'})).status,403);
  const progress=await ok(await call('/search-index','POST'));assert.equal(progress.next,null);assert.equal(progress.processed,1);
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새문장')))).documents[0].id,doc.id);
  assert.equal((await call('/documents?includeIndexed=1&cursor=bad')).status,400);
  // Complete metadata scans preserve IDs, raw spelling and original-file semantics.
  const inventory=documents=>JSON.stringify({deviceId:'a'.repeat(64),documents});
  const send=documents=>call('/inventory','POST',inventory(documents),{'Content-Type':'application/json'});
  const newName='새 문서 : %3A.pro6',nfd=newName.normalize('NFD');
  assert.equal((await call('/inventory','POST',inventory([]),{'Content-Type':'application/json',Origin:'https://elsewhere.test'})).status,403);
  await ok(await send([{originalPath:original,size:100},{originalPath:nfd,size:200}]));
  let indexed=(await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새 문서')))).documents[0];
  assert.equal(indexed.available,false);assert.equal(indexed.localPresent,true);assert.equal(indexed.originalPath,nfd);
  assert.equal((await call('/documents/'+indexed.id+'/content')).status,404);
  const indexedId=indexed.id;
  await ok(await send([{originalPath:nfd,size:250}]));
  indexed=(await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새 문서')))).documents[0];
  assert.equal(indexed.id,indexedId);assert.equal(indexed.size,250);
  const stored=(await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('미업로드 시험')))).documents[0];
  assert.equal(stored.localPresent,false);assert.equal(stored.available,true);assert.equal(stored.version,2);
  assert.equal((await send([{originalPath:nfd,size:300},{originalPath:newName,size:300}])).status,400);
  assert.equal((await send([{originalPath:'../bad.pro6',size:1}])).status,400);
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새 문서')))).documents[0].localPresent,true);
  // A failed database commit also rolls back removed membership and earlier updates.
  await db.prepare("CREATE TRIGGER reject_inventory BEFORE INSERT ON yebaeon_library_catalog WHEN NEW.path='실패.pro6' BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  assert.equal((await send([{originalPath:nfd,size:999},{originalPath:'실패.pro6',size:1}])).status,503);
  const afterFailure=(await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새 문서')))).documents[0];
  assert.equal(afterFailure.localPresent,true);assert.equal(afterFailure.size,250);
  await db.prepare('DROP TRIGGER reject_inventory').run();
  await ok(await call('/inventory','POST',JSON.stringify({deviceId:'b'.repeat(64),documents:[{originalPath:original,size:100}]}),{'Content-Type':'application/json'}));
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('미업로드 시험')))).documents[0].localPresent,true);
  await ok(await send([]));
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('새 문서')))).documents[0].localPresent,false);
  assert.equal((await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent('미업로드 시험')))).documents[0].version,2);
  assert.equal((await call('/inventory','POST',JSON.stringify({documents:[]}),{'Content-Type':'application/json'})).status,400);

});

