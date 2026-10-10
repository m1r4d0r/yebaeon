(function () {
  'use strict';
  const $ = id => document.getElementById(id), editor = window.YebaeonEditor;
  const online = /^https?:$/.test(location.protocol);
  let workspaceReady=false;
  let user = null, ready = false, linked = null, epoch = 0, saving = false;
  const drafts = window.YebaeonDrafts;
  let draftID = drafts.id(), baseXML = editor.document().xml, draftMark = null;
  const contexts=new Map(); let openSequence=0, documents=[], activityNext=null, activityScope='mine';
  // Verified originals only. Recheck metadata on every open; never cache authorization.
  const originals=new Map();let originalBytes=0;
  function rememberOriginal(doc,xml){const old=originals.get(doc.id);if(old)originalBytes-=old.xml.length*2;originals.delete(doc.id);if(xml.length*2<=16*1024*1024){originals.set(doc.id,{version:doc.version,sha256:doc.sha256,xml});originalBytes+=xml.length*2;}while(originalBytes>24*1024*1024||originals.size>24){const first=originals.keys().next().value;originalBytes-=originals.get(first).xml.length*2;originals.delete(first);}}
  const select=new YebaeonSelection.Selection($('documentsPane'),{kind:'documents',undo:redo=>editor.undo(redo),open:()=>openCloud(select.cursor,false,documents.find(d=>d.id===select.cursor)),copy:()=>YebaeonSelection.copy({kind:'documents',documents:documents.filter(d=>select.chosen.has(d.id))})});
  let activitySequence=0;
  let listNext = null, listSequence = 0, historyDoc = null, historyNext = null;
  const rememberName = name => { try { localStorage.setItem('yebaeon.workerName', name); } catch (_) {} };
  const recalledName = () => { try { return localStorage.getItem('yebaeon.workerName') || ''; } catch (_) { return ''; } };
  const time = value => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short',timeZone:'Asia/Seoul' });
  function update() {
    window.dispatchEvent(new CustomEvent("yebaeonsession", { detail: { authenticated: !!user } }));
    $('cloudAccount').textContent = online ? (user ? user.name + ' ▾' : '입장하기') : '연결 안 됨';
    window.YebaeonPanels?.accountName(user?.name);
    $('cloudAccount').disabled = !online;
    $('cloudSave').disabled = !user || saving || !linked;
    $('cloudSave').textContent = saving ? '저장 중…' : '문서 서버 저장 Ctrl+S';
    $('cloudHistory').hidden = !linked || !user;
    $('documentPolicy').hidden=!linked||!user;
    const changed = linked && editor.state().serial !== linked.serial;
    $('dirtyState').textContent=editor.state().dirty ? '저장 안 됨' : '';
    $('locationTitle').textContent=linked ? (window.YebaeonPlaylists?.currentName?.() ? window.YebaeonPlaylists.currentName()+' › ' : '')+editor.state().name.replace(/\.pro6$/i,'') : '';
    $('cloudContext').textContent = linked ? `서버 v${linked.version} · ${linked.updatedBy} · ${time(linked.updatedAt)}` : '';
    window.YebaeonSave?.update();
  }
  function checkpointDraft() {
    if(!editor.state().dirty)return Promise.resolve();
    const current = editor.document();
    if (!current.dirty) return Promise.resolve();
    const record = { id:draftID, kind:'document', name:current.name, author:user?.name || recalledName(), base:linked ? {...linked} : null, baseXML, xml:current.xml, serial:current.serial, ...(draftMark ? {bulletin:draftMark} : {}) };
    return drafts.put(record).then(() => drafts.notify(editor.hasPackageMedia() ? '문서 초안 보존 · 새 미디어는 ZIP으로 별도 저장 필요' : '브라우저에 초안 보존됨 · 서버 저장은 별도'));
  }
  async function preserveWorkerDrafts() {
    await checkpointDraft();
    if(window.YebaeonPlaylists?.preserveWorkerDrafts)await window.YebaeonPlaylists.preserveWorkerDrafts();
    draftID=drafts.id();
  }
  async function restoreDraft(record) {
    if (!record || record.kind !== 'document' || typeof record.xml !== 'string' || typeof record.baseXML !== 'string') throw new Error('복구할 문서 초안 형식이 올바르지 않습니다.');
    await checkpointDraft();
    if(linked)contexts.set(linked.id,{linked:{...linked},baseXML,draftID,mark:draftMark});
    if (!editor.open(record.xml, record.name,false,record.base?.id||record.name)) return false;
    linked = record.base ? {...record.base,serial:-1} : null; baseXML=record.baseXML; draftMark=record.bulletin||null;
    editor.markDirty(); await checkpointDraft(); update();
    return true;
  }
  // 문서를 서버에 쓰는 모든 요청(저장·일괄 저장·사본·새 문서·PPT 가져오기·복원)은 PP6 필수 구조 중 빠진 것을 채워 보낸다(PP6.repairXML).
  const documentWrite = (path, options) => /^\/documents(?:\/[^/?]+)?(?:\?|$)/.test(path) && ['PUT', 'POST'].includes(options.method) && typeof options.body === 'string' && /xml/.test(options.headers?.['Content-Type'] || '');
  async function api(path, options = {}) {
    if (documentWrite(path, options) && window.PP6?.repairXML) options = { ...options, body: window.PP6.repairXML(options.body) };
    const response = await fetch('/api' + path, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.error === 'login_required') { user = null; update(); }
      const error = new Error(data.message || '서버에 연결하지 못했습니다.');
      error.status = response.status; error.code = data.error; throw error;
    }
    return response;
  }
  function showEntry() {
    $('entryName').value = recalledName();
    $('entryPassword').value = '';
    $('entrySubmit').disabled = !ready;
    $('entryMessage').textContent = ready ? '' : '서버의 공용 비밀번호 설정이 아직 완료되지 않았습니다.';
    if (!$('entryDialog').open) $('entryDialog').showModal();
  }
  async function showPlaylists() {
    if (!window.YebaeonPlaylists) await new Promise(resolve => window.addEventListener('yebaeonplaylistsready', resolve, { once: true }));
    await Promise.all([list(),window.YebaeonPlaylists.show()]);
    workspaceReady=true;window.dispatchEvent(new Event('yebaeonworkspaceready'));
  }
  function needUser() { if (user) return true; showEntry(); return false; }

  function empty(target, message) { const div = document.createElement('div'); div.className = 'library-empty'; div.textContent = message; target.append(div); }
  async function list(more = false) {
    if (!needUser()) return;
    const sequence = ++listSequence, query = $('libraryQuery').value.trim();
    const scroll = more ? null : $('libraryList').scrollTop;
    if (!more) { listNext = null; documents=[]; $('libraryList').replaceChildren(); }
    $('libraryMore').hidden = true;
    if(!query){select.setKeys([]);empty($('libraryList'),'검색어를 입력해주세요');$('libraryMessage').textContent='';return;}
    $('libraryMessage').textContent = '검색하고 있습니다…';
    try {
      const data=await YebaeonSearch.query(query,{cursor:more?listNext:null,includeArchived:$('libraryArchived').checked,fresh:!more});
      if (sequence !== listSequence) return;
      for (const doc of data.documents) {
        documents.push(doc);const item=document.createElement('div');item.className='document-item';select.bind(item,doc.id);
        const name=document.createElement('strong');name.textContent=doc.name.replace(/\.pro6$/i,'');const small=document.createElement('small');
        const date=doc.lastDateUsed ? new Date(doc.lastDateUsed).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',timeZone:'Asia/Seoul'})+' 사용' : '사용일 없음';
        small.textContent=doc.available===false?'원본 미업로드 · 편집 불가':doc.matchedBy==='content'?'본문 일치':date;item.classList.toggle('unavailable',doc.available===false);item.append(window.YebaeonSyncLights.dot('document',doc.id,''),name,small);item.title=doc.path+(doc.localPresent===false?' · 마지막 Mac 인덱스에서 없음 · 서버 원본과 이력은 보존됩니다.':'');
        item.addEventListener('click',e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey)openCloud(doc.id,false,doc);});
        item.oncontextmenu=e=>{if(!select.chosen.has(doc.id))select.select(doc.id);YebaeonSelection.menu(e,[{label:'열기 Enter',action:()=>openCloud(doc.id,false,doc)},{label:'문서 복제',disabled:doc.available===false,action:()=>YebaeonLibraryActions.duplicate(doc)},{label:'순서에 복사 Ctrl+C',action:()=>select.options.copy()},{label:'선택 문서를 찬양용으로 설정',action:()=>applySelectedPolicy(true,false)},{label:'선택 문서를 예배순서용으로 설정',action:()=>applySelectedPolicy(true,true)},{label:'이름 바꾸기',disabled:doc.available===false,action:()=>YebaeonLibraryManage.renameDocument(doc)},{label:'휴지통으로',disabled:doc.available===false,action:()=>YebaeonLibraryManage.setDocumentState(documents.filter(d=>select.chosen.has(d.id)&&d.available!==false),'trash')}]);};$('libraryList').append(item);
      }
      select.setKeys(documents.map(d=>d.id));
      if(scroll !== null) $('libraryList').scrollTop = scroll;
      listNext = data.next; $('libraryMore').hidden = !listNext;
      if (!$('libraryList').children.length) empty($('libraryList'), query ? '검색 결과가 없습니다.' : '아직 서버 문서가 없습니다. 교회 Sync에서 올려 주세요.');
      $('libraryMessage').textContent='';
      await window.YebaeonSyncLights.refresh();
    } catch (error) { if (sequence === listSequence) $('libraryMessage').textContent = error.message; }
  }
  async function applySelectedPolicy(searchEnabled,historyEnabled){
    const chosen=documents.filter(d=>select.chosen.has(d.id)&&d.available!==false);if(!chosen.length)return;
    if(chosen.some(d=>d.categoryManaged)){$('libraryMessage').textContent='카테고리로 관리하는 문서는 원본의 분류에 따라 검색·이력이 정해집니다. 미결·미분류 문서만 개별 설정할 수 있습니다.';return;}
    if(!confirm(`${chosen.length}개 문서에 ${searchEnabled?'본문 검색 켬':'본문 검색 끔'} / ${historyEnabled?'이력 보관 켬':'이력 보관 끔'}을 적용할까요? 기존 백업은 유지됩니다.`))return;
    let done=0;try{for(const item of chosen){const doc=(await(await api('/documents/'+item.id)).json()).document;await api('/documents/'+item.id+'/policy',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':`"${doc.version}"`},body:JSON.stringify({searchEnabled,historyEnabled,policyRevision:doc.policyRevision||0})});done++;}$('libraryMessage').textContent=`${done}개 설정 저장됨 · 검색 결과는 다음 검색 때 반영됩니다.`;}catch(error){$('libraryMessage').textContent=`${done}/${chosen.length}개 적용 후 중단 · ${error.message}`;}
  }
  async function openCloud(id, fromPlaylist = false, known = null, resume = null) {
    if(window.YebaeonSave?.busy())return false;
    const token=++openSequence;
    try {
      await checkpointDraft();
      if(known?.available===false){if(token!==openSequence||window.YebaeonSave?.busy())return false;if(linked)contexts.set(linked.id,{linked:{...linked},baseXML,draftID,mark:draftMark});editor.unavailable(known);update();window.dispatchEvent(new CustomEvent('yebaeonclouddocument',{detail:{doc:known,fromPlaylist}}));editor.status('원본 미업로드 · 순서 추가 가능, 텍스트 편집 불가');return true;}
      const {document:doc}=await(await api('/documents/'+id)).json();
      const original=originals.get(id);let serverXML;
      if(original?.version===doc.version&&original.sha256===doc.sha256){serverXML=original.xml;rememberOriginal(doc,serverXML);}
      else{const bytes=await(await api(`/documents/${id}/content?version=${doc.version}`)).arrayBuffer();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
        if(hash!==doc.sha256)throw new Error('받은 문서의 내용 확인에 실패했습니다.');
        serverXML=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rememberOriginal(doc,serverXML);}
      const record=resume?.draftID?(await drafts.all()).find(r=>r.id===resume.draftID&&r.kind==='document'&&r.base?.id===id&&r.author===user?.name&&typeof r.xml==='string'&&typeof r.baseXML==='string'):null;
      if(token!==openSequence||window.YebaeonSave?.busy()||resume&&!resume.isCurrent())return false;
      if(record&&!editor.isDirty(id))place(record.base,record.baseXML,record.xml,record.id,record.bulletin||null);
      if(linked)contexts.set(linked.id,{linked:{...linked},baseXML,draftID,mark:draftMark});
      const previous=contexts.get(id),cached=editor.cache?.(id),local=previous&&cached?.dirty;
      const xml=local?cached.xml:serverXML;
      if(!editor.open(xml,doc.name,true,id))return false;
      if(local){linked={...previous.linked,serial:-1};baseXML=previous.baseXML;draftID=previous.draftID;draftMark=previous.mark||null;editor.markDirty();}
      else {linked={...doc,serial:editor.state().serial};baseXML=xml;}
      update();window.dispatchEvent(new CustomEvent('yebaeonclouddocument',{detail:{doc,fromPlaylist,resuming:!!resume}}));
      editor.status(local ? `이 탭의 미저장 작업을 이어갑니다.${doc.version!==linked.version?' 서버에도 새 버전이 있습니다. 저장하면 최신 불러오기나 사본 저장을 고릅니다.':''}` : `서버 v${doc.version}을 열었습니다.`);
      return true;
    } catch(error){$('libraryMessage').textContent=error.message;editor.status(error.message);if(fromPlaylist)throw error;return false;}
  }
  async function save(path) {
    if (!needUser() || saving || !editor.ready()) return;
    if (editor.hasPackageMedia()) throw new Error('새 미디어를 교체한 문서는 지금은 ZIP으로 저장해 주세요. 서버는 기존 미디어 경로를 유지하는 .pro6 문서를 지원합니다.');
    const current = editor.document(), target = linked, startedEpoch = epoch, savedDraftID = draftID;
    if (target && target.serial === current.serial) { editor.status('이미 서버에 저장된 내용입니다.'); return; }
    saving = true; update();
    try {
      await checkpointDraft();
      const endpoint = target ? '/documents/' + target.id : '/documents?' + new URLSearchParams({ path });
      let result;
      try { result = await (await api(endpoint, { method: target ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/xml; charset=utf-8', ...(target ? { 'If-Match': `"${target.version}"` } : {}) }, body: current.xml })).json(); }
      catch (error) {
        // 늦게 저장한 쪽: 내 편집은 저장 직전 초안으로 남아 있다. 누가 언제 저장했는지 알려 준다.
        if (error.status === 409 && error.code === 'version_conflict' && target) { try { const latest = (await (await api('/documents/' + target.id)).json()).document; const minutes = Math.max(0, Math.round((Date.now() - Date.parse(latest.updatedAt)) / 60000)); error.message = `${latest.updatedBy}님이 ${minutes < 1 ? '방금' : minutes + '분 전에'} 저장했습니다(v${latest.version}). 내 편집은 브라우저 초안에 남아 있습니다. 최신 내용을 불러온 뒤 초안을 옆에 두고 다시 적용해 주세요.`; } catch (_) {} }
        throw error;
      }
      if(target && contexts.has(target.id)){const c=contexts.get(target.id);if(c.draftID===savedDraftID){c.linked={...result.document,serial:current.serial};c.baseXML=current.xml;}}
      if (epoch === startedEpoch) {
        linked = { ...result.document, serial: current.serial }; baseXML = current.xml; editor.markSaved(current.serial);
        const newer = editor.state().serial !== current.serial;
        editor.status(`${result.document.updatedBy} · 버전 ${result.document.version} 서버 저장 완료.${newer ? ' 저장 중에 추가한 변경은 아직 저장되지 않았습니다.' : ''}`);
      }
      try { if (epoch === startedEpoch && editor.state().serial !== current.serial) await checkpointDraft(); else await drafts.settle(savedDraftID,current.serial,result.document,current.xml); } catch(error) { drafts.report(error); }
      $('saveDialog').close();
      window.dispatchEvent(new CustomEvent('yebaeoncloudsaved', { detail: result.document }));
    } finally { saving = false; update(); }
  }
  function pendingDocuments(ids) {
    const wanted=new Set(ids),records=[];
    for(const id of wanted){
      const active=linked?.id===id,context=active?{linked,baseXML,draftID}:contexts.get(id);
      const value=active?editor.document():editor.cache(id);
      if(!context||!value?.dirty)continue;
      records.push({id,xml:value.xml,name:value.name||context.linked.name,serial:value.serial,base:{...context.linked},baseXML:context.baseXML,draftID:context.draftID});
    }
    return records;
  }
  async function saveRecord(record) {
    if(!needUser())throw new Error('입장한 뒤 저장하세요.');
    // Capture and preserve each original base before attempting CAS. No document navigation.
    const model=PP6.parse(record.xml,record.name);
    if(PP6.all(model.doc,'[source]').some(e=>PP6.attr(e,'source').startsWith('file:///PP6-Package/')))throw new Error('새 미디어를 포함한 문서는 별도 업로드가 필요합니다.');
    await drafts.put({id:record.draftID,kind:'document',name:record.name,author:user.name,base:record.base,baseXML:record.baseXML,xml:record.xml,serial:record.serial});
    const result=await(await api('/documents/'+record.id,{method:'PUT',headers:{'Content-Type':'application/xml; charset=utf-8','If-Match':`"${record.base.version}"`},body:record.xml})).json();
    const next={...result.document,serial:record.serial};
    const context=contexts.get(record.id);
    if(context?.draftID===record.draftID)contexts.set(record.id,{...context,linked:next,baseXML:record.xml});
    if(linked?.id===record.id&&draftID===record.draftID){linked=next;baseXML=record.xml;editor.markSaved(record.serial);}
    editor.markCachedSaved(record.id,record.xml);rememberOriginal(result.document,record.xml);
    try{await drafts.settle(record.draftID,record.serial,next,record.xml);}catch(error){drafts.report(error);}
    window.dispatchEvent(new CustomEvent('yebaeoncloudsaved',{detail:result.document}));update();return result.document;
  }
  // 고르기 창: choices는 [값, 글자, 'primary'?]. 닫기만 하면 마지막 값을 돌려준다.
  let chooser=null;
  function choose(title, message, choices) {
    if (!chooser) { chooser = document.createElement('dialog'); chooser.className = 'entry-dialog choice-dialog'; chooser.id = 'choiceDialog'; document.body.append(chooser); }
    const heading = document.createElement('h2'), text = document.createElement('p'), buttons = document.createElement('div');
    heading.textContent = title; text.className = 'dialog-help'; text.textContent = message; buttons.className = 'dialog-buttons';
    chooser.replaceChildren(heading, text, buttons);
    return new Promise(resolve => {
      let value = choices.at(-1)[0];
      for (const [key, label, kind] of choices) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.choice = key; if (kind) b.className = kind; b.onclick = () => { value = key; chooser.close(); }; buttons.append(b); }
      chooser.onclose = () => resolve(value); chooser.inert = false; chooser.showModal();
    });
  }
  async function verified(id) {
    const doc = (await (await api('/documents/' + id)).json()).document;
    const data = await (await api(`/documents/${id}/content?version=${doc.version}`)).arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== doc.sha256) throw new Error('받은 문서의 내용 확인에 실패했습니다.');
    const xml = new TextDecoder('utf-8', {fatal:true}).decode(data); rememberOriginal(doc, xml); return {doc, xml};
  }
  // 이 탭의 미저장 편집을 버린다. 열려 있던 문서면 next(없으면 서버 최신)를 연다.
  async function dropEdit(record, next = null) {
    try { await drafts.remove(record.draftID); } catch (error) { drafts.report(error); }
    contexts.delete(record.id); editor.forget(record.id);
    if (linked?.id === record.id) {
      const value = next || await verified(record.id);
      editor.markSaved(editor.state().serial);
      if (editor.open(value.xml, value.doc.name, true, value.doc.id)) { linked = {...value.doc, serial:editor.state().serial}; baseXML = value.xml; draftMark = null; window.dispatchEvent(new CustomEvent('yebaeonclouddocument', {detail:{doc:value.doc, fromPlaylist:true}})); }
    }
    update();
  }
  const stamp = () => new Date().toLocaleString('sv-SE', {timeZone:'Asia/Seoul'}).slice(5, 16).replace(/[-:]/g, '').replace(' ', '-');
  // 문서 저장 충돌: 다른 사람이 먼저 저장했다. 최신 버전을 불러와 내 편집을 버릴지, 내 편집을 사본 문서로 저장할지 고른다.
  async function resolveConflict(record) {
    const name = record.name.replace(/\.pro6$/i, '');
    let latest = null; try { latest = (await (await api('/documents/' + record.id)).json()).document; } catch (_) {}
    const who = latest ? `${latest.updatedBy}님이 ${time(latest.updatedAt)}에 v${latest.version}으로` : '다른 작업자가';
    const choice = await choose(`‘${name}’ 저장 충돌`, `${who} 먼저 저장해서 내 편집을 저장하지 않았습니다. 어떻게 할까요?`, [['latest','최신 버전 불러오기 (내 편집 버림)'],['copy','내 편집을 사본으로 저장','primary'],['later','나중에 (초안 유지)']]);
    if (choice === 'latest') { await dropEdit(record); return {text:`${name}: 최신 버전을 불러왔습니다(내 편집은 버림).`}; }
    if (choice === 'copy') {
      const category = PP6.parse(record.xml, record.name).doc.documentElement.getAttribute('category') || '미결';
      const folder = (record.base.path || record.name).split('/').slice(0, -1).join('/'), file = `${name} (사본 ${(user?.name || '작업자').replace(/[\/\\]/g, '')} ${stamp()}).pro6`;
      const xml = YebaeonLibraryActions.copyDocument(record.xml, category);
      const made = (await (await api('/documents?' + new URLSearchParams({path:(folder ? folder + '/' : '') + file}), {method:'POST', headers:{'Content-Type':'application/xml', 'X-YebaeOn-Client':'studio'}, body:xml})).json()).document;
      await dropEdit(record, linked?.id === record.id ? {doc:made, xml} : null);
      window.dispatchEvent(new CustomEvent('yebaeoncloudsaved', {detail:made}));
      return {text:`${name}: 내 편집을 ‘${made.name.replace(/\.pro6$/i, '')}’ 사본으로 저장했습니다.`, copy:made};
    }
    throw new Error('다른 작업자가 먼저 저장했습니다. 내 편집은 브라우저 초안에 남아 있습니다.');
  }
  // 이 탭에서 저장하지 않은 문서 전부(열린 문서와 미리 연 문서).
  function pendingAll() { return pendingDocuments([...new Set([...contexts.keys(), ...(linked ? [linked.id] : [])])]); }
  const marked = id => linked?.id === id ? !!draftMark : !!contexts.get(id)?.mark;
  // 주보 적용: 서버에 쓰지 않고 이 탭의 미저장 문서로 둔다. mark는 이 문서가 든 재생목록 키들이다(목록에 ‘저장 필요’ 표시).
  function place(doc, before, xml, id, mark) {
    if (linked?.id === doc.id) {
      if (editor.state().dirty) throw new Error(doc.name + '에 저장하지 않은 변경이 있습니다.');
      if (!editor.open(xml, doc.name, true, doc.id)) throw new Error(doc.name + '을 열지 못했습니다.');
      linked = {...doc, serial:-1}; baseXML = before; draftID = id; draftMark = mark; editor.markDirty();
    } else { contexts.set(doc.id, {linked:{...doc}, baseXML:before, draftID:id, mark}); editor.stage(doc.id, {xml, name:doc.name}); }
    update();
  }
  async function stageDocument(doc, before, xml, mark) {
    if (pendingDocuments([doc.id]).length) throw new Error(doc.name.replace(/\.pro6$/i,'') + '에 서버에 저장하지 않은 변경이 있습니다. Studio에서 먼저 서버 저장하세요.');
    for (const r of await drafts.all()) if (r.kind === 'document' && r.bulletin && r.base?.id === doc.id) await drafts.remove(r.id);
    const id = drafts.id();
    await drafts.put({id, kind:'document', name:doc.name, author:user?.name || recalledName(), base:{...doc}, baseXML:before, xml, serial:1, bulletin:mark});
    place(doc, before, xml, id, mark);
  }
  // 새로 고친 뒤에도 주보로 만든 초안은 그 재생목록을 열 때 다시 미저장 문서로 올린다.
  async function adoptDrafts(ids) {
    const wanted = new Set(ids), me = user?.name || recalledName();
    for (const r of await drafts.all()) {
      if (r.kind !== 'document' || !r.bulletin || !wanted.has(r.base?.id) || r.author !== me || editor.isDirty(r.base.id) || typeof r.xml !== 'string') continue;
      try { place(r.base, r.baseXML, r.xml, r.id, r.bulletin); } catch (_) {}
    }
  }
  async function restoreVersion(doc, version) {
    if (!confirm(`버전 ${version.version}의 내용으로 새 현재 버전을 저장할까요? 기존 이력은 유지됩니다.`)) return;
    await checkpointDraft();
    const bytes = await (await api(`/documents/${doc.id}/content?version=${version.version}`)).arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), n=>n.toString(16).padStart(2,'0')).join('');
    if (hash !== version.sha256) throw new Error('이전 버전의 내용 확인에 실패했습니다. 복원하지 않았습니다.');
    const result = await (await api(`/documents/${doc.id}`, {method:'PUT',headers:{'Content-Type':'application/xml; charset=utf-8','If-Match':`"${doc.version}"`},body:bytes})).json();
    historyDoc = {...result.document}; await history();
    $('historyMessage').textContent=`${result.unchanged ? '이미 같은 내용입니다.' : '버전 ' + result.document.version + '으로 복원했습니다.'} 편집 중인 화면은 유지됩니다. 최신 내용은 문서를 다시 열어 확인하세요.`;
  }
  async function history(more = false) {
    if (!historyDoc || !needUser()) return;
    const doc = historyDoc;
    if (!more) { historyNext = null; $('historyList').replaceChildren(); delete $('historyList').dataset.day; }
    $('historyMore').hidden = true; $('historyMessage').textContent = '저장 이력을 불러오고 있습니다…';
    try {
      const result = await (await api(`/documents/${doc.id}/versions` + (more ? '?before=' + historyNext : ''))).json();
      if(historyDoc.id !== doc.id || historyDoc.version !== doc.version)return;
      const P=window.YebaeonPanels,list=$('historyList');
      for (const version of result.versions) {
        const current=version.version===doc.version;P.dayed(list,version.createdAt);
        const download=P.el('a',{class:'line-icon',href:`/api/documents/${doc.id}/content?version=${version.version}`,download:doc.name.replace(/\.pro6$/i,'')+`-v${version.version}.pro6`,title:'.pro6 받기','aria-label':`버전 ${version.version} .pro6 받기`});
        download.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
        const restore=async()=>{try{await restoreVersion(doc,version);}catch(error){$('historyMessage').textContent=error.message+(error.status===409?' 다른 사람이 먼저 저장했습니다. 이력을 다시 열어 최신 버전을 확인하세요.':'');}};
        list.append(P.el('div',{class:'line-row history-row'+(current?' current':'')},P.el('span',{class:'line-dot'}),
          P.el('span',{class:'line-title'},`버전 ${version.version}`,current?P.chip('현재','now'):null),P.el('span',{class:'line-time'},P.clock(version.createdAt)),
          P.el('span',{class:'line-meta'},version.author),P.el('span',{class:'line-meta line-fill'},`${Math.ceil(version.size/1024)}KB`),
          current?P.el('span'):P.el('button',{type:'button',class:'line-btn',onclick:()=>window.YebaeonDiff.document(doc,version.version,restore)},'현재와 비교'),
          download,current?P.el('span',{class:'line-slot'}):P.el('button',{type:'button',class:'line-btn line-slot',onclick:restore},'복원')));
      }
      if(!more&&!result.versions.length)list.append(P.el('p',{class:'line-empty'},'저장 기록이 없습니다.'));
      historyNext=result.next; $('historyMore').hidden=!historyNext; $('historyMessage').textContent=doc.path;
    } catch(error) { $('historyMessage').textContent=error.message; }
  }
  $('entryForm').onsubmit = async event => {
    event.preventDefault(); $('entrySubmit').disabled = true; $('entryMessage').textContent = '확인하고 있습니다…';
    try {
      await preserveWorkerDrafts();
      user = await (await api('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('entryName').value, password: $('entryPassword').value, remember: $('entryRemember').checked }) })).json();
      rememberName(user.name); update(); $('entryDialog').close(); await showPlaylists();
    } catch (error) { $('entryMessage').textContent = error.message; }
    finally { $('entryPassword').value = ''; $('entrySubmit').disabled = !ready; }
  };
  $('entryLocal').onclick = () => $('entryDialog').close();
  $('librarySort').value='relevance';
  let maintenanceAfter='',maintenanceDone=false;
  $('indexMaintenance').onclick=()=>{if(!needUser())return;$('accountMenu').hidden=true;$('indexMaintenanceDialog').showModal();};
  $('indexMaintenanceClose').onclick=()=>$('indexMaintenanceDialog').close();
  $('indexMaintenanceRun').onclick=async()=>{
    const button=$('indexMaintenanceRun');button.disabled=true;let scanned=0,processed=0,failed=0;
    try{if(maintenanceDone){maintenanceAfter='';maintenanceDone=false;}
      for(let batch=0;batch<10;batch++){const result=await(await api('/search-index?'+new URLSearchParams({after:maintenanceAfter}),{method:'POST'})).json();scanned+=result.scanned;processed+=result.processed;failed+=result.failed;maintenanceAfter=result.next||'';if(!result.next){maintenanceDone=true;break;}}
      $('indexMaintenanceMessage').textContent=`이번 확인 ${scanned}개 · 보완 ${processed}개 · 실패 ${failed}개 · ${maintenanceDone?'전체 경로 확인 완료':'나머지는 다음 버튼 클릭 때 확인합니다'}`;button.textContent=maintenanceDone?'처음부터 다시 확인':'다음 최대 80개 확인';
    }catch(error){$('indexMaintenanceMessage').textContent=error.message;}finally{button.disabled=false;}
  };
  $('documentPolicy').onclick=async()=>{
    if(!linked||!needUser())return;const id=linked.id;
    try{const doc=(await(await api('/documents/'+id)).json()).document;if(linked?.id!==id)return;
      const form=$('documentPolicyDialog');form.dataset.document=id;form.dataset.version=doc.version;form.dataset.revision=doc.policyRevision||0;
      $('policySearch').checked=doc.searchEnabled!==false;$('policyHistory').checked=doc.historyEnabled!==false;$('policyMessage').textContent=doc.name+' · 기존 백업은 유지됩니다.';form.showModal();
      for(const key of ['policySearch','policyHistory','policySong','policyWeekly','policySave'])$(key).disabled=!!doc.categoryManaged;
      if(doc.categoryManaged)$('policyMessage').textContent=doc.name+' · '+doc.category+' 카테고리 설정을 따릅니다. 변경하려면 원본 문서의 카테고리를 바꿔 주세요.';
    }catch(error){editor.status(error.message);}
  };
  $('policySong').onclick=()=>{$('policySearch').checked=true;$('policyHistory').checked=false;};
  $('policyWeekly').onclick=()=>{$('policySearch').checked=true;$('policyHistory').checked=true;};
  $('policyClose').onclick=()=>$('documentPolicyDialog').close();
  $('policySave').onclick=async()=>{
    const form=$('documentPolicyDialog'),button=$('policySave');button.disabled=true;
    try{const result=await(await api('/documents/'+form.dataset.document+'/policy',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':`"${form.dataset.version}"`},body:JSON.stringify({searchEnabled:$('policySearch').checked,historyEnabled:$('policyHistory').checked,policyRevision:Number(form.dataset.revision)})})).json();
      if(linked?.id===result.document.id)Object.assign(linked,{searchEnabled:result.document.searchEnabled,historyEnabled:result.document.historyEnabled,policyRevision:result.document.policyRevision});form.close();editor.status('검색·이력 설정 저장됨');
    }catch(error){$('policyMessage').textContent=error.message;}finally{button.disabled=false;}
  };
  $('libraryRefresh').onclick = () => list(); $('libraryMore').onclick = () => list(true);
  $('libraryQuery').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();list();}};
  $('libraryQuery').oninput=()=>{if(!$('libraryQuery').value.trim())list();};
  $('libraryArchived').onchange=()=>list();
  $('cloudSave').onclick = async () => {
    if (!needUser()) return;
    try {
      if (linked) await save();
      else { $('savePath').value = editor.state().name; $('saveMessage').textContent = ''; $('saveDialog').showModal(); }
    } catch (error) { editor.status(error.message); }
  };
  $('saveForm').onsubmit = async event => { event.preventDefault(); $('saveConfirm').disabled = true; try { await save($('savePath').value); } catch (error) { $('saveMessage').textContent = error.message; } finally { $('saveConfirm').disabled = false; } };
  $('saveCancel').onclick = () => $('saveDialog').close();
  $('cloudAccount').onclick=()=>{if(needUser()){$('accountMenu').hidden=!$('accountMenu').hidden;$('cloudAccount').setAttribute('aria-expanded',String(!$('accountMenu').hidden));}};
  $('accountEdit').onclick = () => { $('accountMenu').hidden=true; if (needUser()) { $('accountName').value = user.name; $('accountMessage').textContent = ''; $('accountDialog').showModal(); } };
  $('accountClose').onclick = () => $('accountDialog').close();
  $('accountForm').onsubmit = async event => {
    event.preventDefault();
    try { await preserveWorkerDrafts(); user = await (await api('/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('accountName').value }) })).json(); rememberName(user.name); update(); $('accountDialog').close(); }
    catch (error) { $('accountMessage').textContent = error.message; }
  };
  $('accountLogout').onclick = async () => {
    try { await preserveWorkerDrafts(); await api('/session', { method: 'DELETE' }); $('accountMenu').hidden=true; user = null; update(); $('accountDialog').close(); showEntry(); }
    catch (error) { $('accountMessage').textContent = error.message; }
  };
  $('cloudHistory').onclick = () => { if (linked && needUser()) { historyDoc = { ...linked }; $('historyDialog').showModal(); history(); } };
  async function activity(more=false){
    const sequence=++activitySequence;if(!needUser())return;if(!$('activityDialog').open)$('activityDialog').showModal();$('accountMenu').hidden=true;
    const P=window.YebaeonPanels,list=$('activityList');
    $('activityMine').setAttribute('aria-pressed',String(activityScope==='mine'));$('activityAll').setAttribute('aria-pressed',String(activityScope==='all'));
    if(!more){activityNext=null;activityItems=[];list.replaceChildren();delete list.dataset.day;}$('activityMessage').textContent='작업 이력을 불러오고 있습니다…';
    try{const params=new URLSearchParams({scope:activityScope});if(more&&activityNext)params.set('cursor',activityNext);const data=await(await api('/activity?'+params)).json();
      if(sequence!==activitySequence)return;
      for(const item of data.items){const index=activityItems.push(item)-1;P.dayed(list,item.createdAt);
        const kind=item.kind==='document'?'document':item.node?'playlist':'file',comparable=item.kind==='document'||!!item.node;
        const open=async()=>{if(item.kind==='document')await openCloud(item.id);else if(item.node)await window.YebaeonPlaylists.openNode(item.id,item.node);else await window.YebaeonPlaylists.openLibrary(item.id);$('activityDialog').close();};
        list.append(P.el('div',{class:'line-row activity-row'},P.kind(kind),P.el('span',{class:'line-time'},P.clock(item.createdAt)),
          P.el('span',{class:'line-title',title:item.path},item.path),P.el('span',{class:'line-meta'},(activityScope==='all'?item.author+' · ':'')+'v'+item.version),
          !comparable?P.el('span'):item.version>1?P.el('button',{type:'button',class:'line-btn',onclick:()=>window.YebaeonDiff.activity(item)},'바뀐 것'):P.chip('새로 만듦','muted'),
          P.el('button',{type:'button',class:'line-btn',onclick:()=>open().catch(error=>{$('activityMessage').textContent=error.message;})},'열기'),
          P.kebab(()=>[{label:'이 저장부터 되돌리기',note:'이 저장과 더 최근 저장을 모두 그 전 버전으로 되돌립니다.',danger:true,onclick:()=>rollback(index).catch(error=>{$('activityMessage').textContent=error.message;})}])));}
      if(!more&&!data.items.length)list.append(P.el('p',{class:'line-empty'},'아직 저장한 기록이 없습니다.'));
      activityNext=data.next;$('activityMore').hidden=!data.next;$('activityMessage').textContent=activityScope==='mine'?`지금 작업자 이름(${user.name})으로 저장한 기록만 보입니다.`:'모든 작업자의 저장 기록입니다.';
    }catch(error){$('activityMessage').textContent=error.message;}
  }
  // 이 시점으로 되돌리기: 목록에서 고른 저장과 그 뒤의 저장이 건드린 문서·예배 순서마다, 그 가운데 가장 앞선 저장 바로 전 버전으로 새 버전을 만든다.
  // 버전을 지우지 않으므로 되돌린 것도 이력에 남고 다시 되돌릴 수 있다.
  let activityItems=[];
  async function rollback(index){if(!needUser()||saving||window.YebaeonSave?.busy())return;if(window.YebaeonPlaylists?.state().dirty)throw new Error('Studio에서 열린 순서의 변경사항을 먼저 저장하거나 되돌려 주세요.');
    const targets=new Map();for(const item of activityItems.slice(0,index+1)){if(item.kind==='playlist'&&!item.node)continue;const key=item.kind+':'+item.id+':'+item.node;const t=targets.get(key);if(!t||item.version<t.version)targets.set(key,{...item});}
    const list=[...targets.values()];if(!list.length)throw new Error('되돌릴 저장이 없습니다.');
    const pending=list.filter(t=>t.kind==='document'&&editor.isDirty(t.id));if(pending.length)throw new Error(pending.map(t=>t.path).join(', ')+'에 저장하지 않은 변경이 있습니다. 먼저 저장하거나 되돌려 주세요.');
    if(!confirm(`${list.length}개 항목(${list.map(t=>t.path.split('/').pop().replace(/\.pro6$/i,'')).join(', ')})을 이 저장 전 상태로 되돌릴까요?\n각 항목의 그 뒤 저장은 다른 작업자의 것까지 함께 되돌아갑니다. 새로 만든 문서는 휴지통에서 따로 정리하세요.`))return;
    const done=[],skipped=[],failed=[];
    for(const t of list){const to=t.version-1;const name=t.path.split('/').pop().replace(/\.pro6$/i,'');$('activityMessage').textContent=`${name} 되돌리는 중…`;
      try{if(to<1){skipped.push(name+'(새로 만든 것)');continue;}
        if(t.kind==='document'){const {document:doc}=await(await api('/documents/'+t.id)).json();const bytes=await(await api(`/documents/${t.id}/content?version=${to}`)).arrayBuffer();const result=await(await api('/documents/'+t.id,{method:'PUT',headers:{'Content-Type':'application/xml; charset=utf-8','If-Match':`"${doc.version}"`},body:bytes})).json();done.push(name+(result.unchanged?' (이미 같음)':` → v${to} 내용`));}
        else{const latest=await(await api(`/playlists/${t.id}/plan?`+new URLSearchParams({node:t.node}))).json();await api(`/playlists/${t.id}?`+new URLSearchParams({node:t.node}),{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':`"${latest.library.version}"`},body:JSON.stringify({restoreVersion:to,baseNodeHash:latest.playlist.sha256})});done.push(name+` → 순서 v${to}`);}
      }catch(error){failed.push(name+': '+error.message);}}
    const open=window.YebaeonPlaylists?.selectedPlaylist();if(open&&done.length){const [library,node]=open.key.split('/');await window.YebaeonPlaylists.openNode(library,node).catch(()=>{});}
    await activity();$('activityMessage').textContent=[done.length?'되돌림: '+done.join(', '):'',skipped.length?'건너뜀: '+skipped.join(', '):'',failed.length?'실패: '+failed.join(' / '):''].filter(Boolean).join('\n')+(done.length?'\n열려 있는 문서는 다시 열어 확인하세요.':'');}
  $('activityOpen').onclick=()=>{activityScope='mine';activity();};$('activityMine').onclick=()=>{activityScope='mine';activity();};$('activityAll').onclick=()=>{activityScope='all';activity();};$('activityMore').onclick=()=>activity(true);$('activityClose').onclick=()=>$('activityDialog').close();
  $('historyClose').onclick = () => $('historyDialog').close(); $('historyMore').onclick = () => history(true);
  window.addEventListener('yebaeonbeforeopen', () => { checkpointDraft().catch(drafts.report); });
  window.addEventListener('yebaeonopen', () => { epoch++; linked = null; draftID=drafts.id(); draftMark=null; baseXML=editor.document().xml; update(); });
  window.addEventListener('yebaeonchange', () => queueMicrotask(() => { update(); checkpointDraft().catch(drafts.report); }));
  document.addEventListener('visibilitychange', () => { if(document.hidden)checkpointDraft().catch(drafts.report); });
  // 서버에서 이름이 바뀐 문서: 열린 문서·보관 맥락·편집기 캐시의 이름만 맞춘다. 내용과 버전은 그대로다.
  function renamed(doc){const c=contexts.get(doc.id);if(c?.linked)c.linked={...c.linked,path:doc.path,name:doc.name};const cached=editor.cache?.(doc.id);if(cached)cached.name=doc.name;if(linked?.id===doc.id){linked={...linked,path:doc.path,name:doc.name};editor.model().name=doc.name;editor.redraw();update();}}
  window.YebaeonCloud = { api, workspaceReady:()=>workspaceReady, authenticated:()=>!!user, needUser, openDocument: openCloud, online, restoreDraft, worker:()=>user?.name || recalledName(), linked:()=>linked, renamed, refresh:list, checkpointDraft, currentDraft:()=>editor.state().dirty?draftID:null, selectedDocuments:()=>documents.filter(d=>select.chosen.has(d.id)),pendingDocuments,pendingAll,marked,saveRecord,resolveConflict,choose,stageDocument,adoptDrafts,listedDocument:id=>documents.find(doc=>doc.id===id),
    async documentCopySource(id){
      const local=editor.cache(id);if(local?.dirty)return {xml:local.xml,local:true};
      const doc=(await(await api('/documents/'+id)).json()).document;
      const data=await(await api(`/documents/${id}/content?version=${doc.version}`)).arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==doc.sha256)throw new Error('복제할 원본 확인에 실패했습니다.');
      return {xml:new TextDecoder('utf-8',{fatal:true}).decode(data),local:false};
    },
    async createDocument(path,xml){
      if(!needUser()||saving||window.YebaeonSave?.busy())throw new Error('현재 저장이 끝난 뒤 추가해 주세요.');
      await checkpointDraft();
      const result=await(await api('/documents?'+new URLSearchParams({path}),{method:'POST',headers:{'Content-Type':'application/xml','X-YebaeOn-Client':'studio'},body:xml})).json();
      const opened=await openCloud(result.document.id,false,result.document);
      if(!opened)editor.status('문서는 추가됐습니다. 이름으로 검색해 열어 주세요.');
      return result.document;
    }
  };
  update();
  if (online) (async () => {
    try {
      const state = await (await api('/session')).json(); ready = state.ready;
      if (state.authenticated) { user = state; rememberName(user.name); update(); await showPlaylists(); }
      else showEntry();
    } catch (_) { ready = true; showEntry(); $('entryMessage').textContent = '서버 연결 확인에 실패했습니다. 입장하기를 눌러 다시 시도해 주세요. 편집 내용은 브라우저 초안에 보존됩니다.'; }
  })();
})();


(function(){
 let items={},pending,refreshAgain=false,failed=false,checkedAt=null;
 // 교회 Mac Sync 2의 적용 보고(적용 번호·보류 예배)와 서버 변경 일지를 비교한 결과다.
 const labels={synced:'교회 Mac이 받음',pending:'서버 변경 있음 · Mac 적용 대기',conflict:'서버와 Mac 양쪽 변경 · 충돌 확인 필요',local:'Mac 변경 있음 · 서버로 보내기 필요',unknown:'Mac Sync 적용 보고 없음'};
 window.YebaeonSyncLights={
 async refresh(){
   if(pending){refreshAgain=true;return pending;}
   pending=(async()=>{do{refreshAgain=false;
     const targets=[...new Map([...document.querySelectorAll('.sync-light[data-sync-kind]')].filter(el=>el.dataset.syncId).map(el=>[el.dataset.syncKind+'/'+el.dataset.syncId+'/'+el.dataset.syncNode,{kind:el.dataset.syncKind,id:el.dataset.syncId,node:el.dataset.syncNode||''}])).values()];
     if(!targets.length){items={};continue;}
     try{const fresh={};for(let offset=0;offset<targets.length;offset+=40){const data=await(await window.YebaeonCloud.api('/sync-observations?'+new URLSearchParams({targets:JSON.stringify(targets.slice(offset,offset+40))}))).json();Object.assign(fresh,data.items);}items=fresh;failed=false;checkedAt=new Date();}catch{items={};failed=true;}
     for(const old of document.querySelectorAll('.sync-light[data-sync-kind]'))old.replaceWith(window.YebaeonSyncLights.dot(old.dataset.syncKind,old.dataset.syncId,old.dataset.syncNode));
   }while(refreshAgain);})().finally(()=>{pending=null;});return pending;
 },
 dot(kind,id,node=''){const info=items[kind+'/'+id+'/'+node],state=failed?'unknown':info?.state||'unknown',span=document.createElement('span');span.dataset.syncKind=kind;span.dataset.syncId=id;span.dataset.syncNode=node;span.className='sync-light sync-'+state;span.setAttribute('role','img');span.setAttribute('aria-label',labels[state]);span.title=(failed?'서버 상태 조회 실패 · 이전 기록은 최신 확인이 아닙니다':labels[state])+(info?' · 마지막 Mac 적용 보고 '+new Date(info.observedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+(info.author?' · '+info.author:'')+(info.deviceId?' · 장치 '+info.deviceId.slice(0,8):'')+(info.reason?' · '+info.reason:''):'')+(checkedAt?' · 웹 조회 '+checkedAt.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'');return span;}
 };
 // Refresh on explicit list/playlist reload and successful saves, never by a polling timer.
 window.addEventListener('yebaeoncloudsaved',()=>{if(window.YebaeonCloud.authenticated()&&!window.YebaeonSave?.busy())window.YebaeonSyncLights.refresh();});
})();




