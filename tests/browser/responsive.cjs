const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFile,mkdir}=require('node:fs/promises');
const {resolve,extname}=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
(async()=>{
 const root=resolve('web-editor'),server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']}:undefined),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage(),errors=[];
 let handleDialog=d=>d.accept();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>handleDialog(d));
 const ids=['11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222','33333333-3333-4333-a333-333333333333'];
 const docs=new Map(),writes=[];let order=[{id:'one',documentId:ids[0]},{id:'two',documentId:ids[1]}],pv=1,fail=null,failOrder=false,requests=[],editingRequests=[],observations=0,templateXML='';
 const metadata=id=>{const d=docs.get(id);return {id,name:d.name,path:d.name,version:d.version,updatedBy:'시험',updatedAt:'2026-10-02T00:00:00Z',sha256:createHash('sha256').update(d.xml).digest('hex')};};
 const library=()=>({id:'library',path:'기본.pro6pl',version:pv,updatedBy:'시험',updatedAt:'2026-10-02T00:00:00Z',playlists:[{id:'A',name:'예배',itemCount:order.length}]});
 const hash=()=>createHash('sha256').update(JSON.stringify(order)).digest('hex');
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;// 편집 중 표시(첫 수정 때 한 줄, 저장·이동 때 삭제)는 결정된 요청이라 '로컬 편집에 서버 요청 없음' 집계에서 따로 센다.
 if(path==='/api/editing')editingRequests.push(req.method());else requests.push(req.method()+' '+url.pathname+url.search);let data={};
 if(path==='/api/session')data={ready:true,authenticated:true,name:'시험'};
 else if(path==='/api/sync-observations'){observations++;data={items:{}};}
 else if(path==='/api/playlists')data={libraries:docs.size?[library()]:[],next:null};
 else if(path==='/api/playlists/library/plan')data={library:library(),playlist:{id:'A',name:'예배',editable:true,version:pv,sha256:hash()},ready:true,items:order.map(x=>({...x,kind:'document',name:metadata(x.documentId).name,document:metadata(x.documentId)}))};
 else if(path==='/api/playlists/library'&&req.method()==='PATCH'){if(failOrder){await route.fulfill({status:409,json:{message:'다른 작업자가 순서를 먼저 저장했습니다.'}});return;}const body=JSON.parse(req.postData());assert.equal(body.baseNodeHash,hash());assert.equal(req.headers()['if-match'],`"${pv}"`);order=body.items.map(x=>({id:x.id,documentId:x.documentId||order.find(o=>o.id===x.id).documentId}));pv++;writes.push('order');data={library:library(),playlist:{sha256:hash()}};}
 else if(path==='/api/documents')data={documents:[...docs.keys()].map(metadata),next:null};
 else if(path.startsWith('/api/documents/')){const id=path.split('/')[3];if(path.endsWith('/content')){await route.fulfill({body:docs.get(id).xml,contentType:'application/xml'});return;}
 if(req.method()==='PUT'){assert.equal(req.headers()['if-match'],`"${docs.get(id).version}"`);if(fail===id){await route.fulfill({status:409,json:{message:'다른 작업자가 먼저 저장했습니다.'}});return;}docs.get(id).xml=req.postData();docs.get(id).version++;writes.push(id);}data={document:metadata(id)};}
 else if(path==='/api/favorites')data=route.request().method()==='PUT'?JSON.parse(route.request().postData()):{items:[]};else if(path==='/api/media/paths')data={paths:[],next:null};else if(path==='/api/sync/devices')data={head:0,devices:[]};else if(path==='/api/editing')data={others:[]};else if(path==='/api/categories')data={categories:['가사찬양','악보찬양','예배순서','특별순서','옛날자료'].map(name=>({name,searchEnabled:true,historyEnabled:true}))};else throw Error('Unexpected API '+path);await route.fulfill({json:data});});
 await page.route('**/resources/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();const templates=['104','105'].map(id=>({id,name:'성경',label:'설교 본문',width:1920,height:1080,xml:templateXML}));await route.fulfill({json:name==='catalog.json'?{fonts:[],media:[]}:name==='templates.json'?templates:{books:[{name:'창세기',chapters:[{number:1,verses:[{number:1,text:'첫 줄\n둘째 줄\n'}]}]}]}});});
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.YebaeonSave&&YebaeonCloud.authenticated());await page.addScriptTag({path:'web-editor/sample-demo.js'});
 const xml=await page.evaluate(()=>{const m=PP6.parse(PP6_SAMPLE.xml,'fixture');PP6.all(m.doc,'[source]').forEach(e=>e.remove());return PP6.serialize(m);});for(let i=0;i<3;i++)docs.set(ids[i],{name:['찬양','말씀','별도'][i]+'.pro6',version:1,xml});
 templateXML=await page.evaluate(()=>{const slide=PP6.slides(PP6.parse(PP6_SAMPLE.xml,'template'))[0],box=PP6.textElements(slide)[0],ref=box.cloneNode(true);PP6.refreshIDs(ref);PP6.setText(ref,'창세기 1:1');box.parentNode.append(ref);return new XMLSerializer().serializeToString(slide);});
 await page.reload();await page.waitForFunction(()=>window.YebaeonResponsive&&YebaeonPlaylists.selectedPlaylist());
 await page.waitForFunction(()=>YebaeonResponsive.page()==='order');
 const setView=async view=>{if(await page.locator('#studioViewSelect').isVisible())await page.locator('#studioViewSelect').selectOption(view);else await page.locator(`[data-view="${view}"]`).click();};
 const nav=page.locator('.responsive-nav');assert.equal(await nav.isVisible(),true);
 const beforeNav=requests.length;
 for(const section of ['playlists','edit','order']){await nav.locator(`[data-page="${section}"]`).tap();assert.equal(await nav.locator(`[data-page="${section}"]`).getAttribute('aria-pressed'),'true');}
 assert.equal(requests.length,beforeNav,'navigation must not fetch documents or playlists');
 await page.locator('#responsiveSearch').tap();assert.equal(await page.locator('#responsiveSearchDrawer').isVisible(),true);assert.equal(await page.locator('#responsiveSearch').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(58, 65, 160)','tapped search button keeps a dark background');
 const beforeSearch=requests.length;await page.locator('#libraryQuery').fill('찬');assert.equal(requests.length,beforeSearch,'typing does not send a query');
 await page.locator('#libraryRefresh').tap();await page.waitForFunction(()=>document.querySelectorAll('#libraryList .document-item').length===3);
 await page.locator('#libraryList .document-item').first().locator('strong').tap();await page.waitForTimeout(150);assert.equal(await page.locator('#playlistItems .order-item').count(),2,'tapping a result opens it without adding');assert.equal(await page.evaluate(()=>YebaeonEditor.state().name),'찬양.pro6');await nav.locator('[data-page="order"]').tap();await page.locator('#responsiveSearch').tap();const beforeAdd=requests.length;await page.locator('#libraryList .document-item').first().locator('.responsive-add').tap();await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-item').length===3);
 assert.equal(await page.locator('#responsiveSearchDrawer').isVisible(),true);assert.equal(requests.length,beforeAdd,'click-to-add is a local draft mutation');assert.equal(writes.length,0);
 assert.equal(await page.evaluate(()=>YebaeonResponsive.page()),'order','the ＋ button adds without leaving the search');
 const grip=page.locator('#libraryList .document-item').nth(1).locator('.studio-drag-handle'),g=await grip.boundingBox(),d=await page.locator('#playlistItems .order-item').first().boundingBox();
 const cdp=await page.context().newCDPSession(page),touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]});
 await touch('touchStart',g.x+18,g.y+20);await touch('touchMove',d.x+d.width/2,d.y+2);await touch('touchCancel');assert.equal(await page.locator('#playlistItems .order-item').count(),3,'cancelled drag does not add');
 await touch('touchStart',g.x+18,g.y+20);await touch('touchMove',d.x+d.width/2,d.y+2);await touch('touchEnd');await page.waitForFunction(()=>document.querySelectorAll('#playlistItems .order-item').length===4);assert.match(await page.locator('#playlistItems .order-item').first().locator('strong').textContent(),/말씀/,'touch insert uses the indicated position');
 await page.waitForTimeout(470);assert.equal(requests.length,beforeAdd,'touch drag does not fetch');
 assert.equal(await page.evaluate(()=>YebaeonSelection.active().options.kind),'order');await page.locator('#undo').click();assert.equal(await page.locator('#playlistItems .order-item').count(),3);await page.locator('#redo').click();assert.equal(await page.locator('#playlistItems .order-item').count(),4);assert.equal(requests.length,beforeAdd,'toolbar undo/redo preserves local drag editing');
 // Chromium headless shell stops synthesizing clicks after CDP touchMove, even on a two-button page.
 // Keep genuine drag/cancel coverage; subsequent activation uses mouse clicks on the same controls.
 await nav.locator('[data-page="playlists"]').click();await page.locator('#responsiveSearchDrawer').waitFor({state:'hidden'});await nav.locator('[data-page="order"]').click();assert.equal(await page.locator('#playlistItems .order-item').count(),4);
 await page.locator('#playlistItems .order-item').nth(1).click();await page.waitForFunction(()=>YebaeonEditor.ready()&&YebaeonResponsive.page()==='edit');
 const beforeInfo=requests.length;
 assert.equal(await page.locator('.document-heading').isVisible(),false);
 await page.locator('#responsiveMore').click();await page.getByRole('menuitem',{name:'문서 메뉴 ›',exact:true}).click();await page.getByRole('menuitem',{name:'문서 정보·보기',exact:true}).click();assert.equal(await page.locator('#studioDocumentDialog .slide-size').isVisible(),true);assert.equal(await page.locator('#studioDocumentDialog').isVisible(),true);
 await page.locator('#studioDocumentDialogClose').click();assert.equal(await page.locator('.document-heading').isVisible(),false);assert.equal(requests.length,beforeInfo,'document disclosure is local');
 await page.locator('#studioHelp').click();await page.locator('#studioShortcutOS').selectOption('mac');assert.match(await page.locator('#studioShortcutList').textContent(),/⌘ \+ S/);await page.locator('#studioHelpDialogClose').click();assert.equal(await page.locator('#studioPresence').count(),0,'no empty presence placeholder');assert.equal(requests.length,beforeInfo,'help is local UI only');
 const original=await page.evaluate(()=>YebaeonEditor.document().xml);
 await page.locator('#responsiveQuick').click();await page.locator('#quickInputs textarea').first().fill('반응형 편집\n한글 초안 보존');
 const beforeReturn=requests.length;await nav.locator('[data-page="order"]').click();await nav.locator('[data-page="edit"]').click();assert.equal(requests.length,beforeReturn);assert.match(await page.evaluate(()=>YebaeonEditor.document().xml),/RVPresentationDocument/);assert.notEqual(await page.evaluate(()=>YebaeonEditor.document().xml),original);
 assert.equal(await page.evaluate(()=>YebaeonEditor.state().dirty),true);assert.equal(await page.locator('#quickDialog').isVisible(),false);
 await page.locator('#responsiveQuick').click();await page.locator('#quickInputs textarea').first().waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#quickDialog').isVisible(),false);
 await setView('reflow');await page.locator('#reflowRows textarea').first().fill('리플로우 이동 보존');await page.locator('#reflowRows textarea').first().dispatchEvent('compositionstart');await page.evaluate(()=>YebaeonResponsive.navigate('playlists'));assert.equal(await page.evaluate(()=>YebaeonResponsive.page()),'edit');await page.locator('#reflowRows textarea').first().dispatchEvent('compositionend');await page.waitForFunction(()=>YebaeonResponsive.page()==='playlists');await nav.locator('[data-page="edit"]').click();assert.equal(await page.locator('#reflowRows textarea').first().inputValue(),'리플로우 이동 보존');
 await setView('editor');await page.locator('#responsiveProperties').click();assert.equal(await page.locator('#inspector').isVisible(),true);await page.locator('#responsivePropertiesClose').click();assert.equal(await page.locator('#inspector').isVisible(),false);
 // Phone editor: the slide strip, the pager and a horizontal swipe on the stage turn slides; a swipe never moves the untapped box.
 const stageTouch=await context.newCDPSession(page),swipe=async(from,to)=>{const b=await page.locator('#layoutStage').boundingBox(),y=b.y+b.height/2;await stageTouch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*from,y}]});for(let i=1;i<=6;i++)await stageTouch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width*(from+(to-from)*i/6),y}]});await stageTouch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 assert.equal(await page.locator('#slidePane').isVisible(),true,'slide strip under the phone editor');await page.locator('#slides .slide-card').nth(0).tap();const box0=await page.evaluate(()=>JSON.stringify(PP6.rect(PP6.textElements(YebaeonEditor.current())[0])));
 await swipe(.8,.2);assert.equal(await page.evaluate(()=>YebaeonEditor.selected()),1);assert.equal(await page.evaluate(()=>JSON.stringify(PP6.rect(PP6.textElements(PP6.slides(YebaeonEditor.model())[0])[0]))),box0);
 await page.locator('#layoutNext').click();assert.equal(await page.locator('#layoutPage').textContent(),'3 / 3');assert.equal(await page.locator('#layoutNext').isDisabled(),true);await swipe(.2,.8);assert.equal(await page.evaluate(()=>YebaeonEditor.selected()),1);await page.locator('#slides .slide-card').nth(0).tap();
 await setView('slides');await page.locator('#responsiveMultiple').click();await page.locator('.slide-card').nth(1).click();assert.equal(await page.locator('.slide-card.selected').count(),2);await page.locator('#responsiveMultiple').click();
 // Finger drag: hold a card, then drag it below the last card to move it to the end; a plain swipe only scrolls.
 const slideLabels=()=>page.evaluate(()=>PP6.slides(YebaeonEditor.model()).map(s=>s.getAttribute('label'))),beforeTouch=await slideLabels(),held=await page.locator('.slide-card').nth(0).boundingBox(),end=await page.locator('.slide-card').last().boundingBox();
 await page.locator('.slide-card').nth(0).click();await stageTouch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:held.x+30,y:held.y+30}]});await page.waitForTimeout(420);
 for(let i=1;i<=8;i++)await stageTouch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:held.x+30+(end.x-held.x)*i/8,y:held.y+30+(end.y+end.height+20-held.y-30)*i/8}]});
 assert.equal(await page.locator('.slide-drop-marker').isVisible(),true);await stageTouch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual(await slideLabels(),[...beforeTouch.slice(1),beforeTouch[0]],'finger drag moves the slide to the end');await page.evaluate(()=>YebaeonEditor.undo());assert.deepEqual(await slideLabels(),beforeTouch);
 const pos=await page.evaluate(()=>{const a=document.querySelector('#cloudAccount').getBoundingClientRect(),b=document.querySelector('#cloudSave').getBoundingClientRect();return b.top>=a.bottom&&b.right<=innerWidth;});assert.equal(pos,true);
 // Real CAS request paths are retained; a failed order save keeps its local draft.
 failOrder=true;await page.locator('#cloudSave').click();await page.waitForFunction(()=>!YebaeonSave.busy()&&YebaeonPlaylists.state().blocked);assert.equal(writes.length,1);assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),true);assert.ok((await page.evaluate(()=>YebaeonDrafts.all())).some(r=>r.kind==='playlist'));
 failOrder=false;await page.locator('#cloudSave').click();await page.waitForFunction(()=>!YebaeonSave.busy()&&!YebaeonPlaylists.state().dirty);assert.deepEqual(writes,[ids[0],'order']);
 await mkdir('artifacts',{recursive:true});
 for(const width of [360,390,700,768,1024,1440]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(70);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no horizontal overflow at ${width}`);
  assert.equal(await nav.isVisible(),width<=700);assert.equal(await page.locator('#cloudSave').count(),1);assert.equal(await page.locator('#libraryQuery').count(),1);
  if(width<=1100)assert.equal(await page.locator('#responsiveSave #cloudSave').count(),1);else assert.equal(await page.locator('#studioTopSave #cloudSave').count(),1);assert.equal(await page.locator('#accountMenu #serverStatus').count(),1);assert.equal(await page.locator(width<=700?'#responsiveSearchSlot #documentsPane':'#studioOrderWorkspace>#documentsPane').count(),1);
  if(width<=700){const bounds=await page.evaluate(()=>({editor:document.querySelector('#editorBody').getBoundingClientRect().top,nav:document.querySelector('.responsive-nav').getBoundingClientRect().height}));assert.ok(bounds.editor<190,`phone canvas starts near the top at ${width}`);assert.ok(bounds.nav<=48,'slim bottom navigation');assert.equal(await page.locator('.playlist-footer').isVisible(),false);}assert.equal(await page.locator('.document-heading').isVisible(),false);assert.equal(await page.locator('#responsiveDocumentInfo').isVisible(),false);assert.equal(await page.locator('.playlist-footer').isVisible(),false);assert.equal(await page.locator('#studioReset').isVisible(),true);
  if([390,768,1440].includes(width))await page.screenshot({path:`artifacts/responsive-${width}.png`});
 }
 // Tablet touch reordering and desktop insertion use the same grips without API writes.
 await page.setViewportSize({width:768,height:900});await page.waitForTimeout(70);
 const beforeDrag=requests.length,firstGrip=await page.locator('#playlistItems .order-item').first().locator('.studio-drag-handle').boundingBox(),lastRow=await page.locator('#playlistItems .order-item').last().boundingBox();
 await touch('touchStart',firstGrip.x+firstGrip.width/2,firstGrip.y+firstGrip.height/2);await touch('touchMove',lastRow.x+lastRow.width/2,lastRow.y+lastRow.height-2);assert.equal(await page.locator('#studioDropMarker').isVisible(),true);await touch('touchEnd');await page.waitForTimeout(470);
 assert.match(await page.locator('#playlistItems .order-item').last().locator('strong').textContent(),/말씀/);assert.match(await page.locator('#playlistItems .order-item').first().locator('strong').textContent(),/찬양/);assert.equal(requests.length,beforeDrag,'tablet reorder only mutates the local order');
 await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(70);
 const searchBox=await page.locator('#libraryQuery').boundingBox(),resultsBox=await page.locator('#libraryList').boundingBox();assert.ok(resultsBox.y>=searchBox.y+searchBox.height,'desktop results appear under the search input');
 const resultGrip=await page.locator('#libraryList .document-item').nth(2).locator('.studio-drag-handle').boundingBox(),secondRow=await page.locator('#playlistItems .order-item').nth(1).boundingBox();
 await page.mouse.move(resultGrip.x+resultGrip.width/2,resultGrip.y+resultGrip.height/2);await page.mouse.down();await page.mouse.move(secondRow.x+secondRow.width/2,secondRow.y+2,{steps:5});assert.equal(await page.locator('#studioDropMarker').isVisible(),true);await page.mouse.up();await page.waitForTimeout(470);
 assert.equal(await page.locator('#playlistItems .order-item').count(),5);assert.match(await page.locator('#playlistItems .order-item').nth(1).locator('strong').textContent(),/별도/);assert.equal(requests.length,beforeDrag,'desktop insertion only mutates the local order');await page.locator('#orderPane').focus();await page.keyboard.press('Control+z');assert.equal(await page.locator('#playlistItems .order-item').count(),4);
 await page.setViewportSize({width:390,height:844});await nav.locator('[data-page="order"]').click();await page.locator('#playlistItems .responsive-order-menu').first().click();await page.getByRole('menuitem',{name:'아래로 이동',exact:true}).click();assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),true);
 await page.locator('#responsiveSearch').click();await page.screenshot({path:'artifacts/responsive-search.png'});const bounds=await page.evaluate(()=>{const a=document.querySelector('#responsiveSearchDrawer').getBoundingClientRect(),b=document.querySelector('.responsive-nav').getBoundingClientRect();return a.bottom<=b.top+1;});assert.equal(bounds,true);
 // Browser-only cleanup confirms its scope, preserves this tab, and skips concurrent edits.
 await page.locator('#responsiveSearchClose').click();await page.locator('#cloudAccount').click();await page.locator('#draftOpen').click();
 const other=await page.context().newPage();await other.goto(`http://127.0.0.1:${server.address().port}/favicon.svg`);
 const writePrevious=async(records)=>other.evaluate(records=>new Promise((resolve,reject)=>{const open=indexedDB.open('yebaeon-drafts',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('drafts','readwrite');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);for(const record of records)tx.objectStore('drafts').put(record);};open.onerror=()=>reject(open.error);}),records);
 const oldDraft={id:'closed-tab/old',tab:'closed-tab',kind:'document',name:'이전 초안.pro6',author:'시험',updatedAt:'2026-10-01T00:00:00Z',serial:1,xml,baseXML:xml};
 const changedDraft={...oldDraft,id:'other-tab/changed',tab:'other-tab',name:'다른 탭의 초안.pro6'};
 await writePrevious([oldDraft,changedDraft]);await page.evaluate(()=>YebaeonDrafts.show());await page.waitForFunction(()=>!document.getElementById('draftClear').disabled);
 const currentIDs=await page.evaluate(()=>(YebaeonDrafts.all()).then(records=>records.filter(r=>!['closed-tab','other-tab'].includes(r.tab)).map(r=>r.id)));assert.ok(currentIDs.length);
 await page.locator('#draftClose').click();const beforeClear=requests.length;handleDialog=d=>d.dismiss();await page.locator('#studioReset').click();await page.waitForTimeout(150);assert.equal((await page.evaluate(()=>YebaeonDrafts.all())).length,currentIDs.length+2,'cancel keeps every draft');
 // One confirmation wipes every browser draft, including this tab's, then reloads.
 handleDialog=async d=>{if(d.type()==='confirm'){assert.match(d.message(),/모두 지울까요/);await d.accept();}else await d.accept();};
 await Promise.all([page.waitForEvent('load'),page.locator('#studioReset').click()]);await page.waitForFunction(()=>window.YebaeonDrafts&&window.YebaeonSave);
 assert.deepEqual(await page.evaluate(()=>YebaeonDrafts.all()),[]);assert.equal(requests.filter((r,i)=>i>=beforeClear&&!/^GET /.test(r)).length,0,'draft cleanup writes nothing to the server');
 await other.close();handleDialog=d=>d.accept();
 assert.deepEqual(errors,[]);console.log('Responsive passed: navigation without requests, explicit search, local click/touch-drag/cancel, draft retention, quick/reflow/layout, phone editor strip/pager/swipe, slide finger drag, multi-selection, CAS failure/retry, six widths, compact all-screen shell and preserved controller DOM.');
 }catch(error){await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/responsive-failure.png'});console.error(await page.evaluate(()=>({page:YebaeonResponsive.page(),active:document.activeElement?.outerHTML.slice(0,300),busy:YebaeonSave.busy()})),errors);throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
