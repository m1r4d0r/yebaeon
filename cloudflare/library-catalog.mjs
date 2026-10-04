import { HttpError,json } from './http.mjs';
import { normalizeSearch } from './document-search.mjs';
import { categoryPolicy, oldMaterialCutoff, generalSearchVisibility } from './document-category.mjs';
export function catalogDocument(row){return {id:row.id,path:row.path,originalPath:row.original_path,name:row.path.split('/').pop(),available:false,version:null,size:row.size,slideCount:row.slide_count,updatedAt:null,updatedBy:null};}
export async function catalogList(request,env){
  const url=new URL(request.url),q=(url.searchParams.get('q')||'').normalize('NFC'),after=url.searchParams.get('after')||'',sort=url.searchParams.get('sort')||'name';
  if(q.length>120||after.length>600)throw new HttpError(400,'invalid_query','검색어가 너무 깁니다.');
  if(!['relevance','name','name-desc','used','updated'].includes(sort))throw new HttpError(400,'invalid_sort','정렬 기준을 확인해 주세요.');
  let cursor=null;if(url.searchParams.has('cursor')){try{const raw=url.searchParams.get('cursor');if(raw.length>2000)throw Error();cursor=JSON.parse(raw);if(typeof cursor.path!=='string'||cursor.path.length>600||typeof cursor.value!=='string'||cursor.value.length>40||cursor.rank!==undefined&&!(Number.isInteger(cursor.rank)&&cursor.rank>=1&&cursor.rank<=5))throw Error();}catch{throw new HttpError(400,'invalid_cursor','목록을 새로고침해 주세요.');}}
  if(!q.trim())return json({documents:[],next:null});
  const field=sort==='updated'?"COALESCE(updated_at,'')":"COALESCE(last_used,'')";
  const includeArchived=url.searchParams.get('includeArchived')==='1';
  // Relevance: 1 the name equals the query, 2 the name starts with it, 3 the name contains it, 4 the name has every word, 5 only the content matches.
  // Spaces are ignored in names; ties fall back to the latest use, then the name.
  const squeezed=normalizeSearch(q),words=[...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0,6);
  const name="replace(lower(path),' ','')",allWords=words.map(()=>`instr(${name},?)>0`).join(' AND ')||'0';
  const rank=`CASE WHEN ${name}=?||'.pro6' OR substr(${name},-(length(?)+6))='/'||?||'.pro6' THEN 1 WHEN substr(${name},1,length(?))=? OR instr(${name},'/'||?)>0 THEN 2 WHEN instr(${name},?)>0 THEN 3 WHEN ${allWords} THEN 4 ELSE 5 END`;
  const rankArgs=[squeezed,squeezed,squeezed,squeezed,squeezed,squeezed,squeezed,...words];
  let clause='',cursorArgs=[];
  if(sort==='name'||sort==='name-desc'){if(after){clause=` AND path ${sort==='name'?'>':'<'} ?`;cursorArgs.push(after);}}
  else if(sort==='relevance'&&cursor){clause=` AND (rank>? OR (rank=? AND (${field}<? OR (${field}=? AND path>?))))`;cursorArgs.push(cursor.rank||5,cursor.rank||5,cursor.value,cursor.value,cursor.path);}
  else if(cursor){clause=` AND (${field} < ? OR (${field} = ? AND path > ?))`;cursorArgs.push(cursor.value,cursor.value,cursor.path);}
  const order=sort==='name'?'path ASC':sort==='name-desc'?'path DESC':sort==='relevance'?`rank ASC,${field} DESC,path ASC`:`${field} DESC,path ASC`;
  const args=[...(includeArchived?[]:[oldMaterialCutoff()]),...rankArgs,q,squeezed,squeezed,...words,...cursorArgs];
  const rows=(await env.DB.prepare(`WITH library AS (
    SELECT d.id,d.path,d.current_version,d.updated_at,d.updated_by,d.sha256,d.size,1 AS available,c.original_path,c.slide_count,d.last_used,d.usage_error,d.usage_version AS usage_indexed,CASE WHEN d.search_enabled=1 THEN s.search_text ELSE NULL END AS search_text,d.category
    FROM yebaeon_documents d LEFT JOIN yebaeon_library_catalog c ON c.path=d.path LEFT JOIN yebaeon_document_search s ON s.document_id=d.id AND s.version=d.current_version AND d.search_enabled=1
    WHERE ${includeArchived?"d.state IN ('active','archived')":`d.state='active' AND ${generalSearchVisibility}`}
    UNION ALL
    SELECT c.id,c.path,NULL,NULL,NULL,NULL,c.size,0,c.original_path,c.slide_count,NULL,NULL,NULL,'',NULL FROM yebaeon_library_catalog c WHERE NOT EXISTS(SELECT 1 FROM yebaeon_documents d WHERE d.path=c.path)
    ), ranked AS (SELECT *,${rank} AS rank FROM library WHERE (instr(lower(path),lower(?))>0 OR instr(${name},?)>0 OR instr(COALESCE(search_text,''),?)>0 OR (${allWords})))
    SELECT id,path,current_version,updated_at,updated_by,sha256,size,available,original_path,slide_count,last_used,usage_error,usage_indexed,category,rank,CASE WHEN NOT EXISTS(SELECT 1 FROM yebaeon_inventory_devices) THEN NULL ELSE EXISTS(SELECT 1 FROM yebaeon_inventory_members m WHERE m.path=ranked.path) END AS local_present FROM ranked WHERE 1=1${clause} ORDER BY ${order} LIMIT 101`).bind(...args).all()).results;
  const last=rows[99],next=rows.length>100?((sort==='name'||sort==='name-desc')?last.path:JSON.stringify({path:last.path,value:sort==='updated'?last.updated_at||'':last.last_used||'',...sort==='relevance'?{rank:last.rank}:{}})):null;
  const documents=rows.slice(0,100).map(r=>({...catalogDocument(r),available:!!r.available,category:r.category,categoryManaged:!!categoryPolicy(r.category),localPresent:r.local_present===null?null:!!r.local_present,version:r.current_version,sha256:r.sha256,updatedAt:r.updated_at,updatedBy:r.updated_by,...(r.usage_indexed?{lastDateUsed:r.last_used,usageError:r.usage_error}:{}),matchedBy:q&&r.rank===5?'content':'name'}));
  return json({documents,next});
}

