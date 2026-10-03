import {HttpError,bytes,headers,json,method,sameOrigin,sha256} from './http.mjs';

// Images are immutable, content-addressed objects. We intentionally keep no
// per-image version history; old hashes remain referenced until a future,
// explicitly reviewed cleanup proves they are unused and unprotected.
const HASH=/^[a-f0-9]{64}$/;
const MAX_IMAGE=32*1024*1024;
function sniff(data){
  const b=data,ascii=(start,end)=>String.fromCharCode(...b.slice(start,end));
  if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
  if(b.length>=8&&b[0]===137&&ascii(1,4)==='PNG')return 'image/png';
  if(b.length>=6&&['GIF87a','GIF89a'].includes(ascii(0,6)))return 'image/gif';
  if(b.length>=2&&ascii(0,2)==='BM')return 'image/bmp';
  if(b.length>=12&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
  if(b.length>=4&&['II*\0','MM\0*'].includes(ascii(0,4)))return 'image/tiff';
  if(b.length>=4&&ascii(0,4)==='8BPS')return 'image/vnd.adobe.photoshop';
  if(b.length>=4&&ascii(0,4)==='%PDF')return 'application/pdf';
  if(b.length>=12&&ascii(4,8)==='ftyp'&&/(heic|heix|hevc|hevx|mif1|msf1|avif|avis)/.test(ascii(8,12)))return 'image/heic';
  return null;
}
function mediaKey(hash){return `media/sha256/${hash.slice(0,2)}/${hash}`;}
async function parseBody(request,limit){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'json_required','JSON 요청이 필요합니다.');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(request,limit)));}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'invalid_json','입력값을 확인해 주세요.');}
}
export async function mediaRoute(request,env,user,hash,action){
  const url=new URL(request.url);
  if(!hash){
    method(request,['GET']);
    const values=url.searchParams.getAll('hash');
    if(!values.length||values.length>100||values.some(h=>!HASH.test(h)))throw new HttpError(400,'invalid_hashes','조회할 이미지 hash를 1~100개 선택해 주세요.');
    const found=[];
    for(let i=0;i<values.length;i+=80){const part=values.slice(i,i+80);found.push(...(await env.DB.prepare(`SELECT sha256,size,content_type AS contentType,protected,revision FROM yebaeon_media_assets WHERE sha256 IN (${part.map(()=>'?').join(',')})`).bind(...part).all()).results);}
    return json({assets:found.map(a=>({...a,protected:!!a.protected}))});
  }
  if(!HASH.test(hash))throw new HttpError(400,'invalid_hash','SHA-256 값이 올바르지 않습니다.');
  if(action==='content'&&request.method==='PUT'){
    sameOrigin(request);method(request,['PUT']);
    if(request.headers.get('X-Yebaeon-SHA256')!==hash)throw new HttpError(400,'hash_required','파일의 SHA-256 확인값이 필요합니다.');
    const data=await bytes(request,MAX_IMAGE);
    if(!data.length)throw new HttpError(400,'empty_image','빈 이미지 파일은 저장할 수 없습니다.');
    const actual=await sha256(data);if(actual!==hash)throw new HttpError(422,'hash_mismatch','받은 이미지의 SHA-256이 다릅니다. 저장하지 않았습니다.');
    const contentType=sniff(data);if(!contentType)throw new HttpError(415,'unsupported_image','확인된 이미지 파일 형식이 아닙니다.');
    const key=mediaKey(hash),old=await env.DB.prepare('SELECT sha256,size,content_type AS contentType,protected,revision FROM yebaeon_media_assets WHERE sha256=?').bind(hash).first();
    if(old){const object=await env.FILES.head(key);if(object&&object.size===old.size&&old.size===data.length&&object.customMetadata?.sha256===hash)return json({asset:{...old,protected:!!old.protected},unchanged:true});}
    // R2 and D1 are separate systems: a deterministic key makes retries after
    // a lost response idempotent and allows an orphaned verified object to be
    // adopted by the next attempt without transferring different bytes.
    const object=await env.FILES.get(key);
    if(object){const existing=await object.arrayBuffer();if(existing.byteLength!==data.length||await sha256(existing)!==hash)throw new HttpError(503,'stored_hash_mismatch','이미 저장된 이미지 검증에 실패했습니다. 자동으로 덮어쓰지 않았습니다.');}
    else await env.FILES.put(key,data,{sha256:hash,customMetadata:{sha256:hash},httpMetadata:{contentType}});
    const now=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO yebaeon_media_assets(sha256,object_key,size,content_type,protected,revision,created_at,updated_at,updated_by) VALUES(?,?,?,?,1,1,?,?,?) ON CONFLICT(sha256) DO UPDATE SET object_key=excluded.object_key,size=excluded.size,content_type=excluded.content_type,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(hash,key,data.length,contentType,now,now,user.author).run();
    const saved=await env.DB.prepare('SELECT sha256,size,content_type AS contentType,protected,revision FROM yebaeon_media_assets WHERE sha256=?').bind(hash).first();
    return json({asset:{...saved,protected:!!saved.protected},unchanged:false},old?200:201);
  }
  if(action==='content'){
    method(request,['GET','HEAD']);
    const asset=await env.DB.prepare('SELECT sha256,object_key AS objectKey,size,content_type AS contentType FROM yebaeon_media_assets WHERE sha256=?').bind(hash).first();
    if(!asset)throw new HttpError(404,'media_not_found','서버에 이미지가 없습니다.');
    const object=await env.FILES.get(asset.objectKey);if(!object)throw new HttpError(503,'media_unavailable','서버 이미지 원본을 읽지 못했습니다.');
    if(object.size!==asset.size)throw new HttpError(503,'media_size_mismatch','서버 이미지 크기 확인에 실패했습니다.');
    const responseHeaders={...headers,'Content-Type':asset.contentType,'Content-Length':String(asset.size),'X-Yebaeon-SHA256':asset.sha256,'Cache-Control':'private, no-store'};
    return request.method==='HEAD'?new Response(null,{headers:responseHeaders}):new Response(object.body,{headers:responseHeaders});
  }
  if(action==='protection'){
    method(request,['PUT']);sameOrigin(request);
    const body=await parseBody(request,4096);
    if(typeof body?.protected!=='boolean'||!Number.isSafeInteger(body.revision)||body.revision<1)throw new HttpError(400,'invalid_protection','보호 상태와 현재 revision이 필요합니다.');
    const now=new Date().toISOString(),result=await env.DB.prepare('UPDATE yebaeon_media_assets SET protected=?,revision=revision+1,updated_at=?,updated_by=? WHERE sha256=? AND revision=?').bind(body.protected?1:0,now,user.author,hash,body.revision).run();
    if(!result.meta?.changes)throw new HttpError(409,'media_revision_conflict','이미지 보호 상태가 바뀌었습니다. 새로 고친 뒤 다시 시도해 주세요.');
    const asset=await env.DB.prepare('SELECT sha256,size,content_type AS contentType,protected,revision FROM yebaeon_media_assets WHERE sha256=?').bind(hash).first();
    return json({asset:{...asset,protected:!!asset.protected}});
  }
  throw new HttpError(404,'not_found','없는 요청입니다.');
}

export async function mediaReferencesRoute(request,env){
  if(request.method==='GET'){
    const url=new URL(request.url),documentId=url.searchParams.get('documentId'),version=Number(url.searchParams.get('version'));
    if(!/^[0-9a-f-]{36}$/i.test(documentId||'')||!Number.isSafeInteger(version)||version<1)throw new HttpError(400,'invalid_media_reference_query','문서와 버전을 확인해 주세요.');
    const doc=await env.DB.prepare('SELECT current_version FROM yebaeon_documents WHERE id=?').bind(documentId).first();
    if(!doc)throw new HttpError(404,'document_not_found','문서를 찾지 못했습니다.');
    if(doc.current_version!==version)throw new HttpError(409,'document_version_conflict','문서 버전이 바뀌었습니다. 최신 문서를 다시 준비해 주세요.');
    const rows=(await env.DB.prepare('SELECT r.reference_id AS id,r.asset_sha256 AS sha256,r.source,r.slide_index AS slide,a.size,a.content_type AS contentType FROM yebaeon_media_references r JOIN yebaeon_media_assets a ON a.sha256=r.asset_sha256 WHERE r.document_id=? AND r.document_version=? ORDER BY r.slide_index,r.reference_id LIMIT 2001').bind(documentId,version).all()).results;
    if(rows.length>2000)throw new HttpError(413,'too_many_media_references','문서의 이미지 참조 수가 지원 범위를 넘습니다.');
    return json({documentId,version,references:rows});
  }
  method(request,['PUT']);sameOrigin(request);
  const body=await parseBody(request,256*1024),{documentId,version,references}=body||{};
  if(typeof documentId!=='string'||!/^[0-9a-f-]{36}$/i.test(documentId)||!Number.isSafeInteger(version)||version<1||!Array.isArray(references)||references.length>2000)throw new HttpError(400,'invalid_media_references','문서·버전·이미지 참조를 확인해 주세요.');
  const doc=await env.DB.prepare('SELECT current_version FROM yebaeon_documents WHERE id=?').bind(documentId).first();
  if(!doc)throw new HttpError(404,'document_not_found','문서를 찾지 못했습니다.');
  if(doc.current_version!==version)throw new HttpError(409,'document_version_conflict','문서 버전이 바뀌었습니다. 최신 문서를 다시 준비해 주세요.');
  const unique=new Set();
  for(const ref of references){
    if(!ref||!HASH.test(ref.sha256)||typeof ref.id!=='string'||!ref.id.length||ref.id.length>160||typeof ref.source!=='string'||!ref.source.length||ref.source.length>4096||/[\u0000-\u001f\u007f]/.test(ref.source)||!Number.isSafeInteger(ref.slide)||ref.slide<0)throw new HttpError(400,'invalid_media_reference','이미지 참조 위치를 확인해 주세요.');
    if(unique.has(ref.id))throw new HttpError(400,'duplicate_media_reference','같은 문서 안에서 이미지 참조 번호가 겹칩니다.');unique.add(ref.id);
  }
  const hashes=[...new Set(references.map(r=>r.sha256))],found=[];
  for(let i=0;i<hashes.length;i+=80){const part=hashes.slice(i,i+80);found.push(...(await env.DB.prepare(`SELECT sha256 FROM yebaeon_media_assets WHERE sha256 IN (${part.map(()=>'?').join(',')})`).bind(...part).all()).results);}
  if(found.length!==hashes.length)throw new HttpError(409,'media_missing','서버에 없는 이미지가 포함되어 있습니다. 먼저 이미지를 전송해 주세요.');
  const now=new Date().toISOString(),statements=[env.DB.prepare('DELETE FROM yebaeon_media_references WHERE document_id=? AND document_version=?').bind(documentId,version),...references.map(ref=>env.DB.prepare('INSERT INTO yebaeon_media_references(document_id,document_version,reference_id,asset_sha256,source,slide_index,created_at) VALUES(?,?,?,?,?,?,?)').bind(documentId,version,ref.id,ref.sha256,ref.source,ref.slide,now))];
  // Keep reference replacement bounded and atomic per document version.
  if(statements.length>1000)throw new HttpError(413,'too_many_media_references','문서의 미디어 참조가 한 번에 처리할 수 있는 수를 넘습니다.');
  await env.DB.batch(statements);
  return json({documentId,version,references:references.length,uniqueAssets:hashes.length});
}
