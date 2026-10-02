import {HttpError,json,method,sameOrigin,bytes,sha256} from './http.mjs';
import {referencePath,parsePlaylist} from './playlist-format.mjs';
export function observationState(observation,hash){
  if(!observation)return 'unknown';
  if(observation.status==='conflict')return 'conflict';
  if(hash!==observation.server_hash)return observation.status==='upload'?'conflict':'pending';
  return ({same:'synced',download:'pending',upload:'local',unknown:'unknown'})[observation.status]||'unknown';
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
  const hashes=new Map(),documentPaths=new Map(),links=new Map();
  for(const d of (await env.DB.prepare('SELECT id,path,sha256 FROM yebaeon_documents').all()).results){hashes.set('document/'+d.id+'/',d.sha256);documentPaths.set(d.path,'document/'+d.id+'/');}
  const libraries=(await env.DB.prepare('SELECT p.id,p.source_root,v.object_key FROM yebaeon_playlists p JOIN yebaeon_playlist_versions v ON v.library_id=p.id AND v.version=p.current_version').all()).results;
  for(const l of libraries){const object=await env.FILES.get(l.object_key);if(!object)continue;const parsed=parsePlaylist(await object.text());for(const n of parsed.playlists){const key='playlist/'+l.id+'/'+n.id;hashes.set(key,await sha256(new TextEncoder().encode(parsed.xml.slice(n.node.start,n.node.end))));links.set(key,n.items.filter(i=>i.kind==='document').map(i=>documentPaths.get(referencePath(i.sourcePath,l.source_root))||''));}}
  const observations=(await env.DB.prepare('SELECT * FROM yebaeon_sync_observations').all()).results,items={};
  const priority={unknown:0,synced:1,local:2,pending:3,conflict:4};
  for(const o of observations){const key=o.kind+'/'+o.resource_id+'/'+o.node_id;if(!hashes.has(key))continue;const state=observationState(o,hashes.get(key)),old=items[key];if(!old||priority[state]>priority[old.state]||(state===old.state&&o.observed_at>old.observedAt))items[key]={state,observedAt:o.observed_at,author:o.author};}
  for(const [key,docs] of links){const own=items[key];if(!own)continue;for(const doc of docs){const info=items[doc];if(!info){if(own.state==='synced')items[key]={...own,state:'unknown'};continue;}if(priority[info.state]>priority[items[key].state])items[key]={...info};}}
  return json({items});
}
