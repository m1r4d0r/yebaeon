// [악보 필요] → PPT 가져오기(악보 용도) 전체 흐름: 실제 Worker(Miniflare)·빌드된 Studio(dist)·합성 PPTX.
// 미리보기는 투명 격자, 저장한 악보는 흰 바탕. 첫 장 배경은 즐겨찾기에서 골라 첫 장에만 Background cue, 가사와 짝 저장, 열린 순서의 가사 항목을 새 악보로 바꿔 저장.
const {chromium}=require('playwright'),{createServer}=require('node:http');
const {readFile}=require('node:fs/promises'),{resolve,extname,sep}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const {zipSync,strToU8}=await import('fflate');
 const {build}=await import('esbuild'),{Miniflare,convertV4MiniflareOptions}=await import('miniflare');
 const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'browser-only',ADMIN_PASSWORD:'admin-only-1'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
 const root=resolve('dist');let origin;
 const server=createServer(async(req,res)=>{try{const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){const parts=[];for await(const part of req)parts.push(part);const response=await mf.dispatchFetch(url,{method:req.method,headers:req.headers,...parts.length?{body:Buffer.concat(parts)}:{}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(url.pathname.startsWith('/resources/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.endsWith('catalog.json')?{fonts:[],media:[]}:[]));return;}
  const path=resolve(root,'.'+url.pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+sep))throw Error('path');
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){res.writeHead(404);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']}:undefined);
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(origin);await page.locator('#entryName').fill('악보 시험');await page.locator('#entryPassword').fill('browser-only');await page.locator('#entrySubmit').click();await page.locator('#entryDialog').waitFor({state:'hidden'});
  // 합성 자료: 가사 문서, 즐겨찾기한 미디어 그림 하나(첫 장 배경 후보)
  const lyrics=await page.evaluate(async()=>(await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:'합성 새 노래 제목.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:YebaeonLibraryActions.blankDocument('가사찬양')})).json()).document);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=450;const x=c.getContext('2d');x.fillStyle='black';for(let y=100;y<200;y+=12)x.fillRect(30,y,730,3);return c.toDataURL().split(',')[1];});
  await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.fillStyle='#2a3f8f';x.fillRect(0,0,160,90);const blob=await new Promise(r=>c.toBlob(r,'image/png'));
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
   await YebaeonCloud.api('/media/'+sha+'/content',{method:'PUT',headers:{'Content-Type':'image/png','X-Yebaeon-SHA256':sha},body:blob});
   const path=(await(await YebaeonCloud.api('/media/paths',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'봄 들판',ext:'png',items:[{sha256:sha}]})})).json()).paths[0].path;
   await YebaeonCloud.api('/favorites',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'media',key:sha,label:path,on:true})});});
  await page.locator('#studioPlaylistPicker').click();await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill('시험 예배');await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});
  await page.evaluate(async d=>{YebaeonPlaylists.appendDocuments([d]);await YebaeonPlaylists.save();const s=YebaeonPlaylists.selectedPlaylist();const [lib,node]=s.key.split('/');await YebaeonPlaylists.openNode(lib,node);},lyrics);
  await page.locator('#playlistItems .order-tag.need').click();await page.locator('.songbook-need').getByRole('button',{name:'PPT 가져오기'}).click();
  await page.locator('#pptDialog[open]').waitFor();
  const ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>','ppt/presentation.xml':`<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="r1"/><p:sldId id="257" r:id="r2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,'ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'};
  for(const i of [1,2]){files[`ppt/slides/slide${i}.xml`]=`<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="score"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="img"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`;files[`ppt/slides/_rels/slide${i}.xml.rels`]='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/score.png"/></Relationships>';}
  const zipped={};for(const[k,v]of Object.entries(files))zipped[k]=strToU8(v);zipped['ppt/media/score.png']=Buffer.from(png,'base64');
  await page.locator('#pptFile').setInputFiles({name:'아무 이름.pptx',mimeType:'application/octet-stream',buffer:Buffer.from(zipSync(zipped))});
  await page.waitForFunction(()=>!YebaeonPPTImport.state().busy&&YebaeonPPTImport.state().outputs.length===2,null,{timeout:60000});
  assert.match(await page.locator('#pptPair').textContent(),/짝 찬양.*합성 새 노래 제목.*풀기/,'[악보 필요]의 가사가 처음부터 짝');
  assert.equal(await page.locator('#pptBackground .import-background-label').textContent(),'첫 장 배경');
  assert.ok(await page.locator('#pptSlides .ppt-composite').first().evaluate(e=>getComputedStyle(e).backgroundImage.includes('conic-gradient')),'미리보기는 투명 격자로 보인다');
  assert.equal(await page.locator('#pptBackground').getByRole('button',{name:'미디어에서 고르기…'}).count(),0);
  // 첫 장 배경: 즐겨찾기에서 고르기
  await page.locator('#pptBackground').getByRole('button',{name:'배경 추가',exact:true}).click();
  await page.locator('#pptBackground .import-background-pick',{hasText:'봄 들판'}).click();
  assert.equal(await page.evaluate(()=>YebaeonPPTImport.state().outputs.length>0),true);
  await page.locator('#pptSave').click();
  await page.waitForFunction(()=>!document.querySelector('#pptDialog').open,null,{timeout:60000});
  await page.waitForFunction(id=>YebaeonSongbook.state().groups.some(g=>g.includes(id))&&YebaeonPlaylists.items()[0]?.document?.id!==id&&!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy,lyrics.id,{timeout:20000});
  const made=await page.evaluate(()=>YebaeonPlaylists.items()[0].document);
  assert.equal(made.category,'악보찬양');assert.deepEqual(await page.evaluate(id=>YebaeonSongbook.state().groups.find(g=>g.includes(id)),lyrics.id),[lyrics.id,made.id]);
  const saved=await page.evaluate(async()=>{const s=YebaeonPlaylists.selectedPlaylist(),[lib,node]=s.key.split('/');return (await(await YebaeonCloud.api(`/playlists/${lib}/plan?node=${node}`)).json()).items.map(x=>x.document?.id);});
  assert.deepEqual(saved,[made.id],'순서의 가사 항목을 새 악보로 바꿔 저장');
  const xml=await page.evaluate(async id=>(await YebaeonCloud.api('/documents/'+id+'/content')).text(),made.id);
  const slides=xml.match(/<RVDisplaySlide [\s\S]*?<\/RVDisplaySlide>/g);
  assert.equal(slides.length,2);for(const s of slides){assert.match(s,/^<RVDisplaySlide [^>]*backgroundColor="1 1 1 1"/);assert.match(s,/^<RVDisplaySlide [^>]*drawingBackgroundColor="true"/);}
  assert.match(slides[0],/<RVMediaCue [^>]*behavior="1"/,'첫 장 배경은 Background cue');assert.doesNotMatch(slides[1],/<RVMediaCue /,'둘째 장에는 cue가 없다');
  assert.ok(xml.includes(encodeURIComponent('봄 들판')),'고른 즐겨찾기 그림이 첫 장 배경');
  assert.deepEqual(errors,[]);console.log('Need-score flow passed: need button to PPT import, pair row preset, checker preview, white saved slides, first-slide background from favorites (behavior 1), pair saved, order item replaced and saved');
 }finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
