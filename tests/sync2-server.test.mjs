import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
// Sync 2 · 서버 2단계(재설계안 7.1). 로컬 Worker 모사만 쓴다. 운영 D1에는 가지 않는다.
const origin='https://example.test';
const doc=(text,used='2026-10-01T00:00:00Z')=>`<RVPresentationDocument lastDateUsed="${used}"><RVTextElement><NSString rvXMLIvarName="RTFData">${Buffer.from('{\\rtf1 '+text+'}').toString('base64')}</NSString></RVTextElement></RVPresentationDocument>`;
const nodeA='<RVPlaylistNode UUID="A" displayName="1부예배"><array rvXMLIvarName="children"><RVHeaderCue UUID="a" displayName="기도"/><RVHeaderCue UUID="b" displayName="찬양"/></array></RVPlaylistNode>';
const nodeB='<RVPlaylistNode UUID="B" displayName="2부예배"><array rvXMLIvarName="children"><RVHeaderCue UUID="c" displayName="기도"/></array></RVPlaylistNode>';
const playlist=`<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children">${nodeA}${nodeB}</array></RVPlaylistNode></RVPlaylistDocument>`;
async function fixture(t){
 const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'sync2-test'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 let cookie='';
 const call=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin,...headers}});
 const read=async(r,status=200)=>{const text=await r.text();assert.equal(r.status,status,`${r.status} ${text}`);return JSON.parse(text);};
 const login=await call('/session','POST',JSON.stringify({name:'시험',password:'sync2-test'}));await read(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
 return {mf,call,read,db:await mf.getD1Database('DB')};
}

test('Sync 2 change log follows document and node writes; node GET/PUT; manifest',{timeout:90000},async t=>{
 const {call,read,db}=await fixture(t);
 const changes=(since,limit=200)=>call(`/sync/changes?since=${since}&limit=${limit}`).then(r=>read(r));
 assert.deepEqual(await changes(0),{changes:[],next:0,head:0,more:false});
 // 요청 경로의 스키마 확인은 표시 행 하나다.
 assert.ok(await db.prepare("SELECT name FROM yebaeon_schema_migrations WHERE name='schema-ready-remote-v1'").first());

 // 문서 생성·수정 → 'doc' 두 줄. 같은 내용 재저장·버전 충돌은 남지 않는다.
 let d=(await read(await call('/documents?path=찬양/주님.pro6','POST',doc('하나')),201)).document;
 d=(await read(await call('/documents/'+d.id,'PUT',doc('둘'),{'If-Match':`"${d.version}"`}))).document;
 await read(await call('/documents/'+d.id,'PUT',doc('둘'),{'If-Match':`"${d.version}"`}));
 assert.equal((await call('/documents/'+d.id,'PUT',doc('셋'),{'If-Match':'"1"'})).status,409);
 let log=await changes(0);
 assert.deepEqual(log.changes.map(c=>[c.kind,c.entity,c.action,c.version,c.path]),[['doc',d.id,'created',1,'찬양/주님.pro6'],['doc',d.id,'updated',2,'찬양/주님.pro6']]);
 assert.equal(log.changes[1].sha256,d.sha256);assert.equal(log.changes[1].size,d.size);assert.equal(log.changes[1].author,'시험');
 assert.equal(log.head,log.next);

 // 재생목록 등록 → 노드마다 'node created'. 노드 순서 변경 → 그 노드만.
 const library=(await read(await call('/playlists?path=기본.pro6pl','POST',playlist),201)).library;
 const plan=node=>call(`/playlists/${library.id}/plan?node=${node}`).then(r=>read(r));
 const a=await plan('A'),b=await plan('B');
 await read(await call(`/playlists/${library.id}?node=A`,'PATCH',JSON.stringify({baseNodeHash:a.playlist.sha256,items:[{id:'b'},{id:'a'}]}),{'If-Match':`"${a.library.version}"`}));
 log=await changes(log.next);
 assert.deepEqual(log.changes.map(c=>[c.kind,c.entity,c.action]),[['node',library.id+':A','created'],['node',library.id+':B','created'],['node',library.id+':A','updated']]);
 assert.equal(log.changes[0].sha256,a.playlist.sha256);assert.equal(log.changes[2].sha256,(await plan('A')).playlist.sha256);assert.equal(log.changes[2].name,'1부예배');

 // limit=0은 head만, 페이지 나눔과 more
 assert.deepEqual(await changes(0,0),{changes:[],next:0,head:log.next,more:false});
 const first=await changes(0,2);assert.equal(first.changes.length,2);assert.equal(first.more,true);assert.equal(first.head,log.next);
 assert.equal((await changes(first.next)).changes.length,3);
 assert.equal((await call('/sync/changes?since=-1')).status,400);assert.equal((await call('/sync/changes?limit=501')).status,400);

 // 노드 XML: 최신과 지정 버전(노드 이력 표)
 const latest=(await read(await call(`/playlists/${library.id}/nodes?node=A`))).node;
 assert.equal(latest.version,2);assert.equal(latest.sha256,(await plan('A')).playlist.sha256);
 const v1=(await read(await call(`/playlists/${library.id}/nodes?node=A&version=1`))).node;assert.equal(v1.xml,nodeA);
 assert.equal((await call(`/playlists/${library.id}/nodes?node=A&version=9`)).status,404);

 // 노드 교체: Sync 2 머리글 필수, 노드 sha CAS, 노드 하나만, 다른 노드 보존
 const b0=b.playlist.sha256,newB='<RVPlaylistNode UUID="B" displayName="2부예배"><array rvXMLIvarName="children"><RVHeaderCue UUID="d" displayName="광고"/><RVHeaderCue UUID="c" displayName="기도"/></array></RVPlaylistNode>';
 const put=(node,body,headers={'X-YebaeOn-Sync':'2'})=>call(`/playlists/${library.id}/nodes?node=${node}`,'PUT',JSON.stringify(body),headers);
 assert.equal((await put('B',{baseNodeHash:b0,xml:newB},{})).status,426);
 assert.equal((await put('B',{baseNodeHash:b0,xml:newB+nodeA})).status,400);
 assert.equal((await put('A',{baseNodeHash:b0,xml:newB})).status,400);
 assert.equal((await put('B',{baseNodeHash:'0'.repeat(64),xml:newB})).status,409);
 const aBefore=await plan('A');
 const replaced=await read(await put('B',{baseNodeHash:b0,xml:newB}));
 const bAfter=await plan('B');assert.deepEqual(bAfter.items.map(i=>i.id),['d','c']);assert.equal(replaced.playlist.sha256,bAfter.playlist.sha256);
 assert.equal((await plan('A')).playlist.sha256,aBefore.playlist.sha256);
 assert.equal((await put('B',{baseNodeHash:b0,xml:newB})).status,409);
 assert.equal((await put('B',{baseNodeHash:bAfter.playlist.sha256,xml:newB.replace('2부예배','1부예배')})).status,409);
 log=await changes(log.next);assert.deepEqual(log.changes.map(c=>[c.kind,c.entity,c.action]),[['node',library.id+':B','updated']]);

 // 보관 → 'node-state archived'
 const current=await plan('A');
 await read(await call(`/playlists/${library.id}/archive?node=A`,'POST',JSON.stringify({baseNodeHash:current.playlist.sha256}),{'If-Match':`"${current.library.version}"`}));
 log=await changes(log.next);assert.deepEqual(log.changes.map(c=>[c.kind,c.entity,c.action]),[['node-state',library.id+':A','archived']]);

 // manifest: 50개씩 같음·다름·없음(장부 여부 포함) + head
 await db.prepare("INSERT INTO yebaeon_library_catalog(id,path,original_path,size,slide_count,snapshot) VALUES ('11111111-1111-1111-1111-111111111111','찬양/장부곡.pro6','찬양/장부곡.pro6',10,1,'s')").run();
 const manifest=await read(await call('/sync/manifest','POST',JSON.stringify({items:[{path:'찬양/주님.pro6',sha256:d.sha256},{path:'찬양/주님.pro6'.normalize('NFD'),sha256:'0'.repeat(64)},{path:'찬양/장부곡.pro6',sha256:'1'.repeat(64)},{path:'없음.pro6',sha256:'2'.repeat(64)}]})));
 assert.equal(manifest.head,log.next);
 assert.deepEqual(manifest.items,[{path:'찬양/주님.pro6',status:'same',id:d.id,version:2,sha256:d.sha256,size:d.size},{path:'찬양/주님.pro6',status:'different',id:d.id,version:2,sha256:d.sha256,size:d.size},{path:'찬양/장부곡.pro6',status:'missing',catalog:true},{path:'없음.pro6',status:'missing',catalog:false}]);
 assert.equal((await call('/sync/manifest','POST',JSON.stringify({items:Array.from({length:51},(_,i)=>({path:i+'.pro6',sha256:'0'.repeat(64)}))}))).status,400);
});

test('Sync 2 usage keeps the newest date without a version; document PUT keeps the reported date',{timeout:90000},async t=>{
 const {call,read}=await fixture(t);
 let d=(await read(await call('/documents?path=광고.pro6','POST',doc('광고','2026-09-01T00:00:00Z')),201)).document;
 const usage=items=>call('/sync/usage','POST',JSON.stringify({items}));
 const get=async()=>(await read(await call('/documents/'+d.id))).document;
 assert.deepEqual(await read(await usage([{id:d.id,lastDateUsed:'2026-10-04T01:00:00+09:00',usedCount:7},{id:d.id,lastDateUsed:'2026-10-03T00:00:00Z'}])),{updated:1});
 let saved=await get();assert.equal(saved.version,1);assert.equal(saved.lastDateUsed,'2026-10-03T16:00:00.000Z');
 assert.deepEqual(await read(await usage([{id:d.id,lastDateUsed:'2026-09-02T00:00:00Z',usedCount:3}])),{updated:0});
 assert.equal((await get()).lastDateUsed,'2026-10-03T16:00:00.000Z');
 assert.equal((await usage([{id:d.id,lastDateUsed:'어제'}])).status,400);
 assert.equal((await usage([{id:'x',lastDateUsed:'2026-10-04T00:00:00Z'}])).status,400);
 assert.deepEqual(await read(await usage([{id:'22222222-2222-2222-2222-222222222222',lastDateUsed:'2026-10-04T00:00:00Z'}])),{updated:0});
 // 웹 저장의 XML에 옛 사용일이 들어 있어도 더 최근 값이 남는다.
 d=(await read(await call('/documents/'+d.id,'PUT',doc('광고 수정','2026-09-01T00:00:00Z'),{'If-Match':`"${saved.version}"`}))).document;
 assert.equal(d.lastDateUsed,'2026-10-03T16:00:00.000Z');assert.equal((await get()).lastDateUsed,'2026-10-03T16:00:00.000Z');
 d=(await read(await call('/documents/'+d.id,'PUT',doc('광고 다시','2026-10-05T00:00:00Z'),{'If-Match':`"${d.version}"`}))).document;
 assert.equal(d.lastDateUsed,'2026-10-05T00:00:00.000Z');
});

test('Sync 2 Mac revisions are kept apart from current documents',{timeout:90000},async t=>{
 const {call,read}=await fixture(t);
 const d=(await read(await call('/documents?path=기도.pro6','POST',doc('서버')),201)).document;
 const before=await read(await call('/sync/changes?since=0&limit=0'));
 const post=(query,body)=>call('/sync/revisions?'+query,'POST',body,{'Content-Type':'application/xml'});
 const r1=(await read(await post(`kind=doc&id=${d.id}&baseVersion=1`,doc('교회 Mac')),201)).revision;
 assert.equal(r1.entity,d.id);assert.equal(r1.path,'기도.pro6');assert.equal(r1.reason,'both-changed');assert.equal(r1.author,'시험');
 assert.equal((await read(await post(`kind=doc&id=${d.id}&baseVersion=1`,doc('교회 Mac')))).unchanged,true);
 await read(await post(`kind=doc&id=${d.id}&baseVersion=1&reason=technical`,doc('바이트만 다름')),201);
 assert.equal((await post(`kind=doc&id=${d.id}&baseVersion=1`,'<nope/>')).status,400);
 assert.equal((await post(`kind=doc&id=${d.id}&baseVersion=1&reason=other`,doc('x'))).status,400);
 // 기술적 차이 보관본은 기본 목록에서 숨긴다.
 assert.deepEqual((await read(await call('/sync/revisions?entity='+d.id))).revisions.map(r=>r.id),[r1.id]);
 assert.equal((await read(await call('/sync/revisions?technical=1&entity='+d.id))).revisions.length,2);
 const content=await call(`/sync/revisions/${r1.id}/content`);assert.equal(await content.text(),doc('교회 Mac'));
 // 현재본·일지는 그대로
 assert.equal((await read(await call('/documents/'+d.id))).document.version,1);
 assert.equal((await read(await call('/sync/changes?since=0&limit=0'))).head,before.head);
 // 노드 보관본
 const library=(await read(await call('/playlists?path=기본.pro6pl','POST',playlist),201)).library;
 const rn=(await read(await post(`kind=node&library=${library.id}&node=A&reason=removed-node`,nodeA),201)).revision;assert.equal(rn.entity,library.id+':A');
 assert.equal((await post(`kind=node&library=${library.id}&node=A`,'<RVPresentationDocument/>')).status,400);
});

test('Sync 2 device keys: issue, use, report applied, revoke',{timeout:90000},async t=>{
 const {mf,call,read}=await fixture(t);
 const issued=await read(await call('/sync/devices','POST',JSON.stringify({name:'교회 Mac'})),201);
 assert.match(issued.token,/^ybd_[0-9a-f]{32}_[0-9a-f]{64}$/);
 const listed=await read(await call('/sync/devices'));assert.deepEqual(listed.devices.map(x=>[x.name,x.appliedSeq,x.pending]),[['교회 Mac',0,[]]]);assert.equal(JSON.stringify(listed).includes(issued.token.slice(-64)),false);
 const asDevice=(path,method='GET',body)=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+issued.token}});
 assert.equal((await read(await asDevice('/sync/changes?since=0'))).head,0);
 assert.equal((await asDevice('/sync/devices','POST',JSON.stringify({name:'다른 Mac'}))).status,403);
 assert.equal((await asDevice('/sync/devices/'+issued.device.id,'DELETE')).status,403);
 // 장치로 저장한 문서는 장치 이름이 작성자이고 일지에도 그렇게 남는다.
 const byDevice=(await read(await asDevice('/documents?path=광고/이번주.pro6','POST',doc('광고')),201)).document;assert.equal(byDevice.updatedBy,'교회 Mac');
 assert.equal((await read(await call('/sync/changes?since=0'))).changes[0].author,'교회 Mac');
 // 적용 보고: 커서는 뒤로 가지 않는다. 다른 장치·사람 세션은 보고할 수 없다.
 const report=(seq,pending)=>asDevice(`/sync/devices/${issued.device.id}/applied`,'POST',JSON.stringify({seq,pending}));
 await read(await report(5,[{kind:'node',entity:'L:A',reason:'PP6 실행 중'}]));await read(await report(3,[]));
 assert.deepEqual((await read(await call('/sync/devices'))).devices.map(x=>[x.appliedSeq,x.pending]),[[5,[]]]);
 assert.equal((await call(`/sync/devices/${issued.device.id}/applied`,'POST',JSON.stringify({seq:9}))).status,403);
 assert.equal((await report(-1,[])).status,400);
 assert.equal((await mf.dispatchFetch(origin+'/api/sync/changes',{headers:{Authorization:'Bearer ybd_'+'0'.repeat(32)+'_'+'0'.repeat(64)}})).status,401);
 assert.equal((await mf.dispatchFetch(origin+'/api/sync/changes',{headers:{Authorization:'Bearer nonsense'}})).status,401);
 await read(await call('/sync/devices/'+issued.device.id,'DELETE'));
 assert.equal((await asDevice('/sync/changes')).status,401);
 assert.equal((await call('/sync/devices/'+issued.device.id,'DELETE')).status,404);
 assert.deepEqual((await read(await call('/sync/devices'))).devices,[]);
 assert.equal((await mf.dispatchFetch(origin+'/api/sync/changes')).status,401);
});

test('Studio sync lights follow Sync 2: applied cursor, held services, the device\'s own uploads',{timeout:90000},async t=>{
 const {mf,call,read}=await fixture(t);
 const issued=await read(await call('/sync/devices','POST',JSON.stringify({name:'한우리'})),201);
 const asDevice=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+issued.token,...headers}});
 const report=(seq,pending=[])=>asDevice(`/sync/devices/${issued.device.id}/applied`,'POST',JSON.stringify({seq,pending}));
 const head=async()=>(await read(await call('/sync/changes?since=0&limit=0'))).head;
 const lights=async targets=>(await read(await call('/sync-observations?'+new URLSearchParams({targets:JSON.stringify(targets)})))).items;
 const monday=(await read(await call('/documents?path=월요일.pro6','POST',doc('월요일')),201)).document,target=[{kind:'document',id:monday.id,node:''}];
 assert.deepEqual(await lights(target),{},'no applied report yet: unknown');
 await read(await report(await head()));
 assert.equal((await lights(target))['document/'+monday.id+'/'].state,'synced','the Mac applied past the last change');
 const saved=(await read(await call('/documents/'+monday.id,'PUT',doc('월요일 v2'),{'If-Match':`"${monday.version}"`}))).document;
 const after=(await lights(target))['document/'+monday.id+'/'];assert.equal(after.state,'pending');assert.match(after.reason,/Mac이 아직 받지 않음/);assert.equal(after.author,'한우리');
 await read(await report(await head()));assert.equal((await lights(target))['document/'+monday.id+'/'].state,'synced','a later applied report clears it');
 // 장치가 스스로 올린 변경은 Mac에 이미 있다.
 await read(await asDevice('/documents/'+monday.id,'PUT',doc('월요일 Mac'),{'If-Match':`"${saved.version}"`}));assert.equal((await lights(target))['document/'+monday.id+'/'].state,'synced');
 // 보류한 예배는 이유와 함께 노란불.
 const library=(await read(await call('/playlists?path=기본.pro6pl','POST',playlist),201)).library;
 await read(await report(await head(),[{kind:'node',entity:library.id+':A',reason:'적용 대기'}]));
 const nodes=await lights([{kind:'playlist',id:library.id,node:'A'},{kind:'playlist',id:library.id,node:'B'}]);
 assert.equal(nodes['playlist/'+library.id+'/A'].state,'pending');assert.match(nodes['playlist/'+library.id+'/A'].reason,/적용 대기/);assert.equal(nodes['playlist/'+library.id+'/B'].state,'synced');
});
