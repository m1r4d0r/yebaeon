/* Responsive shell reuses the existing editor, search and CAS save controllers. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),E=YebaeonEditor,C=YebaeonCloud,L=YebaeonPlaylists;
 const compact=()=>matchMedia('(max-width:1100px)').matches,phone=()=>matchMedia('(max-width:700px)').matches;
 const studio=document.querySelector('.studio'),editing=document.querySelector('.editing-column'),tabs=document.querySelector('.view-tabs');
 let page='playlists',searchOpen=false,multiple=false,drag=null,suppressClickUntil=0,composing=false,pendingPage=null;
 const homes=new Map();
 for(const node of [$('documentsPane'),tabs,$('cloudSave'),$('saveScope'),$('serverStatus'),$('playlistHistory'),$('playlistSummary')]){const marker=document.createComment('responsive home');node.before(marker);homes.set(node,marker);}
 const heading=document.createElement('header');heading.className='responsive-heading';heading.innerHTML='<div class="responsive-title"><button id="responsiveBack" type="button"></button><strong id="responsiveTitle"></strong></div><div id="responsiveSave"></div>';
 studio.prepend(heading);
 const nav=document.createElement('nav');nav.className='responsive-nav';nav.setAttribute('aria-label','작업 화면');
 for(const [value,label] of [['playlists','재생목록'],['order','순서'],['edit','편집']]){const b=document.createElement('button');b.type='button';b.dataset.page=value;b.textContent=label;b.onclick=()=>navigate(value);nav.append(b);}studio.after(nav);
 const side=document.createElement('div');side.className='responsive-side-tabs';side.innerHTML='<button type="button" data-page="playlists">재생목록</button><button type="button" data-page="order">순서</button>';
 document.querySelector('.library-column').prepend(side);side.querySelectorAll('button').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
 const tools=document.createElement('div');tools.className='responsive-editor-tools';tools.innerHTML='<span id="responsiveSelection"></span><button id="responsiveMultiple" type="button" aria-pressed="false">여러 장</button><button id="responsiveQuick" type="button">글 수정</button><button id="responsiveProperties" type="button" aria-expanded="false">레이어·속성</button><button id="responsiveMore" type="button" aria-label="슬라이드 작업 더보기">•••</button>';
 $('editorBody').before(tools);
 // Keep infrequent document controls available without consuming the phone canvas.
 const documentDetails=document.querySelector('.document-heading');documentDetails.id='responsiveDocumentDetails';
 const documentToggle=document.createElement('button');documentToggle.id='responsiveDocumentInfo';documentToggle.className='responsive-document-toggle';documentToggle.type='button';documentToggle.textContent='문서 정보';documentToggle.setAttribute('aria-controls',documentDetails.id);documentToggle.setAttribute('aria-expanded','false');documentToggle.title='서식 · 버전 · 이력 · 검색 설정';tabs.append(documentToggle);
 function documentInfo(open){document.body.classList.toggle('responsive-document-info',open&&phone());documentToggle.setAttribute('aria-expanded',String(open&&phone()));}
 documentToggle.onclick=()=>documentInfo(!document.body.classList.contains('responsive-document-info'));
 const closeProperties=document.createElement('button');closeProperties.id='responsivePropertiesClose';closeProperties.className='responsive-only';closeProperties.textContent='속성 닫기';closeProperties.onclick=()=>properties(false);$('inspector').prepend(closeProperties);
 const fab=document.createElement('button');fab.id='responsiveSearch';fab.className='responsive-search-button';fab.type='button';fab.setAttribute('aria-label','문서 검색');fab.setAttribute('aria-expanded','false');fab.innerHTML='<span class="search-symbol" aria-hidden="true"></span>';studio.append(fab);
 const drawer=document.createElement('section');drawer.id='responsiveSearchDrawer';drawer.className='responsive-search-drawer';drawer.hidden=true;drawer.setAttribute('aria-label','순서에 문서 추가');
 drawer.innerHTML='<div id="responsiveDrop" class="responsive-drop">여기에 놓으면 순서 맨 아래에 추가</div><div class="responsive-drawer-body"><header><strong>순서에 문서 추가</strong><button id="responsiveSearchClose" type="button" aria-label="검색 닫기">닫기</button></header><div id="responsiveSearchSlot"></div><p id="responsiveSearchStatus" role="status">검색 결과를 누르거나 손잡이를 끌어 추가하세요.</p></div>';studio.append(drawer);
 const notice=document.createElement('p');notice.id='responsiveNotice';notice.className='responsive-notice';notice.setAttribute('role','status');notice.hidden=true;studio.append(notice);let noticeTimer;
 function tell(text){notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,3500);}
 function properties(open){document.body.classList.toggle('responsive-properties',open&&compact());$('responsiveProperties').setAttribute('aria-expanded',String(open&&compact()));if(open)$('inspector').querySelector('button,input,select,textarea')?.focus();}
 function closeOverlays(){documentInfo(false);closeSearch(false);properties(false);if($('quickDialog').open)$('quickDialog').close();window.YebaeonResources?.closeBible();$('mediaDrawer').hidden=true;$('contextMenu').hidden=true;}
 function navigate(value){if(window.YebaeonSave?.busy())return;if(composing){pendingPage=value;return;}closeOverlays();page=value;update();if(value==='edit'){E.selection.activate();}else if(value==='order')L.selection.activate();}
 function closeSearch(focus=true){cancelDrag();searchOpen=false;drawer.hidden=true;fab.setAttribute('aria-expanded','false');if(focus&&compact())fab.focus();}
 function search(){if(!compact()){$('libraryQuery').focus();return;}if(window.YebaeonSave?.busy())return;if(!L.selectedPlaylist()){tell('문서를 추가할 재생목록을 먼저 선택하세요.');navigate('playlists');return;}properties(false);if(phone())page='order';update();searchOpen=true;drawer.hidden=false;fab.setAttribute('aria-expanded','true');$('responsiveDrop').textContent='여기에 놓으면 순서 맨 아래에 추가';$('responsiveSearchStatus').textContent='검색 결과를 누르거나 손잡이를 끌어 추가하세요.';$('libraryQuery').focus();}
 function append(id){if(!compact()||!searchOpen||window.YebaeonSave?.busy())return;const doc=C.listedDocument(id);if(!doc)return;const ok=L.appendDocuments([doc]);$('responsiveSearchStatus').textContent=ok?doc.name.replace(/\.pro6$/i,'')+' · 순서 맨 아래에 추가했어요.':$('playlistsMessage').textContent;}
 function menuAt(button,selection){const rect=button.getBoundingClientRect();selection.options.menu({preventDefault(){},clientX:rect.left,clientY:rect.bottom});}
 function decorate(){
  for(const row of $('libraryList').querySelectorAll('.document-item')){row.draggable=!compact();if(!row.querySelector('.responsive-drag')){
   const grip=document.createElement('button');grip.type='button';grip.className='responsive-drag responsive-only';grip.textContent='';grip.setAttribute('aria-label',row.querySelector('strong').textContent+' 끌어 순서에 추가');row.prepend(grip);
   const add=document.createElement('button');add.type='button';add.className='responsive-add responsive-only';add.textContent='＋';add.setAttribute('aria-label',row.querySelector('strong').textContent+' 순서 맨 아래에 추가');row.append(add);
  }}
  for(const row of $('playlistItems').querySelectorAll('.order-item'))if(!row.querySelector('.responsive-order-menu')){
   const button=document.createElement('button');button.type='button';button.className='responsive-order-menu responsive-only';button.textContent='⋮';button.setAttribute('aria-label',row.querySelector('strong').textContent+' 순서 작업');row.append(button);
  }
 }
 function update(){
  const narrow=compact(),current=L.selectedPlaylist();document.body.classList.toggle('responsive',narrow);document.body.dataset.page=page;
  $('responsiveTitle').textContent=page==='playlists'?'재생목록':page==='order'?(current?.name||'순서'):E.state().name.replace(/\.pro6$/i,'');
  const backLabel=page==='edit'?(current?.name||'재생목록')+' 순서':'재생목록';$('responsiveBack').textContent=phone()?'‹':'‹ '+backLabel;$('responsiveBack').setAttribute('aria-label',backLabel+'로 돌아가기');$('responsiveBack').title=backLabel+'로 돌아가기';$('responsiveBack').hidden=page==='playlists';documentToggle.disabled=!E.ready();
  for(const b of document.querySelectorAll('.responsive-nav button,.responsive-side-tabs button')){const active=b.dataset.page===page;b.setAttribute('aria-pressed',String(active));}
  fab.hidden=!narrow||page==='playlists'||(phone()&&page!=='order');fab.disabled=!current?.editable;
  tools.hidden=E.view()==='reflow';$('responsiveSelection').textContent=E.ready()?(E.selection.values().length>1?E.selection.values().length+'장 선택':(E.selected()+1)+'번 선택'):'';
  for(const id of ['responsiveQuick','responsiveMore','responsiveMultiple','responsiveProperties'])$(id).disabled=!E.ready();
  $('responsiveProperties').hidden=E.view()!=='editor';$('responsiveMultiple').hidden=E.view()==='editor';
  if(E.view()!=='editor')properties(false);
  window.YebaeonSave?.update();
 }
 function viewport(){const v=window.visualViewport;document.body.classList.toggle('responsive-keyboard',!!v&&innerHeight-v.height>150);document.documentElement.style.setProperty('--responsive-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--keyboard-offset',Math.max(0,innerHeight-(v?.height||innerHeight)-(v?.offsetTop||0))+'px');}
 const playlistHistoryLabel=$('playlistHistory').textContent;
 function historyLayout(){
  if(phone()){$('accountMenu').prepend($('playlistHistory'),$('playlistSummary'));$('playlistHistory').textContent='현재 순서 이력';}
  else{for(const node of [$('playlistHistory'),$('playlistSummary')])homes.get(node).after(node);$('playlistHistory').textContent=playlistHistoryLabel;}
 }
 function layout(){
  if($('quickDialog').open)$('quickDialog').close();
  if(compact()){$('responsiveSearchSlot').append($('documentsPane'));editing.insertBefore(tabs,tools);$('responsiveSave').append($('cloudSave'),$('saveScope'));$('accountMenu').prepend($('serverStatus'));}
  else{closeSearch(false);properties(false);for(const [node,marker] of homes)marker.after(node);}
  historyLayout();viewport();update();decorate();
 }
 $('playlistHistory').addEventListener('click',()=>{$('accountMenu').hidden=true;$('cloudAccount').setAttribute('aria-expanded','false');});
 $('responsiveBack').onclick=()=>navigate(page==='edit'?'order':'playlists');fab.onclick=search;$('responsiveSearchClose').onclick=()=>closeSearch();
 $('responsiveQuick').onclick=()=>E.quick();$('responsiveProperties').onclick=()=>properties(!document.body.classList.contains('responsive-properties'));
 $('responsiveMultiple').onclick=()=>{multiple=!multiple;$('responsiveMultiple').setAttribute('aria-pressed',String(multiple));$('responsiveMultiple').textContent=multiple?'선택 완료':'여러 장';};
 $('responsiveMore').onclick=()=>menuAt($('responsiveMore'),E.selection);
 document.addEventListener('compositionstart',()=>composing=true);document.addEventListener('compositionend',()=>{composing=false;if(pendingPage){const next=pendingPage;pendingPage=null;setTimeout(()=>navigate(next),0);}});
 document.addEventListener('click',event=>{
  if(!compact())return;
  if(event.target.closest('#libraryList')&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
  const row=event.target.closest('#libraryList .document-item');
  if(searchOpen&&row){event.preventDefault();event.stopImmediatePropagation();if(!event.target.closest('.responsive-drag'))append(row.dataset.key);return;}
  const more=event.target.closest('.responsive-order-menu');if(more){event.preventDefault();event.stopImmediatePropagation();L.selection.select(more.parentElement.dataset.key);menuAt(more,L.selection);return;}
  const card=event.target.closest('.slide-card');if(multiple&&card){event.preventDefault();event.stopImmediatePropagation();E.selection.select(card.dataset.key,{ctrlKey:true});}
 },true);
 document.addEventListener('keydown',event=>{
  if(!compact()||event.isComposing)return;
  if(event.key==='Escape'&&$('quickDialog').open){event.preventDefault();event.stopImmediatePropagation();$('quickDialog').close();}
  else if(event.key==='Escape'&&searchOpen){event.preventDefault();event.stopImmediatePropagation();closeSearch();}
  else if(event.key==='Escape'&&document.body.classList.contains('responsive-properties')){event.preventDefault();event.stopImmediatePropagation();properties(false);$('responsiveProperties').focus();}
  else if(searchOpen&&event.target.closest('#libraryList .document-item')&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();append(event.target.closest('.document-item').dataset.key);}
 },true);
 // A dedicated handle leaves ordinary touch scrolling and click-to-add intact.
 drawer.addEventListener('dragstart',event=>{if(compact())event.preventDefault();});
 drawer.addEventListener('pointerdown',event=>{const handle=event.target.closest('.responsive-drag');if(!handle||!compact()||event.button!==0)return;const current=L.selectedPlaylist();if(!current)return;drag={handle,id:handle.parentElement.dataset.key,key:current.key,pointer:event.pointerId,x:event.clientX,y:event.clientY,moved:false};handle.setPointerCapture(event.pointerId);});
 drawer.addEventListener('pointermove',event=>{if(!drag||drag.pointer!==event.pointerId)return;if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<7&&!drag.moved)return;drag.moved=true;event.preventDefault();let ghost=$('responsiveDragGhost');if(!ghost){ghost=document.createElement('div');ghost.id='responsiveDragGhost';ghost.textContent=C.listedDocument(drag.id)?.name||'문서';document.body.append(ghost);}ghost.style.left=Math.min(innerWidth-220,Math.max(8,event.clientX-90))+'px';ghost.style.top=(event.clientY-48)+'px';const box=$('responsiveDrop').getBoundingClientRect();$('responsiveDrop').classList.toggle('over',event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom);});
 function cancelDrag(){if(!drag)return;const old=drag;drag=null;if(old.handle.hasPointerCapture(old.pointer))old.handle.releasePointerCapture(old.pointer);$('responsiveDragGhost')?.remove();$('responsiveDrop').classList.remove('over');}
 drawer.addEventListener('pointerup',()=>{if(!drag)return;const old=drag,valid=old.moved&&$('responsiveDrop').classList.contains('over')&&old.key===L.selectedPlaylist()?.key;cancelDrag();if(old.moved)suppressClickUntil=Date.now()+400;if(valid)append(old.id);});
 drawer.addEventListener('pointercancel',cancelDrag);drawer.addEventListener('lostpointercapture',cancelDrag);window.addEventListener('blur',cancelDrag);
 for(const id of ['libraryList','playlistItems'])new MutationObserver(decorate).observe($(id),{childList:true});
 for(const event of ['yebaeonrender','yebaeonselection','yebaeonorderhistory','yebaeoncloudsaved','yebaeonsession'])window.addEventListener(event,()=>queueMicrotask(update));
 window.addEventListener('yebaeonplaylistopen',()=>{if(compact())navigate('order');});
 window.addEventListener('yebaeonclouddocument',()=>{if(compact())navigate('edit');});
 matchMedia('(max-width:1100px)').addEventListener('change',layout);matchMedia('(max-width:700px)').addEventListener('change',()=>{closeSearch(false);documentInfo(false);historyLayout();update();});
 window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
 window.YebaeonResponsive={compact,search,navigate,page:()=>page};layout();decorate();
})();
