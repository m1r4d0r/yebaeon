import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

// Deterministic async IDB adapter for exercising the app's transaction ordering.
// Real browser persistence still depends on browser settings and available quota.
function indexedDBFixture() {
  const records=new Map(); let fail=false;
  const connection={createObjectStore(){},close(){},transaction(){
    let pending=0,tx={error:null},aborted=false;
    const request=(action)=>{
      pending++;const listeners=[];const req={addEventListener(_,fn){listeners.push(fn);}};
      setImmediate(()=>{
        if(fail){aborted=true;tx.error=new Error('quota exceeded');tx.onabort?.();return;}
        req.result=action();req.onsuccess?.();listeners.forEach(fn=>fn());pending--;
        setImmediate(()=>{if(!pending&&!aborted)tx.oncomplete?.();});
      });return req;
    };
    tx.objectStore=()=>({put:value=>request(()=>{records.set(value.id,structuredClone(value));return value.id;}),delete:id=>request(()=>records.delete(id)),get:id=>request(()=>structuredClone(records.get(id))),getAll:()=>request(()=>structuredClone([...records.values()]))});return tx;
  }};
  return {api:{open(){const req={result:connection};setImmediate(()=>req.onsuccess());return req;}},fail:value=>{fail=value;}};
}
function element(){return {textContent:'',value:'name',children:[],append(...els){this.children.push(...els);},replaceChildren(){this.children=[];},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}};}
async function setup(){
  const fixture=indexedDBFixture(),elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(){}};
  const window=new EventTarget();const context=vm.createContext({window,document,indexedDB:fixture.api,crypto:webcrypto,structuredClone,Date,Promise,Error,console,setTimeout,Blob,URL,confirm:()=>true});
  vm.runInContext(await readFile('web-editor/drafts.js','utf8'),context);
  return {fixture,context,window,document,drafts:window.YebaeonDrafts};
}
test('drafts snapshot content and preserve newer edits when an older save completes',async()=>{
  const {drafts}=await setup(),id=drafts.id();
  const record={id,kind:'document',serial:1,xml:'edit 1',base:{version:1},baseXML:'original'};
  const first=drafts.put(record);record.xml='changed after enqueue';await first;
  assert.equal((await drafts.all())[0].xml,'edit 1');
  await drafts.put({...record,serial:2,xml:'edit 2'});
  await drafts.settle(id,1,{version:2},'edit 1');
  let saved=(await drafts.all())[0];assert.equal(saved.xml,'edit 2');assert.equal(saved.base.version,2);assert.equal(saved.baseXML,'edit 1');
  await drafts.settle(id,2,{version:3},'edit 2');assert.equal((await drafts.all()).length,0);
});
test('separate tabs keep independent drafts and failed writes are not acknowledged',async()=>{
  const a=await setup(),b=await setup();assert.notEqual(a.drafts.id().split('/')[0],b.drafts.id().split('/')[0]);
  a.fixture.fail(true);await assert.rejects(a.drafts.put({id:a.drafts.id(),xml:'unsaved'}),/quota/);
  a.fixture.fail(false);await a.drafts.put({id:a.drafts.id(),xml:'retry'});assert.equal((await a.drafts.all())[0].xml,'retry');
});
async function cloudSetup(){
  const app=await setup();let current={xml:'base',name:'song.pro6',serial:0,dirty:false},pending=[],serverVersion=1;
  const metadata=()=>({id:'11111111-1111-4111-a111-111111111111',name:'song.pro6',path:'song.pro6',version:serverVersion,updatedBy:'tester',updatedAt:new Date().toISOString(),sha256:'cae662172fd450bb0cd710a769079c05bfc5d8e35efa6576edc7d0377afdd4a2'});
  app.window.YebaeonEditor={state:()=>({...current}),document:()=>({...current}),status(){},hasPackageMedia:()=>false,markSaved(serial){if(serial===current.serial)current.dirty=false;},markDirty(){current.dirty=true;current.serial++;app.window.dispatchEvent(new Event('yebaeonchange'));},open(xml,name){app.window.dispatchEvent(new Event('yebaeonbeforeopen'));current={xml,name,serial:current.serial+1,dirty:false};app.window.dispatchEvent(new Event('yebaeonopen'));return true;}};
  app.window.YebaeonPlaylists={async show(){}};
  Object.assign(app.context,{location:{protocol:'https:'},localStorage:{getItem(){return null;},setItem(){}},queueMicrotask,Event,CustomEvent,TextDecoder,URLSearchParams,fetch:async(path,options={})=>{
    if(path==='/api/session')return Response.json({ready:true,authenticated:true,name:'tester'});
    if(options.method==='PUT')return new Promise(resolve=>pending.push({options,resolve}));
    if(path.includes('/content'))return new Response('base');
    return Response.json({document:metadata()});
  }});
  vm.runInContext(await readFile('web-editor/cloud.js','utf8'),app.context);
  for(let i=0;i<5;i++)await new Promise(setImmediate);
  assert.equal(await app.window.YebaeonCloud.openDocument(metadata().id),true);
  return {...app,pending,edit(xml){current.xml=xml;app.window.YebaeonEditor.markDirty();},async saving(){const promise=app.document.getElementById('cloudSave').onclick();for(let i=0;i<20&&!pending.length;i++)await new Promise(setImmediate);assert.ok(pending.length);return {promise};},finish(status=200){const request=pending.shift();serverVersion++;request.resolve(Response.json(status===200 ? {document:metadata()} : {message:'conflict',error:'version_conflict'},{status}));}};
}
test('document save rebases edits made during the request and conflicts preserve draft',async()=>{
  const app=await cloudSetup();app.edit('edit one');const {promise}=await app.saving();
  app.edit('edit two');app.finish();await promise;
  let records=await app.drafts.all();assert.equal(records.length,1);assert.equal(records[0].xml,'edit two');assert.equal(records[0].base.version,2);assert.equal(records[0].baseXML,'edit one');
  const next=await app.saving();app.finish(409);await next.promise;
  records=await app.drafts.all();assert.equal(records[0].xml,'edit two');assert.equal(records[0].base.version,2);
});
test('switching documents while a save is in flight does not delete later edits to the old draft',async()=>{
  const app=await cloudSetup();app.edit('edit one');const {promise}=await app.saving();app.edit('edit two');
  app.window.YebaeonEditor.open('other','other.pro6');app.finish();await promise;
  const records=await app.drafts.all();assert.equal(records.length,1);assert.equal(records[0].xml,'edit two');assert.equal(records[0].base.version,2);assert.equal(records[0].baseXML,'edit one');
});
test('changing worker session leaves the previous worker draft under a separate ID',async()=>{
  const app=await cloudSetup();app.edit('before logout');
  await app.document.getElementById('accountLogout').onclick();app.edit('after logout');
  const records=await app.drafts.all();assert.equal(records.length,2);assert.ok(records.some(x=>x.xml==='before logout' && x.author==='tester'));assert.ok(records.some(x=>x.xml==='after logout'));
});
