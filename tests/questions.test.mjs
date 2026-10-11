import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
// 질문·답변 창. 로컬 Worker 모사만 쓰고, Discord 웹훅은 가짜 바깥 연결로 받는다.
const origin='https://example.test',hook='https://discord.com/api/webhooks/1/test-token';
async function fixture(t,{webhook=hook,fail=false,extra={}}={}){
 const bundle=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
 const sent=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'question-test',ADMIN_PASSWORD:'admin-secret-1',...(webhook?{DISCORD_WEBHOOK_URL:webhook}:{}),...extra},d1Databases:['DB'],r2Buckets:['FILES'],cf:false,
  outboundService:async request=>{sent.push({url:request.url,auth:request.headers.get('Authorization'),body:await request.json()});return new Response(null,{status:fail?500:204});}}));
 t.after(()=>mf.dispose());
 const read=async(r,status=200)=>{const text=await r.text();assert.equal(r.status,status,`${r.status} ${text}`);return text?JSON.parse(text):null;};
 const person=async name=>{
  const login=await mf.dispatchFetch(origin+'/api/session',{method:'POST',body:JSON.stringify({name,password:'question-test'}),headers:{'Content-Type':'application/json',Origin:origin}});await read(login);
  let cookie=login.headers.get('Set-Cookie').split(';')[0];
  const call=(path,method='GET',body)=>mf.dispatchFetch(origin+'/api'+path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin}});
  const admin=async()=>{const r=await call('/admin','POST',{password:'admin-secret-1'});await read(r);cookie+='; '+r.headers.get('Set-Cookie').split(';')[0];};
  return {call,admin};
 };
 return {mf,read,person,sent};
}

test('questions: worker asks, Discord is notified, admin answers, worker sees only own',{timeout:90000},async t=>{
 const {read,person,sent}=await fixture(t);
 const asker=await person('김집사'),other=await person('이권사'),owner=await person('관리자');
 const asked=(await read(await asker.call('/questions','POST',{body:'  재생목록은 어떻게\r\n저장하나요? @everyone '}),201)).question;
 assert.deepEqual([asked.author,asked.body,asked.notified,asked.answer],['김집사','재생목록은 어떻게\n저장하나요? @everyone',true,null]);
 assert.equal(sent.length,1);assert.equal(sent[0].url,hook);
 assert.match(sent[0].body.content,/김집사\n재생목록은 어떻게\n저장하나요\?/);assert.match(sent[0].body.content,/https:\/\/example\.test\/#qa$/);
 assert.deepEqual(sent[0].body.allowed_mentions,{parse:[]});
 // 다른 작업자는 남의 질문을 못 보고, 답할 수 없다.
 assert.deepEqual((await read(await other.call('/questions'))).questions,[]);
 assert.equal((await other.call(`/questions/${asked.id}`,'POST',{answer:'x'})).status,403);
 // 관리자는 전체를 보고 답한다.
 await owner.admin();
 const all=await read(await owner.call('/questions'));assert.equal(all.admin,true);assert.deepEqual(all.questions.map(q=>q.id),[asked.id]);
 assert.equal((await owner.call(`/questions/${asked.id}`,'POST',{answer:'   '})).status,400);
 const answered=(await read(await owner.call(`/questions/${asked.id}`,'POST',{answer:'오른쪽 위 저장을 누르세요.'}))).question;
 assert.deepEqual([answered.answer,answered.answeredBy],['오른쪽 위 저장을 누르세요.','관리자']);
 const mine=await read(await asker.call('/questions'));assert.equal(mine.admin,false);
 assert.equal(mine.questions[0].answer,'오른쪽 위 저장을 누르세요.');
 assert.equal((await owner.call(`/questions/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`,'POST',{answer:'x'})).status,404);
 // 입력 검사: 빈 글·너무 긴 글·다른 사이트 요청.
 assert.equal((await asker.call('/questions','POST',{body:''})).status,400);
 assert.equal((await asker.call('/questions','POST',{body:'가'.repeat(2001)})).status,413);
 // 삭제는 관리자만.
 assert.equal((await asker.call(`/questions/${asked.id}`,'DELETE')).status,403);
 await read(await owner.call(`/questions/${asked.id}`,'DELETE'));
 assert.deepEqual((await read(await asker.call('/questions'))).questions,[]);
});

test('questions: saved even when Discord fails or is not set, open questions are capped',{timeout:90000},async t=>{
 const {read,person,sent}=await fixture(t,{fail:true});
 const asker=await person('박성도');
 const q=(await read(await asker.call('/questions','POST',{body:'알림 실패해도 남나요?'}),201)).question;
 assert.equal(q.notified,false);assert.equal(sent.length,1);
 for(let i=1;i<10;i++)await read(await asker.call('/questions','POST',{body:'질문 '+i}),201);
 assert.equal((await asker.call('/questions','POST',{body:'열한 번째'})).status,429);
 assert.equal((await read(await asker.call('/questions'))).questions.length,10);
});

test('questions: without webhook secret nothing is sent',{timeout:90000},async t=>{
 const {read,person,sent}=await fixture(t,{webhook:null});
 const q=(await read(await (await person('최')).call('/questions','POST',{body:'웹훅 없음'}),201)).question;
 assert.equal(q.notified,false);assert.equal(sent.length,0);
});

test('questions: Discord bot posts an answer button, signed interactions save the answer',{timeout:90000},async t=>{
 const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
 const hex=b=>Buffer.from(b).toString('hex'),publicKey=hex(await crypto.subtle.exportKey('raw',keys.publicKey));
 const {mf,read,person,sent}=await fixture(t,{extra:{DISCORD_BOT_TOKEN:'bot-token',DISCORD_CHANNEL_ID:'123456789012',DISCORD_PUBLIC_KEY:publicKey,DISCORD_ANSWER_USERS:'42, 77'}});
 const asker=await person('김집사');
 const q=(await read(await asker.call('/questions','POST',{body:'찬양 순서는 어떻게 바꾸나요?'}),201)).question;
 // 봇이 있으면 웹훅 대신 봇으로, 단추를 달아 보낸다.
 assert.equal(sent.length,1);assert.equal(sent[0].url,'https://discord.com/api/v10/channels/123456789012/messages');assert.equal(sent[0].auth,'Bot bot-token');
 assert.equal(sent[0].body.components[0].components[0].custom_id,'qa:answer:'+q.id);assert.equal(sent[0].body.components[0].components[1].url,'https://example.test/#qa');assert.deepEqual(sent[0].body.allowed_mentions,{parse:[]});
 const interact=async(body,sign=true)=>{const raw=JSON.stringify(body),ts=String(Math.floor(Date.now()/1000));
  const sig=sign?hex(await crypto.subtle.sign({name:'Ed25519'},keys.privateKey,new TextEncoder().encode(ts+raw))):'0'.repeat(128);
  return mf.dispatchFetch(origin+'/api/discord/interactions',{method:'POST',body:raw,headers:{'Content-Type':'application/json','X-Signature-Ed25519':sig,'X-Signature-Timestamp':ts}});};
 assert.equal((await interact({type:1},false)).status,401);
 assert.deepEqual(await read(await interact({type:1})),{type:1});
 const member={user:{id:'42',username:'grace',global_name:'은혜'}};
 // 허용 목록 밖의 사람은 못 단다.
 assert.match((await read(await interact({type:3,member:{user:{id:'9'}},data:{custom_id:'qa:answer:'+q.id}}))).data.content,/권한/);
 const modal=await read(await interact({type:3,member,data:{custom_id:'qa:answer:'+q.id},message:{id:'1'}}));
 assert.equal(modal.type,9);assert.equal(modal.data.custom_id,'qa:modal:'+q.id);assert.equal(modal.data.components[0].components[0].value,undefined);
 const done=await read(await interact({type:5,member,message:{id:'1'},data:{custom_id:'qa:modal:'+q.id,components:[{type:1,components:[{type:4,custom_id:'answer',value:' 순서 창에서 끌어 옮기세요. '}]}]}}));
 assert.equal(done.type,7);assert.match(done.data.content,/\*\*답변\*\* · 은혜\n순서 창에서 끌어 옮기세요\.$/);assert.equal(done.data.components[0].components[0].label,'답변 고치기');
 const mine=(await read(await asker.call('/questions'))).questions[0];assert.deepEqual([mine.answer,mine.answeredBy],['순서 창에서 끌어 옮기세요.','은혜']);
 // 다시 누르면 지난 답이 채워진다. 빈 답·없는 질문은 안내만.
 assert.equal((await read(await interact({type:3,member,data:{custom_id:'qa:answer:'+q.id}}))).data.components[0].components[0].value,'순서 창에서 끌어 옮기세요.');
 assert.match((await read(await interact({type:5,member,data:{custom_id:'qa:modal:'+q.id,components:[{type:1,components:[{custom_id:'answer',value:'  '}]}]}}))).data.content,/입력/);
 assert.match((await read(await interact({type:3,member,data:{custom_id:'qa:answer:00000000-0000-0000-0000-000000000000'}}))).data.content,/찾지 못/);
});
