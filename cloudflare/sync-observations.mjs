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
  const keys=[...documents.keys()].map(id=>({kind:'document',id,node:''})).concat(targets.filter(t=>t.kind==='playlist')),observations=[],items={};
  for(let offset=0;offset<keys.length;offset+=30){const part=keys.slice(offset,offset+30);observations.push(...(await env.DB.prepare('SELECT * FROM yebaeon_sync_observations WHERE '+part.map(()=>'(kind=? AND resource_id=? AND node_id=?)').join(' OR ')).bind(...part.flatMap(t=>[t.kind,t.id,t.node])).all()).results);}
  const priority={unknown:0,synced:1,local:2,pending:3,conflict:4};
  for(const o of observations){const key=o.kind+'/'+o.resource_id+'/'+o.node_id;if(!hashes.has(key))continue;const state=observationState(o,hashes.get(key)),old=items[key];if(!old||priority[state]>priority[old.state]||(state===old.state&&o.observed_at>old.observedAt))items[key]={state,observedAt:o.observed_at,author:o.author,deviceId:o.device_id};}
  for(const [key,docs] of links){if(items[key])items[key]=linkedObservation(items[key],docs,items);}
  return json({items});
}


