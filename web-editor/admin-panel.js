(function(){'use strict';
 // 설정·관리 창. 열 때 관리자 확인을 먼저 받는다(하루 유지). 관리자 일만 모은다:
 // 탭 질문(질문·답변) · 휴지통(문서·재생목록) · 그림(고아 이미지·그림 휴지통) · 교회 Mac(보관본) · 설정(카테고리 검색·이력, 누락 검색 자료 점검).
 const $=id=>document.getElementById(id),C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels,M=()=>window.YebaeonLibraryManage;
 const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const stem=path=>(path||'').split('/').pop().replace(/\.pro6$/i,'');
 let dialog=null,expiresAt=null;
 // 누락 검색 자료 점검 단추(관리자 전용)는 cloud.js가 동작을 달아 둔 숨은 단추를 이 창으로 옮겨 보인다.
 const runMaintenance=$('indexMaintenance');

 // 관리자 확인: 이미 확인돼 있으면 묻지 않고, 아니면 비밀번호 창. 취소하면 false.
 async function ensure(){
  try{const state=await(await C().api('/admin')).json();if(!state.configured)throw new Error('관리자 비밀번호가 서버에 설정되지 않았습니다.');if(state.admin){expiresAt=state.expiresAt;return true;}}
  catch(error){if(error.message.includes('설정되지'))throw error;}
  if(!await M().admin())return false;
  try{expiresAt=(await(await C().api('/admin')).json()).expiresAt;}catch(_){expiresAt=null;}
  return true;
 }
 // 탭: 비슷한 것끼리 묶는다. 섹션 틀은 창을 처음 열 때 정한 순서대로 한 번 만들고, 내용만 섹션마다 바꾼다(불러오는 중에도 자리가 그대로).
 const TABS=[['questions','질문'],['trash','휴지통'],['images','그림'],['mac','교회 Mac'],['settings','설정']];
 let tab='questions';
 try{const saved=localStorage.getItem('yebaeon-admin-tab');if(TABS.some(([id])=>id===saved))tab=saved;}catch(_){}
 const sections=new Map();
 function frame(){
  if(dialog)return dialog;
  const {el}=P();
  dialog=el('dialog',{class:'library-dialog panel-dialog admin-dialog',id:'adminPanel','aria-labelledby':'adminPanelTitle'});
  const close=el('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>dialog.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const tabs=el('div',{class:'admin-tabs',role:'tablist','aria-label':'설정·관리'},...TABS.map(([id,label])=>el('button',{type:'button',role:'tab',id:'adminTab-'+id,'data-tab':id,'aria-controls':'adminPane-'+id,onclick:()=>{show(id);}},label,el('span',{class:'admin-tab-count'}))));
  const body=el('div',{id:'adminPanelBody',class:'panel-body admin-body'},...TABS.map(([id])=>el('div',{class:'admin-pane',role:'tabpanel',id:'adminPane-'+id,'aria-labelledby':'adminTab-'+id,hidden:true})));
  dialog.append(el('div',{class:'panel-head'},el('h2',{id:'adminPanelTitle'},'설정·관리'),el('span',{class:'admin-chip'},'관리자'),el('span',{class:'panel-gap'}),close),
   el('div',{class:'admin-state'},el('span',{id:'adminPanelState'}),el('button',{type:'button',class:'text-danger',onclick:signOut},'관리자 확인 끝내기')),
   tabs,body,el('p',{id:'adminPanelMessage',class:'panel-foot',role:'status'}));
  document.body.append(dialog);
  for(const [name,spec] of SECTIONS)section(name,spec);
  return dialog;
 }
 const say=text=>{$('adminPanelMessage').textContent=text;};
 // 섹션 틀: 제목·수·단추 자리·설명·목록. 불러오는 동안에는 지난 내용을 흐리게 두고, 다 불러오면 한 번에 바꾼다.
 function section(name,{tab:pane,title,note,load,noList}){
  const {el}=P(),count=el('span',{class:'admin-count'}),actions=el('span',{class:'admin-actions'}),list=noList?null:el('div',{class:'line-list'},el('p',{class:'line-empty'},'불러오는 중…'));
  const box=el('section',{class:'admin-section','data-section':name},el('div',{class:'admin-section-head'},el('h3',{},title),count,actions),note?el('p',{class:'admin-note'},note):null,list);
  $('adminPane-'+pane).append(box);
  const s={name,tab:pane,box,list,loaded:false,badge:0,load,
   count:n=>{count.textContent=n===null||n===undefined?'':String(n);},
   actions:(...nodes)=>actions.replaceChildren(...nodes),
   fill:(nodes,emptyText)=>list.replaceChildren(...(nodes.length?nodes:[el('p',{class:'line-empty'},emptyText||'없습니다.')]))};
  sections.set(name,s);return s;
 }
 // 섹션 다시 불러오기. 그 탭의 수(배지)도 고친다.
 async function reload(...names){
  await Promise.all(names.map(async name=>{
   const s=sections.get(name);if(!s)return;
   s.box.classList.add('loading');
   try{s.badge=0;await s.load(s);}
   catch(error){s.count(null);s.actions();if(s.list)s.fill([P().el('p',{class:'line-empty'},error.message)]);}
   finally{s.loaded=true;s.box.classList.remove('loading');}
  }));
  for(const [id] of TABS){let n=0;for(const s of sections.values())if(s.tab===id)n+=s.badge||0;const badge=$('adminTab-'+id)?.querySelector('.admin-tab-count');if(badge)badge.textContent=n?String(n):'';}
 }
 const inTab=id=>[...sections.values()].filter(s=>s.tab===id).map(s=>s.name);
 function show(id){
  tab=id;try{localStorage.setItem('yebaeon-admin-tab',id);}catch(_){}
  for(const [each] of TABS){$('adminTab-'+each).setAttribute('aria-selected',String(each===id));$('adminPane-'+each).hidden=each!==id;}
  const todo=inTab(id).filter(name=>!sections.get(name).loaded);
  return todo.length?reload(...todo):Promise.resolve();
 }
 const danger=(text,attrs={})=>P().el('button',{type:'button',class:'line-btn danger-fill',...attrs},text);

 // ── 휴지통 ──
 async function all(path,key){const out=[];let after='';do{const data=await(await C().api(path+(path.includes('?')?'&':'?')+new URLSearchParams({after}))).json();out.push(...data[key]);after=data.next||'';}while(after&&out.length<500);return out;}
 async function purge(kind,label,button,name){
  if(!confirm(`${label}을(를) 비울까요? 비운 항목은 되살릴 수 없습니다.${kind==='documents'?'\n사용 중·보관함 재생목록에 들어 있는 문서는 남깁니다. 휴지통 재생목록만 가리키던 문서를 비우면 그 재생목록은 다시 꺼낼 수 없습니다.':''}`))return;
  button.disabled=true;
  try{let total=0,result,kept=[];do{result=await(await C().api('/admin/trash',json('POST',{kind}))).json();total+=result.purged;kept=result.kept||kept;say(`${label} ${total}개 비움 · 남은 ${result.remaining}개`);}while(result.remaining>0&&result.purged>0);
   await reload(name);say(`${label} ${total}개를 비웠습니다.`+(kept.length?` 사용 중·보관함 재생목록에 들어 있어 남김: ${kept.map(stem).join(', ')}`:''));}
  catch(error){say(error.message);button.disabled=false;}
 }
 async function trashDocs(s){
  const {el,when,kind}=P(),button=danger('비우기');
  const docs=await all('/documents?state=trashed','documents');s.count(docs.length);s.badge=docs.length;button.disabled=!docs.length;button.onclick=()=>purge('documents','문서 휴지통',button,'trashDocs');
  s.actions(button);
  s.fill(docs.map(doc=>{
   const back=el('button',{type:'button',class:'line-btn'},'꺼내기');
   back.onclick=async()=>{back.disabled=true;try{await C().api(`/documents/${doc.id}/state`,json('POST',{action:'untrash'}));say(`‘${stem(doc.path)}’을(를) 꺼냈습니다.`);C().refresh();await reload('trashDocs');}catch(error){say(error.message);back.disabled=false;}};
   return el('div',{class:'line-row'},kind('document'),el('span',{class:'line-title',title:doc.path},stem(doc.path)),el('span',{class:'line-meta'},[doc.stateBy,doc.stateAt?when(doc.stateAt):''].filter(Boolean).join(' · ')),back);
  }),'휴지통이 비어 있습니다.');
 }
 async function trashPlaylists(s){
  const {el,when,kind}=P(),button=danger('비우기');
  const items=await all('/playlists?scope=trashed','archives');s.count(items.length);s.badge=items.length;button.disabled=!items.length;button.onclick=()=>purge('playlists','재생목록 휴지통',button,'trashPlaylists');
  s.actions(el('button',{type:'button',class:'line-btn',onclick:()=>{dialog.close();M().openBins('trashed-playlists');}},'휴지통 창'),button);
  s.fill(items.map(item=>el('div',{class:'line-row'},kind('playlist'),el('span',{class:'line-title',title:item.name},item.name),el('span',{class:'line-meta'},[item.archivedBy,item.archivedAt?when(item.archivedAt):''].filter(Boolean).join(' · ')))),'휴지통이 비어 있습니다.');
 }
 // ── 질문·답변 ── 답을 기다리는 수만 보이고, 목록은 모아보기 창에서 본다.
 async function questions(s){
  const {el}=P();
  const data=await(await C().api('/questions?open=1')).json();s.count(`답 대기 ${data.waiting||0}개`);s.badge=data.waiting||0;
  s.actions(el('button',{type:'button',class:'line-btn',onclick:()=>{dialog.close();window.YebaeonQABoard.open('open');}},'모아 보기'));
 }
 // ── 카테고리 설정(검색·이력) ──
 async function categories(s){
  const {el}=P();
  const list=(await(await C().api('/categories')).json()).categories;s.count(list.length);
  s.fill(list.map(c=>{
   const search=el('input',{type:'checkbox',checked:c.searchEnabled}),history=el('input',{type:'checkbox',checked:c.historyEnabled});
   const save=async()=>{search.disabled=history.disabled=true;try{await C().api('/categories/'+encodeURIComponent(c.name),json('PUT',{searchEnabled:search.checked,historyEnabled:history.checked}));say(`‘${c.name}’ 설정을 바꿨습니다.`);}catch(error){say(error.message);search.checked=c.searchEnabled;history.checked=c.historyEnabled;}finally{search.disabled=history.disabled=false;}};
   search.onchange=history.onchange=save;
   return el('div',{class:'line-row'},el('span',{class:'line-title'},c.name),el('label',{class:'admin-toggle'},search,'검색'),el('label',{class:'admin-toggle'},history,'이력'),el('span',{class:'line-meta'},c.updatedBy?`${c.updatedBy} 변경`:c.createdBy||''));
  }),'카테고리가 없습니다.');
 }
 // ── 고아 이미지 ──
 // 슬라이드에서 가져온 그림(ImportedImages·YebaeOn) 중 어느 문서도 쓰지 않는 것. 휴지통에 넣으면 교회 Mac이 다음 [적용] 때 macOS 휴지통으로 옮긴다.
 // 수천 개여도 목록은 300개씩 보여 주고(더 보기), 고른 것은 500개씩 나눠 보낸다.
 let withImages=false;
 const PAGE=300,SEND=500;
 const size=b=>b>=1024**3?(b/1024**3).toFixed(2)+' GB':(b/1024/1024).toFixed(1)+' MB';
 async function orphans(s){
  const {el,when}=P(),button=danger('고른 것 휴지통으로',{disabled:true});
  const images=el('input',{type:'checkbox',checked:withImages,onchange:()=>{withImages=images.checked;reload('orphans');}});
  const data=await(await C().api('/admin/orphans'+(withImages?'?images=1':''))).json();
  if(data.remaining){
   s.count(null);s.actions(el('label',{class:'admin-toggle'},images,'Images 포함'));
   const run=el('button',{type:'button',class:'line-btn'},'색인 채우기'),text=el('span',{class:'line-title'},`문서 이미지 색인이 ${data.remaining}개 남았습니다. 다 채워야 후보를 계산합니다.`);
   run.onclick=async()=>{run.disabled=true;try{let left=data.remaining;while(left>0){const r=await(await C().api('/admin/orphans',json('POST',{index:true}))).json();if(!r.indexed&&r.remaining)throw Error('색인하지 못한 문서가 있습니다. 다시 눌러 주세요.');left=r.remaining;text.textContent=`색인 중… 남은 문서 ${left}개`;}await reload('orphans');}catch(error){say(error.message);run.disabled=false;}};
   s.fill([el('div',{class:'line-row'},text,run)]);return;
  }
  const list=data.candidates;s.count(list.length?`${list.length}개 · ${size(data.bytes)}`:0);s.badge=list.length;
  const picked=new Set(list.map(r=>r.path)),boxes=new Map();
  const toggleAll=el('button',{type:'button',class:'line-btn'},'모두 풀기');
  const update=()=>{button.disabled=!picked.size;button.textContent=picked.size?`고른 ${picked.size}개 휴지통으로`:'고른 것 휴지통으로';toggleAll.textContent=picked.size===list.length?'모두 풀기':'모두 고르기';};
  toggleAll.onclick=()=>{const on=picked.size!==list.length;picked.clear();if(on)for(const r of list)picked.add(r.path);for(const [path,box] of boxes)box.checked=picked.has(path);update();};
  s.actions(el('label',{class:'admin-toggle'},images,'Images 포함'),...(list.length?[toggleAll]:[]),button);
  const row=r=>{const box=el('input',{type:'checkbox',checked:picked.has(r.path),'aria-label':r.path,onchange:()=>{box.checked?picked.add(r.path):picked.delete(r.path);update();}});boxes.set(r.path,box);return imageRow(r,box,`${size(r.size||0)} · ${when(r.updatedAt)}`);};
  const rows=list.slice(0,PAGE).map(row),more=el('button',{type:'button',class:'line-btn admin-more'});
  const paged=()=>{const left=list.length-boxes.size;more.hidden=left<=0;more.textContent=`더 보기 (남은 ${left}개, 보이지 않는 것도 함께 골라져 있습니다)`;};
  more.onclick=()=>{more.before(...list.slice(boxes.size,boxes.size+PAGE).map(row));paged();};
  s.fill(list.length?[...rows,more]:[],'쓰지 않는 그림이 없습니다.');paged();update();
  button.onclick=async()=>{const chosen=[...picked];if(!confirm(`그림 ${chosen.length}개를 휴지통에 넣을까요?\n서버에서 받을 수 없게 되고, 교회 Mac은 다음 [적용] 때 그 파일을 macOS 휴지통으로 옮깁니다(Mac 파일이 서버와 다르면 옮기지 않고 정리 창에 남깁니다).`))return;
   button.disabled=true;let total=0;
   try{for(let i=0;i<chosen.length;i+=SEND){const r=await(await C().api('/admin/orphans',json('POST',{trash:chosen.slice(i,i+SEND),images:withImages,checkIndex:i===0}))).json();total+=r.trashed;say(`그림 ${total}개 휴지통에 넣음 · ${Math.min(i+SEND,chosen.length)}/${chosen.length}`);}
    await reload('orphans','imageTrash');say(`그림 ${total}개를 휴지통에 넣었습니다. 교회 Mac은 다음 [적용] 때 옮깁니다.`);}
   catch(error){say(`${error.message}${total?` (그 전까지 ${total}개는 휴지통에 들어갔습니다)`:''}`);await reload('orphans','imageTrash');}};
 }
 // 그림 한 줄: [미리보기]를 누르면 그 줄 아래에 서버 원본을 펼친다(누를 때만 받는다).
 function imageRow(r,lead,meta,...actions){
  const {el}=P(),shown={box:null},preview=el('button',{type:'button',class:'line-btn'},'미리보기');
  const row=el('div',{class:'line-row'},lead,el('span',{class:'line-title',title:r.path},r.path.replace(/^\/Users\/Shared\/Renewed Vision Media\//,'')),el('span',{class:'line-meta'},meta),preview,...actions);
  preview.onclick=()=>{if(shown.box){shown.box.remove();shown.box=null;preview.textContent='미리보기';return;}
   const img=el('img',{src:`/api/media/${r.sha256}/content`,alt:r.path});img.addEventListener('error',()=>img.replaceWith(el('span',{class:'line-meta'},'미리보기를 열지 못했습니다(서버에 원본이 없거나 브라우저가 못 여는 형식).')));
   shown.box=el('div',{class:'admin-preview'},img);row.after(shown.box);preview.textContent='접기';};
  return row;
 }
 // ── 그림 휴지통 ──
 // 고아 이미지에서 휴지통에 넣은 그림. 꺼내면 다시 쓰는 경로가 되고, 비우면 경로를 지우고 그 바이트를 아무도 안 쓰면 서버 원본도 지운다.
 // [비우기]는 서버가 100개씩 비우고 남은 수를 돌려주므로 0이 될 때까지 다시 부른다(목록에 다 보이지 않아도 모두 비운다).
 async function imageTrash(s){
  const {el,when,kind}=P(),purgeAll=danger('비우기',{disabled:true});
  const data=await(await C().api('/admin/orphans?trashed=1')).json(),list=data.trashed;
  s.count(list.length?`${list.length}${list.length>=2000?'개 이상':'개'} · ${size(data.bytes)}`:0);s.actions(purgeAll);
  const row=r=>{const out=el('button',{type:'button',class:'line-btn'},'꺼내기');
   out.onclick=async()=>{out.disabled=true;try{await C().api('/admin/orphans',json('POST',{untrash:[r.path]}));await reload('imageTrash','orphans');say('그림을 꺼냈습니다.');}catch(error){say(error.message);out.disabled=false;}};
   return imageRow(r,kind('image'),[r.updatedBy,r.updatedAt?when(r.updatedAt):''].filter(Boolean).join(' · '),out);};
  const shown=list.slice(0,PAGE).map(row);
  if(list.length>PAGE)shown.push(el('p',{class:'line-empty'},`그 밖 ${list.length-PAGE}${list.length>=2000?'개 이상':'개'}는 목록에 다 보이지 않습니다. [비우기]는 모두 비웁니다.`));
  s.fill(shown,'휴지통이 비어 있습니다.');
  if(!list.length)return;
  purgeAll.disabled=false;
  purgeAll.onclick=async()=>{if(!confirm(`그림 휴지통을 모두 비울까요? 비운 그림은 되살릴 수 없습니다.\n그 그림을 쓰는 다른 경로·문서 버전·즐겨찾기가 없으면 서버 원본도 지웁니다.`))return;
   purgeAll.disabled=true;let total=0;
   try{let r;do{r=await(await C().api('/admin/orphans',json('POST',{purgeAll:true}))).json();total+=r.purged;say(`그림 ${total}개 비움${list.length<2000?` · 남은 약 ${Math.max(0,list.length-total)}개`:''}`);}while(r.more&&r.purged>0);
    await reload('imageTrash');say(`그림 ${total}개를 비웠습니다.`);}
   catch(error){say(`${error.message}${total?` (그 전까지 ${total}개는 비웠습니다)`:''}`);await reload('imageTrash');}};
 }
 // ── 교회 Mac 보관본 ──
 // [정리 끝]은 목록에서만 뺀다. [모두 지우기]는 열린 것·이력 없는 문서 것·정리 끝난 것을 모두, 줄마다 [지우기]는 그것만 영구 삭제한다(R2 원본·행).
 const REASON={'both-changed':'양쪽 수정(서버 것 받음)',technical:'이력 없는 문서'};
 let withTechnical=false;
 async function revisions(s){
  const {el,when,kind}=P(),purgeAll=danger('모두 지우기',{disabled:true});
  const technical=el('input',{type:'checkbox',checked:withTechnical,onchange:()=>{withTechnical=technical.checked;reload('revisions');}});
  const data=await(await C().api('/sync/revisions'+(withTechnical?'?technical=1':''))).json(),list=data.revisions,total=data.total||0;
  s.count([`열린 ${total-(data.resolved||0)}개`,data.technical&&!withTechnical?`그중 이력 없는 문서 ${data.technical}개 숨김`:'',data.resolved?`정리 끝난 ${data.resolved}개`:''].filter(Boolean).join(' · '));s.badge=total;
  purgeAll.disabled=!total;purgeAll.textContent=total?`모두 지우기 (${total}개)`:'모두 지우기';
  s.actions(el('label',{class:'admin-toggle'},technical,'이력 없는 문서 것도 보기'),purgeAll);
  purgeAll.onclick=async()=>{if(!confirm(`교회 Mac 보관본 ${total}개를 모두 지울까요? 열린 것·이력 없는 문서 것·정리 끝난 것 모두입니다. 지운 보관본은 되살릴 수 없습니다.\n문서 원본·버전·재생목록은 그대로입니다.`))return;
   purgeAll.disabled=true;let done=0;
   try{let result;do{result=await(await C().api('/sync/revisions/purge',json('POST',{all:true}))).json();done+=result.purged;say(`보관본 ${done}개 지움 · 남은 ${result.remaining}개`);}while(result.remaining>0&&result.purged>0);await reload('revisions');say(`교회 Mac 보관본 ${done}개를 지웠습니다.`);}
   catch(error){say(error.message);await reload('revisions');}};
  s.fill(list.map(r=>{
   const done=el('button',{type:'button',class:'line-btn'},'정리 끝'),remove=danger('지우기');
   done.onclick=async()=>{done.disabled=true;try{await C().api(`/sync/revisions/${r.id}/resolve`,json('POST',{resolution:'dismissed'}));await reload('revisions');say(`‘${stem(r.path)}’ 보관본을 정리했습니다.`);}catch(error){say(error.message);done.disabled=false;}};
   remove.onclick=async()=>{if(!confirm(`‘${stem(r.path||r.entity)}’ 보관본을 지울까요? 지운 보관본은 되살릴 수 없습니다.`))return;remove.disabled=true;try{await C().api(`/sync/revisions/${r.id}`,{method:'DELETE'});await reload('revisions');say(`‘${stem(r.path||r.entity)}’ 보관본을 지웠습니다.`);}catch(error){say(error.message);remove.disabled=false;}};
   const download=el('a',{class:'line-icon',href:`/api/sync/revisions/${r.id}/content`,download:stem(r.path||'보관본')+'-Mac.pro6',title:'Mac 쪽 내용 받기','aria-label':'Mac 쪽 내용 받기'});
   download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
   return el('div',{class:'line-row'},kind(r.kind==='node'?'playlist':'document'),el('span',{class:'line-title',title:r.path||''},stem(r.path||r.entity)),el('span',{class:'line-meta'},[REASON[r.reason]||r.reason,r.author,when(r.createdAt)].filter(Boolean).join(' · ')),download,done,remove);
  }),total?'열린 보관본이 없습니다(이력 없는 문서 것은 위 칸을 켜면 보입니다).':'보관본이 없습니다.');
 }
 // ── 검색 자료 ──
 async function maintenance(s){
  const run=runMaintenance;run.className='line-btn';run.textContent='누락 검색 자료 점검';run.hidden=false;
  if(!run.dataset.closes){run.dataset.closes='1';run.addEventListener('click',()=>dialog.close());}
  s.count(null);s.actions(run);
 }
 // 탭과 섹션(정해진 순서). 섹션 틀은 이 순서로 한 번만 만든다.
 const SECTIONS=[
  ['questions',{tab:'questions',title:'질문·답변',note:'오른쪽 아래 질문 창으로 들어온 질문입니다. 질문자·환경(Mac/PC·브라우저)을 보고 답합니다.',load:questions,noList:true}],
  ['trashDocs',{tab:'trash',title:'문서 휴지통',note:'꺼내기는 누구나, 비우기(영구 삭제)는 관리자만 합니다.',load:trashDocs}],
  ['trashPlaylists',{tab:'trash',title:'재생목록 휴지통',note:'꺼내기는 휴지통 창에서 합니다. 열려 있는 순서의 변경을 먼저 저장해야 하기 때문입니다.',load:trashPlaylists}],
  ['orphans',{tab:'images',title:'고아 이미지',note:'슬라이드에서 가져온 그림(ImportedImages·YebaeOn) 중 어느 문서(사용 중·보관·휴지통)도 쓰지 않는 것입니다. 휴지통에 넣으면 교회 Mac이 다음 [적용] 때 macOS 휴지통으로 옮깁니다. 미디어 서랍(Images)은 PP6에서 직접 쓰므로 처음 정리할 때만 켜서 함께 고릅니다.',load:orphans}],
  ['imageTrash',{tab:'images',title:'그림 휴지통',note:'고아 이미지에서 휴지통에 넣은 그림입니다. 교회 Mac은 다음 [적용] 때 그 파일을 macOS 휴지통으로 옮깁니다(비운 뒤에도). 비우면 서버 경로표에서 지우고, 그 그림을 쓰는 곳이 하나도 없으면 서버 원본도 지웁니다. 되살릴 수 없습니다.',load:imageTrash}],
  ['revisions',{tab:'mac',title:'교회 Mac 보관본',note:'양쪽에서 고쳐 서버 것을 받을 때 남긴 Mac 쪽 내용입니다. 확인했으면 [정리 끝]으로 목록에서 빼고, 필요 없으면 줄마다 [지우기]나 [모두 지우기]로 서버에서 없앱니다.',load:revisions}],
  ['categories',{tab:'settings',title:'카테고리',note:'검색·이력 설정을 바꾸면 그 카테고리 문서는 다음 저장부터 새 설정을 따릅니다.',load:categories}],
  ['maintenance',{tab:'settings',title:'검색 자료',note:'새로 올리거나 저장한 문서는 검색 자료도 함께 갱신됩니다. 예전 자료의 본문·사용일이 검색에서 빠졌을 때만 실행하세요.',load:maintenance,noList:true}]
 ];
 // 연 탭의 섹션만 불러온다. 다른 탭은 처음 누를 때 불러온다.
 async function render(){
  $('adminPanelState').textContent=expiresAt?`관리자 확인됨 · ${P().when(expiresAt*1000)}까지`:'관리자 확인됨';
  for(const s of sections.values())s.loaded=false;
  await show(tab);
 }
 async function signOut(){
  try{await C().api('/admin',{method:'DELETE'});expiresAt=null;dialog.close();}catch(error){say(error.message);}
 }
 async function open(){
  if(!C().needUser())return;
  try{if(!await ensure())return;}catch(error){alert(error.message);return;}
  const d=frame();say('');if(!d.open)d.showModal();
  await render();
 }
 window.YebaeonAdmin={open,ensure};
})();
