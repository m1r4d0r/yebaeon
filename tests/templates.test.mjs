import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const slide=text=>`<RVDisplaySlide UUID="A" label="${text}"><array rvXMLIvarName="cues" /><array rvXMLIvarName="displayElements" /></RVDisplaySlide>`;
const item=(label,extra={})=>({label,width:1920,height:1080,format:'f'.repeat(64),xml:slide(label),...extra});
test('site templates: save a group, list without XML, read, rename, delete',{timeout:90000},async t=>{
  const bundled=await build({entryPoints:['cloudflare/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-28',bindings:{SITE_PASSWORD:'template-test'},d1Databases:['DB'],r2Buckets:['FILES'],cf:false}));
  t.after(()=>mf.dispose());
  const origin='https://example.test';let cookie='';
  const call=(path,method='GET',body,extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,body,headers:{Cookie:cookie,...method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'},...extra}});
  const ok=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  assert.equal((await call('/templates')).status,401,'login first');
  const login=await call('/session','POST',JSON.stringify({name:'시험',password:'template-test'}));await ok(login);cookie=login.headers.get('Set-Cookie').split(';')[0];
  assert.deepEqual((await ok(await call('/templates'))).templates,[]);
  const saved=(await ok(await call('/templates','POST',JSON.stringify({group:'  블레싱 ',items:[item('제목'),item('본문')]})),201)).templates;
  assert.deepEqual(saved.map(x=>[x.group,x.label,x.position,x.updatedBy]),[['블레싱','제목',0,'시험'],['블레싱','본문',1,'시험']]);
  assert.equal(saved[0].xml,undefined,'the list leaves the slide XML out');
  const more=(await ok(await call('/templates','POST',JSON.stringify({group:'블레싱',items:[item('끝')]})),201)).templates;
  assert.deepEqual(more.map(x=>x.position),[0,1,2],'new slides go to the end of the group');
  await ok(await call('/templates','POST',JSON.stringify({group:'광고 2',items:[item('')]})),201);
  for(const bad of [{group:'a/b',items:[item('x')]},{group:'.숨김',items:[item('x')]},{group:'',items:[item('x')]},{group:'g',items:[]},{group:'g',items:[item('x',{xml:'<RVPresentationDocument/>'})]},{group:'g',items:[item('x',{format:'zz'})]},{group:'g',items:[item('x',{width:0})]}])
   assert.equal((await call('/templates','POST',JSON.stringify(bad))).status,400,JSON.stringify(bad).slice(0,60));
  assert.equal((await call('/templates','POST',JSON.stringify({group:'g',items:[item('x')]}),{Origin:'https://other.test'})).status,403);
  const read=(await ok(await call('/templates/'+saved[1].id))).template;assert.equal(read.xml,slide('본문'));assert.equal(read.label,'본문');
  assert.equal((await ok(await call('/templates/'+saved[1].id,'PATCH',JSON.stringify({label:'설교 본문'})))).template.label,'설교 본문');
  assert.equal((await call('/templates','PATCH',JSON.stringify({group:'블레싱',rename:'광고 2'}))).status,409,'a group name cannot be taken twice');
  assert.equal((await ok(await call('/templates','PATCH',JSON.stringify({group:'블레싱',rename:'블레싱 데이'})))).group,'블레싱 데이');
  let list=(await ok(await call('/templates'))).templates;assert.deepEqual(list.map(x=>[x.group,x.label]),[['광고 2',''],['블레싱 데이','제목'],['블레싱 데이','설교 본문'],['블레싱 데이','끝']]);
  await ok(await call('/templates/'+saved[0].id,'DELETE'));assert.equal((await call('/templates/'+saved[0].id)).status,404);assert.equal((await call('/templates/'+saved[0].id,'DELETE')).status,404);
  assert.equal((await ok(await call('/templates?group='+encodeURIComponent('블레싱 데이'),'DELETE'))).deleted,2);
  list=(await ok(await call('/templates'))).templates;assert.deepEqual(list.map(x=>x.group),['광고 2']);
});
