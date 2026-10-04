(function(){'use strict';
 // 가져오기 창에서 드롭박스 파일 하나를 고른다. 연결된 루트 안만 보이고, 마지막으로 연 폴더를 이 브라우저에 기억한다.
 const C=YebaeonCloud,KEY='yebaeon-dropbox-import-folder';
 const remembered=()=>{try{return localStorage.getItem(KEY)||'';}catch{return '';}};
 const remember=path=>{try{localStorage.setItem(KEY,path);}catch{ /* 기억하지 못해도 고르기는 된다 */ }};
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 // 폴더·파일 종류 아이콘. 파일은 확장자별 색과 짧은 표시를 붙인다.
 const kinds=[[/\.pdf$/i,'PDF','#c8402f'],[/\.(pptx?|key)$/i,'PPT','#d2691e'],[/\.hwpx?$/i,'HWP','#2f7fd1'],[/\.(docx?|txt|rtf)$/i,'DOC','#3d5bc9'],[/\.(xlsx?|csv)$/i,'XLS','#2f8f4e'],[/\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i,'IMG','#8a4fc9'],[/\.(mp4|mov|m4v|avi|mp3|wav|m4a)$/i,'MED','#b03a7a'],[/\.(zip|7z|rar)$/i,'ZIP','#6b7380'],[/\.pro6(pl)?$/i,'PP6','#d4a017']];
 function icon(name,folder){const box=document.createElement('i');box.className='dropbox-icon';box.setAttribute('aria-hidden','true');
  if(folder){box.innerHTML='<svg viewBox="0 0 32 32" width="28" height="28"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h7l3 3h11A2.5 2.5 0 0 1 29 11.5v13A2.5 2.5 0 0 1 26.5 27h-21A2.5 2.5 0 0 1 3 24.5z" fill="#f2b84b"/><path d="M3 12h26v12.5a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24.5z" fill="#f7cd6b"/></svg>';return box;}
  const [,label,color]=kinds.find(([re])=>re.test(name))||[null,'',' #8792a3'.trim()];
  box.innerHTML=`<svg viewBox="0 0 32 32" width="28" height="28"><path d="M7 3h13l7 7v17.5A1.5 1.5 0 0 1 25.5 29h-18A1.5 1.5 0 0 1 6 27.5v-23A1.5 1.5 0 0 1 7.5 3z" fill="#fff" stroke="#c9d1dd"/><path d="M20 3v5.5A1.5 1.5 0 0 0 21.5 10H27" fill="#eef1f6" stroke="#c9d1dd"/><rect x="3" y="16" width="20" height="9" rx="2" fill="${color}"/><text x="13" y="22.6" text-anchor="middle" font-size="6.6" font-weight="700" font-family="system-ui,sans-serif" fill="#fff">${label}</text></svg>`;return box;}
 const size=n=>n>=1048576?(n/1048576).toFixed(1)+'MB':Math.max(1,Math.round(n/1024))+'KB';
 // box: 비어 있는 요소. accept: 고를 수 있는 파일 이름. max: 바이트, 또는 파일 이름을 받아 바이트를 돌려주는 함수. onFile(File)이 끝날 때까지 다른 행동을 막는다.
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
    const row=el('div','dropbox-row'+(folderItem?' is-folder':'')),name=el('span','',item.name);row.append(icon(item.name,folderItem),name);
    if(folderItem){const b=el('button','','열기');b.type='button';const open=()=>run(()=>list(item.path));b.onclick=e=>{e.stopPropagation();open();};row.onclick=()=>{if(!busy)open();};row.append(b);}
    else{const info=el('small','dropbox-picker-size',size(item.size||0));row.append(info);const b=el('button','primary','가져오기');b.type='button';
     const limit=typeof max==='function'?max(item.name):max;if(limit&&item.size>limit){b.dataset.tooBig='1';b.disabled=true;b.title=`${Math.floor(limit/1048576)}MB 이하만 가져올 수 있습니다.`;}
     b.onclick=()=>run(async()=>{note.textContent=item.name+' 받는 중…';const r=await C.api('/dropbox/file?'+new URLSearchParams({path:item.path,...limit?{max:String(limit)}:{}}));const file=new File([await r.blob()],item.name.normalize('NFC'));note.textContent='';box.hidden=true;await onFile(file);});row.append(b);}
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
 // 가져오기 창 공통 시작 줄: [파일 추가] [드롭박스에서 가져오기]와 고른 파일 이름, 그 아래 드롭박스 목록.
 function start(box,{accept,inputAccept,max,kind,onFile}){
  box.classList.add('file-start');const row=el('div','file-start-row'),add=el('label','file-start-add'),input=document.createElement('input'),drop=el('button','file-start-dropbox','드롭박스에서 가져오기'),name=el('span','file-start-name'),panel=el('div');
  add.append(document.createTextNode('파일 추가'),input);input.type='file';input.accept=inputAccept;drop.type='button';row.append(add,drop,name);box.append(row,panel);
  const picker=attach(panel,{accept,max,kind,onFile:file=>{name.textContent=file.name;return onFile(file);}});
  input.onchange=()=>{const file=input.files[0];input.value='';if(!file)return;picker.hide();name.textContent=file.name;onFile(file);};drop.onclick=()=>picker.toggle();
  return {input,picker,setName:text=>{name.textContent=text||'';},setDisabled(value){input.disabled=drop.disabled=value;add.classList.toggle('disabled',value);}};
 }
 window.YebaeonDropboxPicker={attach,icon,start};
})();
