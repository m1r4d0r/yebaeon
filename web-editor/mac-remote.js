(function(){'use strict';
 // 교회 Mac 현황과 원격 지원(sync.md 13.6).
 // 작업자 메뉴의 [교회 Mac] 줄: Mac이 마지막으로 올린 현황 요약. 누르면 원격 지원 창이 열린다.
 // 원격 지원은 Mac 앞에서 Sync 2의 도구 › [원격 지원 시작…]을 눌러야 열린다(최대 60분). 그동안 관리자가 Sync 2 본창과 같은 표·오른쪽 클릭 강제 동작·정리 창 버튼을 여기서 누른다.
 // Mac이 다음 확인(지원 중 10초 안팎) 때 가져가 실행하고 결과를 보고한다. 지난 동기화 기록은 서버 현황에서 본다.
 const $=id=>document.getElementById(id),C=YebaeonCloud,P=()=>window.YebaeonPanels;
 const minutesLeft=until=>Math.max(0,Math.ceil((Date.parse(until)-Date.now())/60000));
 function el(tag,props={},...children){const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(k.includes('-')||k==='role')node.setAttribute(k,v);else if(v!==undefined&&v!==null&&v!==false)node[k]=v;}for(const c of children.flat())if(c!==null&&c!==undefined&&c!==false)node.append(c);return node;}
 // Mac 창의 버튼 이름과 같다.
 const ORGANIZER={server:'서버 것 받기',mac:'Mac 것 올리기',number:'둘 다 두기',trash:'서버 휴지통으로',image:'이미지 받기',import:'그림 가져오기',removeNumbered:'번호 사본 지우기'};
 const FORCE={server:'서버 것 받기',mac:'Mac 것 올리기',trashServer:'서버 휴지통으로',trashMac:'Mac에서 지우기'};
 const STATE={pending:'기다림',taken:'Mac이 실행 중',done:'완료',failed:'실패',rejected:'하지 않음',expired:'만료'};
 const describe=c=>c.action==='check'?'다시 비교':c.action==='fullCheck'?'전체 확인':c.action==='undo'?'마지막 적용 되돌리기':c.action==='apply'?`적용 · ${(c.args.nodes||[]).join(', ')}`:c.action==='organizer'?`정리 · ${ORGANIZER[c.args.do]||c.args.do} · ${c.args.path}`:c.action==='force'?`강제 · ${FORCE[c.args.do]||c.args.do} · ${c.args.path}`:c.action==='message'?`안내 · ${c.args.text}`:c.action;

 let devices=[],chosen=null,commands=[],timer=null,head=0,note='';
 const say=text=>{note=text;const target=$('macMessage');if(target)target.textContent=text;};
 const device=()=>devices.find(d=>d.id===chosen)||devices[0]||null;
 const supporting=()=>!!device()?.supportUntil&&Date.parse(device().supportUntil)>Date.now();

 // 작업자 메뉴의 둘째 줄: 요약 · 보고 시각(· 원격 지원 중). 점 색은 같음·바뀐 것 있음·지원 중.
 function line(){
  const target=$('macStatus'),text=$('macStatusLine'),d=device();if(!target)return;
  target.hidden=!d;if(!d)return;
  const s=d.status,parts=[s?(s.summary||'모두 같음'):(d.pending?.length?'대기 '+d.pending.length:'현황 보고 없음')];
  if(d.statusAt)parts.push(P().when(d.statusAt)+' 보고');
  if(supporting())parts.unshift('원격 지원 요청');
  text.textContent=parts.join(' · ');text.dataset.state=supporting()?'support':s&&(s.rows||[]).some(r=>r.status!=='same')?'changes':s?'same':'';
  target.title=[d.name,...parts,s?.presenter?'PP6 실행 중':null,head>d.appliedSeq?'새 변경 있음':null].filter(Boolean).join(' · ');
  target.setAttribute('aria-label','교회 Mac · '+text.textContent);
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

 // ── 원격 지원 창 ──
 let tab='rows',selected=null,reviewOpen=false;const checked=new Map();
 const icon=path=>{const span=el('span');span.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;return span.firstChild;};
 function header(d,s){
  const dot=s.presenter===undefined?'':s.busy?'busy':'ok';
  const facts=[s.presenter?'PP6 실행 중':s.presenter===false?'PP6 꺼져 있음':null,s.busy?'Sync 작업 중':null,s.build?'Sync 빌드 '+s.build:null,s.update?`새 빌드 ${s.update} 설치 대기`:null,d.statusAt?P().when(d.statusAt)+' 보고':'현황 보고 없음'].filter(Boolean);
  return el('div',{class:'mac-line'},el('i',{class:dot}),el('span',{textContent:facts.join(' · ')}),el('a',{href:'/status',target:'_blank',rel:'noopener',textContent:'Sync 기록은 서버 현황에서'}),s.error?el('span',{class:'mac-error',textContent:'마지막 오류 · '+s.error}):null);
 }
 function waiting(){
  const last=commands[0];
  return [el('div',{class:'mac-wait'},icon('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),el('strong',{textContent:'원격 지원 요청이 없습니다'}),
   el('p',{},'교회 Mac의 Sync 2에서 ',el('b',{textContent:'도구 › 원격 지원 시작…'}),'을 누르면 이 창에 예배 비교 표와 명령 버튼이 나타납니다. 지원은 한 번에 최대 60분입니다.')),
   el('div',{class:'mac-last',textContent:last?`마지막 원격 명령 · ${P().when(last.createdAt)} · ${describe(last)} · ${STATE[last.state]||last.state}`:'원격 명령 기록이 없습니다.'})];
 }
 // 강제 동작 메뉴(Sync 2 본창의 오른쪽 클릭과 같다): 예배 → 문서 → 동작.
 let context=null;
 function closeContext(){context?.remove();context=null;}
 function openContext(event,r){
  event.preventDefault();closeContext();selected=r.node;renderTable();
  const docs=r.docs||[],box=el('div',{class:'mac-context',role:'menu'},el('div',{class:'head',textContent:`강제 동작 · ${r.name} (권장과 상관없이 실행)`}),el('hr'));
  if(!docs.length)box.append(el('button',{disabled:true},el('span',{textContent:'이 예배에 문서가 없습니다'})));
  for(const doc of docs){
   const name=doc.path.replace(/\.pro6$/i,''),item=el('div',{style:'position:relative'});
   const open=el('button',{type:'button',role:'menuitem','aria-haspopup':'menu',onclick:()=>{box.querySelectorAll('.sub').forEach(x=>x.remove());item.append(sub());}},el('span',{textContent:name}),el('small',{textContent:doc.where||''}),el('small',{textContent:'›'}));
   const sub=()=>el('div',{class:'mac-context sub',role:'menu',style:'top:-6px'},...[['server','서버 것 받기','Mac 파일을 서버 것으로'],['mac','Mac 것 올리기','서버를 Mac 것으로'],null,['trashServer','서버 휴지통으로'],['trashMac','Mac에서 지우기','macOS 휴지통']].map(x=>x?el('button',{type:'button',role:'menuitem',class:x[0].startsWith('trash')?'danger':'',disabled:!(doc.actions||[]).includes(x[0]),onclick:()=>{closeContext();send('force',{path:doc.path,do:x[0]},`강제 동작 · ${x[1]}\n${doc.path}\n\nSync가 권하는 동작과 다를 수 있습니다.`);}},el('span',{textContent:x[1]}),x[2]?el('small',{textContent:x[2]}):null):el('hr')));
   item.append(open);box.append(item);
  }
  $('macDialog').append(box);
  const x=Math.min(event.clientX,innerWidth-310),y=Math.min(event.clientY,innerHeight-box.offsetHeight-8);box.style.left=x+'px';box.style.top=Math.max(8,y)+'px';context=box;
  box.querySelector('button:not(:disabled)')?.focus();
 }
 document.addEventListener('pointerdown',e=>{if(context&&!context.contains(e.target))closeContext();},true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&context){e.preventDefault();e.stopPropagation();closeContext();}},true);
 const statusClass=r=>r.status==='same'?'same':r.status==='hold'?'hold':r.applicable?'go':'same';
 function renderTable(){
  const s=device()?.status||{},rows=s.rows||[],table=$('macTable'),detail=$('macDetail');if(!table)return;
  table.replaceChildren(el('div',{class:'tr head'},el('span',{textContent:'적용'}),el('span',{textContent:'예배'}),el('span',{textContent:'바뀐 것'}),el('span',{textContent:'서버 저장'})));
  for(const r of rows){
   const box=el('input',{type:'checkbox',checked:!!checked.get(r.node),disabled:!r.applicable,'aria-label':r.name+' 적용',onchange:e=>{checked.set(r.node,e.target.checked);renderBottom();},onclick:e=>e.stopPropagation()});
   table.append(el('div',{class:'tr'+(selected===r.node?' sel':''),onclick:()=>{selected=r.node;renderTable();},oncontextmenu:e=>openContext(e,r)},
    el('span',{},box),el('span',{class:'nm',textContent:r.name,title:r.name}),el('span',{class:statusClass(r),textContent:r.text||(r.status==='same'?'같음':''),title:r.text||''}),el('span',{class:'when',textContent:r.updatedAt?`${r.updatedBy||''} · ${P().when(r.updatedAt)}`:''})));
  }
  if(!rows.length)table.append(el('p',{class:'line-empty',textContent:'Mac이 아직 비교 결과를 보내지 않았습니다.'}));
  const pick=rows.find(r=>r.node===selected);detail.textContent=pick?(pick.detail||pick.text||'같음'):'줄을 누르면 할 일과 문서 이름이 여기에 나옵니다.';
  renderBottom();
 }
 function renderBottom(){
  const s=device()?.status||{},rows=s.rows||[],picked=rows.filter(r=>r.applicable&&checked.get(r.node)),button=$('macApply');if(!button)return;
  const receive=picked.some(r=>r.changesMac),up=picked.some(r=>!r.changesMac),verb=receive&&up?'받기·올리기':receive?'받기':up?'올리기':'받기·올리기';
  button.textContent=picked.length?`${picked.length}개 ${verb}`:verb;button.disabled=!picked.length;
  const go=rows.filter(r=>r.applicable).length,hold=rows.filter(r=>r.status==='hold').length,same=rows.filter(r=>r.status==='same').length;
  $('macSummary').textContent=[go?`받을·올릴 것 ${go}`:null,hold?`보류 ${hold}`:null,same?`같음 ${same}`:null].filter(Boolean).join(' · ')||s.summary||'';
 }
 function applyChecked(){
  const rows=(device()?.status?.rows||[]).filter(r=>r.applicable&&checked.get(r.node));if(!rows.length)return;
  send('apply',{nodes:rows.map(r=>r.node)},`${rows.map(r=>'‘'+r.name+'’').join(', ')} ${$('macApply').textContent.replace(/^\d+개 /,'')}를 할까요?\nMac 파일을 바꾸는 일은 PP6가 켜져 있으면 Mac이 하지 않습니다.`);
 }
 function render(){
  const d=device(),body=$('macBody'),on=supporting();closeContext();body.replaceChildren();
  $('macPick').hidden=devices.length<2;
  $('macPick').replaceChildren(...devices.map(x=>el('option',{value:x.id,textContent:x.name,selected:x.id===chosen})));
  if(!d){body.append(el('div',{class:'mac-wait'},el('strong',{textContent:'연결된 교회 Mac이 없습니다'}),el('p',{textContent:'Sync 2에서 입장하면 여기에 나옵니다.'})));return;}
  const s=d.status||{};body.append(header(d,s));
  if(!on){body.append(...waiting(),el('p',{id:'macMessage',class:'panel-foot',role:'status',textContent:note}));return;}
  for(const r of s.rows||[])if(!checked.has(r.node))checked.set(r.node,!!r.applicable);
  const text=el('input',{type:'text',maxLength:200,placeholder:'Mac 화면에 띄울 안내 (예: PP6를 닫아 주세요)','aria-label':'Mac에 띄울 안내'});
  body.append(el('div',{class:'mac-support on'},
   el('div',{class:'top'},el('div',{},el('strong',{textContent:`원격 지원 중 · ${minutesLeft(d.supportUntil)}분 남음`}),el('small',{textContent:'Sync 2에서 요청한 지원입니다. 한 번 열면 최대 60분입니다.'})),
    el('button',{type:'button',textContent:'전체 확인',onclick:()=>send('fullCheck')}),
    el('button',{type:'button',textContent:'마지막 적용 되돌리기',disabled:!s.lastApplyAt,title:s.lastApplyAt?P().when(s.lastApplyAt)+' 적용':'되돌릴 적용 없음',onclick:()=>send('undo',undefined,'교회 Mac의 마지막 적용을 되돌릴까요? 적용 뒤 다시 바뀐 파일은 건너뜁니다. PP6가 켜져 있으면 Mac이 하지 않습니다.')}),
    el('button',{type:'button',class:'text-danger',textContent:'지원 끝내기',onclick:endSupport})),
   el('form',{class:'mac-note',onsubmit:e=>{e.preventDefault();if(text.value.trim())send('message',{text:text.value.trim()}).then(()=>{text.value='';});}},text,el('button',{textContent:'안내 보내기'}))));
  const rows=s.rows||[],changed=rows.filter(r=>r.status!=='same').length,review=s.review||[];
  const tabButton=(id,label,count)=>el('button',{type:'button',role:'tab','aria-selected':String(tab===id),onclick:()=>{tab=id;render();}},label,el('span',{textContent:String(count)}));
  body.append(el('div',{class:'mac-tabs',role:'tablist'},tabButton('rows','예배 비교',changed),tabButton('log','명령 기록',commands.length)));
  if(tab==='rows'){
   const pane=el('div',{class:'mac-pane',role:'tabpanel'},
    el('div',{class:'mac-hint'},el('span',{textContent:'줄을 오른쪽 클릭하면 문서별 강제 동작을 고를 수 있습니다.'}),review.length?el('button',{type:'button',textContent:`확인 필요 ${review.length} · 정리 ${reviewOpen?'닫기':'열기'}`,onclick:()=>{reviewOpen=!reviewOpen;render();}}):null),
    el('div',{id:'macTable',class:'mac-table',role:'grid','aria-label':'예배 비교'}));
   if(reviewOpen&&review.length)pane.append(el('div',{class:'mac-table',style:'max-height:200px'},...review.map(item=>el('div',{class:'line-row'},el('span',{class:'line-title',title:item.title,textContent:item.title}),el('span',{class:'line-meta',textContent:`${item.list}${item.detail?' · '+item.detail:''}`}),...(item.actions||[]).map(a=>el('button',{type:'button',class:'line-btn',textContent:ORGANIZER[a]||a,onclick:()=>send('organizer',{path:item.path,do:a},`${ORGANIZER[a]||a}\n${item.title}`)}))))));
   pane.append(el('div',{id:'macDetail',class:'mac-detail'}),
    el('div',{class:'mac-bottom'},el('span',{id:'macSummary'}),el('button',{type:'button',textContent:'다시 비교',onclick:()=>send('check')}),el('button',{type:'button',id:'macApply',class:'primary',onclick:applyChecked})));
   body.append(pane);renderTable();
  }else{
   const list=el('div',{class:'panel-body mac-commands',role:'tabpanel'});
   if(!commands.length)list.append(el('p',{class:'line-empty',textContent:'아직 없습니다.'}));
   for(const c of commands)list.append(el('div',{class:'line-row mac-command'},el('span',{class:'line-title',title:c.result||'',textContent:describe(c)}),el('span',{class:'line-meta',textContent:`${P().when(c.createdAt)} · ${c.author}`}),el('span',{class:'mac-state state-'+c.state,textContent:STATE[c.state]||c.state}),c.result?el('small',{class:'line-meta',style:'flex-basis:100%;white-space:normal',textContent:c.result}):null));
   body.append(list);
  }
  if(s.log?.length)body.append(el('details',{class:'mac-log-box'},el('summary',{textContent:'Mac 최근 기록 보기'}),el('pre',{textContent:s.log.join('\n')})));
  body.append(el('p',{id:'macMessage',class:'panel-foot',role:'status',textContent:note}));
 }
 function schedule(){clearTimeout(timer);if(!$('macDialog').open)return;timer=setTimeout(async()=>{await refresh();render();schedule();},supporting()?5000:60000);}
 async function open(){
  note='';
  $('macDialog').showModal();$('macBody').replaceChildren(el('p',{class:'dialog-help',textContent:'불러오는 중…'}));
  try{await load();}catch(error){$('macBody').replaceChildren(el('p',{class:'dialog-message',textContent:error.message}));return;}
  render();schedule();
 }
 $('macStatus')?.addEventListener('click',()=>{P().hideAccount();open();});
 $('macClose')?.addEventListener('click',()=>$('macDialog').close());
 $('macRefresh')?.addEventListener('click',async()=>{await refresh();render();});
 $('macPick')?.addEventListener('change',async e=>{chosen=e.target.value;await refresh();render();});
 $('macDialog')?.addEventListener('close',()=>{clearTimeout(timer);closeContext();});
 window.YebaeonMacRemote={refresh,open};
})();
