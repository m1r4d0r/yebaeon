(function(){'use strict';
 // 설정·관리 창. 열 때 관리자 확인을 먼저 받는다(하루 유지). 관리자 일만 모은다:
 // 휴지통 보기·비우기, 고아 이미지 정리·그림 휴지통, 카테고리 검색·이력 설정, 교회 Mac 보관본 정리, 누락 검색 자료 점검.
 const $=id=>document.getElementById(id),C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels,M=()=>window.YebaeonLibraryManage;
 const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const stem=path=>(path||'').split('/').pop().replace(/\.pro6$/i,'');
 let dialog=null,expiresAt=null;
 // 누락 검색 자료 점검 단추는 cloud.js가 동작을 달아 둔 것을 이 창으로 옮겨 쓴다.
 const runMaintenance=$('indexMaintenance');

 // 관리자 확인: 이미 확인돼 있으면 묻지 않고, 아니면 비밀번호 창. 취소하면 false.
 async function ensure(){
  try{const state=await(await C().api('/admin')).json();if(!state.configured)throw new Error('관리자 비밀번호가 서버에 설정되지 않았습니다.');if(state.admin){expiresAt=state.expiresAt;return true;}}
  catch(error){if(error.message.includes('설정되지'))throw error;}
  if(!await M().admin())return false;
  try{expiresAt=(await(await C().api('/admin')).json()).expiresAt;}catch(_){expiresAt=null;}
  return true;
 }
 function frame(){
  if(dialog)return dialog;
  const {el}=P();
  dialog=el('dialog',{class:'library-dialog panel-dialog admin-dialog',id:'adminPanel','aria-labelledby':'adminPanelTitle'});
  const close=el('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>dialog.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  dialog.append(el('div',{class:'panel-head'},el('h2',{id:'adminPanelTitle'},'설정·관리'),el('span',{class:'admin-chip'},'관리자'),el('span',{class:'panel-gap'}),close),
   el('div',{class:'admin-state'},el('span',{id:'adminPanelState'}),el('button',{type:'button',class:'text-danger',onclick:signOut},'관리자 확인 끝내기')),
   el('div',{id:'adminPanelBody',class:'panel-body admin-body'}),el('p',{id:'adminPanelMessage',class:'panel-foot',role:'status'}));
  document.body.append(dialog);return dialog;
 }
 const say=text=>{$('adminPanelMessage').textContent=text;};
 function section(title,note,...actions){
  const {el}=P(),list=el('div',{class:'line-list'});
  const box=el('section',{class:'admin-section'},el('div',{class:'admin-section-head'},el('h3',{},title),el('span',{class:'admin-count'}),...actions),note?el('p',{class:'admin-note'},note):null,list);
  $('adminPanelBody').append(box);return {box,list,count:n=>{box.querySelector('.admin-count').textContent=n===null?'':String(n);}};
 }
 const empty=(list,text)=>list.append(P().el('p',{class:'line-empty'},text));

 // ── 휴지통 ──
 async function all(path,key){const out=[];let after='';do{const data=await(await C().api(path+(path.includes('?')?'&':'?')+new URLSearchParams({after}))).json();out.push(...data[key]);after=data.next||'';}while(after&&out.length<500);return out;}
 async function purge(kind,label,button){
  if(!confirm(`${label}을(를) 비울까요? 비운 항목은 되살릴 수 없습니다.${kind==='documents'?'\n사용 중·보관함 재생목록에 들어 있는 문서는 남깁니다. 휴지통 재생목록만 가리키던 문서를 비우면 그 재생목록은 다시 꺼낼 수 없습니다.':''}`))return;
  button.disabled=true;
  try{let total=0,result,kept=[];do{result=await(await C().api('/admin/trash',json('POST',{kind}))).json();total+=result.purged;kept=result.kept||kept;say(`${label} ${total}개 비움 · 남은 ${result.remaining}개`);}while(result.remaining>0&&result.purged>0);
   await render();say(`${label} ${total}개를 비웠습니다.`+(kept.length?` 사용 중·보관함 재생목록에 들어 있어 남김: ${kept.map(stem).join(', ')}`:''));}
  catch(error){say(error.message);button.disabled=false;}
 }
 async function trashDocs(){
  const {el,when,kind}=P(),button=el('button',{type:'button',class:'line-btn text-danger'},'비우기');
  const s=section('문서 휴지통','꺼내기는 누구나, 비우기(영구 삭제)는 관리자만 합니다.',button);
  const docs=await all('/documents?state=trashed','documents');s.count(docs.length);button.disabled=!docs.length;button.onclick=()=>purge('documents','문서 휴지통',button);
  if(!docs.length)empty(s.list,'휴지통이 비어 있습니다.');
  for(const doc of docs){
   const back=el('button',{type:'button',class:'line-btn'},'꺼내기');
   back.onclick=async()=>{back.disabled=true;try{await C().api(`/documents/${doc.id}/state`,json('POST',{action:'untrash'}));say(`‘${stem(doc.path)}’을(를) 꺼냈습니다.`);C().refresh();await render();}catch(error){say(error.message);back.disabled=false;}};
   s.list.append(el('div',{class:'line-row'},kind('document'),el('span',{class:'line-title',title:doc.path},stem(doc.path)),el('span',{class:'line-meta'},[doc.stateBy,doc.stateAt?when(doc.stateAt):''].filter(Boolean).join(' · ')),back));
  }
 }
 async function trashPlaylists(){
  const {el,when,kind}=P(),button=el('button',{type:'button',class:'line-btn text-danger'},'비우기');
  const s=section('재생목록 휴지통','꺼내기는 휴지통 창에서 합니다. 열려 있는 순서의 변경을 먼저 저장해야 하기 때문입니다.',el('button',{type:'button',class:'line-btn',onclick:()=>{dialog.close();M().openBins('trashed-playlists');}},'휴지통 창'),button);
  const items=await all('/playlists?scope=trashed','archives');s.count(items.length);button.disabled=!items.length;button.onclick=()=>purge('playlists','재생목록 휴지통',button);
  if(!items.length)empty(s.list,'휴지통이 비어 있습니다.');
  for(const item of items)s.list.append(el('div',{class:'line-row'},kind('playlist'),el('span',{class:'line-title',title:item.name},item.name),el('span',{class:'line-meta'},[item.archivedBy,item.archivedAt?when(item.archivedAt):''].filter(Boolean).join(' · '))));
 }
 // ── 카테고리 설정(검색·이력) ──
 async function categories(){
  const {el}=P(),s=section('카테고리','검색·이력 설정을 바꾸면 그 카테고리 문서는 다음 저장부터 새 설정을 따릅니다.');
  const list=(await(await C().api('/categories')).json()).categories;s.count(list.length);
  if(!list.length)empty(s.list,'카테고리가 없습니다.');
  for(const c of list){
   const search=el('input',{type:'checkbox',checked:c.searchEnabled}),history=el('input',{type:'checkbox',checked:c.historyEnabled});
   const save=async()=>{search.disabled=history.disabled=true;try{await C().api('/categories/'+encodeURIComponent(c.name),json('PUT',{searchEnabled:search.checked,historyEnabled:history.checked}));say(`‘${c.name}’ 설정을 바꿨습니다.`);}catch(error){say(error.message);search.checked=c.searchEnabled;history.checked=c.historyEnabled;}finally{search.disabled=history.disabled=false;}};
   search.onchange=history.onchange=save;
   s.list.append(el('div',{class:'line-row'},el('span',{class:'line-title'},c.name),el('label',{class:'admin-toggle'},search,'검색'),el('label',{class:'admin-toggle'},history,'이력'),el('span',{class:'line-meta'},c.updatedBy?`${c.updatedBy} 변경`:c.createdBy||'')));
  }
 }
 // ── 고아 이미지 ──
 // 슬라이드에서 가져온 그림(ImportedImages·YebaeOn) 중 어느 문서도 쓰지 않는 것. 휴지통에 넣으면 교회 Mac이 다음 [적용] 때 macOS 휴지통으로 옮긴다.
 let withImages=false;
 const size=b=>b>=1024**3?(b/1024**3).toFixed(2)+' GB':(b/1024/1024).toFixed(1)+' MB';
 async function orphans(){
  const {el,when}=P(),button=el('button',{type:'button',class:'line-btn text-danger',disabled:true},'고른 것 휴지통으로');
  const images=el('input',{type:'checkbox',checked:withImages,onchange:()=>{withImages=images.checked;render();}});
  const s=section('고아 이미지','슬라이드에서 가져온 그림(ImportedImages·YebaeOn) 중 어느 문서(사용 중·보관·휴지통)도 쓰지 않는 것입니다. 휴지통에 넣으면 교회 Mac이 다음 [적용] 때 macOS 휴지통으로 옮깁니다. 미디어 서랍(Images)은 PP6에서 직접 쓰므로 처음 정리할 때만 켜서 함께 고릅니다.',el('label',{class:'admin-toggle'},images,'Images 포함'),button);
  let data=await(await C().api('/admin/orphans'+(withImages?'?images=1':''))).json();
  if(data.remaining){
   s.count(null);const run=el('button',{type:'button',class:'line-btn'},'색인 채우기');const text=el('span',{class:'line-title'},`문서 이미지 색인이 ${data.remaining}개 남았습니다. 다 채워야 후보를 계산합니다.`);
   run.onclick=async()=>{run.disabled=true;try{let left=data.remaining;while(left>0){const r=await(await C().api('/admin/orphans',json('POST',{index:true}))).json();if(!r.indexed&&r.remaining)throw Error('색인하지 못한 문서가 있습니다. 다시 눌러 주세요.');left=r.remaining;text.textContent=`색인 중… 남은 문서 ${left}개`;}await render();}catch(error){say(error.message);run.disabled=false;}};
   s.list.append(el('div',{class:'line-row'},text,run));return;
  }
  const list=data.candidates;s.count(list.length?`${list.length}개 · ${size(data.bytes)}`:0);
  if(!list.length){empty(s.list,'쓰지 않는 그림이 없습니다.');return;}
  const picked=new Set(list.map(r=>r.path)),update=()=>{button.disabled=!picked.size;button.textContent=picked.size?`고른 ${picked.size}개 휴지통으로`:'고른 것 휴지통으로';};
  for(const r of list){const box=el('input',{type:'checkbox',checked:true,'aria-label':r.path,onchange:()=>{box.checked?picked.add(r.path):picked.delete(r.path);update();}});
   imageRow(s.list,r,box,`${size(r.size||0)} · ${when(r.updatedAt)}`);}
  update();
  button.onclick=async()=>{const chosen=[...picked];if(!confirm(`그림 ${chosen.length}개를 휴지통에 넣을까요?\n서버에서 받을 수 없게 되고, 교회 Mac은 다음 [적용] 때 그 파일을 macOS 휴지통으로 옮깁니다(Mac 파일이 서버와 다르면 옮기지 않고 정리 창에 남깁니다).`))return;
   button.disabled=true;try{let total=0;for(let i=0;i<chosen.length;i+=200){const r=await(await C().api('/admin/orphans',json('POST',{trash:chosen.slice(i,i+200),images:withImages}))).json();total+=r.trashed;}await render();say(`그림 ${total}개를 휴지통에 넣었습니다. 교회 Mac은 다음 [적용] 때 옮깁니다.`);}catch(error){say(error.message);button.disabled=false;}};
 }
 // 그림 한 줄: [미리보기]를 누르면 그 줄 아래에 서버 원본을 펼친다(누를 때만 받는다).
 function imageRow(list,r,lead,meta,...actions){
  const {el}=P(),shown={box:null},preview=el('button',{type:'button',class:'line-btn'},'미리보기');
  const row=el('div',{class:'line-row'},lead,el('span',{class:'line-title',title:r.path},r.path.replace(/^\/Users\/Shared\/Renewed Vision Media\//,'')),el('span',{class:'line-meta'},meta),preview,...actions);
  preview.onclick=()=>{if(shown.box){shown.box.remove();shown.box=null;preview.textContent='미리보기';return;}
   const img=el('img',{src:`/api/media/${r.sha256}/content`,alt:r.path});img.addEventListener('error',()=>img.replaceWith(el('span',{class:'line-meta'},'미리보기를 열지 못했습니다(서버에 원본이 없거나 브라우저가 못 여는 형식).')));
   shown.box=el('div',{class:'admin-preview'},img);row.after(shown.box);preview.textContent='접기';};
  list.append(row);return row;
 }
 // ── 그림 휴지통 ──
 // 고아 이미지에서 휴지통에 넣은 그림. 꺼내면 다시 쓰는 경로가 되고, 비우면 경로를 지우고 그 바이트를 아무도 안 쓰면 서버 원본도 지운다.
 async function imageTrash(){
  const {el,when,kind}=P(),purgeAll=el('button',{type:'button',class:'line-btn text-danger',disabled:true},'비우기');
  const s=section('그림 휴지통','고아 이미지에서 휴지통에 넣은 그림입니다. 교회 Mac은 다음 [적용] 때 그 파일을 macOS 휴지통으로 옮깁니다(비운 뒤에도). 비우면 서버 경로표에서 지우고, 그 그림을 쓰는 곳이 하나도 없으면 서버 원본도 지웁니다. 되살릴 수 없습니다.',purgeAll);
  const data=await(await C().api('/admin/orphans?trashed=1')).json(),list=data.trashed;
  s.count(list.length?`${list.length}개 · ${size(data.bytes)}`:0);
  if(!list.length){empty(s.list,'휴지통이 비어 있습니다.');return;}
  const send=async(action,paths)=>{let done=0;for(let i=0;i<paths.length;i+=200){const r=await(await C().api('/admin/orphans',json('POST',{[action]:paths.slice(i,i+200)}))).json();done+=action==='purge'?r.purged:r.untrashed;}return done;};
  for(const r of list){const out=el('button',{type:'button',class:'line-btn'},'꺼내기');
   out.onclick=async()=>{out.disabled=true;try{await send('untrash',[r.path]);await render();say('그림을 꺼냈습니다.');}catch(error){say(error.message);out.disabled=false;}};
   imageRow(s.list,r,kind('image'),[r.updatedBy,r.updatedAt?when(r.updatedAt):''].filter(Boolean).join(' · '),out);}
  purgeAll.disabled=false;
  purgeAll.onclick=async()=>{if(!confirm(`그림 휴지통 ${list.length}개를 비울까요? 비운 그림은 되살릴 수 없습니다.\n그 그림을 쓰는 다른 경로·문서 버전·즐겨찾기가 없으면 서버 원본도 지웁니다.`))return;
   purgeAll.disabled=true;try{const n=await send('purge',list.map(r=>r.path));await render();say(`그림 ${n}개를 비웠습니다.`);}catch(error){say(error.message);purgeAll.disabled=false;}};
 }
 // ── 교회 Mac 보관본 ──
 const REASON={'both-changed':'양쪽 수정(서버 것 받음)'};
 async function revisions(){
  const {el,when,kind}=P(),s=section('교회 Mac 보관본','양쪽에서 고쳐 서버 것을 받을 때 남긴 Mac 쪽 내용입니다. 확인했으면 [정리 끝]으로 목록에서 뺍니다(원본은 남습니다).');
  const list=(await(await C().api('/sync/revisions')).json()).revisions;s.count(list.length);
  if(!list.length)empty(s.list,'열린 보관본이 없습니다.');
  for(const r of list){
   const done=el('button',{type:'button',class:'line-btn'},'정리 끝');
   done.onclick=async()=>{done.disabled=true;try{await C().api(`/sync/revisions/${r.id}/resolve`,json('POST',{resolution:'dismissed'}));await render();say(`‘${stem(r.path)}’ 보관본을 정리했습니다.`);}catch(error){say(error.message);done.disabled=false;}};
   const download=el('a',{class:'line-icon',href:`/api/sync/revisions/${r.id}/content`,download:stem(r.path||'보관본')+'-Mac.pro6',title:'Mac 쪽 내용 받기','aria-label':'Mac 쪽 내용 받기'});
   download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
   s.list.append(el('div',{class:'line-row'},kind(r.kind==='node'?'playlist':'document'),el('span',{class:'line-title',title:r.path||''},stem(r.path||r.entity)),el('span',{class:'line-meta'},[REASON[r.reason]||r.reason,r.author,when(r.createdAt)].filter(Boolean).join(' · ')),download,done));
  }
 }
 // ── 검색 자료 ──
 function maintenance(){
  const run=runMaintenance;run.className='line-btn';run.textContent='누락 검색 자료 점검';
  const s=section('검색 자료','새로 올리거나 저장한 문서는 검색 자료도 함께 갱신됩니다. 예전 자료의 본문·사용일이 검색에서 빠졌을 때만 실행하세요.',run);s.count(null);
  run.addEventListener('click',()=>dialog.close(),{once:true});s.list.remove();
 }
 async function render(){
  const {el}=P(),body=$('adminPanelBody');body.replaceChildren();
  $('adminPanelState').textContent=expiresAt?`관리자 확인됨 · ${P().when(expiresAt*1000)}까지`:'관리자 확인됨';
  for(const part of [trashDocs,trashPlaylists,orphans,imageTrash,categories,revisions]){try{await part();}catch(error){body.append(el('p',{class:'line-empty'},error.message));}}
  maintenance();
 }
 async function signOut(){
  try{await C().api('/admin',{method:'DELETE'});expiresAt=null;dialog.close();}catch(error){say(error.message);}
 }
 async function open(){
  if(!C().needUser())return;
  try{if(!await ensure())return;}catch(error){alert(error.message);return;}
  const d=frame();say('');$('adminPanelBody').replaceChildren(P().el('p',{class:'line-empty'},'불러오는 중…'));if(!d.open)d.showModal();
  await render();
 }
 window.YebaeonAdmin={open,ensure};
})();
