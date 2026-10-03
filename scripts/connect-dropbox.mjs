// Run locally by the account owner. Tokens go straight to Wrangler stdin, never
// to source files, shell arguments or this program's output.
import {createInterface} from 'node:readline/promises';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
const rl=createInterface({input:process.stdin,output:process.stdout});
async function secret(prompt){rl.close();if(!process.stdin.isTTY)throw Error('직접 실행한 터미널에서 연결하세요.');process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();return new Promise((resolve,reject)=>{let text='';const listener=b=>{const s=b.toString();if(s.includes('\u0003')){end();reject(Error('취소됨'));return;}if(/[\r\n]/.test(s)){text+=s.split(/[\r\n]/)[0];end();resolve(text.trim());return;}if(s==='\u007f')text=text.slice(0,-1);else text+=s;};function end(){process.stdin.off('data',listener);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}process.stdin.on('data',listener);});}
async function put(name,value){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put',name],{stdio:['pipe','inherit','inherit'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(name+' 등록 실패')));child.stdin.end(value);});}
try{const appKey=(await rl.question('Dropbox App key: ')).trim();const root=(await rl.question('공유폴더 전체 경로 (예: /교회/주보): ')).trim();if(!root.startsWith('/')||root==='/'||root.endsWith('/')||root.includes('..'))throw Error('특정 폴더의 전체 경로를 입력하세요.');
 const appSecret=await secret('App secret (화면에 표시하지 않음): ');const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const url=new URL('https://www.dropbox.com/oauth2/authorize');url.search=new URLSearchParams({client_id:appKey,response_type:'code',token_access_type:'offline',code_challenge:challenge,code_challenge_method:'S256',scope:'files.metadata.read files.content.read'});console.log('\n계정 소유자가 다음 주소에서 한 번 승인하고 표시된 코드를 복사하세요:\n'+url);
 const code=await secret('승인 코드 (화면에 표시하지 않음): ');const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:appKey,client_secret:appSecret,code,code_verifier:verifier})});if(!r.ok)throw Error('Dropbox 승인 코드 교환 실패: '+r.status);const data=await r.json();if(!data.refresh_token)throw Error('재연결 토큰을 받지 못했습니다.');
 const check=await fetch('https://api.dropboxapi.com/2/files/list_folder',{method:'POST',headers:{Authorization:'Bearer '+data.access_token,'Content-Type':'application/json'},body:JSON.stringify({path:root,limit:1})});if(!check.ok)throw Error('지정 공유폴더를 읽지 못했습니다. 경로와 계정에 추가된 공유폴더인지 확인하세요. 서버 설정은 쓰지 않았습니다.');
 for(const [name,value]of Object.entries({DROPBOX_APP_KEY:appKey,DROPBOX_APP_SECRET:appSecret,DROPBOX_REFRESH_TOKEN:data.refresh_token,DROPBOX_ROOT:root}))await put(name,value);
 console.log('연결 완료. 다른 이용자는 Dropbox 승인 없이 예배온의 교회 자료에서 열 수 있습니다.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{rl.close();}
