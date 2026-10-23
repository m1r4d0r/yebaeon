// 화면 쪽에서 작업자를 부른다. 작업자를 만들 수 없으면(보안 정책 등) 같은 처리를 화면에서 돌린다.
import {handle} from './matte-session.mjs';
export function createClient(workerURL){
 let worker=null,seq=0;const waiting=new Map(),local={};
 try{worker=new Worker(workerURL);worker.onmessage=e=>{const m=e.data,w=waiting.get(m.id);if(!w)return;if(m.type==='progress'){w.progress?.(m.p,m.t);return;}waiting.delete(m.id);m.type==='error'?w.reject(Error(m.message)):w.resolve(m);};}
 catch{worker=null;}
 // 작업자가 실제로 뜨는지 먼저 확인한다. 4초 안에 답이 없거나 오류면 화면에서 돌린다.
 const ready=!worker?Promise.resolve():new Promise(resolve=>{
  const give=()=>{worker?.terminate();worker=null;waiting.delete(0);resolve();},timer=setTimeout(give,4000);
  worker.onerror=()=>{clearTimeout(timer);give();};
  waiting.set(0,{resolve:()=>{clearTimeout(timer);worker.onerror=e=>{for(const w of waiting.values())w.reject(Error(e.message||'작업자 오류(메모리 부족일 수 있음)'));waiting.clear();};resolve();},reject:()=>{clearTimeout(timer);give();}});
  worker.postMessage({id:0,type:'ping'});
 });
 return {
  ready,
  inWorker:()=>!!worker,
  async request(message,transfer=[],progress){
   await ready;const id=++seq;
   if(!worker)return new Promise((resolve,reject)=>setTimeout(()=>{try{resolve({id,...handle(local,{...message,id},progress||(()=>{})).reply});}catch(e){reject(e);}},0));
   return new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject,progress});worker.postMessage({...message,id},transfer);});
  }
 };
}
