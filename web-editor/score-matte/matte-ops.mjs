// 악보 배경 걷기에 쓰는 그림 연산. DOM 없이 타입 배열만 쓴다.
// 그림은 {width,height,data} RGBA(Uint8ClampedArray), 마스크는 Uint8Array(0/1)다.

export function luma(data,n){
 const out=new Uint8Array(n);
 for(let i=0,j=0;i<n;i++,j+=4)out[i]=(data[j]*77+data[j+1]*150+data[j+2]*29)>>8;
 return out;
}

// van Herk/Gil-Werman 1차원 최대·최소. 창 너비 2r+1, 바깥은 pad 값.
function line(src,dst,start,step,n,r,max,pad,g,h){
 const k=2*r+1,len=n+2*r;
 for(let i=0;i<len;i++){const p=i-r,v=p<0||p>=n?pad:src[start+p*step];g[i]=i%k===0?v:max?(v>g[i-1]?v:g[i-1]):(v<g[i-1]?v:g[i-1]);}
 for(let i=len-1;i>=0;i--){const p=i-r,v=p<0||p>=n?pad:src[start+p*step];h[i]=i%k===k-1||i===len-1?v:max?(v>h[i+1]?v:h[i+1]):(v<h[i+1]?v:h[i+1]);}
 for(let x=0;x<n;x++){const a=h[x],b=g[x+k-1];dst[start+x*step]=max?(a>b?a:b):(a<b?a:b);}
}
// 정사각 창(2r+1) 최대 또는 최소. 바깥은 결과에 영향이 없게 채운다.
export function rank(src,w,h,r,max){
 if(r<1)return src.slice();
 const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h),pad=max?0:255,g=new Uint8Array(Math.max(w,h)+2*r),hh=new Uint8Array(Math.max(w,h)+2*r);
 for(let y=0;y<h;y++)line(src,tmp,y*w,1,w,r,max,pad,g,hh);
 for(let x=0;x<w;x++)line(tmp,out,x,w,h,r,max,pad,g,hh);
 return out;
}
// 블랙햇: 닫기(최대 뒤 최소)에서 원래 밝기를 뺀 값. 창보다 얇고 어두운 획이 밝게 남는다.
export function blackhat(L,w,h,r){
 const closed=rank(rank(L,w,h,r,true),w,h,r,false);
 for(let i=0;i<closed.length;i++)closed[i]=closed[i]-L[i];
 return closed;
}

// 장마다 같은 칸의 밝기 중앙값을 가진 장 번호. skip[f][i]가 1인 장은 빼고, 남는 장이 없으면 255.
export function medianIndex(lumas,n,skip=null){
 const N=lumas.length,out=new Uint8Array(n),vals=new Uint8Array(N),idx=new Uint8Array(N);
 for(let i=0;i<n;i++){
  let m=0;
  for(let f=0;f<N;f++){
   if(skip&&skip[f][i])continue;
   const v=lumas[f][i];let j=m++;
   while(j>0&&vals[j-1]>v){vals[j]=vals[j-1];idx[j]=idx[j-1];j--;}
   vals[j]=v;idx[j]=f;
  }
  out[i]=m?idx[(m-1)>>1]:255;
 }
 return out;
}

// 8방향 연결 요소. labels는 0(바깥) 또는 1..count, 덩어리마다 넓이와 테두리 상자.
export function components(mask,w,h){
 const labels=new Int32Array(w*h),parent=[0];
 const find=a=>{while(parent[a]!==a){parent[a]=parent[parent[a]];a=parent[a];}return a;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b){if(a<b)parent[b]=a;else parent[a]=b;}};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(!mask[i])continue;
  let l=0;
  const look=j=>{const v=labels[j];if(v){if(!l)l=v;else if(v!==l)join(l,v);}};
  if(x>0)look(i-1);
  if(y>0){if(x>0)look(i-w-1);look(i-w);if(x<w-1)look(i-w+1);}
  if(!l){l=parent.length;parent.push(l);}
  labels[i]=l;
 }
 const map=new Int32Array(parent.length);let count=0;
 for(let a=1;a<parent.length;a++){const r=find(a);map[a]=r===a?++count:0;}
 for(let a=1;a<parent.length;a++)if(!map[a])map[a]=map[find(a)];
 const area=new Int32Array(count+1),x0=new Int32Array(count+1).fill(w),y0=new Int32Array(count+1).fill(h),x1=new Int32Array(count+1).fill(-1),y1=new Int32Array(count+1).fill(-1);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(!labels[i])continue;const l=labels[i]=map[labels[i]];
  area[l]++;if(x<x0[l])x0[l]=x;if(x>x1[l])x1[l]=x;if(y<y0[l])y0[l]=y;if(y>y1[l])y1[l]=y;
 }
 return {labels,count,area,x0,y0,x1,y1};
}

// 각 칸에서 mask가 켜진 가장 가까운 칸까지의 거리(픽셀, 3-4 체임퍼 근사). 켜진 칸은 0.
export function distance(mask,w,h){
 const INF=1e9,d=new Float32Array(w*h);
 for(let i=0;i<d.length;i++)d[i]=mask[i]?0:INF;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;let v=d[i];if(!v)continue;
  if(x>0&&d[i-1]+3<v)v=d[i-1]+3;
  if(y>0){if(d[i-w]+3<v)v=d[i-w]+3;if(x>0&&d[i-w-1]+4<v)v=d[i-w-1]+4;if(x<w-1&&d[i-w+1]+4<v)v=d[i-w+1]+4;}
  d[i]=v;
 }
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
  const i=y*w+x;let v=d[i];if(!v)continue;
  if(x<w-1&&d[i+1]+3<v)v=d[i+1]+3;
  if(y<h-1){if(d[i+w]+3<v)v=d[i+w]+3;if(x<w-1&&d[i+w+1]+4<v)v=d[i+w+1]+4;if(x>0&&d[i+w-1]+4<v)v=d[i+w-1]+4;}
  d[i]=v;
 }
 for(let i=0;i<d.length;i++)d[i]/=3;
 return d;
}
export function dilate(mask,w,h,r){
 if(r<=0)return mask.slice();
 const d=distance(mask,w,h),out=new Uint8Array(w*h);
 for(let i=0;i<out.length;i++)out[i]=d[i]<=r?1:0;
 return out;
}
export function invert(mask){const out=new Uint8Array(mask.length);for(let i=0;i<mask.length;i++)out[i]=mask[i]?0:1;return out;}
// 닫기: r만큼 넓혔다가 다시 좁힌다. 획 사이 좁은 틈과 작은 구멍이 메워진다.
export function close(mask,w,h,r){
 if(r<=0)return mask.slice();
 const grown=dilate(mask,w,h,r),d=distance(invert(grown),w,h),out=new Uint8Array(w*h);
 for(let i=0;i<out.length;i++)out[i]=d[i]>r?1:0;
 return out;
}

// 모르는 칸(known=0)을 둘레의 아는 칸으로 매끈하게 메운다(밀고 당기는 피라미드). rgba는 그 자리에서 바뀐다.
export function fill(rgba,known,w,h){
 const levels=[];let cw=w,ch=h;
 let col=new Float32Array(w*h*3),wt=new Float32Array(w*h);
 for(let i=0;i<w*h;i++){if(known[i]){wt[i]=1;col[i*3]=rgba[i*4];col[i*3+1]=rgba[i*4+1];col[i*3+2]=rgba[i*4+2];}}
 levels.push({w:cw,h:ch,col,wt});
 while(cw>1||ch>1){
  const nw=Math.max(1,(cw+1)>>1),nh=Math.max(1,(ch+1)>>1),nc=new Float32Array(nw*nh*3),nwt=new Float32Array(nw*nh);
  for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){
   let s=0,r=0,g=0,b=0;
   for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const sx=x*2+dx,sy=y*2+dy;if(sx>=cw||sy>=ch)continue;const j=sy*cw+sx,v=wt[j];s+=v;r+=col[j*3]*v;g+=col[j*3+1]*v;b+=col[j*3+2]*v;}
   const o=y*nw+x;if(s>0){nc[o*3]=r/s;nc[o*3+1]=g/s;nc[o*3+2]=b/s;}nwt[o]=Math.min(1,s);
  }
  cw=nw;ch=nh;col=nc;wt=nwt;levels.push({w:cw,h:ch,col,wt});
 }
 for(let l=levels.length-2;l>=0;l--){
  const a=levels[l],b=levels[l+1];
  for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++){
   const o=y*a.w+x,v=a.wt[o];if(v>=1)continue;
   const fx=Math.min(b.w-1,Math.max(0,(x-.5)/2)),fy=Math.min(b.h-1,Math.max(0,(y-.5)/2)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(b.w-1,x0+1),y1=Math.min(b.h-1,y0+1),tx=fx-x0,ty=fy-y0;
   for(let c=0;c<3;c++){
    const up=(b.col[(y0*b.w+x0)*3+c]*(1-tx)+b.col[(y0*b.w+x1)*3+c]*tx)*(1-ty)+(b.col[(y1*b.w+x0)*3+c]*(1-tx)+b.col[(y1*b.w+x1)*3+c]*tx)*ty;
    a.col[o*3+c]=a.col[o*3+c]*v+up*(1-v);
   }
   a.wt[o]=1;
  }
 }
 const top=levels[0];
 for(let i=0;i<w*h;i++)if(!known[i]){rgba[i*4]=top.col[i*3];rgba[i*4+1]=top.col[i*3+1];rgba[i*4+2]=top.col[i*3+2];}
}

// 256칸 막대그래프의 오츠 문턱. 두 무리가 거의 나뉘지 않으면 separation이 작다.
export function otsu(hist){
 let total=0,sum=0;for(let i=0;i<256;i++){total+=hist[i];sum+=i*hist[i];}
 if(!total)return {threshold:128,separation:0};
 let wB=0,sumB=0,best=-1,threshold=128;
 for(let t=0;t<256;t++){
  wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;
  sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)*(mB-mF);
  if(between>best){best=between;threshold=t+1;}
 }
 const mean=sum/total;let variance=0;for(let i=0;i<256;i++)variance+=hist[i]*(i-mean)*(i-mean);
 return {threshold,separation:variance?best/total/variance:0};
}
