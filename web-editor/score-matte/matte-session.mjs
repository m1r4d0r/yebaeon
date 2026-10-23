// 작업자와 화면 쪽 대체 실행이 함께 쓰는 요청 처리. 요청: frames(장 그림), plate(배경판), matte(한 장).
import {buildPlate,singlePlate,matteFrame,plateLayer} from './matte-core.mjs';
export function handle(session,m,progress){
 if(m.type==='ping')return {reply:{type:'pong'},transfer:[]};
 if(m.type==='frames'){
  session.frames=m.frames.map(f=>({width:f.width,height:f.height,data:new Uint8ClampedArray(f.data)}));session.plate=null;
  return {reply:{type:'frames',count:session.frames.length},transfer:[]};
 }
 if(!session.frames?.length)throw Error('먼저 그림을 불러와 주세요.');
 if(m.type==='plate'){
  const t=Date.now();
  session.plate=session.frames.length>=2?buildPlate(session.frames,m.options,progress):singlePlate(session.frames[0],m.options);
  const view=session.plate.data.slice(),layer=plateLayer(session.plate).data;
  return {reply:{type:'plate',report:{...session.plate.report,ms:Date.now()-t},plate:view.buffer,layer:layer.buffer},transfer:[view.buffer,layer.buffer]};
 }
 if(m.type==='matte'){
  if(!session.plate)throw Error('배경판이 없습니다.');
  const frame=session.frames[m.index];if(!frame)throw Error('없는 장입니다.');
  const t=Date.now(),r=matteFrame(frame,session.plate,m.options,m.marks?new Uint8Array(m.marks):null,{layers:!!m.layers});
  const reply={type:'matte',index:m.index,data:r.data.buffer,report:{...r.report,ms:Date.now()-t}},transfer=[r.data.buffer];
  if(r.layers){
   const {core,body,keep}=r.layers,n=core.length,img=new Uint8ClampedArray(n*4);
   for(let i=0;i<n;i++){const o=i*4;if(core[i]){img[o]=20;img[o+1]=20;img[o+2]=20;img[o+3]=255;}else if(body[i]){img[o]=230;img[o+1]=140;img[o+2]=0;img[o+3]=255;}else if(keep[i]){img[o]=30;img[o+1]=150;img[o+2]=230;img[o+3]=255;}}
   reply.layer=img.buffer;transfer.push(img.buffer);
  }
  return {reply,transfer};
 }
 throw Error('알 수 없는 요청: '+m.type);
}
