import { documentPath } from './documents.mjs';
import { HttpError,bytes,json,method,sameOrigin } from './http.mjs';
// Complete metadata-only scans commit atomically; failed requests cannot mark files missing.
export async function inventoryRoute(request,env,user){
  method(request,['POST']);sameOrigin(request);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'json_required','JSON 요청이 필요합니다.');
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(request,8*1024*1024)));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'invalid_inventory','문서 목록을 확인해 주세요.');}
  if(!/^[a-f0-9]{64}$/.test(body?.deviceId)||!Array.isArray(body.documents)||body.documents.length>10000)throw new HttpError(400,'invalid_inventory','문서 목록을 확인해 주세요.');
  const seen=new Set(),documents=body.documents.map(d=>{
    const path=documentPath(d?.originalPath);
    if(seen.has(path)||!Number.isSafeInteger(d.size)||d.size<0)throw new HttpError(400,'invalid_inventory','겹치는 경로나 파일 크기를 확인해 주세요.');
    seen.add(path);return {id:crypto.randomUUID(),path,originalPath:d.originalPath,size:d.size};
  });
  const snapshot=crypto.randomUUID(),at=new Date().toISOString(),statements=[env.DB.prepare('DELETE FROM yebaeon_inventory_members WHERE device_id=?').bind(body.deviceId)];
  for(let offset=0;offset<documents.length;offset+=400){const data=JSON.stringify(documents.slice(offset,offset+400));
    statements.push(env.DB.prepare(`INSERT INTO yebaeon_library_catalog(id,path,original_path,size,slide_count,snapshot)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.path'),json_extract(value,'$.originalPath'),json_extract(value,'$.size'),0,? FROM json_each(?) WHERE true
      ON CONFLICT(path) DO UPDATE SET original_path=excluded.original_path,size=excluded.size,snapshot=excluded.snapshot`).bind(snapshot,data));
    statements.push(env.DB.prepare(`INSERT INTO yebaeon_inventory_members(device_id,path) SELECT ?,json_extract(value,'$.path') FROM json_each(?)`).bind(body.deviceId,data));
  }
  statements.push(env.DB.prepare(`INSERT INTO yebaeon_inventory_devices(device_id,snapshot,updated_at,author,count) VALUES(?,?,?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=excluded.updated_at,author=excluded.author,count=excluded.count`).bind(body.deviceId,snapshot,at,user.author,documents.length));
  await env.DB.batch(statements);
  return json({snapshot,updatedAt:at,count:documents.length});
}
