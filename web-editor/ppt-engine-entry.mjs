import {parseZip,buildPresentation,renderSlide} from '@aiden0z/pptx-renderer';
import {toCanvas} from 'html-to-image';
import {legacy} from './ppt-legacy.mjs';
const MAX=40*1024*1024;
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const blob=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('이미지 변환 실패')),'image/png'));
const image=url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('이미지를 읽지 못했습니다. PNG/JPEG 이미지가 있는 파일로 다시 저장해 주세요.'));i.src=url;});
const mime=bytes=>bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':bytes[0]===71?'image/gif':bytes[0]===82?'image/webp':null;
function path(base,target){const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const p of target.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');}
function localRels(xml){const d=new DOMParser().parseFromString(xml,'application/xml');for(const e of d.querySelectorAll('Relationship'))if(e.getAttribute('TargetMode')?.toLowerCase()==='external'||/^(?:[a-z]+:|\/\/)/i.test(e.getAttribute('Target')||''))e.remove();return new XMLSerializer().serializeToString(d);}
// 배경으로 지정된 그림도 악보 후보가 될 수 있다. 관계 경로는 해당 슬라이드/레이아웃/마스터를 기준으로 푼다.
function backgroundPicture(pres,raw,warnings){
 const layoutPath=raw.layoutIndex,layout=pres.layouts.get(layoutPath),masterPath=pres.layoutToMaster.get(layoutPath),master=pres.masters.get(masterPath);
 const owner=raw.background?{data:raw,base:raw.slidePath}:layout?.background?{data:layout,base:layoutPath}:master?.background?{data:master,base:masterPath}:null;
 const fill=owner?.data.background?.child('bgPr').child('blipFill');if(!fill?.exists())return null;
 if(fill.child('tile').exists()){warnings.push('타일 배경은 악보 분리 대상에서 제외합니다.');return null;}
 const blip=fill.child('blip'),id=blip.attr('embed')??blip.attr('r:embed'),rel=owner.data.rels.get(id),key=rel?path(owner.base,rel.target):'',bytes=pres.media.get(key),type=bytes&&mime(bytes);
 if(!type){warnings.push('배경 그림을 읽지 못했습니다. 원본과 대조해 주세요.');return null;}
 const rect=fill.child('stretch').child('fillRect'),src=fill.child('srcRect'),pct=(n,k)=>(n.numAttr(k)??0)/100000;
 const l=pct(rect,'l'),t=pct(rect,'t'),r=pct(rect,'r'),b=pct(rect,'b');
 return {name:'슬라이드 배경 그림',isBackground:true,bytes,type,x:l*pres.width,y:t*pres.height,w:(1-l-r)*pres.width,h:(1-t-b)*pres.height,crop:{left:pct(src,'l'),top:pct(src,'t'),right:pct(src,'r'),bottom:pct(src,'b')}};
}
export async function parse(buffer){
 if(buffer.byteLength>MAX)throw Error('파일은 40MB 이하로 선택해 주세요.');
 const bytes=new Uint8Array(buffer);let deck;
 if(bytes[0]===0xd0&&bytes[1]===0xcf)deck=legacy(bytes);
 else if(bytes[0]===80&&bytes[1]===75){
  const files=await parseZip(buffer,{maxEntries:2500,maxEntryUncompressedBytes:40*1024*1024,maxTotalUncompressedBytes:160*1024*1024,maxMediaBytes:120*1024*1024,maxConcurrency:2});
  files.presentationRels=localRels(files.presentationRels);
  for(const name of ['slideRels','slideLayoutRels','slideMasterRels','chartRels'])for(const [p,s] of files[name]||[])files[name].set(p,localRels(s));
  const pres=buildPresentation(files);pres.embeddedFonts=[];
  if(!pres.slides.length||pres.slides.length>120)throw Error('PPTX는 1~120장까지 가져올 수 있습니다.');
  deck={kind:'pptx',width:pres.width,height:pres.height,pres,warnings:['원본 폰트·애니메이션·동영상·일부 특수 효과는 PowerPoint와 다를 수 있습니다. 정지 화면 미리보기를 확인하세요.'],slides:pres.slides.map(raw=>{
   const images=[],warnings=[];
   const picture=backgroundPicture(pres,raw,warnings);if(picture)images.push(picture);
   for(const n of raw.nodes){if(n.nodeType==='picture'&&!n.isVideo&&!n.isAudio){const rel=raw.rels.get(n.blipEmbed),key=rel?path(raw.slidePath,rel.target):'',bytes=pres.media.get(key),type=bytes&&mime(bytes);if(type)images.push({name:n.name||'이미지',bytes,type,x:n.position.x,y:n.position.y,w:n.size.w,h:n.size.h,rotation:n.rotation,flipH:n.flipH,flipV:n.flipV,crop:n.crop,node:n});else warnings.push('벡터/외부 이미지가 있어 원본과 대조가 필요합니다.');}else if(n.nodeType==='group')warnings.push('그룹 안의 악보는 그림 그룹을 해제한 뒤 가져와 주세요.');}
   return {raw,images,backgroundPicture:picture,warnings,hidden:raw.hidden};
  })};
 }else throw Error('올바른 PPT 또는 PPTX 파일을 선택해 주세요.');
 if(!(deck.width>0&&deck.height>0&&deck.width/deck.height<8&&deck.height/deck.width<8))throw Error('슬라이드 크기를 확인해 주세요.');
 deck.urls=[];deck.dispose=()=>deck.urls.forEach(URL.revokeObjectURL);
 try{for(const s of deck.slides){
  if(s.background){s.background.url=URL.createObjectURL(new Blob([s.background.bytes],{type:s.background.type}));deck.urls.push(s.background.url);}
  for(const p of s.images){if(!p.url){p.url=URL.createObjectURL(new Blob([p.bytes],{type:p.type}));deck.urls.push(p.url);}p.image=await image(p.url);if(p.image.naturalWidth*p.image.naturalHeight>40e6)throw Error('너무 큰 이미지가 있습니다. 이미지 해상도를 줄여 주세요.');
   const c=makeCanvas(48,48);c.getContext('2d').drawImage(p.image,0,0,48,48);const pixels=c.getContext('2d').getImageData(0,0,48,48).data;let alpha=0;for(let j=3;j<pixels.length;j+=4)if(pixels[j]<240)alpha++;p.transparent=alpha>24;
  }
  s.scoreIndex=s.images.reduce((best,p,j)=>best<0||((p.transparent?2:1)*p.w*p.h>(s.images[best].transparent?2:1)*s.images[best].w*s.images[best].h)?j:best,-1);
 }}catch(e){deck.dispose();throw e;}
 return deck;
}
async function rasterDOM(element,w,h){
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;pointer-events:none;';host.append(element);document.body.append(host);
 try{await document.fonts.ready;await Promise.all([...element.querySelectorAll('img')].map(i=>i.decode().catch(()=>{throw Error('슬라이드 이미지 해석 실패');})));return await toCanvas(element,{width:w,height:h,pixelRatio:1920/w,skipFonts:true,cacheBust:false});}finally{host.remove();}
}
const color=c=>typeof c==='string'?c:c?`rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`:'#000';
function legacyDOM(deck,slide){
 const root=document.createElement('div');root.style.cssText=`position:relative;overflow:hidden;width:${deck.width}px;height:${deck.height}px;background:${slide.color};`;
 if(slide.background){root.style.backgroundImage=`url("${slide.background.url}")`;root.style.backgroundSize='100% 100%';}
 for(const s of slide.shapes){const box=document.createElement('div'),f=s.frame;box.style.cssText=`box-sizing:border-box;position:absolute;left:${f.xPt}px;top:${f.yPt}px;width:${f.widthPt}px;height:${f.heightPt}px;overflow:hidden;transform:rotate(${s.rotationDeg||0}deg);`;if(s.fill){box.style.backgroundColor=s.fill;if(s.geometry===2)box.style.borderRadius='8px';if(s.geometry===3)box.style.borderRadius='50%';}
  for(const b of s.blocks){if(b.kind==='image'){const img=document.createElement('img');img.src=`data:image/${b.format};base64,${b.base64}`;img.style.cssText=`width:100%;height:100%;transform:scale(${s.flipH?-1:1},${s.flipV?-1:1});`;box.append(img);}else if(b.kind==='paragraph'){const p=document.createElement('div');p.style.cssText=`white-space:pre-wrap;overflow-wrap:break-word;text-align:${b.alignment||'left'};line-height:${b.lineSpacing||1.1};margin-left:${s.insetLeftPt||0}px;margin-right:${s.insetRightPt||0}px;`;for(const r of b.runs){const span=document.createElement('span');span.textContent=r.text;span.style.fontFamily=r.fontFamily||'sans-serif';span.style.fontSize=(r.sizePt||18)+'px';span.style.fontWeight=r.bold?'bold':'normal';span.style.fontStyle=r.italic?'italic':'normal';span.style.color=color(r.color);p.append(span);}box.append(p);}else if(b.kind==='table'){slide.warnings.push('구형 PPT 표는 PPTX로 저장 후 가져와 주세요.');}}
  root.append(box);
 }return root;
}
async function full(deck,i,backgroundOnly=false){
 const s=deck.slides[i];
 if(deck.kind==='ppt'){
  if(backgroundOnly){const c=makeCanvas(1920,Math.round(1920*deck.height/deck.width)),ctx=c.getContext('2d');ctx.fillStyle=s.color;ctx.fillRect(0,0,c.width,c.height);if(s.background)ctx.drawImage(await image(s.background.url),0,0,c.width,c.height);return c;}
  return rasterDOM(legacyDOM(deck,s),deck.width,deck.height);
 }
 if(backgroundOnly&&s.images[s.scoreIndex]?.isBackground){const c=makeCanvas(1920,Math.round(1920*deck.height/deck.width));c.getContext('2d').fillStyle='#fff';c.getContext('2d').fillRect(0,0,c.width,c.height);return c;}
 const raw=backgroundOnly?{...s.raw,nodes:s.images.filter((p,j)=>j!==s.scoreIndex&&p.node&&!p.transparent&&p.w*p.h>=deck.width*deck.height*.75).map(p=>p.node),showMasterSp:false}:s.raw;
 const errors=[],handle=renderSlide(deck.pres,raw,{pdfjs:false,onNavigate:()=>{},onNodeError:(id,e)=>errors.push(id)});
 try{await handle.ready;
  // CSS 배경의 빈 srcRect/확장 fillRect도 캔버스로 직접 합성한다. DOM은 나머지 개체만 그린다.
  if(s.backgroundPicture){handle.element.style.background='none';for(const el of [...handle.element.children])if(el.matches('[data-pptx-background-image]'))el.remove();}
  const overlay=await rasterDOM(handle.element,deck.width,deck.height);if(errors.length)throw Error('일부 개체를 변환하지 못했습니다. PowerPoint에서 이미지로 저장한 파일을 사용해 주세요.');
  if(!s.backgroundPicture)return overlay;
  const c=makeCanvas(overlay.width,overlay.height),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);drawPicture(ctx,s.backgroundPicture,c.width/deck.width,0);ctx.drawImage(overlay,0,0);return c;
 }finally{handle.dispose();}
}
function drawPicture(ctx,p,scale,top){
 const crop=p.crop||{},l=crop.left||0,r=crop.right||0,t=crop.top||0,b=crop.bottom||0;
 if([l,r,t,b].some(x=>x<0)||l+r>=1||t+b>=1)throw Error('지원하지 않는 그림 자르기 범위입니다.');
 const img=p.image,w=p.w*scale,h=p.h*scale;
 ctx.save();ctx.translate((p.x+p.w/2)*scale,(p.y+p.h/2)*scale);ctx.rotate((p.rotation||0)*Math.PI/180);ctx.scale(p.flipH?-1:1,p.flipV?-1:1);
 ctx.beginPath();ctx.rect(-w/2,-h/2+h*top,w,h*(1-top));ctx.clip();ctx.drawImage(img,l*img.width,t*img.height,(1-l-r)*img.width,(1-t-b)*img.height,-w/2,-h/2,w,h);ctx.restore();
}
function removeWhiteMatte(canvas){
 const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height),d=pixels.data;
 for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const white=Math.min(d[i],d[i+1],d[i+2]),ink=255-white;if(ink<5){d[i+3]=0;continue;}for(let k=0;k<3;k++)d[i+k]=Math.round((d[i+k]-white)*255/ink);d[i+3]=Math.round(d[i+3]*ink/255);}
 ctx.putImageData(pixels,0,0);
}
export async function render(deck,i,{mode='full',removeWhite=false,crop=0.167,bottomCrop=0,keepTitle=false,background='original',backgroundColor='#ffffff',backgroundImage=null}={}){
 if(mode==='full')return {foreground:await blob(await full(deck,i)),background:null,warnings:deck.slides[i].warnings};
 const s=deck.slides[i],p=s.images[s.scoreIndex];if(!p)throw Error(`${i+1}장에 분리할 악보 이미지가 없습니다. 일반 슬라이드 방식으로 가져와 주세요.`);
 const w=1920,h=Math.round(w*deck.height/deck.width),fg=makeCanvas(w,h);drawPicture(fg.getContext('2d'),p,w/deck.width,keepTitle?0:crop);
 if(!Number.isFinite(bottomCrop)||bottomCrop<0||bottomCrop>.4)throw Error('하단 자르기는 0~40%로 입력해 주세요.');
 if(removeWhite)removeWhiteMatte(fg);
 if(bottomCrop)fg.getContext('2d').clearRect(0,Math.floor(h*(1-bottomCrop)),w,h);
 let bg;if(background==='original')bg=await full(deck,i,true);else if(background!=='none'){bg=makeCanvas(w,h);const ctx=bg.getContext('2d');ctx.fillStyle=backgroundColor;ctx.fillRect(0,0,w,h);if(background==='image'&&backgroundImage){const img=await image(backgroundImage),scale=Math.max(w/img.width,h/img.height);ctx.drawImage(img,(w-img.width*scale)/2,(h-img.height*scale)/2,img.width*scale,img.height*scale);}}
 return {foreground:await blob(fg),background:bg?await blob(bg):null,warnings:[...s.warnings,...(removeWhite?['흰 바탕을 투명하게 처리했습니다. 흰 글자·테두리도 투명해지므로 배경을 넣어 확인하세요.']:!p.transparent?['선택한 악보 그림은 불투명합니다. 합쳐진 배경은 분리되지 않습니다.']:[])]};
}
export {blob,makeCanvas};
