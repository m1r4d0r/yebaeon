import {parsePlaylist,referencePath} from './playlist-format.mjs';
export async function referenceCounts(env){
 const rows=(await env.DB.prepare('SELECT p.id,p.current_version,p.source_root,c.version AS cached_version,c.refs FROM yebaeon_playlists p LEFT JOIN yebaeon_reference_cache c ON c.library_id=p.id').all()).results;
 let budget=3,pending=false;const uses=new Map();
 for(const row of rows){let refs;
  if(row.cached_version===row.current_version)refs=JSON.parse(row.refs);
  else if(budget-->0){try{const version=await env.DB.prepare('SELECT object_key FROM yebaeon_playlist_versions WHERE library_id=? AND version=?').bind(row.id,row.current_version).first();const object=version&&await env.FILES.get(version.object_key);if(!object)throw Error();const parsed=parsePlaylist(await object.text());refs={};for(const node of parsed.playlists){const paths=new Set(node.items.filter(x=>x.kind==='document').map(x=>referencePath(x.sourcePath,row.source_root)).filter(Boolean));for(const path of paths){refs[path]??=[];refs[path].push(node.id);}}const encoded=JSON.stringify(refs);if(new TextEncoder().encode(encoded).length>1000000)throw Error();await env.DB.prepare('INSERT INTO yebaeon_reference_cache(library_id,version,refs) VALUES (?,?,?) ON CONFLICT(library_id) DO UPDATE SET version=excluded.version,refs=excluded.refs WHERE excluded.version>=yebaeon_reference_cache.version').bind(row.id,row.current_version,encoded).run();}catch{pending=true;continue;}}
  else{pending=true;continue;}
  for(const [path,nodes] of Object.entries(refs))uses.set(path,(uses.get(path)||0)+nodes.length);
 }
 return {uses,pending};
}
