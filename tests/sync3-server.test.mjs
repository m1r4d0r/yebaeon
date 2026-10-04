import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
// 서버 3차: 문서·예배의 보관함·휴지통·이름 바꾸기, 없을 때만 추가, 관리자 잠금, 카테고리 정책표, 편집 중 표시, 이미지 경로표, R2 장부.
// 로컬 Worker 모사만 쓴다.
const origin='https://example.test';
const doc=(text,category='')=>`<RVPresentationDocument${category?` category="${category}"`:''} lastDateUsed="2026-10-01T00:00:00Z"><RVTextElement><NSString rvXMLIvarName="RTFData">${Buffer.from('{\\rtf1 '+text+'}').toString('base64')}</NSString></RVTextElement></RVPresentationDocument>`;
const ROOT='~/Documents/ProPresenter6';
const cue=(uuid,path)=>`<RVDocumentCue UUID="${uuid}" displayName="${path.replace(/\.pro6$/,'')}" filePath="${ROOT}/${path}" selectedArrangementID=""/>`;
const node=(id,name,cues)=>`<RVPlaylistNode UUID="${id}" displayName="${name}"><array rvXMLIvarName="children">${cues.join('')}</array></RVPlaylistNode>`;
async function fixture(t,bindings={}){
 const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'sync3-test',...bindings},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 const read=async(r,status=200)=>{const text=await r.text();assert.equal(r.status,status,`${r.status} ${text}`);return text?JSON.parse(text):null;};
 const person=async name=>{
  const login=await mf.dispatchFetch(origin+'/api/session',{method:'POST',body:JSON.stringify({name,password:'sync3-test'}),headers:{'Content-Type':'application/json',Origin:origin}});await read(login);
  let cookie=login.headers.get('Set-Cookie').split(';')[0];
  const call=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin,...headers}});
  return {call,addCookie:c=>{cookie+='; '+c.split(';')[0];}};
 };
 return {mf,read,person,db:await mf.getD1Database('DB')};
}
const changes=async(call,read,since)=>(await read(await call('/sync/changes?since='+since))).changes;

test('documents: archive, trash, untrash and rename with playlist references',{timeout:90000},async t=>{
 const {read,person}=await fixture(t);const {call}=await person('지은');
 const a=(await read(await call('/documents?path=주일말씀.pro6','POST',doc('말씀')),201)).document;
 const b=(await read(await call('/documents?path=광고.pro6','POST',doc('광고')),201)).document;
 const library=(await read(await call('/playlists?path=기본.pro6pl&root='+encodeURIComponent(ROOT),'POST',`<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children">${node('A','1부',[cue('c1','주일말씀.pro6'),cue('c2','광고.pro6')])}${node('B','2부',[cue('c3','주일말씀.pro6')])}</array></RVPlaylistNode></RVPlaylistDocument>`),201)).library;
 const head=(await read(await call('/sync/changes?since=0&limit=0'))).head;
 const list=state=>call('/documents'+(state?'?state='+state:'')).then(r=>read(r)).then(x=>x.documents.map(d=>d.path).sort());
 const state=(d,action)=>call(`/documents/${d.id}/state`,'POST',JSON.stringify({action}));
 // 보관: 기본 목록·검색에서 빠지고 보관함에 보인다.
 assert.equal((await read(await state(b,'archive'))).document.state,'archived');
 assert.deepEqual(await list(),['주일말씀.pro6']);assert.deepEqual(await list('archived'),['광고.pro6']);
 assert.equal((await read(await call('/documents?includeIndexed=1&q=광고'))).documents.length,0);
 assert.equal((await read(await call('/documents?includeIndexed=1&includeArchived=1&q=광고'))).documents.length,1);
 assert.equal((await state(b,'untrash')).status,409);
 // 휴지통: 저장·이름 바꾸기 막힘, 꺼내면 사용 중으로
 await read(await state(b,'trash'));assert.deepEqual(await list('trashed'),['광고.pro6']);
 assert.equal((await call(`/documents/${b.id}`,'PUT',doc('광고2'),{'If-Match':'"1"'})).status,409);
 assert.equal((await read(await call('/documents?includeIndexed=1&includeArchived=1&q=광고'))).documents.length,0);
 await read(await state(b,'untrash'));assert.deepEqual(await list(),['광고.pro6','주일말씀.pro6']);
 assert.equal((await read(await state(b,'untrash'))).unchanged,true);
 assert.equal((await state(b,'delete')).status,400);
 // 이름 바꾸기: 버전 필요, 겹치면 거절, 두 예배의 참조가 함께 바뀐다.
 assert.equal((await call(`/documents/${a.id}/rename`,'POST',JSON.stringify({path:'주일예배말씀.pro6'}))).status,428);
 assert.equal((await call(`/documents/${a.id}/rename`,'POST',JSON.stringify({path:'광고.pro6'}),{'If-Match':'"1"'})).status,409);
 const renamed=await read(await call(`/documents/${a.id}/rename`,'POST',JSON.stringify({path:'주일예배말씀.pro6'}),{'If-Match':'"1"'}));
 assert.equal(renamed.document.path,'주일예배말씀.pro6');assert.equal(renamed.previousPath,'주일말씀.pro6');assert.deepEqual(renamed.playlists,[library.id]);
 for(const n of ['A','B']){const plan=await read(await call(`/playlists/${library.id}/plan?node=${n}`));const item=plan.items.find(i=>i.path?.includes('말씀'));assert.equal(item.path,'주일예배말씀.pro6');assert.equal(item.document.id,a.id);assert.equal(item.name,'주일예배말씀');}
 assert.equal((await read(await call(`/documents/${a.id}`))).document.version,1);
 const log=await changes(call,read,head);
 assert.deepEqual(log.map(c=>[c.kind,c.action,c.entity===b.id||c.entity===a.id?'doc':c.entity]),[['doc','archived','doc'],['doc','trashed','doc'],['doc','untrashed','doc'],['doc','renamed','doc'],['node','updated',library.id+':A'],['node','updated',library.id+':B']]);
 assert.equal(log[3].previous,'주일말씀.pro6');assert.equal(log[3].path,'주일예배말씀.pro6');
});

test('playlists: trash goes to a restorable trash, rename, add-if-absent',{timeout:90000},async t=>{
 const {read,person}=await fixture(t);const {call}=await person('지은');
 const library=(await read(await call('/playlists?path=기본.pro6pl','POST',`<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children">${node('A','1부',[])}${node('B','2부',[])}</array></RVPlaylistNode></RVPlaylistDocument>`),201)).library;
 const tag=async()=>({'If-Match':`"${(await read(await call('/playlists/'+library.id))).library.version}"`});
 const head=(await read(await call('/sync/changes?since=0&limit=0'))).head;
 // 삭제는 휴지통으로 간다(사본이 남아 꺼낼 수 있다).
 await read(await call(`/playlists/${library.id}/nodes?node=B`,'DELETE',undefined,await tag()));
 assert.deepEqual((await read(await call('/playlists?scope=trashed'))).archives.map(x=>x.id),['B']);
 assert.equal((await read(await call(`/playlists/${library.id}/trash?node=B`))).name,'2부');
 await read(await call(`/playlists/${library.id}/untrash?node=B`,'POST','{}',await tag()));
 assert.deepEqual((await read(await call('/playlists?scope=trashed'))).archives,[]);
 assert.ok((await read(await call('/playlists/'+library.id))).library.playlists.some(p=>p.id==='B'));
 // 예배 이름 바꾸기
 const plan=await read(await call(`/playlists/${library.id}/plan?node=A`));
 assert.equal((await call(`/playlists/${library.id}/rename?node=A`,'POST',JSON.stringify({name:'2부',baseNodeHash:plan.playlist.sha256}))).status,409);
 await read(await call(`/playlists/${library.id}/rename?node=A`,'POST',JSON.stringify({name:'1부 예배',baseNodeHash:plan.playlist.sha256})));
 assert.equal((await call(`/playlists/${library.id}/rename?node=A`,'POST',JSON.stringify({name:'다시',baseNodeHash:plan.playlist.sha256}))).status,409);
 // 없을 때만 추가(Sync 2): 새로 만듦, 같은 것은 그대로, 다른 것은 거절, 보관·휴지통 번호는 되살리지 않음
 const add=(id,xml)=>call(`/playlists/${library.id}/nodes?node=${id}`,'POST',JSON.stringify({xml}),{'X-YebaeOn-Sync':'2'});
 const fresh=node('C','PP6에서 만든 예배',[]);
 assert.equal((await add('C',fresh)).status,201);assert.equal((await read(await add('C',fresh))).unchanged,true);
 assert.equal((await add('C',node('C','다른 내용',[]))).status,409);
 assert.equal((await add('D',node('D','1부 예배',[]))).status,409);
 await read(await call(`/playlists/${library.id}/archive?node=C`,'POST','{}',await tag()));
 const blocked=await add('C',fresh);assert.equal(blocked.status,409);assert.equal(blocked.headers.get('X-YebaeOn-Node-State'),'archived');
 const log=await changes(call,read,head);
 assert.deepEqual(log.map(c=>[c.kind,c.action,c.entity.split(':')[1]]),[['node-state','trashed','B'],['node','created','B'],['node-state','untrashed','B'],['node','updated','A'],['node','renamed','A'],['node','created','C'],['node-state','archived','C']]);
 assert.equal(log[4].previous,'1부');assert.equal(log[4].name,'1부 예배');
});

test('admin lock: empty trash and revision resolution need the admin password',{timeout:90000},async t=>{
 const off=await fixture(t);const visitor=await off.person('누구');
 assert.equal((await off.read(await visitor.call('/admin'))).configured,false);
 assert.equal((await visitor.call('/admin/trash','POST',JSON.stringify({kind:'documents'}))).status,503);
 const {read,person,db}=await fixture(t,{ADMIN_PASSWORD:'admin-secret-1'});
 const user=await person('지은'),other=await person('은혜');
 const d=(await read(await user.call('/documents?path=지울것.pro6','POST',doc('x')),201)).document;
 await read(await user.call(`/documents/${d.id}/state`,'POST',JSON.stringify({action:'trash'})));
 assert.equal((await user.call('/admin/trash','POST',JSON.stringify({kind:'documents'}))).status,403);
 assert.equal((await user.call('/admin','POST',JSON.stringify({password:'틀림'}))).status,401);
 const granted=await user.call('/admin','POST',JSON.stringify({password:'admin-secret-1'}));await read(granted);user.addCookie(granted.headers.get('Set-Cookie'));
 assert.equal((await read(await user.call('/admin'))).admin,true);
 // 관리자 표시는 그 세션에만 묶인다.
 other.addCookie(granted.headers.get('Set-Cookie'));assert.equal((await read(await other.call('/admin'))).admin,false);
 const head=(await read(await user.call('/sync/changes?since=0&limit=0'))).head;
 assert.deepEqual(await read(await user.call('/admin/trash','POST',JSON.stringify({kind:'documents'}))),{purged:1,remaining:0,kept:[]});
 assert.equal((await user.call(`/documents/${d.id}`)).status,404);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM yebaeon_versions WHERE document_id=?').bind(d.id).first()).n,0);
 assert.deepEqual((await changes(user.call,read,head)).map(c=>c.action),['purged']);
 // 예배 휴지통 비우기는 사본과 이력을 지운다.
 const library=(await read(await user.call('/playlists?path=기본.pro6pl','POST',`<RVPlaylistDocument><RVPlaylistNode UUID="ROOT"><array rvXMLIvarName="children">${node('A','1부',[])}</array></RVPlaylistNode></RVPlaylistDocument>`),201)).library;
 await read(await user.call(`/playlists/${library.id}/nodes?node=A`,'DELETE',undefined,{'If-Match':'"1"'}));
 assert.deepEqual(await read(await user.call('/admin/trash','POST',JSON.stringify({kind:'playlists'}))),{purged:1,remaining:0});
 assert.equal((await db.prepare("SELECT state FROM yebaeon_playlist_controls WHERE node_id='A'").first()).state,'removed');
 // 사용 중인 재생목록에 든 문서는 비우지 않는다.
 const used=(await read(await user.call('/documents?path=쓰는것.pro6','POST',doc('u')),201)).document;
 await read(await user.call(`/playlists/${library.id}/nodes?node=B`,'POST',JSON.stringify({xml:node('B','2부',[cue('c1','쓰는것.pro6')])}),{'X-YebaeOn-Sync':'2'}),201);
 await read(await user.call(`/documents/${used.id}/state`,'POST',JSON.stringify({action:'trash'})));
 assert.deepEqual(await read(await user.call('/admin/trash','POST',JSON.stringify({kind:'documents'}))),{purged:0,remaining:1,kept:['쓰는것.pro6']});
 assert.equal((await user.call(`/documents/${used.id}`)).status,200);
 // 보관본 해결은 관리자만
 const r=(await read(await other.call(`/sync/revisions?kind=doc&id=${(await read(await user.call('/documents?path=남길것.pro6','POST',doc('y')),201)).document.id}&baseVersion=1`,'POST',doc('Mac'),{'Content-Type':'application/xml'}),201)).revision;
 assert.equal((await other.call(`/sync/revisions/${r.id}/resolve`,'POST',JSON.stringify({resolution:'dismissed'}))).status,403);
 await read(await user.call(`/sync/revisions/${r.id}/resolve`,'POST',JSON.stringify({resolution:'dismissed'})));
 assert.equal((await read(await user.call('/sync/revisions'))).revisions.length,0);
 await read(await user.call('/admin','DELETE'));
});

test('categories table, Studio category requirement and editing notice',{timeout:90000},async t=>{
 const {read,person}=await fixture(t,{ADMIN_PASSWORD:'admin-secret-1'});const a=await person('지은'),b=await person('은혜');
 assert.deepEqual((await read(await a.call('/categories'))).categories.map(c=>c.name),['가사찬양','악보찬양','예배순서','특별순서','옛날자료']);
 assert.equal((await read(await a.call('/categories','POST',JSON.stringify({name:'주보',searchEnabled:false,historyEnabled:true})),201)).category.searchEnabled,false);
 assert.equal((await a.call('/categories','POST',JSON.stringify({name:'주보'}))).status,409);
 assert.equal((await a.call('/categories/'+encodeURIComponent('주보'),'PUT',JSON.stringify({searchEnabled:true,historyEnabled:true}))).status,403);
 // Studio 새 문서는 카테고리 필수, 새 카테고리 정책이 바로 적용된다.
 assert.equal((await a.call('/documents?path=새문서.pro6','POST',doc('x'),{'X-YebaeOn-Client':'studio'})).status,400);
 const created=(await read(await a.call('/documents?path=새문서.pro6','POST',doc('x','주보'),{'X-YebaeOn-Client':'studio'}),201)).document;
 assert.equal(created.category,'주보');assert.equal(created.searchEnabled,false);assert.equal(created.categoryManaged,true);
 assert.equal((await a.call('/documents?path=맥문서.pro6','POST',doc('x'))).status,201);
 // 편집 중 표시: 다른 사람이 연 것만 보인다. 닫으면 사라진다.
 assert.deepEqual((await read(await a.call('/editing','POST',JSON.stringify({kind:'doc',entity:created.id})))).others,[]);
 const seen=(await read(await b.call('/editing','POST',JSON.stringify({kind:'doc',entity:created.id})))).others;assert.deepEqual(seen.map(x=>x.author),['지은']);
 await read(await a.call('/editing','DELETE',JSON.stringify({kind:'doc',entity:created.id})));
 assert.deepEqual((await read(await b.call('/editing','POST',JSON.stringify({kind:'doc',entity:created.id})))).others,[]);
 assert.deepEqual((await read(await a.call('/editing?kind=doc&entity='+created.id))).others.map(x=>x.author),['은혜']);
 assert.equal((await a.call('/editing','POST',JSON.stringify({kind:'x',entity:'y'}))).status,400);
 // 이름 겹침: 휴지통 문서도 이름을 차지한다. 빈 번호를 제안한다.
 await read(await a.call('/documents?path='+encodeURIComponent('새문서 2.pro6'),'POST',doc('y')),201);
 assert.deepEqual(await read(await a.call('/documents?checkPath='+encodeURIComponent('새문서'))),{path:'새문서.pro6',available:false,suggestion:'새문서 3.pro6'});
 assert.deepEqual(await read(await a.call('/documents?checkPath='+encodeURIComponent('아무도 없는 이름.pro6'))),{path:'아무도 없는 이름.pro6',available:true,suggestion:null});
});

test('media paths and the R2 ledger follow the change log',{timeout:90000},async t=>{
 const {mf,read,person}=await fixture(t);const {call}=await person('지은');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'),sha=createHash('sha256').update(png).digest('hex');
 const root='/Users/Shared/Renewed Vision Media/';
 const reg=items=>call('/media/paths','PUT',JSON.stringify({items}));
 let r=await read(await reg([{path:root+'Images/표지.png',sha256:sha,size:png.length},{path:'/Users/Shared/다른곳/x.png',sha256:sha,size:png.length}]));
 assert.deepEqual(r,{registered:0,changed:0,missing:[root+'Images/표지.png'],outside:['/Users/Shared/다른곳/x.png']});
 await read(await call(`/media/${sha}/content`,'PUT',png,{'Content-Type':'image/png','X-Yebaeon-SHA256':sha}),201);
 r=await read(await reg([{path:'file://'+encodeURI(root+'ImportedImages/발표/Slide1.png'.normalize('NFD')),sha256:sha,size:png.length},{path:root+'Images/표지.png',sha256:sha,size:png.length}]));
 assert.deepEqual(r,{registered:2,changed:2,missing:[],outside:[]});
 assert.equal((await read(await reg([{path:root+'Images/표지.png',sha256:sha,size:png.length}]))).changed,0);
 assert.deepEqual((await read(await call('/media/paths'))).paths.map(p=>p.path),[root+'Images/표지.png',root+'ImportedImages/발표/Slide1.png']);
 // 장부: 처음엔 전체를 만들고, 그 뒤엔 일지 변동분만 반영한다.
 const d=(await read(await call('/documents?path=말씀.pro6','POST',doc('v1')),201)).document;
 let ledger=await read(await call('/sync/ledger'));
 assert.deepEqual(ledger.documents.map(x=>[x.path,x.version,x.state]),[['말씀.pro6',1,'active']]);assert.equal(ledger.media.length,2);
 const etag=`"ledger-${ledger.seq}"`;assert.equal((await call('/sync/ledger','GET',undefined,{'If-None-Match':etag})).status,304);
 await read(await call(`/documents/${d.id}`,'PUT',doc('v2'),{'If-Match':'"1"'}));
 await read(await call('/documents?path=광고.pro6','POST',doc('ad')),201);
 await read(await call(`/documents/${d.id}/state`,'POST',JSON.stringify({action:'trash'})));
 ledger=await read(await call('/sync/ledger'));
 assert.deepEqual(ledger.documents.map(x=>[x.path,x.version,x.state]),[['광고.pro6',1,'active'],['말씀.pro6',2,'trashed']]);
 assert.equal(ledger.seq,(await read(await call('/sync/changes?since=0&limit=0'))).head);
 const stored=JSON.parse(await (await (await mf.getR2Bucket('FILES')).get('ledger/library.json')).text());assert.equal(stored.seq,ledger.seq);
});
