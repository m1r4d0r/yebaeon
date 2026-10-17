import test from 'node:test';
import assert from 'node:assert/strict';
import {unzlibSync} from 'fflate';
import {encodePalettePNG} from '../web-editor/png-palette.mjs';
// 만든 PNG를 다시 풀어 RGBA로 되돌린다(색 형식 3, 필터 0만).
function decode(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset);let at=8,w,h,depth,type,plte,trns=new Uint8Array(0);const idat=[];
 assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
 while(at<bytes.length){const len=view.getUint32(at),name=String.fromCharCode(...bytes.slice(at+4,at+8)),data=bytes.slice(at+8,at+8+len);
  if(name==='IHDR'){w=view.getUint32(at+8);h=view.getUint32(at+12);depth=data[8];type=data[9];}else if(name==='PLTE')plte=data;else if(name==='tRNS')trns=data;else if(name==='IDAT')idat.push(data);at+=12+len;}
 assert.equal(depth,8);assert.equal(type,3);const raw=unzlibSync(Buffer.concat(idat)),out=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++){assert.equal(raw[y*(w+1)],0);for(let x=0;x<w;x++){const v=raw[y*(w+1)+1+x],o=(y*w+x)*4;out.set([plte[v*3],plte[v*3+1],plte[v*3+2],v<trns.length?trns[v]:255],o);}}
 return {w,h,data:out,colors:plte.length/3};}
const image=(w,h,fn)=>{const d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)d.set(fn(x,y),(y*w+x)*4);return d;};
test('palette PNG keeps an image with 256 colours or fewer exactly, transparency included',()=>{
 const src=image(40,20,(x,y)=>x<10?[255,0,0,0]:x<20?[0,0,0,255]:[10,20,30,Math.min(255,y*12)]);
 const r=encodePalettePNG(src,40,20,{lossless:true});assert.ok(r.exact);
 const back=decode(r.bytes);assert.equal(back.w,40);
 for(let i=0;i<src.length;i+=4){if(src[i+3]===0)assert.equal(back.data[i+3],0);else assert.deepEqual([...back.data.slice(i,i+4)],[...src.slice(i,i+4)]);}
});
test('palette PNG reduces an antialiased score to 256 colours with small error and keeps clear pixels clear',()=>{
 const w=300,h=120,src=image(w,h,(x,y)=>{const ink=Math.max(0,1-Math.abs(((x*7+y*3)%23)-11)/6);const hue=x>250?[200,40,40]:[20,20,30];return ink>0?[...hue.map((v,c)=>v+((x*13+y*7+c*5)%31)),ink>.8?255:Math.round(ink*255)]:[255,255,255,0];});
 assert.equal(encodePalettePNG(src,w,h,{lossless:true}),null,'more than 256 colours is not lossless');
 const r=encodePalettePNG(src,w,h);assert.equal(r.exact,false);assert.ok(r.colors<=256);
 const back=decode(r.bytes);let worst=0;
 for(let i=0;i<src.length;i+=4){if(src[i+3]===0){assert.equal(back.data[i+3],0);continue;}if(src[i+3]===255)assert.equal(back.data[i+3],255,'opaque ink stays opaque');else assert.ok(back.data[i+3]<255,'soft edges stay soft');const a=src[i+3]/255;for(let c=0;c<3;c++)worst=Math.max(worst,Math.abs(src[i+c]*a-back.data[i+c]*back.data[i+3]/255));worst=Math.max(worst,Math.abs(src[i+3]-back.data[i+3]));}
 assert.ok(worst<=24,'largest premultiplied error '+worst);
});
