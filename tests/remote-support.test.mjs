import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
// 교회 Mac 현황과 원격 지원(sync.md 13.6). 로컬 Worker 모사만 쓴다.
const origin='https://example.test';
async function fixture(t){
 const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'remote-test',ADMIN_PASSWORD:'admin-secret-1'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));t.after(()=>mf.dispose());
 const read=async(r,status=200)=>{const text=await r.text();assert.equal(r.status,status,`${r.status} ${text}`);return text?JSON.parse(text):null;};
 const person=async name=>{
  const login=await mf.dispatchFetch(origin+'/api/session',{method:'POST',body:JSON.stringify({name,password:'remote-test'}),headers:{'Content-Type':'application/json',Origin:origin}});await read(login);
  let cookie=login.headers.get('Set-Cookie').split(';')[0];
  const call=(path,method='GET',body,headers={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin,...headers}});
  const admin=async()=>{const r=await call('/admin','POST',JSON.stringify({password:'admin-secret-1'}));await read(r);cookie+='; '+r.headers.get('Set-Cookie').split(';')[0];};
  return {call,admin};
 };
 const owner=await person('관리자');
 const issued=await read(await owner.call('/sync/devices','POST',JSON.stringify({name:'교회 Mac'})),201);
 const device=(path,method='GET',body)=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+issued.token}});
 return {mf,read,person,owner,device,id:issued.device.id,db:await mf.getD1Database('DB')};
}

test('Mac status: only the device writes its own row, everyone signed in reads it',{timeout:90000},async t=>{
 const {read,person,owner,device,id}=await fixture(t);
 const status={build:57,presenter:false,summary:'받을 예배 1개',rows:[{nodeID:'N1',name:'1부 예배',status:'receive',text:'받기 2'}]};
 await read(await device(`/sync/devices/${id}/status`,'POST',JSON.stringify({status})));
 const listed=(await read(await owner.call('/sync/devices'))).devices[0];
 assert.deepEqual(listed.status,status);assert.ok(listed.statusAt);assert.equal(listed.supportUntil,null);
 const visitor=await person('방문');assert.deepEqual((await read(await visitor.call('/sync/devices'))).devices[0].status,status);
 // 사람 세션은 현황을 쓸 수 없다. 형식이 틀리거나 너무 크면 거절.
 assert.equal((await owner.call(`/sync/devices/${id}/status`,'POST',JSON.stringify({status}))).status,403);
 assert.equal((await device(`/sync/devices/${id}/status`,'POST',JSON.stringify({status:[1]}))).status,400);
 assert.equal((await device(`/sync/devices/${id}/status`,'POST',JSON.stringify({status:{big:'가'.repeat(30000)}}))).status,413);
 assert.equal((await device(`/sync/devices/${'0'.repeat(32)}/status`,'POST',JSON.stringify({status}))).status,403);
});

test('remote support: Mac opens the window, admin leaves commands, Mac takes them once and reports',{timeout:90000},async t=>{
 const {read,person,owner,device,id,db}=await fixture(t);
 const send=(who,action,args)=>who.call(`/sync/devices/${id}/commands`,'POST',JSON.stringify({action,args}));
 // 지원 시간이 아니면 관리자도 못 보낸다. 관리자 확인이 먼저다.
 assert.equal((await send(owner,'check')).status,403);
 await owner.admin();
 assert.equal((await send(owner,'check')).status,409);
 // 지원 시간은 Mac만 연다(관리자도 열 수 없다).
 assert.equal((await owner.call(`/sync/devices/${id}/support`,'POST',JSON.stringify({minutes:30}))).status,403);
 assert.equal((await device(`/sync/devices/${id}/support`,'POST',JSON.stringify({minutes:0}))).status,400);
 assert.equal((await device(`/sync/devices/${id}/support`,'POST',JSON.stringify({minutes:61}))).status,400);
 const opened=await read(await device(`/sync/devices/${id}/support`,'POST',JSON.stringify({minutes:30})));
 assert.ok(Date.parse(opened.supportUntil)>Date.now()+29*60e3);
 assert.equal((await read(await owner.call('/sync/devices'))).devices[0].supportUntil,opened.supportUntil);
 // 일반 세션(관리자 아님)은 보낼 수 없다. 명령 종류·인자는 정해진 것만.
 const plain=await person('방문');assert.equal((await send(plain,'check')).status,403);
 for(const [action,args] of [['shell',{cmd:'ls'}],['apply',{}],['apply',{nodes:[]}],['organizer',{path:'a.pro6',do:'rm'}],['force',{path:'',do:'server'}],['message',{text:'x'.repeat(201)}],['check',[1]]])
  assert.equal((await send(owner,action,args)).status,400,action);
 const first=(await read(await send(owner,'check'),201)).command;
 assert.deepEqual([first.action,first.args,first.author,first.state],['check',{},'관리자','pending']);
 const second=(await read(await send(owner,'organizer',{path:'찬양/주님.pro6',do:'server',extra:'버림'}),201)).command;
 assert.deepEqual(second.args,{path:'찬양/주님.pro6',do:'server'});
 await read(await send(owner,'apply',{nodes:['N1','N1','N2']}),201);
 // Mac은 한 번만 가져간다(만든 순서대로). 다시 물으면 빈 목록.
 const taken=await read(await device(`/sync/devices/${id}/commands`));
 assert.deepEqual(taken.commands.map(c=>[c.action,c.state]),[['check','taken'],['organizer','taken'],['apply','taken']]);
 assert.deepEqual(taken.commands[2].args,{nodes:['N1','N2']});
 assert.deepEqual((await read(await device(`/sync/devices/${id}/commands`))).commands,[]);
 // 결과 보고: 장치만, 가져간 명령만, 한 번만.
 const result=(c,state,message)=>device(`/sync/devices/${id}/commands/${c.id}`,'POST',JSON.stringify({state,message}));
 assert.equal((await owner.call(`/sync/devices/${id}/commands/${first.id}`,'POST',JSON.stringify({state:'done'}))).status,403);
 assert.equal((await result(first,'maybe')).status,400);
 await read(await result(first,'done','모두 같음'));
 assert.equal((await result(first,'done')).status,409);
 await read(await result(second,'rejected','PP6가 켜져 있어 하지 않았습니다.'));
 const history=await read(await owner.call(`/sync/devices/${id}/commands`));
 assert.deepEqual(history.commands.map(c=>[c.action,c.state,c.result]).reverse(),[['check','done','모두 같음'],['organizer','rejected','PP6가 켜져 있어 하지 않았습니다.'],['apply','taken',null]]);
 assert.equal((await device(`/sync/devices/${id}/commands`,'POST',JSON.stringify({action:'check'}))).status,403);
 // 만료된 명령은 가져가지 않는다.
 const stale=(await read(await send(owner,'fullCheck'),201)).command;
 await db.prepare('UPDATE yebaeon_sync_commands SET expires_at=? WHERE id=?').bind(new Date(Date.now()-1000).toISOString(),stale.id).run();
 assert.deepEqual((await read(await device(`/sync/devices/${id}/commands`))).commands,[]);
 assert.equal((await read(await owner.call(`/sync/devices/${id}/commands`))).commands[0].state,'expired');
 // 닫기: 관리자나 Mac. 닫으면 남은 명령은 만료되고 Mac은 빈 목록을 받는다.
 await read(await send(owner,'message',{text:'PP6를 닫아 주세요'}),201);
 assert.equal((await plain.call(`/sync/devices/${id}/support`,'POST',JSON.stringify({close:true}))).status,403);
 await read(await owner.call(`/sync/devices/${id}/support`,'POST',JSON.stringify({close:true})));
 assert.deepEqual(await read(await device(`/sync/devices/${id}/commands`)),{commands:[],supportUntil:null});
 assert.equal((await read(await owner.call(`/sync/devices/${id}/commands`))).commands[0].state,'expired');
 assert.equal((await send(owner,'check')).status,409);
 // 지원 시간이 지나면 열린 표시도 사라진다.
 await read(await device(`/sync/devices/${id}/support`,'POST',JSON.stringify({minutes:5})));
 await db.prepare('UPDATE yebaeon_sync_devices SET support_until=? WHERE id=?').bind(new Date(Date.now()-1000).toISOString(),id).run();
 assert.equal((await read(await owner.call('/sync/devices'))).devices[0].supportUntil,null);
 assert.equal((await send(owner,'check')).status,409);
 // Mac이 스스로 닫기
 await read(await device(`/sync/devices/${id}/support`,'POST',JSON.stringify({minutes:5})));
 await read(await device(`/sync/devices/${id}/support`,'POST',JSON.stringify({close:true})));
 assert.equal((await read(await owner.call('/sync/devices'))).devices[0].supportUntil,null);
 // 해제된 장치는 아무것도 못 한다.
 await read(await owner.call('/sync/devices/'+id,'DELETE'));
 assert.equal((await device(`/sync/devices/${id}/commands`)).status,401);
});
