(function(){'use strict';const $=id=>document.getElementById(id);let busy=false,catalog=null;const fmt=x=>Number(x||0).toLocaleString('ko-KR');
const KST={timeZone:'Asia/Seoul'},dayKey=at=>new Intl.DateTimeFormat('en-CA',{...KST,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),clock=at=>new Intl.DateTimeFormat('ko-KR',{...KST,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
// 오늘 14:32 / 어제 08:10 / 10월 3일 09:15
const time=at=>{if(!at)return '기록 없음';const k=dayKey(at);if(k===dayKey(Date.now()))return '오늘 '+clock(at);if(k===dayKey(Date.now()-864e5))return '어제 '+clock(at);return new Intl.DateTimeFormat('ko-KR',{...KST,...(k.slice(0,4)===dayKey(Date.now()).slice(0,4)?{}:{year:'numeric'}),month:'long',day:'numeric'}).format(new Date(at))+' '+clock(at);};
const size=b=>{b=Number(b||0);return b>=1024**3?(b/1024**3).toFixed(2)+' GB':(b/1024/1024).toFixed(1)+' MB';};
function el(tag,cls,...children){const node=document.createElement(tag);if(cls)node.className=cls;for(const c of children.flat())if(c!==null&&c!==undefined&&c!==false)node.append(c);return node;}
const names=(list,count)=>list.join(', ')+(count>list.length?` 외 ${count-list.length}`:'');
async function request(path,options={}){const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...options});if(!r.ok){const data=await r.json().catch(()=>({}));const e=new Error(data.message||'서버에 연결하지 못했습니다.');e.status=r.status;throw e;}return r.json();}
// 표 한 개: 값은 글자 또는 노드. 빈 표는 한 줄 안내.
function rows(id,data,columns,classes=[]){const body=$(id);body.replaceChildren();for(const item of data){const row=document.createElement('tr');columns(item).forEach((value,i)=>{const cell=el('td',classes[i]||'',value);if(typeof value==='string')cell.title=value;row.append(cell);});body.append(row);}if(!data.length){const cell=el('td','empty','아직 기록이 없습니다.');cell.colSpan=columns({}).length||1;body.append(el('tr','',cell));}}
// 버전별 용량 표: 문서·재생목록과 이전 버전. 이미지는 이미지 칸에서 폴더별로 보인다.
const labels={currentDocuments:'현재 문서',currentPlaylists:'현재 재생목록',documentHistory:'문서 이전 버전',playlistHistory:'재생목록 이전 버전'};
const FOLDER={Images:'Images',ImportedImages:'ImportedImages',YebaeOn:'YebaeOn',other:'그 밖'};
function details(storage,observedAt){
 rows('storage',Object.entries(labels).filter(([key])=>storage[key]).map(([key,label])=>({label,...storage[key]})),x=>[x.label,fmt(x.count),size(x.bytes)],['','num','num']);
 $('storageTotal').textContent='원본 합계 '+size(storage.trackedBytes)+(observedAt?' · 상세 확인 '+time(observedAt):'');$('storagePanel').hidden=false;
 rows('imageFolders',storage.imageFolders||[],x=>[FOLDER[x.folder]||x.folder,fmt(x.count),size(x.bytes)],['','num','num']);$('imageFoldersPanel').hidden=false;
}
const studioLine=x=>el('span','',x.nodeCount?[el('span','tag order','순서'),names(x.nodes,x.nodeCount),x.docCount||x.images?' · ':'']:'',x.docCount?[el('span','tag doc','문서'),names(x.docs,x.docCount),x.images?' · ':'']:'',x.images?[el('span','tag img','이미지'),fmt(x.images)]:'');
const KIND={applied:'받기',uploaded:'올리기',remote:'원격'},STATE={pending:'기다림',taken:'Mac 실행 중',done:'완료',failed:'실패',rejected:'하지 않음',expired:'만료'};
function eventText(e){
 if(e.kind==='remote')return `${e.action}${e.target?' · '+e.target:''} · ${e.author} 요청 · ${STATE[e.state]||e.state}`;
 const list=names(e.names||[],e.count-(e.images||0));return [list,e.images?`이미지 ${fmt(e.images)}`:''].filter(Boolean).join(' · ')||(e.kind==='applied'?'서버 변경 적용':'올림');
}
async function refresh(){if(busy||document.hidden)return;busy=true;try{const s=await request('/api/status');$('login').hidden=true;$('dashboard').hidden=false;
 $('count').textContent=fmt(s.documents);$('bytes').textContent=size(s.bytes);$('imageCount').textContent=fmt(s.images?.count);$('imageBytes').textContent=size(s.images?.bytes);
 $('imageSummary').textContent=`원본 ${fmt(s.images?.count)}개 · ${size(s.images?.bytes)}`;$('observed').textContent='마지막 확인 '+time(s.observedAt);
 rows('studio',s.studio||[],x=>[x.author,time(x.at),studioLine(x)],['','dim','']);
 rows('syncEvents',s.syncEvents||[],e=>[time(e.at),el('span','kind '+e.kind,KIND[e.kind]||e.kind),(s.devices?.length>1&&e.device?e.device+' · ':'')+eventText(e)],['dim','','']);
 $('devices').textContent=(s.devices||[]).map(d=>`${d.name} · ${d.statusAt?time(d.statusAt)+' 보고':'현황 보고 없음'}`).join(' / ');
 rows('recent',s.recent,x=>[x.path,String(x.version),el('span','',el('span','src'+(x.device?' mac':''),x.device?'Mac':'Studio'),x.author),time(x.updatedAt),'확인 중…'],['path','','','dim','dim']);
 Array.from($('recent').children).forEach((row,i)=>{if(s.recent[i])window.YebaeonUsage.show(row.lastChild,s.recent[i],false);});
 if(s.storage)details(s.storage,s.observedAt);
 $('message').textContent='서버 기록을 확인했습니다.';$('message').hidden=true;
 if(!catalog){try{catalog=await request('/resources/catalog.json');}catch(_){}}
 if(catalog){$('baseline').textContent=`이름 인덱스 ${fmt(s.catalogDocuments)}개 · 원본 미업로드 ${fmt(s.unavailableDocuments)}개`;
  const facts=[['폰트',`${(catalog.fonts||[]).length}종${catalog.storage?' · '+size(catalog.storage.fontBytes):''}`],['템플릿',`${catalog.templateFiles||0}개 파일 · ${catalog.templates||0}개 슬라이드`],['성경',catalog.bible?`${catalog.bible.name} ${fmt(catalog.bible.verses)}절`:'없음'],['배포 이미지',`금요예배 ${(catalog.media||[]).length}개${catalog.storage?' · '+size(catalog.storage.mediaBytes):''}`]];
  $('resources').replaceChildren(...facts.flatMap(([k,v])=>[el('dt','',k),el('dd','',v)]));}
 else $('resources').replaceChildren(el('dt','','자료'),el('dd','','목록을 불러오지 못했습니다. 다음 새로고침에서 다시 확인합니다.'));
 }
catch(e){$('message').hidden=false;$('message').textContent=e.message;if(e.status===401){$('login').hidden=false;$('dashboard').hidden=true;}}finally{busy=false;}}
$('login').onsubmit=async e=>{e.preventDefault();try{await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('name').value,password:$('password').value,remember:true})});await refresh();}catch(err){$('message').textContent=err.message;}finally{$('password').value='';}};$('refresh').onclick=refresh;async function loadDetails(button){button.disabled=true;try{const s=await request('/api/status?details=1');details(s.storage,s.observedAt);}catch(e){$('message').hidden=false;$('message').textContent=e.message;}finally{button.disabled=false;}}
$('storageRefresh').onclick=()=>loadDetails($('storageRefresh'));$('imageFoldersOpen').onclick=()=>loadDetails($('imageFoldersOpen'));
// 미리보기 일괄 만들기: 폴더별 경로 목록(쪽 단위) → 이미 있는 미리보기 확인 → 없는 것만 원본을 받아 만들어 올린다. 동시에 3개.
let stopThumbs=false;$('thumbnailStop').onclick=()=>{stopThumbs=true;$('thumbnailProgress').textContent='멈추는 중…';};
$('thumbnailBatch').onclick=async()=>{const button=$('thumbnailBatch'),say=t=>$('thumbnailProgress').textContent=t;button.disabled=true;$('thumbnailStop').hidden=false;stopThumbs=false;
 try{const hashes=new Set();for(const folder of ['Images','YebaeOn']){let after=null;do{const page=await request('/api/media/paths?'+new URLSearchParams({folder,...after?{after}:{}}));for(const p of page.paths)hashes.add(p.sha256);after=page.next;say(`그림 목록 확인 중… ${fmt(hashes.size)}개`);}while(after&&!stopThumbs);}
  const all=[...hashes],have=await window.YebaeonThumbnails.existing(all),todo=all.filter(h=>!have.has(h));let done=0,failed=0;say(`미리보기 없는 그림 ${fmt(todo.length)}개 / 전체 ${fmt(all.length)}개`);
  const worker=async()=>{while(todo.length&&!stopThumbs){const sha=todo.shift();try{await window.YebaeonThumbnails.make(sha,null,true);done++;}catch(_){failed++;}say(`만드는 중 ${fmt(done+failed)} / ${fmt(done+failed+todo.length)}${failed?` · 실패 ${fmt(failed)}`:''}`);}};
  await Promise.all([worker(),worker(),worker()]);say(`${stopThumbs?'멈춤':'끝'} · 새로 만든 미리보기 ${fmt(done)}개${failed?` · 실패 ${fmt(failed)}개(다시 누르면 실패한 것만 다시 합니다)`:''} · 전체 ${fmt(all.length)}개 중 ${fmt(have.size+done)}개 있음`);}
 catch(e){say(e.message);}finally{button.disabled=false;$('thumbnailStop').hidden=true;}};
refresh();})();

