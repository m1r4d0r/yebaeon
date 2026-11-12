// 영광임하소서 목록: 검색 칩, 순서 권장 안내와 바로 바꾸기, 목록 창 붙여넣기. 합성 자료만 쓴다.
const {chromium}=require('playwright'),{createServer}=require('node:http');
const {readFile,mkdir}=require('node:fs/promises'),{resolve,extname,sep}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const {build}=await import('esbuild'),{Miniflare,convertV4MiniflareOptions}=await import('miniflare');
 const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'browser-only',ADMIN_PASSWORD:'admin-only-1'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
 const root=resolve('web-editor');let origin;
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){const parts=[];for await(const part of req)parts.push(part);const response=await mf.dispatchFetch(url,{method:req.method,headers:req.headers,...parts.length?{body:Buffer.concat(parts)}:{}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(url.pathname.startsWith('/resources/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.endsWith('catalog.json')?{fonts:[],media:[]}:[]));return;}
  const path=resolve(root,'.'+url.pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+sep))throw Error('path');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']}:undefined);
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const openPlaylists=async()=>{if(!await page.locator('#studioPlaylistsDialog').evaluate(e=>e.open))await page.locator('#studioPlaylistPicker').click();};
 const openSongbook=async()=>{await page.locator('#cloudAccount').click();await page.locator('#songbookOpen').click();await page.locator('#songbookDialog[open]').waitFor();await page.waitForFunction(()=>!/불러오고/.test(document.getElementById('songbookMessage').textContent));};
 const search=async q=>{await page.locator('#libraryQuery').fill(q);await page.locator('#libraryQuery').press('Enter');await page.waitForFunction(()=>!/검색하고/.test(document.getElementById('libraryMessage').textContent)&&document.querySelector('#libraryList .document-item'));};
 try{
  await page.goto(origin);await page.locator('#entryName').fill('목록 시험');await page.locator('#entryPassword').fill('browser-only');await page.locator('#entrySubmit').click();await page.locator('#entryDialog').waitFor({state:'hidden'});
  const ids=await page.evaluate(async()=>{const make=async(name,category)=>(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:name+'.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:YebaeonLibraryActions.blankDocument(category)})).json()).document.id;
   return {listScore:await make('합성 찬양 하나_Wide','악보찬양'),listLyrics:await make('합성 찬양 하나','가사찬양'),freeLyrics:await make('목록밖 노래 하나','가사찬양'),freeScore:await make('목록밖 노래 하나 둘','악보찬양'),order:await make('합성 예배순서','예배순서'),second:await make('둘째 합성 곡','악보찬양')};});

  // 관리자가 아니면 관리 버튼이 없다
  await openSongbook();
  assert.equal(await page.locator('#songbookPaste').isVisible(),false);assert.equal(await page.locator('#songbookAdd').isVisible(),false);
  assert.match(await page.locator('#songbookRows').textContent(),/목록이 비어/);
  await page.locator('#songbookDialog .panel-close').first().click();

  // 관리자 확인 뒤 목록 붙여넣기: 미리보기·오류·저장
  await page.evaluate(()=>YebaeonCloud.api('/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'admin-only-1'})}));
  await openSongbook();
  await page.locator('#songbookPaste').click();await page.locator('#songbookPasteText').waitFor();
  const paste=async text=>{await page.locator('#songbookPasteText').fill(text);await page.waitForFunction(()=>document.querySelector('#songbookPreview .songbook-preview-sum')&&!document.querySelector('#songbookPreview .hint'));};
  await paste(`번호\t조\t검색어\t연결\t아님\n58\tG\t합성 찬양 하나/다른 이름\t${ids.listLyrics},${ids.order}\t\n7\tAm\t둘째 합성 곡\t00000000-0000-4000-8000-000000000000`);
  const problems=await page.locator('#songbookPreview .songbook-errors').textContent();
  assert.match(problems,/예배순서 문서라 연결할 수 없습니다/);assert.match(problems,/서버에 없는 문서/);
  assert.equal(await page.locator('#songbookPasteSave').isDisabled(),true,'오류가 있으면 저장 단추를 끈다');
  await paste(`번호\t조\t검색어\t연결\t아님\n58\tG\t합성 찬양 하나/다른 이름\t${ids.listLyrics},${ids.listScore}\t\n7\tAm\t둘째 합성 곡\t\t`);
  assert.match(await page.locator('#songbookPreview .songbook-preview-sum').textContent(),/곡 2 · 연결 2.*새로 2 · 바뀜 0 · 빠짐 0/);
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/songbook-paste.png'});
  await page.locator('#songbookPasteSave').click();await page.locator('.songbook-paste').waitFor({state:'detached'});
  assert.equal(await page.locator('#songbookRows .songbook-row:not(.songbook-head)').count(),2);
  assert.match(await page.locator('#songbookRows [data-number="58"]').textContent(),/합성 찬양 하나.*다른 이름.*합성 찬양 하나.*합성 찬양 하나_Wide/);
  assert.match(await page.locator('.songbook-filter [data-filter="empty"]').textContent(),/문서 없음 1/);
  await page.screenshot({path:'artifacts/songbook-list.png'});
  // 확인 필요: 이름이 같은 사용 중 찬양 문서가 후보. [고르기] → [연결]
  assert.match(await page.locator('.songbook-filter [data-filter="check"]').textContent(),/확인 필요 1/);
  assert.match(await page.locator('#songbookRows [data-number="7"]').textContent(),/후보 1/);
  await page.locator('#songbookRows [data-number="7"]').getByRole('button',{name:'고르기'}).click();
  await page.locator('.songbook-pick .songbook-pick-row',{hasText:'둘째 합성 곡'}).getByRole('button',{name:'연결',exact:true}).click();
  await page.waitForFunction(()=>/연결했습니다/.test(document.querySelector('.songbook-pick .panel-foot').textContent));
  await page.locator('.songbook-pick .panel-close').click();
  assert.match(await page.locator('.songbook-filter [data-filter="check"]').textContent(),/확인 필요 0/);
  assert.match(await page.locator('#songbookRows [data-number="7"]').textContent(),/둘째 합성 곡/);
  await page.locator('#songbookDialog .panel-close').first().click();

  // 검색 결과 칩: 목록 곡은 가사 칠함·악보 테두리, 목록 밖은 반대. 같은 곡의 가사를 악보 바로 앞에
  await search('합성 찬양 하나');
  const listed=await page.locator('#libraryList .document-item').evaluateAll(rows=>rows.map(r=>({name:r.querySelector('strong').firstChild.textContent,number:r.querySelector('.song-number')?.textContent||'',chip:r.querySelector('.song-chip')?.className||''})));
  assert.deepEqual(listed.map(x=>x.name),['합성 찬양 하나','합성 찬양 하나_Wide'],'가사를 같은 곡 악보 바로 앞에');
  assert.match(listed[0].chip,/lyrics rec/);assert.match(listed[1].chip,/score/);assert.doesNotMatch(listed[1].chip,/rec/);
  assert.deepEqual(listed.map(x=>x.number),['영 58','영 58']);await page.screenshot({path:'artifacts/songbook-search.png',clip:{x:0,y:0,width:420,height:320}});
  await search('목록밖 노래 하나');
  const free=await page.locator('#libraryList .document-item').evaluateAll(rows=>rows.map(r=>({name:r.querySelector('strong').textContent,chip:r.querySelector('.song-chip')?.className||''})));
  assert.match(free.find(x=>x.name==='목록밖 노래 하나').chip,/lyrics/);assert.doesNotMatch(free.find(x=>x.name==='목록밖 노래 하나').chip,/rec/);
  assert.match(free.find(x=>x.name==='목록밖 노래 하나 둘').chip,/score rec/);
  await search('합성 예배순서');assert.equal(await page.locator('#libraryList .song-chip').count(),0,'다른 카테고리에는 표시하지 않는다');

  // 순서: 목록 밖 가사 → '악보찬양 있음' → [악보로 바꾸기]가 그 자리를 바꾸고 바로 저장. 목록 곡 악보 → '가사찬양 있음'
  await openPlaylists();await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill('권장 예배');await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>YebaeonPlaylists.selectedPlaylist()?.name==='권장 예배');
  await page.evaluate(async ids=>{const get=async id=>(await(await YebaeonCloud.api('/documents/'+id)).json()).document;YebaeonPlaylists.appendDocuments([await get(ids.freeLyrics),await get(ids.listScore),await get(ids.order)]);await YebaeonPlaylists.save();const s=YebaeonPlaylists.selectedPlaylist();const [lib,node]=s.key.split('/');await YebaeonPlaylists.openNode(lib,node);},ids);
  await page.locator('#playlistItems .order-song-hint').nth(1).waitFor();
  assert.equal(await page.locator('#playlistSongHints').textContent(),'악보 권장 1 · 가사 권장 1');
  const rows=page.locator('#playlistItems .order-item');
  assert.match(await rows.nth(0).locator('.order-song-hint').textContent(),/악보찬양 있음악보로 바꾸기/);
  assert.match(await rows.nth(1).locator('.order-song-hint').textContent(),/가사찬양 있음가사로 바꾸기/);
  assert.equal(await rows.nth(2).locator('.order-song-hint').count(),0);
  await page.screenshot({path:'artifacts/songbook-order.png'});
  const before=await page.evaluate(()=>YebaeonPlaylists.items()[0].id);
  await rows.nth(0).getByRole('button',{name:'악보로 바꾸기'}).click();
  await page.waitForFunction(id=>YebaeonPlaylists.items()[0]?.document?.id===id&&!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy,ids.freeScore);
  assert.equal(await page.evaluate(()=>YebaeonPlaylists.items()[0].id),before,'같은 자리(같은 항목)를 바꾼다');
  assert.equal(await page.locator('#playlistState').textContent(),'서버 저장됨');
  assert.equal(await page.locator('#playlistSongHints').textContent(),'가사 권장 1');
  const saved=await page.evaluate(async()=>{const s=YebaeonPlaylists.selectedPlaylist(),[lib,node]=s.key.split('/');return (await(await YebaeonCloud.api(`/playlists/${lib}/plan?node=${node}`)).json()).items.map(x=>x.document?.name);});
  assert.deepEqual(saved,['목록밖 노래 하나 둘.pro6','합성 찬양 하나_Wide.pro6','합성 예배순서.pro6']);
  assert.deepEqual(errors,[]);console.log('Songbook UI passed: chips and order in search, admin-only buttons, paste preview errors and save, order hint replace-and-save');
 }finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
