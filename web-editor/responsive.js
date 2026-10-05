/* Shared responsive shell; moving existing nodes keeps their controllers and drafts. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),E=YebaeonEditor,C=YebaeonCloud,L=YebaeonPlaylists,S=YebaeonSelection;
 const compact=()=>matchMedia('(max-width:1100px)').matches,phone=()=>matchMedia('(max-width:700px)').matches;
 const studio=document.querySelector('.studio'),top=document.querySelector('.topbar'),tabs=document.querySelector('.view-tabs'),browser=document.querySelector('.playlist-browser');
 let page='playlists',searchOpen=false,multiple=false,composing=false,pendingPage=null,noticeTimer;
 const make=(tag,cls,html='')=>{const el=document.createElement(tag);el.className=cls;el.innerHTML=html;return el;};
 const button=(id,label,title=label)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);return b;};
 function dialog(id,title){const el=make('dialog','studio-dialog');el.id=id;el.setAttribute('aria-labelledby',id+'Title');el.innerHTML=`<div class="dialog-heading"><h2 id="${id}Title">${title}</h2></div>`;const close=button(id+'Close','×','닫기');close.onclick=()=>el.close();el.firstChild.append(close);document.body.append(el);return el;}
 const globalTools=make('div','studio-global-tools');globalTools.id='studioGlobalTools';top.querySelector('.segmented').before(globalTools);
 // 글꼴마다 화살표 문자 모양이 달라(맥에서 길쭉해짐) 아이콘은 SVG로 그린다.
 const svg=path=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
 $('undo').innerHTML=svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');$('undo').setAttribute('aria-label','실행취소');$('redo').innerHTML=svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>');$('redo').setAttribute('aria-label','다시 실행');
 const reset=button('studioReset','','초기화 · 브라우저 수정 내역 모두 지우기');reset.innerHTML=svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>');top.querySelector('.segmented').append(reset);
 const trash=$('libraryBins');trash.className='studio-trash';trash.textContent='';trash.title='휴지통 · 재생목록·문서';trash.setAttribute('aria-label','휴지통');trash.innerHTML=svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v5M14 11v5"/>');reset.after(trash);reset.onclick=()=>YebaeonDrafts.clearAll();
 const topSave=make('div','studio-save');topSave.id='studioTopSave';top.querySelector('.account-wrap').before(topSave);
 const help=button('studioHelp','?','사용법·단축키');help.className='studio-help';top.querySelector('.brand-name').after(help);
 $('accountMenu').prepend($('serverStatus'));
 const settings=button('studioSettings','설정·관리');$('accountMenu').prepend(settings);
 const settingsDialog=dialog('studioSettingsDialog','설정·관리');
 settingsDialog.append(make('p','dialog-help','새로 올리거나 저장한 문서는 검색 자료도 함께 갱신됩니다.'));
 const legacy=make('details','studio-legacy','<summary>기존 자료 점검</summary><p class="dialog-help">예전 자료의 본문·사용일이 검색에서 빠졌을 때만 실행하세요.</p>');settingsDialog.append(legacy);legacy.append($('indexMaintenance'));$('indexMaintenance').textContent='누락 검색 자료 점검';
 settings.onclick=()=>{$('accountMenu').hidden=true;settingsDialog.showModal();};$('indexMaintenance').addEventListener('click',()=>settingsDialog.close());
 const heading=make('header','responsive-heading','<div class="responsive-title"><button id="responsiveBack" type="button" aria-label="순서로 돌아가기">‹</button><strong id="responsiveTitle"></strong></div><div id="responsiveSave" class="studio-save"></div>');studio.prepend(heading);
 const nav=make('nav','responsive-nav');nav.setAttribute('aria-label','작업 화면');for(const [value,label]of[['playlists','재생목록'],['order','순서'],['edit','편집']]){const b=button('',label);b.dataset.page=value;b.onclick=()=>navigate(value);nav.append(b);}studio.after(nav);
 const toolbar=make('div','studio-editor-toolbar');const viewSelect=make('select','studio-view-select','<option value="slides">슬라이드</option><option value="reflow">리플로우</option><option value="editor">편집기</option>');viewSelect.id='studioViewSelect';viewSelect.setAttribute('aria-label','편집 화면');viewSelect.onchange=()=>E.setView(viewSelect.value);
 tabs.querySelectorAll('small').forEach(el=>el.remove());tabs.querySelectorAll('button').forEach(el=>{el.textContent=el.textContent.trim();});
 const tools=make('div','responsive-editor-tools','<span id="responsiveSelection"></span>');
 const quick=button('responsiveQuick','','글 고치기 (Enter)'),multi=button('responsiveMultiple','☑','여러 장 고르기'),propertiesButton=button('responsiveProperties','속성','레이어·속성'),more=button('responsiveMore','⋯','문서 메뉴');multi.setAttribute('aria-pressed','false');quick.innerHTML='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5h14M12 5v14"/><path d="M9 19h6"/></svg>';propertiesButton.setAttribute('aria-expanded','false');
 $('resourceOpen').textContent='성경';$('mediaOpen').textContent='미디어';$('add').textContent='＋';$('add').setAttribute('aria-label','새 슬라이드 추가');$('add').title='선택한 장 뒤에 새 슬라이드 추가';
 tools.append($('resourceOpen'),$('mediaOpen'),quick,$('add'),multi,propertiesButton,more);toolbar.append(tabs,viewSelect,tools);$('editorBody').before(toolbar);
 const documentDialog=dialog('studioDocumentDialog','문서 정보·서식');documentDialog.append(document.querySelector('.document-heading'));
 const info=button('responsiveDocumentInfo','문서 정보');info.hidden=true;top.append(info);info.onclick=()=>documentDialog.showModal();
 const closeProperties=button('responsivePropertiesClose','×','속성 닫기');closeProperties.className='responsive-only';closeProperties.onclick=()=>properties(false);$('inspector').prepend(closeProperties);
 const saveDialog=dialog('studioSaveDialog','저장 상태');saveDialog.append(make('p','dialog-help',''));
 saveDialog.lastChild.textContent='서버 저장은 이 탭에서 저장하지 않은 문서와 순서(저장 필요가 붙은 다른 재생목록 포함)를 한꺼번에 저장합니다. 브라우저 초안은 이 기기에만 남습니다.';
 const scopeLabel=make('p','studio-save-detail');scopeLabel.id='studioSaveDetail';const orderDetail=make('p','dialog-help');orderDetail.id='studioOrderDetail';saveDialog.append(scopeLabel,$('status'),orderDetail,$('draftState'),$('dirtyState'));
 $('saveScope').onclick=()=>{scopeLabel.textContent=L.saveScope()?.name||E.state().name.replace(/\.pro6$/i,'');saveDialog.showModal();};
 const playlistDialog=dialog('studioPlaylistsDialog','재생목록');const picker=button('studioPlaylistPicker','재생목록 ⌄','재생목록 선택');const orderMenu=button('studioOrderMenu','⋯','순서 메뉴');const pickerRow=make('div','studio-playlist-picker');pickerRow.append(picker,orderMenu);const orderWorkspace=make('section','studio-order-workspace');orderWorkspace.id='studioOrderWorkspace';$('orderPane').before(orderWorkspace);orderWorkspace.append(pickerRow,$('orderPane'));
 const orderHeading=$('playlistsTitle').parentElement;const orderLabel=make('strong','','순서');orderLabel.id='studioOrderCount';orderHeading.prepend(orderLabel);orderHeading.append(make('span','studio-drag-hint','⠿ 끌어 이동'));$('playlistsTitle').hidden=true;
 $('playlistNew').textContent='＋ 재생목록';
 const documentAdd=make('div','studio-document-add');$('documentNew').textContent='＋ 새 문서';documentAdd.append($('documentNew'));$('playlistItems').after(documentAdd);
 const historyInfo=make('div','studio-hidden-actions');historyInfo.hidden=true;historyInfo.append($('playlistHistory'),$('playlistSummary'));document.body.append(historyInfo);
 document.querySelector('.playlist-footer').hidden=true;document.querySelector('.editor-footer').hidden=true;$('libraryDivider').hidden=true;
 const documents=$('documentsPane'),searchHeading=documents.querySelector('.pane-heading');searchHeading.querySelector('strong').hidden=true;
 historyInfo.append($('librarySort'));
 $('libraryRefresh').textContent='⌕';$('libraryRefresh').setAttribute('aria-label','이름·본문 검색');
 const fold=button('studioSearchFold','×','검색 결과 접기');searchHeading.append(fold);fold.onclick=()=>{documents.classList.toggle('search-folded');fold.textContent=documents.classList.contains('search-folded')?'⌄':'×';fold.setAttribute('aria-label',documents.classList.contains('search-folded')?'검색 결과 펼치기':'검색 결과 접기');};
 const expandSearch=()=>{documents.classList.remove('search-folded');fold.textContent='×';fold.setAttribute('aria-label','검색 결과 접기');};
 $('libraryRefresh').addEventListener('click',expandSearch);$('libraryQuery').addEventListener('keydown',e=>{if(e.key==='Enter')expandSearch();});documents.append(documents.querySelector('.library-archive-filter'));
 const fab=button('responsiveSearch','','문서 검색');fab.className='responsive-search-button';fab.innerHTML='<span class="search-symbol" aria-hidden="true"></span>';fab.setAttribute('aria-expanded','false');studio.append(fab);
 const drawer=make('section','responsive-search-drawer','<div class="responsive-drawer-body"><header><strong>순서에 문서 추가</strong><button id="responsiveSearchClose" type="button" aria-label="검색 닫기">×</button></header><div id="responsiveSearchSlot"></div><p id="responsiveSearchStatus" role="status"></p></div>');drawer.id='responsiveSearchDrawer';drawer.hidden=true;drawer.setAttribute('aria-label','순서에 문서 추가');studio.append(drawer);
 const notice=make('p','responsive-notice');notice.id='responsiveNotice';notice.setAttribute('role','status');notice.hidden=true;document.body.append(notice);
 function tell(text){if(!text)return;notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,4200);}
 function properties(open){document.body.classList.toggle('responsive-properties',open&&compact());propertiesButton.setAttribute('aria-expanded',String(open&&compact()));}
 function closeSearch(focus=true){window.YebaeonStudioDrag?.cancel();searchOpen=false;drawer.hidden=true;fab.setAttribute('aria-expanded','false');if(focus&&phone())fab.focus();}
 function closeOverlays(){closeSearch(false);properties(false);if($('quickDialog').open)$('quickDialog').close();window.YebaeonResources?.closeBible();$('mediaDrawer').hidden=true;$('contextMenu').hidden=true;}
 function navigate(value){if(window.YebaeonSave?.busy())return;if(composing){pendingPage=value;return;}closeOverlays();page=value;update();if(value==='edit')E.selection.activate();else if(value==='order')L.selection.activate();}
 function search(){if(window.YebaeonSave?.busy())return;expandSearch();if(phone()){if(!L.selectedPlaylist()){tell('문서를 추가할 재생목록을 먼저 선택하세요.');navigate('playlists');return;}properties(false);page='order';searchOpen=true;update();drawer.hidden=false;fab.setAttribute('aria-expanded','true');}$('libraryQuery').focus();}
 function append(id){if(window.YebaeonSave?.busy())return;const doc=C.listedDocument(id);if(!doc)return;const ok=L.appendDocuments([doc]);const text=ok?doc.name.replace(/\.pro6$/i,'')+' · 순서 맨 아래에 추가됨':$('playlistsMessage').textContent;$('responsiveSearchStatus').textContent=text;tell(text);}
 function menuAt(button,items){const r=button.getBoundingClientRect();S.menu({preventDefault(){},clientX:r.left,clientY:r.bottom},items);}
 picker.onclick=()=>{if(phone())navigate('playlists');else playlistDialog.showModal();};
 orderMenu.onclick=()=>menuAt(orderMenu,[{label:'순서 저장 이력',disabled:$('playlistHistory').disabled,action:()=>$('playlistHistory').click()},{label:'순서 새로고침',action:()=>$('playlistsRefresh').click()}]);
 more.onclick=()=>menuAt(more,[{label:'문서 정보·서식',action:()=>documentDialog.showModal()},{label:'문서 복제',disabled:!E.ready()||C.linked()?.id!==E.state().key,action:()=>YebaeonLibraryActions.duplicate(C.linked())},{label:'배경 일괄 바꾸기',disabled:!E.ready(),action:()=>YebaeonPPTImport.editBackground()},{label:'문서 저장 이력',disabled:$('cloudHistory').hidden,action:()=>$('cloudHistory').click()},{label:'검색·이력 설정',disabled:$('documentPolicy').hidden,action:()=>$('documentPolicy').click()},{label:'선택 슬라이드 작업',action:()=>{const r=more.getBoundingClientRect();E.selection.options.menu({preventDefault(){},clientX:r.left,clientY:r.bottom});}}]);
 quick.onclick=()=>E.quick();propertiesButton.onclick=()=>properties(!document.body.classList.contains('responsive-properties'));
 multi.onclick=()=>{multiple=!multiple;multi.setAttribute('aria-pressed',String(multiple));multi.title=multiple?'여러 장 고르기 끝내기':'여러 장 고르기';};
 const helpDialog=dialog('studioHelpDialog','사용법·단축키');helpDialog.insertAdjacentHTML('beforeend','<ol class="studio-help-steps"><li>검색 결과의 ＋ 버튼을 누르면 순서 맨 아래에 추가됩니다. 손잡이를 끌면 원하는 위치에 넣을 수 있습니다.</li><li>순서의 제목을 눌러 문서를 열고, 편집 화면에서 슬라이드를 추가합니다.</li><li>서버 저장으로 현재 예배의 수정한 문서와 순서를 저장합니다.</li></ol><label class="studio-help-platform">단축키 <select id="studioShortcutOS"><option value="windows">Windows</option><option value="mac">Mac</option></select></label><dl id="studioShortcutList"></dl><details class="studio-help-more"><summary>선택·편집 단축키</summary><p>방향키: 선택 이동 · Shift: 범위 선택 · Ctrl/⌘: 여러 항목 선택<br>Ctrl/⌘ + A/C/X/V: 전체 선택·복사·잘라내기·붙여넣기<br>Delete: 선택 항목 삭제 · F2: 이름 변경<br>Alt/Option + Enter: 리플로우 나누기 · 맨 앞 Backspace: 앞 장에 합치기</p><p>글 입력 중에는 입력란의 편집 동작을 우선합니다.</p></details>');
 function shortcuts(){const mac=$('studioShortcutOS').value==='mac',mod=mac?'⌘':'Ctrl',alt=mac?'왼쪽 Option':'왼쪽 Alt';$('studioShortcutList').replaceChildren();for(const [name,key]of[['서버 저장',mod+' + S'],['문서 검색',mod+' + F'],['실행취소',mod+' + Z'],['다시 실행',mod+' + Shift + Z / '+mod+' + Y'],['문서 열기·빠른 편집','Enter'],['닫기·선택 해제','Esc'],['리플로우 / 편집기',alt+' + R / E'],['성경 / 미디어',alt+' + B / V']]){const row=make('div','','<dt></dt><dd><kbd></kbd></dd>');row.querySelector('dt').textContent=name;row.querySelector('kbd').textContent=key;$('studioShortcutList').append(row);}}
 $('studioShortcutOS').value=/Mac|iPhone|iPad/.test(navigator.platform)?'mac':'windows';$('studioShortcutOS').onchange=shortcuts;shortcuts();help.onclick=()=>helpDialog.showModal();
 function decorate(){for(const row of $('libraryList').querySelectorAll('.document-item')){if(!row.querySelector('.responsive-add')){const b=button('','＋',row.querySelector('strong').textContent+' 순서 맨 아래에 추가');b.className='responsive-add';row.append(b);}}for(const row of $('playlistItems').querySelectorAll('.order-item:not(.is-header)'))if(!row.querySelector('.responsive-order-menu')){const b=button('','⋯','순서 항목 메뉴');b.className='responsive-order-menu';row.append(b);}}
 function update(){const current=L.selectedPlaylist();document.body.classList.toggle('responsive',compact());document.body.dataset.page=page;
  $('responsiveTitle').textContent=page==='playlists'&&phone()?'재생목록':phone()&&page==='order'?(current?.name||'순서'):E.state().name.replace(/\.pro6$/i,'');
  $('responsiveBack').hidden=!phone()||page==='playlists';picker.textContent=(current?.name||'재생목록')+' ⌄';picker.title=current?.name||'재생목록 선택';
  nav.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.page===page)));fab.hidden=!phone()||page!=='order';fab.disabled=!current?.editable;
  $('studioOrderCount').textContent='순서 '+L.selection.keys.length;
  $('documentNew').disabled=!current?.editable||L.state().busy||L.state().blocked||!!window.YebaeonSave?.busy();
  viewSelect.value=E.view();const chosen=E.selection.values().length,total=$('slideCount').textContent.replace(/장.*/,'');$('responsiveSelection').textContent=E.ready()?(chosen>1?chosen+'장 선택':chosen||E.view()==='editor'?(E.selected()+1)+' / '+total:total+'장'):'';
  for(const b of[quick,multi,more,propertiesButton])b.disabled=!E.ready();propertiesButton.hidden=E.view()!=='editor'||!compact();multi.hidden=E.view()==='editor';
  $('resourceOpen').hidden=E.view()!=='slides';$('mediaOpen').hidden=E.view()!=='slides';if(E.view()!=='editor')properties(false);window.YebaeonSave?.update();
 }
 function viewport(){const v=window.visualViewport;document.body.classList.toggle('responsive-keyboard',!!v&&innerHeight-v.height>150);document.documentElement.style.setProperty('--responsive-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--keyboard-offset',Math.max(0,innerHeight-(v?.height||innerHeight)-(v?.offsetTop||0))+'px');}
 function layout(){window.YebaeonStudioDrag?.cancel();closeSearch(false);properties(false);
  if(phone()){document.querySelector('.playlist-columns').prepend(browser);$('responsiveSearchSlot').append(documents);}else{playlistDialog.append(browser);orderWorkspace.insertBefore(documents,$('orderPane'));}
  (compact()?$('responsiveSave'):topSave).append($('saveScope'),$('cloudSave'));viewport();update();decorate();
 }
 $('responsiveBack').onclick=()=>navigate(page==='edit'?'order':'playlists');fab.onclick=search;$('responsiveSearchClose').onclick=()=>closeSearch();
 document.addEventListener('compositionstart',()=>composing=true);document.addEventListener('compositionend',()=>{composing=false;if(pendingPage){const next=pendingPage;pendingPage=null;setTimeout(()=>navigate(next),0);}});
 document.addEventListener('click',event=>{const add=event.target.closest('#libraryList .document-item .responsive-add');if(add){event.preventDefault();event.stopImmediatePropagation();if(L.selectedPlaylist())append(add.closest('.document-item').dataset.key);else tell('문서를 추가할 재생목록을 먼저 선택하세요.');return;}const menu=event.target.closest('.responsive-order-menu');if(menu){event.preventDefault();event.stopImmediatePropagation();L.selection.select(menu.parentElement.dataset.key);const r=menu.getBoundingClientRect();L.selection.options.menu({preventDefault(){},clientX:r.left,clientY:r.bottom});return;}const card=event.target.closest('.slide-card');if(multiple&&card){event.preventDefault();event.stopImmediatePropagation();E.selection.select(card.dataset.key,{ctrlKey:true});}},true);
 document.addEventListener('keydown',event=>{if(event.isComposing||event.key!=='Escape'||window.YebaeonStudioDrag?.active())return;if($('quickDialog').open){event.preventDefault();event.stopImmediatePropagation();$('quickDialog').close();}else if(searchOpen){event.preventDefault();event.stopImmediatePropagation();closeSearch();}else if(document.body.classList.contains('responsive-properties')){event.preventDefault();event.stopImmediatePropagation();properties(false);propertiesButton.focus();}},true);
 for(const id of['libraryList','playlistItems'])new MutationObserver(()=>{decorate();update();}).observe($(id),{childList:true});
 new MutationObserver(()=>{const text=$('playlistsMessage').textContent;orderDetail.textContent=text;$('playlistsMessage').hidden=!text||/^(브라우저 초안 보존됨|순서 변경됨|순서 저장됨|서버 목록을 갱신했습니다)/.test(text);}).observe($('playlistsMessage'),{childList:true,characterData:true,subtree:true});
 new MutationObserver(()=>tell($('status').textContent)).observe($('status'),{childList:true,characterData:true,subtree:true});
 new MutationObserver(()=>{if(/실패/.test($('draftState').textContent))tell($('draftState').textContent);}).observe($('draftState'),{childList:true,characterData:true,subtree:true});
 for(const event of['yebaeonrender','yebaeonselection','yebaeonorderhistory','yebaeoncloudsaved','yebaeonsession'])window.addEventListener(event,()=>queueMicrotask(update));
 window.addEventListener('yebaeonplaylistopen',()=>{playlistDialog.close();navigate('order');});window.addEventListener('yebaeonclouddocument',()=>{if(phone())navigate('edit');});
 matchMedia('(max-width:1100px)').addEventListener('change',layout);matchMedia('(max-width:700px)').addEventListener('change',layout);
 window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);window.addEventListener('resize',viewport);
 window.YebaeonResponsive={compact,phone,search,navigate,page:()=>page,closeSearch,tell};layout();
})();
