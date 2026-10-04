import {HttpError,bodyJSON,headers,json,method,sameOrigin,sha256} from './http.mjs';
import {parsePlaylist,playlistName,newPlaylistNode,appendPlaylist,removePlaylist,referencePath} from './playlist-format.mjs';

const conflict=()=>new HttpError(409,'playlist_conflict','재생목록이 바뀌었습니다. 최신 목록을 확인해 주세요.');
const encoder=new TextEncoder();
export async function archiveList(request,env){
  const after=new URL(request.url).searchParams.get('after')||'';
  if(after.length>300)throw new HttpError(400,'invalid_cursor','보관 목록을 새로고침해 주세요.');
  const rows=(await env.DB.prepare(`SELECT c.library_id AS libraryId,c.node_id AS id,c.name,c.updated_at AS archivedAt,c.updated_by AS archivedBy,p.path AS libraryPath FROM yebaeon_playlist_controls c JOIN yebaeon_playlists p ON p.id=c.library_id WHERE c.state='archived' AND c.library_id||'/'||c.node_id>? ORDER BY c.library_id,c.node_id LIMIT 101`).bind(after).all()).results;
  return json({archives:rows.slice(0,100),next:rows.length>100?rows[99].libraryId+'/'+rows[99].id:null});
}
export async function protectManagedPlaylists(env,r,parsed){
  const incoming=new Set(parsed.playlists.map(p=>p.id));
  // Imported nodes predate controls. A full-file upload is not an explicit
  // deletion request, even when the client has the latest file CAS version.
  // Use the catalog already read with the file; no library-wide query/backfill.
  const current=JSON.parse(r.catalog);
  if(current.some(node=>!incoming.has(node.id)))throw new HttpError(409,'playlist_structure_changed','Mac에 없는 서버 재생목록이 있습니다. Sync를 업데이트하고 다시 비교해 주세요. 목록 보관·삭제는 해당 기능에서 따로 진행하세요.');
  const controls=(await env.DB.prepare('SELECT node_id,state FROM yebaeon_playlist_controls WHERE library_id=?').bind(r.id).all()).results;
  if(controls.some(c=>c.state==='active'?!incoming.has(c.node_id):incoming.has(c.node_id)))throw new HttpError(409,'playlist_structure_changed','웹에서 추가·보관·삭제한 재생목록과 Mac 목록이 다릅니다. 서버의 목록 구성을 먼저 받은 뒤 다시 비교해 주세요.');
}
function controlStatement(db,r,writeId,{id,name,state,snapshotKey=null},now,author){
  return db.prepare(`INSERT INTO yebaeon_playlist_controls(library_id,node_id,state,name,snapshot_key,updated_at,updated_by) SELECT id,?,?,?,?,?,? FROM yebaeon_playlists WHERE id=? AND write_id=? ON CONFLICT(library_id,node_id) DO UPDATE SET state=excluded.state,name=excluded.name,snapshot_key=excluded.snapshot_key,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(id,state,name,snapshotKey,now,author,r.id,writeId);
}
async function documentRows(env,paths){
  const found=[];
  for(let i=0;i<paths.length;i+=80){const batch=paths.slice(i,i+80);found.push(...(await env.DB.prepare(`SELECT d.id,d.path,d.current_version AS version,d.sha256,d.size,v.object_key AS objectKey FROM yebaeon_documents d JOIN yebaeon_versions v ON v.document_id=d.id AND v.version=d.current_version WHERE d.path IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all()).results);}
  return found;
}
async function snapshot(env,r,parsed,node,user){
  const paths=[...new Set(node.items.filter(i=>i.kind==='document').map(i=>referencePath(i.sourcePath,r.source_root)).filter(Boolean))];
  const documents=await documentRows(env,paths);
  // Originals are copied once into an archive-owned namespace. Subsequent song
  // history pruning can safely remove its disposable versions without losing this copy.
  if(documents.length>500||documents.reduce((n,d)=>n+d.size,0)>80*1024*1024)throw new HttpError(413,'archive_too_large','한 번에 보관할 문서의 크기가 큽니다. 목록을 나눠 주세요.');
  const prefix=`playlist-archives/${r.id}/${crypto.randomUUID()}`,files=[];
  for(let i=0;i<documents.length;i+=4)files.push(...await Promise.all(documents.slice(i,i+4).map(async d=>{
    const object=await env.FILES.get(d.objectKey);if(!object)throw new HttpError(409,'archive_file_missing','연결된 문서 원본이 없어 보관을 완료하지 못했습니다. 원본을 확인해 주세요.');
    const data=await object.arrayBuffer();if(await sha256(data)!==d.sha256)throw new HttpError(503,'archive_hash_mismatch','문서 원본 검증에 실패했습니다. 보관하지 않았습니다.');
    const key=prefix+'/'+d.id+'.pro6';await env.FILES.put(key,data,{sha256:d.sha256,httpMetadata:{contentType:'application/xml'}});
    return {...d,objectKey:key};
  })));
  const key=prefix+'/manifest.json',manifest={schema:1,libraryId:r.id,nodeId:node.id,name:node.name,sourceRoot:r.source_root,xml:parsed.xml.slice(node.node.start,node.node.end),createdAt:new Date().toISOString(),createdBy:user.author,documents:files,missing:paths.filter(p=>!documents.some(d=>d.path===p)),unmapped:node.items.filter(i=>i.kind==='document'&&!referencePath(i.sourcePath,r.source_root)).length,media:'references-only'};
  await env.FILES.put(key,JSON.stringify(manifest),{httpMetadata:{contentType:'application/json'}});
  return {key,manifest};
}
export async function managePlaylist(request,env,user,r,action,helpers){
  method(request,action==='nodes'?['POST','DELETE']:action==='archive'?['GET','POST']:['POST']);
  if(request.method!=='GET')sameOrigin(request);
  const url=new URL(request.url),nodeId=url.searchParams.get('node');
  if(request.method==='GET'){
    const control=await env.DB.prepare("SELECT * FROM yebaeon_playlist_controls WHERE library_id=? AND node_id=? AND state='archived'").bind(r.id,nodeId).first();
    const object=control?.snapshot_key&&await env.FILES.get(control.snapshot_key);if(!object)throw new HttpError(404,'not_found','보관 원본을 찾지 못했습니다.');
    const saved=await object.json(),documentId=url.searchParams.get('document');
    if(documentId){
      const doc=saved.documents.find(d=>d.id===documentId),file=doc&&await env.FILES.get(doc.objectKey);
      if(!file)throw new HttpError(404,'not_found','보관 문서를 찾지 못했습니다.');
      return new Response(file.body,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8','Cache-Control':'private, no-store','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.path.split('/').pop())}`,'X-Yebaeon-SHA256':doc.sha256}});
    }
    return json({name:saved.name,createdAt:saved.createdAt,documents:saved.documents.map(({objectKey,...doc})=>doc),missing:saved.missing,unmapped:saved.unmapped,media:saved.media});
  }
  const body=request.method==='POST'?await bodyJSON(request):{};
  if(!body||Array.isArray(body)||typeof body!=='object')throw new HttpError(400,'invalid_playlist','목록 정보를 확인해 주세요.');
  const parsed=await helpers.load(env,r),control=nodeId&&await env.DB.prepare('SELECT * FROM yebaeon_playlist_controls WHERE library_id=? AND node_id=?').bind(r.id,nodeId).first();
  const create=action==='nodes'&&request.method==='POST',restore=action==='restore',archive=action==='archive';
  if(create){
    if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id))throw new HttpError(400,'invalid_playlist','새 목록 번호가 필요합니다.');
    const previous=parsed.playlists.find(p=>p.id===body.id);
    if(previous&&previous.name===playlistName(body.name))return json({library:helpers.metadata(r),playlist:{id:previous.id},unchanged:true});
  }
  if(archive&&control?.state==='archived')return json({library:helpers.metadata(r),archived:true,unchanged:true});
  if(restore&&control?.state==='active'&&parsed.playlists.some(p=>p.id===nodeId))return json({library:helpers.metadata(r),playlist:{id:nodeId},unchanged:true});
  if(request.headers.get('If-Match')!==`"${r.current_version}"`)throw conflict();
  let xml,change,summary;
  if(create){
    const name=playlistName(body.name);
    if(parsed.playlists.some(p=>p.name.normalize('NFC')===name))throw new HttpError(409,'playlist_name_exists','같은 이름의 재생목록이 있습니다. 다른 이름을 입력해 주세요.');
    if(await env.DB.prepare('SELECT node_id FROM yebaeon_playlist_controls WHERE library_id=? AND node_id=?').bind(r.id,body.id).first())throw conflict();
    xml=appendPlaylist(parsed,newPlaylistNode(name,body.id));change={id:body.id,name,state:'active'};
  }else if(restore){
    if(control?.state!=='archived'||!control.snapshot_key)throw new HttpError(404,'not_found','보관된 목록이 없습니다.');
    const object=await env.FILES.get(control.snapshot_key);if(!object)throw new HttpError(503,'file_unavailable','보관 원본을 읽지 못했습니다.');
    const saved=await object.json(),name=control.name;
    if(parsed.playlists.some(p=>p.name===name||p.id===nodeId))throw new HttpError(409,'playlist_name_exists','같은 이름이나 번호의 목록이 이미 있습니다.');
    const wrapped=parsePlaylist(`<RVPlaylistDocument><RVPlaylistNode><array rvXMLIvarName="children">${saved.xml}</array></RVPlaylistNode></RVPlaylistDocument>`),selected=wrapped.playlists[0];
    const paths=[...new Set(selected.items.filter(i=>i.kind==='document').map(i=>referencePath(i.sourcePath,r.source_root)).filter(Boolean))],current=await documentRows(env,paths);
    if(current.length!==paths.length||saved.unmapped)throw new HttpError(409,'archive_documents_missing','연결된 문서가 없는 목록입니다. 누락 문서를 먼저 복구해 주세요. 보관본은 유지됩니다.');
    for(const d of current)if(!await env.FILES.head(d.objectKey))throw new HttpError(409,'archive_documents_missing','연결 문서 원본을 먼저 복구해 주세요.');
    xml=appendPlaylist(parsed,saved.xml);change={id:nodeId,name,state:'active',snapshotKey:control.snapshot_key};
    summary={restored:true,documentMode:'current',mediaVerified:false};
  }else{
    const selected=parsed.playlists.find(p=>p.id===nodeId);if(!selected)throw new HttpError(404,'not_found','재생목록을 찾지 못했습니다.');
    if(typeof body.baseNodeHash==='string'&&body.baseNodeHash!==await sha256(encoder.encode(parsed.xml.slice(selected.node.start,selected.node.end))))throw conflict();
    const copy=archive?await snapshot(env,r,parsed,selected,user):null;
    xml=removePlaylist(parsed,nodeId);change={id:nodeId,name:selected.name,state:archive?'archived':'removed',snapshotKey:copy?.key};
    summary={archived:archive,removed:!archive,missing:copy?.manifest.missing||[],mediaVerified:false};
  }
  const data=encoder.encode(xml),result=await helpers.save(env,user,r,{xml,data,parsed:parsePlaylist(xml),hash:await sha256(data)},(writeId,now)=>[controlStatement(env.DB,r,writeId,change,now,user.author)],{removedAction:change.state==='archived'?'archived':'removed'});
  return json({...result,playlist:{id:change.id},...summary},create?201:200);
}
