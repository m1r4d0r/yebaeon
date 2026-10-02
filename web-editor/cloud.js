(function () {
  'use strict';
  const $ = id => document.getElementById(id), editor = window.YebaeonEditor;
  const online = /^https?:$/.test(location.protocol);
  let user = null, ready = false, linked = null, epoch = 0, saving = false;
  const drafts = window.YebaeonDrafts;
  let draftID = drafts.id(), baseXML = editor.document().xml;
  const contexts=new Map(); let openSequence=0, documents=[], activityNext=null, activityScope='mine';
  // Verified originals only. Recheck metadata on every open; never cache authorization.
  const originals=new Map();let originalBytes=0;
  function rememberOriginal(doc,xml){const old=originals.get(doc.id);if(old)originalBytes-=old.xml.length*2;originals.delete(doc.id);if(xml.length*2<=16*1024*1024){originals.set(doc.id,{version:doc.version,sha256:doc.sha256,xml});originalBytes+=xml.length*2;}while(originalBytes>24*1024*1024||originals.size>24){const first=originals.keys().next().value;originalBytes-=originals.get(first).xml.length*2;originals.delete(first);}}
  const select=new YebaeonSelection.Selection($('documentsPane'),{kind:'documents',undo:redo=>editor.undo(redo),open:()=>openCloud(select.cursor),copy:()=>YebaeonSelection.copy({kind:'documents',documents:documents.filter(d=>select.chosen.has(d.id))})});
  let activitySequence=0;
  let listNext = null, listSequence = 0, indexTimer = null, historyDoc = null, historyNext = null;
  const rememberName = name => { try { localStorage.setItem('yebaeon.workerName', name); } catch (_) {} };
  const recalledName = () => { try { return localStorage.getItem('yebaeon.workerName') || ''; } catch (_) { return ''; } };
  const time = value => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short',timeZone:'Asia/Seoul' });
  function update() {
    window.dispatchEvent(new CustomEvent("yebaeonsession", { detail: { authenticated: !!user } }));
    $('cloudAccount').textContent = online ? (user ? user.name + ' ▾' : '입장하기') : '연결 안 됨';
    $('cloudAccount').disabled = !online;
    $('cloudSave').disabled = !user || saving || !linked;
    $('cloudSave').textContent = saving ? '저장 중…' : '서버에 저장 Ctrl+S';
    $('cloudHistory').hidden = !linked || !user;
    const changed = linked && editor.state().serial !== linked.serial;
    $('dirtyState').textContent=editor.state().dirty ? '저장 안 됨' : '';
    $('locationTitle').textContent=linked ? (window.YebaeonPlaylists?.currentName?.() ? window.YebaeonPlaylists.currentName()+' › ' : '')+editor.state().name.replace(/\.pro6$/i,'') : '예배온 Studio';
    $('cloudContext').textContent = linked ? `서버 v${linked.version} · ${linked.updatedBy} · ${time(linked.updatedAt)}` : '';
  }
  function checkpointDraft() {
    if(!editor.state().dirty)return Promise.resolve();
    const current = editor.document();
    if (!current.dirty) return Promise.resolve();
    const record = { id:draftID, kind:'document', name:current.name, author:user?.name || recalledName(), base:linked ? {...linked} : null, baseXML, xml:current.xml, serial:current.serial };
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
    if (!editor.open(record.xml, record.name)) return false;
    linked = record.base ? {...record.base,serial:-1} : null; baseXML=record.baseXML;
    editor.markDirty(); await checkpointDraft(); update();
    return true;
  }
  async function api(path, options = {}) {
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
    $('entryMessage').textContent = ready ? '' : '서버 연결 준비 중입니다. 연결되면 서버 문서를 열 수 있습니다.';
    if (!$('entryDialog').open) $('entryDialog').showModal();
  }
  async function showPlaylists() {
    if (!window.YebaeonPlaylists) await new Promise(resolve => window.addEventListener('yebaeonplaylistsready', resolve, { once: true }));
    await Promise.all([list(),window.YebaeonPlaylists.show()]);
  }
  function needUser() { if (user) return true; showEntry(); return false; }
  function row(title, detail, buttonText, action) {
    const item = document.createElement('div'); item.className = 'library-row';
    const text = document.createElement('div'), strong = document.createElement('strong'), small = document.createElement('small');
    strong.textContent = title; small.textContent = detail; text.append(strong, small);
    const button = document.createElement('button'); button.textContent = buttonText;
    button.onclick = async () => { button.disabled = true; try { await action(); } finally { button.disabled = false; } };
    item.append(text, button); return item;
  }
  function empty(target, message) { const div = document.createElement('div'); div.className = 'library-empty'; div.textContent = message; target.append(div); }
  async function list(more = false) {
    if (!needUser()) return;
    clearTimeout(indexTimer);
    const sequence = ++listSequence, query = $('libraryQuery').value.trim(), sort = $('librarySort').value;
    const scroll = more ? null : $('libraryList').scrollTop;
    if (!more) { listNext = null; documents=[]; $('libraryList').replaceChildren(); }
    $('libraryMore').hidden = true; $('libraryMessage').textContent = '문서 목록을 불러오고 있습니다…';
    try {
      const params = new URLSearchParams({q:query,sort});
      if(more && listNext) params.set(sort==='name'||sort==='name-desc' ? 'after' : 'cursor',listNext);
      const data = await (await api('/documents?' + params)).json();
      if (sequence !== listSequence) return;
      for (const doc of data.documents) {
        documents.push(doc);const item=document.createElement('div');item.className='document-item';select.bind(item,doc.id);
        const name=document.createElement('strong');name.textContent=doc.name.replace(/\.pro6$/i,'');const small=document.createElement('small');
        const date=doc.lastDateUsed ? new Date(doc.lastDateUsed).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',timeZone:'Asia/Seoul'})+' 사용' : '사용일 없음';
        small.textContent=date;item.append(name,small);item.title=doc.path;
        item.addEventListener('click',e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey)openCloud(doc.id);});
        item.oncontextmenu=e=>{if(!select.chosen.has(doc.id))select.select(doc.id);YebaeonSelection.menu(e,[{label:'열기 Enter',action:()=>openCloud(doc.id)},{label:'순서에 복사 Ctrl+C',action:()=>select.options.copy()}]);};$('libraryList').append(item);
      }
      select.setKeys(documents.map(d=>d.id));
      if(scroll !== null) $('libraryList').scrollTop = scroll;
      listNext = data.next; $('libraryMore').hidden = !listNext;
      if (!$('libraryList').children.length) empty($('libraryList'), query ? '검색 결과가 없습니다.' : '아직 서버 문서가 없습니다. 교회 Sync에서 올려 주세요.');
      $('libraryMessage').textContent = data.indexing?.remaining ? `최근 사용일 수집 중 · ${data.indexing.total-data.indexing.remaining}/${data.indexing.total}개. 확인된 날짜부터 정렬해 표시합니다.` : data.indexing?.failed ? `최근 사용일 확인 실패 ${data.indexing.failed}개는 날짜 없는 문서와 함께 뒤에 표시됩니다.` : '';
      if(data.indexing?.remaining && !more) indexTimer=setTimeout(()=>{if(document.visibilityState==='visible')list();},6000);
    } catch (error) { if (sequence === listSequence) $('libraryMessage').textContent = error.message; }
  }
  async function openCloud(id, fromPlaylist = false) {
    const token=++openSequence;
    try {
      await checkpointDraft();
      const {document:doc}=await(await api('/documents/'+id)).json();
      const original=originals.get(id);let serverXML;
      if(original?.version===doc.version&&original.sha256===doc.sha256){serverXML=original.xml;rememberOriginal(doc,serverXML);}
      else{const bytes=await(await api(`/documents/${id}/content?version=${doc.version}`)).arrayBuffer();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
        if(hash!==doc.sha256)throw new Error('받은 문서의 내용 확인에 실패했습니다.');
        serverXML=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rememberOriginal(doc,serverXML);}
      if(token!==openSequence)return false;
      if(linked)contexts.set(linked.id,{linked:{...linked},baseXML,draftID});
      const previous=contexts.get(id),cached=editor.cache?.(id),local=previous&&cached?.dirty;
      const xml=local?cached.xml:serverXML;
      if(!editor.open(xml,doc.name,true,id))return false;
      if(local){linked={...previous.linked,serial:-1};baseXML=previous.baseXML;draftID=previous.draftID;editor.markDirty();}
      else {linked={...doc,serial:editor.state().serial};baseXML=xml;}
      update();window.dispatchEvent(new CustomEvent('yebaeonclouddocument',{detail:{doc,fromPlaylist}}));
      editor.status(local ? `이 탭의 미저장 작업을 이어갑니다.${doc.version!==linked.version?' 서버에도 새 버전이 있습니다. 저장 시 충돌을 확인합니다.':''}` : `서버 v${doc.version}을 열었습니다.`);
      return true;
    } catch(error){$('libraryMessage').textContent=error.message;editor.status(error.message);if(fromPlaylist)throw error;return false;}
  }
  async function save(path) {
    if (!needUser() || saving) return;
    if (editor.hasPackageMedia()) throw new Error('새 미디어를 교체한 문서는 지금은 ZIP으로 저장해 주세요. 서버는 기존 미디어 경로를 유지하는 .pro6 문서를 지원합니다.');
    const current = editor.document(), target = linked, startedEpoch = epoch, savedDraftID = draftID;
    if (target && target.serial === current.serial) { editor.status('이미 서버에 저장된 내용입니다.'); return; }
    saving = true; update();
    try {
      await checkpointDraft();
      const endpoint = target ? '/documents/' + target.id : '/documents?' + new URLSearchParams({ path });
      const result = await (await api(endpoint, { method: target ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/xml; charset=utf-8', ...(target ? { 'If-Match': `"${target.version}"` } : {}) }, body: current.xml })).json();
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
  let historyGroups = new Map();
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
    if (!more) { historyNext = null; historyGroups = new Map(); $('historyList').replaceChildren(); }
    $('historyMore').hidden = true; $('historyMessage').textContent = '저장 이력을 불러오고 있습니다…';
    try {
      const result = await (await api(`/documents/${doc.id}/versions` + (more ? '?before=' + historyNext : ''))).json();
      if(historyDoc.id !== doc.id || historyDoc.version !== doc.version)return;
      for (const version of result.versions) {
        const day = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(version.createdAt));
        const key=JSON.stringify([day,version.author]); let group=historyGroups.get(key);
        if(!group){group=document.createElement('details'); const summary=document.createElement('summary'); summary.textContent=day+' · '+version.author+' (한국시간)'; group.append(summary); group.open=historyGroups.size===0; historyGroups.set(key,group); $('historyList').append(group);}
        const item = row(`버전 ${version.version}${version.version===doc.version ? ' · 현재' : ''}`, `${time(version.createdAt)} · ${Math.ceil(version.size / 1024)}KB`, '이 내용으로 복원', async () => {
          try { await restoreVersion(doc,version); } catch(error) { $('historyMessage').textContent=error.message + (error.status===409 ? ' 다른 사람이 먼저 저장했습니다. 이력을 다시 열어 최신 버전을 확인하세요.' : ''); }
        });
        item.querySelector('button').disabled=version.version===doc.version;
        const link = document.createElement('a'); link.className='document-download'; link.textContent='.pro6 받기';
        link.href=`/api/documents/${doc.id}/content?version=${version.version}`;
        link.download=doc.name.replace(/\.pro6$/i,'')+`-v${version.version}.pro6`;
        item.append(link);group.append(item);
      }
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
  try { const saved=localStorage.getItem('yebaeon.librarySort'); if(['name','name-desc','used','updated'].includes(saved))$('librarySort').value=saved; } catch (_) {}
  $('librarySort').onchange = () => { try { localStorage.setItem('yebaeon.librarySort',$('librarySort').value); } catch (_) {} list(); };
  $('libraryRefresh').onclick = () => list(); $('libraryMore').onclick = () => list(true);
  let searchTimer; $('libraryQuery').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => list(), 250); };
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
    if(!more){activityNext=null;$('activityList').replaceChildren();}$('activityMessage').textContent='작업 이력을 불러오고 있습니다…';
    try{const params=new URLSearchParams({scope:activityScope});if(more&&activityNext)params.set('cursor',activityNext);const data=await(await api('/activity?'+params)).json();
      if(sequence!==activitySequence)return;for(const item of data.items){$('activityList').append(row(item.path,`${time(item.createdAt)} · ${item.author} · ${item.kind==='document'?'문서':'재생목록 파일'} v${item.version}`,'열기',async()=>{if(item.kind==='document')await openCloud(item.id);else await window.YebaeonPlaylists.openLibrary(item.id);$('activityDialog').close();}));}
      activityNext=data.next;$('activityMore').hidden=!data.next;$('activityMessage').textContent=activityScope==='mine'?'현재 작업자 이름으로 저장한 이력입니다.':'모든 작업자의 이력입니다.';
    }catch(error){$('activityMessage').textContent=error.message;}
  }
  $('activityOpen').onclick=()=>{activityScope='mine';activity();};$('activityMine').onclick=()=>{activityScope='mine';activity();};$('activityAll').onclick=()=>{activityScope='all';activity();};$('activityMore').onclick=()=>activity(true);$('activityClose').onclick=()=>$('activityDialog').close();
  $('historyClose').onclick = () => $('historyDialog').close(); $('historyMore').onclick = () => history(true);
  window.addEventListener('yebaeonbeforeopen', () => { checkpointDraft().catch(drafts.report); });
  window.addEventListener('yebaeonopen', () => { epoch++; linked = null; draftID=drafts.id(); baseXML=editor.document().xml; update(); });
  window.addEventListener('yebaeonchange', () => queueMicrotask(() => { update(); checkpointDraft().catch(drafts.report); }));
  document.addEventListener('visibilitychange', () => { if(document.hidden)checkpointDraft().catch(drafts.report); });
  window.YebaeonCloud = { api, needUser, openDocument: openCloud, online, restoreDraft, worker:()=>user?.name || recalledName(), linked:()=>linked, refresh:list, checkpointDraft, selectedDocuments:()=>documents.filter(d=>select.chosen.has(d.id)) };
  update();
  if (online) (async () => {
    try {
      const state = await (await api('/session')).json(); ready = state.ready;
      if (state.authenticated) { user = state; rememberName(user.name); update(); await showPlaylists(); }
      else showEntry();
    } catch (_) { ready = false; showEntry(); $('entryMessage').textContent = '서버에 연결하지 못했습니다. 현재 편집 내용은 브라우저 초안에 보존됩니다.'; }
  })();
})();
