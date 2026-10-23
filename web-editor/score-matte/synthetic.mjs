// 시험용 합성 악보 장. 교회 그림 대신 코드로 만든다: 보케·그라데이션 배경, 고정 오선·음자리표·제목,
// 장마다 다른 입체 음표(명암·하이라이트)·가사, 하단 네비게이터(현재 장 단추만 진하게), 오른쪽 위 로고.
// truth는 남겨야 할 악보의 덮임(0~255), notes는 음표 머리 안쪽, nav는 지워야 할 네비게이터·로고.

export function random(seed){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}

function canvas(w,h){return {w,h,rgb:new Float32Array(w*h*3)};}
// sdf(x,y): 안쪽이 음수인 거리(px). color: [r,g,b] 또는 (x,y)=>[r,g,b]. masks: 덮임을 더할 Uint8Array들.
function paint(cv,box,sdf,color,masks=[],opacity=1){
 const {w,h,rgb}=cv,x0=Math.max(0,Math.floor(box[0])),y0=Math.max(0,Math.floor(box[1])),x1=Math.min(w-1,Math.ceil(box[2])),y1=Math.min(h-1,Math.ceil(box[3]));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const c=Math.max(0,Math.min(1,.5-sdf(x+.5,y+.5)))*opacity;if(!c)continue;
  const i=y*w+x,col=typeof color==='function'?color(x+.5,y+.5):color;
  for(let k=0;k<3;k++)rgb[i*3+k]=rgb[i*3+k]*(1-c)+col[k]*c;
  for(const m of masks)m[i]=Math.max(m[i],Math.round(c*255));
 }
}
const rect=(cx,cy,hw,hh)=>[[cx-hw-1,cy-hh-1,cx+hw+1,cy+hh+1],(x,y)=>Math.max(Math.abs(x-cx)-hw,Math.abs(y-cy)-hh)];
function ellipse(cx,cy,a,b,angle=0){
 const cos=Math.cos(angle),sin=Math.sin(angle),m=Math.max(a,b)+2;
 return [[cx-m,cy-m,cx+m,cy+m],(x,y)=>{const u=(x-cx)*cos+(y-cy)*sin,v=-(x-cx)*sin+(y-cy)*cos;return (Math.hypot(u/a,v/b)-1)*Math.min(a,b);}];
}
function ring(cx,cy,a,b,t,angle=0){const [box,f]=ellipse(cx,cy,a,b,angle);return [box,(x,y)=>Math.abs(f(x,y))-t/2];}

function background(cv,kind,rnd,s){
 const {w,h,rgb}=cv;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*3,u=x/w,v=y/h,vig=Math.min(1,Math.hypot(u-.5,v-.5)*1.4);
  if(kind==='dark-corner'){rgb[i]=200-90*vig*vig;rgb[i+1]=210-80*vig*vig;rgb[i+2]=230-60*vig*vig;}
  else{rgb[i]=205+40*u-15*v;rgb[i+1]=215+15*u;rgb[i+2]=238-40*u+5*v;}
 }
 for(let k=0;k<26;k++){
  const r=(40+rnd()*130)*s,cx=rnd()*w,cy=rnd()*h,warm=rnd()<.5,col=warm?[255,236,200]:[226,240,255];
  paint(cv,[cx-r,cy-r,cx+r,cy+r],(x,y)=>(Math.hypot(x-cx,y-cy)-r)/(r*.35)*2,col,[],.35);
 }
 // 사진 속 얇고 어두운 가지(배경이므로 지워져야 함).
 for(let k=0;k<3;k++){const y=(60+k*30)*s,x0=(1500+k*40)*s;paint(cv,[x0,y-3,x0+260*s,y+3],(x,yy)=>Math.abs(yy-y-(x-x0)*.15)-1.2*s,[110,95,80],[],.9);}
}

// 한 장. page는 0부터, pages는 네비게이터 단추 수.
function slide(o,page,pages,rnd){
 const {width:w,height:h}=o,s=w/1920,cv=canvas(w,h),truth=new Uint8Array(w*h),notes=new Uint8Array(w*h),nav=new Uint8Array(w*h),smudge=new Uint8Array(w*h);
 background(cv,o.background,random(o.seed),s);
 // 이 장에만 있는 얼룩(배경판이 모르는 배경 찌꺼기). 악보 뒤에 깔린다.
 if(o.smudge===page){const t=random(o.seed+99);for(let k=0;k<40;k++){const cx=(250+t()*500)*s,cy=(250+t()*120)*s,r=(8+t()*22)*s;paint(cv,[cx-r-2,cy-r-2,cx+r+2,cy+r+2],(x,y)=>Math.hypot(x-cx,y-cy)-r,[150+t()*30,125+t()*20,95],[smudge],.55);}}
 const ink=[22,22,26],systems=[300,640],gap=22*s,left=120*s,right=1800*s;
 // 제목: 모든 장 같은 자리·같은 글(고정, 악보로 남긴다).
 for(let k=0;k<7;k++){const [b,f]=rect((760+k*58)*s,120*s,20*s,26*s);paint(cv,b,(x,y)=>Math.max(f(x,y),-(Math.abs(x-(760+k*58)*s)-6*s)),ink,[truth]);}
 for(const top of systems){
  const sy=top*s;
  for(let l=0;l<5;l++){const [b,f]=rect((left+right)/2,sy+l*gap,(right-left)/2,1.3*s);paint(cv,b,f,ink,[truth]);}
  // 음자리표(고정): 고리 + 세로 획.
  {const [b,f]=ring(left+40*s,sy+3*gap,16*s,22*s,5*s);paint(cv,b,f,ink,[truth]);const [b2,f2]=rect(left+52*s,sy+2*gap,3*s,3.2*gap);paint(cv,b2,f2,ink,[truth]);}
  // 장마다 다른 마디선·음표.
  const count=12+Math.floor(rnd()*4);let x=left+130*s;
  for(let k=0;k<count&&x<right-40*s;k++){
   const step=Math.floor(rnd()*9)-1,cy=sy+step*gap/2,cx=x,a=13*s,b=9.5*s,ang=-.35,hollow=rnd()<.15;
   if(hollow){const [bb,f]=ring(cx,cy,a,b,3.2*s,ang);paint(cv,bb,f,ink,[truth]);}
   else{
    const [bb,f]=ellipse(cx,cy,a,b,ang);
    const shade=(px,py)=>{const t=Math.max(-1,Math.min(1,((px-cx)*.55+(py-cy)*.8)/a)),v=70-55*t;return [v,v,v+6];};
    paint(cv,bb,f,shade,[truth,notes]);
    const hx=cx-4.5*s,hy=cy-3*s,hr=3.6*s;paint(cv,[hx-hr-2,hy-hr-2,hx+hr+2,hy+hr+2],(px,py)=>Math.hypot(px-hx,py-hy)-hr,[246,246,246]);
   }
   const [sb,sf]=rect(cx+a-2*s,cy-38*s,1.4*s,38*s);paint(cv,sb,sf,ink,[truth]);
   if(rnd()<.25){const bx=cx+55*s,[lb,lf]=rect(bx,sy+2*gap,1.6*s,2*gap);paint(cv,lb,lf,ink,[truth]);}
   x+=(90+rnd()*40)*s;
  }
  // 가사: 장마다 다른 'o'(구멍 있는 글자)와 막대.
  let lx=left+120*s;const ly=sy+4*gap+70*s;
  while(lx<right-60*s){
   const n=2+Math.floor(rnd()*4);
   for(let k=0;k<n;k++){if(rnd()<.5){const [b,f]=ring(lx,ly,9*s,11*s,3.6*s);paint(cv,b,f,ink,[truth]);}else{const [b,f]=rect(lx,ly-2*s,1.9*s,13*s);paint(cv,b,f,ink,[truth]);}lx+=24*s;}
   lx+=(30+rnd()*30)*s;
  }
 }
 // 네비게이터: 단추 테두리·글자는 고정, 현재 장 단추만 진하게 칠한다(지워야 함).
 const ny=1030*s,bw=110*s,start=w/2-(pages*(bw+18*s))/2;
 for(let p=0;p<pages;p++){
  const cx=start+p*(bw+18*s)+bw/2;
  if(p===page){const [b,f]=rect(cx,ny,bw/2,18*s);paint(cv,b,f,[40,60,120],[nav],.85);}
  const [b,f]=rect(cx,ny,bw/2,18*s);paint(cv,b,(x,y)=>Math.abs(f(x,y))-1*s,[60,60,70],[nav]);
  for(let k=0;k<3;k++){const [tb,tf]=rect(cx-22*s+k*22*s,ny,2.2*s,9*s);paint(cv,tb,tf,p===page?[250,250,250]:[50,50,60],[nav]);}
 }
 // 오른쪽 아래 로고(고정, 지워야 함).
 {const [b,f]=ring(1850*s,975*s,22*s,22*s,4*s);paint(cv,b,f,[70,40,40],[nav]);}
 const data=new Uint8ClampedArray(w*h*4),noise=random(o.seed*31+page+1);
 for(let i=0;i<w*h;i++){for(let k=0;k<3;k++)data[i*4+k]=cv.rgb[i*3+k]+(noise()-.5)*o.noise;data[i*4+3]=255;}
 return {frame:{width:w,height:h,data},truth,notes,nav,smudge};
}

export function makeSet({width=960,height=540,count=8,seed=7,background='bokeh',noise=6,smudge=-1}={}){
 const o={width,height,seed,background,noise,smudge},rnd=random(seed*7+3),out={frames:[],truth:[],notes:[],nav:[],smudge:[]};
 for(let p=0;p<count;p++){const r=slide(o,p,count,rnd);out.frames.push(r.frame);out.truth.push(r.truth);out.notes.push(r.notes);out.nav.push(r.nav);out.smudge.push(r.smudge);}
 return out;
}

// 결과 알파와 정답 비교. 반투명 가장자리(덮임 30~225)는 세지 않는다.
export function score(result,truth,notes,nav,area=null){
 const a=result.data,n=truth.length;let residue=0,lost=0,noteSolid=0,noteAll=0,navLeft=0,navAll=0,ink=0,areaLeft=0,areaAll=0;
 for(let i=0;i<n;i++){
  const t=truth[i],al=a[i*4+3];
  if(t>=225){ink++;if(al<128)lost++;}
  else if(t<=30&&al>=128){residue++;}
  if(notes[i]>=250){noteAll++;if(al>=230)noteSolid++;}
  if(nav[i]>=200&&t<=30){navAll++;if(al>=64)navLeft++;}
  if(area&&area[i]>=100&&t<=30){areaAll++;if(al>=64)areaLeft++;}
 }
 return {residue,lost,ink,lostShare:lost/Math.max(1,ink),noteSolid:noteSolid/Math.max(1,noteAll),navLeft:navLeft/Math.max(1,navAll),areaLeft:areaLeft/Math.max(1,areaAll)};
}
