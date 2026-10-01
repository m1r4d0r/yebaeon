(function () {
  'use strict';
  const $ = id => document.getElementById(id), cloud = window.YebaeonCloud;
  let plan = null, draft = [], dirty = false, busy = false, sequence = 0, context = null;
  let pickerTarget = -1, pickerNext = null, pickerSequence = 0;
  const message = value => { $('playlistsMessage').textContent = value; };
  function text(tag, value, className) { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }
  function button(label, action, disabled = false) {
    const b = text('button', label); b.disabled = disabled;
    b.onclick = async () => { b.disabled = true; try { await action(); } catch (e) { message(e.message); } finally { if (b.isConnected) b.disabled = disabled; } };
    return b;
  }
  function discard() { return !dirty || confirm('저장하지 않은 순서 변경이 있습니다. 이 변경을 버릴까요?'); }
  function close() { if (busy || !discard()) return; dirty = false; $('playlistsDialog').close(); }
  function updateContext() {
    $('playlistBack').hidden = !context;
    $('playlistContext').hidden = !context;
    $('playlistContext').textContent = context ? `${context.name}에서 편집 중` + (context.shared.length ? ` · 같은 재생목록 파일의 ${context.shared.join(', ')}에서도 사용하는 문서입니다.` : '') : '';
  }
  async function show() {
    if (!cloud.needUser()) return;
    if (!$('playlistsDialog').open) $('playlistsDialog').showModal();
    if (plan && !dirty) await load(plan.library.id, plan.playlist.id);
    else if (!plan) await home();
  }
  async function home() {
    if (busy || !discard()) return;
    dirty = false; plan = null; const token = ++sequence;
    $('playlistsTitle').textContent = '플레이리스트'; $('playlistDetail').hidden = true; $('playlistsList').hidden = false; $('playlistsList').replaceChildren();
    message('플레이리스트를 불러오고 있습니다…');
    try {
      let after = '', count = 0;
      do {
        const page = await (await cloud.api('/playlists?' + new URLSearchParams({ after }))).json();
        if (token !== sequence) return;
        for (const library of page.libraries) {
          if (!library.playlists.length) $('playlistsList').append(text('p', `${library.path} · 아직 순서가 없는 재생목록 파일입니다.`, 'dialog-help'));
          for (const playlist of library.playlists) {
            const row = text('div', '', 'library-row'), copy = document.createElement('div');
            copy.append(text('strong', playlist.name), text('small', `${playlist.itemCount}개 순서 · ${library.path} · ${library.updatedBy} 저장`));
            row.append(copy, button('열기', () => load(library.id, playlist.id))); $('playlistsList').append(row); count++;
          }
        }
        after = page.next;
      } while (after);
      message(count ? '예배 순서를 고른 뒤 곡이나 말씀을 열어 편집하세요.' : '처음에는 Mac의 .pro6pl 재생목록과 문서 폴더를 가져와 주세요.');
    } catch (e) { if (token === sequence) message(e.message); }
  }
  async function load(id, node) {
    if (busy || !discard()) return;
    const token = ++sequence; message('순서와 연결 문서를 확인하고 있습니다…');
    try {
      const value = await (await cloud.api(`/playlists/${id}/plan?` + new URLSearchParams({ node }))).json();
      if (token !== sequence) return;
      plan = value; draft = value.items.map(x => ({ ...x })); dirty = false; render();
      message(value.ready ? '곡·말씀을 열어 수정하고 서버에 저장하세요.' : '연결되지 않은 항목이 있습니다. 문서를 올리거나 연결할 문서를 교체한 뒤 새로고침해 주세요.');
    } catch (e) { if (token === sequence) message(e.message); }
  }
  function changed() { dirty = true; render(); message('순서 변경은 ‘순서 저장’을 눌러야 서버에 반영됩니다.'); }
  function render() {
    $('playlistsTitle').textContent = plan.playlist.name;
    $('playlistsList').hidden = true; $('playlistDetail').hidden = false;
    $('playlistSummary').textContent = `${plan.library.path} · 버전 ${plan.library.version} · ${plan.library.updatedBy} 저장 · ${draft.length}개 순서`;
    $('playlistDirty').textContent = dirty ? '저장하지 않은 순서 변경' : '저장된 순서';
    $('playlistSave').disabled = busy || !dirty || !plan.playlist.editable;
    $('playlistAdd').disabled = busy || !plan.playlist.editable;
    $('playlistItems').replaceChildren();
    if (!draft.length) $('playlistItems').append(text('p', '아직 순서가 없습니다. 곡이나 말씀을 추가해 보세요.', 'dialog-help'));
    draft.forEach((item, index) => {
      const row = text('div', '', 'playlist-item' + (item.kind === 'header' ? ' is-header' : '') + (item.issue ? ' has-issue' : ''));
      const copy = text('div', '', 'playlist-copy'); copy.append(text('strong', item.name || '이름 없음'));
      let detail = item.kind === 'header' ? '구분 항목' : item.document ? `${item.document.path} · 버전 ${item.document.version} · ${item.document.updatedBy}` : item.issue === 'unmapped' ? '문서 폴더와 연결되지 않는 경로 · ' + item.sourcePath : item.issue === 'unsupported' ? '이 종류의 항목은 아직 편집·동기화를 지원하지 않습니다.' : '아직 서버에 없는 문서 · ' + (item.path || item.sourcePath || '');
      if (item.sharedWith?.length) detail += ` · 함께 사용: ${item.sharedWith.join(', ')}`;
      copy.append(text('small', detail)); const actions = text('div', '', 'playlist-controls');
      if (item.document) actions.append(button('편집', async () => {
        if (dirty) { message('순서 변경을 먼저 저장한 뒤 문서를 열어 주세요.'); return; }
        if (await cloud.openDocument(item.document.id, true)) {
          context = { name: plan.playlist.name, shared: item.sharedWith || [] }; updateContext(); $('playlistsDialog').close();
        }
      }, busy));
      if (plan.playlist.editable) {
        if (item.kind === 'document') actions.append(button('교체', () => pick(index), busy));
        actions.append(button('↑', () => { [draft[index - 1], draft[index]] = [draft[index], draft[index - 1]]; changed(); }, busy || index === 0));
        actions.append(button('↓', () => { [draft[index + 1], draft[index]] = [draft[index], draft[index + 1]]; changed(); }, busy || index === draft.length - 1));
        actions.append(button('빼기', () => { draft.splice(index, 1); changed(); }, busy));
      }
      row.append(text('span', String(index + 1), 'playlist-number'), copy, actions); $('playlistItems').append(row);
    });
  }
  async function save() {
    if (!plan || busy || !dirty) return;
    busy = true; render(); message('순서를 저장하고 있습니다…');
    const id = plan.library.id, node = plan.playlist.id;
    try {
      const items = draft.map(x => ({ ...(x.id ? { id: x.id } : {}), ...(x.documentId ? { documentId: x.documentId } : {}) }));
      await cloud.api(`/playlists/${id}?` + new URLSearchParams({ node }), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': `"${plan.library.version}"` }, body: JSON.stringify({ items }) });
      dirty = false; busy = false; await load(id, node); message('순서를 저장했습니다. 교회 Mac에서 같은 플레이리스트를 동기화하세요.');
    } catch (e) { message(e.message + (e.status === 409 ? ' 현재 변경은 화면에 남아 있습니다. 새로고침하면 서버의 순서를 다시 가져옵니다.' : '')); }
    finally { busy = false; render(); }
  }
  async function pickerList(more = false) {
    const token = ++pickerSequence;
    if (!more) { pickerNext = null; $('playlistPickerList').replaceChildren(); }
    $('playlistPickerMore').hidden = true; $('playlistPickerMessage').textContent = '문서를 찾고 있습니다…';
    try {
      const result = await (await cloud.api('/documents?' + new URLSearchParams({ q: $('playlistPickerQuery').value.trim(), after: more ? pickerNext || '' : '' }))).json();
      if (token !== pickerSequence) return;
      for (const doc of result.documents) {
        const row = text('div', '', 'library-row'), copy = document.createElement('div'); copy.append(text('strong', doc.path), text('small', `버전 ${doc.version} · ${doc.updatedBy}`));
        row.append(copy, button(pickerTarget < 0 ? '추가' : '교체', () => {
          const previous = pickerTarget < 0 ? {} : draft[pickerTarget];
          const item = { ...previous, documentId: doc.id, document: doc, kind: 'document', name: doc.name.replace(/\.pro6$/i, ''), path: doc.path, sharedWith: [], issue: null };
          if (pickerTarget < 0) draft.push(item); else draft[pickerTarget] = item;
          changed(); $('playlistPickerDialog').close();
        })); $('playlistPickerList').append(row);
        const used = document.createElement('small'); copy.append(used); window.YebaeonUsage.show(used, doc);
      }
      pickerNext = result.next; $('playlistPickerMore').hidden = !pickerNext;
      $('playlistPickerMessage').textContent = $('playlistPickerList').children.length ? '' : '찾는 문서가 없으면 전체 문서에서 먼저 올려 주세요.';
    } catch (e) { if (token === pickerSequence) $('playlistPickerMessage').textContent = e.message; }
  }
  async function pick(index) { pickerTarget = index; $('playlistPickerQuery').value = ''; $('playlistPickerDialog').showModal(); await pickerList(); }
  $('cloudPlaylists').disabled = !cloud.online;
  $('cloudPlaylists').onclick = show; $('playlistBack').onclick = show;
  $('playlistsClose').onclick = close;
  $('playlistsDialog').addEventListener('cancel', e => { e.preventDefault(); close(); });
  $('playlistsHome').onclick = home; $('playlistsRefresh').onclick = () => plan ? load(plan.library.id, plan.playlist.id) : home();
  $('playlistsDocuments').onclick = () => $('cloudLibrary').click();
  $('playlistAdd').onclick = () => pick(-1); $('playlistSave').onclick = save;
  $('playlistsImport').onclick = () => { if (busy) return; $('playlistImportMessage').textContent = ''; $('playlistImportDialog').showModal(); };
  $('playlistImportCancel').onclick = () => $('playlistImportDialog').close();
  $('playlistImportForm').onsubmit = async e => {
    e.preventDefault(); const file = $('playlistFile').files[0]; if (!file) return;
    $('playlistImportSubmit').disabled = true; $('playlistImportMessage').textContent = '원본 재생목록을 저장하고 있습니다…';
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('재생목록은 5MB까지 가져올 수 있습니다.');
      await cloud.api('/playlists?' + new URLSearchParams({ path: file.name, root: $('playlistRoot').value.trim() }), { method: 'POST', headers: { 'Content-Type': 'application/xml; charset=utf-8' }, body: file });
      $('playlistImportDialog').close(); await home();
    } catch (error) { $('playlistImportMessage').textContent = error.message; }
    finally { $('playlistImportSubmit').disabled = false; }
  };
  $('playlistPickerClose').onclick = () => $('playlistPickerDialog').close();
  $('playlistPickerMore').onclick = () => pickerList(true);
  let timer; $('playlistPickerQuery').oninput = () => { clearTimeout(timer); timer = setTimeout(() => pickerList(), 250); };
  window.addEventListener('yebaeonopen', () => { context = null; updateContext(); });
  window.addEventListener('yebaeonclouddocument', event => { if (!event.detail.fromPlaylist) { context = null; updateContext(); $('playlistsDialog').close(); } });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.YebaeonPlaylists = { show };
  window.dispatchEvent(new Event('yebaeonplaylistsready'));
})();
