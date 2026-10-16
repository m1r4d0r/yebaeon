(function(){'use strict';
 // 문서 편집의 [이미지 추가]: 내 컴퓨터 그림으로 그 장의 앞 그림을 바꾸거나 새 그림 장을 넣는다. 배경(backgroundMediaCue)은 건드리지 않는다.
 // 파일 이름(확장자와 끝의 -alpha를 뺀 값, NFC)이 장의 지금 그림 이름과 같으면 그 장을 바꾸고, 짝이 없는 파일은 지금 장 뒤에 새 장으로 넣는다.
 // 파일을 고르고 확인 창을 보는 동안에는 서버에 묻지 않는다. [적용] 때 존재 조회 1회 → 없는 것만 원본 그대로 올리기 → 경로 정하기 1회.
 // 경로는 서버가 정한다: 원래 그림 옆(ImportedImages 안일 때), 아니면 ImportedImages/<문서이름>/. 미디어 서랍에는 나오지 않는다.
 const $=id=>document.getElementById(id),C=YebaeonCloud,E=YebaeonEditor,P=PP6;
 const IMAGE=/\.(png|jpe?g|webp|gif|bmp)$/i,TYPE=/^image\/(png|jpeg|webp|gif|bmp)$/,MAX=20*1024*1024;
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 const plain=source=>{let value=String(source||'');if(value.startsWith('file:')){try{const url=new URL(value);if(!url.host)value=decodeURIComponent(url.pathname);}catch{}}return value.normalize('NFC');};
 const fileName=path=>String(path||'').split('/').pop();
 const stem=name=>String(name||'').normalize('NFC').replace(/\.[^.]+$/,'');
 const fileKey=name=>stem(name).replace(/-alpha$/i,'');
 const fileURL=path=>'file://'+path.split('/').map(p=>encodeURIComponent(p).replace(/'/g,'%27')).join('/');
 const digestOf=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const byName=(a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true});
 const pages=list=>list.map(i=>i+1).join('·')+'장';

 const input=el('input');input.type='file';input.multiple=true;input.accept='image/png,image/jpeg,image/webp,image/gif,image/bmp';input.hidden=true;input.id='imageAddInput';document.body.append(input);
 let dialog=null,plan=null,busy=false;

 // 각 장의 앞 그림. 그림이 없는 장은 짝짓기에서 빠진다.
 function slideImages(){return P.slides(E.model()).map((slide,index)=>{const element=E.contentImage(slide),path=element?plain(P.attr(element,'source')):'';return {index,element,path,name:fileName(path),key:fileKey(fileName(path))};});}
 async function readFiles(files){const out=[],bad=[];for(const file of files){try{
   if(!IMAGE.test(file.name)&&!TYPE.test(file.type))throw new Error('PNG·JPG·WebP·GIF·BMP 그림을 골라 주세요.');if(file.size>MAX)throw new Error('그림은 20MB 이하로 골라 주세요.');
   const bitmap=await createImageBitmap(file).catch(()=>null);if(!bitmap)throw new Error('브라우저가 이 그림을 열지 못했습니다.');bitmap.close();
   const name=IMAGE.test(file.name)?file.name.normalize('NFC'):file.name.normalize('NFC')+'.'+(({'image/jpeg':'jpg'})[file.type]||file.type.split('/')[1]);
   out.push({file,name,sha256:await digestOf(await file.arrayBuffer())});}catch(error){bad.push({name:file.name,reason:error.message});}}
  return {files:out.sort(byName),bad};}
 // 기본 결정: 이름 짝이 있으면 그 장(같은 그림을 쓰는 장 모두) 바꾸기, 없으면 새 장.
 function makePlan({files,bad}){const images=slideImages(),current=E.selected(),chosen=E.selection.values().map(Number);
  const rows=files.map(f=>{const matched=images.filter(i=>i.element&&i.key&&i.key===fileKey(f.name)).map(i=>i.index);return {...f,matched,action:matched.length?'replace':'add'};}).sort((a,b)=>(a.matched.length?a.matched[0]:Infinity)-(b.matched.length?b.matched[0]:Infinity)||byName(a,b));
  // 파일이 하나면 이름이 달라도 지금 장(고른 장이 하나일 때) 그림을 바꾸는 쪽을 고를 수 있다.
  const single=rows.length===1&&!rows[0].matched.length&&chosen.length<=1&&images[current]?.element?current:null;
  const used=new Set(rows.flatMap(r=>r.matched)),untouched=chosen.length>1?chosen.filter(i=>images[i]?.element&&!used.has(i)):[];
  return {key:E.state().key,serial:E.state().serial,name:E.model().name,images,current,single,rows,bad,untouched};}

 function targets(row){return row.action==='replace'?row.matched:row.action==='current'?[plan.single]:[];}
 function render(){const list=dialog.querySelector('.image-add-list');list.replaceChildren();
  for(const row of plan.rows){const line=el('div','image-add-row'+(row.action==='skip'?' skipped':'')),text=el('span','image-add-text'),pick=el('select');pick.setAttribute('aria-label',row.name+' 처리');
   if(row.matched.length)pick.add(new Option(pages(row.matched)+' 그림 바꾸기','replace'));
   if(plan.single!=null)pick.add(new Option('지금 장('+(plan.single+1)+'장) 그림 바꾸기','current'));
   pick.add(new Option('새 장으로 추가','add'));pick.add(new Option('넣지 않음','skip'));pick.value=row.action;pick.onchange=()=>{row.action=pick.value;render();};
   const where=targets(row);text.textContent=row.action==='skip'?`${row.name} · 넣지 않음`:where.length?where.map(i=>`${i+1}장: ${plan.images[i].name} → ${row.name}`).join('\n'):`새 장 (${plan.current+1}장 뒤): ${row.name}`;
   line.append(text,pick);list.append(line);}
  for(const i of plan.untouched)if(!plan.rows.some(r=>targets(r).includes(i)))list.append(el('div','image-add-row skipped',`${i+1}장: ${plan.images[i].name} · 바꾸지 않음`));
  for(const b of plan.bad)list.append(el('div','image-add-row skipped bad',`${b.name} · 넣지 않음 (${b.reason})`));
  const replace=plan.rows.filter(r=>['replace','current'].includes(r.action)).length,add=plan.rows.filter(r=>r.action==='add').length,apply=dialog.querySelector('[data-apply]');
  apply.textContent=replace&&add?'바꾸기·추가':add?'추가':'바꾸기';apply.disabled=busy||!(replace+add);}
 function ensureDialog(){if(dialog)return;dialog=el('dialog','library-dialog image-add-dialog');dialog.id='imageAddDialog';
  dialog.innerHTML='<div class="dialog-heading"><h2>이미지 추가</h2><button type="button" data-close>닫기</button></div><p class="dialog-help">파일 이름(끝의 -alpha 제외)이 장의 지금 그림과 같으면 그 장의 그림을 바꾸고, 나머지는 지금 장 뒤에 새 장으로 넣습니다. 배경은 그대로입니다. 그림은 원본 그대로 올라가며 미디어 서랍에는 보이지 않습니다. 문서는 [서버에 저장]해야 반영됩니다.</p><div class="image-add-list"></div><p class="dialog-message" role="status"></p><div class="dialog-buttons"><button type="button" data-cancel>취소</button><button type="button" class="primary" data-apply>바꾸기</button></div>';
  document.body.append(dialog);dialog.querySelector('[data-close]').onclick=dialog.querySelector('[data-cancel]').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.querySelector('[data-apply]').onclick=()=>apply().catch(error=>{say(error.message);});dialog.addEventListener('close',()=>{plan=null;});}
 const say=text=>{dialog.querySelector('.dialog-message').textContent=text;};
 function lock(value){busy=value;for(const b of dialog.querySelectorAll('button,select'))b.disabled=value;if(!value)render();}

 async function apply(){if(busy||!plan)return;const state=E.state();if(state.key!==plan.key||state.serial!==plan.serial)throw new Error('창을 연 뒤 문서가 바뀌었습니다. 닫고 다시 골라 주세요.');
  const chosen=plan.rows.filter(r=>r.action!=='skip');if(!chosen.length)return;lock(true);
  try{const hashes=[...new Set(chosen.map(r=>r.sha256))],known=new Set();
   for(let i=0;i<hashes.length;i+=100){const q=new URLSearchParams();hashes.slice(i,i+100).forEach(h=>q.append('hash',h));for(const a of (await(await C.api('/media?'+q)).json()).assets)known.add(a.sha256);}
   const missing=chosen.filter((r,i)=>!known.has(r.sha256)&&chosen.findIndex(x=>x.sha256===r.sha256)===i);
   for(const [n,r] of missing.entries()){say(`서버에 올리는 중 ${n+1}/${missing.length} · ${r.name}`);await C.api('/media/'+r.sha256+'/content',{method:'PUT',headers:{'Content-Type':r.file.type||'application/octet-stream','X-Yebaeon-SHA256':r.sha256},body:r.file});}
   say('교회 Mac 경로를 정하는 중…');
   // 바꾸기는 장마다 원래 그림 옆에 둔다(같은 그림을 쓰는 장은 같은 경로).
   const asks=[];for(const r of chosen){const where=targets(r);if(where.length)for(const i of where)asks.push({row:r,index:i,beside:plan.images[i].path});else asks.push({row:r,index:null,beside:''});}
   const body=JSON.stringify({document:plan.name,items:asks.map(a=>({sha256:a.row.sha256,name:a.row.name,...a.beside?{beside:a.beside}:{}}))});let result;
   for(let attempt=0;;attempt++){try{result=await(await C.api('/media/paths',{method:'POST',headers:{'Content-Type':'application/json'},body})).json();break;}catch(e){if(e.code!=='media_path_busy'||attempt>=2)throw e;}}
   asks.forEach((a,i)=>{a.path=result.paths[i].path;window.YebaeonResources?.prime(a.path,a.row.file);});
   const now=E.state();if(now.key!==plan.key||now.serial!==plan.serial)throw new Error('올리는 동안 문서가 바뀌었습니다. 그림은 서버에 있으니 다시 골라 주세요.');
   E.placeImages({replace:asks.filter(a=>a.index!=null).map(a=>({index:a.index,source:fileURL(a.path)})),add:asks.filter(a=>a.index==null).map(a=>fileURL(a.path)),after:plan.current});
   busy=false;dialog.close();}
  finally{if(busy)lock(false);}}

 async function choose(files){if(!files.length)return;if(!E.ready()){E.status('문서를 연 뒤 이미지를 추가하세요.');return;}
  const read=await readFiles(files);if(!read.files.length){E.status(read.bad.map(b=>`${b.name}: ${b.reason}`).join(' · '));return;}
  ensureDialog();plan=makePlan(read);say(read.bad.length?`넣지 못하는 파일 ${read.bad.length}개는 건너뜁니다.`:'');lock(false);dialog.showModal();}
 function start(){if(busy||!E.ready()||!C.needUser())return;input.value='';input.click();}
 input.onchange=()=>{const files=[...input.files];input.value='';choose(files).catch(error=>E.status(error.message));};
 $('imageAdd').onclick=start;
 window.YebaeonImageAdd={start,choose};
})();
