const {chromium}=require('playwright');const {createServer}=require('node:http');const {readFile}=require('node:fs/promises');const {resolve,extname,sep}=require('node:path');const {deflateSync}=require('node:zlib');const assert=require('node:assert/strict');
// 악보 배경 걷기 실험실: 합성 예제로 배경판·장 처리·붓(정교하게·모든 장 지우기·되돌리기), PPTX 장 이동 링크 빼기.
function png(w,h,data){
 const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)Buffer.from(data.buffer,data.byteOffset+y*w*4,w*4).copy(raw,y*(w*4+1)+1);
 const table=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;}),crc=b=>{let c=~0;for(const x of b)c=table[(c^x)&255]^(c>>>8);return ~c>>>0;};
 const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]),c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
(async()=>{
 const {zipSync,strToU8}=await import('fflate'),{makeSet}=await import('../../web-editor/score-matte/synthetic.mjs');
 const root=resolve('dist'),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
 const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://x').pathname);if(!path.startsWith(root+sep))throw 0;const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const done=()=>page.waitForFunction(()=>{const s=ScoreLab.state();return s.results.length&&s.results.every(r=>r&&!r.stale);},null,{timeout:180000});
 // 결과 알파를 1920 기준 좌표 상자에서 센다: 덮인 칸 수와 색 있는 덮인 칸 수.
 const count=(i,box)=>page.evaluate(([i,box])=>{const s=ScoreLab.state(),r=s.results[i],w=s.frames[i].width,k=w/1920;let on=0,colored=0;for(let y=Math.round(box[1]*k);y<Math.round(box[3]*k);y++)for(let x=Math.round(box[0]*k);x<Math.round(box[2]*k);x++){const o=(y*w+x)*4;if(r.data[o+3]>=64){on++;if(Math.max(r.data[o],r.data[o+1],r.data[o+2])-Math.min(r.data[o],r.data[o+1],r.data[o+2])>40)colored++;}}return {on,colored};},[i,box]);
 const drag=async(points)=>{const c=page.locator('#stackB canvas').nth(1),b=await c.boundingBox(),at=([x,y])=>[b.x+x/1920*b.width,b.y+y/1080*b.height];await page.mouse.move(...at(points[0]));await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(...at(p),{steps:4});await page.mouse.up();};
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/score-lab.html`);
  await page.locator('#sample').click();await done();
  assert.equal(await page.evaluate(()=>ScoreLab.client.inWorker()),true,'작업자에서 처리');
  const plate=await page.evaluate(()=>ScoreLab.state().plateReport);assert.ok(plate.backgroundParts>0&&plate.zones>0,'네비게이터를 배경으로 나눔');
  assert.equal((await count(0,[700,1005,1220,1055])).on,0,'하단 네비게이터(현재 장 강조 포함) 지움');
  assert.ok((await count(0,[400,299,1700,302])).on>500,'오선 남김');
  assert.equal(await page.locator('#strip .thumb').count(),8);
  // 3장 얼룩: 정교하게 붓으로 칠하면 색 있는 찌꺼기가 줄고 검은 악보는 남는다.
  await page.locator('#strip .thumb').nth(2).click();
  const area=[240,240,760,380],before=await count(2,area);assert.ok(before.colored>3000,'붓 전 얼룩 '+before.colored);
  await page.locator('#size').fill('90');
  const path=[];for(let y=250;y<=370;y+=40)for(const x of (y/40)%2?[240,760]:[760,240])path.push([x,y]);
  await drag([[240,250],...path]);await done();
  const after=await count(2,area);assert.ok(after.colored<before.colored*.2,`붓 뒤 얼룩 ${after.colored}/${before.colored}`);assert.ok(after.on>1500,'붓 아래 악보 '+after.on);
  // 모든 장 같은 자리 + 지우기: 제목을 모든 장에서 지우고, 되돌리면 돌아온다.
  const title=[730,85,1180,155];assert.ok((await count(5,title)).on>2000,'제목 남음');
  await page.locator('input[name=tool][value=erase]').check();await page.locator('#allSlides').check();
  await drag([[730,120],[1180,120]]);await done();
  for(const i of [0,5])assert.ok((await count(i,title)).on<200,`${i+1}장 제목 지움`);
  await page.locator('#undo').click();await done();assert.ok((await count(5,title)).on>2000,'되돌리기');
  await page.locator('#diag').selectOption('layers');await page.waitForFunction(()=>ScoreLab.state().results[ScoreLab.state().current]?.layer);
  const report=JSON.parse(await page.locator('#report').inputValue());assert.equal(report.frames,8);assert.equal(report.slides.length,8);assert.ok(report.slides[2].marks.refine>0);

  // PPTX: 장 전체를 그릴 때 장 이동 링크 단추(도형 링크·글자 링크)를 빼고 그린다.
  const set=makeSet({width:960,height:540,count:4,seed:3}),ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>','ppt/presentation.xml':`<p:presentation ${ns}><p:sldIdLst>${[0,1,2,3].map(i=>`<p:sldId id="${256+i}" r:id="r${i+1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,'ppt/_rels/presentation.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[0,1,2,3].map(i=>`<Relationship Id="r${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`).join('')}</Relationships>`};
  const button=(id,x,link,text,runLink)=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="nav${id}">${link?'<a:hlinkClick r:id="s1" action="ppaction://hlinksldjump"/>':''}</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="4300000"/><a:ext cx="1400000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="202020"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400">${runLink?'<a:hlinkClick r:id="s1" action="ppaction://hlinkshowjump?jump=nextslide"/>':''}</a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  for(let i=0;i<4;i++){
   files[`ppt/slides/slide${i+1}.xml`]=`<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="score"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="img"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>${button(3,1000000,true,'1절',false)}${button(4,5000000,false,'다음',true)}</p:spTree></p:cSld></p:sld>`;
   files[`ppt/slides/_rels/slide${i+1}.xml.rels`]='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/s'+i+'.png"/><Relationship Id="s1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide1.xml"/></Relationships>';
  }
  const zipped={};for(const [k,v] of Object.entries(files))zipped[k]=strToU8(v);set.frames.forEach((f,i)=>zipped[`ppt/media/s${i}.png`]=png(f.width,f.height,f.data));
  const pptx=Buffer.from(zipSync(zipped));
  await page.locator('#pptSource').selectOption('slide');
  await page.locator('#file').setInputFiles({name:'링크 시험.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:pptx});
  await page.waitForFunction(()=>ScoreLab.state().frames.length===4&&ScoreLab.state().plateReport?.frames===4||/실패/.test(document.querySelector('#status').textContent),null,{timeout:120000});await done();
  const state=await page.evaluate(()=>({status:document.querySelector('#status').textContent,warnings:ScoreLab.state().warnings,frames:ScoreLab.state().frames.length,name:ScoreLab.state().sourceName}));
  assert.equal(state.frames,4,state.status);assert.equal(state.name,'링크 시험');assert.ok(state.warnings.some(w=>/링크가 걸린 개체 8개/.test(w)),state.warnings.join(' / '));
  assert.ok((await count(0,[400,860,1700,1000])).on<300,'링크 단추 자리는 비어 있음');
  assert.deepEqual(errors,[]);
  console.log('score-lab browser test passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
