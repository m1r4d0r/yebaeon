(function(){'use strict';
 // 가져오기 창의 배경 고르기: [배경 추가](즐겨찾기 한 줄), media를 켜면 [미디어에서 고르기…](미디어 그림 검색 창), 고른 그림, [배경 제거].
 const imageURL=item=>'/api/media/'+item.sha+'/content';
 const fileURL=path=>'file://'+path.split('/').map(p=>encodeURIComponent(p).replace(/'/g,'%27')).join('/');
 const IMAGE=/\.(png|jpe?g|gif|bmp|tiff?|webp|heic)$/i;
 function image(item){const img=document.createElement('img');img.alt=item.name||'';img.src=YebaeonThumbnails.url(item.sha);img.onerror=()=>{img.onerror=null;img.src=imageURL(item);};return img;}
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 // 미디어 그림 고르기 창: 열 때와 검색할 때 미디어 목록을 한 번씩 묻는다(최근 바뀐 순, 그림만 60개까지).
 function mediaPicker(title,onPick){
  const box=el('dialog','library-dialog panel-dialog import-media-pick'),head=el('div','panel-head'),close=el('button','panel-close');close.type='button';close.setAttribute('aria-label','닫기');close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';close.onclick=()=>box.close();
  head.append(el('h2',null,title),el('span','panel-gap'),close);
  const tools=el('div','songbook-tools'),input=el('input'),go=el('button',null,'검색');input.type='search';input.placeholder='그림 이름';input.setAttribute('aria-label','그림 찾기');go.type='button';tools.append(input,go);
  const grid=el('div','panel-body import-media-grid'),foot=el('div','import-media-foot'),note=el('span','import-media-note',''),cancel=el('button',null,'취소'),ok=el('button','primary','고르기');cancel.type=ok.type='button';ok.disabled=true;foot.append(note,cancel,ok);
  let chosen=null,generation=0;
  async function load(){const g=++generation,q=input.value.trim();grid.replaceChildren(el('p','help','불러오는 중…'));chosen=null;ok.disabled=true;
   try{const page=await(await YebaeonCloud.api('/media/paths?'+new URLSearchParams({folder:'All',sort:'updated',...q?{q}:{}}))).json();if(g!==generation)return;
    const items=page.paths.filter(p=>IMAGE.test(p.path)).slice(0,60).map(p=>({sha:p.sha256,source:fileURL(p.path),name:p.path.split('/').pop()}));
    grid.replaceChildren(...items.map(item=>{const b=el('button','import-media-item');b.type='button';b.title=item.name;b.append(image(item),el('span',null,item.name));b.onclick=()=>{chosen=item;ok.disabled=false;for(const x of grid.children)x.setAttribute('aria-pressed',String(x===b));};b.ondblclick=()=>{chosen=item;ok.click();};return b;}));
    if(!items.length)grid.append(el('p','help',q?'이 이름의 그림이 없습니다.':'미디어에 그림이 없습니다.'));note.textContent=items.length>=60?'최근 바뀐 60개 · 이름으로 찾아 좁혀 주세요':'미디어의 그림 · 최근 바뀐 순';}
   catch(e){if(g===generation)grid.replaceChildren(el('p','help bad',e.message));}}
  go.onclick=load;input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();load();}});
  cancel.onclick=()=>box.close();ok.onclick=()=>{if(!chosen)return;const item=chosen;box.close();onPick(item);};
  box.append(head,tools,grid,foot);box.addEventListener('close',()=>{generation++;box.remove();});document.body.append(box);box.showModal();input.focus();load();}
 function create(root,onChange,{media=false,title='배경 고르기'}={}){let selected=null,locked=false,loading=false,epoch=0;
  root.classList.add('import-background');const toolbar=document.createElement('div'),label=el('span','import-background-label'),toggle=document.createElement('button'),fromMedia=el('button',null,'미디어에서 고르기…'),chosen=document.createElement('span'),remove=document.createElement('button'),panel=document.createElement('div');toolbar.className='import-background-tools';toggle.type=remove.type=fromMedia.type='button';toggle.textContent='배경 추가';toggle.setAttribute('aria-expanded','false');chosen.className='import-background-chosen';remove.textContent='배경 제거';panel.className='import-background-list';panel.hidden=true;panel.setAttribute('aria-label','배경 즐겨찾기');panel.tabIndex=0;label.hidden=true;fromMedia.hidden=!media;toolbar.append(label,toggle,fromMedia,chosen,remove);root.append(toolbar,panel);
  function sync(){chosen.replaceChildren();if(selected)chosen.append(image(selected));chosen.title=selected?.name||'';chosen.hidden=remove.hidden=!selected;toggle.disabled=fromMedia.disabled=remove.disabled=locked;for(const b of panel.querySelectorAll('button')){b.disabled=locked;b.setAttribute('aria-pressed',String(b.dataset.sha===selected?.sha));}}
  function set(item){selected=item?{...item}:null;sync();}
  async function show(){if(locked||loading)return;panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden)return;const token=++epoch;loading=true;panel.textContent='불러오는 중…';try{await YebaeonFavorites.load(true);if(token!==epoch)return;panel.replaceChildren();const items=YebaeonFavorites.list('media');for(const f of items){const item={sha:f.key,source:fileURL(f.label),name:f.label.split('/').pop()},b=document.createElement('button'),label=document.createElement('span');b.type='button';b.className='import-background-pick';b.dataset.sha=item.sha;b.title=item.name;b.setAttribute('aria-label','배경 선택 · '+item.name);label.textContent=item.name;b.append(image(item),label);b.onclick=()=>{if(locked)return;set(item);onChange(selected);};panel.append(b);}if(!items.length)panel.textContent='즐겨찾기에 등록된 배경이 없습니다.';sync();}catch(e){panel.textContent=e.message;}finally{loading=false;}}
  toggle.onclick=show;remove.onclick=()=>{if(locked)return;set(null);onChange(null);};
  fromMedia.onclick=()=>{if(locked)return;mediaPicker(title,item=>{if(locked)return;set(item);onChange(selected);});};sync();
  return {get:()=>selected,set,lock(value){locked=value;sync();},close(){epoch++;loading=false;panel.hidden=true;toggle.setAttribute('aria-expanded','false');},
   // 머리말(예: '첫 장 배경'). 빈 글이면 숨긴다.
   label(text){label.textContent=text||'';label.hidden=!text;}};
 }
 window.YebaeonImportBackground={create,imageURL};
})();
