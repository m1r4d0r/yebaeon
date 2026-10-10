(function(){'use strict';
 const imageURL=item=>'/api/media/'+item.sha+'/content';
 const fileURL=path=>'file://'+path.split('/').map(p=>encodeURIComponent(p).replace(/'/g,'%27')).join('/');
 function image(item){const img=document.createElement('img');img.alt=item.name||'';img.src=YebaeonThumbnails.url(item.sha);img.onerror=()=>{img.onerror=null;img.src=imageURL(item);};return img;}
 function create(root,onChange){let selected=null,locked=false,loading=false,epoch=0;
  root.classList.add('import-background');const toolbar=document.createElement('div'),toggle=document.createElement('button'),chosen=document.createElement('span'),remove=document.createElement('button'),panel=document.createElement('div');toolbar.className='import-background-tools';toggle.type=remove.type='button';toggle.textContent='배경 추가';toggle.setAttribute('aria-expanded','false');chosen.className='import-background-chosen';remove.textContent='배경 제거';panel.className='import-background-list';panel.hidden=true;panel.setAttribute('aria-label','배경 즐겨찾기');panel.tabIndex=0;toolbar.append(toggle,chosen,remove);root.append(toolbar,panel);
  function sync(){chosen.replaceChildren();if(selected)chosen.append(image(selected));chosen.hidden=remove.hidden=!selected;toggle.disabled=remove.disabled=locked;for(const b of panel.querySelectorAll('button')){b.disabled=locked;b.setAttribute('aria-pressed',String(b.dataset.sha===selected?.sha));}}
  function set(item){selected=item?{...item}:null;sync();}
  async function show(){if(locked||loading)return;panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden)return;const token=++epoch;loading=true;panel.textContent='불러오는 중…';try{await YebaeonFavorites.load(true);if(token!==epoch)return;panel.replaceChildren();const items=YebaeonFavorites.list('media');for(const f of items){const item={sha:f.key,source:fileURL(f.label),name:f.label.split('/').pop()},b=document.createElement('button'),label=document.createElement('span');b.type='button';b.className='import-background-pick';b.dataset.sha=item.sha;b.title=item.name;b.setAttribute('aria-label','배경 선택 · '+item.name);label.textContent=item.name;b.append(image(item),label);b.onclick=()=>{if(locked)return;set(item);onChange(selected);};panel.append(b);}if(!items.length)panel.textContent='즐겨찾기에 등록된 배경이 없습니다.';sync();}catch(e){panel.textContent=e.message;}finally{loading=false;}}
  toggle.onclick=show;remove.onclick=()=>{if(locked)return;set(null);onChange(null);};sync();
  return {get:()=>selected,set,lock(value){locked=value;sync();},close(){epoch++;loading=false;panel.hidden=true;toggle.setAttribute('aria-expanded','false');}};
 }
 window.YebaeonImportBackground={create,imageURL};
})();
