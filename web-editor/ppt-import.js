(function(){'use strict';
 // PPT·PDF 가져오기. 넣을 곳과 변환 방식을 고르고 결과를 검수한다.
 // 새 문서의 카테고리가 악보찬양이면 PPT에서 악보 그림을 배경과 나눠 투명하게 가져오고, 나눌 수 없는 장은 장 전체를 그림 한 장으로 가져온다.
 // 나눈 배경 그림(단색이 아닌 것)은 문서에 넣지 않고 미디어 `YebaeOn/<문서이름> 배경-<n>.png`로 따로 올린다.
 // 선택한 재생목록에 넣으면 그 순서도 바로 서버에 저장한다.
 const $=id=>document.getElementById(id),C=YebaeonCloud,P=PP6,E=YebaeonEditor,L=YebaeonPlaylists;
 const SCORE='악보찬양',PPT_MAX=40*1024*1024,PDF_MAX=60*1024*1024,IMAGE_MAX=180*1024*1024;
 // 기존 문서 교체의 첫 후보. 다른 문서는 작은 검색으로 고른다. 파일 종류로 넣을 곳을 짐작하지 않는다.
 // 이름이 둘 중 하나일 수 있는 후보는 앞의 이름부터 찾는다.
 const CANDIDATES=[{label:'주일예배말씀 목사님 ppt',names:['주일예배말씀 목사님 ppt','주일예배말씀 ppt']},{label:'광고',names:['광고']}];
 const FALLBACK_CATEGORIES=['가사찬양','악보찬양','예배순서','특별순서','옛날자료'];
 const dialog=document.createElement('dialog');dialog.id='pptDialog';dialog.className='ppt-dialog studio-import-dialog';dialog.setAttribute('aria-labelledby','pptHeading');
 dialog.innerHTML=`<header><strong id="pptHeading">PPT·PDF 가져오기</strong><button id="pptClose" class="import-close" aria-label="PPT·PDF 가져오기 닫기" title="닫기">×</button></header>
 <div id="pptPurpose" class="ppt-purpose" role="group" aria-label="자료 용도"><button type="button" data-purpose="score" aria-pressed="false">악보</button><button type="button" data-purpose="sermon" aria-pressed="false">설교·광고</button><button type="button" data-purpose="other" aria-pressed="true">기타</button></div>
 <div id="pptStart" class="import-start"></div><div id="pptBody" class="ppt-body"><p id="pptStartHelp" class="ppt-help">PPT(.ppt·.pptx, 40MB·120장)나 PDF(60MB·120쪽)를 고르세요. 변환은 이 브라우저에서 하며 원본 파일은 서버에 저장하지 않습니다.</p>
 <div id="pptRecovery" hidden><strong>완료하지 못한 가져오기가 있습니다.</strong><div class="ppt-recovery-actions"><button id="pptResume">저장 다시 시도</button><button id="pptDiscard">준비본 버리기</button></div><div id="pptRename" hidden><p>같은 이름의 기존 문서는 유지합니다. 변환한 이미지를 그대로 새 문서에 저장할 수 있어요.</p><div class="ppt-recovery-actions"><label>새 문서 이름 <input id="pptRecoveryName" maxlength="145"></label><button id="pptRenameSave">이 이름으로 저장</button></div></div></div>
 <fieldset id="pptOptions" hidden><legend>가져오기 설정</legend>
  <div class="ppt-controls ppt-field"><label for="pptTarget">넣을 곳</label><select id="pptTarget"><option value="new">새 문서로 추가</option><option value="replace">기존 문서의 슬라이드 교체</option></select></div>
  <div id="pptNewOptions" class="ppt-controls ppt-name-controls"><label>문서 이름 <input id="pptName" maxlength="145"></label><label class="ppt-category">카테고리 <select id="pptCategory"><option value="">고르세요</option></select></label></div>
  <div id="pptReplaceOptions" hidden><div id="pptCandidates" class="ppt-candidates" role="group" aria-label="교체할 문서"></div><div id="pptSearch" hidden></div></div><p id="pptTargetInfo" class="ppt-help"></p>
  <div id="pptConversionOptions" class="ppt-controls ppt-field" hidden><label for="pptConversion">가져오기 방식</label><select id="pptConversion"><option value="full">전체 슬라이드 이미지</option><option value="auto">악보와 배경 분리</option><option value="white">흰 바탕을 투명하게 · 악보 분리</option></select><p id="pptConversionHelp" class="ppt-help"></p></div>
  <div id="pptScoreOptions" class="ppt-controls" hidden><label class="ppt-switch"><input id="pptCropOn" type="checkbox" role="switch" checked> 2장부터 제목 자르기</label><label id="pptCropAmount">위에서 <input id="pptCrop" type="number" min="0" max="40" step="0.1" value="16.7"> %</label></div>
 </fieldset>
 <p id="pptMessage" class="ppt-message" role="status"></p><div id="pptSlides" class="ppt-slides"></div><div id="pptLarge" class="ppt-large" hidden><button id="pptLargeClose">확대 닫기</button><div id="pptLargeImage"></div></div></div>
 <footer id="pptFooter" class="import-actions"><div class="ppt-checks"><label id="pptAppendLabel"><input id="pptAppend" type="checkbox"> 선택한 재생목록 맨 아래에도 추가</label><label><input id="pptReviewed" type="checkbox" disabled> 모든 장의 변환 결과를 확인했어요</label></div><button id="pptSave" class="primary" disabled>검수 완료 · 문서 추가</button></footer>`;
 document.body.append(dialog);const open=document.createElement('button');open.id='pptOpen';open.className='studio-tool';open.title='PPT·PDF 가져오기';open.setAttribute('aria-label','PPT·PDF 가져오기');open.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="m10 8 4 2-4 2z"/></svg><span>PPT·PDF 가져오기</span>';if($('studioGlobalTools'))$('studioGlobalTools').append(open);else $('bulletinOpen').before(open);
 let source=null,outputs=[],backdrops=new Map(),prepared=null,target=null,busy=false,uploading=false,renderEpoch=0,urls=[],size={width:1920,height:1080};
 let purpose='other',pendingFile=null,pendingTarget=null;
 let pptEngine=null,pdfEngine=null,previewTimer=null,previewQueued=false,rendering=false;
 const message=t=>$('pptMessage').textContent=t,mode=()=>$('pptTarget').value;
 // 한 가지 색으로만 칠한 배경은 미디어에 올리지 않는다(단색은 미디어 › 그림 추가에서 바로 만든다).
 async function plain(blob){const bitmap=await createImageBitmap(blob);try{const c=document.createElement('canvas');c.width=48;c.height=27;const x=c.getContext('2d');x.drawImage(bitmap,0,0,48,27);const d=x.getImageData(0,0,48,27).data;for(let i=4;i<d.length;i+=4)if(Math.abs(d[i]-d[0])>6||Math.abs(d[i+1]-d[1])>6||Math.abs(d[i+2]-d[2])>6||Math.abs(d[i+3]-d[3])>6)return false;return true;}finally{bitmap.close();}}
 const scoreMode=()=>source?.kind==='ppt'&&$('pptConversion').value!=='full';
 const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
 function script(src,name,get,set){if(window[name])return Promise.resolve(window[name]);return get()??set(new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=()=>resolve(window[name]);s.onerror=()=>{s.remove();set(null);reject(Error('변환기를 불러오지 못했습니다. 다시 시도해 주세요.'));};document.head.append(s);}));}
 const engine=()=>script('/ppt-engine.js','YebaeonPPTEngine',()=>pptEngine,v=>pptEngine=v),pdf=()=>script('/pdf-engine.js','YebaeonPDFEngine',()=>pdfEngine,v=>pdfEngine=v);
 const start=YebaeonDropboxPicker.start($('pptStart'),{accept:/\.(pptx?|pdf)$/i,inputAccept:'.ppt,.pptx,.pdf,application/pdf',max:name=>/\.pdf$/i.test(name)?PDF_MAX:PPT_MAX,kind:'PPT·PDF',onFile:file=>read(file)});start.input.id='pptFile';
 function lock(value){busy=value;dialog.setAttribute('aria-busy',String(value));$('pptClose').disabled=uploading;start.setDisabled(value||!!prepared);for(const b of $('pptPurpose').querySelectorAll('button'))b.disabled=(value&&!rendering)||!!prepared;$('pptOptions').disabled=(value&&!rendering)||!!prepared;
  for(const id of ['pptResume','pptDiscard','pptRenameSave','pptRecoveryName'])$(id).disabled=value;
  const ready=outputs.length&&(mode()==='replace'?!!target:!!$('pptCategory').value);$('pptReviewed').disabled=value||!outputs.length;$('pptSave').disabled=value||!ready||!$('pptReviewed').checked;
  for(const b of $('pptCandidates').querySelectorAll('button'))b.disabled=value;
  for(const el of $('pptSlides').querySelectorAll('input,select'))el.disabled=value&&!rendering;}
 function invalidate(schedule=true){renderEpoch++;outputs=[];backdrops=new Map();for(const u of urls)URL.revokeObjectURL(u);urls=[];$('pptReviewed').checked=false;$('pptLarge').hidden=true;for(const t of $('pptSlides').querySelectorAll('.ppt-thumb'))t.textContent='미리보기 준비 중…';lock(busy);if(schedule)requestPreview();}
 function drainPreview(){if(pendingFile){const f=pendingFile;pendingFile=null;pendingTarget=null;read(f);}else if(pendingTarget){const names=pendingTarget;pendingTarget=null;choose(names);}else if(previewQueued)requestPreview();}
 function requestPreview(){clearTimeout(previewTimer);previewQueued=true;previewTimer=setTimeout(()=>{if(busy||prepared||!source||!dialog.open)return;previewQueued=false;preview();},180);}
 const requestResult=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 async function recovery(action,value){const request=indexedDB.open('yebaeon-ppt-import',1);request.onupgradeneeded=()=>request.result.createObjectStore('jobs');const db=await requestResult(request);try{return await new Promise((resolve,reject)=>{const tx=db.transaction('jobs',action==='get'?'readonly':'readwrite'),jobs=tx.objectStore('jobs'),key=C.worker(),r=action==='put'?jobs.put(value,key):action==='delete'?jobs.delete(key):jobs.get(key);let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('준비본 보존 실패'));});}finally{db.close();}}
 function showRecovery(){dialog.classList.toggle('ppt-has-recovery',!!prepared);$('pptRecovery').hidden=!prepared;$('pptRename').hidden=!prepared?.pathConflict;$('pptResume').hidden=!!prepared?.pathConflict;$('pptResume').classList.toggle('primary',!!prepared&&!prepared.pathConflict);$('pptRenameSave').classList.toggle('primary',!!prepared?.pathConflict);if(prepared?.pathConflict)$('pptRecoveryName').value=prepared.path.replace(/\.pro6$/i,'').slice(0,139)+' (PPT)';}
 async function categories(){const select=$('pptCategory'),current=select.value;let names=FALLBACK_CATEGORIES;try{names=(await(await C.api('/categories')).json()).categories.map(c=>c.name);}catch{ /* 기본 목록으로 고른다 */ }
  select.replaceChildren(new Option('고르세요',''));for(const name of names)select.add(new Option(name,name));if(names.includes(current))select.value=current;else select.value=purpose==='score'?SCORE:'예배순서';}
 async function openDialog(){if(!C.needUser()||busy)return;dialog.showModal();const selected=L.selectedPlaylist();$('pptAppend').disabled=!selected?.editable;$('pptAppend').checked=!!selected?.editable;categories().then(()=>lock(busy));try{prepared=await recovery('get')||prepared;showRecovery();lock(false);if(previewQueued)requestPreview();}catch(e){message('중단 복구 저장소를 열지 못했습니다: '+e.message);}}
 open.onclick=openDialog;$('pptClose').onclick=()=>{if(!uploading&&!busy){renderEpoch++;dialog.close();}};dialog.addEventListener('cancel',e=>{if(uploading||busy)e.preventDefault();else renderEpoch++;});
 function options(){const replace=mode()==='replace';$('pptOptions').hidden=!source;$('pptNewOptions').hidden=replace;$('pptReplaceOptions').hidden=!replace;$('pptTargetInfo').hidden=!replace;$('pptAppendLabel').hidden=replace;
  $('pptConversionOptions').hidden=source?.kind!=='ppt';$('pptConversionHelp').textContent=$('pptConversion').value==='white'?'흰 바탕을 투명하게 만듭니다. 흰 글자·테두리도 함께 투명해지므로 미리보기로 확인하세요.':scoreMode()?'분리 가능한 악보 그림을 가져옵니다. 분리할 수 없는 장은 전체 이미지로 유지합니다.':'배경·악보·글자를 한 장으로 합칩니다. 제목을 자르지 않습니다.';$('pptScoreOptions').hidden=!scoreMode();$('pptCropAmount').hidden=!$('pptCropOn').checked;$('pptSave').textContent=replace?'검수 완료 · 슬라이드 교체':'검수 완료 · 문서 추가';$('pptStartHelp').hidden=!!source;$('pptFooter').hidden=!source;
  for(const card of $('pptSlides').querySelectorAll('.ppt-card'))card.querySelector('select')?.toggleAttribute('hidden',!scoreMode());lock(busy);}
 function setMode(value){$('pptTarget').value=value;target=null;$('pptTargetInfo').textContent='';candidates();options();}
 function applyPurpose(value){purpose=value;for(const b of $('pptPurpose').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.purpose===value));$('pptCategory').value=value==='score'?SCORE:'예배순서';$('pptConversion').value=value==='score'?'auto':'full';setMode(value==='sermon'?'replace':'new');invalidate();cards();}
 for(const b of $('pptPurpose').querySelectorAll('button'))b.onclick=()=>applyPurpose(b.dataset.purpose);
 function candidates(){const root=$('pptCandidates');root.replaceChildren();for(const c of CANDIDATES){const b=document.createElement('button');b.type='button';b.className='ppt-candidate';b.textContent=c.label;b.setAttribute('aria-pressed',String(c.names.includes(target?.name)));b.onclick=()=>choose(c.names);root.append(b);}
  const other=document.createElement('button');other.type='button';other.className='ppt-candidate ppt-candidate-other';other.id='pptOther';const custom=target&&!CANDIDATES.some(c=>c.names.includes(target.name));other.textContent=custom?target.name:'다른 문서 고르기…';other.setAttribute('aria-pressed',String(!!custom));other.onclick=()=>{$('pptSearch').hidden=false;search.focus();};root.append(other);}
 async function choose(names){if(busy){if(rendering){pendingTarget=names;invalidate(false);}return;}lock(true);try{const list=[].concat(names);for(const [i,name] of list.entries()){try{await findTarget(name);break;}catch(e){if(i===list.length-1)throw e;}}$('pptSearch').hidden=true;invalidate();}catch(e){message(e.message);}finally{candidates();lock(false);if(previewQueued)requestPreview();}}
 const search=YebaeonSearch.box($('pptSearch'),{label:'교체할 문서 검색',placeholder:'교체할 문서 이름',limit:8,onPick:d=>choose(YebaeonSearch.stem(d.name))});
 async function read(file){if(!file)return;if(busy){if(rendering){pendingFile=file;invalidate(false);}return;}if(prepared){message('먼저 이전 저장을 다시 시도하거나 준비본을 버려 주세요.');return;}
  const kind=/\.pdf$/i.test(file.name)?'pdf':/\.pptx?$/i.test(file.name)?'ppt':null;if(!kind){message('PPT·PPTX·PDF 파일을 선택해 주세요.');return;}
  if(file.size>(kind==='pdf'?PDF_MAX:PPT_MAX)){message(kind==='pdf'?'60MB 이하 PDF를 선택해 주세요.':'40MB 이하 PPT를 선택해 주세요.');return;}
  lock(true);invalidate(false);source?.data.dispose?.();source=null;target=null;$('pptSlides').replaceChildren();const epoch=renderEpoch;
  try{message(kind==='pdf'?'PDF를 읽고 있습니다…':'파일 구조와 이미지를 읽고 있습니다…');const lib=kind==='pdf'?await pdf():await engine(),data=kind==='pdf'?await lib.open(await file.arrayBuffer()):await lib.parse(await file.arrayBuffer());if(epoch!==renderEpoch){data.dispose?.();return;}
   const pages=kind==='pdf'?data.pages.map((_,i)=>({selected:true,index:i})):data.slides.map((s,i)=>{s.selected=!s.hidden;s.index=i;return s;});
   source={kind,name:file.name.normalize('NFC'),data,pages};start.setName(source.name);$('pptName').value=source.name.replace(/\.(pptx?|pdf)$/i,'').slice(0,145);
   applyPurpose(purpose);
   message(`${pages.length}${kind==='pdf'?'쪽':'장'} 읽음. 미리보기를 자동으로 만듭니다.${kind==='ppt'&&data.warnings.length?'\n'+data.warnings.join('\n'):''}`);
  }catch(e){source=null;start.setName('');message('파일 읽기 실패: '+e.message);}finally{options();lock(false);requestPreview();}}
 function cards(){const root=$('pptSlides');root.replaceChildren();if(!source)return;const unit=source.kind==='pdf'?'쪽':'장';source.pages.forEach((s,i)=>{const card=document.createElement('article');card.className='ppt-card';card.dataset.index=i;const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=s.selected;check.setAttribute('aria-label',`${i+1}${unit} 포함`);check.onchange=()=>{s.selected=check.checked;invalidate();};label.append(check,document.createTextNode(`${i+1}${unit}${s.hidden?' · 숨김':''}`));const badge=document.createElement('span');badge.className='ppt-card-badge';label.append(badge);card.append(label);
  if(source.kind==='ppt'){const select=document.createElement('select');select.setAttribute('aria-label',`${i+1}장 악보 그림`);select.add(new Option('통 이미지(나누지 않음)','-1'));s.images.forEach((p,j)=>select.add(new Option(`${p.name}${p.transparent?' · 투명':' · 불투명'}`,String(j))));select.value=String(separable(s)?s.scoreIndex:-1);select.onchange=()=>{s.scoreIndex=Number(select.value);s.forced=true;invalidate();};select.hidden=!scoreMode();card.append(select);}
  const preview=document.createElement('button');preview.className='ppt-thumb';preview.type='button';preview.setAttribute('aria-label',`${i+1}${unit} 확대`);preview.textContent='미리보기 전';preview.onclick=()=>{const o=outputs.find(x=>x.index===i);if(!o)return;$('pptLargeImage').replaceChildren(composite(o));$('pptLarge').hidden=false;$('pptLarge').scrollIntoView({block:'nearest'});};card.append(preview);root.append(card);});}
 // 악보 그림이 투명하면 배경과 나눌 수 있다. 사용자가 그림을 직접 고르면 그 선택을 따른다.
 const separable=s=>s.scoreIndex>=0&&!!s.images[s.scoreIndex]&&(s.forced||s.images[s.scoreIndex].transparent||$('pptConversion').value==='white');
 function composite(o){const box=document.createElement('div');box.className='ppt-composite';box.style.aspectRatio=`${size.width}/${size.height}`;const img=document.createElement('img');img.src=o.url;img.alt='변환 슬라이드';box.append(img);return box;}
 $('pptLargeClose').onclick=()=>$('pptLarge').hidden=true;
 // 대상 문서: 이름이 정확히 같은 서버 문서. 지금 버전의 크기·슬라이드 수를 보여 준다.
 async function findTarget(value){const name=String(value||'').trim().normalize('NFC').replace(/\.pro6$/i,'');target=null;if(!name){$('pptTargetInfo').textContent='교체할 문서를 고르세요.';throw Error('교체할 문서를 고르세요.');}
  $('pptTargetInfo').textContent='찾는 중…';const data=await(await C.api('/documents?'+new URLSearchParams({q:name}))).json(),found=(data.documents||[]).find(d=>(d.path||'').normalize('NFC').split('/').pop()===name+'.pro6');
  if(!found){$('pptTargetInfo').textContent=`‘${name}’ 문서를 찾지 못했습니다. 이름을 확인해 주세요.`;throw Error('교체할 문서를 찾지 못했습니다.');}
  const {document:doc}=await(await C.api('/documents/'+found.id)).json();if(doc.state&&doc.state!=='active')throw Error('보관함이나 휴지통에 있는 문서는 교체할 수 없습니다.');
  const xml=await(await C.api(`/documents/${doc.id}/content?version=${doc.version}`)).text(),parsed=new DOMParser().parseFromString(xml,'application/xml');
  if(parsed.querySelector('parsererror')||parsed.documentElement.tagName!=='RVPresentationDocument')throw Error('대상 문서를 읽지 못했습니다.');
  const root=parsed.documentElement,width=Number(root.getAttribute('width'))||1920,height=Number(root.getAttribute('height'))||1080;
  target={id:doc.id,path:doc.path,name,version:doc.version,xml,width,height,slides:parsed.getElementsByTagName('RVDisplaySlide').length};
  $('pptTargetInfo').textContent=`${name} · 버전 ${doc.version} · ${width}×${height} · 지금 슬라이드 ${target.slides}장 → 전체 교체`;lock(busy);return target;}
 $('pptTarget').onchange=()=>{if(!source)return;setMode(mode());invalidate();if(mode()==='replace')$('pptTargetInfo').textContent='교체할 문서를 고르세요.';};
 $('pptCategory').onchange=()=>{invalidate();options();};$('pptConversion').onchange=()=>{invalidate();cards();options();};$('pptCropOn').onchange=()=>{invalidate();options();};$('pptCrop').oninput=()=>invalidate();$('pptName').oninput=()=>lock(busy);


 // 슬라이드 크기가 다르면 늘이지 않고 가운데 두며 남는 곳은 검은색이다.
 async function fit(blob,w,h,lib,transparent=false){const bitmap=await createImageBitmap(blob);try{if(Math.abs(bitmap.width/bitmap.height-w/h)<.005&&bitmap.width===w)return {image:blob,margin:false};const c=lib.makeCanvas(w,h),x=c.getContext('2d');if(!transparent){x.fillStyle='#000';x.fillRect(0,0,w,h);}const scale=Math.min(w/bitmap.width,h/bitmap.height),dw=bitmap.width*scale,dh=bitmap.height*scale;x.drawImage(bitmap,(w-dw)/2,(h-dh)/2,dw,dh);return {image:await lib.blob(c),margin:Math.abs(dw-w)>1||Math.abs(dh-h)>1};}finally{bitmap.close();}}
 async function preview(){if(busy||!source)return;invalidate(false);rendering=true;lock(true);const epoch=renderEpoch,selected=source.pages.filter(s=>s.selected),made=[],found=new Map(),score=scoreMode(),replace=mode()==='replace'&&!!target,unit=source.kind==='pdf'?'쪽':'장';
  try{if(!selected.length)throw Error('가져올 장을 선택해 주세요.');const crop=$('pptCropOn').checked?Number($('pptCrop').value)/100:0;if(!Number.isFinite(crop)||crop<0||crop>.4)throw Error('자르기는 0~40%로 입력해 주세요.');
   size=replace?{width:target.width,height:target.height}:source.kind==='pdf'?{width:1920,height:1080}:{width:1920,height:Math.round(1920*source.data.height/source.data.width)};
   const lib=source.kind==='pdf'?await pdf():await engine(),ppt=source.kind==='ppt'?await engine():null;let total=0,separated=0,margins=0;
   for(const [n,s] of selected.entries()){message(`${n+1}/${selected.length}${unit} 변환 중…`);let o;
    if(source.kind==='pdf'){const r=await lib.render(source.data,s.index,size);o={image:r.image,margin:r.margin,separated:false};}
    else if(score&&separable(s)){const r=await lib.render(source.data,s.index,{mode:'score',removeWhite:$('pptConversion').value==='white',crop,keepTitle:n===0||crop===0,background:'original'});o={image:r.foreground,margin:false,separated:true,warnings:r.warnings};if(replace){const fitted=await fit(r.foreground,size.width,size.height,ppt,true);o={...o,...fitted};}
     if(r.background&&!await plain(r.background)){const sha256=await hash(r.background);if(!found.has(sha256)){found.set(sha256,{sha256,blob:r.background});total+=r.background.size;}}}
    else{const r=await lib.render(source.data,s.index,{mode:'full'});o={...await fit(r.foreground,size.width,size.height,ppt),separated:false,warnings:r.warnings};}
    if(epoch!==renderEpoch)return;total+=o.image.size;if(total>IMAGE_MAX)throw Error('변환 이미지가 180MB를 넘습니다. 장을 나누어 가져와 주세요.');
    o.index=s.index;o.url=URL.createObjectURL(o.image);urls.push(o.url);made.push(o);if(o.separated)separated++;if(o.margin)margins++;
    const card=$('pptSlides').querySelector(`[data-index="${s.index}"]`);card.querySelector('.ppt-thumb').replaceChildren(composite(o));card.querySelector('.ppt-card-badge').textContent=score?(o.separated?' · 악보 분리':' · 통 이미지'):o.margin?' · 여백':'';await new Promise(r=>setTimeout(r,0));}
   outputs=made;backdrops=found;const notes=[...new Set([...(source.kind==='ppt'?source.data.warnings:[]),...made.flatMap(o=>o.warnings||[])])];
   message(`${made.length}${unit} 준비됨${replace?` · ${target.name}의 슬라이드 ${target.slides}장을 이 ${made.length}장으로 바꿉니다`:''} · 썸네일을 누르면 크게 볼 수 있어요.${score?`\n악보 분리 ${separated}장 · 통 이미지 ${made.length-separated}장`:''}${backdrops.size?`\n나눈 배경 그림 ${backdrops.size}개는 문서에 넣지 않고 미디어(웹에서 가져온 그림)에 따로 올립니다.`:''}${margins?`\n${margins}${unit}은 비율이 슬라이드와 달라 남는 곳이 검은색입니다.`:''}${notes.length?'\n'+notes.join('\n'):''}`);
  }catch(e){if(epoch===renderEpoch){invalidate(false);message('변환 실패: '+e.message);}}finally{rendering=false;lock(false);drainPreview();}}
 $('pptReviewed').onchange=()=>lock(busy);
 const imageElement=(src,w,h)=>P.imageElementXML({source:src,rect:{x:0,y:0,w,h},scale:'0'});
 function documentName(value){const name=value.trim().normalize('NFC').replace(/\.pro6$/i,'');if(!name||/[\\/\x00-\x1f\x7f]/.test(name)||name.length>145)throw Error('문서 이름을 확인해 주세요. 폴더 구분 문자는 사용할 수 없습니다.');return name;}
 const slideXML=(o,src,label)=>P.slideXML({label:String(label),drawingBackgroundColor:!o.separated,backgroundColor:o.separated?'1 1 1 1':'0 0 0 1',elements:imageElement(src,size.width,size.height)});
 async function prepare(){const name=documentName($('pptName').value),category=$('pptCategory').value;if(!category)throw Error('카테고리를 골라 주세요.');const assets=new Map();let slides='';
  for(const o of outputs){const sha256=await hash(o.image);assets.set(sha256,{sha256,blob:o.image});slides+=slideXML(o,'file:///YebaeOn-Media/'+sha256+'.png',o.index+1);}
  const xml=P.documentXML({width:size.width,height:size.height,category,groups:[{name:'기본',slides}]});
  return {path:name+'.pro6',xml,assets:[...assets.values()],backgrounds:[...backdrops.values()],owner:C.worker(),appendTarget:$('pptAppend').checked?L.selectedPlaylist()?.key:null};}
 // 서버가 정한 교회 Mac 경로(`/Users/Shared/Renewed Vision Media/YebaeOn/<문서이름>-<n>.png`)를 받아 준비 표시 `file:///YebaeOn-Media/<sha>.png`를 바꾼다.
 const fileURL=path=>'file://'+path.split('/').map(p=>encodeURIComponent(p).replace(/'/g,'%27')).join('/');
 async function macPaths(hashes,name){const found=new Map();for(let i=0;i<hashes.length;i+=200){const body=JSON.stringify({name,items:hashes.slice(i,i+200).map(sha256=>({sha256}))});let result;for(let attempt=0;;attempt++){try{result=await(await C.api('/media/paths',{method:'POST',headers:{'Content-Type':'application/json'},body})).json();break;}catch(e){if(e.code!=='media_path_busy'||attempt>=2)throw e;}}for(const p of result.paths)found.set(p.sha256,fileURL(p.path));}return found;}
 async function placeMedia(xml,name){const pattern=/file:\/\/\/YebaeOn-Media\/([a-f0-9]{64})\.png/g,hashes=[...new Set([...xml.matchAll(pattern)].map(m=>m[1]))];if(!hashes.length)return xml;message('교회 Mac 이미지 경로를 정하고 있습니다…');const found=await macPaths(hashes,name);return xml.replace(pattern,(m,sha)=>found.get(sha));}
 async function upload(assets){const known=new Set();for(let i=0;i<assets.length;i+=80){const query=new URLSearchParams();for(const a of assets.slice(i,i+80))query.append('hash',a.sha256);const found=await(await C.api('/media?'+query)).json();for(const a of found.assets)known.add(a.sha256);}
  for(let i=0;i<assets.length;i++){const a=assets[i];if(known.has(a.sha256))continue;message(`이미지 저장 ${i+1}/${assets.length}…`);await C.api('/media/'+a.sha256+'/content',{method:'PUT',headers:{'Content-Type':'image/png','X-Yebaeon-SHA256':a.sha256},body:a.blob});known.add(a.sha256);}}
 // 대상 문서의 슬라이드 묶음만 새 그림 슬라이드 하나로 바꾼다. 문서의 나머지 속성(카테고리·크기·사용일 등)은 그대로다.
 function replaced(found){const parsed=new DOMParser().parseFromString(target.xml,'application/xml'),root=parsed.documentElement;
  const ivar=name=>[...root.children].find(c=>c.tagName==='array'&&c.getAttribute('rvXMLIvarName')===name);
  let groups=ivar('groups');if(!groups){groups=parsed.createElement('array');groups.setAttribute('rvXMLIvarName','groups');root.append(groups);}
  groups.replaceChildren();ivar('arrangements')?.replaceChildren();
  const slides=outputs.map((o,n)=>slideXML(o,found.get(o.sha256),n+1)).join('');
  const group=new DOMParser().parseFromString(`<RVSlideGrouping UUID="${P.uuid()}" name="${source.kind==='pdf'?'말씀':'기본'}"><array rvXMLIvarName="slides">${slides}</array></RVSlideGrouping>`,'application/xml').documentElement;
  groups.append(parsed.importNode(group,true));return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(root);}
 async function replace(){const opened=E.ready()&&E.state().key===target.id;if(opened&&E.state().dirty){message('편집기에 이 문서의 저장하지 않은 변경이 있습니다. 먼저 저장하거나 되돌려 주세요.');return;}
  try{for(const o of outputs)o.sha256??=await hash(o.image);const assets=[...new Map(outputs.map(o=>[o.sha256,{sha256:o.sha256,blob:o.image}])).values()];await upload(assets);
   message('교회 Mac 이미지 경로를 정하고 있습니다…');const found=await macPaths(assets.map(a=>a.sha256),target.name);message('문서를 교체하고 있습니다…');
   await C.api('/documents/'+target.id,{method:'PUT',headers:{'Content-Type':'application/xml','If-Match':`"${target.version}"`},body:replaced(found)});
   const done=target,count=outputs.length;target=null;invalidate();$('pptTargetInfo').textContent='';message('');await C.openDocument(done.id);dialog.close();E.status(`${done.name}의 슬라이드를 ${count}장으로 교체했습니다.`);
  }catch(e){if(e.status===409){target=null;$('pptTargetInfo').textContent='';candidates();message('다른 곳에서 문서가 바뀌었습니다. 교체할 문서를 다시 고른 뒤 교체해 주세요. 변환한 그림은 그대로 둡니다.');}else message('교체 중단: '+e.message+'\n이미 올린 그림은 다시 올리지 않습니다. 다시 누르면 이어서 합니다.');}}
 // 나눈 배경 그림을 올리고 `<문서이름> 배경` 경로를 받는다. 실패해도 문서 추가는 그대로 두고 알리기만 한다.
 async function uploadBackgrounds(job){const list=job.backgrounds||[];if(!list.length)return '';
  try{await upload(list);message('배경 그림을 미디어에 올리고 있습니다…');await macPaths(list.map(b=>b.sha256),job.path.replace(/\.pro6$/i,'')+' 배경');for(const b of list)window.YebaeonThumbnails?.make(b.sha256,b.blob).catch(()=>{});return ` 나눈 배경 그림 ${list.length}개는 미디어 › 모두 보기 › 웹에서 가져온 그림에 있습니다.`;}
  catch(e){return ' 배경 그림은 미디어에 올리지 못했습니다: '+e.message;}}
 async function create(){try{if(!prepared){const next=await prepare();await recovery('put',next);prepared=next;}if(prepared.owner!==C.worker())throw Error('준비한 작업자 이름으로 입장해 주세요.');
   await upload(prepared.assets);
   if(prepared.xml.includes('file:///YebaeOn-Media/')){prepared.xml=await placeMedia(prepared.xml,prepared.path.replace(/\.pro6$/i,''));await recovery('put',prepared);}
   message('문서를 등록하고 이미지 연결을 확인하고 있습니다…');const result=await(await C.api('/documents?'+new URLSearchParams({path:prepared.path}),{method:'POST',headers:{'Content-Type':'application/xml'},body:prepared.xml})).json();prepared.document=result.document;await recovery('put',prepared);
   const backgrounds=await uploadBackgrounds(prepared);
   let order='';if(prepared.appendTarget&&prepared.appendTarget===L.selectedPlaylist()?.key&&!L.memberIDs().includes(result.document.id)&&L.appendDocuments([result.document])){message('순서를 저장하고 있습니다…');await L.checkpoint();order=await L.save()?' ‘'+L.selectedPlaylist().name+'’ 순서 맨 아래에 넣고 저장했습니다.':' 순서에 넣었지만 저장하지 못했습니다. 서버 저장을 눌러 주세요.';}
   await C.openDocument(result.document.id);await recovery('delete');prepared=null;showRecovery();message('');dialog.close();E.status('문서를 추가했습니다.'+(order||' 이름으로 검색해 순서에 넣을 수 있습니다.')+backgrounds);invalidate();
  }catch(e){if(e.code==='path_exists'&&prepared){prepared.pathConflict=true;try{await recovery('put',prepared);}catch{ /* Existing stable recovery still permits retry. */ }}message('저장 중단: '+e.message+(e.code==='path_exists'?'\n위의 새 문서 이름을 확인하고 ‘이 이름으로 저장’을 누르세요. 다시 변환할 필요가 없습니다.':prepared?'\n준비본을 보존했습니다. ‘저장 다시 시도’를 누르면 같은 문서로 이어갑니다.':'\n복구 준비본을 저장하지 못해 서버 업로드를 시작하지 않았습니다. 이 창을 유지하고 입력값과 브라우저 저장 공간을 확인해 주세요.'));showRecovery();if(prepared)$('pptRecovery').scrollIntoView({block:'nearest'});}}
 async function save(resume=false){if(busy||!C.needUser()||window.YebaeonSave?.busy())return;if(!resume&&(!$('pptReviewed').checked||!outputs.length))return;uploading=true;lock(true);
  try{if(!resume&&mode()==='replace'){if(target)await replace();}else await create();}finally{uploading=false;lock(false);}}
 $('pptRenameSave').onclick=async()=>{if(busy||!prepared?.pathConflict||!C.needUser())return;lock(true);let renamed=false;try{const path=documentName($('pptRecoveryName').value)+'.pro6';if(path===prepared.path)throw Error('기존 이름과 다른 새 이름을 입력해 주세요.');const next={...prepared,path,pathConflict:false};delete next.document;await recovery('put',next);prepared=next;showRecovery();renamed=true;}catch(e){message('이름 변경 중단: '+e.message);}finally{lock(false);}if(renamed)await save(true);};
 $('pptSave').onclick=()=>save();$('pptResume').onclick=()=>save(true);$('pptDiscard').onclick=async()=>{if(busy||!confirm('이 브라우저의 PPT 준비본을 버릴까요? 이미 서버에 저장된 이미지나 문서는 삭제하지 않습니다.'))return;try{await recovery('delete');prepared=null;invalidate();showRecovery();lock(false);message('준비본을 버렸습니다. 새 파일을 선택할 수 있습니다.');}catch(e){message(e.message);}};
 window.addEventListener('yebaeonsession',e=>{if(!e.detail.authenticated&&!busy){dialog.close();source?.data.dispose?.();source=null;target=null;invalidate();prepared=null;cards();options();}});
 options();
 window.YebaeonPPTImport={read,preview,save,open:openDialog,state:()=>({source,deck:source?.kind==='ppt'?source.data:null,outputs,prepared,target,busy}),imageElement,hash,macPaths,dialog};
})();
