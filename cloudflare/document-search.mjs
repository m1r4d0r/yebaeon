import { usageFromXML } from './document-usage.mjs';
// Search-only RTF decoding. Keep encoding/group/fallback behavior aligned with PP6.parseRTF.
export const normalizeSearch=value=>String(value).normalize('NFC').toLowerCase().replace(/\s+/g,'');
export function rtfText(base64){
  const raw=atob(base64.trim()),stack=[],out=[];let state={skip:false,cp:1252,uc:1},pending=[],fallback=0;
  const emit=s=>{if(!state.skip)out.push(s);};
  function flush(){if(pending.length){emit(new TextDecoder(({949:'euc-kr',1252:'windows-1252',65001:'utf-8',932:'shift_jis',936:'gbk',950:'big5'})[state.cp]||'windows-1252').decode(Uint8Array.from(pending)));pending=[];}}
  const byte=n=>{if(fallback)fallback--;else if(!state.skip)pending.push(n);};
  const destinations=new Set(['fonttbl','colortbl','expandedcolortbl','stylesheet','info','pict','object','header','footer','fldinst','listtable','listoverridetable']);
  for(let i=0;i<raw.length;){const c=raw[i++];if(c==='{'||c==='}'){flush();if(c==='{')stack.push({...state});else state=stack.pop()||state;continue;}if(c==='\r'||c==='\n')continue;if(c!=='\\'){byte(c.charCodeAt(0));continue;}const n=raw[i];if(n==="'"){byte(parseInt(raw.slice(i+1,i+3),16));i+=3;continue;}if('\\{}'.includes(n)){byte(n.charCodeAt(0));i++;continue;}flush();if(n==='*'){state.skip=true;i++;continue;}if(n==='\n'||n==='\r'){emit('\n');i++;if(n==='\r'&&raw[i]==='\n')i++;continue;}if(n==='~'||n==='_'){if(fallback)fallback--;else emit(n==='~'?'\u00a0':'\u2011');i++;continue;}
    const m=/^([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i));if(!m){i++;continue;}i+=m[0].length;const word=m[1],value=m[2]===undefined?1:Number(m[2]);if(word==='bin'){i+=Math.max(0,value);continue;}if(destinations.has(word))state.skip=true;if(state.skip)continue;if(word==='ansicpg')state.cp=value;else if(word==='uc')state.uc=Math.max(0,Math.min(16,value));else if(word==='u'){emit(String.fromCharCode((value+65536)%65536));fallback=state.uc;}else if(word==='par'||word==='line')emit('\n');else if(word==='tab')emit('\t');else if(['emdash','endash','bullet','lquote','rquote','ldblquote','rdblquote'].includes(word))emit(({emdash:'—',endash:'–',bullet:'•',lquote:'‘',rquote:'’',ldblquote:'“',rdblquote:'”'})[word]);
  }flush();return out.join('');
}
export function searchFromXML(xml){
  const texts=[];let size=0;
  const elements=/<NSString\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/NSString\s*>/g;
  for(const m of xml.matchAll(elements)){if(!/\brvXMLIvarName\s*=\s*(["'])RTFData\1/.test(m[1]))continue;const text=rtfText(m[2]);size+=text.length;if(size>1024*1024)throw Error('text_too_large');texts.push(text);}
  return normalizeSearch(texts.join('\n'));
}
export function searchData(xml){try{return {text:searchFromXML(xml),error:null};}catch{return {text:'',error:'text_unavailable'};}}
export function searchStatement(db,id,version,data){return db.prepare('INSERT OR REPLACE INTO yebaeon_document_search(document_id,version,search_text,error) VALUES (?,?,?,?)').bind(id,version,data.text,data.error);}
const join='FROM yebaeon_documents d LEFT JOIN yebaeon_document_search s ON s.document_id=d.id AND s.version=d.current_version';
export async function indexSearch(env,batchSize=8,after=''){
  if(typeof after!=='string'||after.length>600)throw new Error('invalid_index_cursor');
  // Visit each document once per explicit pass; do not keep rescanning missing rows.
  const rows=(await env.DB.prepare(`SELECT d.id,d.path,d.current_version,d.search_enabled,d.usage_version,d.usage_error,v.object_key,s.document_id AS indexed,s.error AS search_error ${join} JOIN yebaeon_versions v ON v.document_id=d.id AND v.version=d.current_version WHERE d.path>? ORDER BY d.path LIMIT ?`).bind(after,batchSize+1).all()).results;
  let processed=0,failed=0;
  for(const row of rows.slice(0,batchSize)){
    if((!row.search_enabled||(row.indexed&&!row.search_error))&&row.usage_version===row.current_version&&!row.usage_error)continue;
    let data,used=null,error=null;
    try{const object=await env.FILES.get(row.object_key);if(!object)throw Error();const xml=await object.text();data=searchData(xml);used=usageFromXML(xml);}catch{data={text:'',error:'text_unavailable'};error='usage_unavailable';}
    if((row.search_enabled&&data.error)||error)failed++;
    const statements=[];
    if(row.usage_version!==row.current_version||row.usage_error)statements.push(env.DB.prepare('UPDATE yebaeon_documents SET last_used=?,usage_error=?,usage_version=? WHERE id=? AND current_version=?').bind(used?new Date(used).toISOString():null,error,row.current_version,row.id,row.current_version));
    if(row.search_enabled)statements.push(guardedSearchStatement(env.DB,row.id,row.current_version,data));
    if(statements.length)await env.DB.batch(statements);processed++;
  }
  return {processed,failed,scanned:Math.min(rows.length,batchSize),next:rows.length>batchSize?rows[batchSize-1].path:null};
}
// Older in-flight extraction must not resurrect a disabled or superseded index.
export function guardedSearchStatement(db,id,version,data){
  return db.prepare(`INSERT OR REPLACE INTO yebaeon_document_search(document_id,version,search_text,error) SELECT id,current_version,?,? FROM yebaeon_documents WHERE id=? AND current_version=? AND search_enabled=1`).bind(data.text,data.error,id,version);
}
