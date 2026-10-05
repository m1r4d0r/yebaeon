(function(){'use strict';
 // 교회 Mac 현황과 원격 지원(sync.md 13.6).
 // 계정 메뉴의 [교회 Mac] 줄: Mac이 마지막으로 올린 현황 요약. 누르면 현황 창이 열린다.
 // 원격 지원 시간(Mac 앞에서 [원격 지원]을 눌렀을 때)에는 관리자가 Mac 창·정리 창과 같은 버튼을 여기서 누를 수 있다.
 // Mac이 다음 확인(지원 중 10초 안팎) 때 가져가 실행하고 결과를 보고한다.
 const $=id=>document.getElementById(id),C=YebaeonCloud;
 const when=at=>at?new Date(at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}):'';
 const minutesLeft=until=>Math.max(0,Math.ceil((Date.parse(until)-Date.now())/60000));
 function el(tag,props={},...children){const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(v!==undefined&&v!==null&&v!==false)node[k]=v;}for(const c of children.flat())if(c!==null&&c!==undefined&&c!==false)node.append(c);return node;}
 // Mac 창의 버튼 이름과 같다.
 const ORGANIZER={server:'서버 것 받기',mac:'Mac 것 올리기',number:'둘 다 두기',trash:'서버 휴지통으로',image:'이미지 받기',import:'그림 가져오기',removeNumbered:'번호 사본 지우기'};
 const FORCE={server:'서버 것 받기',mac:'Mac 것 올리기',trashServer:'서버 휴지통으로',trashMac:'Mac에서 지우기'};
 const STATE={pending:'기다림',taken:'Mac이 실행 중',done:'완료',failed:'실패',rejected:'하지 않음',expired:'만료'};
 const describe=c=>c.action==='check'?'다시 비교':c.action==='fullCheck'?'전체 확인':c.action==='undo'?'마지막 적용 되돌리기':c.action==='apply'?`적용 · ${(c.args.nodes||[]).join(', ')}`:c.action==='organizer'?`정리 · ${ORGANIZER[c.args.do]||c.args.do} · ${c.args.path}`:c.action==='force'?`강제 · ${FORCE[c.args.do]||c.args.do} · ${c.args.path}`:c.action==='message'?`안내 · ${c.args.text}`:c.action;

 let devices=[],chosen=null,commands=[],timer=null,head=0,note='';
 const say=text=>{note=text;const target=$('macMessage');if(target)target.textContent=text;};
 const device=()=>devices.find(d=>d.id===chosen)||devices[0]||null;
 const supporting=()=>!!device()?.supportUntil&&Date.parse(device().supportUntil)>Date.now();

 // 계정 메뉴의 한 줄: 교회 Mac · 요약(· 원격 지원 중). 마우스를 올리면 보고 시각 등.
 function line(){
  const target=$('macStatus'),d=device();if(!target)return;
  target.hidden=!d;if(!d)return;
  const s=d.status,short=[d.name,s?(s.summary||'모두 같음'):(d.pending?.length?'대기 '+d.pending.length:'적용 기록 '+(d.appliedAt?when(d.appliedAt):'없음'))],full=[...short];
  if(s?.presenter)full.push('PP6 실행 중');
  full.push(s?'보고 '+when(d.statusAt):'현황 보고 없음');
  if(head>d.appliedSeq)full.push('새 변경 있음');
  if(supporting()){short.push('원격 지원 중');full.push('원격 지원 중');}
  target.textContent=short.join(' · ');target.title=full.join(' · ');
 }
 async function load(){
  const data=await(await C.api('/sync/devices')).json();head=data.head||0;
  devices=data.devices.slice().sort((a,b)=>(b.statusAt||b.appliedAt||'').localeCompare(a.statusAt||a.appliedAt||''));
  if(!devices.some(d=>d.id===chosen))chosen=devices[0]?.id||null;
  if($('macDialog').open&&chosen)commands=(await(await C.api(`/sync/devices/${chosen}/commands`)).json()).commands;
  line();
 }
 async function refresh(){try{await load();}catch(_){}}

 // ── 명령 ──
 async function send(action,args,confirmText){
  const d=device();if(!d)return;
  if(confirmText&&!confirm(confirmText+'\n\n교회 Mac이 다음 확인 때 실행합니다. 결과는 아래 기록에 나옵니다.'))return;
  const post=()=>C.api(`/sync/devices/${d.id}/commands`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,args})});
  say('보내는 중…');
  try{
   try{await post();}catch(error){if(error.code!=='admin_required')throw error;if(!await YebaeonLibraryManage.admin()){say('관리자 확인을 취소했습니다.');return;}await post();}
   say('보냈습니다. Mac이 가져가면 기록에 결과가 나옵니다.');
  }catch(error){say(error.message);}
  await refresh();render();
 }
 async function endSupport(){
  const d=device();if(!d||!confirm('원격 지원을 끝낼까요? 아직 Mac이 가져가지 않은 명령은 취소됩니다.'))return;
  const post=()=>C.api(`/sync/devices/${d.id}/support`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({close:true})});
  try{try{await post();}catch(error){if(error.code!=='admin_required')throw error;if(!await YebaeonLibraryManage.admin())return;await post();}say('원격 지원을 끝냈습니다.');}
  catch(error){say(error.message);}
  await refresh();render();
 }

 // ── 현황 창 ──
 function render(){
  const d=device(),body=$('macBody'),on=supporting();body.replaceChildren();
  $('macPick').hidden=devices.length<2;
  $('macPick').replaceChildren(...devices.map(x=>el('option',{value:x.id,textContent:x.name,selected:x.id===chosen})));
  if(!d){body.append(el('p',{class:'dialog-help',textContent:'연결된 교회 Mac이 없습니다. Sync 2에서 입장하면 여기에 나옵니다.'}));return;}
  const s=d.status||{};
  const facts=[s.summary||'현황 보고 없음',s.presenter?'PP6 실행 중':s.presenter===false?'PP6 꺼져 있음':null,s.busy?'작업 중':null,s.build?'빌드 '+s.build:null,s.update?`새 빌드 ${s.update} 설치 대기`:null,d.statusAt?'보고 '+when(d.statusAt):null,s.lastCycleAt?'마지막 확인 '+when(s.lastCycleAt):null,s.fullCheckAt?'전체 확인 '+when(s.fullCheckAt):null].filter(Boolean);
  body.append(el('p',{class:'mac-facts',textContent:facts.join(' · ')}));
  if(s.error)body.append(el('p',{class:'mac-error',textContent:'마지막 오류 · '+s.error}));

  // 지원 칸
  const support=el('div',{class:'mac-support'+(on?' on':'')});
  if(on){
   const text=el('input',{type:'text',maxLength:200,placeholder:'Mac 화면에 띄울 안내 (예: PP6를 닫아 주세요)'});
   support.append(el('strong',{textContent:`원격 지원 중 · ${minutesLeft(d.supportUntil)}분 남음`}),
    el('div',{class:'mac-actions'},
     el('button',{textContent:'다시 비교',onclick:()=>send('check')}),
     el('button',{textContent:'전체 확인',onclick:()=>send('fullCheck')}),
     el('button',{textContent:'마지막 적용 되돌리기',disabled:!s.lastApplyAt,title:s.lastApplyAt?when(s.lastApplyAt)+' 적용':'되돌릴 적용 없음',onclick:()=>send('undo',undefined,'교회 Mac의 마지막 적용을 되돌릴까요? 적용 뒤 다시 바뀐 파일은 건너뜁니다. PP6가 켜져 있으면 Mac이 하지 않습니다.')}),
     el('button',{textContent:'지원 끝내기',onclick:endSupport})),
    el('form',{class:'mac-note',onsubmit:e=>{e.preventDefault();if(text.value.trim())send('message',{text:text.value.trim()}).then(()=>{text.value='';});}},text,el('button',{textContent:'안내 보내기'})));
  }else support.append(el('span',{textContent:'원격 조작은 교회 Mac의 Sync에서 도구 메뉴 › [원격 지원 시작…]을 누르면 30분 동안 열립니다. 관리자 비밀번호가 필요합니다.'}));
  body.append(support,el('p',{id:'macMessage',class:'dialog-message',role:'status',textContent:note}));

  // 예배
  const rows=(s.rows||[]).filter(r=>r.status!=='same');
  body.append(el('h3',{textContent:`예배 · 바뀐 것 ${rows.length}개`+((s.rows||[]).length>rows.length?` (같음 ${(s.rows||[]).length-rows.length}개 숨김)`:'')}));
  if(!rows.length)body.append(el('p',{class:'dialog-help',textContent:s.rows?'모두 같습니다.':'Mac이 아직 비교 결과를 보내지 않았습니다.'}));
  for(const r of rows){
   const docs=on&&r.docs?.length?el('details',{},el('summary',{textContent:`문서 ${r.docs.length}개 · 강제 동작`}),...r.docs.map(doc=>el('div',{class:'mac-doc'},el('span',{textContent:`${doc.path.replace(/\.pro6$/i,'')} (${doc.where})`}),...(doc.actions||[]).map(a=>el('button',{textContent:FORCE[a]||a,onclick:()=>send('force',{path:doc.path,do:a},`강제 동작 · ${FORCE[a]||a}\n${doc.path}\n\nSync가 권하는 동작과 다를 수 있습니다.`)}))))):null;
   body.append(el('div',{class:'mac-row'},
    el('div',{},el('strong',{textContent:r.name}),el('small',{textContent:r.text||''}),r.detail?el('small',{class:'mac-detail',textContent:r.detail}):null,docs),
    on&&r.applicable?el('button',{class:'primary',textContent:r.changesMac?'적용':'올리기',title:r.changesMac?'Mac 파일이 바뀝니다. PP6가 켜져 있으면 Mac이 하지 않습니다.':'서버에 올립니다.',onclick:()=>send('apply',{nodes:[r.node]},`‘${r.name}’ ${r.changesMac?'적용(받기·올리기)':'올리기'}를 할까요?`)}):null));
  }

  // 정리 창
  const review=s.review||[];
  body.append(el('h3',{textContent:`정리 창 · ${review.length}개`}));
  if(!review.length)body.append(el('p',{class:'dialog-help',textContent:'정리할 것이 없습니다.'}));
  for(const item of review)body.append(el('div',{class:'mac-row'},
   el('div',{},el('strong',{textContent:item.title}),el('small',{textContent:`${item.list} · ${item.detail||''}`})),
   on?el('div',{class:'mac-actions'},...(item.actions||[]).map(a=>el('button',{textContent:ORGANIZER[a]||a,onclick:()=>send('organizer',{path:item.path,do:a},`${ORGANIZER[a]||a}\n${item.title}`)}))):null));

  // 기록
  if(s.log?.length)body.append(el('details',{},el('summary',{textContent:'Mac 최근 기록'}),el('pre',{class:'mac-log',textContent:s.log.join('\n')})));
  body.append(el('h3',{textContent:'원격 명령 기록'}));
  if(!commands.length)body.append(el('p',{class:'dialog-help',textContent:'아직 없습니다.'}));
  for(const c of commands)body.append(el('div',{class:'mac-command'},el('span',{textContent:`${when(c.createdAt)} · ${c.author} · ${describe(c)}`}),el('strong',{class:'state-'+c.state,textContent:STATE[c.state]||c.state}),c.result?el('small',{textContent:c.result}):null));
 }
 function schedule(){clearTimeout(timer);if(!$('macDialog').open)return;timer=setTimeout(async()=>{await refresh();render();schedule();},supporting()?5000:60000);}
 async function open(){
  note='';
  $('macDialog').showModal();$('macBody').replaceChildren(el('p',{class:'dialog-help',textContent:'불러오는 중…'}));
  try{await load();}catch(error){$('macBody').replaceChildren(el('p',{class:'dialog-message',textContent:error.message}));return;}
  render();schedule();
 }
 $('macStatus')?.addEventListener('click',()=>{$('accountMenu').hidden=true;$('cloudAccount').setAttribute('aria-expanded','false');open();});
 $('macClose')?.addEventListener('click',()=>$('macDialog').close());
 $('macRefresh')?.addEventListener('click',async()=>{await refresh();render();});
 $('macPick')?.addEventListener('change',async e=>{chosen=e.target.value;await refresh();render();});
 $('macDialog')?.addEventListener('close',()=>clearTimeout(timer));
 window.YebaeonMacRemote={refresh,open};
})();
