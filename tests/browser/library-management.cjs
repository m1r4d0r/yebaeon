// One end-to-end workflow against the real Worker: avoid duplicating its API logic in mocks.
const {chromium}=require('playwright'),{createServer}=require('node:http');
const {readFile,mkdir}=require('node:fs/promises'),{resolve,extname,sep}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const {build}=await import('esbuild'),{Miniflare,convertV4MiniflareOptions}=await import('miniflare');
 const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'browser-only'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
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
 try{
  await page.goto(origin);await page.locator('#entryName').fill('문서 시험');await page.locator('#entryPassword').fill('browser-only');await page.locator('#entrySubmit').click();await page.locator('#entryDialog').waitFor({state:'hidden'});
  await openPlaylists();await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill('준비 예배');await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>YebaeonPlaylists.selectedPlaylist()?.name==='준비 예배');
  await page.locator('#documentNew').click();await page.locator('#newDocumentName').fill('시험 찬양');await page.locator('#newDocumentCategory').selectOption('가사찬양');await page.locator('#newDocumentSubmit').click();await page.locator('#newDocumentDialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>YebaeonCloud.linked()?.name==='시험 찬양.pro6');const originalID=await page.evaluate(()=>YebaeonCloud.linked().id);
  assert.equal(await page.locator('.slide-card').count(),1);assert.equal(await page.locator('#playlistItems .order-item').count(),1,'a new document is appended to the selected order');assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),true,'new order member remains a local draft');await page.evaluate(()=>YebaeonPlaylists.save());await page.waitForFunction(()=>!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy);
  await page.locator('#libraryQuery').fill('시험 찬양');await page.locator('#libraryQuery').press('Enter');await page.locator('#libraryList .document-item').waitFor();
  const source=await page.evaluate(()=>{const m=YebaeonEditor.model(),slide=YebaeonEditor.current(),group=PP6.all(m.doc,'RVSlideGrouping')[0];YebaeonEditor.beginEdit();PP6.setText(PP6.textElements(slide)[0],'미저장 가사');const a=m.doc.createElement('NSString');a.setAttribute('rvXMLIvarName','groupID');a.textContent=group.getAttribute('UUID');m.doc.documentElement.append(a);const cue=m.doc.createElement('RVMediaCue');cue.setAttribute('UUID',PP6.uuid());cue.setAttribute('source','file:///Media/background.mov');PP6.all(slide,'array').find(n=>n.getAttribute('rvXMLIvarName')==='cues').append(cue);YebaeonEditor.markDirty();return PP6.serialize(m);});
  await page.locator('#libraryList .document-item').click({button:'right'});await page.getByRole('menuitem',{name:'문서 복제',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('newDocumentSubmit').disabled);
  assert.match(await page.locator('#newDocumentMessage').textContent(),/편집 중/);
  await page.locator('#newDocumentName').fill('시험 찬양');await page.locator('#newDocumentSubmit').click();await page.waitForFunction(()=>document.getElementById('newDocumentMessage').textContent.length>0&&!document.getElementById('newDocumentSubmit').disabled);assert.equal(await page.locator('#newDocumentDialog').evaluate(e=>e.open),true);
  await page.locator('#newDocumentName').fill('시험 찬양 복사');await page.locator('#newDocumentSubmit').click();await page.locator('#newDocumentDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>YebaeonCloud.linked()?.name==='시험 찬양 복사.pro6');
  const copied=await page.evaluate(id=>{const m=YebaeonEditor.model(),group=PP6.all(m.doc,'RVSlideGrouping')[0];return {xml:PP6.serialize(m),dirty:YebaeonEditor.cache(id).dirty,text:PP6.parseRTF(PP6.textNode(PP6.textElements(YebaeonEditor.current())[0]).textContent).text,reference:PP6.all(m.doc,'NSString').find(n=>n.getAttribute('rvXMLIvarName')==='groupID').textContent,group:group.getAttribute('UUID'),id:YebaeonCloud.linked().id};},originalID);
  assert.notEqual(copied.id,originalID);assert.equal(copied.dirty,true);assert.equal(copied.text,'미저장 가사');assert.equal(copied.reference,copied.group);assert.match(copied.xml,/file:\/\/\/Media\/background.mov/);
  const oldIDs=[...source.matchAll(/UUID="([^"]+)"/g)].map(m=>m[1]);for(const id of oldIDs)assert.ok(!copied.xml.includes(id),'all document and cue UUIDs regenerated');
  await openPlaylists();await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill('새 예배');await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('playlistsTitle').textContent==='새 예배 순서');
  await page.locator('#libraryQuery').press('Enter');await page.locator('#libraryList .document-item').filter({hasText:'시험 찬양 복사'}).dragTo(page.locator('#playlistItems'));
  await page.waitForFunction(()=>YebaeonPlaylists.state().dirty);await page.evaluate(()=>YebaeonPlaylists.save());await page.waitForFunction(()=>!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy);
  await openPlaylists();await page.locator('#playlistsList button').filter({hasText:'새 예배'}).click({button:'right'});await page.getByRole('menuitem',{name:'보관함으로 이동'}).click();await page.waitForFunction(()=>!document.getElementById('playlistsList').textContent.includes('새 예배'));
  await openPlaylists();await page.locator('#playlistArchives').click();await page.locator('.archive-row').waitFor();await page.getByRole('button',{name:'보관 문서',exact:true}).click();await page.locator('.archive-files a').waitFor();
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/library-archives.png'});
  await page.getByRole('button',{name:'사용 중으로 복원'}).click();await page.locator('.archive-row').waitFor({state:'hidden'});await page.locator('#playlistArchivesClose').click();assert.match(await page.locator('#playlistsTitle').textContent(),/새 예배/);assert.equal(await page.locator('#playlistItems .order-item').count(),1);
  await page.screenshot({path:'artifacts/library-management.png'});assert.deepEqual(errors,[]);console.log('Library UI passed: create, name collision, dirty duplicate, UUID references/media, playlist create/archive/restore');
 }finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
