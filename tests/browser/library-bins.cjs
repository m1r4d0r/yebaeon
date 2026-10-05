// 보관함·휴지통·이름 바꾸기·카테고리·관리자 비우기를 실제 Worker에 대해 확인한다.
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
  if(url.pathname.startsWith('/resources/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.endsWith('catalog.json')?{fonts:[],media:[]} : []));return;}
  const path=resolve(root,'.'+url.pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+sep))throw Error('path');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']}:undefined);
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const openPlaylists=async()=>{if(!await page.locator('#studioPlaylistsDialog').evaluate(e=>e.open))await page.locator('#studioPlaylistPicker').click();};
 const search=async q=>{await page.locator('#libraryQuery').fill(q);await page.locator('#libraryQuery').press('Enter');await page.waitForFunction(()=>!document.getElementById('libraryMessage').textContent.includes('불러오'));};
 const docMenu=async(name,item)=>{await page.locator('#libraryList .document-item').filter({hasText:name}).first().click({button:'right'});await page.getByRole('menuitem',{name:item,exact:true}).click();};
 const binRows=()=>page.locator('#binsList .archive-row');
 try{
  await page.goto(origin);await page.locator('#entryName').fill('관리 시험');await page.locator('#entryPassword').fill('browser-only');await page.locator('#entrySubmit').click();await page.locator('#entryDialog').waitFor({state:'hidden'});
  await openPlaylists();await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill('관리 예배');await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>YebaeonPlaylists.selectedPlaylist()?.name==='관리 예배');
  // 카테고리는 서버 표에서 온다.
  await page.locator('#documentNew').click();await page.waitForFunction(()=>[...document.querySelectorAll('#newDocumentCategory option')].some(o=>o.value==='__new__'));
  const options=await page.locator('#newDocumentCategory option').allTextContents();assert.ok(options.includes('예배순서'));assert.ok(!options.includes('미결'));assert.ok(options.some(o=>o.includes('새 카테고리')));
  await page.locator('#newDocumentName').fill('관리 찬양');await page.locator('#newDocumentCategory').selectOption('가사찬양');await page.locator('#newDocumentSubmit').click();await page.locator('#newDocumentDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>YebaeonCloud.linked()?.name==='관리 찬양.pro6');
  await page.evaluate(()=>YebaeonPlaylists.save());await page.waitForFunction(()=>!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy);
  // 같은 이름이면 `이름 2`를 제안한다.
  await page.locator('#documentNew').click();await page.locator('#newDocumentName').fill('관리 찬양');await page.locator('#newDocumentNameHint button').waitFor();
  assert.match(await page.locator('#newDocumentNameHint').textContent(),/이미 있습니다/);await page.locator('#newDocumentNameHint button').click();assert.equal(await page.locator('#newDocumentName').inputValue(),'관리 찬양 2');await page.locator('#newDocumentClose').click();
  // 이름 바꾸기: 문서와 그 문서를 담은 재생목록 참조가 함께 바뀐다.
  await search('관리 찬양');await docMenu('관리 찬양','이름 바꾸기');await page.locator('#renameValue').fill('고친 찬양');await page.locator('#renameForm button[type=submit]').click();await page.locator('#renameDialog').waitFor({state:'hidden'});
  await search('고친 찬양');await page.locator('#libraryList .document-item').filter({hasText:'고친 찬양'}).waitFor();
  await page.waitForFunction(()=>YebaeonCloud.linked()?.name==='고친 찬양.pro6');
  assert.equal(await page.locator('#binsTabs button').count(),2,'trash has playlist and document tabs only');
  await search('고친 찬양');await page.locator('#libraryList .document-item').filter({hasText:'고친 찬양'}).waitFor();
  // 재생목록 휴지통으로 → 꺼내기.
  await openPlaylists();await page.locator('#playlistsList button').filter({hasText:'관리 예배'}).click({button:'right'});await page.getByRole('menuitem',{name:'휴지통으로',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('playlistsList').textContent.includes('관리 예배'));
  await page.locator('#studioPlaylistsDialog').getByRole('button',{name:'닫기'}).click();await page.locator('#libraryBins').click();await page.locator('#binsTabs button[data-bin="trashed-playlists"]').click();await binRows().filter({hasText:'관리 예배'}).waitFor();
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/library-bins.png'});
  await binRows().filter({hasText:'관리 예배'}).getByRole('button',{name:'꺼내기'}).click();await binRows().filter({hasText:'관리 예배'}).waitFor({state:'hidden'});await page.locator('#binsClose').click();
  await openPlaylists();await page.locator('#playlistsList button').filter({hasText:'관리 예배'}).waitFor();await page.locator('#studioPlaylistsDialog').getByRole('button',{name:'닫기'}).click();
  // 휴지통으로 → 관리자 비우기(비밀번호를 묻고 15분 유지).
  await docMenu('고친 찬양','휴지통으로');await page.waitForFunction(()=>!document.getElementById('libraryList').textContent.includes('고친 찬양'));
  await page.locator('#libraryBins').click();await page.locator('#binsTabs button[data-bin="trashed-docs"]').click();await binRows().filter({hasText:'고친 찬양'}).waitFor();
  assert.equal(await page.locator('#binsPurge').isVisible(),true);await page.locator('#binsPurge').click();
  await page.locator('#adminDialog').waitFor();await page.locator('#adminPassword').fill('wrong-pass');await page.locator('#adminSubmit').click();await page.waitForFunction(()=>/맞지 않/.test(document.getElementById('adminMessage').textContent));
  await page.locator('#adminPassword').fill('admin-only-1');await page.locator('#adminSubmit').click();await page.locator('#adminDialog').waitFor({state:'hidden'});
  // 사용 중인 순서에 들어 있으면 남긴다. 순서에서 빼고 저장한 뒤 다시 비운다(관리자 확인은 15분 유지).
  await page.waitForFunction(()=>/남김: 고친 찬양/.test(document.getElementById('binsMessage').textContent));await binRows().filter({hasText:'고친 찬양'}).waitFor();await page.locator('#binsClose').click();
  await page.locator('#playlistItems .order-item').first().click({button:'right'});await page.getByRole('menuitem',{name:'순서에서 빼기 Delete'}).click();await page.evaluate(()=>YebaeonPlaylists.save());await page.waitForFunction(()=>!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy);
  await page.locator('#libraryBins').click();await page.locator('#binsTabs button[data-bin="trashed-docs"]').click();await binRows().filter({hasText:'고친 찬양'}).waitFor();await page.locator('#binsPurge').click();
  await page.waitForFunction(()=>!document.querySelector('#binsList .archive-row')&&!/불러오/.test(document.getElementById('binsMessage').textContent));assert.match(await page.locator('#binsMessage').textContent(),/비어|없/);assert.equal(await page.locator('#adminDialog').evaluate(e=>e.open),false);await page.locator('#binsClose').click();
  const gone=await page.evaluate(async()=>(await(await fetch('/api/documents?'+new URLSearchParams({checkPath:'고친 찬양'}))).json()).available);assert.equal(gone,true,'purged document frees its path');
  // Studio 렌더: 문서의 Mac 이미지 경로 → 서버 경로표 → 이미지 바이트.
  const image=await page.evaluate(async()=>{
   const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
   const put=await fetch('/api/media/'+sha+'/content',{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Yebaeon-SHA256':sha},body:bytes});if(!put.ok)return 'upload '+put.status;
   const path='/Users/Shared/Renewed Vision Media/ImportedImages/시험/Slide1.png';
   const reg=await fetch('/api/media/paths',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{path,sha256:sha,size:bytes.length}]})});if(!reg.ok)return 'register '+reg.status;
   const file=await YebaeonResources.media('file://'+encodeURI(path));return file?file.size:'none';});
  assert.equal(image,12,'Studio finds a document image through the server path table');
  // 교회 Mac 현황·원격 지원: Mac(장치 열쇠)이 현황을 올리고 지원 시간을 열면, 관리자가 현황 창에서 명령을 남기고 Mac이 가져가 결과를 보고한다.
  const token=await page.evaluate(async()=>(await(await fetch('/api/sync/devices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'교회 Mac'})})).json()).token);
  const deviceId=token.split('_')[1],asMac=(path,method='GET',body)=>mf.dispatchFetch(origin+'/api/sync/devices/'+deviceId+path,{method,headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+token},...body?{body:JSON.stringify(body)}:{}});
  const macStatus={build:57,presenter:true,summary:'받을 예배 1개',rows:[{node:'L/N1',name:'수요예배',status:'receive',text:'받기 2',detail:'받기: 찬양, 광고',applicable:true,changesMac:true}],review:[{list:'같은 이름, 다른 내용',title:'환영.pro6',path:'환영.pro6',detail:'Mac과 서버의 내용이 다름',actions:['server','mac','number']}],log:['10:00 자동 올리기 · 올림: 광고']};
  assert.equal((await asMac('/status','POST',{status:macStatus})).status,200);
  await page.evaluate(()=>YebaeonMacRemote.refresh());if(await page.locator('#studioPlaylistsDialog').evaluate(e=>e.open))await page.keyboard.press('Escape');
  await page.locator('#cloudAccount').click();await page.locator('#macStatus').filter({hasText:'교회 Mac · 받을 예배 1개'}).waitFor();
  await page.locator('#macStatus').click();await page.locator('#macDialog').waitFor();
  await page.locator('#macBody').filter({hasText:'PP6 실행 중'}).waitFor();
  assert.equal(await page.locator('#macBody .mac-row button').count(),0,'no remote buttons outside the support window');
  assert.match(await page.locator('#macBody .mac-support').textContent(),/원격 지원 시작/);
  assert.equal((await asMac('/support','POST',{minutes:30})).status,200);
  await page.locator('#macRefresh').click();await page.locator('#macBody .mac-support.on').waitFor();await page.screenshot({path:'artifacts/mac-remote.png'});
  await page.locator('#macBody .mac-row button',{hasText:'서버 것 받기'}).click();
  if(await page.locator('#adminDialog').evaluate(e=>e.open)){await page.locator('#adminPassword').fill('admin-only-1');await page.locator('#adminSubmit').click();}
  await page.locator('#macMessage').filter({hasText:'보냈습니다'}).waitFor();
  const taken=await(await asMac('/commands')).json();
  assert.deepEqual(taken.commands.map(c=>[c.action,c.args]),[['organizer',{path:'환영.pro6',do:'server'}]]);
  assert.equal((await asMac('/commands/'+taken.commands[0].id,'POST',{state:'rejected',message:'PP6가 켜져 있어 하지 않았습니다.'})).status,200);
  await page.locator('#macRefresh').click();
  await page.locator('#macBody .mac-command').filter({hasText:'하지 않음'}).filter({hasText:'PP6가 켜져 있어'}).waitFor();
  await page.locator('#macBody .mac-row button',{hasText:'적용'}).click();await page.locator('#macMessage').filter({hasText:'보냈습니다'}).waitFor();
  assert.deepEqual((await(await asMac('/commands')).json()).commands.map(c=>c.args),[{nodes:['L/N1']}]);
  await page.locator('#macBody button',{hasText:'지원 끝내기'}).click();await page.locator('#macMessage').filter({hasText:'끝냈습니다'}).waitFor();
  assert.equal((await(await asMac('/commands')).json()).supportUntil,null);
  await page.locator('#macClose').click();
  assert.deepEqual(errors,[]);console.log('Library bins passed: server categories, name hint, rename, archive/unarchive, trash/admin purge, playlist trash/restore, Mac status and remote support');
 }finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
