(function () {
  'use strict';
  const $ = id => document.getElementById(id), editor = window.YebaeonEditor;
  const online = /^https?:$/.test(location.protocol);
  let user = null, ready = false, linked = null, epoch = 0, saving = false;
  let listNext = null, listSequence = 0, historyDoc = null, historyNext = null;
  const rememberName = name => { try { localStorage.setItem('yebaeon.workerName', name); } catch (_) {} };
  const recalledName = () => { try { return localStorage.getItem('yebaeon.workerName') || ''; } catch (_) { return ''; } };
  const time = value => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  function update() {
    $('cloudAccount').textContent = online ? (user ? user.name + ' · 작업 중' : '입장하기') : '로컬 모드';
    $('cloudAccount').disabled = !online;
    $('cloudLibrary').disabled = !online;
    $('cloudSave').disabled = !user || saving;
    $('cloudSave').textContent = saving ? '저장 중…' : '서버에 저장';
    $('cloudHistory').hidden = !linked || !user;
    const changed = linked && editor.state().serial !== linked.serial;
    $('cloudContext').textContent = linked ? `${linked.path} · 버전 ${linked.version} · ${linked.updatedBy} 저장${changed ? ' · 저장하지 않은 변경 있음' : ''}` : '로컬 문서 · 서버에 저장하지 않았습니다.';
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
    $('entryMessage').textContent = ready ? '' : '서버 연결 준비 중입니다. 지금은 로컬 파일로 작업할 수 있습니다.';
    if (!$('entryDialog').open) $('entryDialog').showModal();
  }
  async function showPlaylists() {
    if (!window.YebaeonPlaylists) await new Promise(resolve => window.addEventListener('yebaeonplaylistsready', resolve, { once: true }));
    await window.YebaeonPlaylists.show();
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
    const sequence = ++listSequence, query = $('libraryQuery').value.trim();
    if (!more) { listNext = null; $('libraryList').replaceChildren(); }
    $('libraryMore').hidden = true; $('libraryMessage').textContent = '문서 목록을 불러오고 있습니다…';
    try {
      const data = await (await api('/documents?' + new URLSearchParams({ q: query, after: more ? listNext || '' : '' }))).json();
      if (sequence !== listSequence) return;
      for (const doc of data.documents) $('libraryList').append(row(doc.path, `버전 ${doc.version} · ${doc.updatedBy} · ${time(doc.updatedAt)} · ${Math.ceil(doc.size / 1024)}KB`, '열기', () => openCloud(doc.id)));
      listNext = data.next; $('libraryMore').hidden = !listNext;
      if (!$('libraryList').children.length) empty($('libraryList'), query ? '검색 결과가 없습니다.' : '아직 저장된 문서가 없습니다. .pro6 파일을 올려 시작해 보세요.');
      $('libraryMessage').textContent = '';
    } catch (error) { if (sequence === listSequence) $('libraryMessage').textContent = error.message; }
  }
  async function openCloud(id, fromPlaylist = false) {
    try {
      const { document: doc } = await (await api('/documents/' + id)).json();
      const response = await api(`/documents/${id}/content?version=${doc.version}`), bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      if (hash !== doc.sha256) throw new Error('받은 문서를 확인하지 못했습니다. 다시 열어 주세요.');
      if (!editor.open(new TextDecoder('utf-8', { fatal: true }).decode(bytes), doc.name)) return false;
      linked = { ...doc, serial: editor.state().serial }; update(); $('libraryDialog').close();
      window.dispatchEvent(new CustomEvent('yebaeonclouddocument', { detail: { doc, fromPlaylist } }));
      editor.status(`${doc.updatedBy}님이 ${time(doc.updatedAt)}에 저장한 버전 ${doc.version}을 열었습니다.`);
      return true;
    } catch (error) { $('libraryMessage').textContent = error.message; editor.status(error.message); if (fromPlaylist) throw error; return false; }
  }
  async function upload(files, folder) {
    if (!needUser()) return;
    const documents = Array.from(files).filter(file => /\.pro6$/i.test(file.name));
    if (!documents.length) { $('libraryMessage').textContent = '.pro6 문서를 선택해 주세요.'; return; }
    for (const id of ['libraryUpload', 'libraryFolder', 'libraryRefresh', 'libraryQuery']) $(id).disabled = true;
    let uploaded = 0, unchanged = 0; const failures = [];
    try {
      for (let i = 0; i < documents.length; i++) {
        const file = documents[i];
        const path = folder && file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
        $('libraryMessage').textContent = `${i + 1} / ${documents.length} · ${path} 업로드 중…`;
        try {
          if (file.size > 25 * 1024 * 1024) throw new Error('25MB를 넘습니다.');
          const result = await (await api('/documents?' + new URLSearchParams({ path }), { method: 'POST', headers: { 'Content-Type': 'application/xml; charset=utf-8' }, body: file })).json();
          if (result.unchanged) unchanged++; else uploaded++;
        } catch (error) {
          failures.push(`${path}: ${error.message}`);
          if (error.status === 401 || error.status === 503) { failures.push(`남은 ${documents.length - i - 1}개는 아직 올리지 않았습니다. 같은 폴더를 다시 선택해 이어갈 수 있습니다.`); break; }
        }
      }
      if (user) await list();
      $('libraryMessage').textContent = `새 문서 ${uploaded}개 · 이미 같은 내용 ${unchanged}개` + (failures.length ? '\n' + failures.slice(0, 20).join('\n') + (failures.length > 20 ? `\n외 ${failures.length - 20}개 오류` : '') : ' · 업로드 완료');
    } finally { for (const id of ['libraryUpload', 'libraryFolder', 'libraryRefresh', 'libraryQuery']) $(id).disabled = false; }
  }
  async function save(path) {
    if (!needUser() || saving) return;
    if (editor.hasPackageMedia()) throw new Error('새 미디어를 교체한 문서는 지금은 ZIP으로 저장해 주세요. 서버는 기존 미디어 경로를 유지하는 .pro6 문서를 지원합니다.');
    const current = editor.document(), target = linked, startedEpoch = epoch;
    if (target && target.serial === current.serial) { editor.status('이미 서버에 저장된 내용입니다.'); return; }
    saving = true; update();
    try {
      const endpoint = target ? '/documents/' + target.id : '/documents?' + new URLSearchParams({ path });
      const result = await (await api(endpoint, { method: target ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/xml; charset=utf-8', ...(target ? { 'If-Match': `"${target.version}"` } : {}) }, body: current.xml })).json();
      if (epoch === startedEpoch) {
        linked = { ...result.document, serial: current.serial }; editor.markSaved(current.serial);
        const newer = editor.state().serial !== current.serial;
        editor.status(`${result.document.updatedBy} · 버전 ${result.document.version} 서버 저장 완료.${newer ? ' 저장 중에 추가한 변경은 아직 저장되지 않았습니다.' : ''}`);
      }
      $('saveDialog').close();
      window.dispatchEvent(new CustomEvent('yebaeoncloudsaved', { detail: result.document }));
    } finally { saving = false; update(); }
  }
  async function history(more = false) {
    if (!historyDoc || !needUser()) return;
    const doc = historyDoc;
    if (!more) { historyNext = null; $('historyList').replaceChildren(); }
    $('historyMore').hidden = true; $('historyMessage').textContent = '저장 이력을 불러오고 있습니다…';
    try {
      const result = await (await api(`/documents/${doc.id}/versions` + (more ? '?before=' + historyNext : ''))).json();
      for (const version of result.versions) {
        const item = row(`버전 ${version.version} · ${version.author}`, `${time(version.createdAt)} · ${Math.ceil(version.size / 1024)}KB`, '', () => {});
        const link = document.createElement('a');
        link.className = 'document-download'; link.textContent = '.pro6 받기';
        link.href = `/api/documents/${doc.id}/content?version=${version.version}`;
        link.download = doc.name.replace(/\.pro6$/i, '') + `-v${version.version}.pro6`;
        item.querySelector('button').replaceWith(link); $('historyList').append(item);
      }
      historyNext = result.next; $('historyMore').hidden = !historyNext; $('historyMessage').textContent = doc.path;
    } catch (error) { $('historyMessage').textContent = error.message; }
  }
  $('entryForm').onsubmit = async event => {
    event.preventDefault(); $('entrySubmit').disabled = true; $('entryMessage').textContent = '확인하고 있습니다…';
    try {
      user = await (await api('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('entryName').value, password: $('entryPassword').value, remember: $('entryRemember').checked }) })).json();
      rememberName(user.name); update(); $('entryDialog').close(); await showPlaylists();
    } catch (error) { $('entryMessage').textContent = error.message; }
    finally { $('entryPassword').value = ''; $('entrySubmit').disabled = !ready; }
  };
  $('entryLocal').onclick = () => $('entryDialog').close();
  $('cloudLibrary').onclick = () => { if (needUser()) { $('libraryDialog').showModal(); list(); } };
  $('libraryClose').onclick = () => $('libraryDialog').close();
  $('libraryRefresh').onclick = () => list(); $('libraryMore').onclick = () => list(true);
  let searchTimer; $('libraryQuery').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => list(), 250); };
  $('libraryUpload').onclick = () => $('uploadDocuments').click(); $('libraryFolder').onclick = () => $('uploadFolder').click();
  $('uploadDocuments').onchange = event => { const files = Array.from(event.target.files); event.target.value = ''; upload(files, false); };
  $('uploadFolder').onchange = event => { const files = Array.from(event.target.files); event.target.value = ''; upload(files, true); };
  $('cloudSave').onclick = async () => {
    if (!needUser()) return;
    try {
      if (linked) await save();
      else { $('savePath').value = editor.state().name; $('saveMessage').textContent = ''; $('saveDialog').showModal(); }
    } catch (error) { editor.status(error.message); }
  };
  $('saveForm').onsubmit = async event => { event.preventDefault(); $('saveConfirm').disabled = true; try { await save($('savePath').value); } catch (error) { $('saveMessage').textContent = error.message; } finally { $('saveConfirm').disabled = false; } };
  $('saveCancel').onclick = () => $('saveDialog').close();
  $('cloudAccount').onclick = () => { if (needUser()) { $('accountName').value = user.name; $('accountMessage').textContent = ''; $('accountDialog').showModal(); } };
  $('accountClose').onclick = () => $('accountDialog').close();
  $('accountForm').onsubmit = async event => {
    event.preventDefault();
    try { user = await (await api('/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('accountName').value }) })).json(); rememberName(user.name); update(); $('accountDialog').close(); }
    catch (error) { $('accountMessage').textContent = error.message; }
  };
  $('accountLogout').onclick = async () => {
    try { await api('/session', { method: 'DELETE' }); user = null; update(); $('accountDialog').close(); showEntry(); }
    catch (error) { $('accountMessage').textContent = error.message; }
  };
  $('cloudHistory').onclick = () => { if (linked && needUser()) { historyDoc = { ...linked }; $('historyDialog').showModal(); history(); } };
  $('historyClose').onclick = () => $('historyDialog').close(); $('historyMore').onclick = () => history(true);
  window.addEventListener('yebaeonopen', () => { epoch++; linked = null; update(); });
  window.addEventListener('yebaeonchange', () => queueMicrotask(update));
  window.YebaeonCloud = { api, needUser, openDocument: openCloud, online };
  update();
  if (online) (async () => {
    try {
      const state = await (await api('/session')).json(); ready = state.ready;
      if (state.authenticated) { user = state; rememberName(user.name); update(); await showPlaylists(); }
      else showEntry();
    } catch (_) { ready = false; showEntry(); $('entryMessage').textContent = '서버에 연결하지 못했습니다. 로컬 파일 작업은 계속할 수 있습니다.'; }
  })();
})();
