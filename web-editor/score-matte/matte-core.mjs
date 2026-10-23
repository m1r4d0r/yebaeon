// 같은 배경을 쓴 악보 장 여러 장에서 배경판을 만들고, 장마다 악보만 남긴 투명 그림을 만든다.
// 길이 값(px)은 가로 1920 기준이고 그림 크기에 맞춰 늘리거나 줄인다.
import {luma,blackhat,medianIndex,components,distance,dilate,invert,close,fill,otsu} from './matte-ops.mjs';

export const DEFAULTS=Object.freeze({
 strokeRadius:15,   // 획 찾기 창 반지름. 이보다 굵은 어두운 덩어리는 획으로 보지 않는다
 strokeLevel:22,    // 획으로 볼 블랙햇 문턱(0~255)
 constantShare:.75, // 이 비율 이상의 장에서 같은 자리에 있으면 고정 획
 attach:3,          // 고정 획이 장마다 바뀌는 획에 이만큼 붙어 있으면 악보(오선·음자리표)
 navigatorBand:.22, // 악보와 떨어진 고정 획 중 아래 이 비율 안에 있는 것만 배경(하단 네비게이터·로고). 1이면 어디든
 inkLevel:80,       // 악보와 떨어진 고정 획을 악보(제목)로 남길 가장 어두운 칸의 밝기 상한
 navigator:true,    // 그 자리에서 장마다 바뀌는 덩어리(현재 장 단추 강조)도 지운다
 floor:.07,         // 이보다 옅은 어둠은 배경
 core:.32,          // 획 핵심 어둠
 faint:true,        // 핵심이 없는 옅은 덩어리를 지운다
 far:0,             // 핵심에서 이보다 먼 옅은 칸을 지운다(0이면 끔)
 solid:true,        // 악보 안쪽을 불투명하게(입체 음표의 명암·하이라이트 유지)
 shade:.09,         // 핵심 둘레에서 배경과 이만큼 다르면 악보의 명암으로 본다
 shadeReach:6,      // 명암을 찾을 핵심 둘레 거리
 holeRatio:.7,      // 구멍 반지름이 둘레 두께×이 값 이하이면 메운다(음표 하이라이트). 0이면 끔
 refineMin:.5,      // 정교하게 붓에서 악보로 남길 최소 진하기(0~1, 검정일수록 1)
 refineChroma:30,   // 정교하게 붓에서 검정 둘레 명암으로 되살릴 최대 채도(0~255)
 bottomCrop:0       // 아래에서 이 비율을 지운다
});
const MARK={refine:1,erase:2,keep:3};
export {MARK};

function scaleOf(w){return w/1920;}
function check(frames){
 if(!frames.length)throw Error('그림이 없습니다.');
 if(frames.length>32)throw Error('한 번에 32장까지 비교할 수 있습니다.');
 const {width:w,height:h}=frames[0];
 for(const f of frames)if(f.width!==w||f.height!==h)throw Error('모든 그림의 크기가 같아야 합니다.');
 return {w,h,n:w*h};
}

export function strokeMask(L,w,h,o){
 const s=scaleOf(w),bh=blackhat(L,w,h,Math.max(2,Math.round(o.strokeRadius*s))),m=new Uint8Array(w*h);
 for(let i=0;i<m.length;i++)m[i]=bh[i]>=o.strokeLevel?1:0;
 return m;
}

// 배경판. frames는 같은 크기 RGBA 그림들. progress(비율, 글)는 선택.
export function buildPlate(frames,options={},progress=()=>{}){
 const o={...DEFAULTS,...options},{w,h,n}=check(frames),N=frames.length,s=scaleOf(w),warnings=[];
 if(N<4)warnings.push(`그림이 ${N}장뿐입니다. 4장 이상이어야 배경판이 믿을 만합니다.`);
 progress(.05,'밝기');
 const lumas=frames.map(f=>luma(f.data,n));
 const strokes=[],skip=[],count=new Uint8Array(n);
 for(let f=0;f<N;f++){
  progress(.05+.45*f/N,`획 찾기 ${f+1}/${N}`);
  const m=strokeMask(lumas[f],w,h,o);strokes.push(m);
  for(let i=0;i<n;i++)count[i]+=m[i];
  skip.push(dilate(m,w,h,Math.max(1,2*s)));
 }
 progress(.55,'중앙값');
 const first=medianIndex(lumas,n),second=medianIndex(lumas,n,skip);
 const plain=new Uint8ClampedArray(n*4),plate=new Uint8ClampedArray(n*4),known=new Uint8Array(n);
 for(let i=0;i<n;i++){
  const a=first[i],src=frames[a].data;for(let c=0;c<3;c++)plain[i*4+c]=src[i*4+c];plain[i*4+3]=255;
  const b=second[i];if(b!==255){const d=frames[b].data;for(let c=0;c<3;c++)plate[i*4+c]=d[i*4+c];known[i]=1;}plate[i*4+3]=255;
 }
 progress(.65,'고정 획 나누기');
 // 모든 장(거의)의 같은 자리에 있는 획. 장마다 바뀌는 획에 붙은 것은 악보(오선·음자리표), 떨어진 것은 배경(네비게이터·로고).
 const need=Math.max(2,Math.ceil(o.constantShare*N)),constant=new Uint8Array(n),varying=new Uint8Array(n);
 for(let i=0;i<n;i++)if(count[i]>=need)constant[i]=1;
 // 고정 획 가장자리는 잡음으로 장마다 들쭉날쭉하므로 바뀌는 획에서 뺀다.
 const fromConst=distance(constant,w,h),fringe=Math.max(1.5,2*s),band=h*(1-o.navigatorBand);
 for(let i=0;i<n;i++)if(count[i]&&!constant[i]&&fromConst[i]>fringe)varying[i]=1;
 // 아래 띠 안에서만 바뀌는 덩어리(현재 장 단추 강조)는 악보로 치지 않는다.
 const vc=components(varying,w,h);
 for(let i=0;i<n;i++){const l=vc.labels[i];if(l&&vc.y0[l]>=band)varying[i]=0;}
 const near=distance(varying,w,h),grouped=dilate(constant,w,h,Math.max(1,s)),comp=components(grouped,w,h),touch=new Int32Array(comp.count+1),darkest=new Uint8Array(comp.count+1).fill(255);
 for(let i=0;i<n;i++){
  const l=comp.labels[i];if(!l||!constant[i])continue;
  if(near[i]<=o.attach*s+fringe)touch[l]++;
  const g=(plain[i*4]*77+plain[i*4+1]*150+plain[i*4+2]*29)>>8;if(g<darkest[l])darkest[l]=g;
 }
 // 악보와 떨어진 고정 획: 아래 띠 안이면 배경, 위쪽이면 검정에 가까울 때만 악보(제목), 아니면 배경(사진 속 가지 등).
 const isScore=new Uint8Array(comp.count+1);let scoreParts=0,backgroundParts=0;
 for(let l=1;l<=comp.count;l++){if(touch[l]>=Math.max(3,.01*comp.area[l])||comp.y0[l]<band&&darkest[l]<=o.inkLevel){isScore[l]=1;scoreParts++;}else backgroundParts++;}
 const scoreConst=new Uint8Array(n),bgConst=new Uint8Array(n);
 for(let i=0;i<n;i++){const l=comp.labels[i];if(!l)continue;if(isScore[l])scoreConst[i]=1;else bgConst[i]=1;}
 const bgKeep=dilate(bgConst,w,h,Math.max(1,2*s)),scoreFill=dilate(scoreConst,w,h,Math.max(1,2*s));
 for(let i=0;i<n;i++){
  if(bgKeep[i]){for(let c=0;c<3;c++)plate[i*4+c]=plain[i*4+c];known[i]=1;}
  else if(scoreFill[i])known[i]=0;
 }
 let filled=0;for(let i=0;i<n;i++)if(!known[i])filled++;
 progress(.75,'빈 칸 메우기');
 fill(plate,known,w,h);
 // 메우고도 남은 외톨이 어두운 획(획 찾기를 빠져나간 굵은 덩어리 등)을 한 번 더 메운다.
 const leftover=strokeMask(luma(plate,n),w,h,o);let again=0;
 for(let i=0;i<n;i++){if(leftover[i]&&!bgKeep[i]){known[i]=0;again++;}else known[i]=1;}
 if(again){const grown=dilate(invert(known),w,h,Math.max(1,s));for(let i=0;i<n;i++)known[i]=grown[i]?0:1;fill(plate,known,w,h);}
 progress(.9,'네비게이터 자리');
 const zones=[];
 if(o.navigator){
  const z=components(dilate(bgConst,w,h,Math.max(2,12*s)),w,h),pad=Math.round(8*s);
  for(let l=1;l<=z.count;l++)zones.push({x0:Math.max(0,z.x0[l]-pad),y0:Math.max(0,z.y0[l]-pad),x1:Math.min(w-1,z.x1[l]+pad),y1:Math.min(h-1,z.y1[l]+pad)});
 }
 progress(1,'배경판 완료');
 return {width:w,height:h,data:plate,scoreConst,bgConst,zones,count,frames:N,
  report:{frames:N,width:w,height:h,scoreParts,backgroundParts,filled,again,zones:zones.length,warnings}};
}

// 한 장만 있을 때: 획 둘레를 메운 그 장 자체를 배경판으로 쓴다(매끈한 배경만).
export function singlePlate(frame,options={}){
 const o={...DEFAULTS,...options},{width:w,height:h}=frame,n=w*h,s=scaleOf(w);
 const L=luma(frame.data,n),m=dilate(strokeMask(L,w,h,o),w,h,Math.max(1,2*s)),plate=new Uint8ClampedArray(frame.data),known=invert(m);
 fill(plate,known,w,h);for(let i=0;i<n;i++)plate[i*4+3]=255;
 return {width:w,height:h,data:plate,scoreConst:new Uint8Array(n),bgConst:new Uint8Array(n),zones:[],count:m,frames:1,report:{frames:1,width:w,height:h,scoreParts:0,backgroundParts:0,filled:0,again:0,zones:0,warnings:['그림이 한 장이라 매끈한 배경만 걷을 수 있습니다.']}};
}

// 칠한 곳 안에서 검은 악보만 다시 고른다: 어둡고 색이 적을수록 악보 쪽 점수가 높고, 그 안에서 오츠 문턱으로 나눈다.
// 채도가 limit/2를 넘으면 점수가 줄기 시작해 1.5·limit에서 0이 된다.
function inkScore(d,i,limit){const r=d[i*4],g=d[i*4+1],b=d[i*4+2],chroma=Math.max(r,g,b)-Math.min(r,g,b),L=(r*77+g*150+b*29)>>8,k=Math.max(0,Math.min(1,1-(chroma-limit/2)/limit));return Math.round((255-L)*k);}

// 한 장의 투명 악보. marks(선택)는 칸마다 0·MARK 값. 결과 {width,height,data,report,layers?}.
export function matteFrame(frame,plate,options={},marks=null,{layers=false}={}){
 const o={...DEFAULTS,...options},{width:w,height:h}=frame,n=w*h,s=scaleOf(w),src=frame.data,bg=plate.data;
 if(plate.width!==w||plate.height!==h)throw Error('배경판과 그림 크기가 다릅니다.');
 const dark=new Float32Array(n),diff=new Float32Array(n);
 for(let i=0;i<n;i++){
  let a=0,d=0;
  for(let c=0;c<3;c++){const p=src[i*4+c],q=Math.max(1,bg[i*4+c]),v=(q-p)/q;if(v>a)a=v;const e=Math.abs(p-q)/255;if(e>d)d=e;}
  dark[i]=a;diff[i]=d;
 }
 const report={kept:0,faint:0,navigator:0,far:0,holes:0,shade:0,refined:0,erased:0};
 // 칠한 곳 정교하게: 칠한 칸들 안에서만 다시 문턱을 정한다.
 const refineInk=new Uint8Array(n);let refining=false;
 if(marks){
  const hist=new Float64Array(256);let any=0;
  for(let i=0;i<n;i++)if(marks[i]===MARK.refine){hist[inkScore(src,i,o.refineChroma)]++;any++;}
  if(any){
   refining=true;const split=otsu(hist),threshold=Math.max(split.separation>=.5?split.threshold:0,Math.round(o.refineMin*255));report.refineThreshold=threshold;report.refineSeparation=+split.separation.toFixed(3);
   for(let i=0;i<n;i++)if(marks[i]===MARK.refine&&inkScore(src,i,o.refineChroma)>=threshold&&dark[i]>=o.floor)refineInk[i]=1;
   // 고른 검정 둘레의 무채색 명암(입체 음표의 밝은 쪽)과 테두리 1칸은 되살린다. 색이 있는 찌꺼기는 남기지 않는다.
   const closed=close(refineInk,w,h,Math.max(1,o.shadeReach*s)),edge=dilate(refineInk,w,h,1);
   for(let i=0;i<n;i++){
    if(marks[i]!==MARK.refine||refineInk[i]||dark[i]<o.floor)continue;
    const r=src[i*4],g=src[i*4+1],b=src[i*4+2],chroma=Math.max(r,g,b)-Math.min(r,g,b);
    if(closed[i]&&chroma<=o.refineChroma||edge[i]&&inkScore(src,i,o.refineChroma)>=threshold*.6)refineInk[i]=2;
   }
  }
 }
 const cand=new Uint8Array(n);
 for(let i=0;i<n;i++){
  const m=marks?marks[i]:0;
  if(m===MARK.erase)continue;
  if(m===MARK.refine){if(refineInk[i])cand[i]=1;continue;}
  if(dark[i]>=(m===MARK.keep?o.floor/2:o.floor))cand[i]=1;
 }
 const comp=components(cand,w,h),hasCore=new Uint8Array(comp.count+1),touchScore=new Uint8Array(comp.count+1),eraseHits=new Int32Array(comp.count+1),keepHits=new Uint8Array(comp.count+1);
 for(let i=0;i<n;i++){
  const l=comp.labels[i];if(!l)continue;
  if(dark[i]>=o.core||refineInk[i]===1&&dark[i]>=o.floor*2)hasCore[l]=1;
  if(plate.scoreConst[i])touchScore[l]=1;
  if(marks&&marks[i]===MARK.keep)keepHits[l]=1;
 }
 // 지우기 붓: 칠한 칸 둘레 1칸까지 닿은 덩어리 전체를 지운다(대충 칠해도 됨).
 if(marks){
  const erase=new Uint8Array(n);let any=false;for(let i=0;i<n;i++)if(marks[i]===MARK.erase){erase[i]=1;any=true;}
  if(any){const grown=dilate(erase,w,h,1.5);for(let i=0;i<n;i++){const l=comp.labels[i];if(l&&grown[i])eraseHits[l]++;}}
 }
 const drop=new Uint8Array(comp.count+1);
 for(let l=1;l<=comp.count;l++){
  if(keepHits[l])continue;
  // 악보(고정 오선 등)에 붙지 않았고 칠한 곳보다 너무 크지 않은 덩어리만 통째로 지운다. 나머지는 칠한 칸만 지운다.
  if(eraseHits[l]&&!touchScore[l]&&comp.area[l]<=4*eraseHits[l]){drop[l]=1;report.erased++;continue;}
  if(o.faint&&!hasCore[l]){drop[l]=1;report.faint++;continue;}
  if(!touchScore[l])for(const z of plate.zones)if(comp.x0[l]>=z.x0&&comp.x1[l]<=z.x1&&comp.y0[l]>=z.y0&&comp.y1[l]<=z.y1){drop[l]=1;report.navigator++;break;}
 }
 const keep=new Uint8Array(n),core=new Uint8Array(n);
 for(let i=0;i<n;i++){const l=comp.labels[i];if(l&&!drop[l]){keep[i]=1;if(dark[i]>=o.core||refineInk[i]===1&&dark[i]>=o.floor*2)core[i]=1;}}
 if(o.far>0){
  const d=distance(core,w,h);
  for(let i=0;i<n;i++)if(keep[i]&&!core[i]&&d[i]>o.far*s){keep[i]=0;report.far++;}
 }
 // 입체 음표: 핵심을 닫은 자리 안에서 배경과 다른 칸(밝은 하이라이트 포함)은 악보 몸통이다.
 const body=new Uint8Array(n);
 if(o.solid){
  const closed=close(core,w,h,Math.max(1,o.shadeReach*s));
  for(let i=0;i<n;i++){
   if(core[i])body[i]=1;
   else if(closed[i]&&diff[i]>=o.shade&&(!marks||!marks[i]||marks[i]===MARK.keep)){body[i]=1;keep[i]=1;report.shade++;}
  }
  if(o.holeRatio>0){
   const holes=components(invert(body),w,h),inside=distance(invert(body),w,h),maxHole=Math.pow(40*s,2);
   for(let l=1;l<=holes.count;l++){
    const a=holes.area[l];if(a>maxHole||holes.x0[l]===0||holes.y0[l]===0||holes.x1[l]===w-1||holes.y1[l]===h-1)continue;
    const r=Math.sqrt(a/Math.PI),m=Math.ceil(r*2+2);let thick=0;
    for(let y=Math.max(0,holes.y0[l]-m);y<=Math.min(h-1,holes.y1[l]+m);y++)for(let x=Math.max(0,holes.x0[l]-m);x<=Math.min(w-1,holes.x1[l]+m);x++){const v=inside[y*w+x];if(v>thick)thick=v;}
    if(r<=thick*o.holeRatio&&thick>=2*s){
     report.holes++;
     for(let y=holes.y0[l];y<=holes.y1[l];y++)for(let x=holes.x0[l];x<=holes.x1[l];x++){const i=y*w+x;if(holes.labels[i]===l&&(!marks||marks[i]!==MARK.erase)){body[i]=1;keep[i]=1;}}
    }
   }
  }
 }
 const inner=o.solid?distance(invert(body),w,h):null,limit=o.bottomCrop>0?Math.floor(h*(1-o.bottomCrop)):h;
 const out=new Uint8ClampedArray(n*4);
 for(let i=0;i<n;i++){
  if(!keep[i]||i>=limit*w)continue;
  const sa=src[i*4+3]/255;
  if(inner&&body[i]&&(inner[i]>=1.5||!core[i])){
   out[i*4]=src[i*4];out[i*4+1]=src[i*4+1];out[i*4+2]=src[i*4+2];out[i*4+3]=Math.round(255*sa);report.kept++;continue;
  }
  // 몸통 가장자리: 둘레 안쪽 칸의 색을 악보 색으로 보고 배경과 섞인 비율을 구한다(회색·입체 음표의 테두리).
  if(inner&&body[i]){
   const x=i%w,y=(i-x)/w;let r=0,g=0,b=0,k=0;
   for(let yy=Math.max(0,y-2);yy<=Math.min(h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(w-1,x+2);xx++){const j=yy*w+xx;if(inner[j]>=1.5){r+=src[j*4];g+=src[j*4+1];b+=src[j*4+2];k++;}}
   if(k){
    const f=[r/k,g/k,b/k];let num=0,den=0;
    for(let c=0;c<3;c++){const d=f[c]-bg[i*4+c];num+=(src[i*4+c]-bg[i*4+c])*d;den+=d*d;}
    if(den>=400){const a=Math.max(dark[i],Math.min(1,num/den));if(a>0){for(let c=0;c<3;c++)out[i*4+c]=(src[i*4+c]-(1-a)*bg[i*4+c])/a;out[i*4+3]=Math.round(255*a*sa);report.kept++;}continue;}
   }
  }
  const a=Math.min(1,dark[i]);if(a<=0)continue;
  for(let c=0;c<3;c++)out[i*4+c]=(src[i*4+c]-(1-a)*bg[i*4+c])/a;
  out[i*4+3]=Math.round(255*a*sa);report.kept++;
 }
 const result={width:w,height:h,data:out,report};
 if(layers)result.layers={core,body,keep,refining};
 return result;
}

// 진단 그림: 배경판의 고정 획(파랑 악보·빨강 배경)과 네비게이터 자리.
export function plateLayer(plate){
 const {width:w,height:h}=plate,n=w*h,out=new Uint8ClampedArray(n*4);
 for(let i=0;i<n;i++){
  const g=(plate.data[i*4]*77+plate.data[i*4+1]*150+plate.data[i*4+2]*29)>>8,v=128+g/2;
  out[i*4]=out[i*4+1]=out[i*4+2]=v;out[i*4+3]=255;
  if(plate.scoreConst[i]){out[i*4]=30;out[i*4+1]=90;out[i*4+2]=230;}
  else if(plate.bgConst[i]){out[i*4]=230;out[i*4+1]=40;out[i*4+2]=40;}
 }
 for(const z of plate.zones){for(let x=z.x0;x<=z.x1;x++)for(const y of [z.y0,z.y1]){const i=(y*w+x)*4;out[i]=255;out[i+1]=160;out[i+2]=0;}for(let y=z.y0;y<=z.y1;y++)for(const x of [z.x0,z.x1]){const i=(y*w+x)*4;out[i]=255;out[i+1]=160;out[i+2]=0;}}
 return {width:w,height:h,data:out};
}
