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
   return {listScore:await make('합성 찬양 하나_Wide','악보찬양'),listLyrics:await make('합성 찬양 하나','가사찬양'),freeLyrics:await make('목록밖 노래 하나','가사찬양'),freeScore:await make('목록밖 노래 하나 둘','악보찬양'),order:await make('합성 예배순서','예배순서'),noScore:await make('악보 없는 노래','가사찬양'),keepLyrics:await make('가사로 쓰는 노래','가사찬양'),lateLyrics:await make('나중에 넣은 노래','가사찬양'),lateScore:await make('나중에 넣은 노래 악보','악보찬양'),failLyrics:await make('짝 찾기 실패 노래','가사찬양'),second:await make('둘째 합성 곡','악보찬양')};});

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

  // 검색 결과: 카테고리 칩은 두 글자로 칠하고(마우스를 올리면 전체 이름), 찬양 행은 같은 색. 같은 곡의 가사를 악보 바로 앞에
  await search('합성 찬양 하나');
  const listed=await page.locator('#libraryList .document-item').evaluateAll(rows=>rows.map(r=>({name:r.querySelector('strong').firstChild.textContent,number:r.querySelector('.song-number')?.textContent||'',chip:r.querySelector('.song-chip')?.className||'',label:r.querySelector('.song-chip')?.textContent,title:r.querySelector('.song-chip')?.title,row:r.className})));
  assert.deepEqual(listed.map(x=>x.name),['합성 찬양 하나','합성 찬양 하나_Wide'],'가사를 같은 곡 악보 바로 앞에');
  assert.deepEqual(listed.map(x=>[x.label,x.title]),[['가사','가사찬양'],['악보','악보찬양']]);
  assert.match(listed[0].chip,/lyrics/);assert.match(listed[0].row,/song-lyrics/);assert.match(listed[1].chip,/score/);assert.match(listed[1].row,/song-score/);
  assert.deepEqual(listed.map(x=>x.number),['영 58','영 58']);await page.screenshot({path:'artifacts/songbook-search.png',clip:{x:0,y:0,width:420,height:320}});
  await search('합성 예배순서');
  const other=page.locator('#libraryList .document-item').first();
  assert.equal(await other.locator('.song-chip').textContent(),'예배');assert.equal(await other.locator('.song-chip').getAttribute('title'),'예배순서');assert.doesNotMatch(await other.getAttribute('class'),/song-/,'다른 카테고리 행은 칠하지 않는다');

  // 순서: 찬양 행을 칠하고, 목록 밖 가사 행에만 [악보로](같은 곡 악보 있음) 또는 [악보 필요]. 머리줄에 개수와 색 범례.
  await openPlaylists();await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill('권장 예배');await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>YebaeonPlaylists.selectedPlaylist()?.name==='권장 예배');
  await page.evaluate(async ids=>{const get=async id=>(await(await YebaeonCloud.api('/documents/'+id)).json()).document;YebaeonPlaylists.appendDocuments([await get(ids.freeLyrics),await get(ids.listScore),await get(ids.order),await get(ids.noScore),await get(ids.keepLyrics)]);await YebaeonPlaylists.save();const s=YebaeonPlaylists.selectedPlaylist();const [lib,node]=s.key.split('/');await YebaeonPlaylists.openNode(lib,node);},ids);
  await page.locator('#playlistItems .order-tag.need').first().waitFor();
  const summaryText=()=>page.locator('#playlistSongHints').textContent();
  assert.equal(await summaryText(),'가사악보','머리줄에는 범례만');assert.equal(await page.locator('#playlistSongHints .order-swatch.song-lyrics').textContent(),'가사');
  const rows=page.locator('#playlistItems .order-item');
  assert.deepEqual(await rows.evaluateAll(list=>list.map(r=>(r.className.match(/song-(lyrics|score)/)||[''])[0])),['song-lyrics','song-score','','song-lyrics','song-lyrics']);
  assert.equal(await rows.nth(0).locator('.order-tag').textContent(),'악보로');assert.equal(await rows.nth(1).locator('.order-tag').count(),0,'목록 곡 악보에는 버튼을 달지 않는다');
  assert.equal(await rows.nth(1).locator('.song-number').textContent(),'영 58');assert.equal(await rows.nth(3).locator('.order-tag').textContent(),'악보 필요');
  // 항목 메뉴: 바꿀 수 있으면 켜고, 아니면 회색
  await rows.nth(1).click({button:'right'});
  assert.equal(await page.getByRole('menuitem',{name:'가사로 바꾸기'}).isDisabled(),false);assert.equal(await page.getByRole('menuitem',{name:'악보로 바꾸기'}).isDisabled(),true);
  await page.keyboard.press('Escape');
  await page.screenshot({path:'artifacts/songbook-order.png'});
  // [악보 필요] → 안내 창 → PPT 가져오기(악보 용도·이름 미리 채움, 순서에 넣기 끔)
  await rows.nth(3).locator('.order-tag').click();
  await page.locator('.songbook-need[open]').waitFor();
  assert.equal(await page.locator('.songbook-need h2').textContent(),'악보 없는 노래');
  await page.screenshot({path:'artifacts/songbook-need.png'});
  await page.locator('.songbook-need').getByRole('button',{name:'PPT 가져오기'}).click();
  await page.locator('#pptDialog[open]').waitFor();
  assert.equal(await page.locator('#pptName').inputValue(),'악보 없는 노래 (악보)');
  assert.equal(await page.locator('#pptPurpose [data-purpose="score"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#pptAppend').isChecked(),false);
  await page.locator('#pptClose').click();
  // 악보 용도로 악보찬양을 만들면(어디서 열었든) 열린 순서의 짝을 다시 물어 [악보 필요]가 [악보로]가 된다.
  await page.evaluate(async()=>{const made=(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:'악보 없는 노래 (악보).pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:YebaeonLibraryActions.blankDocument('악보찬양')})).json()).document;window.dispatchEvent(new CustomEvent('yebaeonpptimported',{detail:{document:made}}));});
  await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-tag.need').length===1&&document.querySelectorAll('#playlistItems .order-tag.go').length===2);
  assert.equal(await summaryText(),'가사악보');
  const before=await page.evaluate(()=>YebaeonPlaylists.items()[0].id);
  await rows.nth(0).getByRole('button',{name:'악보로'}).click();
  await page.waitForFunction(id=>YebaeonPlaylists.items()[0]?.document?.id===id&&!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy,ids.freeScore);
  assert.equal(await page.evaluate(()=>YebaeonPlaylists.items()[0].id),before,'같은 자리(같은 항목)를 바꾼다');
  assert.equal(await page.locator('#playlistState').textContent(),'서버 저장됨');
  assert.equal(await summaryText(),'가사악보');
  const saved=await page.evaluate(async()=>{const s=YebaeonPlaylists.selectedPlaylist(),[lib,node]=s.key.split('/');return (await(await YebaeonCloud.api(`/playlists/${lib}/plan?node=${node}`)).json()).items.map(x=>x.document?.name);});
  assert.deepEqual(saved,['목록밖 노래 하나 둘.pro6','합성 찬양 하나_Wide.pro6','합성 예배순서.pro6','악보 없는 노래.pro6','가사로 쓰는 노래.pro6']);
  // '가사로 쓰는 곡': [악보 필요] 창의 [예외 처리]로 지정하면 표시가 사라지고, 항목 메뉴 '예외 처리 해제'로 되돌린다(누구나).
  await rows.nth(4).locator('.order-tag.need').click();await page.locator('.songbook-need[open]').waitFor();
  await page.locator('.songbook-need').getByRole('button',{name:'예외 처리'}).click();await page.locator('.songbook-need').waitFor({state:'detached'});
  await page.waitForFunction(()=>!document.querySelector('#playlistItems .order-item:nth-child(5) .order-tag'));
  assert.equal(await page.evaluate(id=>YebaeonSongbook.state().lyricsOnly.has(id),ids.keepLyrics),true);
  await rows.nth(4).click({button:'right'});await page.getByRole('menuitem',{name:'예외 처리 해제'}).click();
  await page.waitForFunction(()=>document.querySelector('#playlistItems .order-item:nth-child(5) .order-tag.need'));
  // [악보로]가 있는 곡도 지정하면 숨긴다
  await rows.nth(3).click({button:'right'});await page.getByRole('menuitem',{name:'예외 처리',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#playlistItems .order-item:nth-child(4) .order-tag'));
  // 순서를 연 뒤에 넣은 문서도 다시 열지 않고 표시된다(그릴 때 아직 묻지 않은 문서만 한 번 묻는다). 짝 찾기에 실패한 문서는 되풀이해 묻지 않는다.
  const pairAsks=[];page.on('request',r=>{if(r.url().includes('/api/songbook/pairs'))pairAsks.push(decodeURIComponent(r.url()));});
  const append=list=>page.evaluate(async list=>{const get=async id=>(await(await YebaeonCloud.api('/documents/'+id)).json()).document;YebaeonPlaylists.appendDocuments(await Promise.all(list.map(get)));},list);
  await append([ids.lateLyrics]);
  await page.waitForFunction(()=>{const r=document.querySelectorAll('#playlistItems .order-item');return r.length===6&&r[5].querySelector('.order-tag.go');});
  assert.equal(pairAsks.filter(u=>u.includes(ids.lateLyrics)).length,1,'새로 들어온 문서만 한 번 묻는다');
  await page.route('**/api/songbook/pairs**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"잠시 실패"}'}));
  await append([ids.failLyrics]);
  await page.waitForFunction(id=>performance.getEntriesByType('resource').some(e=>e.name.includes('/api/songbook/pairs')&&decodeURIComponent(e.name).includes(id)),ids.failLyrics);
  await append([ids.order]);await page.waitForTimeout(300);
  assert.equal(await rows.nth(6).locator('.order-tag').count(),0,'짝을 묻지 못한 문서에는 아무것도 달지 않는다');
  assert.equal(pairAsks.filter(u=>u.includes(ids.failLyrics)).length,1,'실패한 문서는 다시 묻지 않는다');
  await page.unroute('**/api/songbook/pairs**');
  // 목록 밖 짝: 이름이 달라 못 찾는 곡을 '짝 고르기…'로 묶고 빼기. 가사·악보가 함께 있어야 [짝으로]가 켜진다.
  const pairs=await page.evaluate(async()=>{const make=async(name,category)=>(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:name+'.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:YebaeonLibraryActions.blankDocument(category)})).json()).document.id;
   return {lyrics:await make('합성 선포 노래 긴 제목','가사찬양'),score:await make('선포곡','악보찬양'),lyrics2:await make('합성 선포 둘째 가사','가사찬양'),saved:await make('짝 저장 노래','가사찬양')};});
  await append([pairs.lyrics]);
  await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-item')[8]?.querySelector('.order-tag.need'));
  await rows.nth(8).click({button:'right'});
  const menuLabels=await page.locator('[role="menuitem"]').allTextContents();
  assert.ok(menuLabels.indexOf('가사로 바꾸기')<menuLabels.indexOf('짝 고르기…')&&menuLabels.indexOf('짝 고르기…')<menuLabels.indexOf('예외 처리'),menuLabels.join(','));
  await page.getByRole('menuitem',{name:'짝 고르기…'}).click();
  const pairBox=page.locator('.songbook-pair'),pairRow=name=>pairBox.locator('.songbook-pick-row',{has:page.locator('.songbook-pick-name',{hasText:name})});
  await pairBox.waitFor();assert.match(await pairRow('합성 선포 노래 긴 제목').textContent(),/이 문서/);
  await pairBox.locator('input[type="search"]').fill('선포');await pairBox.getByRole('button',{name:'검색'}).click();
  await pairRow('선포곡').waitFor();
  assert.equal(await pairRow('합성 선포 둘째 가사').count(),0,'가사 문서의 짝을 고를 때는 악보만 보인다');
  await page.screenshot({path:'artifacts/songbook-pair.png'});
  await pairRow('선포곡').getByRole('button',{name:'짝으로'}).click();
  await page.waitForFunction(()=>/짝으로 두었습니다/.test(document.querySelector('.songbook-pair .panel-foot').textContent));
  assert.deepEqual(await page.evaluate(()=>YebaeonSongbook.state().groups),[[pairs.lyrics,pairs.score]]);
  assert.match(await pairRow('선포곡').textContent(),/빼기/);
  await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-item')[8]?.querySelector('.order-tag.go'));
  // [빼기]: 가사만 남은 짝은 지워지고 [악보 필요]로 돌아간다.
  await pairRow('선포곡').getByRole('button',{name:'빼기'}).click();
  await page.waitForFunction(()=>/짝에서 뺐습니다/.test(document.querySelector('.songbook-pair .panel-foot').textContent));
  assert.deepEqual(await page.evaluate(()=>YebaeonSongbook.state().groups),[]);
  await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-item')[8]?.querySelector('.order-tag.need'));
  await pairRow('선포곡').getByRole('button',{name:'짝으로'}).click();
  await page.waitForFunction(()=>YebaeonSongbook.state().groups.length===1);
  await pairBox.locator('.panel-close').click();
  // 검색: 가사찬양 바로 다음에 짝 악보를 잇고 '가사로 찾음'. 같은 문서는 한 번만.
  await search('합성 선포 노래');
  const found=await page.locator('#libraryList .document-item').evaluateAll(list=>list.map(r=>[r.querySelector('strong').firstChild.textContent,r.querySelector('.song-paired')?.textContent||'']));
  const at=found.findIndex(([n])=>n==='합성 선포 노래 긴 제목');
  assert.deepEqual(found.slice(at,at+2),[['합성 선포 노래 긴 제목',''],['선포곡','가사로 찾음']],JSON.stringify(found));
  assert.equal(found.filter(([n])=>n==='선포곡').length,1);
  await page.screenshot({path:'artifacts/songbook-search-pair.png',clip:{x:0,y:0,width:420,height:320}});
  // 같은 검색 상자를 쓰는 곳마다 고른다: PPT 교체 대상은 가사찬양을 빼지만 가사로 찾은 짝 악보는 남는다.
  const boxed=await page.evaluate(async()=>{const names=async opts=>{const host=document.createElement('div');document.body.append(host);const b=YebaeonSearch.box(host,{value:'합성 선포 노래',...opts});await b.run();const out=[...host.querySelectorAll('.doc-search-item .nm')].map(x=>x.firstChild.textContent);host.remove();return out;};
   return {plain:await names({}),target:await names({only:d=>d.category!=='가사찬양'})};});
  assert.deepEqual(boxed.plain.slice(0,2),['합성 선포 노래 긴 제목','선포곡']);assert.ok(!boxed.target.includes('합성 선포 노래 긴 제목')&&boxed.target[0]==='선포곡',JSON.stringify(boxed));
  const arranged=await page.evaluate(p=>{const d=(id,name,category)=>({id,name:name+'.pro6',path:name+'.pro6',category});return YebaeonSongbook.arrange([d(p.score,'선포곡','악보찬양'),d('x','다른 문서','예배순서'),d(p.lyrics,'합성 선포 노래 긴 제목','가사찬양')]).map(x=>[x.name,x.matchedBy||'']);},pairs);
  assert.deepEqual(arranged,[['합성 선포 노래 긴 제목.pro6',''],['선포곡.pro6',''],['다른 문서.pro6','']],'앞에 있던 악보 자리로 가사를 올리고 악보를 잇는다');
  // 짝에 든 문서는 이름 맞추기를 묻지 않는다. [악보 필요]에서 연 PPT 가져오기로 악보를 만들면 가사와 짝으로 저장한다.
  await page.evaluate(async p=>{await YebaeonCloud.api('/songbook/groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({add:[p.lyrics,p.score,p.lyrics2]})});await YebaeonSongbook.revalidate();},pairs);
  const asked=pairAsks.length;await append([pairs.lyrics2]);
  await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-item')[9]?.querySelector('.order-tag.go'));
  assert.equal(pairAsks.length,asked,'짝에 든 문서는 묻지 않는다');
  await page.evaluate(async p=>{const made=(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:'다른 이름 악보.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:YebaeonLibraryActions.blankDocument('악보찬양')})).json()).document;window.dispatchEvent(new CustomEvent('yebaeonpptimported',{detail:{document:made,pairWith:p.saved}}));},pairs);
  await page.waitForFunction(id=>YebaeonSongbook.state().groups.some(g=>g.includes(id)),pairs.saved);
  // 짝 붙여넣기(관리자): 메모·주석은 건너뛰고, 오류가 있으면 저장 단추를 끈다.
  await openSongbook();
  await page.locator('#songbookGroupPaste').click();await page.locator('#songbookGroupText').waitFor();
  const pasteGroups=async text=>{await page.locator('#songbookGroupText').fill(text);await page.waitForFunction(()=>document.querySelector('#songbookGroupPreview .songbook-preview-sum')&&!document.querySelector('#songbookGroupPreview .hint'));};
  await pasteGroups(`# 짝 표\n${pairs.lyrics},${pairs.score}\t선포\n\n${ids.listLyrics},${pairs.score}\n${pairs.lyrics2},00000000-0000-4000-8000-000000000000`);
  const groupProblems=await page.locator('#songbookGroupPreview .songbook-errors').textContent();
  assert.match(groupProblems,/4줄: 두 짝에 들어간 문서/);assert.match(groupProblems,/4줄: 목록 곡 문서 ‘합성 찬양 하나’\(영 58\)/);assert.match(groupProblems,/5줄: 없는 문서/);
  assert.equal(await page.locator('#songbookGroupSave').isDisabled(),true);
  await pasteGroups(`# 짝 표\n${pairs.lyrics},${pairs.score}\t선포\n${pairs.lyrics2},${ids.lateScore}`);
  assert.match(await page.locator('#songbookGroupPreview .songbook-preview-sum').textContent(),/짝 2 · 문서 4.*새로 0 · 바뀜 2 · 빠짐 1/);
  await page.screenshot({path:'artifacts/songbook-group-paste.png'});
  await page.locator('#songbookGroupSave').click();await page.locator('.songbook-paste').waitFor({state:'detached'});
  assert.match(await page.locator('#songbookMessage').textContent(),/짝을 저장했습니다. 짝 2/);
  assert.deepEqual(await page.evaluate(()=>YebaeonSongbook.state().groups),[[pairs.lyrics,pairs.score],[pairs.lyrics2,ids.lateScore]]);
  await page.locator('#songbookDialog .panel-close').first().click();
  // PPT 가져오기 '짝 찬양' 줄: 이름으로 찾은 가사는 '자동 추천'일 뿐 [짝으로]를 눌러야 짝. 옛 악보 빼기, 목록 곡은 저장 안 함.
  await page.evaluate(()=>{const host=document.createElement('div');host.id='pairPickerTest';document.body.append(host);window.__picker=YebaeonSongbook.pairPicker(host);__picker.reset();__picker.name('합성 선포 노래 긴 제목 (악보)');});
  const picker=page.locator('#pairPickerTest');
  await picker.locator('.ppt-pair-auto').waitFor();
  assert.match(await picker.locator('.ppt-pair-row').first().textContent(),/짝 찬양.*합성 선포 노래 긴 제목자동 추천/);assert.equal(await page.evaluate(()=>__picker.value()),null,'추천만으로는 짝이 아니다');
  await picker.getByRole('button',{name:'짝으로'}).click();
  assert.match(await picker.locator('.ppt-pair-old').textContent(),/옛 악보 선포곡 짝에서 빼기/);
  assert.deepEqual(await page.evaluate(()=>__picker.value()),{pairWith:pairs.lyrics,pairDrop:[pairs.score]});
  await picker.locator('.ppt-pair-old input').uncheck();assert.deepEqual(await page.evaluate(()=>__picker.value().pairDrop),[]);
  await picker.locator('.ppt-pair-old input').check();
  const newScore=await page.evaluate(async p=>{const made=(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:'합성 선포 노래 새 악보.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:YebaeonLibraryActions.blankDocument('악보찬양')})).json()).document;window.dispatchEvent(new CustomEvent('yebaeonpptimported',{detail:{document:made,...__picker.value()}}));return made.id;},pairs);
  await page.waitForFunction(id=>YebaeonSongbook.state().groups.some(g=>g.includes(id)),newScore);
  assert.deepEqual(await page.evaluate(id=>YebaeonSongbook.state().groups.find(g=>g.includes(id)),newScore),[pairs.lyrics,newScore],'옛 악보는 빠진다');
  await page.evaluate(()=>{__picker.reset();__picker.name('합성 찬양 하나 (악보)');});
  await picker.locator('.line-meta',{hasText:'목록 곡'}).waitFor();assert.equal(await page.evaluate(()=>__picker.value()),null,'목록 곡 가사는 짝으로 저장하지 않는다');
  await page.evaluate(()=>{__picker.reset();__picker.name('아무것도 없는 제목 (악보)');});
  await picker.getByRole('button',{name:'고르기…'}).waitFor();await picker.getByRole('button',{name:'고르기…'}).click();
  await picker.locator('input[type="search"]').fill('합성 선포 둘째');await picker.getByRole('button',{name:'검색'}).click();
  await picker.locator('.doc-search-item',{hasText:'합성 선포 둘째 가사'}).click();
  assert.deepEqual(await page.evaluate(()=>__picker.value()),{pairWith:pairs.lyrics2,pairDrop:[ids.lateScore]});
  await page.evaluate(()=>document.getElementById('pairPickerTest').remove());
  // [고르기] 내용 미리보기: 가사는 첫 가사 두 줄(제목 장 건너뜀), 악보는 첫 악보 장 그림, 누르면 앞 장 펼침, 문서마다 한 번만 받음, 못 읽으면 '미리보기 없음'.
  const preview=await page.evaluate(async()=>{const P=PP6,style={font:'NanumGothicOTF',size:80,color:'rgb(255,255,255)',align:'center'},text=t=>P.textElementXML({rect:{x:80,y:90,w:1760,h:900},rtf:P.textRTF(t,style)});
   const xml=(category,slides)=>P.documentXML({category,groups:[{name:'기본',slides:slides.join('')}]});
   const make=async(name,body)=>(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:name+'.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body})).json()).document.id;
   const lyrics=await make('미리보기 가사',xml('가사찬양',[P.slideXML({elements:text('미리보기 가사')}),P.slideXML({elements:text('첫째 가사 줄\n둘째 가사 줄')}),P.slideXML({elements:text('셋째 가사 줄')})]));
   const score=await make('미리보기 악보',xml('악보찬양',[P.slideXML({background:P.backgroundCueXML({source:'file:///Users/Shared/Renewed%20Vision%20Media/Images/bg.png',name:'bg'})}),P.slideXML({elements:text('미리보기 악보')}),
    P.slideXML({elements:P.imageElementXML({source:'file:///Users/Shared/Renewed%20Vision%20Media/YebaeOn/score.png',rect:{x:0,y:0,w:1920,h:1080}})}),P.slideXML({elements:text('넷째 장')}),P.slideXML({elements:text('다섯째 장')})]));
   const broken=await make('미리보기 실패 곡',xml('악보찬양',[P.slideXML({elements:text('실패')})]));
   await YebaeonCloud.api('/songbook',{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':`"${YebaeonSongbook.state().version}"`},body:JSON.stringify({number:null,song:{number:9,key:'D',terms:['미리보기 실패 곡'],links:[lyrics,score],nots:[]}})});
   return {lyrics,score,broken};});
  const contentReads=new Map();page.on('request',r=>{const m=/\/api\/documents\/([0-9a-f-]{36})\/content/.exec(r.url());if(m)contentReads.set(m[1],(contentReads.get(m[1])||0)+1);});
  await page.route(`**/api/documents/${preview.broken}/content**`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'file_unavailable',message:'문서 파일을 읽지 못했습니다.'})}));
  await openSongbook();
  assert.equal(contentReads.size,0,'the list window itself does not read documents');
  await page.locator('#songbookRows [data-number="9"]').getByRole('button',{name:'고르기'}).click();
  const pick=page.locator('.songbook-pick'),rowOf=name=>pick.locator('.songbook-pick-row',{has:page.locator('.songbook-pick-name',{hasText:name})});
  await page.waitForFunction(()=>document.querySelectorAll('.songbook-pick .songbook-preview-text,.songbook-pick .songbook-preview canvas,.songbook-pick .songbook-preview-none').length>=3);
  assert.equal(await rowOf('미리보기 가사').locator('.songbook-preview-text').textContent(),'첫째 가사 줄 / 둘째 가사 줄','first two lyric lines, title slide skipped');
  assert.equal(await rowOf('미리보기 악보').locator('.songbook-preview canvas').count(),1,'score row shows a slide picture');
  assert.equal(await rowOf('미리보기 실패 곡').locator('.songbook-preview-none').textContent(),'미리보기 없음');
  await rowOf('미리보기 악보').locator('.songbook-preview').click();
  assert.equal(await pick.locator('.songbook-pick-slides canvas').count(),4,'the first four slides open under the row');
  await page.screenshot({path:'artifacts/songbook-pick-preview.png'});
  await rowOf('미리보기 악보').locator('.songbook-preview').click();
  assert.equal(await pick.locator('.songbook-pick-slides').count(),0,'clicking again folds them');
  await rowOf('미리보기 가사').locator('.songbook-preview').click();
  await rowOf('미리보기 실패 곡').getByRole('button',{name:'아님',exact:true}).click();
  await page.waitForFunction(()=>/아님으로 두었습니다/.test(document.querySelector('.songbook-pick .panel-foot').textContent));
  await page.waitForFunction(()=>document.querySelectorAll('.songbook-pick .songbook-pick-slides').length===1&&document.querySelectorAll('.songbook-pick .songbook-preview-text').length===1);
  assert.deepEqual([preview.lyrics,preview.score,preview.broken].map(id=>contentReads.get(id)),[1,1,1],'each document is read once while the window is open, even after a redraw');
  await page.locator('.songbook-pick .panel-close').click();await page.locator('#songbookDialog .panel-close').first().click();
  assert.deepEqual(errors,[]);console.log('Songbook UI passed: chips and order in search, admin-only buttons, paste preview errors and save, order tint and score buttons, need dialog to PPT import, re-pairing after a score import, row menu switches, pair dialog and group paste, search pairs, pick-window previews');
 }finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
