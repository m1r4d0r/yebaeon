import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import manifest from '../cloudflare/library-manifest.json' with {type:'json'};
import {ensureSchema} from '../cloudflare/schema.mjs';
import {measuredDB} from '../cloudflare/db-cost.mjs';
import {catalogList} from '../cloudflare/library-catalog.mjs';
import {syncObservationsRoute} from '../cloudflare/sync-observations.mjs';
import {guardedSearchStatement,searchFromXML} from '../cloudflare/document-search.mjs';
const origin='https://example.test';
const xml=(text,used='2026-10-01T00:00:00Z')=>`<RVPresentationDocument lastDateUsed="${used}"><RVTextElement><NSString rvXMLIvarName="RTFData">${Buffer.from('{\\rtf1 '+text+'}').toString('base64')}</NSString></RVTextElement></RVPresentationDocument>`;
async function fixture(t){
 const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'db-test-password'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 let cookie='';const call=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Cookie:cookie,...(method==='GET'?{}:{Origin:origin}),...headers}});
 const ok=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
 const session=await call('/session','POST',JSON.stringify({name:'fixture',password:'db-test-password'}));await ok(session);cookie=session.headers.get('Set-Cookie').split(';')[0];
 return {mf,call,ok,db:await mf.getD1Database('DB'),bucket:await mf.getR2Bucket('FILES')};
}
test('document policy preserves old backups, bounds future song history and keeps search atomic',{timeout:90000},async t=>{
 const {call,ok,db,bucket}=await fixture(t);
 let doc=(await ok(await call('/documents?path=db-policy-fixture.pro6','POST',xml('old')),201)).document;
 const get=async()=>(await ok(await call('/documents/'+doc.id))).document;
 const policy=async(searchEnabled,historyEnabled)=>{doc=await get();return call('/documents/'+doc.id+'/policy','PUT',JSON.stringify({searchEnabled,historyEnabled,policyRevision:doc.policyRevision}),{'If-Match':`"${doc.version}"`});};
 const save=async text=>{doc=await get();return call('/documents/'+doc.id,'PUT',xml(text),{'If-Match':`"${doc.version}"`});};
 await ok(await policy(true,false));
 await ok(await save('middle'));await ok(await save('fixturefreshunique'));
 let versions=(await ok(await call('/documents/'+doc.id+'/versions'))).versions;
 assert.deepEqual(versions.map(v=>v.version),[3,1],'pre-policy backup remains but unretained intermediate is removed');
 assert.equal((await call('/documents/'+doc.id+'/content?version=2')).status,404);
 assert.equal((await call('/documents/'+doc.id+'/content?version=1')).status,200);
 assert.equal((await bucket.list()).objects.length,2);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_document_search WHERE document_id=?').bind(doc.id).first()).n,1);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_document_usage WHERE document_id=?').bind(doc.id).first()).n,0);
 let found=(await ok(await call('/documents?includeIndexed=1&q=fixturefreshunique'))).documents;assert.equal(found[0].id,doc.id);
 await ok(await policy(false,true));
 assert.equal((await ok(await call('/documents?includeIndexed=1&q=fixturefreshunique'))).documents.length,0);
 assert.equal((await ok(await call('/documents?includeIndexed=1&q=db-policy-fixture'))).documents[0].id,doc.id);
 // In-flight old extraction cannot recreate disabled search text.
 await guardedSearchStatement(db,doc.id,3,{text:'fixturefreshunique',error:null}).run();
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_document_search WHERE document_id=?').bind(doc.id).first()).n,0);
 await ok(await save('weekly'));await ok(await save('weeklyagain'));
 versions=(await ok(await call('/documents/'+doc.id+'/versions'))).versions;assert.deepEqual(versions.map(v=>v.version),[5,4,3,1]);
 await ok(await policy(true,true));assert.equal((await ok(await call('/documents?includeIndexed=1&q=weeklyagain'))).documents[0].version,5);
 // A failed search write must roll back metadata/history as a single transaction.
 await db.prepare("CREATE TRIGGER fail_search BEFORE INSERT ON yebaeon_document_search WHEN NEW.version=6 BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await save('failed')).status,503);assert.equal((await get()).version,5);
 assert.equal((await ok(await call('/documents?includeIndexed=1&q=weeklyagain'))).documents[0].version,5);
 await db.prepare('DROP TRIGGER fail_search').run();
 const before=await get();const responses=await Promise.all(['winnerA','winnerB'].map(text=>call('/documents/'+doc.id,'PUT',xml(text),{'If-Match':`"${before.version}"`})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);doc=await get();
 const index=await db.prepare('SELECT version,search_text FROM yebaeon_document_search WHERE document_id=?').bind(doc.id).first();assert.equal(index.version,doc.version);
 assert.equal(searchFromXML(await(await call('/documents/'+doc.id+'/content')).text()),index.search_text);
 const stalePolicy=await call('/documents/'+doc.id+'/policy','PUT',JSON.stringify({searchEnabled:false,historyEnabled:false,policyRevision:doc.policyRevision-1}),{'If-Match':`"${doc.version}"`});assert.equal(stalePolicy.status,409);
 assert.equal((await call('/documents/'+doc.id+'/policy','PUT','{}',{Origin:'https://elsewhere.test'})).status,403);
 const oldVersion=doc.version;await ok(await policy(true,false));
 const sameVersionChangedPolicy=await call('/documents/'+doc.id+'/policy','PUT',JSON.stringify({searchEnabled:false,historyEnabled:true,policyRevision:doc.policyRevision}),{'If-Match':`"${oldVersion}"`});assert.equal(sameVersionChangedPolicy.status,409);
});

test('scoped status and search read budgets on 3107 synthetic documents; empty search does no library queries',{timeout:90000},async t=>{
 const {db,bucket}=await fixture(t);const count=3107,ids=Array.from({length:count},()=>randomUUID()),stamp='2026-10-01T00:00:00Z';
 for(let offset=0;offset<count;offset+=100){const statements=[];for(let i=offset;i<Math.min(offset+100,count);i++){
  const path=manifest.documents[i].path;
  statements.push(db.prepare('INSERT INTO yebaeon_documents(id,path,created_at,current_version,updated_at,updated_by,sha256,size,write_id,last_used,usage_version) VALUES (?,?,?,1,?,?,?,?,?,?,1)').bind(ids[i],path,stamp,stamp,'fixture','a'.repeat(64),100,ids[i],stamp));
  statements.push(db.prepare('INSERT INTO yebaeon_document_search VALUES (?,1,?,NULL)').bind(ids[i],i<20?'needle':'other'));
  statements.push(db.prepare('INSERT INTO yebaeon_sync_observations VALUES (?,?,?,?,?,?,?,?)').bind('b'.repeat(64),'document',ids[i],'','a'.repeat(64),'same',stamp,'fixture'));
 }await db.batch(statements);}
 let measured=measuredDB(db,'empty');const empty=await catalogList(new Request(origin+'/api/documents?includeIndexed=1'),{DB:measured,FILES:bucket});assert.equal((await empty.json()).documents.length,0);assert.deepEqual(measured.metrics(),[]);
 // Authenticate separately in Worker: this direct route measurement deliberately excludes auth.
 measured=measuredDB(db,'scoped-status');const targets=ids.slice(0,20).map(id=>({kind:'document',id,node:''}));
 const result=await syncObservationsRoute(new Request(origin+'/api/sync-observations?'+new URLSearchParams({targets:JSON.stringify(targets)})),{DB:measured,FILES:bucket},{});
 assert.equal(Object.keys((await result.json()).items).length,20);
 const scopedReads=measured.metrics().reduce((n,q)=>n+q.rowsRead,0);assert.ok(scopedReads<300,`scoped status unexpectedly read ${scopedReads} rows`);
 const fullDocs=await db.prepare('SELECT id,path,sha256 FROM yebaeon_documents').all(),fullReports=await db.prepare('SELECT * FROM yebaeon_sync_observations').all();
 const oldMinimum=fullDocs.meta.rows_read+fullReports.meta.rows_read;assert.ok(oldMinimum>=count*2);assert.ok(scopedReads<oldMinimum/10);
 measured=measuredDB(db,'legacy-unscoped');await syncObservationsRoute(new Request(origin+'/api/sync-observations'),{DB:measured,FILES:bucket},{});assert.deepEqual(measured.metrics(),[]);
 measured=measuredDB(db,'search');const search=await catalogList(new Request(origin+'/api/documents?includeIndexed=1&q=needle&sort=used'),{DB:measured,FILES:bucket});assert.equal((await search.json()).documents.length,20);
 const searchRows=measured.metrics().reduce((n,q)=>n+q.rowsRead,0);
 measured=measuredDB(db,'warm-search');await catalogList(new Request(origin+'/api/documents?includeIndexed=1&q=needle&sort=used'),{DB:measured,FILES:bucket});const warmSearchRows=measured.metrics().reduce((n,q)=>n+q.rowsRead,0);assert.ok(searchRows<100000); // substring scanning remains bounded by library size
 const plan=await db.prepare("EXPLAIN QUERY PLAN SELECT id,path FROM yebaeon_documents ORDER BY COALESCE(last_used,'') DESC,path LIMIT 101").all();assert.ok(plan.results.some(r=>r.detail.includes('yebaeon_documents_used')));
 console.log(JSON.stringify({event:'synthetic-cost-result',documents:count,statusTargets:20,oldStatusMinimum:oldMinimum,scopedStatus:scopedReads,searchRows,warmSearchRows,searchIncludesFirstCatalogImport:true}));
});

test('one-time migration copies existing dates and preserves old originals and backups',{timeout:90000},async t=>{
 const {db}=await fixture(t);
 // Exercise the legacy shape in an isolated binding, not the production database.
 await db.exec('DROP TABLE yebaeon_documents; DROP TABLE yebaeon_schema_migrations;');
 await db.prepare('CREATE TABLE yebaeon_documents (id TEXT PRIMARY KEY,path TEXT UNIQUE,created_at TEXT,current_version INTEGER,updated_at TEXT,updated_by TEXT,sha256 TEXT,size INTEGER,write_id TEXT)').run();
 const id=randomUUID();await db.prepare('INSERT INTO yebaeon_documents VALUES (?,?,?,2,?,?,?,?,?)').bind(id,'legacy.pro6','old','new','fixture','hash',12,'write').run();
 await db.prepare('INSERT INTO yebaeon_document_usage VALUES (?,2,?,NULL)').bind(id,'2026-09-27T00:00:00Z').run();
 await db.prepare('INSERT INTO yebaeon_versions VALUES (?,1,?,?,12,?,?)').bind(id,'old-object','hash','fixture','old').run();
 await ensureSchema(db);const row=await db.prepare('SELECT * FROM yebaeon_documents WHERE id=?').bind(id).first();assert.equal(row.last_used,'2026-09-27T00:00:00Z');assert.equal(row.usage_version,2);assert.equal(row.history_enabled,1);assert.equal(row.search_enabled,1);
 assert.equal((await db.prepare('SELECT object_key FROM yebaeon_versions WHERE document_id=?').bind(id).first()).object_key,'old-object');
 await db.prepare("UPDATE yebaeon_documents SET last_used='newer'").run();await ensureSchema(db);assert.equal((await db.prepare('SELECT last_used FROM yebaeon_documents WHERE id=?').bind(id).first()).last_used,'newer');
});
