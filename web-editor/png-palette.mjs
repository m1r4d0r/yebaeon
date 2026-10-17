import {zlibSync} from 'fflate';
// 팔레트(256색) PNG: 색 형식 3·비트 깊이 8, 투명도는 tRNS. 악보처럼 색이 적은 그림의 용량을 줄인다.
// 256색 이하면 그대로(무손실), 넘으면 미리 곱한 RGBA 공간의 median cut으로 줄인 뒤 가장 가까운 색으로 칠한다(디더링 없음).
const CRC=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const out=new Uint8Array(12+data.length),view=new DataView(out.buffer);view.setUint32(0,data.length);for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);out.set(data,8);view.setUint32(8+data.length,crc(out.subarray(4,8+data.length)));return out;}
// 완전히 투명한 점은 색과 상관없이 한 색(0)으로 본다.
const keyOf=(d,i)=>d[i+3]?((d[i]<<24)|(d[i+1]<<16)|(d[i+2]<<8)|d[i+3])>>>0:0;
const rgba=k=>[k>>>24,(k>>>16)&255,(k>>>8)&255,k&255];
function histogram(d,limit=Infinity){const counts=new Map();for(let i=0;i<d.length;i+=4){const k=keyOf(d,i);counts.set(k,(counts.get(k)||0)+1);if(counts.size>limit)return null;}return counts;}
// 거리는 미리 곱한 색(r·a, g·a, b·a)과 알파로 잰다. 거의 투명한 점의 색 차이는 작게 친다.
const point=k=>{const [r,g,b,a]=rgba(k);return [r*a/255,g*a/255,b*a/255,a];};
function medianCut(colors,size){
 const boxes=[colors];
 while(boxes.length<size){
  let best=-1,score=0,axis=0;
  boxes.forEach((box,i)=>{if(box.length<2)return;for(let c=0;c<4;c++){let lo=Infinity,hi=-Infinity,n=0;for(const x of box){lo=Math.min(lo,x.p[c]);hi=Math.max(hi,x.p[c]);n+=x.n;}const s=(hi-lo)*Math.sqrt(n);if(s>score){score=s;best=i;axis=c;}}});
  if(best<0||score===0)break;
  const box=boxes[best].sort((a,b)=>a.p[axis]-b.p[axis]),total=box.reduce((s,x)=>s+x.n,0);let acc=0,cut=1;
  for(let i=0;i<box.length-1;i++){acc+=box[i].n;if(acc>=total/2){cut=i+1;break;}}
  boxes.splice(best,1,box.slice(0,cut),box.slice(cut));
 }
 return boxes.filter(b=>b.length).map(box=>{const n=box.reduce((s,x)=>s+x.n,0),p=[0,1,2,3].map(c=>box.reduce((s,x)=>s+x.p[c]*x.n,0)/n),a=Math.round(p[3]);return a?[...p.slice(0,3).map(v=>Math.max(0,Math.min(255,Math.round(v*255/a)))),a]:[0,0,0,0];});
}
function nearest(palette,k){const q=point(k),solid=(k&255)===255;let best=0,gap=Infinity;for(let i=0;i<palette.length;i++){const p=palette[i];if(p.c[3]===0||(p.c[3]===255)!==solid)continue;const d0=p.pt[0]-q[0],d1=p.pt[1]-q[1],d2=p.pt[2]-q[2],d3=p.pt[3]-q[3],d=d0*d0+d1*d1+d2*d2+2*d3*d3;if(d<gap){gap=d;best=i;}}return best;}
// data: RGBA(ImageData.data). lossless면 256색을 넘을 때 null을 돌려준다.
export function encodePalettePNG(data,width,height,{lossless=false}={}){
 if(!(width>0&&height>0)||data.length!==width*height*4)throw Error('그림 크기가 맞지 않습니다.');
 let counts=histogram(data,256);const exact=!!counts;
 if(!counts){if(lossless)return null;counts=histogram(data);}
 // 투명색을 맨 앞에, 반투명을 그다음에 두어 tRNS를 짧게 한다.
 // 불투명한 점과 반투명한 점은 따로 줄인다(불투명 악보가 살짝 비치지 않게). 칸 수는 색 수의 제곱근에 비례해 나눈다.
 let colors;if(exact)colors=[...counts.keys()].map(rgba);else{const all=[...counts].filter(([k])=>k!==0).map(([k,n])=>({k,n,p:point(k)})),solid=all.filter(x=>(x.k&255)===255),soft=all.filter(x=>(x.k&255)<255);
  let forSoft=soft.length?Math.max(1,Math.round(255*Math.sqrt(soft.length)/(Math.sqrt(soft.length)+Math.sqrt(solid.length)))):0;if(solid.length&&forSoft>254)forSoft=254;
  colors=[[0,0,0,0],...(solid.length?medianCut(solid,255-forSoft).map(c=>[c[0],c[1],c[2],255]):[]),...(soft.length?medianCut(soft,forSoft).map(c=>[c[0],c[1],c[2],Math.min(254,Math.max(1,c[3]))]):[])];}
 colors=colors.map((c,i)=>({c,i})).sort((x,y)=>x.c[3]-y.c[3]||x.i-y.i).map(x=>x.c);
 const palette=colors.map(c=>({c,pt:point(((c[0]<<24)|(c[1]<<16)|(c[2]<<8)|c[3])>>>0)})),index=new Map();
 if(exact)colors.forEach((c,i)=>index.set(((c[0]<<24)|(c[1]<<16)|(c[2]<<8)|c[3])>>>0,i));
 else index.set(0,0);
 const raw=new Uint8Array((width+1)*height);
 for(let y=0,i=0;y<height;y++){raw[y*(width+1)]=0;for(let x=0;x<width;x++,i+=4){const k=keyOf(data,i);let v=index.get(k);if(v===undefined){v=nearest(palette,k);index.set(k,v);}raw[y*(width+1)+1+x]=v;}}
 const ihdr=new Uint8Array(13),hv=new DataView(ihdr.buffer);hv.setUint32(0,width);hv.setUint32(4,height);ihdr.set([8,3,0,0,0],8);
 const plte=new Uint8Array(colors.length*3);colors.forEach((c,i)=>plte.set(c.slice(0,3),i*3));
 const alpha=colors.map(c=>c[3]),last=alpha.findLastIndex(a=>a<255),trns=new Uint8Array(alpha.slice(0,last+1));
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('PLTE',plte),...(trns.length?[chunk('tRNS',trns)]:[]),chunk('IDAT',zlibSync(raw,{level:9})),chunk('IEND',new Uint8Array(0))];
 const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}
 return {bytes:out,colors:colors.length,exact};
}
