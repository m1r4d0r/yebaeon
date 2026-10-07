import { documentLog } from './sync2.mjs';
import { documentStateRoute } from './document-state.mjs';
import {importedMedia,importMediaStatements} from './import-media.mjs';
import {documentMediaPaths,documentMediaStatements} from './orphans.mjs';
import { referenceCounts } from './references.mjs';
import { catalogList } from './library-catalog.mjs';
import { searchData,searchStatement } from './document-search.mjs';
import { usageFromXML, readStoredUsage } from './document-usage.mjs';
import { categoryFromXML, categoryMetadata, categoryPolicy } from './document-category.mjs';
import { XMLValidator } from 'fast-xml-parser';
import { HttpError, bytes, headers, json, method, sameOrigin, sha256 } from './http.mjs';
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export function documentPath(value) {
  // The original Mac path is metadata. R2 object keys use document/version IDs,
  // so colons and other printable filename characters never become storage paths.
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_path', '문서 경로가 필요합니다.');
  const path = value.normalize('NFC'), parts = path.split('/');
  if (path.length > 600 || parts.length > 20 || !/\.pro6$/i.test(path) || parts.some(p => !p || p === '.' || p === '..' || p.length > 160 || /[\\\x00-\x1f\x7f]/.test(p) || /[. ]$/.test(p))) {
    throw new HttpError(400, 'invalid_path', '폴더와 .pro6 파일 이름을 확인해 주세요.');
  }
  return path;
}
export async function readDocument(request, previous=null) {
  const data = await bytes(request, MAX_DOCUMENT_BYTES); let xml;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new HttpError(400, 'invalid_encoding', 'UTF-8 .pro6 문서를 선택해 주세요.'); }
  const leading = xml.replace(/^\s*(?:<\?xml[^?]*\?>)?\s*/, '').replace(/^(?:<!--[\s\S]*?-->\s*)*/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/^<RVPresentationDocument(?:\s|>)/.test(leading) || XMLValidator.validate(xml) !== true) {
    throw new HttpError(400, 'invalid_document', '올바른 PP6 .pro6 문서가 아닙니다.');
  }
  if (/file:\/\/\/PP6-Package\//i.test(xml)) throw new HttpError(422, 'package_media', '새로 교체한 미디어가 포함된 문서는 아직 서버에 저장할 수 없습니다. ZIP으로 보관해 주세요.');
  const policy = categoryMetadata(categoryFromXML(xml), previous, (previous?.current_version || 0) + 1);
  return { data, hash: await sha256(data), size: data.length, lastDateUsed: usageFromXML(xml), policy, search:policy.search_enabled?searchData(xml):{text:'',error:null} };
}
function document(row) {
  return { id: row.id, path: row.path, name: row.path.split('/').pop(), version: row.current_version, updatedAt: row.updated_at, updatedBy: row.updated_by, sha256: row.sha256, size: row.size, category:row.category??null,categoryManaged:!!categoryPolicy(row.category),state:row.state||'active',...(row.state&&row.state!=='active'?{stateAt:row.state_at,stateBy:row.state_by}:{}),searchEnabled:row.search_enabled!==0,historyEnabled:row.history_enabled!==0,policyRevision:row.policy_revision||0,...(row.usage_version===row.current_version ? {lastDateUsed: row.last_used, usageError: row.usage_error} : {}) };
}
async function find(db, id) {
  const row = await db.prepare('SELECT * FROM yebaeon_documents WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'not_found', '문서를 찾지 못했습니다.');
  return row;
}
function conflict() { return new HttpError(409, 'version_conflict', '다른 작업자가 먼저 저장했습니다. 내 변경은 브라우저 초안에서 확인할 수 있습니다. 서버 최신 내용과 비교한 뒤 다시 저장해 주세요.'); }
async function unchangedDocument(db, row, content) {
  const p=content.policy;
  if(p.policy_revision===row.policy_revision)return json({document:document(row),unchanged:true});
  const writeId=crypto.randomUUID();
  const statements=[db.prepare('UPDATE yebaeon_documents SET category=?,search_enabled=?,history_enabled=?,history_start=?,policy_revision=?,write_id=? WHERE id=? AND current_version=? AND policy_revision=?').bind(p.category,p.search_enabled,p.history_enabled,p.history_start,p.policy_revision,writeId,row.id,row.current_version,row.policy_revision),
    db.prepare('DELETE FROM yebaeon_document_search WHERE document_id=? AND EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=?)').bind(row.id,row.id,writeId)];
  if(p.search_enabled)statements.push(db.prepare('INSERT INTO yebaeon_document_search(document_id,version,search_text,error) SELECT id,current_version,?,? FROM yebaeon_documents WHERE id=? AND write_id=? AND search_enabled=1').bind(content.search.text,content.search.error,row.id,writeId));
  const results=await db.batch(statements);if(results[0].meta.changes!==1)throw conflict();
  return json({document:document({...row,...p}),unchanged:true});
}
export async function documentsRoute(request, env, user, id, action) {
  const url = new URL(request.url), db = env.DB;
  if (!id) {
    method(request, ['GET', 'POST']);
    if (request.method === 'GET') {
      if(url.searchParams.get('includeIndexed')==='1')return catalogList(request,env);
      if(url.searchParams.has('checkPath'))return checkPath(db,url.searchParams.get('checkPath'));
      const query = url.searchParams.get('q') || '', after = url.searchParams.get('after') || '';
      if (query.length > 120 || after.length > 600) throw new HttpError(400, 'invalid_query', '검색어가 너무 깁니다.');
      const sort = url.searchParams.get('sort') || 'name';
      if (!['name','name-desc','updated','used'].includes(sort)) throw new HttpError(400,'invalid_sort','정렬 기준을 확인해 주세요.');
      const indexing = null;
      let cursor = null;
      if (url.searchParams.has('cursor')) {
        try { const raw=url.searchParams.get('cursor'); if(raw.length>2000)throw Error(); cursor=JSON.parse(raw); if(typeof cursor.path!=='string'||cursor.path.length>600||typeof cursor.value!=='string'||cursor.value.length>40)throw Error(); }
        catch (_) { throw new HttpError(400,'invalid_cursor','목록을 새로고침해 주세요.'); }
      }
      const field = sort==='used' ? "COALESCE(d.last_used,'')" : 'd.updated_at';
      // 기본 목록은 사용 중 문서만. 보관함·휴지통은 state로 따로 본다.
      const state = url.searchParams.get('state') || 'active';
      if (!['active','archived','trashed'].includes(state)) throw new HttpError(400,'invalid_state','목록 종류를 확인해 주세요.');
      let clause='', args=[query, state];
      if(sort==='name'||sort==='name-desc') { clause=after ? ` AND d.path ${sort==='name' ? '>' : '<'} ?` : ''; if(after)args.push(after); }
      else if(cursor) { clause=` AND (${field} < ? OR (${field} = ? AND d.path > ?))`; args.push(cursor.value,cursor.value,cursor.path); }
      const order = sort==='name' ? 'd.path ASC' : sort==='name-desc' ? 'd.path DESC' : `${field} DESC, d.path ASC`;
      const rows = (await db.prepare(`SELECT d.* FROM yebaeon_documents d WHERE instr(lower(d.path),lower(?))>0 AND d.state=?${clause} ORDER BY ${order} LIMIT 101`).bind(...args).all()).results;
      const last=rows[99], next=rows.length>100 ? ((sort==='name'||sort==='name-desc') ? last.path : JSON.stringify({path:last.path,value:sort==='used' ? last.last_used||'' : last.updated_at})) : null;
      const refs=url.searchParams.get('includeUses')==='1'?await referenceCounts(env):null;
      return json({ documents: rows.slice(0,100).map(row=>({...document(row),...(refs?{useCount:refs.pending?null:(refs.uses.get(row.path)||0)}:{})})), next, indexing, referencesPending:refs?.pending||false });
    }
    sameOrigin(request);
    const path = documentPath(url.searchParams.get('path'));
    const existing = await db.prepare('SELECT * FROM yebaeon_documents WHERE path = ?').bind(path).first();
    const content = await readDocument(request,existing);
    // Studio에서 만드는 새 문서는 카테고리를 꼭 고른다(PP6 문서는 PP6가 이미 요구한다).
    if (!existing && request.headers.get('X-YebaeOn-Client') === 'studio' && !content.policy.category) throw new HttpError(400, 'category_required', '카테고리를 골라 주세요.');
    if (existing) {
      if (existing.sha256 === content.hash) return unchangedDocument(db,existing,content);
      throw new HttpError(409, 'path_exists', '같은 경로의 문서가 이미 있습니다. 목록에서 열어 수정하거나 다른 경로로 저장해 주세요.');
    }
    const importRefs=await importedMedia(db,content.data);
    const newId = crypto.randomUUID(), writeId = crypto.randomUUID(), key = `documents/${newId}/${writeId}.pro6`, now = new Date().toISOString();
    const p=content.policy;
    const created = document({id:newId,path,current_version:1,updated_at:now,updated_by:user.author,sha256:content.hash,size:content.size,last_used:content.lastDateUsed?new Date(content.lastDateUsed).toISOString():null,usage_version:1,usage_error:null,...p});
    await env.FILES.put(key, content.data, { httpMetadata: { contentType: 'application/xml' }, sha256: content.hash });
    try {
      await db.batch([
        db.prepare('INSERT INTO yebaeon_documents(id, path, created_at, current_version, updated_at, updated_by, sha256, size, write_id,last_used,usage_version,category,search_enabled,history_enabled,history_start,policy_revision) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?,?,1,?,?,?,?,?)').bind(newId, path, now, now, user.author, content.hash, content.size, writeId,created.lastDateUsed,p.category,p.search_enabled,p.history_enabled,p.history_start,p.policy_revision),
        db.prepare('INSERT INTO yebaeon_versions(document_id, version, object_key, sha256, size, author, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)').bind(newId, key, content.hash, content.size, user.author, now),
        ...(p.search_enabled?[searchStatement(db,newId,1,content.search)]:[]),
        ...importMediaStatements(db,importRefs,newId,1,writeId,now),
        ...documentMediaStatements(db,newId,1,documentMediaPaths(content.data),writeId),
        documentLog(db,{id:newId,writeId,action:'created',author:user.author,now})
      ]);
    } catch (error) {
      const winner = await db.prepare('SELECT * FROM yebaeon_documents WHERE path = ?').bind(path).first();
      if (winner?.id === newId) return json({ document: created }, 201);
      // Do not delete objects after ambiguous commits; a maintenance pass can inspect unreferenced keys.
      if (winner) throw new HttpError(409, 'path_exists', '다른 작업자가 같은 경로로 문서를 올렸습니다. 목록을 새로고침해 주세요.');
      throw error;
    }
    return json({ document: created }, 201);
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'not_found', '문서를 찾지 못했습니다.');
  if(action==='policy')return documentPolicy(request,env,id);
  if(action==='state'||action==='rename')return documentStateRoute(request,env,user,id,action,{find,document,documentPath});
  if (action === 'usage') {
    method(request, ['GET']);
    const row = await find(db, id);
    const number = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : row.current_version;
    if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, 'invalid_version', '버전 번호를 확인해 주세요.');
    if(number===row.current_version&&row.usage_version===number){if(row.usage_error)throw new HttpError(422,'usage_unavailable','최근 사용일을 읽지 못했습니다.');return json({id,version:number,lastDateUsed:row.last_used});}
    const version = await db.prepare('SELECT object_key FROM yebaeon_versions WHERE document_id = ? AND version = ?').bind(id, number).first();
    if (!version) throw new HttpError(404, 'not_found', '저장 버전을 찾지 못했습니다.');
    const usage = await readStoredUsage(env,id,number,version.object_key);
    if (usage.error) throw new HttpError(422,'usage_unavailable','최근 사용일을 읽지 못했습니다.');
    return json({ id, version: number, lastDateUsed: usage.last_used });
  }
  if (action === 'versions') {
    method(request, ['GET']); await find(db, id);
    const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1) throw new HttpError(400, 'invalid_version', '버전 번호를 확인해 주세요.');
    const rows = (await db.prepare('SELECT version, sha256, size, author, created_at AS createdAt FROM yebaeon_versions WHERE document_id = ? AND version < ? ORDER BY version DESC LIMIT 51').bind(id, before).all()).results;
    return json({ versions: rows.slice(0, 50), next: rows.length > 50 ? rows[49].version : null });
  }
  if (action === 'content') {
    method(request, ['GET', 'HEAD']);
    const row = await find(db, id), number = url.searchParams.has('version') ? Number(url.searchParams.get('version')) : row.current_version;
    if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, 'invalid_version', '버전 번호를 확인해 주세요.');
    const version = await db.prepare('SELECT * FROM yebaeon_versions WHERE document_id = ? AND version = ?').bind(id, number).first();
    if (!version) throw new HttpError(404, 'not_found', '저장 버전을 찾지 못했습니다.');
    const object = await env.FILES.get(version.object_key);
    if (!object) throw new HttpError(503, 'file_unavailable', '문서 파일을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');
    const filename = row.path.split('/').pop().replace(/\.pro6$/i, '') + (url.searchParams.has('version') ? `-v${number}` : '') + '.pro6';
    return new Response(request.method === 'HEAD' ? null : object.body, { headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'ETag': `"${number}-${version.sha256}"`, 'X-Yebaeon-Version': String(number), 'X-Yebaeon-SHA256': version.sha256 } });
  }
  if (action) throw new HttpError(404, 'not_found', '없는 요청입니다.');
  method(request, ['GET', 'PUT']);
  const row = await find(db, id);
  if (request.method === 'GET') return json({ document: document(row) });
  sameOrigin(request);
  const match = request.headers.get('If-Match');
  if (!match || !/^"[1-9][0-9]*"$/.test(match)) throw new HttpError(428, 'version_required', '문서의 기준 버전이 필요합니다.');
  const base = Number(match.slice(1, -1));
  if (base !== row.current_version) throw conflict();
  if ((row.state||'active') === 'trashed') throw new HttpError(409, 'document_trashed', '휴지통에 있는 문서입니다. 휴지통에서 꺼낸 뒤 저장해 주세요.');
  const content = await readDocument(request,row),p=content.policy;
  if (content.hash === row.sha256) return unchangedDocument(db,row,content);
  const importRefs=await importedMedia(db,content.data);
  const previousDisposableKey=!p.history_enabled&&p.history_start&&base>=p.history_start ? (await db.prepare('SELECT object_key FROM yebaeon_versions WHERE document_id=? AND version=?').bind(id,base).first())?.object_key : null;
  const next = base + 1, writeId = crypto.randomUUID(), key = `documents/${id}/${writeId}.pro6`, now = new Date().toISOString();
  // Mac이 usage로 보고한 사용일(reported_used)보다 옛 XML 사용일로 되돌리지 않는다. 보고가 없으면 지금처럼 XML 값이다.
  const incomingUsed=content.lastDateUsed?new Date(content.lastDateUsed).toISOString():null,lastUsed=[incomingUsed,row.reported_used].filter(Boolean).sort().at(-1)||null;
  await env.FILES.put(key, content.data, { httpMetadata: { contentType: 'application/xml' }, sha256: content.hash });
  const results = await db.batch([
    db.prepare('UPDATE yebaeon_documents SET current_version = ?, updated_at = ?, updated_by = ?, sha256 = ?, size = ?, write_id = ?, last_used=?,usage_error=NULL,usage_version=?,category=?,search_enabled=?,history_enabled=?,history_start=?,policy_revision=? WHERE id = ? AND current_version = ? AND policy_revision=?').bind(next, now, user.author, content.hash, content.size, writeId,lastUsed,next,p.category,p.search_enabled,p.history_enabled,p.history_start,p.policy_revision,id,base,row.policy_revision),
    db.prepare(`INSERT INTO yebaeon_versions(document_id, version, object_key, sha256, size, author, created_at)
      SELECT id, ?, ?, ?, ?, ?, ? FROM yebaeon_documents WHERE id = ? AND write_id = ?`).bind(next, key, content.hash, content.size, user.author, now, id, writeId),
    db.prepare('DELETE FROM yebaeon_document_search WHERE document_id=? AND EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=?)').bind(id,id,writeId),
    db.prepare(`INSERT INTO yebaeon_document_search(document_id,version,search_text,error) SELECT id,current_version,?,? FROM yebaeon_documents WHERE id=? AND write_id=? AND search_enabled=1`).bind(content.search.text,content.search.error,id,writeId),
    db.prepare('DELETE FROM yebaeon_document_usage WHERE document_id=? AND EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=?)').bind(id,id,writeId),
    // Keep all historical backups from before the policy was changed.
    db.prepare(`DELETE FROM yebaeon_versions WHERE document_id=? AND version>=? AND version<? AND EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=? AND history_enabled=0)`).bind(id,p.history_start||next,next,id,writeId),
    ...importMediaStatements(db,importRefs,id,next,writeId,now),
    ...documentMediaStatements(db,id,next,documentMediaPaths(content.data),writeId),
    documentLog(db,{id,writeId,action:'updated',author:user.author,now})
  ]);
  if (results[0].meta.changes !== 1) { await env.FILES.delete(key); throw conflict(); }
  // Superseded originals created while history was disabled are no longer backups.
  if(previousDisposableKey)await env.FILES.delete(previousDisposableKey).catch(()=>console.warn('Deferred unretained document cleanup'));
  // Return this exact commit, even if another writer saved a later version immediately after it.
  return json({ document: { ...document({...row,...p,last_used:lastUsed,usage_error:null,usage_version:next,current_version:next}), version: next, updatedAt: now, updatedBy: user.author, sha256: content.hash, size: content.size } });
}


async function documentPolicy(request,env,id){
  method(request,['PUT']);sameOrigin(request);
  let body;try{body=JSON.parse(new TextDecoder().decode(await bytes(request,1024)));}catch{throw new HttpError(400,'invalid_policy','문서 설정을 확인해 주세요.');}
  if(typeof body?.searchEnabled!=='boolean'||typeof body?.historyEnabled!=='boolean'||!Number.isSafeInteger(body?.policyRevision))throw new HttpError(400,'invalid_policy','문서 설정을 확인해 주세요.');
  const db=env.DB,row=await find(db,id);
  if(request.headers.get('If-Match')!==`"${row.current_version}"`||body.policyRevision!==row.policy_revision)throw conflict();
  const managed=categoryPolicy(row.category);
  if(managed){
    if(body.searchEnabled!==managed.searchEnabled||body.historyEnabled!==managed.historyEnabled)throw new HttpError(409,'category_policy','이 문서는 '+row.category+' 카테고리의 검색·이력 설정을 따릅니다. 분류를 바꾸려면 원본 문서의 카테고리를 변경해 주세요.');
    return json({document:document(row)});
  }
  let data=null;
  if(body.searchEnabled&&!row.search_enabled){const v=await db.prepare('SELECT object_key FROM yebaeon_versions WHERE document_id=? AND version=?').bind(id,row.current_version).first();const object=v&&await env.FILES.get(v.object_key);if(!object)throw new HttpError(503,'file_unavailable','원본을 읽지 못해 설정을 바꾸지 않았습니다.');data=searchData(await object.text());}
  const revision=row.policy_revision+1,writeId=crypto.randomUUID();
  const statements=[db.prepare('UPDATE yebaeon_documents SET search_enabled=?,history_enabled=?,history_start=?,policy_revision=?,write_id=? WHERE id=? AND current_version=? AND policy_revision=?').bind(+body.searchEnabled,+body.historyEnabled,body.historyEnabled?null:row.history_enabled?row.current_version+1:row.history_start,revision,writeId,id,row.current_version,row.policy_revision)];
  if(!body.searchEnabled)statements.push(db.prepare('DELETE FROM yebaeon_document_search WHERE document_id=? AND EXISTS(SELECT 1 FROM yebaeon_documents WHERE id=? AND write_id=? AND search_enabled=0)').bind(id,id,writeId));
  if(data)statements.push(db.prepare('INSERT OR REPLACE INTO yebaeon_document_search(document_id,version,search_text,error) SELECT id,current_version,?,? FROM yebaeon_documents WHERE id=? AND write_id=? AND search_enabled=1').bind(data.text,data.error,id,writeId));
  const result=await db.batch(statements);if(result[0].meta.changes!==1)throw conflict();
  return json({document:document(await find(db,id))});
}

// 새 문서 이름이 서버(문서·장부, 휴지통 포함)에 있으면 `이름 2`, `이름 3`… 중 빈 이름을 제안한다. 한 번에 한 문장.
async function checkPath(db,value){
  const path=documentPath(/\.pro6$/i.test(value||'')?value:(value||'').trim()+'.pro6'),stem=path.replace(/\.pro6$/i,''),candidates=[path,...Array.from({length:30},(_,i)=>`${stem} ${i+2}.pro6`)];
  const marks=candidates.map(()=>'?').join(',');
  const taken=new Set((await db.prepare(`SELECT path FROM yebaeon_documents WHERE path IN (${marks}) UNION SELECT path FROM yebaeon_library_catalog WHERE path IN (${marks})`).bind(...candidates,...candidates).all()).results.map(r=>r.path));
  return json({path,available:!taken.has(path),suggestion:taken.has(path)?candidates.find(c=>!taken.has(c))||null:null});
}
