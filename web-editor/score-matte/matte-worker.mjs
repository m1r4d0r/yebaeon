// Web Worker 감싸기. 장 그림은 처음 한 번만 받아 두고, 배경판·장 처리 요청을 차례로 처리한다.
import {handle} from './matte-session.mjs';
const session={};
self.onmessage=e=>{
 const m=e.data;
 try{const {reply,transfer}=handle(session,m,(p,t)=>self.postMessage({id:m.id,type:'progress',p,t}));self.postMessage({id:m.id,...reply},transfer);}
 catch(err){self.postMessage({id:m.id,type:'error',message:err.message||String(err)});}
};
