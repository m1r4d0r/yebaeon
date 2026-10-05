(function(){'use strict';
 // 문서·재생목록의 보관함·휴지통·이름 바꾸기, 관리자 확인, 카테고리 추가, 편집 중 안내, 교회 Mac 상태, 문서 바로 열기 링크.
 // 되돌릴 수 있는 일은 누구나, 휴지통 비우기는 관리자만. 진짜 삭제는 휴지통 비우기뿐이다.
 const $=id=>document.getElementById(id),C=YebaeonCloud;
 const status=text=>window.YebaeonEditor?.status(text);
 const json=(method,body,extra={})=>({method,headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 const ago=at=>{const minutes=Math.max(0,Math.round((Date.now()-Date.parse(at))/60000));return minutes<1?'방금':minutes+'분 전';};
 const stem=path=>path.split('/').pop().replace(/\.pro6$/i,'');
 const busy=()=>YebaeonPlaylists.state().dirty||YebaeonPlaylists.state().busy||window.YebaeonSave?.busy();

 // ── 관리자 확인(15분) ──
 function admin(){
  return new Promise(resolve=>{
   const dialog=$('adminDialog');$('adminPassword').value='';$('adminMessage').textContent='휴지통 비우기처럼 되돌릴 수 없는 일에만 묻습니다. 15분 동안 유지됩니다.';dialog.showModal();$('adminPassword').focus();
   const done=value=>{dialog.close();resolve(value);};
   $('adminCancel').onclick=()=>done(false);dialog.oncancel=()=>resolve(false);
   $('adminForm').onsubmit=async e=>{e.preventDefault();$('adminSubmit').disabled=true;
    try{await C.api('/admin',json('POST',{password:$('adminPassword').value}));done(true);}
    catch(error){$('adminMessage').textContent=error.message;}finally{$('adminSubmit').disabled=false;}};
  });
 }
 async function asAdmin(task){
  try{return await task();}
  catch(error){if(error.code!=='admin_required')throw error;if(!await admin())return null;return await task();}
 }

 // ── 이름 입력 ──
 function ask(title,value,help){
  return new Promise(resolve=>{
   const dialog=$('renameDialog');$('renameTitle').textContent=title;$('renameHelp').textContent=help||'';$('renameMessage').textContent='';$('renameValue').value=value;dialog.showModal();$('renameValue').select();
   $('renameCancel').onclick=()=>{dialog.close();resolve(null);};dialog.oncancel=()=>resolve(null);
   $('renameForm').onsubmit=e=>{e.preventDefault();const next=$('renameValue').value.trim();if(!next){$('renameMessage').textContent='이름을 입력해 주세요.';return;}dialog.close();resolve(next);};
  });
 }

 // ── 문서 ──
 async function renameDocument(doc){
  if(!C.needUser())return;
  if(C.linked()?.id===doc.id&&YebaeonEditor.state?.().dirty){status('이 문서를 먼저 저장한 뒤 이름을 바꿔 주세요.');return;}
  const name=await ask('문서 이름 바꾸기',stem(doc.path),'이력과 버전은 그대로이고, 이 문서를 쓰는 모든 재생목록의 연결도 함께 바뀝니다. 교회 Mac은 다음 [적용] 때 파일 이름을 바꿉니다.');
  if(!name||name===stem(doc.path))return;
  try{
   const latest=(await(await C.api('/documents/'+doc.id)).json()).document;
   const path=(doc.path.includes('/')?doc.path.slice(0,doc.path.lastIndexOf('/')+1):'')+name.replace(/\.pro6$/i,'')+'.pro6';
   const result=await(await C.api(`/documents/${doc.id}/rename`,json('POST',{path},{'If-Match':`"${latest.version}"`}))).json();
   status(`이름을 ‘${stem(result.document.path)}’(으)로 바꿨습니다.${result.playlists?.length?' 재생목록 연결도 고쳤습니다.':''}${result.referencesError?' 재생목록 연결은 고치지 못했습니다: '+result.referencesError:''}`);
   C.renamed(result.document);await C.refresh();if(result.playlists?.length)await YebaeonPlaylists.show();
  }catch(error){status(error.code==='path_exists'?'같은 이름의 문서가 이미 있습니다. 다른 이름을 입력해 주세요.':error.message);}
 }
 async function setDocumentState(docs,action){
  if(!C.needUser()||!docs.length)return;
  const words={archive:'보관함으로 옮길까요? 일반 검색에서 빠지고 보관함에서 꺼낼 수 있습니다.',trash:'휴지통으로 옮길까요? 교회 Mac에서는 다음 [적용] 때 휴지통으로 옮겨집니다. 휴지통에서 꺼낼 수 있습니다.'};
  if(words[action]&&!confirm(`${docs.length===1?'‘'+stem(docs[0].path)+'’':docs.length+'개 문서'}를 ${words[action]}`))return;
  let done=0;
  for(const doc of docs){try{await C.api(`/documents/${doc.id}/state`,json('POST',{action}));done++;}catch(error){status(error.message);}}
  status(`${done}개 문서를 ${action==='archive'?'보관함으로':action==='trash'?'휴지통으로':'사용 중으로'} 옮겼습니다.`);
  await C.refresh();
 }

 // ── 재생목록 ──
 async function playlistBase(library,node){
  const plan=(await(await C.api(`/playlists/${library.id}/plan?`+new URLSearchParams({node:node.id}))).json());
  return plan;
 }
 async function renamePlaylist(library,node){
  if(!C.needUser())return;if(busy()){$('playlistsMessage').textContent='현재 변경사항을 저장한 뒤 이름을 바꿔 주세요.';return;}
  const name=await ask('재생목록 이름 바꾸기',node.name,'교회 Mac은 다음 [적용] 때 이름을 바꿉니다.');if(!name||name===node.name)return;
  try{const plan=await playlistBase(library,node);const result=await(await C.api(`/playlists/${library.id}/rename?`+new URLSearchParams({node:node.id}),json('POST',{name,baseNodeHash:plan.playlist.sha256}))).json();await YebaeonPlaylists.acceptLibrary(result.library,node.id);$('playlistsMessage').textContent='재생목록 이름을 바꿨습니다.';}
  catch(error){$('playlistsMessage').textContent=error.message;}
 }
 async function trashPlaylist(library,node){
  if(!C.needUser())return;if(busy()){$('playlistsMessage').textContent='현재 변경사항을 저장한 뒤 옮겨 주세요.';return;}
  if(!confirm(`‘${node.name}’ 재생목록을 휴지통으로 옮길까요? 순서와 문서 사본이 남아 꺼낼 수 있습니다. 교회 Mac은 다음 [적용] 때 이 목록을 뺍니다.`))return;
  try{const plan=await playlistBase(library,node);const result=await(await C.api(`/playlists/${library.id}/trash?`+new URLSearchParams({node:node.id}),json('POST',{baseNodeHash:plan.playlist.sha256},{'If-Match':`"${plan.library.version}"`}))).json();await YebaeonPlaylists.acceptLibrary(result.library);$('playlistsMessage').textContent='재생목록을 휴지통으로 옮겼습니다.';}
  catch(error){$('playlistsMessage').textContent=error.message;}
 }

 // ── 보관함·휴지통 창 ──
 let bin='trashed-playlists';
 const BINS={
  'trashed-docs':{label:'문서 휴지통',empty:'휴지통이 비어 있습니다.',purge:'documents'},
  'trashed-playlists':{label:'재생목록 휴지통',empty:'휴지통이 비어 있습니다.',purge:'playlists'}
 };
 async function openBins(which){
  if(!C.needUser())return;if(which)bin=which;$('binsDialog').open||$('binsDialog').showModal();
  for(const button of $('binsTabs').children)button.classList.toggle('active',button.dataset.bin===bin);
  $('binsPurge').hidden=!BINS[bin].purge;const list=$('binsList');list.replaceChildren();$('binsMessage').textContent='불러오고 있습니다…';
  try{
   if(bin.endsWith('docs')){
    const state=bin==='archived-docs'?'archived':'trashed';let after='';
    do{const data=await(await C.api('/documents?'+new URLSearchParams({state,after}))).json();
     for(const doc of data.documents){const row=document.createElement('div');row.className='archive-row';const label=document.createElement('strong');label.textContent=stem(doc.path);const when=document.createElement('small');when.textContent=(doc.stateBy?doc.stateBy+' · ':'')+(doc.stateAt?new Date(doc.stateAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'');
      const back=document.createElement('button');back.textContent='꺼내기';back.onclick=async()=>{back.disabled=true;try{await C.api(`/documents/${doc.id}/state`,json('POST',{action:state==='archived'?'unarchive':'untrash'}));row.remove();$('binsMessage').textContent=`‘${stem(doc.path)}’을(를) 사용 중으로 꺼냈습니다.`;C.refresh();}catch(error){$('binsMessage').textContent=error.message;back.disabled=false;}};
      row.append(label,when,back);
      if(state==='archived'){const trash=document.createElement('button');trash.textContent='휴지통으로';trash.onclick=async()=>{trash.disabled=true;try{await C.api(`/documents/${doc.id}/state`,json('POST',{action:'trash'}));row.remove();}catch(error){$('binsMessage').textContent=error.message;trash.disabled=false;}};row.append(trash);}
      list.append(row);}
     after=data.next||'';}while(after);
   }else{
    let after='';
    do{const data=await(await C.api('/playlists?'+new URLSearchParams({scope:'trashed',after}))).json();
     for(const item of data.archives){const row=document.createElement('div');row.className='archive-row';const label=document.createElement('strong');label.textContent=item.name;const when=document.createElement('small');when.textContent=(item.archivedBy||'')+' · '+new Date(item.archivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
      const back=document.createElement('button');back.textContent='꺼내기';back.onclick=async()=>{if(busy()){$('binsMessage').textContent='현재 변경사항을 먼저 저장해 주세요.';return;}back.disabled=true;try{const latest=(await(await C.api('/playlists/'+item.libraryId)).json()).library;const result=await(await C.api(`/playlists/${item.libraryId}/untrash?`+new URLSearchParams({node:item.id}),json('POST',{},{'If-Match':`"${latest.version}"`}))).json();await YebaeonPlaylists.acceptLibrary(result.library,item.id);row.remove();$('binsMessage').textContent='꺼냈습니다. 현재 문서에 연결됩니다.';}catch(error){$('binsMessage').textContent=error.message;back.disabled=false;}};
      row.append(label,when,back);list.append(row);}
     after=data.next||'';}while(after);
   }
   $('binsMessage').textContent=list.children.length?(BINS[bin].purge?'꺼내기는 누구나 할 수 있습니다. 비우기(영구 삭제)는 관리자만 합니다.':'꺼내면 일반 검색에 다시 나옵니다.'):BINS[bin].empty;
   $('binsPurge').disabled=!list.children.length;
  }catch(error){$('binsMessage').textContent=error.message;}
 }
 async function purge(){
  const kind=BINS[bin].purge;if(!kind)return;
  if(!confirm(`${BINS[bin].label}을(를) 비울까요? 비운 항목은 되살릴 수 없습니다.${kind==='documents'?' 사용 중·보관함 재생목록에 들어 있는 문서는 남깁니다. 휴지통 재생목록만 가리키던 문서를 비우면 그 재생목록은 다시 꺼낼 수 없습니다.':''}`))return;
  $('binsPurge').disabled=true;
  try{let total=0,result;do{result=await asAdmin(async()=>await(await C.api('/admin/trash',json('POST',{kind}))).json());if(!result)break;total+=result.purged;$('binsMessage').textContent=`${total}개 비움 · 남은 ${result.remaining}개${result.kept?.length?` · 사용 중·보관함 재생목록에 들어 있어 남김: ${result.kept.map(stem).join(', ')}`:''}`;}while(result.remaining>0&&result.purged>0);
   if(result){const note=$('binsMessage').textContent;await openBins();if(result.kept?.length)$('binsMessage').textContent=note};}
  catch(error){$('binsMessage').textContent=error.message;}finally{$('binsPurge').disabled=false;}
 }
 $('libraryBins').onclick=()=>openBins();$('binsClose').onclick=()=>$('binsDialog').close();$('binsPurge').onclick=purge;
 for(const button of $('binsTabs').children)button.onclick=()=>openBins(button.dataset.bin);

 // ── 카테고리 ──
 let categories=null;
 async function loadCategories(){
  try{categories=(await(await C.api('/categories')).json()).categories;}catch(_){return null;}
  const select=$('newDocumentCategory'),current=select.value;
  select.replaceChildren();for(const c of categories)select.add(new Option(c.name,c.name));select.add(new Option('새 카테고리…','__new__'));
  if([...select.options].some(o=>o.value===current))select.value=current;
  return categories;
 }
 $('newDocumentCategory').addEventListener('change',async e=>{
  if(e.target.value!=='__new__')return;
  const dialog=$('categoryDialog');$('categoryName').value='';$('categorySearch').checked=true;$('categoryHistory').checked=true;$('categoryMessage').textContent='';dialog.showModal();$('categoryName').focus();
  const finish=async value=>{dialog.close();await loadCategories();e.target.value=value||categories?.[0]?.name||'';};
  $('categoryCancel').onclick=()=>finish(null);
  $('categoryForm').onsubmit=async ev=>{ev.preventDefault();try{const made=(await(await C.api('/categories',json('POST',{name:$('categoryName').value,searchEnabled:$('categorySearch').checked,historyEnabled:$('categoryHistory').checked}))).json()).category;await finish(made.name);}catch(error){$('categoryMessage').textContent=error.message;}};
 });
 // 새 문서 이름이 서버에 있으면 그 자리에서 `이름 2`를 제안한다.
 let checkTimer=0;
 $('newDocumentName').addEventListener('input',()=>{clearTimeout(checkTimer);checkTimer=setTimeout(async()=>{
  const value=$('newDocumentName').value.trim();if(!value||!C.authenticated())return;
  try{const result=await(await C.api('/documents?'+new URLSearchParams({checkPath:value}))).json();if($('newDocumentName').value.trim()!==value)return;
   const hint=$('newDocumentNameHint');hint.replaceChildren();if(result.available)return;
   hint.append(`‘${stem(result.path)}’은(는) 이미 있습니다. `);if(result.suggestion){const use=document.createElement('button');use.type='button';use.textContent=`‘${stem(result.suggestion)}’ 쓰기`;use.onclick=()=>{$('newDocumentName').value=stem(result.suggestion);hint.replaceChildren();};hint.append(use);}
  }catch(_){}},350);});
 new MutationObserver(()=>{if($('newDocumentDialog').open){$('newDocumentNameHint').replaceChildren();if(!categories)loadCategories();}}).observe($('newDocumentDialog'),{attributes:true,attributeFilter:['open']});

 // ── 편집 중 안내(잠그지 않음) ──
 // 열 때는 읽기만, 고치기 시작하면 한 줄 쓰고, 저장하거나 다른 문서로 가면 지운다.
 const editing={doc:{id:null,written:false},node:{id:null,written:false}};
 async function release(kind){const e=editing[kind];if(e.id&&e.written){e.written=false;try{await fetch('/api/editing',{method:'DELETE',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,entity:e.id})});}catch(_){}}}
 function notice(kind,others){if(!others?.length)return;const who=others[0];const text=`${who.author}님이 ${ago(who.at)}부터 이 ${kind==='doc'?'문서':'재생목록'}를 편집 중입니다. ${kind==='doc'?'늦게 저장한 쪽은 최신 버전 불러오기나 사본 저장을 고릅니다.':'늦게 저장한 쪽의 순서로 덮어쓰고, 무엇이 바뀌었는지 알려 줍니다.'}`;if(kind==='doc')status(text);else $('playlistsMessage').textContent=text;}
 async function opened(kind,id){await release(kind);editing[kind]={id,written:false};if(!id)return;try{notice(kind,(await(await C.api('/editing?'+new URLSearchParams({kind,entity:id}))).json()).others);}catch(_){}}
 async function started(kind,id){const e=editing[kind];if(!id||e.id!==id||e.written)return;e.written=true;try{notice(kind,(await(await C.api('/editing',json('POST',{kind,entity:id}))).json()).others);}catch(_){}}
 window.addEventListener('yebaeonclouddocument',e=>{const doc=e.detail?.doc;opened('doc',doc&&doc.available!==false?doc.id:null);});
 window.addEventListener('yebaeonchange',()=>started('doc',C.linked()?.id));
 window.addEventListener('yebaeoncloudsaved',()=>release('doc'));
 const nodeKey=()=>{const p=YebaeonPlaylists.selectedPlaylist();return p?p.key.replace('/',':'):null;};
 window.addEventListener('yebaeonplaylistopen',()=>opened('node',nodeKey()));
 window.addEventListener('yebaeonorderchange',()=>started('node',nodeKey()));
 window.addEventListener('yebaeonplaylistsaved',()=>release('node'));
 window.addEventListener('pagehide',()=>{release('doc');release('node');});

 // ── 교회 Mac 상태(재설계안 7.2) ──
 async function macStatus(){
  try{const data=await(await C.api('/sync/devices')).json(),device=data.devices[0],target=$('macStatus');if(!device){target.textContent='';return;}
   const at=device.appliedAt?new Date(device.appliedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}):'적용 기록 없음';
   const waiting=device.pending?.length?` · 대기 ${device.pending.length}`:'',behind=data.head>device.appliedSeq?' · 새 변경 있음':'';
   target.textContent=`${device.name} 마지막 적용 ${at}${waiting}${behind}`;target.title=(device.pending||[]).map(p=>p.reason||p.entity).join('\n');
  }catch(_){}
 }

 // ── 문서 바로 열기: /?doc=<id> (Sync 정리 창의 [웹에서 보기]) ──
 // 입장 직후 Studio가 재생목록을 처음 불러올 때 한 번만 한다(타이머로 기다리지 않는다).
 const wanted=new URLSearchParams(location.search).get('doc'),showPlaylists=YebaeonPlaylists.show;let booted=false;
 YebaeonPlaylists.show=async(...args)=>{const result=await showPlaylists(...args);if(!booted&&C.authenticated()){booted=true;macStatus();
  if(wanted&&/^[0-9a-f-]{36}$/i.test(wanted)){C.openDocument(wanted).then(ok=>{if(ok)history.replaceState(null,'',location.pathname);});}}return result;};

 window.YebaeonLibraryManage={renameDocument,setDocumentState,renamePlaylist,trashPlaylist,openBins,admin};
})();
