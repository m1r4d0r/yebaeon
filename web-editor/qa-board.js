(function(){'use strict';
 // 질문·답변 모아보기(관리자). 작업자 메뉴 › 관리의 [질문·답변]과 설정·관리 창에서 연다.
 // 답 대기/전체를 고르고, 질문마다 질문자·환경(Mac/PC·브라우저·창 크기·열린 문서)·시각을 보며 그 자리에서 답하거나 고친다.
 // 서버 조회: 열 때·탭을 바꿀 때 한 번(최근 60개), [더 보기]를 누를 때 이어서. 자동 반복 조회는 없다.
 const $=id=>document.getElementById(id),C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels;
 const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let dialog=null,filter='open',items=[],next=null;
 const say=text=>{const t=$('qaBoardMessage');if(t)t.textContent=text;};

 // 작업자 메뉴 › 관리 줄. 관리자 확인 뒤에 연다.
 const menu=document.createElement('button');menu.id='qaBoardOpen';menu.type='button';menu.setAttribute('role','menuitem');
 menu.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg><span>질문·답변</span><span class="admin-chip">관리자</span>';
 menu.onclick=()=>{P()?.hideAccount();open();};
 $('accountAdmin')?.append(menu);

 function frame(){
  if(dialog)return dialog;
  const {el}=P();
  dialog=el('dialog',{class:'library-dialog panel-dialog qa-board',id:'qaBoard','aria-labelledby':'qaBoardTitle'});
  const close=el('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>dialog.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const tab=(value,label)=>el('button',{type:'button','data-filter':value,role:'tab',onclick:()=>{filter=value;load();}},label);
  dialog.append(el('div',{class:'panel-head'},el('h2',{id:'qaBoardTitle'},'질문·답변'),el('span',{class:'admin-chip'},'관리자'),el('span',{class:'panel-gap'}),close),
   el('div',{class:'qa-board-tabs',role:'tablist'},tab('open','답 대기'),tab('all','전체'),el('span',{class:'qa-board-count',id:'qaBoardCount'})),
   el('div',{id:'qaBoardBody',class:'panel-body qa-board-body'}),el('p',{id:'qaBoardMessage',class:'panel-foot',role:'status'}));
  document.body.append(dialog);return dialog;
 }
 function card(q){
  const {el,when}=P();
  const area=el('textarea',{class:'qa-input',rows:2,maxLength:2000,value:q.answer||'',placeholder:'답변','aria-label':`${q.author}님 질문에 답변`});
  const save=el('button',{type:'submit',class:'qa-send'},q.answer?'고치기':'답하기');
  const remove=el('button',{type:'button',class:'qa-remove'},'지우기');
  const form=el('form',{class:'qa-answer-form'},area,el('div',{class:'qa-actions'},q.answer?el('span',{class:'qa-board-by'},[q.answeredBy,q.answeredAt?when(q.answeredAt):''].filter(Boolean).join(' · ')+' 답변'):null,remove,save));
  area.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();form.requestSubmit();}});
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;
   try{const {question}=await(await C().api('/questions/'+q.id,json('POST',{answer:area.value}))).json();Object.assign(q,question);say(`${q.author}님 질문에 답했습니다.`);render();window.YebaeonQA?.refresh();}
   catch(error){say(error.message);save.disabled=false;}};
  remove.onclick=async()=>{if(!confirm(`${q.author}님의 질문을 지울까요? 되살릴 수 없습니다.`))return;
   try{await C().api('/questions/'+q.id,{method:'DELETE'});items=items.filter(x=>x!==q);say('질문을 지웠습니다.');render();window.YebaeonQA?.refresh();}catch(error){say(error.message);}};
  return el('article',{class:'qa-card'+(q.answer?'':' is-open')},
   el('header',{class:'qa-card-head'},el('strong',{},q.author),el('span',{class:'qa-state'},q.answer?'답함':'답 대기'),el('span',{class:'panel-gap'}),el('time',{dateTime:q.createdAt},when(q.createdAt))),
   q.client?el('p',{class:'qa-client',title:q.client},q.client):null,
   el('p',{class:'qa-card-body'},q.body),form);
 }
 let waiting=0;
 function render(){
  const {el}=P(),body=$('qaBoardBody');
  for(const b of dialog.querySelectorAll('[data-filter]'))b.setAttribute('aria-selected',String(b.dataset.filter===filter));
  const shown=filter==='open'?items.filter(q=>!q.answer):items;
  $('qaBoardCount').textContent=`답 대기 ${waiting}개`;
  body.replaceChildren(...shown.map(card));
  if(!shown.length)body.append(el('p',{class:'line-empty'},filter==='open'?'답을 기다리는 질문이 없습니다.':'아직 질문이 없습니다.'));
  if(next)body.append(el('button',{type:'button',class:'line-btn qa-board-more',onclick:more},'더 보기'));
 }
 async function fetchPage(before){
  const query=new URLSearchParams();if(filter==='open')query.set('open','1');if(before)query.set('before',before);
  const data=await(await C().api('/questions?'+query)).json();
  if(!data.admin)throw new Error('관리자 확인이 끝났습니다. 다시 열어 주세요.');
  waiting=data.waiting||0;next=data.next;return data.questions;
 }
 async function load(){
  say('');$('qaBoardBody').replaceChildren(P().el('p',{class:'line-empty'},'불러오는 중…'));
  try{items=await fetchPage();render();}catch(error){$('qaBoardBody').replaceChildren(P().el('p',{class:'line-empty'},error.message));}
 }
 async function more(e){e.target.disabled=true;try{items.push(...await fetchPage(next));render();}catch(error){say(error.message);e.target.disabled=false;}}
 async function open(view='open'){
  if(!C().needUser())return;
  try{if(!await window.YebaeonAdmin.ensure())return;}catch(error){alert(error.message);return;}
  filter=view;const d=frame();if(!d.open)d.showModal();await load();
 }
 window.YebaeonQABoard={open};
})();
