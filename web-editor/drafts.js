(function () {
  'use strict';
  const tab = crypto.randomUUID(), $ = id => document.getElementById(id);
  let database, queue = Promise.resolve();
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
        request.addEventListener('success', () => { result = request.result; });
      });
    });
    queue = operation.catch(() => {}); return operation;
  }
  const store = {
    id: () => tab + '/' + crypto.randomUUID(),
    put: record => { const copy=structuredClone({...record,schema:1,tab,updatedAt:new Date().toISOString()}); return transact('readwrite', store=>store.put(copy)).catch(error=>{report(error);throw error;}); },
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
  async function show() {
    const dialog = $('draftDialog'); if (!dialog.open) dialog.showModal();
    const list = $('draftList'); list.replaceChildren(); $('draftMessage').textContent = '확인 중…';
    try {
      const records = (await store.all()).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
      $('draftMessage').textContent = records.length ? '이 브라우저에 보존된 작업입니다. 복구해도 서버 내용은 저장 버튼을 누르기 전까지 바뀌지 않습니다.' : '보존된 초안이 없습니다.';
      for (const record of records) {
        const row = document.createElement('div'); row.className = 'library-row';
        const copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
        title.textContent = record.name;
        detail.textContent = `${record.kind === 'playlist' ? '순서' : '문서'} · ${record.author || '로컬 작업'} · ${new Date(record.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · 기준 ${record.base?.version ? 'v' + record.base.version : '로컬 파일'}`;
        copy.append(title,detail); row.append(copy);
        const restore = document.createElement('button'); restore.textContent = '복구';
        restore.onclick = async () => { restore.disabled = true; try {
          const handler = record.kind === 'playlist' ? window.YebaeonPlaylists : window.YebaeonCloud;
          if (await handler.restoreDraft(record)) { dialog.close(); notify('초안을 복구했습니다. 서버에 적용하려면 저장하세요.'); }
        } catch(error) { $('draftMessage').textContent = error.message; } finally { restore.disabled = false; } };
        const download = document.createElement('button'); download.textContent = '파일로 보관';
        download.onclick = () => {
          const blob = new Blob([record.kind === 'document' ? record.xml : JSON.stringify(record,null,2)], {type: record.kind === 'document' ? 'application/xml' : 'application/json'});
          const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download=record.kind === 'document' ? record.name : record.name + '-초안.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        };
        const remove = document.createElement('button'); remove.textContent = '삭제';
        remove.onclick = async () => { if (record.tab === tab) { $('draftMessage').textContent='현재 탭의 작업입니다. 서버에 저장하면 해당 초안이 정리됩니다.'; return; } if (confirm('이 초안을 삭제할까요? 서버 문서는 그대로 남습니다.')) { try { await store.remove(record.id); await show(); } catch(error) { report(error); } } };
        row.append(restore,download,remove); list.append(row);
      }
    } catch(error) { $('draftMessage').textContent=error.message; report(error); }
  }
  window.YebaeonDrafts = { ...store, report, notify, show };
  $('draftOpen').onclick = show; $('draftClose').onclick=()=> $('draftDialog').close();
  store.all().then(records => { if(records.length)notify(`복구 가능한 초안 ${records.length}개 · ‘브라우저 초안’에서 확인`); }).catch(report);
})();

