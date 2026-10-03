const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFile,mkdir}=require('node:fs/promises');
const {resolve,extname}=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
(async()=>{
 const root=resolve('web-editor'),server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']}:undefined),page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const ids=['11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222','33333333-3333-4333-a333-333333333333'];
 const docs=new Map(),writes=[];let order=[{id:'one',documentId:ids[0]},{id:'two',documentId:ids[1]}],pv=1,fail=null,observations=0,templateXML='';
 const metadata=id=>{const d=docs.get(id);return {id,name:d.name,path:d.name,version:d.version,updatedBy:'시험',updatedAt:'2026-10-02T00:00:00Z',sha256:createHash('sha256').update(d.xml).digest('hex')};};
 const library=()=>({id:'library',path:'기본.pro6pl',version:pv,updatedBy:'시험',updatedAt:'2026-10-02T00:00:00Z',playlists:[{id:'A',name:'예배',itemCount:order.length}]});
 const hash=()=>createHash('sha256').update(JSON.stringify(order)).digest('hex');
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;let data={};
 if(path==='/api/session')data={ready:true,authenticated:true,name:'시험'};
 else if(path==='/api/sync-observations'){observations++;data={items:{}};}
 else if(path==='/api/playlists')data={libraries:docs.size?[library()]:[],next:null};
 else if(path==='/api/playlists/library/plan')data={library:library(),playlist:{id:'A',name:'예배',editable:true,version:pv,sha256:hash()},ready:true,items:order.map(x=>({...x,kind:'document',name:metadata(x.documentId).name,document:metadata(x.documentId)}))};
 else if(path==='/api/playlists/library'&&req.method()==='PATCH'){const body=JSON.parse(req.postData());assert.equal(body.baseNodeHash,hash());assert.equal(req.headers()['if-match'],`"${pv}"`);order=body.items.map(x=>({id:x.id,documentId:x.documentId||order.find(o=>o.id===x.id).documentId}));pv++;writes.push('order');data={library:library(),playlist:{sha256:hash()}};}
 else if(path==='/api/documents')data={documents:[...docs.keys()].map(metadata),next:null};
 else if(path.startsWith('/api/documents/')){const id=path.split('/')[3];if(path.endsWith('/content')){await route.fulfill({body:docs.get(id).xml,contentType:'application/xml'});return;}
 if(req.method()==='PUT'){assert.equal(req.headers()['if-match'],`"${docs.get(id).version}"`);if(fail===id){await route.fulfill({status:409,json:{message:'다른 작업자가 먼저 저장했습니다.'}});return;}docs.get(id).xml=req.postData();docs.get(id).version++;writes.push(id);}data={document:metadata(id)};}
 else throw Error('Unexpected API '+path);await route.fulfill({json:data});});
 await page.route('**/resources/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();const templates=['104','105'].map(id=>({id,name:'성경',label:'설교 본문',width:1920,height:1080,xml:templateXML}));await route.fulfill({json:name==='catalog.json'?{fonts:[],media:[]}:name==='templates.json'?templates:{books:[{name:'창세기',chapters:[{number:1,verses:[{number:1,text:'첫 줄\n둘째 줄\n'}]}]}]}});});
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.YebaeonSave&&YebaeonCloud.authenticated());await page.addScriptTag({path:'web-editor/sample-demo.js'});
 const xml=await page.evaluate(()=>{const m=PP6.parse(PP6_SAMPLE.xml,'fixture');PP6.all(m.doc,'[source]').forEach(e=>e.remove());return PP6.serialize(m);});for(let i=0;i<3;i++)docs.set(ids[i],{name:['찬양','말씀','별도'][i]+'.pro6',version:1,xml});
 templateXML=await page.evaluate(()=>{const slide=PP6.slides(PP6.parse(PP6_SAMPLE.xml,'template'))[0],box=PP6.textElements(slide)[0],ref=box.cloneNode(true);PP6.refreshIDs(ref);PP6.setText(ref,'창세기 1:1');box.parentNode.append(ref);return new XMLSerializer().serializeToString(slide);});
 // Reload resources now that the fixture has its actual template XML.
 await page.reload();await page.waitForFunction(()=>window.YebaeonSave&&YebaeonCloud.authenticated());await page.evaluate(id=>YebaeonCloud.openDocument(id),ids[0]);await page.evaluate(()=>YebaeonPlaylists.show());
 assert.equal(await page.locator('#slideColumns').inputValue(),'6');
 await page.locator('#responsiveMore').click();await page.getByRole('menuitem',{name:'문서 정보·서식',exact:true}).click();
 assert.equal(await page.locator('#studioDocumentDialog .slide-size').isVisible(),true);assert.equal(await page.locator('#studioDocumentDialog #templateSelect').isVisible(),true);await page.locator('#studioDocumentDialogClose').click();assert.equal(await page.locator('.document-heading').isVisible(),false);
 await page.locator('#slideColumns').evaluate(e=>{e.value='7';e.dispatchEvent(new Event('input'));});await page.reload();await page.waitForFunction(()=>window.YebaeonSave&&YebaeonCloud.authenticated());assert.equal(await page.locator('#slideColumns').inputValue(),'7');await page.evaluate(id=>YebaeonCloud.openDocument(id),ids[0]);await page.evaluate(()=>YebaeonPlaylists.show());
 for(const code of ['KeyR','KeyE','KeyB','KeyV']){for(let i=0;i<2;i++){await page.keyboard.down('AltLeft');await page.keyboard.press(code);await page.keyboard.up('AltLeft');await page.waitForTimeout(100);}assert.equal(await page.evaluate(()=>YebaeonEditor.view()),'slides');assert.equal(await page.locator('#biblePanel').isVisible(),false);assert.equal(await page.locator('#mediaDrawer').isVisible(),false);}
 await page.locator('#resourceOpen').click();assert.equal(await page.locator('#bibleTemplate').inputValue(),'104');await page.locator('#bibleTemplate').selectOption('105');await page.locator('#bibleQuery').fill('창 1 1');await page.waitForFunction(()=>!document.querySelector('#bibleAdd').disabled);await page.locator('#bibleViewReflow').click();assert.equal(await page.locator('.bible-card textarea').first().inputValue(),'첫 줄\n둘째 줄');await page.locator('#bibleAdd').click();await page.locator('#resourceOpen').click();assert.equal(await page.locator('#bibleTemplate').inputValue(),'104');await page.locator('#resourceClose').click();
 const edit=async(id,text)=>{await page.evaluate(async({id,text})=>{await YebaeonCloud.openDocument(id);PP6.setText(PP6.textElements(YebaeonEditor.current())[0],text);YebaeonEditor.markDirty();},{id,text});};
 await edit(ids[0],'수정 A');await edit(ids[1],'수정 B');
 assert.deepEqual(await page.evaluate(()=>YebaeonCloud.pendingDocuments(YebaeonPlaylists.saveScope().ids).map(x=>x.name)),['찬양.pro6','말씀.pro6']);
 // Remove an edited member: its cached edits still belong to this save scope.
 await page.locator('#orderPane').focus();await page.keyboard.press('Home');await page.keyboard.press('Delete');assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),true);
 fail=ids[0];await page.evaluate(()=>YebaeonSave.save());assert.deepEqual(writes,[ids[1]]);assert.equal(await page.evaluate(id=>YebaeonEditor.isDirty(id),ids[1]),false);assert.equal(await page.evaluate(id=>YebaeonEditor.isDirty(id),ids[0]),true);assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),true);assert.ok((await page.evaluate(()=>YebaeonDrafts.all())).some(x=>x.kind==='document'&&x.base.id===ids[0]));
 fail=null;const before=observations;await page.evaluate(()=>YebaeonSave.save());assert.deepEqual(writes,[ids[1],ids[0],'order']);assert.equal(observations-before,1);assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),false);
 await edit(ids[2],'독립 문서');assert.equal(await page.evaluate(()=>YebaeonPlaylists.saveScope()),null);await page.evaluate(()=>YebaeonSave.save());assert.equal(writes.at(-1),ids[2]);
 // Selecting a playlist takes precedence even if the previous unrelated document remains visible.
 await page.evaluate(()=>YebaeonPlaylists.openNode('library','A'));assert.equal(await page.evaluate(()=>YebaeonPlaylists.saveScope().name),'예배');
 await edit(ids[1],'검색에서 연 구성 문서');assert.equal(await page.evaluate(()=>YebaeonPlaylists.saveScope().name),'예배');await page.evaluate(()=>YebaeonSave.save());assert.equal(writes.at(-1),ids[1]);
 const centered=await page.evaluate(async()=>{
  const m=PP6.parse(YebaeonEditor.document().xml,'center-test'),slide=PP6.slides(m)[0],box=PP6.textElements(slide)[0];for(const el of [...PP6.textElements(slide).slice(1),...PP6.mediaElements(slide)])el.remove();box.setAttribute('verticalAlignment','0');PP6.setRect(box,{x:100,y:100,w:1600,h:100});
  PP6.textNode(box).textContent=PP6.textRTF('FIRST\nSECOND',{font:'Arial',size:100,color:'#ffffff',align:'center'});const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const layout=PP6Render.layout(canvas.getContext('2d'),PP6.parseRTF(PP6.textNode(box).textContent),PP6.rect(box));const baselines=[],old=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(text==='FIRST')baselines.push(y);return old.call(this,text,x,y,...rest);};try{PP6Render.clear();await PP6Render.draw(canvas,m,slide,new Map());}finally{CanvasRenderingContext2D.prototype.fillText=old;}
  return {actual:baselines.at(-1),expected:(100-layout.total)/2+layout.lines[0].ascent,overflow:layout.total>100};
 });assert.equal(centered.overflow,true);assert.ok(Math.abs(centered.actual-centered.expected)<.001,'overflow must retain the original vertical center');
 assert.deepEqual(errors,[]);await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/studio-workflow.png'});console.log('Studio workflow passed: document-details slider/persistence, view toggles, Bible template/newlines, cached batch save, partial CAS failure/retry, single refresh and scope selection.');
 }catch(error){console.error(await page.locator('#resourceMessage').textContent(),await page.locator('#status').textContent(),errors);throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
