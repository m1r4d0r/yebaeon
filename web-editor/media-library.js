(function(){'use strict';
 // 미디어 서랍: ★ 공용 즐겨찾기 / 열린 재생목록이 배경으로 쓰는 그림(접힌 '사용된 전체 이미지') / 서버의 나머지 그림(모두 보기 창).
 // 그림 바이트는 sha 주소라 브라우저 캐시를 쓴다. 나머지 목록은 Images·YebaeOn 폴더만 쪽 단위로 받는다(ImportedImages는 받지 않음).
 const $=id=>document.getElementById(id),C=YebaeonCloud,E=YebaeonEditor,P=PP6,ROOT='/Users/Shared/Renewed Vision Media/';
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 const fileName=path=>String(path||'').split('/').pop();
 const plain=source=>{let value=String(source||'');if(value.startsWith('file:')){try{const url=new URL(value);if(!url.host)value=decodeURIComponent(url.pathname);}catch{}}return value.normalize('NFC');};
 const folderOf=path=>path.startsWith(ROOT)?path.slice(ROOT.length).split('/')[0]:'';
 // 문서에 넣는 그림 주소는 PP6처럼 file:// 형식으로 쓴다(경로 조각마다 인코딩).
 const fileURL=path=>'file://'+path.split('/').map(p=>encodeURIComponent(p).replace(/'/g,'%27')).join('/');
 let drag=null,generation=0;

 /* ---------- 공용 즐겨찾기 (미디어·템플릿) ---------- */
 let favorites=null,favoritesLoad=null;
 const Favorites={
  async load(force=false){if(favorites&&!force)return favorites;if(!favoritesLoad||force)favoritesLoad=C.api('/favorites').then(r=>r.json()).then(data=>{favorites=new Map(data.items.map(x=>[x.kind+':'+x.key,x]));return favorites;}).finally(()=>{favoritesLoad=null;});return favoritesLoad;},
  has:(kind,key)=>!!favorites?.has(kind+':'+key),
  list:kind=>[...(favorites?.values()||[])].filter(x=>x.kind===kind),
  async toggle(kind,key,label){await Favorites.load();const on=!Favorites.has(kind,key);await C.api('/favorites',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,key,label,on})});if(on)favorites.set(kind+':'+key,{kind,key,label,addedBy:C.worker(),addedAt:new Date().toISOString()});else favorites.delete(kind+':'+key);window.dispatchEvent(new CustomEvent('yebaeonfavorites',{detail:{kind,key,on}}));return on;}
 };

 /* ---------- 경로 → sha ---------- */
 const shaOf=new Map();
 async function resolve(sources){const ask=[];for(const source of sources){const path=plain(source),direct=/^\/YebaeOn-Media\/([a-f0-9]{64})\.png$/.exec(path)||/^file:\/\/\/YebaeOn-Media\/([a-f0-9]{64})\.png$/.exec(source);if(direct){shaOf.set(path,direct[1]);continue;}if(!shaOf.has(path)&&folderOf(path))ask.push(path);}
  const unique=[...new Set(ask)];for(let i=0;i<unique.length;i+=50){const part=unique.slice(i,i+50),params=new URLSearchParams();part.forEach(p=>params.append('path',p));const rows=(await(await C.api('/media/paths?'+params)).json()).paths||[];for(const p of part)shaOf.set(p,null);for(const row of rows)if(row.state==='active')shaOf.set(row.path,row.sha256);}
  return path=>shaOf.get(plain(path))||null;}

 /* ---------- 열린 재생목록이 쓰는 그림 ---------- */
 const xmlCache=new Map();
 async function memberXML(item){const doc=item.document||item.indexedDocument,id=doc?.id||item.documentId;if(!id||doc?.available===false)return null;const local=E.cache(id);if(local?.xml&&(local.dirty||E.state().key===id))return {id,name:doc?.name||'',xml:local.xml};const key=id+'@'+(doc?.version||'');if(!xmlCache.has(key))xmlCache.set(key,C.documentCopySource(id).then(v=>v.xml).catch(()=>{xmlCache.delete(key);return null;}));const xml=await xmlCache.get(key);return xml?{id,name:doc?.name||'',xml}:null;}
 async function usedImages(){const playlist=YebaeonPlaylists.selectedPlaylist();if(!playlist)return null;const found=new Map();
  for(const item of YebaeonPlaylists.items?.()||[]){const value=await memberXML(item);if(!value)continue;let model;try{model=P.parse(value.xml,value.name||'문서');}catch{continue;}
   for(const slide of P.slides(model)){const cue=P.ivar(slide,'RVMediaCue','backgroundMediaCue'),background=new Set(cue?P.mediaElements(cue):[]);
    for(const media of P.mediaElements(slide)){if(media.tagName!=='RVImageElement')continue;const source=media.getAttribute('source');if(!source)continue;const path=plain(source),entry=found.get(path)||{source,path,background:false,documents:new Set()};entry.background||=background.has(media);entry.documents.add(value.name.replace(/\.pro6$/i,''));found.set(path,entry);}}}
  const sha=await resolve([...found.keys()]);return {playlist,items:[...found.values()].map(x=>({...x,sha:sha(x.path)}))};}

 /* ---------- 그림 칸 ---------- */
 function tile(item,{dialog=false}={}){const b=el('div','media-tile'),pick=el('button','media-pick');pick.type='button';pick.title=item.path+(item.documents?'\n사용: '+[...item.documents].join(', '):'');pick.draggable=!dialog&&E.ready();pick.disabled=!E.ready();if(!E.ready())pick.title+='\n문서를 열면 배경으로 적용할 수 있습니다.';
  if(item.sha){const img=el('img');YebaeonThumbnails.attach(img,item.sha);img.alt='';img.loading='lazy';img.decoding='async';pick.append(img);}else pick.append(el('span','media-missing','서버에 없음'));
  pick.append(el('span','media-name',fileName(item.path)));pick.onclick=()=>{if(!E.ready())return;E.setBackground(item.source||item.path);if(dialog)E.status(`‘${fileName(item.path)}’을 배경으로 적용했습니다.`);};
  pick.ondragstart=e=>{drag={source:item.source||item.path,name:fileName(item.path)};e.dataTransfer.setData('text/plain',drag.source);e.dataTransfer.effectAllowed='copy';};pick.ondragend=()=>{drag=null;};b.append(pick);
  if(item.sha){const star=el('button','media-star'+(Favorites.has('media',item.sha)?' on':''),Favorites.has('media',item.sha)?'★':'☆');star.type='button';star.dataset.sha=item.sha;star.setAttribute('aria-label',(Favorites.has('media',item.sha)?'즐겨찾기에서 빼기':'즐겨찾기')+' · '+fileName(item.path));
   star.onclick=async e=>{e.stopPropagation();star.disabled=true;try{await Favorites.toggle('media',item.sha,item.path);}catch(error){E.status(error.message);}finally{star.disabled=false;}};b.append(star);}
  return b;}
 const grid=list=>{const g=el('div','media-tiles');for(const item of list)g.append(tile(item));return g;};
 const section=(title,count,body)=>{const s=el('section','media-section'),h=el('h3',null,title);if(count!=null)h.append(el('small',null,` ${count}`));s.append(h,body);return s;};
 const matches=(query,path)=>!query||fileName(path).normalize('NFC').toLowerCase().includes(query);

 async function fill(){const token=++generation,root=$('mediaGrid'),query=$('mediaQuery').value.normalize('NFC').trim().toLowerCase();root.replaceChildren(el('p','help','불러오는 중…'));$('mediaDrawer').querySelector(':scope > .help').textContent=E.ready()?'누르거나 슬라이드에 끌어 놓으면 배경이 됩니다. 여러 장을 고르면 함께 적용할 수 있습니다.':'문서를 열지 않아도 그림을 추가하고 즐겨찾기를 정리할 수 있습니다. 배경 적용은 문서를 연 뒤 가능합니다.';
  try{await Favorites.load();if(token!==generation)return;const parts=[];
   const favs=Favorites.list('media').filter(f=>matches(query,f.label)).map(f=>({sha:f.key,path:f.label,source:fileURL(f.label)}));
   parts.push(section('★ 즐겨찾기',favs.length,favs.length?grid(favs):el('p','help','그림의 ☆를 누르면 모두가 보는 즐겨찾기에 들어갑니다.')));
   root.replaceChildren(...parts);
   const used=await usedImages();if(token!==generation)return;
   if(used){const shown=used.items.filter(x=>matches(query,x.path)),backgrounds=shown.filter(x=>x.background&&folderOf(x.path)!=='ImportedImages'),s=section(`배경으로 쓰는 그림 · ${used.playlist.name}`,backgrounds.length,backgrounds.length?grid(backgrounds):el('p','help','이 재생목록 문서에 배경 그림이 없습니다.'));
    if(shown.length){const more=el('details','media-all-used'),sum=el('summary',null,`사용된 전체 이미지 보기 (${shown.length}) · 가져온 이미지·광고·설교 그림 포함`);more.append(sum);more.addEventListener('toggle',()=>{if(more.open&&more.children.length===1)more.append(grid(shown));},{once:false});s.append(more);}
    parts.push(s);}else parts.push(section('배경으로 쓰는 그림',null,el('p','help','재생목록을 열면 그 순서의 문서가 쓰는 그림이 여기에 모입니다.')));
   const rest=section('나머지 그림',null,el('p','help','불러오는 중…'));parts.push(rest);root.replaceChildren(...parts);
   const page=await(await C.api('/media/paths?'+new URLSearchParams({folder:'All',sort:'updated',...query?{q:query}:{}}))).json();if(token!==generation)return;
   const items=page.paths.slice(0,12).map(p=>({sha:p.sha256,path:p.path,source:fileURL(p.path)})),open=el('button','media-more','모두 보기 ›');open.type='button';open.onclick=()=>showAll(query);
   rest.querySelector('h3').append(open);rest.lastChild.replaceWith(items.length?grid(items):el('p','help',query?'이 이름의 그림이 없습니다.':'서버에 그림이 없습니다.'));
  }catch(error){if(token===generation)root.replaceChildren(el('p','help bad',error.message));}}

 /* ---------- 그림 추가: 내 컴퓨터·드롭박스·단색 ---------- */
 // 그림은 원본 바이트 그대로 올린다(자르거나 바꾸지 않음). 단색만 슬라이드 크기 PNG로 만든다. 경로는 YebaeOn/<이름>-<n>.<원본 확장자>로 서버가 정하고, 교회 Mac은 Sync [적용] 때 받는다.
 const IMAGE=/\.(png|jpe?g|webp|gif|bmp)$/i,MAX=20*1024*1024;
 const digestOf=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
 function slideSize(){const m=E.ready()?E.model():null;return m?{width:m.width,height:m.height}:{width:1920,height:1080};}
 async function backgroundPNG(paint){const {width,height}=slideSize(),c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');await paint(ctx,width,height);return new Promise((ok,fail)=>c.toBlob(b=>b?ok(b):fail(new Error('그림을 만들지 못했습니다.')),'image/png'));}
 const EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp'};
 async function upload(blob,name,ext='png'){const sha=await digestOf(blob);await C.api('/media/'+sha+'/content',{method:'PUT',headers:{'Content-Type':blob.type||'application/octet-stream','X-Yebaeon-SHA256':sha},body:blob});
  const body=JSON.stringify({name,ext,items:[{sha256:sha}]});let result;for(let attempt=0;;attempt++){try{result=await(await C.api('/media/paths',{method:'POST',headers:{'Content-Type':'application/json'},body})).json();break;}catch(e){if(e.code!=='media_path_busy'||attempt>=2)throw e;}}
  const path=result.paths.find(p=>p.sha256===sha).path;return {sha,path,source:fileURL(path)};}
 let addDialog=null,addStart=null,adding=false;
 function addResult(item){const box=addDialog.querySelector('.media-add-result'),row=el('div','media-upload-result');row.append(el('p','dialog-help',`‘${fileName(item.path)}’ · 서버 저장 완료`),grid([item]));const apply=el('button','primary','고른 장에 배경으로');apply.type='button';apply.onclick=()=>{E.setBackground(item.source);addDialog.close();};if(!E.ready()||adding)apply.disabled=true;row.append(apply);box.append(row);}
 function lockAdd(value){adding=value;addStart?.setDisabled(value);for(const b of addDialog.querySelectorAll('[data-close],[data-color],.media-upload-result .primary'))b.disabled=value||(b.closest('.media-upload-result')&&!E.ready());}
 async function uploadFile(file){if(!IMAGE.test(file.name)&&!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type))throw new Error('PNG·JPG·WebP·GIF·BMP 그림을 골라 주세요.');if(file.size>MAX)throw new Error('그림은 20MB 이하로 골라 주세요.');
  const ext=EXT[file.type]||(/\.([a-z]+)$/i.exec(file.name)?.[1]||'png').toLowerCase().replace('jpeg','jpg');const bitmap=await createImageBitmap(file).catch(()=>null);if(!bitmap)throw new Error('브라우저가 이 그림을 열지 못했습니다. 다른 형식으로 저장해 올려 주세요.');bitmap.close();
  const item=await upload(file,file.name.replace(/\.[^.]+$/,''),ext);YebaeonThumbnails.make(item.sha,file).catch(()=>{});return item;}
 async function addFiles(files){if(adding||!files.length)return;lockAdd(true);const box=addDialog.querySelector('.media-add-result'),progress=el('p','dialog-help');box.replaceChildren(progress);let done=0;const failed=[];
  try{for(let i=0;i<files.length;i++){const source=files[i];progress.textContent=`서버에 올리는 중 ${i+1}/${files.length} · ${source.name}`;try{const file=source.load?await source.load():source;addResult(await uploadFile(file));done++;}catch(error){failed.push(source);box.append(el('p','dialog-message bad',`${source.name} · 실패: ${error.message}`));}}
   progress.textContent=`서버 저장 완료 ${done}개`+(failed.length?` · 실패 ${failed.length}개`:'')+' · 별도 서버 저장 없이 미디어 전체 목록에서 찾을 수 있습니다.';
   if(failed.length){const retry=el('button','','실패한 파일 다시 올리기');retry.type='button';retry.onclick=()=>addFiles(failed);box.append(retry);}
  }finally{lockAdd(false);if(!$('mediaDrawer').hidden)fill();}}
 async function addColor(color){if(adding)return;lockAdd(true);const say=addDialog.querySelector('.media-add-result');say.replaceChildren(el('p','dialog-help','만드는 중…'));try{const blob=await backgroundPNG((ctx,w,h)=>{ctx.fillStyle=color;ctx.fillRect(0,0,w,h);});const item=await upload(blob,'단색 '+color.replace('#',''));say.replaceChildren();addResult(item);YebaeonThumbnails.make(item.sha,blob).catch(()=>{});if(!$('mediaDrawer').hidden)fill();}finally{lockAdd(false);}}
 function showAdd(){if(!C.needUser()||adding)return;if(!addDialog){addDialog=el('dialog','entry-dialog media-add-dialog');addDialog.id='mediaAddDialog';addDialog.innerHTML='<div class="dialog-heading"><h2>그림 추가</h2><button type="button" data-close>닫기</button></div><p class="dialog-help">여러 그림을 한 번에 선택할 수 있습니다. 업로드 즉시 서버에 저장되며 별도 서버 저장은 필요 없습니다. 올린 그림은 미디어 전체 목록에 표시됩니다. 교회 Mac에는 이 그림을 사용한 문서가 포함된 예배를 Sync에서 적용할 때 내려갑니다. 채우기·맞추기와 자르기는 슬라이드 오른쪽 클릭 › 배경에서 합니다.</p><div class="media-add-start"></div><div class="media-add-color"><label>단색 배경 <input type="color" value="#1b2a4a" aria-label="배경색"></label><button type="button" data-color>단색 그림 만들기</button></div><div class="media-add-result" role="status"></div>';document.body.append(addDialog);
   addDialog.querySelector('[data-close]').onclick=()=>{if(!adding)addDialog.close();};addDialog.addEventListener('cancel',e=>{if(adding)e.preventDefault();});const fail=e=>addDialog.querySelector('.media-add-result').replaceChildren(el('p','dialog-message bad',e.message));
   addStart=YebaeonDropboxPicker.start(addDialog.querySelector('.media-add-start'),{accept:IMAGE,inputAccept:'image/png,image/jpeg,image/webp,image/gif,image/bmp',max:MAX,kind:'그림',onFile:file=>addFiles([file]).catch(fail),onFiles:files=>addFiles(files).catch(fail)});
   addDialog.querySelector('[data-color]').onclick=()=>addColor(addDialog.querySelector('input[type=color]').value).catch(fail);}
  addDialog.querySelector('.media-add-result').replaceChildren();addDialog.showModal();}

 /* ---------- 배경 자르기 ---------- */
 // 원본은 그대로 두고, 고른 영역을 새 그림(원본이 JPEG면 JPEG, 아니면 PNG)으로 올려 고른 장의 배경으로 바꾼다. 영역은 슬라이드 비율로 고정한다.
 let cropDialog=null,cropState=null;
 function drawCrop(){const {bitmap,canvas,rect}=cropState,ctx=canvas.getContext('2d'),k=canvas.width/bitmap.width;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);ctx.fillStyle='rgba(15,22,38,.55)';ctx.beginPath();ctx.rect(0,0,canvas.width,canvas.height);ctx.rect(rect.x*k,rect.y*k,rect.w*k,rect.h*k);ctx.fill('evenodd');ctx.strokeStyle='#ffb020';ctx.lineWidth=2;ctx.strokeRect(rect.x*k+1,rect.y*k+1,rect.w*k-2,rect.h*k-2);}
 function sizeCrop(percent){const {bitmap,ratio,rect}=cropState,cx=rect.x+rect.w/2,cy=rect.y+rect.h/2;let w=Math.min(bitmap.width,bitmap.height*ratio)*percent/100,h=w/ratio;rect.w=w;rect.h=h;rect.x=Math.max(0,Math.min(bitmap.width-w,cx-w/2));rect.y=Math.max(0,Math.min(bitmap.height-h,cy-h/2));drawCrop();}
 async function crop(source,targets){if(!C.needUser())return;const file=await YebaeonResources.media(source);if(!file){E.status('서버에서 이 배경 그림을 찾지 못했습니다.');return;}
  const bitmap=await createImageBitmap(file).catch(()=>null);if(!bitmap){E.status('브라우저가 이 그림을 열지 못했습니다.');return;}
  if(!cropDialog){cropDialog=el('dialog','library-dialog media-crop-dialog');cropDialog.id='mediaCropDialog';cropDialog.innerHTML='<div class="dialog-heading"><h2>배경 자르기</h2><button type="button" data-close>닫기</button></div><p class="dialog-help">주황 틀을 끌어 옮기고, 크기는 아래 막대로 바꿉니다. 원본은 그대로 두고 잘라 낸 부분을 새 그림으로 올려 고른 장의 배경으로 씌웁니다.</p><div class="media-crop-stage"><canvas></canvas></div><label class="media-crop-size">크기 <input type="range" min="20" max="100" value="100" aria-label="자를 크기"></label><p class="dialog-message" role="status"></p><div class="dialog-buttons"><button type="button" data-cancel>취소</button><button type="button" class="primary" data-apply>잘라서 적용</button></div>';document.body.append(cropDialog);
   cropDialog.querySelector('[data-close]').onclick=cropDialog.querySelector('[data-cancel]').onclick=()=>cropDialog.close();cropDialog.addEventListener('close',()=>{cropState?.bitmap.close();cropState=null;});
   const canvas=cropDialog.querySelector('canvas');let drag=null;canvas.onpointerdown=e=>{if(!cropState)return;const k=canvas.width/cropState.bitmap.width,r=canvas.getBoundingClientRect(),s=canvas.width/r.width;drag={x:(e.clientX-r.left)*s/k-cropState.rect.x,y:(e.clientY-r.top)*s/k-cropState.rect.y};canvas.setPointerCapture(e.pointerId);};
   canvas.onpointermove=e=>{if(!drag||!cropState)return;const {bitmap,rect}=cropState,k=canvas.width/bitmap.width,r=canvas.getBoundingClientRect(),s=canvas.width/r.width;rect.x=Math.max(0,Math.min(bitmap.width-rect.w,(e.clientX-r.left)*s/k-drag.x));rect.y=Math.max(0,Math.min(bitmap.height-rect.h,(e.clientY-r.top)*s/k-drag.y));drawCrop();};canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
   cropDialog.querySelector('input[type=range]').oninput=e=>{if(cropState)sizeCrop(Number(e.target.value));};
   cropDialog.querySelector('[data-apply]').onclick=async()=>{if(!cropState)return;const button=cropDialog.querySelector('[data-apply]'),say=cropDialog.querySelector('.dialog-message');button.disabled=true;say.textContent='잘라서 올리는 중…';
    try{const {bitmap,rect,file,source,targets}=cropState,scale=Math.min(1,3840/rect.w),c=document.createElement('canvas');c.width=Math.round(rect.w*scale);c.height=Math.round(rect.h*scale);c.getContext('2d').drawImage(bitmap,rect.x,rect.y,rect.w,rect.h,0,0,c.width,c.height);
     const jpeg=file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name),blob=await new Promise((ok,fail)=>c.toBlob(b=>b?ok(b):fail(new Error('자른 그림을 만들지 못했습니다.')),jpeg?'image/jpeg':'image/png',0.92));
     const item=await upload(blob,fileName(plain(source)).replace(/\.[^.]+$/,'')+' 자름',jpeg?'jpg':'png');YebaeonThumbnails.make(item.sha,blob).catch(()=>{});E.setBackground(item.source,targets);E.backgroundScale('fill',targets);cropDialog.close();E.status(`잘라 낸 배경을 ${targets.length}장에 씌웠습니다. 원본 그림은 그대로입니다.`);}
    catch(error){say.textContent=error.message;}finally{button.disabled=false;}};}
  const {width,height}=slideSize(),canvas=cropDialog.querySelector('canvas'),fit=Math.min(860/bitmap.width,460/bitmap.height);canvas.width=Math.max(1,Math.round(bitmap.width*fit));canvas.height=Math.max(1,Math.round(bitmap.height*fit));
  cropState={bitmap,file,source,targets,ratio:width/height,canvas,rect:{x:0,y:0,w:bitmap.width,h:bitmap.height}};cropDialog.querySelector('input[type=range]').value='100';sizeCrop(100);cropDialog.querySelector('.dialog-message').textContent=`원본 ${bitmap.width}×${bitmap.height} · 슬라이드 ${width}:${height} 비율로 자릅니다.`;cropDialog.showModal();}

 /* ---------- 모두 보기 창 ---------- */
 let dialog=null;
 function showAll(initial=''){if(!dialog){dialog=el('dialog','library-dialog media-all-dialog');dialog.id='mediaAllDialog';dialog.innerHTML='<div class="dialog-heading"><h2>그림 모두 보기</h2><button type="button" data-close>닫기</button></div><div class="media-all-bar"><div class="segmented"><button type="button" data-folder="All">전체</button><button type="button" data-folder="Images">Images</button><button type="button" data-folder="YebaeOn">웹에서 가져온 그림</button></div><input type="search" placeholder="파일명 검색" aria-label="그림 검색"></div><p class="dialog-help">누르면 고른 장(없으면 지금 장)에 배경으로 씌웁니다. ImportedImages는 보이지 않습니다.</p><div class="media-tiles media-all-grid"></div><p class="dialog-message" role="status"></p><button type="button" class="wide" data-more hidden>더 보기</button>';document.body.append(dialog);
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();let timer;dialog.querySelector('input').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),300);};
   dialog.querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>{dialog.dataset.folder=b.dataset.folder;load(true);});dialog.querySelector('[data-more]').onclick=()=>load(false);dialog.addEventListener('close',()=>fill());}
  dialog.dataset.folder='All';dialog.querySelector('input').value=initial;dialog.showModal();load(true);}
 let cursor=null,dialogToken=0;
 async function load(reset){const token=++dialogToken,folder=dialog.dataset.folder,q=dialog.querySelector('input').value.normalize('NFC').trim(),list=dialog.querySelector('.media-all-grid'),more=dialog.querySelector('[data-more]'),note=dialog.querySelector('.dialog-message');
  dialog.querySelectorAll('[data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder===folder));if(reset){cursor=null;list.replaceChildren();}note.textContent='불러오는 중…';more.hidden=true;
  try{await Favorites.load();const page=await(await C.api('/media/paths?'+new URLSearchParams({folder,sort:'updated',...q?{q}:{},...cursor?{after:cursor}:{}}))).json();if(token!==dialogToken)return;
   for(const p of page.paths)list.append(tile({sha:p.sha256,path:p.path,source:fileURL(p.path)},{dialog:true}));cursor=page.next;more.hidden=!cursor;note.textContent=list.children.length?`${list.children.length}개${cursor?' · 더 있음':''}`:'그림이 없습니다.';}
  catch(error){if(token===dialogToken)note.textContent=error.message;}}

 window.addEventListener('yebaeonfavorites',e=>{if(e.detail.kind!=='media')return;for(const star of document.querySelectorAll(`.media-star[data-sha="${e.detail.key}"]`)){star.classList.toggle('on',e.detail.on);star.textContent=e.detail.on?'★':'☆';}if(!$('mediaDrawer').hidden)fill();});
 window.YebaeonFavorites=Favorites;
 async function memberDocuments(){const out=[];for(const item of YebaeonPlaylists.items?.()||[]){const value=await memberXML(item);if(value&&!out.some(x=>x.id===value.id))out.push(value);}return out;}
 window.YebaeonMediaLibrary={fill,showAll,showAdd,crop,dragged:()=>drag,usedImages,memberDocuments};
})();
