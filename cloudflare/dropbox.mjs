import {HttpError,json,method} from './http.mjs';
const tokens=new Map();
export function dropboxReady(env){return ['DROPBOX_APP_KEY','DROPBOX_APP_SECRET','DROPBOX_REFRESH_TOKEN','DROPBOX_ROOT'].every(k=>typeof env[k]==='string'&&env[k].length);}
export function folderPath(root,relative=''){
 if(!root||!root.startsWith('/')||(root!=='/'&&(root.endsWith('/')||root.split('/').slice(1).some(p=>!p||p==='.'||p==='..')))||/[\\\x00-\x1f]/.test(root))throw new HttpError(503,'dropbox_root','드롭박스 전용 폴더 설정을 확인해 주세요.');
 if(typeof relative!=='string'||relative.length>1500||relative.startsWith('/')||/[\\\x00-\x1f]/.test(relative)||relative.split('/').some(p=>p==='.'||p==='..'||(!p&&relative)))throw new HttpError(400,'dropbox_path','허용된 폴더 안에서 선택해 주세요.');
 return root==='/'?(relative?'/'+relative:''):root+(relative?'/'+relative:'');
}
async function access(env){const key=env.DROPBOX_REFRESH_TOKEN,cached=tokens.get(key);if(cached&&cached.until>Date.now())return cached.value;
 const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:key,client_id:env.DROPBOX_APP_KEY,client_secret:env.DROPBOX_APP_SECRET})});
 if(!r.ok)throw new HttpError(503,'dropbox_auth','드롭박스 연결을 갱신하지 못했습니다. 관리자에게 재연결을 요청하세요.');const data=await r.json();if(!data.access_token)throw new HttpError(503,'dropbox_auth','드롭박스 인증 응답 오류');tokens.clear();tokens.set(key,{value:data.access_token,until:Date.now()+Math.max(0,Number(data.expires_in)-120)*1000});return data.access_token;
}
async function rpc(env,name,args){const r=await fetch('https://api.dropboxapi.com/2/'+name,{method:'POST',headers:{Authorization:'Bearer '+await access(env),'Content-Type':'application/json'},body:JSON.stringify(args)});if(!r.ok){if(r.status===401)tokens.delete(env.DROPBOX_REFRESH_TOKEN);throw new HttpError(r.status===429?429:502,'dropbox_read',r.status===429?'드롭박스 요청이 많습니다. 잠시 후 다시 시도하세요.':'드롭박스 자료를 읽지 못했습니다. 폴더 경로와 열람 권한을 확인하세요.');}return r.json();}
async function mac(env,data){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SITE_PASSWORD),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('dropbox-cursor:'+data))),n=>n.toString(16).padStart(2,'0')).join('');}
async function seal(env,cursor,path){const data=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({cursor,path,root:env.DROPBOX_ROOT,expires:Date.now()+3600000}))));return data+'.'+await mac(env,data);}
async function unseal(env,token,path){try{if(token.length>16000)throw Error();const [data,sig]=token.split('.');if(sig!==await mac(env,data))throw Error();const value=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data),c=>c.charCodeAt(0))));if(value.path!==path||value.root!==env.DROPBOX_ROOT||value.expires<Date.now())throw Error();return value.cursor;}catch{throw new HttpError(400,'dropbox_cursor','목록을 새로 열어 주세요.');}}
export async function dropboxRoute(request,env,action){method(request,['GET']);if(action==='config')return json({ready:dropboxReady(env)});if(!dropboxReady(env))throw new HttpError(503,'dropbox_setup','드롭박스 최초 연결 설정이 필요합니다. HWP 직접 업로드는 사용할 수 있습니다.');
 env={...env,DROPBOX_ROOT:env.DROPBOX_ROOT.normalize('NFC')};
 const url=new URL(request.url),relative=url.searchParams.get('path')||'',path=folderPath(env.DROPBOX_ROOT,relative);
 if(action==='list'){const cursor=url.searchParams.get('cursor');const result=await rpc(env,cursor?'files/list_folder/continue':'files/list_folder',cursor?{cursor:await unseal(env,cursor,path)}:{path,recursive:false,limit:100,include_deleted:false});
  const base=env.DROPBOX_ROOT==='/'?'/':env.DROPBOX_ROOT.toLowerCase()+'/';const entries=result.entries.filter(e=>e.path_lower?.startsWith(base)).map(e=>({name:e.name,kind:e['.tag'],path:e.path_display.slice(base.length),size:e.size||0,modified:e.server_modified||null}));
  return json({entries,next:result.has_more?await seal(env,result.cursor,path):null});
 }
 if(action==='file'){if(!relative)throw new HttpError(400,'dropbox_file','파일을 선택하세요.');const metadata=await rpc(env,'files/get_metadata',{path});if(metadata['.tag']!=='file'||!metadata.path_lower?.startsWith(env.DROPBOX_ROOT==='/'?'/':env.DROPBOX_ROOT.toLowerCase()+'/'))throw new HttpError(403,'dropbox_scope','허용된 폴더의 파일이 아닙니다.');
  const argument=JSON.stringify({path}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const r=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:'Bearer '+await access(env),'Dropbox-API-Arg':argument}});if(!r.ok)throw new HttpError(502,'dropbox_download','파일을 받지 못했습니다.');
  return new Response(r.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(metadata.name),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 throw new HttpError(404,'not_found','없는 요청입니다.');
}
