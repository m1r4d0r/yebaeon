// 악보 배경 걷기 실험실. 같은 배경의 장 여러 장으로 배경판을 만들고, 장마다 투명 악보를 본다.
// 붓 세 가지(정교하게·지우기·살리기)로 틀린 곳을 칠하면 그 장(또는 모든 장 같은 자리)을 다시 처리한다.
import {DEFAULTS,MARK} from './score-matte/matte-core.mjs';
import {createClient} from './score-matte/matte-client.mjs';
import {makeSet} from './score-matte/synthetic.mjs';
import {encodePalettePNG} from './png-palette.mjs';

const $=id=>document.getElementById(id);
const MAX_WIDTH=1920,MAX_FRAMES=32;
const PLATE_KEYS=new Set(['strokeRadius','strokeLevel','constantShare','attach','navigatorBand','inkLevel']);
const SPEC=[
 ['배경판','h'],
 ['strokeRadius','획 찾기 창 반지름(px)',4,40,1,'이보다 굵은 어두운 덩어리는 획으로 보지 않습니다. 음표 머리가 크면 키웁니다.'],
 ['strokeLevel','획 문턱',6,80,1,'낮추면 옅은 획도 획으로 잡습니다.'],
 ['constantShare','고정 획 비율',.4,1,.05,'이 비율 이상의 장에서 같은 자리에 있으면 고정 획(오선·네비게이터)입니다.'],
 ['attach','고정 획이 악보에 붙은 거리(px)',0,20,1,'이만큼 붙어 있으면 오선·음자리표처럼 악보로 남깁니다.'],
 ['navigatorBand','하단 네비게이터 띠',0,1,.02,'악보와 떨어진 고정 획 중 아래 이 비율 안의 것만 배경으로 지웁니다. 1이면 어디든.'],
 ['inkLevel','위쪽 고정 획을 악보로 볼 밝기 상한',0,255,5,'띠 밖의 떨어진 고정 획(제목)은 이보다 어두운 칸이 있어야 남깁니다.'],
 ['장 처리','h'],
 ['floor','옅은 어둠 버림',0,.3,.01,'배경판보다 이만큼도 어둡지 않으면 배경입니다.'],
 ['core','획 핵심 어둠',.1,.8,.01,'이보다 어두운 칸이 있는 덩어리만 남깁니다.'],
 ['faint','핵심 없는 옅은 덩어리 지우기','check'],
 ['navigator','네비게이터 자리의 장마다 바뀌는 덩어리 지우기','check'],
 ['far','핵심에서 먼 옅은 칸 지우기(px, 0=끔)',0,30,1,''],
 ['bottomCrop','하단 자르기 비율',0,.4,.01,''],
 ['입체 음표','h'],
 ['solid','악보 안쪽 불투명(명암·하이라이트 유지)','check'],
 ['shade','명암으로 볼 배경과의 차이',.02,.4,.01,'낮추면 음표 둘레의 옅은 명암까지 몸통으로 봅니다.'],
 ['shadeReach','명암을 찾을 거리(px)',1,20,1,''],
 ['holeRatio','하이라이트 구멍 메우기',0,1.5,.05,'구멍 반지름 ≤ 둘레 두께×값이면 메웁니다. 글자 o 속은 메우지 않게 낮게 둡니다.'],
 ['정교하게 붓','h'],
 ['refineMin','남길 최소 진하기',.1,.95,.01,'칠한 곳에서 이보다 검은 칸만 악보로 남깁니다.'],
 ['refineChroma','되살릴 명암의 채도 한도',0,120,1,'검정 둘레의 무채색 명암만 되살립니다. 색 있는 찌꺼기는 버립니다.']
];
const TOOL={refine:MARK.refine,erase:MARK.erase,keep:MARK.keep,clear:0};
const COLORS={[MARK.refine]:[43,111,255],[MARK.erase]:[229,56,59],[MARK.keep]:[34,163,90]};

const client=createClient(window.SCORE_MATTE_WORKER_URL||'score-matte-worker.js');
const S={frames:[],sourceName:'',plate:null,plateCanvas:null,layerCanvas:null,plateReport:null,results:[],marks:[],shared:null,current:0,options:{...DEFAULTS},undo:[],backdropImage:null,epoch:0,plateEpoch:0,warnings:[]};

// ---------- 화면 틀 ----------
const status=(t,p)=>{$('status').textContent=t;$('progress').hidden=p==null;if(p!=null)$('progress').value=p;};
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function imageCanvas(img){const c=canvas(img.width,img.height),d=img.data instanceof Uint8ClampedArray?img.data:new Uint8ClampedArray(img.data);c.getContext('2d').putImageData(new ImageData(d,img.width,img.height),0,0);return c;}
function checker(ctx,w,h,cell=16){ctx.fillStyle='#cfd5dd';ctx.fillRect(0,0,w,h);ctx.fillStyle='#f1f3f6';for(let y=0;y<h;y+=cell)for(let x=(y/cell)%2?cell:0;x<w;x+=cell*2)ctx.fillRect(x,y,cell,cell);}

function settings(){
 const grid=$('grid');grid.replaceChildren();
 for(const [key,label,min,max,step,help] of SPEC){
  if(label==='h'){const h=document.createElement('h3');h.textContent=key;grid.append(h);continue;}
  const row=document.createElement('label');row.title=help||'';
  if(min==='check'){row.className='check';row.innerHTML=`<input type="checkbox" data-key="${key}"><span>${label}</span>`;row.querySelector('input').checked=!!S.options[key];}
  else{row.innerHTML=`<span>${label}</span><output></output><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}">`;const input=row.querySelector('input');input.value=S.options[key];row.querySelector('output').textContent=S.options[key];}
  grid.append(row);
 }
 grid.oninput=e=>{const input=e.target,key=input.dataset.key;if(!key)return;const value=input.type==='checkbox'?input.checked:+input.value;S.options[key]=value;const out=input.parentElement.querySelector('output');if(out)out.textContent=value;changed(key);};
 note();
}
function note(){const diff=Object.keys(DEFAULTS).filter(k=>S.options[k]!==DEFAULTS[k]);$('settingsNote').textContent=diff.length?`기본값과 다른 항목 ${diff.length}개`:'기본값';}
let settingTimer=null,pendingPlate=false;
function changed(key){note();if(PLATE_KEYS.has(key))pendingPlate=true;clearTimeout(settingTimer);settingTimer=setTimeout(()=>{if(!S.frames.length)return;if(pendingPlate){pendingPlate=false;rebuildPlate();}else rematteAll();},350);}

// ---------- 불러오기 ----------
const natural=(a,b)=>a.localeCompare(b,'ko',{numeric:true});
async function bitmapFrame(source,name){
 const w0=source.width||source.naturalWidth,h0=source.height||source.naturalHeight,scale=Math.min(1,MAX_WIDTH/w0),w=Math.round(w0*scale),h=Math.round(h0*scale),c=canvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(source,0,0,w,h);
 return {name,width:w,height:h,data:ctx.getImageData(0,0,w,h).data};
}
// 크기가 다르면 가장 많은 크기에 맞춘다(같은 PPT에서 나온 그림은 보통 모두 같다).
function sameSize(frames){
 const counts=new Map();for(const f of frames){const k=f.width+'x'+f.height;counts.set(k,(counts.get(k)||0)+1);}
 const [w,h]=[...counts].sort((a,b)=>b[1]-a[1])[0][0].split('x').map(Number);let moved=0;
 const out=frames.map(f=>{if(f.width===w&&f.height===h)return f;moved++;const c=canvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(imageCanvas(f),0,0,w,h);return {...f,width:w,height:h,data:ctx.getImageData(0,0,w,h).data};});
 if(moved)S.warnings.push(`크기가 다른 ${moved}장을 ${w}×${h}로 맞췄습니다. 비율이 다르면 결과가 틀릴 수 있습니다.`);
 return out;
}
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('PPT 변환기를 불러오지 못했습니다.'));document.head.append(s);});}
async function fromPPTX(file){
 if(!window.YebaeonPPTEngine){status('PPT 변환기를 불러오는 중…',0);await loadScript('ppt-engine.js');}
 const E=window.YebaeonPPTEngine,deck=await E.parse(await file.arrayBuffer()),frames=[],mode=$('pptSource').value;
 if(deck.kind!=='pptx')S.warnings.push('옛 PPT 형식은 링크 단추 빼기를 하지 않습니다.');
 try{
  let links=0;
  for(let i=0;i<deck.slides.length&&frames.length<MAX_FRAMES;i++){
   const s=deck.slides[i];status(`${i+1}/${deck.slides.length}장 그리는 중…`,i/deck.slides.length);
   if(mode==='picture'){
    const p=s.images[s.scoreIndex];if(!p){S.warnings.push(`${i+1}장: 악보 그림이 없어 뺐습니다.`);continue;}
    const c=p.crop||{},img=p.image,sw=img.width*(1-(c.left||0)-(c.right||0)),sh=img.height*(1-(c.top||0)-(c.bottom||0)),cv=canvas(Math.round(sw),Math.round(sh));
    cv.getContext('2d').drawImage(img,(c.left||0)*img.width,(c.top||0)*img.height,sw,sh,0,0,cv.width,cv.height);
    frames.push(await bitmapFrame(cv,`${i+1}장`));
   }else{
    const r=await E.render(deck,i,{mode:'full',dropJumpLinks:$('dropLinks').checked});links+=s.droppedLinks||0;
    const bmp=await createImageBitmap(r.foreground);frames.push(await bitmapFrame(bmp,`${i+1}장`));bmp.close();
   }
  }
  if(mode==='slide'&&$('dropLinks').checked)S.warnings.push(links?`장 이동 링크가 걸린 개체 ${links}개를 빼고 그렸습니다.`:'장 이동 링크가 걸린 개체는 없었습니다.');
  if(deck.slides.length>MAX_FRAMES)S.warnings.push(`앞 ${MAX_FRAMES}장만 씁니다.`);
 }finally{deck.dispose?.();}
 return frames;
}
async function open(files){
 files=[...files];if(!files.length)return;S.warnings=[];
 try{
  let frames;
  const ppt=files.find(f=>/\.pptx$/i.test(f.name));
  if(ppt){S.sourceName=ppt.name.replace(/\.pptx$/i,'');frames=await fromPPTX(ppt);}
  else{
   files=files.filter(f=>/^image\//.test(f.type)).sort((a,b)=>natural(a.name,b.name)).slice(0,MAX_FRAMES);
   S.sourceName=files[0]?.name.replace(/\.[^.]+$/,'').replace(/[-_ ]*\d+$/,'')||'악보';frames=[];
   for(const [i,f] of files.entries()){status(`${i+1}/${files.length} 읽는 중…`,i/files.length);const bmp=await createImageBitmap(f);frames.push(await bitmapFrame(bmp,f.name));bmp.close();}
  }
  if(!frames.length)throw Error('쓸 그림이 없습니다.');
  await load(sameSize(frames));
 }catch(e){status('불러오기 실패: '+e.message);console.error(e);}
}
async function sample(){
 S.warnings=['합성 예제: 보케 배경, 고정 오선·제목, 장마다 다른 입체 음표·가사, 하단 네비게이터(현재 장만 강조)·로고, 3장에만 얼룩.'];S.sourceName='합성 예제';
 status('합성 예제 만드는 중…',.1);await new Promise(r=>setTimeout(r,30));
 const set=makeSet({width:1920,height:1080,count:8,smudge:2});
 await load(set.frames.map((f,i)=>({...f,name:`예제 ${i+1}`})));
}
// 화면에는 보기용 캔버스만 남기고 칸 값은 작업자에게 넘긴다.
async function load(frames){
 S.frames=frames.map(f=>({name:f.name,width:f.width,height:f.height,view:imageCanvas(f)}));S.results=frames.map(()=>null);S.marks=frames.map(()=>null);S.shared=null;S.undo=[];S.current=0;S.plate=null;
 status(`작업자에게 ${frames.length}장 넘기는 중…`,0);
 const copies=frames.map(f=>({width:f.width,height:f.height,data:f.data.buffer}));
 await client.request({type:'frames',frames:copies},copies.map(c=>c.data));
 if(frames.length<4)S.warnings.push(`그림이 ${frames.length}장입니다. 4장 이상이면 배경판이 더 정확합니다.`);
 strip();show();await rebuildPlate();
}

// ---------- 배경판·장 처리 ----------
async function rebuildPlate(){
 const epoch=++S.plateEpoch;S.results=S.results.map(()=>null);strip();
 try{
  const t=performance.now(),r=await client.request({type:'plate',options:S.options},[],(p,text)=>status(`배경판: ${text}`,p));
  if(epoch!==S.plateEpoch)return;
  const {width:w,height:h}=S.frames[0];S.plate={width:w,height:h,data:new Uint8ClampedArray(r.plate)};S.plateReport=r.report;
  S.plateCanvas=imageCanvas(S.plate);S.layerCanvas=imageCanvas({width:w,height:h,data:new Uint8ClampedArray(r.layer)});
  status(`배경판 완료 (${((performance.now()-t)/1000).toFixed(1)}초${client.inWorker()?'':', 작업자 없이 화면에서 처리'}). 장을 처리하는 중…`);
  rematteAll();
 }catch(e){status('배경판 실패: '+e.message);console.error(e);}
}
function combined(i){
 const own=S.marks[i],shared=S.shared;if(!own&&!shared)return null;
 const n=S.frames[i].width*S.frames[i].height,out=new Uint8Array(n);
 if(shared)out.set(shared);if(own)for(let k=0;k<n;k++)if(own[k])out[k]=own[k];
 return out;
}
let queue=[],running=false;
function rematteAll(){S.epoch++;S.results=S.results.map(r=>r&&{...r,stale:true});queue=[S.current,...S.frames.map((_,i)=>i).filter(i=>i!==S.current)];pump();strip();}
function rematte(i,front=true){S.results[i]&&(S.results[i].stale=true);queue=queue.filter(x=>x!==i);front?queue.unshift(i):queue.push(i);pump();}
async function pump(){
 if(running||!S.plate)return;running=true;
 try{
  while(queue.length){
   const i=queue.shift(),epoch=S.epoch,plateEpoch=S.plateEpoch,marks=combined(i),layers=$('diag').value==='layers'&&i===S.current;
   markThumb(i,'busy');
   const r=await client.request({type:'matte',index:i,options:S.options,marks:marks?.buffer||null,layers},marks?[marks.buffer]:[]);
   if(plateEpoch!==S.plateEpoch)break;
   const {width:w,height:h}=S.frames[i];
   S.results[i]={data:new Uint8ClampedArray(r.data),report:r.report,canvas:imageCanvas({width:w,height:h,data:new Uint8ClampedArray(r.data)}),layer:r.layer?imageCanvas({width:w,height:h,data:new Uint8ClampedArray(r.layer)}):null,stale:epoch!==S.epoch};
   thumb(i);if(i===S.current)drawResult();
   const left=S.results.filter(x=>!x||x.stale).length;
   status(left?`장 처리 중… 남은 ${left}장`:`${S.frames.length}장 완료 · 붓으로 틀린 곳을 칠해 보세요.`);
  }
 }catch(e){status('처리 실패: '+e.message);console.error(e);}
 finally{running=false;report();}
 if(queue.length)pump();
}

// ---------- 그리기 ----------
let overlays=[],bases=[];
function show(){
 const f=S.frames[S.current];if(!f)return;
 $('name').textContent=`${S.current+1}/${S.frames.length} · ${f.name} · ${f.width}×${f.height}`;
 for(const [k,id] of [['A','stackA'],['B','stackB']]){
  const stack=$(id),base=canvas(f.width,f.height),over=canvas(f.width,f.height);stack.replaceChildren(base,over);bases[k==='A'?0:1]=base;overlays[k==='A'?0:1]=over;brushEvents(over);
 }
 bases[0].getContext('2d').drawImage(f.view,0,0);
 zoom();drawResult();drawMarks();
 for(const el of $('strip').children)el.classList.toggle('on',+el.dataset.index===S.current);
 $('strip').children[S.current]?.scrollIntoView({block:'nearest',inline:'nearest'});
 report();
}
function backdrop(ctx,w,h){
 const v=$('backdrop').value;
 if(v==='white'||v==='black'){ctx.fillStyle=v==='white'?'#fff':'#000';ctx.fillRect(0,0,w,h);}
 else if(v==='plate'&&S.plateCanvas)ctx.drawImage(S.plateCanvas,0,0);
 else if(v==='image'&&S.backdropImage){const b=S.backdropImage,sc=Math.max(w/b.width,h/b.height);ctx.drawImage(b,(w-b.width*sc)/2,(h-b.height*sc)/2,b.width*sc,b.height*sc);}
 else checker(ctx,w,h,Math.max(8,Math.round(w/120)));
}
function drawResult(){
 const c=bases[1],f=S.frames[S.current];if(!c||!f)return;const ctx=c.getContext('2d'),r=S.results[S.current],d=$('diag').value;
 ctx.clearRect(0,0,c.width,c.height);
 if(d==='plate'&&S.plateCanvas)ctx.drawImage(S.plateCanvas,0,0);
 else if(d==='const'&&S.layerCanvas)ctx.drawImage(S.layerCanvas,0,0);
 else if(d==='layers'){ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);if(r?.layer)ctx.drawImage(r.layer,0,0);else if(r&&!r.stale)rematte(S.current);}
 else{backdrop(ctx,c.width,c.height);if(r)ctx.drawImage(r.canvas,0,0);}
 $('resultNote').textContent=!S.plate?'':!r?'처리 중…':r.stale?'다시 처리 중…':d==='layers'?'검정 핵심 · 주황 몸통(명암·구멍) · 파랑 테두리':`${r.report.ms}ms`;
}
function drawMarks(){
 const f=S.frames[S.current];if(!f)return;const show=$('showMarks').checked,m=combined(S.current),own=S.marks[S.current];
 for(const c of overlays){
  const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(!show||!m)continue;
  const img=ctx.createImageData(c.width,c.height),d=img.data;
  for(let i=0;i<m.length;i++){const v=m[i];if(!v)continue;const col=COLORS[v],o=i*4;d[o]=col[0];d[o+1]=col[1];d[o+2]=col[2];d[o+3]=own&&own[i]?110:80;}
  ctx.putImageData(img,0,0);
 }
}
function zoom(){const z=$('zoom').value,f=S.frames[S.current];for(const id of ['stackA','stackB'])$(id).style.width=z==='fit'||!f?'100%':`${f.width*z/devicePixelRatio}px`;}

// ---------- 붓 ----------
const tool=()=>document.querySelector('input[name=tool]:checked').value;
function brushEvents(c){
 let drawing=null;
 const at=e=>{const r=c.getBoundingClientRect();return [(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height,c.width/r.width];};
 c.onpointerdown=e=>{
  if(!S.frames.length||e.button>0)return;e.preventDefault();c.setPointerCapture(e.pointerId);
  const f=S.frames[S.current],n=f.width*f.height,shared=$('allSlides').checked;
  let target=shared?S.shared:S.marks[S.current];if(!target){target=new Uint8Array(n);if(shared)S.shared=target;else S.marks[S.current]=target;}
  drawing={target,shared,before:target.slice(),box:[Infinity,Infinity,-1,-1],last:null,code:TOOL[tool()]};
  move(e);
 };
 const move=e=>{
  if(!drawing)return;const [x,y,ratio]=at(e),r=+$('size').value/2,f=S.frames[S.current];
  const steps=drawing.last?Math.max(1,Math.ceil(Math.hypot(x-drawing.last[0],y-drawing.last[1])/(r/3))):1;
  for(let s=1;s<=steps;s++){const px=drawing.last?drawing.last[0]+(x-drawing.last[0])*s/steps:x,py=drawing.last?drawing.last[1]+(y-drawing.last[1])*s/steps:y;stamp(drawing,px,py,r,f.width,f.height);}
  drawing.last=[x,y];
  for(const o of overlays){const ctx=o.getContext('2d');const col=drawing.code?COLORS[drawing.code]:[255,255,255];ctx.fillStyle=`rgba(${col},${drawing.code?.45:.6})`;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();}
  void ratio;
 };
 c.onpointermove=move;
 c.onpointerup=c.onpointercancel=()=>{
  if(!drawing)return;const d=drawing;drawing=null;if(d.box[2]<0)return;
  const f=S.frames[S.current],[x0,y0,x1,y1]=d.box,w=x1-x0+1,region=new Uint8Array(w*(y1-y0+1));
  for(let y=y0;y<=y1;y++)region.set(d.before.subarray(y*f.width+x0,y*f.width+x1+1),(y-y0)*w);
  S.undo.push({shared:d.shared,index:S.current,box:d.box,region});if(S.undo.length>40)S.undo.shift();
  afterMarks(d.shared);
 };
}
function stamp(d,cx,cy,r,w,h){
 const x0=Math.max(0,Math.floor(cx-r)),x1=Math.min(w-1,Math.ceil(cx+r)),y0=Math.max(0,Math.floor(cy-r)),y1=Math.min(h-1,Math.ceil(cy+r));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if((x-cx)**2+(y-cy)**2<=r*r)d.target[y*w+x]=d.code;
 d.box=[Math.min(d.box[0],x0),Math.min(d.box[1],y0),Math.max(d.box[2],x1),Math.max(d.box[3],y1)];
}
function afterMarks(shared){
 drawMarks();
 if(shared){S.epoch++;for(let i=0;i<S.frames.length;i++)if(i!==S.current)rematte(i,false);}
 rematte(S.current);
}
function undo(){
 const u=S.undo.pop();if(!u)return;const target=u.shared?S.shared:S.marks[u.index],f=S.frames[u.index],[x0,y0,x1,y1]=u.box,w=x1-x0+1;if(!target)return;
 for(let y=y0;y<=y1;y++)target.set(u.region.subarray((y-y0)*w,(y-y0+1)*w),y*f.width+x0);
 if(u.index!==S.current&&!u.shared){S.current=u.index;show();}
 afterMarks(u.shared);
}

// ---------- 썸네일 ----------
function strip(){
 const el=$('strip');el.replaceChildren();
 S.frames.forEach((f,i)=>{const b=document.createElement('button');b.className='thumb'+(i===S.current?' on':'');b.dataset.index=i;b.title=f.name;const c=canvas(300,Math.round(300*f.height/f.width));b.append(c,Object.assign(document.createElement('b'),{textContent:i+1}),document.createElement('i'));b.onclick=()=>{S.current=i;show();};el.append(b);thumb(i);});
}
function thumb(i){
 const el=$('strip').children[i];if(!el)return;const c=el.querySelector('canvas'),ctx=c.getContext('2d'),r=S.results[i];
 if(r){checker(ctx,c.width,c.height,8);ctx.drawImage(r.canvas,0,0,c.width,c.height);}else ctx.drawImage(S.frames[i].view,0,0,c.width,c.height);
 markThumb(i,r&&!r.stale?'ok':r?'busy':'');
}
function markThumb(i,state){const dot=$('strip').children[i]?.querySelector('i');if(dot)dot.className=state;}

// ---------- 내려받기 ----------
async function pngBlob(i){
 const r=S.results[i],{width:w,height:h}=S.frames[i];
 if($('palette').checked){const p=encodePalettePNG(r.data,w,h);if(p)return new Blob([p.bytes],{type:'image/png'});}
 return new Promise(res=>r.canvas.toBlob(res,'image/png'));
}
const fileName=i=>`${S.sourceName||'악보'}-${String(i+1).padStart(2,'0')}.png`;
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function saveOne(){const r=S.results[S.current];if(!r||r.stale){status('이 장 처리가 끝난 뒤 눌러 주세요.');return;}download(await pngBlob(S.current),fileName(S.current));}
async function saveAll(){
 if(S.results.some(r=>!r||r.stale)){status('모든 장 처리가 끝난 뒤 눌러 주세요.');return;}
 if(window.showDirectoryPicker){
  let dir;try{dir=await showDirectoryPicker({id:'score-lab',mode:'readwrite'});}catch(e){if(e.name==='AbortError')return;dir=null;}
  if(dir){
   const sub=await dir.getDirectoryHandle(S.sourceName||'악보',{create:true});
   for(let i=0;i<S.frames.length;i++){status(`저장 중 ${i+1}/${S.frames.length}`,i/S.frames.length);const h=await sub.getFileHandle(fileName(i),{create:true}),w=await h.createWritable();await w.write(await pngBlob(i));await w.close();}
   status(`'${sub.name}' 폴더에 ${S.frames.length}장을 저장했습니다.`);return;
  }
 }
 for(let i=0;i<S.frames.length;i++){status(`내려받는 중 ${i+1}/${S.frames.length}`,i/S.frames.length);download(await pngBlob(i),fileName(i));await new Promise(r=>setTimeout(r,350));}
 status(`${S.frames.length}장을 내려받았습니다. 브라우저가 여러 파일 받기를 물으면 허용해 주세요.`);
}

// ---------- 보고 ----------
function report(){
 const diff=Object.fromEntries(Object.keys(DEFAULTS).filter(k=>S.options[k]!==DEFAULTS[k]).map(k=>[k,S.options[k]]));
 const count=m=>{if(!m)return null;const c={refine:0,erase:0,keep:0};for(const v of m)if(v===1)c.refine++;else if(v===2)c.erase++;else if(v===3)c.keep++;return c;};
 const text={source:S.sourceName,frames:S.frames.length,size:S.frames[0]?`${S.frames[0].width}x${S.frames[0].height}`:null,worker:client.inWorker(),changedOptions:diff,plate:S.plateReport,
  warnings:S.warnings,sharedMarks:count(S.shared),slides:S.results.map((r,i)=>({slide:i+1,marks:count(S.marks[i]),...(r?r.report:{})})),userAgent:navigator.userAgent};
 $('report').value=JSON.stringify(text,null,1);
}

// ---------- 연결 ----------
settings();
$('file').onchange=e=>{open(e.target.files);e.target.value='';};
$('sample').onclick=sample;
$('reset').onclick=()=>{const plate=[...PLATE_KEYS].some(k=>S.options[k]!==DEFAULTS[k]);S.options={...DEFAULTS};settings();if(S.frames.length)plate?rebuildPlate():rematteAll();};
$('zoom').onchange=zoom;
$('backdrop').onchange=()=>{if($('backdrop').value==='image'&&!S.backdropImage){const input=Object.assign(document.createElement('input'),{type:'file',accept:'image/*'});input.onchange=async()=>{if(input.files[0])S.backdropImage=await createImageBitmap(input.files[0]);drawResult();};input.click();}drawResult();};
$('diag').onchange=()=>{if($('diag').value==='layers')rematte(S.current);drawResult();};
$('showMarks').onchange=drawMarks;
$('size').oninput=()=>{$('sizeOut').textContent=$('size').value;};
$('undo').onclick=undo;
// 모든 장 칠은 한 번 더 눌러야 지운다(확인 창 없이).
let clearArmed=null;
$('clearSlide').onclick=()=>{if(!S.frames.length)return;const shared=$('allSlides').checked;if(shared){if(!S.shared)return;if(!clearArmed){$('clearSlide').textContent='한 번 더 누르면 모든 장 칠 지움';clearArmed=setTimeout(()=>{clearArmed=null;$('clearSlide').textContent='이 장 칠 모두 지우기';},3000);return;}clearTimeout(clearArmed);clearArmed=null;$('clearSlide').textContent='이 장 칠 모두 지우기';S.shared=null;}else{if(!S.marks[S.current])return;S.marks[S.current]=null;}S.undo=S.undo.filter(u=>shared?!u.shared:u.shared||u.index!==S.current);afterMarks(shared);};
$('saveOne').onclick=saveOne;$('saveAll').onclick=saveAll;
$('copyReport').onclick=async()=>{report();try{await navigator.clipboard.writeText($('report').value);status('보고 글을 복사했습니다.');}catch{$('report').select();status('글 상자를 선택했습니다. 복사해 주세요.');}};
for(const [a,b] of [['scrollA','scrollB'],['scrollB','scrollA']])$(a).addEventListener('scroll',()=>{$(b).scrollLeft=$(a).scrollLeft;$(b).scrollTop=$(a).scrollTop;});
document.addEventListener('keydown',e=>{
 if(e.target.closest('input,select,textarea'))return;
 if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
 else if(e.key==='ArrowRight'&&S.current<S.frames.length-1){S.current++;show();}
 else if(e.key==='ArrowLeft'&&S.current>0){S.current--;show();}
 else if(e.key===']'||e.key==='['){const v=Math.max(4,Math.min(160,+$('size').value+(e.key===']'?6:-6)));$('size').value=v;$('sizeOut').textContent=v;}
});
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>{e.preventDefault();open(e.dataTransfer.files);});
window.ScoreLab={state:()=>S,open,sample,client};
