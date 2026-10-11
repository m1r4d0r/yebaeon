(function(){'use strict';
 // 오른쪽 아래 질문 창. 작업자가 질문을 남기면 서버가 Discord로 알리고, 관리자가 이 창에서 답한다.
 // 작업자는 같은 작업자 이름으로 남긴 질문과 답을, 관리자 확인을 마친 사람은 전체 질문을 본다.
 // 서버 조회: 입장 때 한 번, 창을 열 때 한 번. 답을 기다리는 질문이 있거나 관리자가 창을 열어 둔 동안만 탭이 보일 때 1분마다 다시 읽는다.
 const C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels,M=()=>window.YebaeonLibraryManage;
 const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const SEEN='yebaeon-qa-seen',POLL=60e3;
 function el(tag,props={},...children){const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(k.includes('-')||k==='role')node.setAttribute(k,v);else if(v!==undefined&&v!==null&&v!==false)node[k]=v;}for(const c of children.flat())if(c!==null&&c!==undefined&&c!==false)node.append(c);return node;}
 const when=at=>P()?.when?P().when(at):new Date(at).toLocaleString('ko-KR');
 let state={admin:false,author:'',questions:[]},timer=null,loading=null,signedIn=false;
 let seen=new Set();try{seen=new Set(JSON.parse(localStorage.getItem(SEEN)||'[]'));}catch(_){}
 const saveSeen=()=>{try{localStorage.setItem(SEEN,JSON.stringify([...seen].slice(-200)));}catch(_){}};

 const toggle=el('button',{type:'button',class:'qa-toggle',id:'qaToggle','aria-label':'질문하기','aria-expanded':'false',hidden:true,onclick:()=>panel.hidden?open():close()});
 toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.4C4.8 14.8 3.5 13 3.5 11 3.5 7.1 7.3 4 12 4z"/><circle cx="8.5" cy="11" r=".9" class="qa-dot"/><circle cx="12" cy="11" r=".9" class="qa-dot"/><circle cx="15.5" cy="11" r=".9" class="qa-dot"/></svg><span class="qa-badge" hidden></span>';
 const list=el('div',{class:'qa-list',role:'log','aria-live':'polite'});
 const input=el('textarea',{class:'qa-input',rows:2,maxLength:2000,placeholder:'궁금한 점을 적어 주세요','aria-label':'질문'});
 const send=el('button',{type:'submit',class:'qa-send'},'보내기');
 const note=el('p',{class:'qa-note',role:'status'});
 const adminButton=el('button',{type:'button',class:'qa-admin',onclick:becomeAdmin,title:'관리자 확인 후 전체 질문에 답합니다'},'관리자');
 const form=el('form',{class:'qa-form',onsubmit:ask},input,send);
 const panel=el('section',{class:'qa-panel',id:'qaPanel',hidden:true,'aria-label':'질문하기'},
  el('header',{class:'qa-head'},el('strong',{},'질문하기'),el('span',{class:'qa-who'}),adminButton,el('button',{type:'button',class:'qa-close','aria-label':'닫기',onclick:close},'×')),
  list,note,form);
 document.body.append(panel,toggle);
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}});
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();toggle.focus();}});

 const waiting=()=>state.questions.some(q=>!q.answer);
 const unseen=()=>state.admin?state.questions.filter(q=>!q.answer).length:state.questions.filter(q=>q.answer&&!seen.has(q.id+q.answeredAt)).length;
 function badge(){const n=unseen(),b=toggle.querySelector('.qa-badge');b.hidden=!n;b.textContent=n>9?'9+':String(n);toggle.setAttribute('aria-label',n?`질문하기 · ${state.admin?'답을 기다리는 질문':'새 답변'} ${n}개`:'질문하기');}
 function bubble(kind,text,meta){return el('div',{class:'qa-msg qa-'+kind},el('p',{},text),el('span',{class:'qa-meta'},meta));}
 function answerBox(q){
  const area=el('textarea',{class:'qa-input',rows:2,maxLength:2000,value:q.answer||'',placeholder:'답변','aria-label':`${q.author}님 질문에 답변`});
  const save=el('button',{type:'submit',class:'qa-send'},q.answer?'고치기':'답하기');
  const remove=el('button',{type:'button',class:'qa-remove','aria-label':'질문 지우기',title:'질문 지우기'},'지우기');
  remove.onclick=async()=>{if(!confirm('이 질문을 지울까요?'))return;try{await C().api('/questions/'+q.id,{method:'DELETE'});await load();}catch(error){note.textContent=error.message;}};
  area.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();box.requestSubmit();}});
  const box=el('form',{class:'qa-form qa-answer-form',onsubmit:async e=>{e.preventDefault();save.disabled=true;
   try{await C().api('/questions/'+q.id,json('POST',{answer:area.value}));note.textContent='답변을 저장했습니다.';await load();}
   catch(error){note.textContent=error.message;if(error.code==='admin_required'){state.admin=false;render();}}finally{save.disabled=false;}}},area,el('div',{class:'qa-actions'},remove,save));
  return box;
 }
 function render(){
  panel.classList.toggle('is-admin',state.admin);
  panel.querySelector('.qa-who').textContent=state.admin?'관리자 · 전체 질문':'';
  adminButton.hidden=state.admin;form.hidden=state.admin;
  list.replaceChildren();
  const items=state.questions.slice().reverse();
  if(!items.length)list.append(el('p',{class:'qa-empty'},state.admin?'아직 질문이 없습니다.':'질문을 남기면 담당자에게 알림이 갑니다. 답이 오면 이 창에 표시됩니다.'));
  for(const q of items){
   const thread=el('div',{class:'qa-thread'+(q.answer?'':' is-open')});
   thread.append(bubble('question',q.body,[state.admin?q.author:null,when(q.createdAt)].filter(Boolean).join(' · ')));
   if(state.admin)thread.append(answerBox(q));
   else thread.append(q.answer?bubble('answer',q.answer,[q.answeredBy,when(q.answeredAt)].filter(Boolean).join(' · ')):el('p',{class:'qa-pending'},'답을 기다리는 중'));
   list.append(thread);
  }
  if(!panel.hidden&&!state.admin){for(const q of state.questions)if(q.answer)seen.add(q.id+q.answeredAt);saveSeen();}
  badge();
  if(!panel.hidden&&!state.admin)list.scrollTop=list.scrollHeight;
 }
 async function load(){
  if(!signedIn)return;
  if(loading)return loading;
  loading=(async()=>{try{state=await(await C().api('/questions')).json();render();}catch(error){if(!panel.hidden)note.textContent=error.message;}finally{loading=null;schedule();}})();
  return loading;
 }
 function schedule(){
  clearTimeout(timer);timer=null;
  if(!signedIn)return;
  if(waiting()&&!state.admin||state.admin&&!panel.hidden)timer=setTimeout(()=>{if(document.visibilityState==='visible')load();else schedule();},POLL);
 }
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&timer===null&&signedIn&&(waiting()&&!state.admin||state.admin&&!panel.hidden))load();});

 async function ask(e){
  e.preventDefault();const body=input.value.trim();if(!body)return;
  send.disabled=true;note.textContent='보내는 중…';
  try{const {question}=await(await C().api('/questions',json('POST',{body}))).json();input.value='';state.questions.unshift(question);render();
   note.textContent=question.notified?'질문을 보냈습니다. 답이 오면 여기에 표시됩니다.':'질문을 저장했습니다. 알림 전송은 실패했지만 담당자가 이 창에서 볼 수 있습니다.';schedule();}
  catch(error){note.textContent=error.message;}finally{send.disabled=false;}
 }
 async function becomeAdmin(){
  try{const s=await(await C().api('/admin')).json();if(!s.configured){note.textContent='관리자 비밀번호가 서버에 설정되지 않았습니다.';return;}
   if(!s.admin&&!await M().admin())return;await load();note.textContent='';}
  catch(error){note.textContent=error.message;}
 }
 function open(){panel.hidden=false;toggle.setAttribute('aria-expanded','true');toggle.classList.add('is-open');note.textContent='';render();load();if(!state.admin)input.focus();}
 function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.classList.remove('is-open');schedule();}

 // yebaeonsession은 화면 갱신마다 온다. 입장 여부나 작업자 이름이 바뀔 때만 다시 읽는다.
 let who=null;
 function session(authenticated){
  const name=authenticated?C()?.worker()||'':null;if(authenticated===signedIn&&name===who)return;
  signedIn=authenticated;who=name;toggle.hidden=!authenticated;
  if(!authenticated){close();clearTimeout(timer);timer=null;state={admin:false,author:'',questions:[]};render();return;}
  load().then(()=>{if(/^#qa\b/.test(location.hash)){history.replaceState(null,'',location.pathname+location.search);open();}});
 }
 window.addEventListener('yebaeonsession',e=>session(!!e.detail?.authenticated));
 if(C()?.authenticated())session(true);
 window.YebaeonQA={open,close,refresh:load};
})();
