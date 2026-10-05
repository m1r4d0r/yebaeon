import {HttpError,json,method,sameOrigin,bytes,sha256} from './http.mjs';
import {referencePath,parsePlaylist} from './playlist-format.mjs';
export function observationState(observation,hash){
  if(!observation||observation.status==='unknown')return 'unknown';
  if(observation.status==='conflict')return 'conflict';
  if(hash!==observation.server_hash)return observation.status==='upload'?'conflict':'pending';
  return ({same:'synced',download:'pending',upload:'local',unknown:'unknown'})[observation.status]||'unknown';
}
// A playlist cannot be green when a linked document has not been checked.
export function linkedObservation(own,docs,items){
  const priority={synced:0,unknown:1,local:2,pending:3,conflict:4};let result=own;
  for(const key of docs){const info=items[key]||{...own,state:'unknown'};if(priority[info.state]>priority[result.state])result={...info,reason:info.state==='unknown'?'연결 문서의 원본 또는 Mac 확인 기록 없음':'연결 문서 상태 반영'};}
  return result;
}
export async function syncObservationsRoute(request,env,user){
  method(request,['GET','POST']);
  if(request.method==='POST'){
    sameOrigin(request);let body;try{body=JSON.parse(new TextDecoder().decode(await bytes(request,512*1024)));}catch{throw new HttpError(400,'invalid_report','Sync 상태를 확인해 주세요.');}
    if(!body||typeof body.deviceId!=='string'||!/^[0-9a-f]{64}$/.test(body.deviceId)||!Array.isArray(body.items)||body.items.length>400)throw new HttpError(400,'invalid_report','Sync 상태를 확인해 주세요.');
    const statements=[],now=new Date().toISOString();
    for(const item of body.items){
      if(!item||!['document','playlist'].includes(item.kind)||typeof item.id!=='string'||!/^[0-9a-f-]{36}$/i.test(item.id)||typeof item.node!=='string'||item.node.length>240||(item.kind==='document'&&item.node)||!/^[0-9a-f]{64}$/.test(item.serverHash)||!['same','download','upload','conflict','unknown'].includes(item.status))throw new HttpError(400,'invalid_report','Sync 상태를 확인해 주세요.');
      statements.push(env.DB.prepare('INSERT INTO yebaeon_sync_observations(device_id,kind,resource_id,node_id,server_hash,status,observed_at,author) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(device_id,kind,resource_id,node_id) DO UPDATE SET server_hash=excluded.server_hash,status=excluded.status,observed_at=excluded.observed_at,author=excluded.author').bind(body.deviceId,item.kind,item.id,item.node,item.serverHash,item.status,now,user.author));
    }
    if(statements.length)await env.DB.batch(statements);return json({ok:true,observedAt:now});
  }
  const raw=new URL(request.url).searchParams.get('targets');
  // Old open tabs must not trigger the previous unbounded full-library query.
  if(!raw)return json({items:{},requiresTargets:true});
  let targets;try{targets=JSON.parse(raw);}catch{throw new HttpError(400,'invalid_targets','상태 확인 대상을 확인해 주세요.');}
  if(raw.length>14000||!Array.isArray(targets)||targets.length>80||targets.some(t=>!t||!['document','playlist'].includes(t.kind)||typeof t.id!=='string'||!/^[0-9a-f-]{36}$/i.test(t.id)||typeof t.node!=='string'||t.node.length>240||(t.kind==='document'&&t.node)))throw new HttpError(400,'invalid_targets','상태 확인 대상을 확인해 주세요.');
  const hashes=new Map(),documentPaths=new Map(),links=new Map(),documents=new Map();
  async function selectIn(sql,values,size=80){const rows=[];for(let offset=0;offset<values.length;offset+=size){const part=values.slice(offset,offset+size);rows.push(...(await env.DB.prepare(sql.replace('$IN',part.map(()=>'?').join(','))).bind(...part).all()).results);}return rows;}
  const ids=[...new Set(targets.filter(t=>t.kind==='document').map(t=>t.id))];
  for(const d of await selectIn('SELECT id,path,sha256 FROM yebaeon_documents WHERE id IN ($IN)',ids))documents.set(d.id,d);
  const playlistIDs=[...new Set(targets.filter(t=>t.kind==='playlist').map(t=>t.id))];
  const libraries=await selectIn('SELECT p.id,p.source_root,v.object_key FROM yebaeon_playlists p JOIN yebaeon_playlist_versions v ON v.library_id=p.id AND v.version=p.current_version WHERE p.id IN ($IN)',playlistIDs);
  const paths=new Set();
  for(const l of libraries){const object=await env.FILES.get(l.object_key);if(!object)continue;const parsed=parsePlaylist(await object.text());for(const n of parsed.playlists){if(!targets.some(t=>t.kind==='playlist'&&t.id===l.id&&t.node===n.id))continue;const key='playlist/'+l.id+'/'+n.id;hashes.set(key,await sha256(new TextEncoder().encode(parsed.xml.slice(n.node.start,n.node.end))));const refs=n.items.filter(i=>i.kind==='document').map(i=>referencePath(i.sourcePath,l.source_root)||'');links.set(key,refs);refs.forEach(p=>{if(p)paths.add(p);});}}
  for(const d of await selectIn('SELECT id,path,sha256 FROM yebaeon_documents WHERE path IN ($IN)',[...paths]))documents.set(d.id,d);
  for(const d of documents.values()){const key='document/'+d.id+'/';hashes.set(key,d.sha256);documentPaths.set(d.path,key);}
  for(const [key,refs] of links)links.set(key,refs.map(p=>documentPaths.get(p)||''));
  // Sync 2 기준(10-05): 교회 Mac(가장 최근에 적용을 보고한 장치)의 적용 번호(applied_seq)와 보류 예배 목록을
  // 서버 변경 일지(yebaeon_sync_log)의 마지막 번호와 비교한다. 장치 자신이 올린 변경은 Mac에 이미 있으므로 세지 않는다.
  // 0.6.6의 yebaeon_sync_observations는 더 읽지 않는다(Sync 2는 그 표에 쓰지 않는다).
  const device=await env.DB.prepare("SELECT id,name,applied_seq AS appliedSeq,applied_at AS appliedAt,pending FROM yebaeon_sync_devices WHERE revoked_at IS NULL AND applied_at IS NOT NULL ORDER BY applied_at DESC LIMIT 1").first();
  const items={};
  if(!device)return json({items,source:'sync2'});
  let held=[];try{held=JSON.parse(device.pending||'[]');}catch{}
  const waiting=new Map(held.filter(p=>p.kind==='node').map(p=>[p.entity,p.reason||'적용 대기']));
  async function latest(kinds,entities){const found=new Map();for(let offset=0;offset<entities.length;offset+=80){const part=entities.slice(offset,offset+80);for(const r of (await env.DB.prepare(`SELECT entity,MAX(seq) AS seq,MAX(at) AS at FROM yebaeon_sync_log WHERE kind IN (${kinds.map(()=>'?').join(',')}) AND entity IN (${part.map(()=>'?').join(',')}) AND author<>? GROUP BY entity`).bind(...kinds,...part,device.name).all()).results){const old=found.get(r.entity);if(!old||r.seq>old.seq)found.set(r.entity,r);}}return found;}
  const docs=await latest(['doc'],[...documents.keys()]),nodes=await latest(['node','node-state'],targets.filter(t=>t.kind==='playlist').map(t=>t.id+':'+t.node));
  const base={observedAt:device.appliedAt,author:device.name,deviceId:device.id};
  const docState=id=>{const change=docs.get(id);return change&&change.seq>device.appliedSeq?{...base,state:'pending',reason:'서버 '+new Date(change.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' 저장분을 Mac이 아직 받지 않음'}:{...base,state:'synced'};};
  for(const id of documents.keys())items['document/'+id+'/']=docState(id);
  for(const t of targets.filter(t=>t.kind==='playlist')){const key='playlist/'+t.id+'/'+t.node,entity=t.id+':'+t.node,change=nodes.get(entity);
   let item=waiting.has(entity)?{...base,state:'pending',reason:'Mac Sync에서 '+waiting.get(entity)}:change&&change.seq>device.appliedSeq?{...base,state:'pending',reason:'순서 변경을 Mac이 아직 받지 않음'}:{...base,state:'synced'};
   const members=(links.get(key)||[]).filter(k=>items[k]?.state==='pending');if(item.state==='synced'&&members.length)item={...base,state:'pending',reason:`문서 ${members.length}개를 Mac이 아직 받지 않음`};
   items[key]=item;}
  return json({items});
}


