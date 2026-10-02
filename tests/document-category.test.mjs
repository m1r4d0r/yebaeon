import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { categoryFromXML, categoryPolicy, oldMaterialCutoff } from '../cloudflare/document-category.mjs';

const xml=(category,text='categoryuniquelyrics',used='2026-10-01T00:00:00Z')=>`<RVPresentationDocument category="${category}" lastDateUsed="${used}"><RVTextElement><NSString rvXMLIvarName="RTFData">${Buffer.from('{\\rtf1 '+text+'}').toString('base64')}</NSString></RVTextElement></RVPresentationDocument>`;

test('only the PP6 root category controls policy; archive age uses Korean calendar anniversaries',()=>{
  assert.equal(categoryFromXML('\ufeff<?xml version="1.0"?><!-- category="옛날자료" --><RVPresentationDocument category="가사찬양"><RVDisplaySlide category="옛날자료"/></RVPresentationDocument>'),'가사찬양');
  assert.equal(categoryFromXML('<RVPresentationDocument category="&#xac00;&#xc0ac;&#xcc2c;&#xc591;"/>'),'가사찬양');
  assert.equal(categoryPolicy('CCM'),null);
  assert.equal(categoryPolicy('미결'),null);
  assert.equal(oldMaterialCutoff(new Date('2026-10-02T15:00:00Z')),'2024-10-02T15:00:00.000Z');
  assert.equal(oldMaterialCutoff(new Date('2024-02-29T06:00:00Z')),'2022-02-27T15:00:00.000Z');
});

test('category saves, same-byte migration, history transitions and archive searches preserve Sync access',{timeout:90000},async t=>{
  const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'category-test'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
  t.after(()=>mf.dispose());
  const origin='https://category.test';let cookie='';
  const call=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Cookie:cookie,...(method==='GET'?{}:{Origin:origin}),...headers}});
  const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  const login=await call('/session','POST',JSON.stringify({name:'fixture',password:'category-test'}));await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
  const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('FILES');
  const create=async(name,category,text,used)=>(await ok(await call('/documents?path='+encodeURIComponent(name+'.pro6'),'POST',xml(category,text,used)),201)).document;
  const save=async(doc,category,text,used)=>(await ok(await call('/documents/'+doc.id,'PUT',xml(category,text,used),{'If-Match':`"${doc.version}"`}))).document;
  const get=async id=>(await ok(await call('/documents/'+id))).document;
  const search=async(q,extra='')=>(await ok(await call('/documents?includeIndexed=1&q='+encodeURIComponent(q)+extra))).documents;
  const versions=async id=>(await ok(await call('/documents/'+id+'/versions'))).versions.map(v=>v.version);

  let doc=await create('category-song','가사찬양');
  assert.equal(doc.searchEnabled,true);assert.equal(doc.historyEnabled,false);assert.equal(doc.categoryManaged,true);
  doc=await save(doc,'가사찬양','second');
  assert.deepEqual(await versions(doc.id),[2]);
  assert.equal((await bucket.list()).objects.length,1);
  doc=await save(doc,'예배순서','weekly');
  doc=await save(doc,'예배순서','weeklynext');
  assert.deepEqual(await versions(doc.id),[4,3,2]);
  assert.equal(doc.searchEnabled,true);assert.equal(doc.historyEnabled,true);
  doc=await save(doc,'옛날자료','notsearchable','2019-01-01T00:00:00Z');
  doc=await save(doc,'옛날자료','notsearchable2','2019-01-01T00:00:00Z');
  assert.deepEqual(await versions(doc.id),[6,4,3,2],'pre-policy backups remain');
  assert.equal((await search('notsearchable2','&includeArchived=1')).length,0);
  for(const sort of ['name','name-desc','used','updated'])assert.equal((await search('category-song','&sort='+sort)).length,0);
  assert.equal((await search('category-song','&includeArchived=1'))[0].id,doc.id);
  assert.equal((await ok(await call('/documents?q=category-song'))).documents[0].id,doc.id,'Sync inventory still sees archived titles');
  assert.equal((await call('/documents/'+doc.id+'/content')).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_document_search WHERE document_id=?').bind(doc.id).first()).n,0);
  assert.equal((await call('/documents/'+doc.id+'/policy','PUT',JSON.stringify({searchEnabled:true,historyEnabled:true,policyRevision:doc.policyRevision}),{'If-Match':`"${doc.version}"`})).status,409);
  doc=await save(doc,'특별순서','searchrestored','2019-01-01T00:00:00Z');
  assert.equal((await search('searchrestored'))[0].id,doc.id);
  assert.equal(doc.historyEnabled,true);

  const cutoff=oldMaterialCutoff();
  await create('category-boundary','옛날자료','boundary',cutoff);
  await create('category-before','옛날자료','before',new Date(Date.parse(cutoff)-1).toISOString());
  await create('category-unknown','옛날자료','unknown','');
  const score=await create('category-score','악보찬양','scorelyrics','2010-01-01T00:00:00Z');
  assert.equal(score.historyEnabled,false);assert.equal((await search('scorelyrics'))[0].id,score.id);
  assert.equal((await search('category-boundary')).length,1);
  assert.equal((await search('category-before')).length,0);
  assert.equal((await search('category-unknown')).length,1);

  let pending=await create('category-pending','미결');
  pending=(await ok(await call('/documents/'+pending.id+'/policy','PUT',JSON.stringify({searchEnabled:false,historyEnabled:true,policyRevision:pending.policyRevision}),{'If-Match':'"1"'}))).document;
  pending=await save(pending,'미결','stillpending');
  assert.equal(pending.searchEnabled,false);assert.equal(pending.historyEnabled,true);assert.equal(pending.categoryManaged,false);
  // Simulate a pre-migration row whose bytes already contain an approved category.
  let legacy=await create('category-legacy','가사찬양');
  await db.prepare('UPDATE yebaeon_documents SET category=NULL,history_enabled=1,history_start=NULL WHERE id=?').bind(legacy.id).run();
  legacy=(await ok(await call('/documents?path=category-legacy.pro6','POST',xml('가사찬양')))).document;
  assert.equal(legacy.version,1);assert.equal(legacy.historyEnabled,false);
  const repeat=await ok(await call('/documents?path=category-legacy.pro6','POST',xml('가사찬양')));
  assert.equal(repeat.document.policyRevision,legacy.policyRevision);
  legacy=await save(legacy,'가사찬양','new');legacy=await save(legacy,'가사찬양','newest');
  assert.deepEqual(await versions(legacy.id),[3,1]);
  // A failed category/index transaction cannot partially switch policy or history.
  await db.prepare("CREATE TRIGGER fail_category_search BEFORE INSERT ON yebaeon_document_search WHEN NEW.document_id='"+pending.id+"' BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  assert.equal((await call('/documents/'+pending.id,'PUT',xml('예배순서'),{'If-Match':`"${pending.version}"`})).status,503);
  assert.deepEqual(await get(pending.id),pending);
});
