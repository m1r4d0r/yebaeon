const {chromium}=require('playwright');
const {createServer}=require('node:http');
const {readFile,mkdir}=require('node:fs/promises');
const {resolve,extname}=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
(async()=>{
 const root=resolve('web-editor');const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let xml='',version=1,playlistVersion=1,order=[],contentReads=0,orderPatches=0,failOrderSave=false;
 const id='11111111-1111-4111-a111-111111111111',libraryID='22222222-2222-4222-a222-222222222222';
 let catalogEnabled=false;
 const pendingDoc={id:'33333333-3333-4333-a333-333333333333',name:'아직 안 올라온 찬양.pro6',path:'아직 안 올라온 찬양.pro6',available:false,version:null,slideCount:3};
 const doc=()=>({id,path:'시험 문서.pro6',name:'시험 문서.pro6',version,updatedBy:'시험',updatedAt:'2026-10-02T00:00:00Z',lastDateUsed:'2026-10-01T00:00:00Z',useCount:1,sha256:createHash('sha256').update(xml).digest('hex')});
 const nodeHash=()=>createHash('sha256').update(JSON.stringify(order)).digest('hex');
 const library=()=>({id:libraryID,path:'기본.pro6pl',version:playlistVersion,updatedBy:'시험',updatedAt:'2026-10-02T00:00:00Z',playlists:[{id:'A',name:'금요기도회',itemCount:order.length}]});
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),path=u.pathname,method=route.request().method();let data={};
 if(path==='/api/sync-observations')data={items:{['document/'+id+'/']:{state:'pending',observedAt:'2026-10-02T00:00:00Z'},['playlist/'+libraryID+'/A']:{state:'synced',observedAt:'2026-10-02T00:00:00Z'}}};
 else if(path==='/api/session')data={ready:true,authenticated:true,name:'시험'};
 else if(path==='/api/documents'){const q=u.searchParams.get('q')||'';data={documents:xml?(catalogEnabled?(q==='본문만검색'?[{...doc(),matchedBy:'content'}]:[doc(),pendingDoc].filter(d=>d.name.includes(q))):[doc()]):[],next:null};}
 else if(path==='/api/documents/'+id+'/content'){contentReads++;await route.fulfill({body:xml,contentType:'application/xml'});return;}
 else if(path==='/api/documents/'+id){if(method==='PUT'){xml=route.request().postData();version++;}data={document:doc()};}
 else if(path==='/api/playlists')data={libraries:xml?[library()]:[],next:null};
 else if(path.endsWith('/plan'))data={library:library(),playlist:{id:'A',name:'금요기도회',editable:true,version:playlistVersion,sha256:nodeHash()},ready:true,items:order.map((x,i)=>x.documentId===pendingDoc.id?{kind:'document',id:x.id||'cue'+i,name:pendingDoc.name,document:null,indexedDocument:pendingDoc,issue:'missing'}:{kind:'document',id:x.id||'cue'+i,name:doc().name,document:doc(),sharedWith:['수요예배','금요예배']})};
 else if(path==='/api/playlists/'+libraryID&&method==='PATCH'){orderPatches++;if(failOrderSave){await route.fulfill({status:409,json:{message:'서버 순서가 먼저 바뀌었습니다.'}});return;}const body=JSON.parse(route.request().postData());assert.equal(body.baseNodeHash,nodeHash());order=body.items;playlistVersion++;data={library:library(),playlist:{sha256:nodeHash()}};}
 else if(path==='/api/activity')data={items:[{kind:'document',...doc(),author:'시험',createdAt:doc().updatedAt}],next:null};
 else if(path.endsWith('/versions'))data={versions:[],next:null};
 else throw Error('Unhandled '+path);
 await route.fulfill({json:data});});
 let templateXML='',templateReads=0;const template={id:'lazy-template',name:'성경',label:'본문',width:1920,height:1080,file:'template-aaaaaaaaaaaaaaaaaaaaaaaa.json'};
 const books=Array.from({length:66},(_,i)=>({name:i===42?'요한복음':'책'+i,chapters:[{number:3,verses:Array.from({length:36},(_,i)=>({number:i+1,text:'하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 믿는 자마다 영생을 얻게 하려 하심이라.'}))},{number:4,verses:[{number:1,text:'첫 번째 절입니다.'},{number:2,text:'두 번째 절입니다.'}]}]}));
 await page.route('**/resources/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith(template.file)){templateReads++;await route.fulfill({json:{xml:templateXML}});return;}if(path.endsWith('.png')){await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});return;}await route.fulfill({json:path.endsWith('catalog.json')?{fonts:[],media:[{name:'교회 배경',file:'fixture.png',source:'file:///Users/procg/Media/%EB%B0%B0%EA%B2%BD%20%3A%20%253A.png'}]}:path.endsWith('templates.json')?(template?[template]:[]):{books}});});
 await mkdir('artifacts',{recursive:true});
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.YebaeonCloud&&window.YebaeonResources);
 await page.addScriptTag({path:'web-editor/sample-demo.js'});
 xml=await page.evaluate(()=>{const m=PP6.parse(PP6_SAMPLE.xml,'test.pro6');for(const slide of PP6.slides(m)){const box=PP6.textElements(slide)[0],ref=box.cloneNode(true);PP6.refreshIDs(ref);PP6.setText(ref,'요한복음 3:16');ref.querySelector('RVRect3D').textContent='{120 900 0 1680 100}';box.parentNode.append(ref);}return PP6.serialize(m);});
 order=[{id:'cue0'},{id:'cue1'}];await page.evaluate(()=>YebaeonCloud.refresh());await page.locator('#libraryList .document-item').click();await page.waitForFunction(()=>YebaeonEditor.ready());await page.evaluate(()=>YebaeonPlaylists.show());
 assert.equal(await page.locator('#libraryList .sync-pending').count(),1);assert.equal(await page.locator('#playlistsList .sync-synced').count(),1);assert.match(await page.locator('#libraryList .sync-light').getAttribute('title'),/마지막 Mac 확인/);
 templateXML=await page.evaluate(xml=>new XMLSerializer().serializeToString(PP6.slides(PP6.parse(xml,'template'))[0]),xml);assert.equal(templateReads,0);assert.equal(await page.locator('#playlistItems').getByText(/함께 사용:/).count(),0);
 assert.equal(await page.locator('.slide-card').count(),3);
 await page.locator('#slideColumns').evaluate(e=>{e.value='6';e.dispatchEvent(new Event('input'));});assert.equal(await page.locator('#slideColumnsValue').textContent(),'6개');assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('slides')).gridTemplateColumns.split(' ').length),6);
 await page.locator('#slideColumns').evaluate(e=>{e.value='4';e.dispatchEvent(new Event('input'));});
 const firstReads=contentReads;
 await page.evaluate(()=>YebaeonEditor.open(PP6_SAMPLE.xml,'other.pro6',true,'other'));
 await page.evaluate(id=>YebaeonCloud.openDocument(id),id);assert.equal(contentReads,firstReads,'unchanged original should not download again');
 version++;await page.evaluate(id=>YebaeonCloud.openDocument(id),id);assert.equal(contentReads,firstReads+1,'new server version must download');
 const previewCheck=await page.evaluate(async()=>{const model=YebaeonEditor.model(),slide=YebaeonEditor.current(),canvas=()=>{const c=document.createElement('canvas');c.width=400;c.height=225;return c;};await PP6Fonts.ensure(slide);PP6Render.clear();let calls=0;const ensure=PP6Fonts.ensure;PP6Fonts.ensure=(...args)=>{calls++;return ensure(...args);};try{const a=canvas();await PP6Render.draw(a,model,slide,new Map());const first=calls,b=canvas();await PP6Render.draw(b,model,slide,new Map());const reused=calls===first&&a.toDataURL()===b.toDataURL();const changed=slide.cloneNode(true);PP6.setText(PP6.textElements(changed)[0],'새로운 본문');await PP6Render.draw(canvas(),model,changed,new Map());const edited=calls>first,after=calls;window.dispatchEvent(new Event('pp6fontschange'));await PP6Render.draw(canvas(),model,slide,new Map());return {reused,edited,fontInvalidated:calls>after};}finally{PP6Fonts.ensure=ensure;}});
 assert.deepEqual(previewCheck,{reused:true,edited:true,fontInvalidated:true});
 await page.locator('.slide-card').first().click();await page.locator('.slide-card').nth(2).click({modifiers:['Shift']});assert.equal(await page.locator('.slide-card.selected').count(),3);await page.locator('.slide-card').nth(1).click({modifiers:['Control']});assert.equal(await page.locator('.slide-card.selected').count(),2);
 const patchesBefore=orderPatches;await page.locator('#libraryList .document-item').dragTo(page.locator('#playlistItems .order-item').first());await page.waitForFunction(()=>document.getElementById('playlistsMessage').textContent.includes('초안 보존됨'));await page.waitForTimeout(350);assert.equal(orderPatches,patchesBefore,'order changes must stay local until explicit save');assert.equal(order.length,2);assert.match(await page.locator('#playlistState').textContent(),/저장 안 됨/);
 const localOrder=await page.evaluate(async()=>{const records=await YebaeonDrafts.all();return records.find(r=>r.kind==='playlist');});assert.equal(localOrder.items.length,3);
 await page.evaluate(()=>YebaeonPlaylists.openNode('22222222-2222-4222-a222-222222222222','A'));assert.equal(await page.locator('#playlistItems .order-item').count(),3,'opening the playlist must offer draft recovery');assert.equal(orderPatches,patchesBefore);
 failOrderSave=true;await page.locator('#playlistRetry').click();await page.waitForFunction(()=>YebaeonPlaylists.state().blocked&&!YebaeonPlaylists.state().busy);assert.equal(await page.evaluate(()=>YebaeonPlaylists.state().dirty),true);assert.equal(await page.locator('#playlistItems .order-item').count(),3);assert.ok((await page.evaluate(()=>YebaeonDrafts.all())).some(r=>r.kind==='playlist'));
 failOrderSave=false;await page.locator('#playlistRetry').click();await page.waitForFunction(()=>document.getElementById('playlistsMessage').textContent==='순서 저장됨');assert.equal(order.length,3);
 await page.locator('.slide-card').first().click();await page.keyboard.press('Enter');await page.locator('#quickInputs textarea').first().waitFor();await page.evaluate(()=>window.fixtureCanvas=document.querySelector('.slide-card canvas'));await page.locator('#quickInputs textarea').first().fill('빠른 편집 시험');await page.waitForFunction(()=>document.getElementById('quickCanvas').width>400);assert.equal(await page.locator('#quickCanvas').isVisible(),true);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>window.fixtureCanvas===document.querySelector('.slide-card canvas')),true);await page.keyboard.press('Escape');await page.locator('#quickDialog').waitFor({state:'hidden'});
 await page.locator('#slidePane').focus();await page.keyboard.press('Control+z');assert.notEqual(await page.evaluate(()=>PP6.parseRTF(PP6.textNode(PP6.textElements(YebaeonEditor.current())[0]).textContent).text),'빠른 편집 시험');await page.keyboard.press('Control+Shift+z');
 await page.keyboard.press('Control+s');await page.waitForFunction(()=>!YebaeonEditor.state().dirty);assert.equal(version,3);await page.waitForFunction(()=>!document.querySelector('#playlistItems .unsaved'));
 await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');assert.equal(await page.locator('.slide-card').count(),4);await page.keyboard.press('Delete');assert.equal(await page.locator('.slide-card').count(),3);
 await page.keyboard.down('AltLeft');await page.keyboard.press('KeyR');await page.keyboard.up('AltLeft');await page.locator('#reflowRows textarea').first().fill('앞부분 뒷부분');await page.locator('#reflowRows textarea').first().evaluate(e=>e.setSelectionRange(3,3));await page.keyboard.down('AltLeft');await page.keyboard.press('Enter');await page.keyboard.up('AltLeft');assert.equal(await page.locator('#reflowRows textarea').count(),4);await page.keyboard.press('Backspace');assert.equal(await page.locator('#reflowRows textarea').count(),3);
 await page.locator('#reflowClose').click();await page.locator('.slide-card').first().click({button:'right'});const chosen=await page.evaluate(()=>YebaeonEditor.selected());await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>YebaeonEditor.selected()),chosen);await page.keyboard.press('Escape');
 await page.locator('#slidePane').focus();await page.evaluate(()=>document.getElementById('slidePane').dispatchEvent(new KeyboardEvent('keydown',{code:'Delete',isComposing:true,bubbles:true})));assert.equal(await page.locator('.slide-card').count(),3);
 await page.locator('#mediaOpen').click();await page.locator('#mediaGrid button').first().dragTo(page.locator('.slide-card').first());assert.equal(await page.evaluate(()=>PP6.attr(PP6.mediaElements(YebaeonEditor.current())[0],'source')),'file:///Users/procg/Media/%EB%B0%B0%EA%B2%BD%20%3A%20%253A.png');assert.equal(await page.evaluate(async()=>!!(await YebaeonResources.media('/Users/procg/Media/배경 : %3A.png'))),true);assert.equal(await page.evaluate(async()=>!!(await YebaeonResources.media('/Users/procg/Media/배경 : :.png'))),false);await page.locator('#mediaClose').click();
 await page.locator('#resourceOpen').click();await page.locator('#bibleTemplate').selectOption(template.id);await page.locator('#bibleQuery').fill('요 3 16 4 2');await page.waitForFunction(()=>document.getElementById('bibleParsed').textContent.includes('23절'));await page.locator('#bibleAdd').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('bibleAdd').disabled);assert.ok(await page.locator('.bible-card').count()>=23);assert.equal(templateReads,1);await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/studio-bible.png'});await page.locator('.bible-card').first().dblclick();await page.locator('#bibleQuickText').fill('하나\n둘\n셋\n넷\n다섯\n여섯\n일곱');assert.equal(await page.locator('#bibleQuickCanvas').isVisible(),true);await page.screenshot({path:'artifacts/studio-bible-quick.png'});await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bibleLong').textContent==='1');assert.equal(await page.locator('.bible-card').count(),23);await page.locator('[data-bible-filter=long]').click();await page.waitForFunction(()=>document.querySelectorAll('.bible-card').length===1);await page.locator('[data-bible-filter=all]').click();await page.waitForFunction(()=>document.querySelectorAll('.bible-card').length===23);await page.locator('#bibleViewReflow').click();await page.locator('.bible-card textarea').first().fill('리플로우 본문\n미리보기 유지');assert.equal(await page.locator('.bible-card canvas').first().isVisible(),true);await page.screenshot({path:'artifacts/studio-bible-reflow.png'});await page.locator('#bibleViewSlides').click();await page.locator('#bibleAdd').click();assert.ok(await page.locator('.slide-card').count()>=26);assert.equal(await page.evaluate(()=>PP6.attr(YebaeonEditor.current(),'label')),'요한복음 3:16 (NKRV)');assert.equal(await page.evaluate(()=>PP6.parseRTF(PP6.textNode(PP6.textElements(YebaeonEditor.current())[1]).textContent).text),'요한복음 3:16');
 await page.locator('#orderPane').focus();await page.keyboard.press('Home');await page.keyboard.press('Delete');await page.locator('#playlistRetry').click();await page.waitForFunction(()=>document.getElementById('playlistsMessage').textContent==='순서 저장됨');assert.equal(order.length,2);await page.waitForFunction(()=>YebaeonPlaylists.historyState().undo>0);await page.keyboard.press('Control+z');await page.locator('#playlistRetry').click();await page.waitForFunction(()=>document.getElementById('playlistsMessage').textContent==='순서 저장됨');assert.equal(order.length,3);
 await page.screenshot({path:'artifacts/studio-main.png'});await page.locator('#cloudAccount').focus();await page.keyboard.press('Enter');await page.locator('#activityOpen').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('activityList').children.length>0);assert.deepEqual(errors,[]);
 await page.locator('#activityDialog').evaluate(e=>e.close());
 await page.evaluate(()=>{const model=PP6.parse(PP6_SAMPLE.xml,'large.pro6'),first=PP6.slides(model)[0],container=first.parentNode;PP6.slides(model).forEach(s=>s.remove());for(let i=0;i<200;i++){const copy=first.cloneNode(true);PP6.refreshIDs(copy);container.append(copy);}window.fixtureDraws=0;const draw=PP6Render.draw;PP6Render.draw=(...args)=>{window.fixtureDraws++;return draw(...args);};YebaeonEditor.open(PP6.serialize(model),'large.pro6',true,'large');YebaeonEditor.setView('slides');});
 await page.waitForTimeout(300);const initialDraws=await page.evaluate(()=>window.fixtureDraws);assert.ok(initialDraws>0&&initialDraws<100,'offscreen slides should not all render');
 await page.locator('.slide-card').last().scrollIntoViewIfNeeded();await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>window.fixtureDraws)>initialDraws,'scrolling should render newly visible slides');
 await page.locator('.slide-card').first().scrollIntoViewIfNeeded();await page.locator('.slide-card').first().click();
 await page.locator('#templateSelect').selectOption(template.id);await page.waitForFunction(()=>document.querySelector('#templateSelect option').textContent==='성경 · 본문');
 assert.equal(await page.locator('#bibleTemplate option').first().textContent(),'현재: 성경 · 본문');
 const applied=await page.evaluate(()=>YebaeonEditor.document().xml);await page.evaluate(()=>YebaeonEditor.open(PP6_SAMPLE.xml,'other.pro6',true,'other'));await page.evaluate(xml=>YebaeonEditor.open(xml,'applied.pro6',true,'applied'),applied);
 await page.waitForFunction(()=>document.querySelector('#templateSelect option').textContent==='성경 · 본문');
 await page.screenshot({path:'artifacts/studio-template-name.png'});
 await page.evaluate(()=>{const slide=PP6.slides(YebaeonEditor.model())[1];PP6.textElements(slide)[0].setAttribute('rotation','17');YebaeonEditor.redraw();});
 await page.locator('.slide-card').nth(1).click({modifiers:['Shift']});await page.waitForFunction(()=>document.querySelector('#templateSelect option').textContent==='여러 서식 선택됨');
 const {templateFormatHash}=await import('../../scripts/build.mjs');
 const browserFormat=await page.evaluate(async xml=>{const slide=new DOMParser().parseFromString(xml,'application/xml').documentElement;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(PP6.templateFormat(slide)))),n=>n.toString(16).padStart(2,'0')).join('');},templateXML);
 assert.equal(browserFormat,templateFormatHash(templateXML),'build and browser must agree on the template format');
 template.format=templateFormatHash(templateXML);xml='<?xml version="1.0"?><RVPresentationDocument width="1920" height="1080"><array rvXMLIvarName="groups"><RVSlideGrouping name="본문"><array rvXMLIvarName="slides">'+templateXML+'</array></RVSlideGrouping></array></RVPresentationDocument>';version++;
 await page.reload();await page.locator('#libraryList .document-item').click();await page.waitForFunction(()=>document.querySelector('#templateSelect option').textContent==='성경 · 본문');
 catalogEnabled=true;await page.evaluate(()=>YebaeonCloud.refresh());
 await page.evaluate(()=>{PP6.setText(PP6.textElements(YebaeonEditor.current())[0],'전환 전에 편집한 초안');YebaeonEditor.markDirty();});
 const pendingRow=page.locator('#libraryList .document-item').filter({hasText:'아직 안 올라온 찬양'});await pendingRow.click();await page.waitForFunction(()=>!YebaeonEditor.ready());
 assert.equal(await page.evaluate(()=>YebaeonEditor.ready()),false);assert.equal(await page.locator('#cloudSave').isDisabled(),true);assert.equal(await page.locator('#templateSelect').isDisabled(),true);assert.match(await page.locator('#emptyDocument').textContent(),/원본 미업로드/);assert.equal(await page.locator('.slide-card').count(),0);
 const beforeOrder=order.length;await pendingRow.dragTo(page.locator('#playlistItems .order-item').first());await page.locator('#playlistRetry').click();await page.waitForFunction(()=>document.getElementById('playlistsMessage').textContent==='순서 저장됨');assert.equal(order.length,beforeOrder+1);assert.equal(order[0].documentId,pendingDoc.id);
 await page.locator('#playlistItems .order-item').first().click();assert.match(await page.locator('#emptyDocument').textContent(),/텍스트 편집과 미리보기를 사용할 수 없습니다/);
 await page.screenshot({path:'artifacts/studio-indexed-document.png'});
 await page.locator('#libraryList .document-item').filter({hasText:'시험 문서'}).click();await page.waitForFunction(()=>YebaeonEditor.ready());assert.equal(await page.evaluate(()=>YebaeonEditor.state().dirty),true);assert.equal(await page.evaluate(()=>PP6.parseRTF(PP6.textNode(PP6.textElements(YebaeonEditor.current())[0]).textContent).text),'전환 전에 편집한 초안');
 await page.locator('#libraryQuery').fill('본문만검색');await page.waitForFunction(()=>document.querySelectorAll('#libraryList .document-item').length===1);assert.equal(await page.locator('#libraryList small').textContent(),'본문 일치');
 assert.deepEqual(errors,[]);
 await page.addScriptTag({path:'web-editor/sample-demo.js'});
 await page.evaluate(()=>{YebaeonEditor.open(PP6_SAMPLE.xml,'배치 편집 시험.pro6',true,'layout-test');YebaeonEditor.setView('editor');});
 await page.locator('#layoutStagePane').waitFor({state:'visible'});await page.waitForFunction(()=>window.YebaeonLayout.active());
 const initialBoxes=await page.evaluate(()=>PP6.textElements(YebaeonEditor.current()).length);
 await page.locator('#layerAdd').click();assert.equal(await page.evaluate(()=>PP6.textElements(YebaeonEditor.current()).length),initialBoxes+1);
 const input=page.locator('#texts label:visible textarea');await input.fill('부분 서식 시험');await input.evaluate(e=>{e.setSelectionRange(0,2);e.dispatchEvent(new Event('select'));});
 await page.waitForFunction(()=>document.querySelector('#layerProperties .help').textContent.includes('선택한 글자'));
 await page.locator('#layerProperties label').filter({hasText:'글자 크기'}).locator('input').fill('120');await page.locator('#layerProperties label').filter({hasText:'글자 크기'}).locator('input').press('Tab');
 const formatted=await page.evaluate(()=>PP6.parseRTF(PP6.textNode(YebaeonLayout.active()).textContent));assert.equal(formatted.runs[0].text,'부분');assert.equal(formatted.runs[0].style.size,120);assert.notEqual(formatted.runs[1].style.size,120);
 const stage=page.locator('#layoutStage');const before=await page.evaluate(()=>PP6.rect(YebaeonLayout.active()));await stage.focus();await page.keyboard.press('Shift+ArrowRight');assert.equal(await page.evaluate(()=>PP6.rect(YebaeonLayout.active()).x),before.x+10);
 const selectedBox=page.locator('.layer-box.active');const bounds=await selectedBox.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+30,bounds.y+bounds.height/2+20);await page.mouse.up();assert.ok((await page.evaluate(()=>PP6.rect(YebaeonLayout.active()).x))>before.x+10);
 const resize=await page.locator('.layer-resize').boundingBox(),oldWidth=await page.evaluate(()=>PP6.rect(YebaeonLayout.active()).w);await page.mouse.move(resize.x+6,resize.y+6);await page.mouse.down();await page.mouse.move(resize.x+36,resize.y+26);await page.mouse.up();assert.ok((await page.evaluate(()=>PP6.rect(YebaeonLayout.active()).w))>oldWidth);
 await page.locator('#inspector').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'artifacts/studio-layout-editor.png'});
 const savedXML=await page.evaluate(()=>YebaeonEditor.document().xml);await page.evaluate(xml=>{YebaeonEditor.open(xml,'재열기.pro6',true,'layout-reopen');YebaeonEditor.setView('editor');},savedXML);assert.equal(await page.evaluate(()=>PP6.parseRTF(PP6.textNode(YebaeonLayout.active()).textContent).runs[0].style.size),120);
 await page.locator('#layerList').getByRole('button',{name:'삭제',exact:true}).click();assert.equal(await page.evaluate(()=>PP6.textElements(YebaeonEditor.current()).length),initialBoxes);assert.equal(await page.locator('#undo').isEnabled(),true);await page.locator('#undo').click();assert.equal(await page.evaluate(()=>PP6.textElements(YebaeonEditor.current()).length),initialBoxes+1);
 // Virtual time verifies idle screens do not keep querying the production DB.
 const beforeIdleLights=await page.evaluate(()=>{window.__idleLights=0;const api=YebaeonCloud.api;YebaeonCloud.api=(path,...args)=>{if(path==='/sync-observations')window.__idleLights++;return api(path,...args);};return window.__idleLights;});
 await page.clock.install();await page.clock.fastForward(65000);assert.equal(await page.evaluate(()=>window.__idleLights),beforeIdleLights);
 const statusPage=await browser.newPage({viewport:{width:1440,height:960}});let statusReads=0,detailReads=0;
 await statusPage.clock.install();
 await statusPage.route('**/api/status*',async route=>{const detailed=new URL(route.request().url()).searchParams.has('details');statusReads++;if(detailed)detailReads++;const storage={currentDocuments:{count:3000,bytes:1024},currentPlaylists:{count:1,bytes:100},documentHistory:{count:2,bytes:200},playlistHistory:{count:0,bytes:0},trackedBytes:1324};await route.fulfill({json:{documents:3000,bytes:1024,playlists:1,catalogDocuments:3107,unavailableDocuments:107,recent:[],sync:[],observedAt:'2026-10-02T07:35:00Z',...(detailed?{storage}:{})}});});
 await statusPage.route('**/resources/catalog.json',r=>r.fulfill({json:{expectedDocuments:3107,fonts:[],media:[],templateFiles:0,templates:0,bible:{name:'개역개정',verses:31103}}}));
 await statusPage.goto(`http://127.0.0.1:${server.address().port}/status.html`);await statusPage.locator('#dashboard').waitFor({state:'visible'});assert.equal(statusReads,1);assert.equal(detailReads,0);
 await statusPage.clock.fastForward(65000);await statusPage.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(statusReads,1);
 await statusPage.locator('#refresh').click();await statusPage.waitForFunction(()=>document.getElementById('message').textContent.includes('확인했습니다'));assert.equal(statusReads,2);
 await statusPage.locator('#storageRefresh').click();await statusPage.locator('#storagePanel').waitFor({state:'visible'});assert.equal(detailReads,1);assert.equal(await statusPage.locator('#storage tr').count(),4);await statusPage.screenshot({path:'artifacts/server-status-manual.png'});await statusPage.close();

 // A failed initial session probe must not permanently lock the login form.
 const retryPage=await browser.newPage({viewport:{width:900,height:700}});
 let loginAttempts=0;
 await retryPage.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/session'){
   if(route.request().method()==='GET'){await route.abort('failed');return;}
   loginAttempts++;
   await route.fulfill(loginAttempts===1?{status:401,json:{error:'wrong_password',message:'공용 비밀번호가 맞지 않습니다.'}}:{json:{ready:true,authenticated:true,name:'재시도 시험'}});return;
  }
  await route.fulfill({json:path==='/api/playlists'?{libraries:[],next:null}:{items:{}}});
 });
 await retryPage.goto(`http://127.0.0.1:${server.address().port}/`);
 await retryPage.locator('#entryDialog').waitFor({state:'visible'});
 assert.equal(await retryPage.locator('#entrySubmit').isEnabled(),true);
 assert.match(await retryPage.locator('#entryMessage').textContent(),/다시 시도/);
 await retryPage.locator('#entryName').fill('재시도 시험');
 await retryPage.locator('#entryPassword').fill('test-only-invalid-password');
 await retryPage.locator('#entrySubmit').click();
 await retryPage.waitForFunction(()=>document.getElementById('entryMessage').textContent.includes('맞지 않습니다'));
 assert.equal(await retryPage.locator('#entrySubmit').isEnabled(),true);
 await retryPage.screenshot({path:'artifacts/studio-login-retry.png'});
 await retryPage.locator('#entryPassword').fill('test-only-correct-password');
 await retryPage.locator('#entrySubmit').click();
 await retryPage.waitForFunction(()=>YebaeonCloud.authenticated()&&!document.getElementById('entryDialog').open);
 assert.equal(loginAttempts,2);
 await retryPage.close();
 // Load original server files in Chromium; synthetic text avoids publishing church originals.
 const fontsPage=await browser.newPage({viewport:{width:1100,height:800},deviceScaleFactor:2});
 await fontsPage.route('**/resources/*.otf',async route=>{const file=new URL(route.request().url()).pathname.split('/').pop();await route.fulfill({contentType:'font/otf',body:await readFile('church-resources/'+file)});});
 await fontsPage.goto(`http://127.0.0.1:${server.address().port}/favicon.svg`);await fontsPage.setContent('<canvas id="scene" width="1920" height="1080" style="width:960px"></canvas>');
 for(const file of ['pp6.js','fonts.js','render.js','sample-demo.js'])await fontsPage.addScriptTag({path:'web-editor/'+file});
 const actualCatalog=JSON.parse(await readFile('church-resources/catalog.json','utf8'));
 const actualFonts=await fontsPage.evaluate(async catalog=>{PP6Fonts.registerCatalog(catalog.fonts);const m=PP6.parse(PP6_SAMPLE.xml,'font-test'),slide=PP6.slides(m)[0],box=PP6.textElements(slide)[0];PP6.mediaElements(slide).forEach(e=>e.remove());slide.setAttribute('drawingBackgroundColor','true');slide.setAttribute('backgroundColor','.2 .2 .2 1');PP6.setRect(box,{x:50,y:100,w:1820,h:800});
  const verify=[];for(const f of catalog.fonts.filter(f=>f.name.startsWith('Arita-buri-'))){PP6.textNode(box).textContent=PP6.textRTF('원본 글꼴 시험',{font:f.name,size:99,color:'#ffffff',align:'center',bold:false,leading:-30,tracking:-5});const warnings=await PP6Fonts.ensure(slide);verify.push({name:f.name,weight:PP6Fonts.resolve({font:f.name}).weight,warnings});}
  PP6.textNode(box).textContent=PP6.textRTF('원본 글꼴과 아웃라인\n줄 간격과 자간',{font:'NanumGothicOTF',bold:true,size:110,color:'#ffffff',align:'center',leading:23,tracking:0,strokeWidth:-5,strokeColor:'#000000'});const canvas=document.getElementById('scene');await PP6Render.draw(canvas,m,slide,new Map());const outlined=canvas.toDataURL();PP6.formatRange(box,0,0,{strokeWidth:0});await PP6Render.draw(canvas,m,slide,new Map());const strokeChanged=outlined!==canvas.toDataURL();PP6.formatRange(box,0,0,{strokeWidth:-5});await PP6Render.draw(canvas,m,slide,new Map());
  const aritaBold=PP6Fonts.resolve({font:'Arita-buri-Medium_OTF',bold:true}),nanumBold=PP6Fonts.resolve({font:'NanumGothicOTF',bold:true});return {verify,aritaBold,nanumBold,strokeChanged,loaded:PP6Fonts.state()};
 },actualCatalog);
 assert.equal(actualFonts.verify.length,5);assert.ok(actualFonts.verify.every(f=>f.warnings.length===0));assert.equal(actualFonts.aritaBold.family,'YebaeFont-arita-burib-otf');assert.equal(actualFonts.aritaBold.note,'');assert.equal(actualFonts.nanumBold.family,'YebaeFont-nanumgothicbold-otf');assert.equal(actualFonts.strokeChanged,true);assert.ok(actualFonts.loaded.every(f=>f.status==='loaded'));
 await fontsPage.locator('#scene').screenshot({path:'artifacts/studio-original-fonts.png'});console.log('Original font files and outlined render verified:',JSON.stringify(actualFonts));await fontsPage.close();
 assert.deepEqual(errors,[]);
 console.log('Studio browser flows passed: original/preview reuse, version/edit/font invalidation, template names after apply/reopen/reload, editing, save, undo, clipboard, reflow, IME, menu, Bible, explicit order save, draft recovery/conflict and activity');
 }finally{await page.screenshot({path:'artifacts/studio-final.png'}).catch(()=>{});await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});




