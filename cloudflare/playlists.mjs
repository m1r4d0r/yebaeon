import { HttpError, bytes, headers, json, method, sameOrigin, sha256 } from './http.mjs';
import { parsePlaylist, catalog, referencePath, sourceRoot, editPlaylist } from './playlist-format.mjs';
import { catalogDocument } from './library-catalog.mjs';
import {archiveList,protectManagedPlaylists,managePlaylist} from './playlist-management.mjs';
const MAX = 5 * 1024 * 1024;
const conflict = () => new HttpError(409, 'playlist_conflict', '재생목록이 먼저 변경됐습니다. 새로고침 후 다시 확인해 주세요.');
function metadata(r) { return { id: r.id, path: r.path, version: r.current_version, sha256: r.sha256, size: r.size, updatedAt: r.updated_at, updatedBy: r.updated_by, sourceRoot: r.source_root, playlists: JSON.parse(r.catalog) }; }
function doc(r) { return { id: r.id, path: r.path, name: r.path.split('/').pop(), version: r.current_version, sha256: r.sha256, size: r.size, updatedAt: r.updated_at, updatedBy: r.updated_by }; }
async function row(db, id) { const r = await db.prepare('SELECT * FROM yebaeon_playlists WHERE id = ?').bind(id).first(); if (!r) throw new HttpError(404, 'not_found', '재생목록을 찾지 못했습니다.'); return r; }
async function read(request) {
  const data = await bytes(request, MAX); let xml;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new HttpError(400, 'invalid_playlist', 'UTF-8 재생목록을 선택해 주세요.'); }
  return { data, xml, parsed: parsePlaylist(xml), hash: await sha256(data) };
}
async function load(env, r) {
  const v = await env.DB.prepare('SELECT * FROM yebaeon_playlist_versions WHERE library_id = ? AND version = ?').bind(r.id, r.current_version).first();
  const object = v && await env.FILES.get(v.object_key); if (!object) throw new HttpError(503, 'file_unavailable', '재생목록 원본을 읽지 못했습니다.');
  return parsePlaylist(await object.text());
}
async function nodeSnapshots(parsed) {
  return Promise.all(parsed.playlists.map(async p=>{const xml=parsed.xml.slice(p.node.start,p.node.end);return {id:p.id,name:p.name,xml,sha256:await sha256(new TextEncoder().encode(xml))};}));
}
async function enriched(env,r) {
  const result=metadata(r),nodes=await nodeSnapshots(await load(env,r)),versions=(await env.DB.prepare('SELECT n.* FROM yebaeon_playlist_node_versions n WHERE library_id=? AND version=(SELECT MAX(version) FROM yebaeon_playlist_node_versions WHERE library_id=n.library_id AND node_id=n.node_id)').bind(r.id).all()).results;
  result.playlists=result.playlists.map(p=>{const v=versions.find(v=>v.node_id===p.id);return {...p,sha256:nodes.find(n=>n.id===p.id)?.sha256,version:v?.version||1,updatedBy:v?.author||r.updated_by,updatedAt:v?.created_at||r.updated_at};});return result;
}
function nodeInsert(db,r,n,fileVersion,author,at,guard=false) {
  return db.prepare(`INSERT OR IGNORE INTO yebaeon_playlist_node_versions(library_id,node_id,version,file_version,name,xml,sha256,author,created_at)
    SELECT ?,?,COALESCE((SELECT MAX(version) FROM yebaeon_playlist_node_versions WHERE library_id=? AND node_id=?),0)+1,?,?,?,?,?,? ${guard?'WHERE EXISTS(SELECT 1 FROM yebaeon_playlists WHERE id=? AND current_version=? AND write_id=?)':''}`)
    .bind(r.id,n.id,r.id,n.id,fileVersion,n.name,n.xml,n.sha256,author,at,...(guard?[r.id,fileVersion,r.write_id]:[]));
}
async function baseline(env,r,parsed) {
  const nodes=await nodeSnapshots(parsed),existing=(await env.DB.prepare('SELECT DISTINCT node_id FROM yebaeon_playlist_node_versions WHERE library_id=?').bind(r.id).all()).results;const missing=nodes.filter(n=>!existing.some(v=>v.node_id===n.id));if(missing.length)await env.DB.batch(missing.map(n=>nodeInsert(env.DB,r,n,r.current_version,r.updated_by,r.updated_at)));return nodes;
}
async function save(env, user, r, content,extra=()=>[]) {
  if (content.data.length > MAX) throw new HttpError(413, 'too_large', '재생목록은 5MB까지 저장할 수 있습니다.');
  if (content.hash === r.sha256) return { library: metadata(r), unchanged: true };
  const next = r.current_version + 1, writeId = crypto.randomUUID(), key = `playlists/${r.id}/${writeId}.pro6pl`, now = new Date().toISOString(), summary = JSON.stringify(catalog(content.parsed));
  await env.FILES.put(key, content.data, { httpMetadata: { contentType: 'application/xml' }, sha256: content.hash });
  const previous=await baseline(env,r,await load(env,r)),nodes=await nodeSnapshots(content.parsed);
  const changes=nodes.filter(n=>previous.find(p=>p.id===n.id)?.sha256!==n.sha256);
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE yebaeon_playlists SET current_version=?, updated_at=?, updated_by=?, sha256=?, size=?, write_id=?, catalog=? WHERE id=? AND current_version=?').bind(next, now, user.author, content.hash, content.data.length, writeId, summary, r.id, r.current_version),
    env.DB.prepare('INSERT INTO yebaeon_playlist_versions(library_id,version,object_key,sha256,size,author,created_at) SELECT id,?,?,?,?,?,? FROM yebaeon_playlists WHERE id=? AND write_id=?').bind(next,key,content.hash,content.data.length,user.author,now,r.id,writeId),
    ...changes.map(n=>nodeInsert(env.DB,{...r,write_id:writeId},n,next,user.author,now,true)),
    ...extra(writeId,now)
  ]);
  if (results[0].meta.changes !== 1) throw conflict();
  return { library: metadata({ ...r, current_version: next, updated_at: now, updated_by: user.author, sha256: content.hash, size: content.data.length, catalog: summary }) };
}
export async function playlistsRoute(request, env, user, id, action) {
  const url = new URL(request.url), db = env.DB;
  if (!id) {
    method(request, ['GET', 'POST']);
    if (request.method === 'GET') {
      if(url.searchParams.get('scope')==='archived')return archiveList(request,env);
      const after = url.searchParams.get('after') || '';
      const rows = (await db.prepare('SELECT * FROM yebaeon_playlists WHERE path > ? ORDER BY path LIMIT 51').bind(after).all()).results;
      return json({ libraries: await Promise.all(rows.slice(0,50).map(r=>enriched(env,r))), next: rows.length > 50 ? rows[49].path : null });
    }
    sameOrigin(request); const path = (url.searchParams.get('path') || '').normalize('NFC'), root = sourceRoot(url.searchParams.get('root') || undefined);
    if (!path || path.length > 160 || /[\\/\x00-\x1f]/.test(path) || !/\.pro6pl$/i.test(path)) throw new HttpError(400, 'invalid_path', '.pro6pl 파일 이름을 확인해 주세요.');
    const content = await read(request), existing = await db.prepare('SELECT * FROM yebaeon_playlists WHERE path=?').bind(path).first();
    if (existing) { if (existing.sha256 === content.hash && existing.source_root === root) return json({ library: metadata(existing), unchanged: true }); throw conflict(); }
    const libraryId = crypto.randomUUID(), writeId = crypto.randomUUID(), key = `playlists/${libraryId}/${writeId}.pro6pl`, now = new Date().toISOString(), summary = JSON.stringify(catalog(content.parsed));
    await env.FILES.put(key, content.data, { httpMetadata: { contentType: 'application/xml' }, sha256: content.hash });
    try {
      await db.batch([
        db.prepare('INSERT INTO yebaeon_playlists(id,path,source_root,current_version,updated_at,updated_by,sha256,size,write_id,catalog) VALUES (?,?,?,1,?,?,?,?,?,?)').bind(libraryId,path,root,now,user.author,content.hash,content.data.length,writeId,summary),
        db.prepare('INSERT INTO yebaeon_playlist_versions(library_id,version,object_key,sha256,size,author,created_at) VALUES (?,1,?,?,?,?,?)').bind(libraryId,key,content.hash,content.data.length,user.author,now)
      ]);
    } catch (error) {
      const winner = await db.prepare('SELECT * FROM yebaeon_playlists WHERE path=?').bind(path).first();
      if (winner?.id === libraryId) return json({ library: metadata(winner) },201);
      if (winner) throw conflict(); throw error;
    }
    return json({ library: metadata(await row(db,libraryId)) },201);
  }
  const r = await row(db,id);
  if(action==='structure'){
    method(request,['GET']);
    const removals=(await db.prepare("SELECT node_id AS id,name,state,updated_at AS updatedAt FROM yebaeon_playlist_controls WHERE library_id=? AND state IN ('archived','removed') ORDER BY node_id").bind(id).all()).results;
    return json({library:metadata(r),removals,fingerprint:await sha256(JSON.stringify([r.sha256,removals]))});
  }
  if(['nodes','archive','restore'].includes(action))return managePlaylist(request,env,user,r,action,{load,save,metadata});
  if (action === 'content') {
    method(request,['GET','HEAD']);
    if(url.searchParams.has('node')){
      const node=url.searchParams.get('node'),version=Number(url.searchParams.get('nodeVersion'));
      if(!Number.isSafeInteger(version)||version<1)throw new HttpError(400,'invalid_version','버전을 확인해 주세요.');
      const old=await db.prepare('SELECT xml FROM yebaeon_playlist_node_versions WHERE library_id=? AND node_id=? AND version=?').bind(id,node,version).first(),parsed=await load(env,r),selected=parsed.playlists.find(p=>p.id===node);
      if(!old||!selected)throw new HttpError(404,'not_found','이전 순서가 없습니다.');
      const xml=parsed.xml.slice(0,selected.node.start)+old.xml+parsed.xml.slice(selected.node.end);
      return new Response(request.method==='HEAD'?null:xml,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.path)}`}});
    }
    const number = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : r.current_version;
    if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400,'invalid_version','버전을 확인해 주세요.');
    const version = await db.prepare('SELECT * FROM yebaeon_playlist_versions WHERE library_id=? AND version=?').bind(id,number).first();
    if (!version) throw new HttpError(404,'not_found','이전 버전이 없습니다.'); const object = await env.FILES.get(version.object_key);
    if (!object) throw new HttpError(503,'file_unavailable','원본을 읽지 못했습니다.');
    return new Response(request.method === 'HEAD' ? null : object.body,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.path)}`,'X-Yebaeon-Version':String(number),'X-Yebaeon-SHA256':version.sha256}});
  }
  if (action === 'plan') {
    method(request,['GET']); const parsed = await load(env,r), playlist = parsed.playlists.find(p => p.id === url.searchParams.get('node'));
    if (!playlist) throw new HttpError(404,'not_found','순서를 찾지 못했습니다.');
    const paths = [...new Set(playlist.items.filter(x => x.kind === 'document').map(x => referencePath(x.sourcePath,r.source_root)).filter(Boolean))], map = new Map();
    for (let offset=0;offset<paths.length;offset+=80) {
      const slice=paths.slice(offset,offset+80), rows=(await db.prepare(`SELECT * FROM yebaeon_documents WHERE path IN (${slice.map(()=>'?').join(',')})`).bind(...slice).all()).results;
      for (const value of rows) map.set(value.path,doc(value));
    }
    const indexed=new Map();
    if(url.searchParams.get('includeIndexed')==='1'){
      for(let offset=0;offset<paths.length;offset+=80){const slice=paths.slice(offset,offset+80);const rows=(await db.prepare(`SELECT * FROM yebaeon_library_catalog WHERE path IN (${slice.map(()=>'?').join(',')})`).bind(...slice).all()).results;for(const value of rows)indexed.set(value.path,catalogDocument(value));}
    }
    const items = playlist.items.map(item => {
      const path = item.kind === 'document' ? referencePath(item.sourcePath,r.source_root) : null;
      const document = path ? map.get(path) || null : null;
      const sharedWith = path ? parsed.playlists.filter(p=>p.id!==playlist.id && p.items.some(x=>x.kind==='document' && referencePath(x.sourcePath,r.source_root)===path)).map(p=>p.name) : [];
      return {id:item.id,raw:parsed.xml.slice(item.node.start,item.node.end),kind:item.kind,name:item.name,sourcePath:item.sourcePath,path,document,...(indexed.has(path)&&!document?{indexedDocument:indexed.get(path)}:{}),sharedWith,issue:item.kind==='unsupported' ? 'unsupported' : item.kind==='document' && !document ? (path ? 'missing' : 'unmapped') : null};
    });
    const documents = [...new Map(items.filter(x=>x.document).map(x=>[x.document.id,x.document])).values()];
    const nodeVersion=await db.prepare('SELECT version,author,created_at FROM yebaeon_playlist_node_versions WHERE library_id=? AND node_id=? ORDER BY version DESC LIMIT 1').bind(id,playlist.id).first();
    const nodeXml = parsed.xml.slice(playlist.node.start,playlist.node.end), nodeHash = await sha256(new TextEncoder().encode(nodeXml));
    const fingerprint = await sha256(new TextEncoder().encode(JSON.stringify([r.id,playlist.id,nodeHash,items.map(x=>[x.id,x.path,x.issue,x.document?.version,x.document?.sha256])])));
    if ((await row(db,id)).current_version!==r.current_version) throw conflict();
    return json({library:metadata(r),playlist:{id:playlist.id,name:playlist.name,xml:nodeXml,sha256:nodeHash,version:nodeVersion?.version||1,updatedBy:nodeVersion?.author||r.updated_by,updatedAt:nodeVersion?.created_at||r.updated_at,editable:playlist.editable},items,documents,fingerprint,ready:items.every(x=>!x.issue)});
  }
  if (action === 'versions') {
    method(request,['GET']);const before=Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
    if(url.searchParams.has('node')){
      const parsed=await load(env,r);await baseline(env,r,parsed);const node=url.searchParams.get('node');
      if(!parsed.playlists.some(p=>p.id===node))throw new HttpError(404,'not_found','순서를 찾지 못했습니다.');
      const rows=(await db.prepare('SELECT version,file_version AS fileVersion,name,sha256,author,created_at AS createdAt FROM yebaeon_playlist_node_versions WHERE library_id=? AND node_id=? AND version<? ORDER BY version DESC LIMIT 51').bind(id,node,before).all()).results;
      return json({versions:rows.slice(0,50),next:rows.length>50?rows[49].version:null});
    }
    const rows=(await db.prepare('SELECT version,sha256,size,author,created_at AS createdAt FROM yebaeon_playlist_versions WHERE library_id=? AND version<? ORDER BY version DESC LIMIT 51').bind(id,before).all()).results;
    return json({versions:rows.slice(0,50),next:rows.length>50 ? rows[49].version : null});
  }
  method(request,['GET','PUT','PATCH']); if(request.method==='GET')return json({library:metadata(r)});
  sameOrigin(request);const match=request.headers.get('If-Match');if(!match || !/^"[1-9][0-9]*"$/.test(match))throw new HttpError(428,'version_required','재생목록 기준 버전이 필요합니다.');if(request.method==='PUT'&&Number(match.slice(1,-1))!==r.current_version)throw conflict();
  if(request.method==='PUT'){const content=await read(request);await protectManagedPlaylists(env,r,content.parsed);return json(await save(env,user,r,content));}
  const raw=await bytes(request,512*1024);let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new HttpError(400,'invalid_playlist','순서 변경 내용을 확인해 주세요.');}
  if(!body || (!Array.isArray(body.items)&&!Number.isSafeInteger(body.restoreVersion)) || body.items?.length>2000)throw new HttpError(400,'invalid_playlist','순서 목록이 필요합니다.');
  const docs=new Map(), ids=[...new Set((body.items||[]).map(x=>x?.documentId).filter(Boolean))];
  if(ids.some(x=>typeof x!=='string' || !/^[0-9a-f-]{36}$/i.test(x)))throw new HttpError(400,'invalid_playlist','문서 번호를 확인해 주세요.');
  for(let offset=0;offset<ids.length;offset+=80){const slice=ids.slice(offset,offset+80), found=(await db.prepare(`SELECT * FROM yebaeon_documents WHERE id IN (${slice.map(()=>'?').join(',')})`).bind(...slice).all()).results;for(const value of found)docs.set(value.id,doc(value));}
  const missing=ids.filter(id=>!docs.has(id));if(missing.length){for(let offset=0;offset<missing.length;offset+=80){const slice=missing.slice(offset,offset+80),found=(await db.prepare(`SELECT * FROM yebaeon_library_catalog WHERE id IN (${slice.map(()=>'?').join(',')})`).bind(...slice).all()).results;for(const value of found)docs.set(value.id,catalogDocument(value));}}
  const node=url.searchParams.get('node');
  // Old clients retain full-file CAS. New clients compare only their selected node.
  if(body.baseNodeHash!==undefined && !/^[0-9a-f]{64}$/.test(body.baseNodeHash))throw new HttpError(400,'invalid_playlist','순서 기준이 올바르지 않습니다.');
  for(let attempt=0;attempt<5;attempt++){
    const current=await row(db,id),parsed=await load(env,current),selected=parsed.playlists.find(p=>p.id===node);
    if(!selected)throw new HttpError(404,'not_found','순서를 찾지 못했습니다.');
    const hash=await sha256(new TextEncoder().encode(parsed.xml.slice(selected.node.start,selected.node.end)));
    if(body.baseNodeHash?hash!==body.baseNodeHash:Number(match.slice(1,-1))!==current.current_version)throw conflict();
    let xml;
    if(body.restoreVersion){
      const v=await db.prepare('SELECT xml FROM yebaeon_playlist_node_versions WHERE library_id=? AND node_id=? AND version=?').bind(id,node,body.restoreVersion).first();
      if(!v)throw new HttpError(404,'not_found','이전 순서가 없습니다.');
      xml=parsed.xml.slice(0,selected.node.start)+v.xml+parsed.xml.slice(selected.node.end);
    }else xml=editPlaylist(parsed,node,body.items,docs,current.source_root);
    const data=new TextEncoder().encode(xml);
    try{const result=await save(env,user,current,{xml,data,parsed:parsePlaylist(xml),hash:await sha256(data)});
      const saved=await row(db,id);return json({...result,library:await enriched(env,saved),playlist:{id:node,sha256:await sha256(new TextEncoder().encode(parsePlaylist(xml).xml.slice(parsePlaylist(xml).playlists.find(p=>p.id===node).node.start,parsePlaylist(xml).playlists.find(p=>p.id===node).node.end)))}});
    }catch(error){if(error.code!=='playlist_conflict'||!body.baseNodeHash)throw error;}
  }
  throw conflict();
}

