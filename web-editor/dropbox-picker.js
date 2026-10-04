(function(){'use strict';
 // 가져오기 창에서 드롭박스 파일 하나를 고른다. 연결된 루트 안만 보이고, 마지막으로 연 폴더를 이 브라우저에 기억한다.
 const C=YebaeonCloud,KEY='yebaeon-dropbox-import-folder';
 const remembered=()=>{try{return localStorage.getItem(KEY)||'';}catch{return '';}};
 const remember=path=>{try{localStorage.setItem(KEY,path);}catch{ /* 기억하지 못해도 고르기는 된다 */ }};
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 const size=n=>n>=1048576?(n/1048576).toFixed(1)+'MB':Math.max(1,Math.round(n/1024))+'KB';
 // box: 비어 있는 요소. accept: 고를 수 있는 파일 이름. max: 바이트. onFile(File)이 끝날 때까지 다른 행동을 막는다.
 function attach(box,{accept,max,kind,onFile}){
  box.classList.add('dropbox-picker');box.hidden=true;
  const bar=el('div','bulletin-toolbar dropbox-toolbar'),up=el('button','','↑ 상위'),where=el('strong','dropbox-picker-path','교회 자료'),refresh=el('button','','새로고침'),close=el('button','','닫기');
  up.type=refresh.type=close.type='button';up.setAttribute('aria-label','상위 폴더');bar.append(up,where,refresh,close);
  const note=el('p','bulletin-message'),rows=el('div','bulletin-list'),more=el('button','dropbox-picker-more','더 보기');note.setAttribute('role','status');more.type='button';more.hidden=true;
  box.append(bar,note,rows,more);
  let path='',next=null,generation=0,busy=false;
  const lock=value=>{busy=value;box.setAttribute('aria-busy',String(value));for(const b of box.querySelectorAll('button'))b.disabled=value||b.dataset.tooBig==='1';if(!value)up.disabled=!path;};
  async function run(task){if(busy)return;lock(true);try{await task();}catch(e){note.textContent=e.message;}finally{lock(false);}}
  async function list(folder,append=false){const g=++generation;note.textContent='불러오는 중…';
   const data=await(await C.api('/dropbox/list?'+new URLSearchParams({path:folder,...append&&next?{cursor:next}:{}}))).json();if(g!==generation)return;
   path=folder;next=data.next;remember(path);where.textContent=path||'교회 자료';where.title=path||'교회 자료';if(!append)rows.replaceChildren();
   let shown=0;
   for(const item of data.entries){
    const folderItem=item.kind==='folder';if(!folderItem&&!accept.test(item.name))continue;shown++;
    const row=el('div','dropbox-row'),name=el('span','',folderItem?item.name+'/':item.name);row.append(name);
    if(folderItem){const b=el('button','','열기');b.type='button';b.onclick=()=>run(()=>list(item.path));row.append(b);}
    else{const info=el('small','dropbox-picker-size',size(item.size||0));row.append(info);const b=el('button','primary','가져오기');b.type='button';
     if(max&&item.size>max){b.dataset.tooBig='1';b.disabled=true;b.title=`${Math.floor(max/1048576)}MB 이하만 가져올 수 있습니다.`;}
     b.onclick=()=>run(async()=>{note.textContent=item.name+' 받는 중…';const r=await C.api('/dropbox/file?'+new URLSearchParams({path:item.path,...max?{max:String(max)}:{}}));const file=new File([await r.blob()],item.name.normalize('NFC'));note.textContent='';box.hidden=true;await onFile(file);});row.append(b);}
    rows.append(row);
   }
   if(!append&&!shown&&!next)rows.append(el('p','bulletin-message',`이 폴더에 ${kind} 파일이나 하위 폴더가 없습니다.`));
   more.hidden=!next;note.textContent=`${kind} 파일만 보입니다 · 드롭박스 원본은 바꾸지 않습니다.`;
  }
  async function show(){box.hidden=false;await run(async()=>{const config=await(await C.api('/dropbox/config')).json();if(!config.ready){rows.replaceChildren();note.textContent='관리자가 드롭박스를 최초 연결하면 사용할 수 있습니다. 그동안 파일을 직접 선택하세요.';return;}
   try{await list(remembered());}catch(e){if(!remembered())throw e;await list('');}});box.scrollIntoView?.({block:'nearest'});}
  up.onclick=()=>run(()=>list(path.split('/').slice(0,-1).join('/')));refresh.onclick=()=>run(()=>list(path));more.onclick=()=>run(()=>list(path,true));close.onclick=()=>{box.hidden=true;};
  return {show,hide:()=>{box.hidden=true;},toggle:()=>box.hidden?show():(box.hidden=true),busy:()=>busy};
 }
 window.YebaeonDropboxPicker={attach};
})();
