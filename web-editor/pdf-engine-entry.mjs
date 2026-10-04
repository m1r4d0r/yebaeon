import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
// 말씀 PDF를 슬라이드 크기 PNG로 바꾼다. 브라우저 안에서만 하며 원본은 서버로 보내지 않는다.
// 최신 JS 기능을 메워 둔 legacy 빌드를 쓴다(교회·집 브라우저 버전 차이).
GlobalWorkerOptions.workerSrc='/pdf-worker.js';
const MAX=60*1024*1024,MAX_PAGES=120;
// 글꼴을 넣지 않은 한글 PDF용 문자표. 빌드가 한국어 문자표만 `/pdf-cmap-<이름>`으로 둔다.
class CMaps{async fetch({kind,filename}){
 if(kind!=='cMapUrl'||!/^[A-Za-z0-9-]+\.bcmap$/.test(filename))throw Error('지원하지 않는 PDF 자료입니다.');
 const r=await fetch('/pdf-cmap-'+filename,{credentials:'same-origin'});if(!r.ok)throw Error('PDF 문자표를 불러오지 못했습니다.');
 return new Uint8Array(await r.arrayBuffer());
}}
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const blob=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('이미지 변환 실패')),'image/png'));
export async function open(buffer){
 if(buffer.byteLength>MAX)throw Error('PDF는 60MB 이하로 선택해 주세요.');
 const task=getDocument({data:new Uint8Array(buffer),BinaryDataFactory:CMaps,cMapUrl:'/pdf-cmap/',cMapPacked:true,useWorkerFetch:false,useWasm:false,isEvalSupported:false,enableXfa:false,stopAtErrors:false});
 let pdf;try{pdf=await task.promise;}catch(e){await task.destroy();throw Error(e?.name==='PasswordException'?'암호가 걸린 PDF는 열 수 없습니다.':'PDF를 읽지 못했습니다.');}
 if(pdf.numPages>MAX_PAGES){await task.destroy();throw Error(`PDF는 ${MAX_PAGES}쪽까지 가져올 수 있습니다.`);}
 const sizes=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),v=page.getViewport({scale:1});sizes.push({width:v.width,height:v.height});page.cleanup();}
 return {pdf,pages:sizes,dispose:()=>task.destroy()};
}
// 쪽 하나를 width×height 슬라이드에 비율을 지켜 가운데 놓는다. 늘이지 않고 남는 곳은 background로 둔다.
export async function render(doc,index,{width,height,background='#000000'}){
 const page=await doc.pdf.getPage(index+1),base=page.getViewport({scale:1}),scale=Math.min(width/base.width,height/base.height),viewport=page.getViewport({scale});
 const w=Math.max(1,Math.round(viewport.width)),h=Math.max(1,Math.round(viewport.height)),sheet=makeCanvas(w,h);
 await page.render({canvasContext:sheet.getContext('2d'),viewport,background:'#ffffff'}).promise;page.cleanup();
 const slide=makeCanvas(width,height),ctx=slide.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
 const x=Math.round((width-w)/2),y=Math.round((height-h)/2);ctx.drawImage(sheet,x,y);sheet.width=sheet.height=0;
 return {image:await blob(slide),margin:x>1||y>1};
}
