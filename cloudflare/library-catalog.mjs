import manifest from './library-manifest.json' with { type: 'json' };
import { HttpError,json } from './http.mjs';
import { normalizeSearch } from './document-search.mjs';
const jobs=new WeakMap();
export function ensureCatalog(db){
  const identity=db.rawDB||db;
  if(!jobs.has(identity))jobs.set(identity,(async()=>{
    if(await db.prepare('SELECT snapshot FROM yebaeon_catalog_imports WHERE snapshot=?').bind(manifest.snapshot).first())return;
    const statements=[];
    for(let offset=0;offset<manifest.documents.length;offset+=400){
      statements.push(db.prepare(`INSERT INTO yebaeon_library_catalog(id,path,original_path,size,slide_count,snapshot)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.path'),json_extract(value,'$.originalPath'),json_extract(value,'$.size'),json_extract(value,'$.slides'),? FROM json_each(?) WHERE true
        ON CONFLICT(path) DO UPDATE SET original_path=excluded.original_path,size=excluded.size,slide_count=excluded.slide_count,snapshot=excluded.snapshot`).bind(manifest.snapshot,JSON.stringify(manifest.documents.slice(offset,offset+400))));
    }
    statements.push(db.prepare('INSERT OR IGNORE INTO yebaeon_catalog_imports(snapshot,imported_at) VALUES (?,?)').bind(manifest.snapshot,new Date().toISOString()));
    await db.batch(statements);
  })().catch(error=>{jobs.delete(identity);throw error;}));
  return jobs.get(identity);
}
export function catalogDocument(row){return {id:row.id,path:row.path,originalPath:row.original_path,name:row.path.split('/').pop(),available:false,version:null,size:row.size,slideCount:row.slide_count,updatedAt:null,updatedBy:null};}
export async function catalogList(request,env){
  const url=new URL(request.url),q=(url.searchParams.get('q')||'').normalize('NFC'),after=url.searchParams.get('after')||'',sort=url.searchParams.get('sort')||'name';
  if(q.length>120||after.length>600)throw new HttpError(400,'invalid_query','검색어가 너무 깁니다.');
  if(!['name','name-desc','used','updated'].includes(sort))throw new HttpError(400,'invalid_sort','정렬 기준을 확인해 주세요.');
  let cursor=null;if(url.searchParams.has('cursor')){try{const raw=url.searchParams.get('cursor');if(raw.length>2000)throw Error();cursor=JSON.parse(raw);if(typeof cursor.path!=='string'||cursor.path.length>600||typeof cursor.value!=='string'||cursor.value.length>40)throw Error();}catch{throw new HttpError(400,'invalid_cursor','목록을 새로고침해 주세요.');}}
  if(!q.trim())return json({documents:[],next:null});
  await ensureCatalog(env.DB);
  const field=sort==='used'?"COALESCE(last_used,'')":"COALESCE(updated_at,'')";
  let clause='',args=[q,normalizeSearch(q)];
  if(sort==='name'||sort==='name-desc'){if(after){clause=` AND path ${sort==='name'?'>':'<'} ?`;args.push(after);}}
  else if(cursor){clause=` AND (${field} < ? OR (${field} = ? AND path > ?))`;args.push(cursor.value,cursor.value,cursor.path);}
  const order=sort==='name'?'path ASC':sort==='name-desc'?'path DESC':`${field} DESC,path ASC`;
  const rows=(await env.DB.prepare(`WITH library AS (
    SELECT d.id,d.path,d.current_version,d.updated_at,d.updated_by,d.sha256,d.size,1 AS available,c.original_path,c.slide_count,d.last_used,d.usage_error,d.usage_version AS usage_indexed,CASE WHEN d.search_enabled=1 THEN s.search_text ELSE NULL END AS search_text
    FROM yebaeon_documents d LEFT JOIN yebaeon_library_catalog c ON c.path=d.path LEFT JOIN yebaeon_document_search s ON s.document_id=d.id AND s.version=d.current_version AND d.search_enabled=1
    UNION ALL
    SELECT c.id,c.path,NULL,NULL,NULL,NULL,c.size,0,c.original_path,c.slide_count,NULL,NULL,NULL,'' FROM yebaeon_library_catalog c WHERE NOT EXISTS(SELECT 1 FROM yebaeon_documents d WHERE d.path=c.path)
    ) SELECT id,path,current_version,updated_at,updated_by,sha256,size,available,original_path,slide_count,last_used,usage_error,usage_indexed,CASE WHEN NOT EXISTS(SELECT 1 FROM yebaeon_inventory_devices) THEN NULL ELSE EXISTS(SELECT 1 FROM yebaeon_inventory_members m WHERE m.path=library.path) END AS local_present FROM library WHERE (instr(lower(path),lower(?))>0 OR instr(COALESCE(search_text,''),?)>0)${clause} ORDER BY ${order} LIMIT 101`).bind(...args).all()).results;
  const last=rows[99],next=rows.length>100?((sort==='name'||sort==='name-desc')?last.path:JSON.stringify({path:last.path,value:sort==='used'?last.last_used||'':last.updated_at||''})):null;
  const documents=rows.slice(0,100).map(r=>({...catalogDocument(r),available:!!r.available,localPresent:r.local_present===null?null:!!r.local_present,version:r.current_version,sha256:r.sha256,updatedAt:r.updated_at,updatedBy:r.updated_by,...(r.usage_indexed?{lastDateUsed:r.last_used,usageError:r.usage_error}:{}),matchedBy:q&&!r.path.toLowerCase().includes(q.toLowerCase())?'content':'name'}));
  return json({documents,next});
}

