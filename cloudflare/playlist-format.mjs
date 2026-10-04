import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { HttpError } from './http.mjs';
import { documentPath } from './documents.mjs';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, parseTagValue: false, trimValues: false });
const fail = message => { throw new HttpError(400, 'invalid_playlist', message); };
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function sourceRoot(value = '~/Documents/ProPresenter6') {
  if (typeof value !== 'string') fail('원래 Mac 문서 폴더를 확인해 주세요.');
  value = value.normalize('NFC').replace(/\/+$/, '');
  if (!/^(~\/|\/Users\/)/.test(value) || value.length > 500 || value.split('/').some(p => p === '..' || p === '.') || /[\\\x00-\x1f]/.test(value)) fail('원래 Mac 문서 폴더를 확인해 주세요.');
  return value;
}
export function referencePath(value, root) {
  try {
    if (typeof value !== 'string') return null;
    if (value.startsWith('file:')) { const url = new URL(value); if (url.host || url.search || url.hash) return null; value = decodeURIComponent(url.pathname); }
    value = value.normalize('NFC'); root = sourceRoot(root);
    if (root.startsWith('~/')) value = value.replace(/^\/Users\/[^/]+\//, '~/');
    if (!value.startsWith(root + '/')) return null;
    return documentPath(value.slice(root.length + 1));
  } catch (_) { return null; }
}
export function parsePlaylist(xml) {
  if (typeof xml !== 'string' || !xml.length || xml.length > 5 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) fail('올바른 UTF-8 PP6 재생목록이 아닙니다.');
  const holder = { children: [] }, stack = [holder]; let count = 0;
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  for (const match of xml.matchAll(tokens)) {
    const tag = match[0]; if (/^<[!?]/.test(tag)) continue;
    if (++count > 100000 || stack.length > 64) fail('재생목록 구조가 너무 큽니다.');
    if (tag.startsWith('</')) { const node = stack.pop(); node.closeStart = match.index; node.end = match.index + tag.length; continue; }
    const name = /^<([^\s/>]+)/.exec(tag)?.[1]; if (!name) fail('재생목록 요소를 읽지 못했습니다.');
    const attrs = parser.parse(tag.replace(/\/?\s*>$/, '/>'))[name] || {};
    const node = { name, attrs, start: match.index, openEnd: match.index + tag.length, children: [], parent: stack.at(-1) };
    stack.at(-1).children.push(node);
    if (/\/\s*>$/.test(tag)) { node.end = node.openEnd; node.closeStart = node.openEnd; node.selfClosing = true; }
    else stack.push(node);
  }
  const root = holder.children[0]; if (root?.name !== 'RVPlaylistDocument' || stack.length !== 1) fail('PP6 재생목록 파일을 선택해 주세요.');
  const tree = root.children.find(n => n.name === 'RVPlaylistNode'); if (!tree) fail('재생목록 루트가 없습니다.');
  const container = childContainer(tree), nodes = container.children.filter(n => n.name === 'RVPlaylistNode');
  const keys = new Set();
  const playlists = nodes.map(node => {
    const id = node.attrs.UUID || node.attrs.displayName, name = node.attrs.displayName || '이름 없는 재생목록';
    if (!id || keys.has(id) || String(id).length > 240) fail('구분할 수 없는 재생목록 이름/번호가 있습니다.'); keys.add(id);
    const body = childContainer(node), ids = new Set();
    const items = body.children.map((cue, index) => {
      const id = cue.attrs.UUID || `item-${index}`, kind = cue.name === 'RVDocumentCue' ? 'document' : cue.name === 'RVHeaderCue' ? 'header' : 'unsupported';
      if (ids.has(id)) fail('재생목록 안에 중복 항목 번호가 있습니다.'); ids.add(id);
      return { id, kind, name: cue.attrs.displayName || (kind === 'header' ? '구분' : '이름 없음'), sourcePath: cue.attrs.filePath || '', node: cue };
    });
    return { id, name, node, body, items, editable: items.every(x => x.kind !== 'unsupported') };
  });
  return { xml, root, tree, playlists };
}
function childContainer(node) {
  const arrays = node.children.filter(n => n.name === 'array' && (n.attrs.rvXMLIvarName === 'children' || n.attrs.rvXMLIvarName === 'items'));
  return arrays[0] || node;
}
export function catalog(parsed) { return parsed.playlists.map(p => ({ id: p.id, name: p.name, itemCount: p.items.length })); }
export function playlistName(value) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>120||/[\x00-\x1f\x7f]/.test(value))fail('재생목록 이름은 1~120자로 입력해 주세요.');
  return value.trim().normalize('NFC');
}
export function appendPlaylist(parsed, xml) {
  const body=childContainer(parsed.tree);
  const next=body.selfClosing
    ? parsed.xml.slice(0,body.start)+parsed.xml.slice(body.start,body.end).replace(/\/\s*>$/,'>')+'\n'+xml+`\n</${body.name}>`+parsed.xml.slice(body.end)
    : parsed.xml.slice(0,body.closeStart)+'\n'+xml+'\n'+parsed.xml.slice(body.closeStart);
  parsePlaylist(next);return next;
}
export function newPlaylistNode(name,id) {
  return `<RVPlaylistNode UUID="${escape(id)}" displayName="${escape(playlistName(name))}" type="3" smartDirectoryURL="" isExpanded="false" hotFolderType="2"><array rvXMLIvarName="children"/></RVPlaylistNode>`;
}
export function removePlaylist(parsed,id) {
  const selected=parsed.playlists.find(p=>p.id===id);if(!selected)fail('재생목록을 찾지 못했습니다.');
  return parsed.xml.slice(0,selected.node.start)+parsed.xml.slice(selected.node.end);
}
function attr(raw, key, value) {
  const end = raw.match(/^<(?:[^>"']|"[^"]*"|'[^']*')*>/)?.[0]; if (!end) fail('순서 항목을 읽지 못했습니다.');
  const re = new RegExp(`\\s${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
  const next = re.test(end) ? end.replace(re, () => ` ${key}="${escape(value)}"`) : end.replace(/\/?\s*>$/, ending => ` ${key}="${escape(value)}"${ending}`);
  return next + raw.slice(end.length);
}
export function editPlaylist(parsed, nodeId, entries, documents, root) {
  const playlist = parsed.playlists.find(p => p.id === nodeId);
  if (!playlist || !playlist.editable) fail('이 재생목록의 순서 편집은 지원하지 않습니다.');
  if (!Array.isArray(entries) || entries.length > 2000) fail('순서 항목을 확인해 주세요.');
  const existing = new Map(playlist.items.map(x => [x.id, x])), used = new Set();
  const pieces = entries.map(entry => {
    if (!entry || typeof entry !== 'object') fail('순서 항목이 올바르지 않습니다.');
    let item, raw;
    if (entry.id) { item = existing.get(entry.id); if (!item || used.has(entry.id)) fail('중복되거나 없는 순서 항목입니다.'); used.add(entry.id); raw = parsed.xml.slice(item.node.start, item.node.end); }
    if (entry.documentId) {
      const doc = documents.get(entry.documentId); if (!doc) fail('추가할 문서를 찾지 못했습니다.');
      if (item && item.kind !== 'document') fail('구분 항목은 문서로 교체할 수 없습니다.');
      if (!item) raw = `<RVDocumentCue UUID="${crypto.randomUUID().toUpperCase()}" displayName="" actionType="0" enabled="1" timeStamp="0" delayTime="0" filePath="" selectedArrangementID=""/>`;
      raw = attr(attr(attr(raw, 'filePath', sourceRoot(root) + '/' + (doc.originalPath||doc.path)), 'displayName', doc.name.replace(/\.pro6$/i, '')), 'selectedArrangementID', '');
    }
    if (entry.headerXML) {
      if(item || entry.documentId || typeof entry.headerXML!=='string' || entry.headerXML.length>65536)fail('구분 항목 복원 내용을 확인해 주세요.');
      const wrapped=parsePlaylist(`<RVPlaylistDocument><RVPlaylistNode><RVPlaylistNode UUID="restore"><array rvXMLIvarName="children">${entry.headerXML}</array></RVPlaylistNode></RVPlaylistNode></RVPlaylistDocument>`);
      const entries=wrapped.playlists[0]?.items;if(entries?.length!==1||entries[0].kind!=='header'||wrapped.xml.slice(entries[0].node.start,entries[0].node.end)!==entry.headerXML.trim())fail('구분 항목만 복원할 수 있습니다.');
      raw=entry.headerXML;
    }
    if (!raw) fail('문서를 선택해 주세요.'); return raw;
  });
  const { body } = playlist;
  const xml = body.selfClosing
    ? parsed.xml.slice(0, body.start) + parsed.xml.slice(body.start,body.end).replace(/\/\s*>$/, '>') + '\n' + pieces.join('\n') + `\n</${body.name}>` + parsed.xml.slice(body.end)
    : parsed.xml.slice(0, body.openEnd) + '\n' + pieces.join('\n') + '\n' + parsed.xml.slice(body.closeStart);
  // A direct-child fixture places metadata alongside cues; such children are marked unsupported above.
  parsePlaylist(xml); return xml;
}

// 문서 이름 바꾸기: 모든 예배에서 옛 경로를 가리키는 큐의 filePath를 새 경로로 바꾼다.
// 표시 이름이 옛 파일 이름 그대로였던 큐만 새 이름으로 바꾼다. 가리키는 곳이 없으면 null.
export function renameReferences(parsed, root, oldPath, newPath) {
  const hits = [];
  for (const p of parsed.playlists) for (const item of p.items) if (item.kind === 'document' && referencePath(item.sourcePath, root) === oldPath) hits.push(item);
  if (!hits.length) return null;
  const stem = path => path.split('/').pop().replace(/\.pro6$/i, ''), oldName = stem(oldPath), newName = stem(newPath);
  let xml = parsed.xml;
  for (const item of hits.sort((a, b) => b.node.start - a.node.start)) {
    let raw = xml.slice(item.node.start, item.node.end);
    raw = attr(raw, 'filePath', sourceRoot(root) + '/' + newPath);
    if ((item.node.attrs.displayName || '') === oldName) raw = attr(raw, 'displayName', newName);
    xml = xml.slice(0, item.node.start) + raw + xml.slice(item.node.end);
  }
  parsePlaylist(xml); return xml;
}
// 예배 이름 바꾸기: 그 노드의 여는 태그 displayName만 바꾼다.
export function renamePlaylistNode(parsed, id, name) {
  const selected = parsed.playlists.find(p => p.id === id); if (!selected) fail('재생목록을 찾지 못했습니다.');
  const raw = attr(parsed.xml.slice(selected.node.start, selected.node.end), 'displayName', playlistName(name));
  const xml = parsed.xml.slice(0, selected.node.start) + raw + parsed.xml.slice(selected.node.end);
  parsePlaylist(xml); return xml;
}
