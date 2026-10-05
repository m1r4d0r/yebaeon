(function(){'use strict';
 // 미디어 서랍: ★ 공용 즐겨찾기 / 열린 재생목록이 배경으로 쓰는 그림(접힌 '사용된 전체 이미지') / 서버의 나머지 그림(모두 보기 창).
 // 그림 바이트는 sha 주소라 브라우저 캐시를 쓴다. 나머지 목록은 Images·YebaeOn 폴더만 쪽 단위로 받는다(ImportedImages는 받지 않음).
 const $=id=>document.getElementById(id),C=YebaeonCloud,E=YebaeonEditor,P=PP6,ROOT='/Users/Shared/Renewed Vision Media/';
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 const fileName=path=>String(path||'').split('/').pop();
 const plain=source=>{let value=String(source||'');if(value.startsWith('file:')){try{const url=new URL(value);if(!url.host)value=decodeURIComponent(url.pathname);}catch{}}return value.normalize('NFC');};
 const folderOf=path=>path.startsWith(ROOT)?path.slice(ROOT.length).split('/')[0]:'';
 const contentURL=sha=>'/api/media/'+sha+'/content';
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
 function tile(item,{dialog=false}={}){const b=el('div','media-tile'),pick=el('button','media-pick');pick.type='button';pick.title=item.path+(item.documents?'\n사용: '+[...item.documents].join(', '):'');pick.draggable=!dialog;
  if(item.sha){const img=el('img');img.src=contentURL(item.sha);img.alt='';img.loading='lazy';img.decoding='async';pick.append(img);}else pick.append(el('span','media-missing','서버에 없음'));
  pick.append(el('span','media-name',fileName(item.path)));pick.onclick=()=>{E.setBackground(item.source||item.path);if(dialog)E.status(`‘${fileName(item.path)}’을 배경으로 적용했습니다.`);};
  pick.ondragstart=e=>{drag={source:item.source||item.path,name:fileName(item.path)};e.dataTransfer.setData('text/plain',drag.source);e.dataTransfer.effectAllowed='copy';};pick.ondragend=()=>{drag=null;};b.append(pick);
  if(item.sha){const star=el('button','media-star'+(Favorites.has('media',item.sha)?' on':''),Favorites.has('media',item.sha)?'★':'☆');star.type='button';star.dataset.sha=item.sha;star.setAttribute('aria-label',(Favorites.has('media',item.sha)?'즐겨찾기에서 빼기':'즐겨찾기')+' · '+fileName(item.path));
   star.onclick=async e=>{e.stopPropagation();star.disabled=true;try{await Favorites.toggle('media',item.sha,item.path);}catch(error){E.status(error.message);}finally{star.disabled=false;}};b.append(star);}
  return b;}
 const grid=list=>{const g=el('div','media-tiles');for(const item of list)g.append(tile(item));return g;};
 const section=(title,count,body)=>{const s=el('section','media-section'),h=el('h3',null,title);if(count!=null)h.append(el('small',null,` ${count}`));s.append(h,body);return s;};
 const matches=(query,path)=>!query||fileName(path).normalize('NFC').toLowerCase().includes(query);

 async function fill(){const token=++generation,root=$('mediaGrid'),query=$('mediaQuery').value.normalize('NFC').trim().toLowerCase();root.replaceChildren(el('p','help','불러오는 중…'));
  try{await Favorites.load();if(token!==generation)return;const parts=[];
   const favs=Favorites.list('media').filter(f=>matches(query,f.label)).map(f=>({sha:f.key,path:f.label,source:f.label}));
   parts.push(section('★ 즐겨찾기',favs.length,favs.length?grid(favs):el('p','help','그림의 ☆를 누르면 모두가 보는 즐겨찾기에 들어갑니다.')));
   root.replaceChildren(...parts);
   const used=await usedImages();if(token!==generation)return;
   if(used){const shown=used.items.filter(x=>matches(query,x.path)),backgrounds=shown.filter(x=>x.background&&folderOf(x.path)!=='ImportedImages'),s=section(`배경으로 쓰는 그림 · ${used.playlist.name}`,backgrounds.length,backgrounds.length?grid(backgrounds):el('p','help','이 재생목록 문서에 배경 그림이 없습니다.'));
    if(shown.length){const more=el('details','media-all-used'),sum=el('summary',null,`사용된 전체 이미지 보기 (${shown.length}) · 가져온 이미지·광고·설교 그림 포함`);more.append(sum);more.addEventListener('toggle',()=>{if(more.open&&more.children.length===1)more.append(grid(shown));},{once:false});s.append(more);}
    parts.push(s);}else parts.push(section('배경으로 쓰는 그림',null,el('p','help','재생목록을 열면 그 순서의 문서가 쓰는 그림이 여기에 모입니다.')));
   const rest=section('나머지 그림',null,el('p','help','불러오는 중…'));parts.push(rest);root.replaceChildren(...parts);
   const page=await(await C.api('/media/paths?'+new URLSearchParams({folder:'Images',...query?{q:query}:{}}))).json();if(token!==generation)return;
   const items=page.paths.slice(0,12).map(p=>({sha:p.sha256,path:p.path,source:p.path})),open=el('button','media-more','모두 보기 ›');open.type='button';open.onclick=()=>showAll(query);
   rest.querySelector('h3').append(open);rest.lastChild.replaceWith(items.length?grid(items):el('p','help',query?'이 이름의 그림이 없습니다.':'서버에 그림이 없습니다.'));
  }catch(error){if(token===generation)root.replaceChildren(el('p','help bad',error.message));}}

 /* ---------- 모두 보기 창 ---------- */
 let dialog=null;
 function showAll(initial=''){if(!dialog){dialog=el('dialog','library-dialog media-all-dialog');dialog.id='mediaAllDialog';dialog.innerHTML='<div class="dialog-heading"><h2>그림 모두 보기</h2><button type="button" data-close>닫기</button></div><div class="media-all-bar"><div class="segmented"><button type="button" data-folder="Images">Images</button><button type="button" data-folder="YebaeOn">웹에서 가져온 그림</button></div><input type="search" placeholder="파일명 검색" aria-label="그림 검색"></div><p class="dialog-help">누르면 고른 장(없으면 지금 장)에 배경으로 씌웁니다. ImportedImages는 보이지 않습니다.</p><div class="media-tiles media-all-grid"></div><p class="dialog-message" role="status"></p><button type="button" class="wide" data-more hidden>더 보기</button>';document.body.append(dialog);
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();let timer;dialog.querySelector('input').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),300);};
   dialog.querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>{dialog.dataset.folder=b.dataset.folder;load(true);});dialog.querySelector('[data-more]').onclick=()=>load(false);dialog.addEventListener('close',()=>fill());}
  dialog.dataset.folder='Images';dialog.querySelector('input').value=initial;dialog.showModal();load(true);}
 let cursor=null,dialogToken=0;
 async function load(reset){const token=++dialogToken,folder=dialog.dataset.folder,q=dialog.querySelector('input').value.normalize('NFC').trim(),list=dialog.querySelector('.media-all-grid'),more=dialog.querySelector('[data-more]'),note=dialog.querySelector('.dialog-message');
  dialog.querySelectorAll('[data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder===folder));if(reset){cursor=null;list.replaceChildren();}note.textContent='불러오는 중…';more.hidden=true;
  try{await Favorites.load();const page=await(await C.api('/media/paths?'+new URLSearchParams({folder,...q?{q}:{},...cursor?{after:cursor}:{}}))).json();if(token!==dialogToken)return;
   for(const p of page.paths)list.append(tile({sha:p.sha256,path:p.path,source:p.path},{dialog:true}));cursor=page.next;more.hidden=!cursor;note.textContent=list.children.length?`${list.children.length}개${cursor?' · 더 있음':''}`:'그림이 없습니다.';}
  catch(error){if(token===dialogToken)note.textContent=error.message;}}

 window.addEventListener('yebaeonfavorites',e=>{if(e.detail.kind!=='media')return;for(const star of document.querySelectorAll(`.media-star[data-sha="${e.detail.key}"]`)){star.classList.toggle('on',e.detail.on);star.textContent=e.detail.on?'★':'☆';}if(!$('mediaDrawer').hidden)fill();});
 window.YebaeonFavorites=Favorites;
 async function memberDocuments(){const out=[];for(const item of YebaeonPlaylists.items?.()||[]){const value=await memberXML(item);if(value&&!out.some(x=>x.id===value.id))out.push(value);}return out;}
 window.YebaeonMediaLibrary={fill,showAll,dragged:()=>drag,usedImages,memberDocuments};
})();
