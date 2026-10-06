(function () {
  'use strict';
  const tab = crypto.randomUUID(), $ = id => document.getElementById(id);
  let database, queue = Promise.resolve(), clearing = false;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('yebaeon-drafts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
      request.onerror = () => { database = null; reject(request.error); };
      request.onblocked = () => { database = null; reject(new Error('다른 탭이 초안 저장소를 사용 중입니다.')); };
    });
    return database;
  }
  function transact(mode, action) {
    const operation = queue.then(async () => {
      const connection = await db();
      return new Promise((resolve, reject) => {
        const tx = connection.transaction('drafts', mode); let result;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('브라우저 초안 저장 실패'));
        const request = action(tx.objectStore('drafts'));
        request.addEventListener('success', () => { if(request.readyState==='done')result=request.result; });
      });
    });
    queue = operation.catch(() => {}); return operation;
  }
  const store = {
    id: () => tab + '/' + crypto.randomUUID(),
    put: record => { if(clearing)return Promise.resolve(); const copy=structuredClone({...record,schema:1,tab,updatedAt:new Date().toISOString()}); return transact('readwrite', store=>store.put(copy)).catch(error=>{report(error);throw error;}); },
    remove: id => transact('readwrite', store => store.delete(id)),
    settle: (id, serial, base, baseXML) => transact('readwrite', store => {
      const request = store.get(id);
      request.onsuccess = () => {
        const record=request.result; if(!record)return;
        if(record.serial === serial)store.delete(id);
        else store.put({...record,base,baseXML});
      };
      return request;
    }),
    all: () => transact('readonly', store => store.getAll())
  };
  function report(error) { $('draftState').textContent = '브라우저 보존 실패 · 파일로 따로 저장하세요. ' + error.message; }
  function notify(message) { $('draftState').textContent = message; }
  // One confirmation wipes every draft in this browser, then reloads so in-memory edits and undo history go too.
  async function clearAll() {
    if(clearing)return;
    if(!confirm('이 브라우저에 남은 수정 내역(문서·순서 초안)을 모두 지울까요?\n서버에 저장된 내용은 그대로이며, 지운 내역은 되돌릴 수 없습니다.\n지운 뒤 화면을 새로 불러옵니다.'))return;
    clearing=true;
    try{await transact('readwrite',drafts=>drafts.clear());window.YebaeonEditor?.discardChanges?.();location.reload();}
    catch(error){clearing=false;report(error);alert('브라우저 수정 내역을 지우지 못했습니다. '+error.message);}
  }
  async function show() {
    const dialog = $('draftDialog'), P = window.YebaeonPanels; if (!dialog.open) dialog.showModal();
    P.hideAccount();
    const list = $('draftList'); list.replaceChildren(); $('draftMessage').textContent = '확인 중…';
    try {
      const records = (await store.all()).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
      P.draftCount(records.length); $('draftClear').disabled = !records.length;
      $('draftMessage').textContent = records.length ? `저장하지 않고 남은 작업 ${records.length}개` : '';
      if (!records.length) list.append(P.el('p', {class:'line-empty'}, '보존된 초안이 없습니다.'));
      for (const record of records) {
        const restore = P.el('button', {type:'button', class:'line-btn primary', textContent:'복구'});
        restore.onclick = async () => { restore.disabled = true; try {
          const handler = record.kind === 'playlist' ? window.YebaeonPlaylists : window.YebaeonCloud;
          if (await handler.restoreDraft(record)) { dialog.close(); notify('초안을 복구했습니다. 서버에 적용하려면 저장하세요.'); }
        } catch(error) { $('draftMessage').textContent = error.message; } finally { restore.disabled = false; } };
        const download = () => {
          const blob = new Blob([record.kind === 'document' ? record.xml : JSON.stringify(record,null,2)], {type: record.kind === 'document' ? 'application/xml' : 'application/json'});
          const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download=record.kind === 'document' ? record.name : record.name + '-초안.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        };
        const remove = async () => { if (confirm(record.tab === tab ? '이 초안을 버릴까요? 지금 화면에서 고친 내용은 다시 고치면 새로 보존됩니다. 서버 문서는 그대로 남습니다.' : '이 초안을 버릴까요? 서버 문서는 그대로 남습니다.')) { try { await store.remove(record.id); await show(); } catch(error) { report(error); } } };
        list.append(P.el('div', {class:'line-row draft-row'}, P.kind(record.kind === 'playlist' ? 'playlist' : 'document'),
          P.el('span', {class:'line-title', title:record.name}, record.name),
          P.el('span', {class:'line-meta'}, `${P.when(record.updatedAt)} · ${record.author || '로컬 작업'} · ${record.base?.version ? 'v' + record.base.version + ' 기준' : '로컬 파일 기준'}`),
          restore, P.kebab(() => [{label:'파일로 내려받기', onclick:download}, {label:'이 초안 버리기', danger:true, onclick:remove}])));
      }
    } catch(error) { $('draftMessage').textContent=error.message; report(error); }
  }
  window.YebaeonDrafts = { ...store, tab, report, notify, show, clearAll };
  $('draftClear').onclick=clearAll;
  // 작업자 메뉴를 열 때마다 초안 수를 다시 센다.
  $('cloudAccount').addEventListener('click', () => store.all().then(records => window.YebaeonPanels?.draftCount(records.length)).catch(() => {}));
  $('draftOpen').onclick = show; $('draftClose').onclick = $('draftDone').onclick = () => $('draftDialog').close();
  store.all().then(records => { window.YebaeonPanels?.draftCount(records.length); if(records.length)notify(`복구 가능한 초안 ${records.length}개 · ‘브라우저 초안’에서 확인`); }).catch(report);
})();

