// 사용설명서 그림(docs/manual/img/*.png)을 찍는다. 빌드된 Studio(dist)와 로컬 Worker 모사(Miniflare)만 쓰고 운영 서버는 치지 않는다.
// 예시 자료(곡 이름·가사·이름)는 모두 지어낸 것이다. 교회 원본 파일을 쓰지 않는다.
// 실행: npm run build && node scripts/manual-shots.cjs [그림이름...]
const {chromium}=require('playwright'),{createServer}=require('node:http');
const {readFile,mkdir,writeFile}=require('node:fs/promises'),{resolve,extname,sep,join}=require('node:path');
const {deflateRawSync}=require('node:zlib');
const OUT=resolve('docs/manual/img'),ONLY=new Set(process.argv.slice(2));
const TYPES={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.bcmap':'application/octet-stream'};
const NAVY='0.09 0.12 0.26 1',PLUM='0.24 0.13 0.30 1',GREEN='0.07 0.20 0.18 1';
const SONGS=[
 {name:'빛 되신 주',bg:NAVY,slides:[['1절','빛 되신 주 내 길을 비추네\n어둔 밤 지나 새 아침 오네'],['2절','두려움 없이 그 길을 걸으리\n주 손 잡고 나아가리'],['후렴','나의 빛 나의 노래\n영원히 주를 찬양해'],['후렴','나의 빛 나의 노래\n영원히 주를 찬양해']]},
 {name:'새 아침의 노래',bg:PLUM,slides:[['1절','새 아침이 밝아 오네\n주의 사랑 새로워라'],['2절','어제의 눈물 씻으시고\n오늘의 기쁨 주시네'],['후렴','할렐루야 노래하리\n새 아침의 노래를']]},
 {name:'평안의 길',bg:GREEN,slides:[['1절','평안의 길로 나를 인도하네\n쉴 만한 물가로 이끄시네'],['후렴','주 안에 평안 있네\n그 품에 안기리']]},
 {name:'감사의 고백',bg:NAVY,slides:[['1절','받은 은혜 셀 수 없어\n감사의 고백 드리네'],['후렴','감사해 감사해\n내 삶의 모든 날']]},
 {name:'주 앞에 서서',bg:PLUM,slides:[['1절','주 앞에 서서 엎드리네\n나의 모든 것 드리네']]},
 {name:'은혜 위에 은혜',bg:GREEN,slides:[['1절','은혜 위에 은혜 더하시네\n날마다 새롭게 하시네']]},
 {name:'은혜의 노래',bg:NAVY,slides:[['1절','은혜의 노래 부르리\n나의 평생에']]}
];
const ORDER=[{name:'첫화면',slides:[['','예배온 교회\n주일예배']]},{name:'사도신경',slides:[['','나는 전능하사 천지를 만드신\n하나님 아버지를 믿사오며']]},{name:'광고',slides:[['','교회 소식']]},{name:'엔딩',slides:[['','함께 예배해 주셔서\n감사합니다']]}];
// 주보: 브라우저 검사의 합성 HWP 만드는 법을 그대로 쓰고 글만 지어낸 예시로 바꾼다.
async function bulletinHWP(){const CFB=await import('cfb'),src=await readFile('tests/bulletin.test.mjs','utf8'),start=src.indexOf('export function syntheticHWP'),end=src.indexOf('\ntest(',start);
 let body=src.slice(start,end).replace('export ','');
 for(const [a,b] of [['합성 시리즈3, 합성 설교 제목!','기도 시리즈3, 응답하시는 하나님'],['합성 설교 제목!','응답하시는 하나님'],['합성 믿음의 원리는?','믿음의 원리는?'],['창1:1 태초에 합성 인용','창1:1 태초에 하나님이 천지를 창조하시니라'],['합성 인용 둘','베드로가 이르되'],['합성 나눔 제목','말씀 요약'],['합성 찬양 A','빛 되신 주'],['합성 찬양 B','새 아침의 노래'],['합성 찬양 C','평안의 길'],['합성 찬양 D','감사의 고백'],['합성 찬양 E','주 앞에 서서'],['합성 찬양 F','은혜 위에 은혜'],['가나다집사','김철수집사'],['라마바시무집사','박영희권사'],['사아자형제','이믿음형제'],['합성 소식','교회 소식'],['시 험 목사','정사랑 목사'],['청년 합성 설교','두려움 없는 믿음'],['차카타 강도사','한빛 강도사'],['파하가전도사','최기쁨전도사'],['합성 기도2','기도 시리즈2'],['금요 합성 제목','깨어 기도하라'],['새벽 합성 줄','새벽기도 안내'],['합성 ','']])body=body.split(a).join(b);
 return new Function('CFB','deflateRawSync','Buffer',body+';return syntheticHWP;')(CFB,deflateRawSync,Buffer)();}
// 악보 PPT: 투명 악보 그림(제목 포함) + 장을 덮는 배경 사진, 3장.
let shotPage=null;
async function scorePPTX(){const {zipSync,strToU8}=await import('fflate');
 const images=await shotPage.evaluate(()=>{const W=1600,H=900,out={};
  const photo=document.createElement('canvas');photo.width=W;photo.height=H;let x=photo.getContext('2d'),g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,'#cfe3f2');g.addColorStop(1,'#f3d9e6');x.fillStyle=g;x.fillRect(0,0,W,H);
  for(let i=0;i<26;i++){x.globalAlpha=.18+.1*(i%3);x.fillStyle=['#ffffff','#ffd6e5','#d6ecff','#fff2c2'][i%4];x.beginPath();x.arc((i*263)%W,(i*157)%H,30+(i*29)%110,0,7);x.fill();}out.photo=photo.toDataURL().split(',')[1];
  const lines=[['평안의 길로','나를 인도하','네'],['쉴 만한 물가','로 이끄시','네'],['주 안에 평안','있네 그 품에','안기리']];
  lines.forEach((words,n)=>{const c=document.createElement('canvas');c.width=W;c.height=H;const y=c.getContext('2d');y.fillStyle='#c8541c';y.font='bold 44px sans-serif';y.fillText('♪ 평안의 길',40,70);y.fillStyle='#888';y.font='22px sans-serif';y.fillText('예시 악보 · 설명서용',44,104);
   for(const [s,top] of [[0,260],[1,560]]){const x0=s?520:90,x1=s?1540:1110;y.strokeStyle='#111';y.lineWidth=2;for(let k=0;k<5;k++){y.beginPath();y.moveTo(x0,top+k*16);y.lineTo(x1,top+k*16);y.stroke();}
    y.fillStyle='#111';y.font='86px serif';y.fillText('𝄞',x0+4,top+70);for(let m=1;m<4;m++){const bx=x0+m*(x1-x0)/4;y.beginPath();y.moveTo(bx,top);y.lineTo(bx,top+64);y.stroke();}
    for(let k=0;k<10;k++){const nx=x0+90+k*(x1-x0-120)/10,ny=top+((k*37+n*11+s*19)%9)*8;y.beginPath();y.ellipse(nx,ny,11,8,-.4,0,7);y.fill();y.beginPath();y.moveTo(nx+10,ny);y.lineTo(nx+10,ny-50);y.stroke();}
    y.font='bold 30px sans-serif';const ws=s?words.slice(1):words.slice(0,2);ws.forEach((w,k)=>y.fillText(w,x0+80+k*(x1-x0)/2.2,top+120));}
   out['score'+n]=c.toDataURL().split(',')[1];});return out;});
 const ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
 const pic=(id,name,rel)=>`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>`;
 const rel=(id,target)=>`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`;
 const files={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>',
  'ppt/presentation.xml':`<p:presentation ${ns}><p:sldIdLst>${[1,2,3].map(i=>`<p:sldId id="${255+i}" r:id="r${i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
  'ppt/_rels/presentation.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1,2,3].map(i=>`<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`};
 for(const i of [1,2,3]){files[`ppt/slides/slide${i}.xml`]=`<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${pic(4,'photo','photo')}${pic(2,'score','img')}</p:spTree></p:cSld></p:sld>`;files[`ppt/slides/_rels/slide${i}.xml.rels`]=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('img',`../media/score${i-1}.png`)}${rel('photo','../media/photo.png')}</Relationships>`;}
 const zipped={};for(const [k,v] of Object.entries(files))zipped[k]=strToU8(v);zipped['ppt/media/photo.png']=Buffer.from(images.photo,'base64');for(const i of [0,1,2])zipped[`ppt/media/score${i}.png`]=Buffer.from(images['score'+i],'base64');
 return Buffer.from(zipSync(zipped));}
async function main(){
 const {build}=await import('esbuild'),{Miniflare,convertV4MiniflareOptions}=await import('miniflare'),{zipSync,strToU8}=await import('fflate'),CFB=await import('cfb');
 const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'manual-only',ADMIN_PASSWORD:'manual-admin'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
 const root=resolve('dist');let origin;
 const server=createServer(async(req,res)=>{try{const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){const parts=[];for await(const part of req)parts.push(part);const response=await mf.dispatchFetch(url,{method:req.method,headers:req.headers,...parts.length?{body:Buffer.concat(parts)}:{}});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  let path=resolve(root,'.'+decodeURIComponent(url.pathname).replace(/\/$/,'/index.html'));if(url.pathname==='/status')path=join(root,'status.html');if(!path.startsWith(root+sep))throw Error('path');
  res.setHeader('Content-Type',TYPES[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch(e){res.writeHead(404);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']}:undefined);
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1.5,locale:'ko-KR'});const page=await context.newPage(),errors=[];shotPage=page;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 // 리눅스 기본 한글 글꼴 대신 교회 자료의 나눔바른고딕으로 화면을 그린다(사진만 보기 좋게).
 const catalog=JSON.parse(await readFile('church-resources/catalog.json','utf8')),uiFont=catalog.fonts.find(f=>f.name==='NanumBarunGothicOTF');
 const fontCSS=uiFont?`@font-face{font-family:ManualUI;src:url(/resources/${uiFont.file})}body,button,input,select,textarea,dialog{font-family:ManualUI,sans-serif!important}`:'';
 const styled=async()=>{if(fontCSS){await page.addStyleTag({content:fontCSS});await page.evaluate(()=>document.fonts.ready);}};
 await mkdir(OUT,{recursive:true});
 const shot=async(name,target,options={})=>{if(ONLY.size&&!ONLY.has(name))return;await page.waitForTimeout(options.wait??350);const path=join(OUT,name+'.png');
  if(options.clip)await page.screenshot({path,clip:options.clip});else if(target)await (typeof target==='string'?page.locator(target).first():target).screenshot({path});else await page.screenshot({path});console.log('그림',name);};
 const box=async(selector,pad=0)=>{const b=await page.locator(selector).first().boundingBox();return {x:Math.max(0,b.x-pad),y:Math.max(0,b.y-pad),width:b.width+pad*2,height:b.height+pad*2};};
 const union=async(selectors,pad=8)=>{const bs=[];for(const s of selectors)bs.push(await page.locator(s).first().boundingBox());const x=Math.min(...bs.map(b=>b.x))-pad,y=Math.min(...bs.map(b=>b.y))-pad;return {x:Math.max(0,x),y:Math.max(0,y),width:Math.max(...bs.map(b=>b.x+b.width))-x+pad,height:Math.max(...bs.map(b=>b.y+b.height))-y+pad};};
 try{
  // 입장
  await page.goto(origin);await styled();await page.locator('#entryName').fill('김예배');await shot('login','#entryDialog');
  await page.locator('#entryPassword').fill('manual-only');await page.locator('#entrySubmit').click();await page.locator('#entryDialog').waitFor({state:'hidden'});
  // 예시 문서 만들기
  const songs=SONGS,order=ORDER;
  await page.evaluate(async({songs,order})=>{
   const C=YebaeonCloud,P=PP6,L=YebaeonLibraryActions;
   const make=(category,slides,bg)=>{const m=P.parse(L.blankDocument(category),'x'),first=P.slides(m)[0],holder=first.parentNode,proto=first.cloneNode(true);first.remove();
    for(const [label,text] of slides){const s=proto.cloneNode(true);P.refreshIDs(s);const box=P.textElements(s)[0],texts=[].concat(text);P.setText(box,texts[0]);for(const more of texts.slice(1)){const b=box.cloneNode(true);P.refreshIDs(b);P.setText(b,more);const r=P.rect(b);P.setRect(b,{...r,y:r.y+r.h*.75,h:r.h*.2});box.parentNode.append(b);}if(label)s.setAttribute('label',label);if(bg){s.setAttribute('backgroundColor',bg);s.setAttribute('drawingBackgroundColor','true');}holder.append(s);}return P.serialize(m);};
   const post=(name,xml)=>C.api('/documents?'+new URLSearchParams({path:name+'.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml'},body:xml});
   for(const s of songs)await post(s.name,make('가사찬양',s.slides,s.bg));
   for(const d of order)await post(d.name,make('예배순서',d.slides,'0.06 0.07 0.12 1'));
   const title=t=>[['',t]],verse=(ref,text)=>[ref+' (NKRV)',[text,ref]];
   for(const [name,who] of [['1부 기도','김철수 집사'],['2부 기도','박영희 권사'],['청년부 기도','이믿음 형제']])await post(name,make('예배순서',[['','대표기도\n'+who]],'0.06 0.07 0.12 1'));
   await post('주일예배말씀',make('예배순서',[['','지난 시리즈\n지난 설교 제목\n(시편 23:1)'],verse('시편 23:1','여호와는 나의 목자시니 내게 부족함이 없으리로다'),['','What? 지난 질문\n지난 대지 문장입니다.']],'0.06 0.07 0.12 1'));
   await post('청년부 말씀',make('예배순서',[['','지난 청년 설교\n(요한복음 1:1)'],verse('요한복음 1:1','태초에 말씀이 계시니라')],'0.06 0.07 0.12 1'));
   await post('주일예배말씀 목사님 ppt',make('예배순서',[['','설교 자료']],'0 0 0 1'));
   await post('수요예배',make('예배순서',[['','수요예배\n(시편 1:1)']],'0.06 0.07 0.12 1'));
   await post('금요예배말씀',make('예배순서',[['','지난 금요 제목\n(누가복음 11:1)'],verse('누가복음 11:1','주여 우리에게도 기도를 가르쳐 주옵소서')],'0.06 0.07 0.12 1'));
  },{songs,order});
  // 재생목록 만들기
  const lists={'1부 예배(품성)':['첫화면','사도신경','빛 되신 주','새 아침의 노래','1부 기도','광고','주일예배말씀','주일예배말씀 목사님 ppt','감사의 고백','은혜 위에 은혜','엔딩'],'2부 예배':['첫화면','사도신경','빛 되신 주','새 아침의 노래','평안의 길','2부 기도','광고','주일예배말씀','감사의 고백','은혜 위에 은혜','엔딩'],'청년예배':['첫화면','사도신경','평안의 길','청년부 기도','청년부 말씀','감사의 고백','광고','엔딩'],'수요예배':['첫화면','수요예배','엔딩'],'금요예배':['첫화면','금요예배말씀','엔딩']};
  for(const [name,docs] of Object.entries(lists)){
   if(!await page.locator('#studioPlaylistsDialog').evaluate(e=>e.open))await page.locator('#studioPlaylistPicker').click();
   await page.locator('#playlistNew').click();await page.locator('#newPlaylistName').fill(name);await page.locator('#newPlaylistSubmit').click();await page.locator('#newPlaylistDialog').waitFor({state:'hidden'});
   await page.waitForFunction(n=>YebaeonPlaylists.selectedPlaylist()?.name===n,name);
   await page.evaluate(async docs=>{const found=[];for(const d of docs){const r=await YebaeonSearch.query(d);found.push(r.documents.find(x=>x.name===d+'.pro6'));}YebaeonPlaylists.appendDocuments(found);await YebaeonPlaylists.save();},docs);
   await page.waitForFunction(()=>!YebaeonPlaylists.state().dirty&&!YebaeonPlaylists.state().busy);
  }
  if(await page.locator('#studioPlaylistsDialog').evaluate(e=>e.open))await page.keyboard.press('Escape');
  await page.reload();await page.waitForFunction(()=>window.YebaeonPlaylists&&YebaeonCloud.authenticated()&&YebaeonPlaylists.libraries().length);await styled();
  await page.evaluate(()=>YebaeonPlaylists.openNode(YebaeonPlaylists.libraries()[0].id,YebaeonPlaylists.libraries()[0].playlists.find(p=>p.name==='2부 예배').id));
  await page.waitForFunction(()=>YebaeonPlaylists.selectedPlaylist()?.name==='2부 예배'&&!YebaeonPlaylists.state().busy);
  const openDoc=async name=>{await page.evaluate(async n=>{const d=(await YebaeonSearch.query(n)).documents.find(x=>x.name===n+'.pro6');await YebaeonCloud.openDocument(d.id);},name);await page.waitForTimeout(400);};
  await openDoc('빛 되신 주');
  await page.addStyleTag({content:'#status,.responsive-notice{opacity:0!important}'});
  // 배경 그림을 올리고(웹에서 가져온 그림) 찬양 문서에 씌운다.
  const backgrounds=await page.evaluate(async()=>{const list=[['새벽 하늘',['#1b2a5c','#c86b8f']],['숲길',['#0f3d33','#9bc48a']],['저녁 노을',['#3a1f4d','#f0a35e']],['잔잔한 바다',['#0e2f4f','#5fb3c9']],['따뜻한 빛',['#4a2a12','#f5d27a']],['보라 물결',['#2b1e5a','#9d7be0']]],out=[];
   for(const [name,[a,b]] of list){const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,1920,1080);g.addColorStop(0,a);g.addColorStop(1,b);x.fillStyle=g;x.fillRect(0,0,1920,1080);for(let i=0;i<16;i++){x.globalAlpha=.06+.05*(i%3);x.fillStyle='#fff';x.beginPath();x.arc((i*397+name.length*90)%1920,(i*233)%1080,60+(i*37)%170,0,7);x.fill();}
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    await YebaeonCloud.api('/media/'+sha+'/content',{method:'PUT',headers:{'Content-Type':'image/png','X-Yebaeon-SHA256':sha},body:blob});
    const r=await(await YebaeonCloud.api('/media/paths',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,ext:'png',items:[{sha256:sha}]})})).json();
    out.push('file://'+r.paths[0].path.split('/').map(p=>encodeURIComponent(p)).join('/'));await YebaeonThumbnails.make(sha,blob).catch(()=>{});}return out;});
  for(const [i,song] of SONGS.entries()){await openDoc(song.name);await page.evaluate(src=>{YebaeonEditor.selection.chosen=new Set(PP6.slides(YebaeonEditor.model()).map((_,n)=>String(n)));YebaeonEditor.setBackground(src);},backgrounds[i%backgrounds.length]);await page.evaluate(()=>YebaeonSave.save());await page.waitForFunction(()=>!YebaeonSave.busy());}
  await page.evaluate(()=>{YebaeonEditor.selection.chosen=new Set();});await openDoc('빛 되신 주');await page.mouse.click(1300,700);
  await shot('overview',null);
  const W=1440,H=900,left={x:0,y:46,width:300,height:H-46};
  // 위쪽 줄
  await shot('topbar',null,{clip:{x:0,y:0,width:W,height:46}});
  // 검색해서 넣기
  await page.locator('#libraryQuery').fill('은혜');await page.locator('#libraryQuery').press('Enter');await page.waitForTimeout(600);
  await shot('search-add',null,{clip:{x:0,y:46,width:300,height:300}});
  await page.locator('#libraryQuery').fill('');await page.locator('#libraryQuery').press('Escape');
  // 순서 항목 메뉴
  await page.locator('#playlistItems .order-item',{hasText:'평안의 길'}).first().click({button:'right'});await page.locator('#contextMenu').waitFor();
  await shot('order-menu',null,{clip:await union(['#playlistItems','#contextMenu'],6)});await page.keyboard.press('Escape');
  // 슬라이드 끌기
  const card=n=>page.locator('#slides .slide-card').nth(n).boundingBox();const c0=await card(0),c2=await card(2),c3=await card(3);
  await page.mouse.move(c0.x+40,c0.y+40);await page.mouse.down();await page.mouse.move(c0.x+90,c0.y+70,{steps:4});await page.mouse.move((c2.x+c2.width+c3.x)/2,c2.y+c2.height/2,{steps:10});
  await shot('slides-drag',null,{clip:{x:300,y:46,width:W-300,height:Math.min(H-46,c3.y+c3.height+40-46)}});
  await page.keyboard.press('Escape');await page.mouse.up();if(await page.evaluate(()=>YebaeonEditor.state().dirty))await page.keyboard.press('Control+z');
  // 편집기·리플로우
  await page.locator('[data-view="editor"]').click();await page.waitForTimeout(500);const stage=await page.locator('#stageCanvas, .stage canvas, #editorStage').first().boundingBox().catch(()=>null);
  if(stage)await page.mouse.click(stage.x+stage.width/2,stage.y+stage.height/2);
  await shot('editor',null,{clip:{x:300,y:46,width:W-300,height:H-46}});
  await page.locator('[data-view="reflow"]').click();await shot('reflow',null,{clip:{x:300,y:46,width:W-300,height:H-46}});
  await page.locator('[data-view="slides"]').click();
  // 슬라이드 메뉴(배경)
  await page.locator('#slides .slide-card').first().click({button:'right'});await page.locator('#contextMenu').waitFor();
  await shot('slide-menu',null,{clip:await union(['#slides .slide-card >> nth=0','#contextMenu'],8)});await page.keyboard.press('Escape');
  // 성경
  await page.locator('#resourceOpen').click();await page.locator('#bibleQuery').fill('요 3 16-17');await page.waitForFunction(()=>!document.querySelector('#bibleAdd').disabled);
  await shot('bible',null);await page.locator('#resourceClose').click();
  // 미디어
  await page.locator('#mediaOpen').click();await page.waitForTimeout(1200);await shot('media-drawer',null);
  const all=page.locator('#mediaDrawer button',{hasText:'모두 보기'});if(await all.count()){await all.first().click();await page.waitForTimeout(1000);await shot('media-all','dialog[open]');await page.keyboard.press('Escape');}
  await page.locator('#mediaAdd').click();await page.locator('#mediaAddDialog[open]').waitFor();await shot('media-add','#mediaAddDialog');await page.keyboard.press('Escape');
  await page.locator('#mediaClose').click();
  // 템플릿
  await page.locator('#templateOpen').click();await page.locator('#templateDialog[open]').waitFor();await page.waitForTimeout(800);await shot('template','#templateDialog');await page.locator('#templateClose').click();
  // 저장 표시와 충돌
  await page.evaluate(()=>{PP6.setText(PP6.textElements(YebaeonEditor.current())[0],'빛 되신 주 내 길을 비추네\n어둔 밤 지나 새 아침 오네!');YebaeonEditor.markDirty();});
  await page.locator('#playlistItems .order-item',{hasText:'평안의 길'}).first().click();await page.keyboard.press('Delete');await page.waitForTimeout(300);
  await shot('savebar',null,{clip:{x:W-460,y:0,width:460,height:46}});
  await page.locator('#cloudSave').click().catch(()=>{});await page.waitForFunction(()=>!YebaeonSave.busy());
  // 휴지통과 관리자 확인
  await page.evaluate(async()=>{const xml=YebaeonLibraryActions.blankDocument('옛날자료');for(const name of ['옛 성탄 찬양','2025 부활절 특송']){const r=await(await YebaeonCloud.api('/documents?'+new URLSearchParams({path:name+'.pro6'}),{method:'POST',headers:{'Content-Type':'application/xml'},body:xml})).json();await YebaeonCloud.api(`/documents/${r.document.id}/state`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'trash'})});}});
  await page.locator('#libraryBins').click();await page.locator('#binsTabs button[data-bin="trashed-docs"]').click();await page.locator('#binsList .archive-row').first().waitFor();await shot('bins','#binsDialog');
  await page.locator('#binsPurge').click();await page.locator('#adminDialog[open]').waitFor();await shot('admin','#adminDialog');await page.locator('#adminCancel').click();await page.locator('#binsClose').click();
  // 주보: 드롭박스 목록은 흉내 내고(연결 비밀값이 없다), 주보는 지어낸 HWP를 쓴다.
  const hwp=await bulletinHWP();
  await page.route('**/api/dropbox/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/config'))return route.fulfill({json:{ready:true}});
   if(u.pathname.endsWith('/list'))return route.fulfill({json:{entries:[{kind:'file',name:'1011 주보.hwp',path:'HANWOORI/06주보/주일주보/1011 주보.hwp',size:41230,modified:'2026-10-09T09:00:00Z'},{kind:'file',name:'1004 주보.hwp',path:'HANWOORI/06주보/주일주보/1004 주보.hwp',size:40870,modified:'2026-10-02T09:00:00Z'},{kind:'file',name:'0927 주보.hwp',path:'HANWOORI/06주보/주일주보/0927 주보.hwp',size:39950,modified:'2026-09-25T09:00:00Z'},{kind:'folder',name:'지난 주보',path:'HANWOORI/06주보/주일주보/지난 주보'}],next:null}});
   return route.fulfill({body:hwp,contentType:'application/octet-stream'});});
  await page.locator('#bulletinOpen').click();await page.locator('#bulletinStart .file-start-dropbox').click();await page.locator('#bulletinStart .dropbox-row').first().waitFor();
  await shot('bulletin-dropbox','#bulletinDialog');
  await page.locator('#bulletinStart .dropbox-row',{hasText:'1011 주보.hwp'}).locator('button').click();await page.waitForFunction(()=>YebaeonBulletin.state()?.date);
  const slot=label=>page.locator('.bulletin-slot').filter({has:page.locator('label',{hasText:label})}).first();
  await page.locator('.bulletin-svc button',{hasText:'2부'}).click();await slot('찬양 1').click();await page.locator('.bulletin-cands .cand').first().waitFor();await shot('bulletin-song','#bulletinDialog');
  await page.locator('.bulletin-cands .cand').first().click();await slot('찬양 2').click();await page.locator('.bulletin-cands .cand').first().waitFor();await page.locator('.bulletin-cands .cand').first().click();
  await page.locator('#bulletinSteps button',{hasText:'기도'}).click();await shot('bulletin-prayer','#bulletinDialog');
  await page.locator('#bulletinSteps button',{hasText:'주일말씀'}).click();await shot('bulletin-sermon','#bulletinDialog');
  await page.locator('#bulletinSource .bulletin-source-bar input').check();await shot('bulletin-region','#bulletinDialog');await page.locator('#bulletinSource .bulletin-source-bar input').uncheck();
  await page.locator('#bulletinSteps button',{hasText:'주중말씀'}).click();await shot('bulletin-weekday','#bulletinDialog');
  await page.locator('#bulletinNext').click();await page.locator('.bulletin-op').first().waitFor();
  while(await page.locator('#bulletinNext').textContent()!=='적용'){await page.locator('#bulletinNext').click();await page.waitForTimeout(800);}
  await page.locator('.bulletin-staged').first().waitFor();await page.waitForTimeout(800);await shot('bulletin-review','#bulletinDialog');
  await page.locator('#bulletinNext').click();await page.waitForFunction(()=>!document.querySelector('#bulletinDialog').open);await page.waitForTimeout(500);
  await page.locator('#studioPlaylistPicker').click();await page.waitForTimeout(400);await shot('playlists-pending','#studioPlaylistsDialog');await page.keyboard.press('Escape');
  await shot('savebar-bulletin',null,{clip:{x:W-460,y:0,width:460,height:46}});
  await page.locator('#cloudSave').click();await page.waitForFunction(()=>!YebaeonSave.busy());
  // PPT: 지어낸 악보 그림과 배경 사진으로 만든 PPTX
  const pptx=await scorePPTX();
  await page.locator('#pptOpen').click();await page.locator('#pptFile').setInputFiles({name:'평안의 길 악보.pptx',mimeType:'application/octet-stream',buffer:pptx});await page.waitForFunction(()=>!YebaeonPPTImport.state().busy&&YebaeonPPTImport.state().deck);
  await page.locator('#pptCategory').selectOption('악보찬양');await page.locator('#pptPreview').click();await page.waitForFunction(()=>!YebaeonPPTImport.state().busy&&YebaeonPPTImport.state().outputs.length);
  await page.locator('#pptReviewed').check();await shot('ppt-score','#pptDialog');
  await page.locator('input[name=pptTarget][value=replace]').check();await page.locator('#pptCandidates button').first().click();await page.waitForFunction(()=>!YebaeonPPTImport.state().busy&&YebaeonPPTImport.state().target);await page.locator('#pptPreview').click();await page.waitForFunction(()=>!YebaeonPPTImport.state().busy&&YebaeonPPTImport.state().outputs.length);await shot('ppt-replace','#pptDialog');
  await page.locator('#pptClose').click();
  // 현황판
  await page.goto(origin+'/status');await styled();await page.waitForTimeout(1500);await shot('status',null);
  console.log('오류',errors);
 }finally{await browser.close();await new Promise(r=>server.close(r));await mf.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
