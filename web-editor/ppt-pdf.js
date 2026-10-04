(function(){'use strict';
 // PPT 추가 창의 '말씀 PDF' 탭. PDF 각 쪽을 대상 문서 크기의 그림으로 바꿔 그 문서의 슬라이드 전체를 교체한다.
 // 쪽 비율이 슬라이드와 다르면 늘이지 않고 가운데 두며 남는 곳은 검은색이다. 원본 PDF는 서버로 보내지 않는다.
 const $=id=>document.getElementById(id),C=YebaeonCloud,P=PP6,E=YebaeonEditor,I=YebaeonPPTImport;
 const TARGET_KEY='yebaeon-pdf-target',DEFAULT_TARGET='주일예배말씀 ppt',MAX=60*1024*1024,MAX_IMAGES=180*1024*1024;
 $('pdfBody').innerHTML=`<p class="ppt-kind-help">목사님 말씀 PDF의 각 쪽을 슬라이드 그림으로 바꿔, 아래 문서의 슬라이드 전체를 교체합니다. 쪽 비율이 슬라이드와 다르면 늘이지 않고 남는 곳을 검은색으로 둡니다.</p>
 <div id="pdfDrop" class="ppt-drop"><label for="pdfFile"><strong>말씀 PDF를 여기에 놓으세요</strong><span>또는 파일 선택 · .pdf · 최대 60MB, 120쪽</span></label><input id="pdfFile" type="file" accept=".pdf,application/pdf"><button id="pdfDropboxOpen" type="button" class="ppt-dropbox-open">드롭박스에서 고르기</button></div><div id="pdfDropbox"></div>
 <fieldset id="pdfTargetBox"><legend>교체할 문서</legend><div class="ppt-controls ppt-name-controls"><label>문서 이름 <input id="pdfTarget" maxlength="145"></label><button id="pdfFind" type="button">확인</button></div><p id="pdfTargetInfo" class="ppt-help"></p></fieldset>
 <p id="pdfMessage" class="ppt-message" role="status"></p><div id="pdfSlides" class="ppt-slides"></div><div id="pdfLarge" class="ppt-large" hidden><button id="pdfLargeClose" type="button">확대 닫기</button><div id="pdfLargeImage"></div></div>`;
 $('pdfFooter').innerHTML=`<div class="ppt-checks"><label><input id="pdfReviewed" type="checkbox" disabled> 모든 쪽의 변환 결과를 확인했어요</label></div><button id="pdfSave" class="primary" disabled>검수 완료 · 슬라이드 교체</button>`;
 let target=null,file=null,outputs=[],busy=false,uploading=false,enginePromise=null,epoch=0;
 const message=t=>$('pdfMessage').textContent=t;
 try{$('pdfTarget').value=localStorage.getItem(TARGET_KEY)||DEFAULT_TARGET;}catch{$('pdfTarget').value=DEFAULT_TARGET;}
 I.guard(()=>busy||uploading);
 async function engine(){if(window.YebaeonPDFEngine)return window.YebaeonPDFEngine;return enginePromise??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/pdf-engine.js';s.onload=()=>resolve(YebaeonPDFEngine);s.onerror=()=>{s.remove();enginePromise=null;reject(Error('PDF 변환기를 불러오지 못했습니다. 다시 시도해 주세요.'));};document.head.append(s);});}
 function lock(value){busy=value;$('pdfBody').setAttribute('aria-busy',String(value));for(const id of ['pdfFile','pdfDropboxOpen','pdfTarget','pdfFind'])$(id).disabled=value;$('pdfReviewed').disabled=value||!outputs.length;$('pdfSave').disabled=value||!outputs.length||!target||!$('pdfReviewed').checked;$('pptClose').disabled=uploading;}
 function clear(){epoch++;for(const o of outputs)URL.revokeObjectURL(o.url);outputs=[];$('pdfSlides').replaceChildren();$('pdfLarge').hidden=true;$('pdfReviewed').checked=false;}
 // 대상 문서: 이름이 정확히 같은 서버 문서. 지금 버전의 크기·슬라이드 수를 보여 준다.
 async function findTarget(){const name=$('pdfTarget').value.trim().normalize('NFC').replace(/\.pro6$/i,'');if(!name)throw Error('교체할 문서 이름을 입력해 주세요.');
  $('pdfTargetInfo').textContent='찾는 중…';target=null;
  const data=await(await C.api('/documents?'+new URLSearchParams({q:name}))).json(),found=(data.documents||[]).find(d=>(d.path||'').normalize('NFC')===name+'.pro6');
  if(!found){$('pdfTargetInfo').textContent=`‘${name}’ 문서를 찾지 못했습니다. 이름을 확인해 주세요.`;throw Error('교체할 문서를 찾지 못했습니다.');}
  const {document:doc}=await(await C.api('/documents/'+found.id)).json();if(doc.state&&doc.state!=='active')throw Error('보관함이나 휴지통에 있는 문서는 교체할 수 없습니다.');
  const xml=await(await C.api(`/documents/${doc.id}/content?version=${doc.version}`)).text(),parsed=new DOMParser().parseFromString(xml,'application/xml');
  if(parsed.querySelector('parsererror')||parsed.documentElement.tagName!=='RVPresentationDocument')throw Error('대상 문서를 읽지 못했습니다.');
  const root=parsed.documentElement,width=Number(root.getAttribute('width'))||1920,height=Number(root.getAttribute('height'))||1080;
  target={id:doc.id,path:doc.path,name,version:doc.version,xml,width,height,slides:parsed.getElementsByTagName('RVDisplaySlide').length};
  try{localStorage.setItem(TARGET_KEY,name);}catch{ /* 기억하지 못해도 된다 */ }
  $('pdfTargetInfo').textContent=`${name} · 버전 ${doc.version} · ${width}×${height} · 지금 슬라이드 ${target.slides}장 → 전체 교체`;
  return target;}
 function card(o,n){const box=document.createElement('article');box.className='ppt-card';const label=document.createElement('span');label.className='ppt-card-label';label.textContent=`${n+1}쪽${o.margin?' · 여백':''}`;
  const thumb=document.createElement('button');thumb.type='button';thumb.className='ppt-thumb';thumb.setAttribute('aria-label',`${n+1}쪽 확대`);const img=document.createElement('img');img.src=o.url;img.alt=`${n+1}쪽 변환 슬라이드`;img.className='ppt-pdf-thumb';img.style.aspectRatio=`${target.width}/${target.height}`;thumb.append(img);
  thumb.onclick=()=>{const big=img.cloneNode();$('pdfLargeImage').replaceChildren(big);$('pdfLarge').hidden=false;$('pdfLarge').scrollIntoView({block:'nearest'});};box.append(label,thumb);return box;}
 async function read(next){if(busy||!next)return;if(!/\.pdf$/i.test(next.name)){message('PDF 파일을 선택해 주세요.');return;}if(next.size>MAX){message('60MB 이하 PDF를 선택해 주세요.');return;}
  clear();file=next;lock(true);const mine=epoch;let doc=null;
  try{if(!target)await findTarget();message('PDF를 읽고 있습니다…');const lib=await engine();doc=await lib.open(await next.arrayBuffer());let total=0,margins=0;
   for(let i=0;i<doc.pages.length;i++){message(`${i+1}/${doc.pages.length}쪽 변환 중…`);const r=await lib.render(doc,i,{width:target.width,height:target.height});if(mine!==epoch)return;total+=r.image.size;if(total>MAX_IMAGES)throw Error('변환 이미지가 180MB를 넘습니다. PDF를 나누어 주세요.');
    const o={index:i,image:r.image,margin:r.margin,url:URL.createObjectURL(r.image)};outputs.push(o);if(o.margin)margins++;$('pdfSlides').append(card(o,i));await new Promise(r=>setTimeout(r,0));}
   message(`${outputs.length}쪽 준비됨 · ${target.name}의 슬라이드 ${target.slides}장을 이 ${outputs.length}장으로 바꿉니다.${margins?`\n${margins}쪽은 비율이 슬라이드와 달라 남는 곳이 검은색입니다.`:''}`);
  }catch(e){clear();message('PDF 변환 실패: '+e.message);}finally{doc?.dispose();lock(false);}}
 // 대상 문서의 슬라이드 묶음만 새 그림 슬라이드 하나로 바꾼다. 문서의 나머지 속성(카테고리·크기·사용일 등)은 그대로다.
 function replaced(urls){const parsed=new DOMParser().parseFromString(target.xml,'application/xml'),root=parsed.documentElement,w=target.width,h=target.height;
  const ivar=name=>[...root.children].find(c=>c.tagName==='array'&&c.getAttribute('rvXMLIvarName')===name);
  let groups=ivar('groups');if(!groups){groups=parsed.createElement('array');groups.setAttribute('rvXMLIvarName','groups');root.append(groups);}
  groups.replaceChildren();ivar('arrangements')?.replaceChildren();
  const slides=outputs.map((o,n)=>`<RVDisplaySlide UUID="${P.uuid()}" label="${n+1}" enabled="true" drawingBackgroundColor="true" backgroundColor="0 0 0 1"><array rvXMLIvarName="displayElements">${I.imageElement(urls.get(o.sha256),w,h)}</array><array rvXMLIvarName="cues"/></RVDisplaySlide>`).join('');
  const group=new DOMParser().parseFromString(`<RVSlideGrouping UUID="${P.uuid()}" name="말씀"><array rvXMLIvarName="slides">${slides}</array></RVSlideGrouping>`,'application/xml').documentElement;
  groups.append(parsed.importNode(group,true));
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(root);}
 async function save(){if(busy||!target||!outputs.length||!$('pdfReviewed').checked||!C.needUser()||window.YebaeonSave?.busy())return;
  const open=E.ready()&&E.state().key===target.id;if(open&&E.state().dirty){message('편집기에 이 문서의 저장하지 않은 변경이 있습니다. 먼저 저장하거나 되돌려 주세요.');return;}
  uploading=true;lock(true);
  try{for(const o of outputs)o.sha256??=await I.hash(o.image);
   const hashes=[...new Set(outputs.map(o=>o.sha256))],known=new Set();
   for(let i=0;i<hashes.length;i+=80){const q=new URLSearchParams();for(const h of hashes.slice(i,i+80))q.append('hash',h);for(const a of (await(await C.api('/media?'+q)).json()).assets)known.add(a.sha256);}
   for(const [n,o] of outputs.entries()){if(known.has(o.sha256))continue;message(`이미지 저장 ${n+1}/${outputs.length}…`);await C.api('/media/'+o.sha256+'/content',{method:'PUT',headers:{'Content-Type':'image/png','X-Yebaeon-SHA256':o.sha256},body:o.image});known.add(o.sha256);}
   message('교회 Mac 이미지 경로를 정하고 있습니다…');const urls=await I.macPaths(hashes,target.name);
   message('문서를 교체하고 있습니다…');
   await C.api('/documents/'+target.id,{method:'PUT',headers:{'Content-Type':'application/xml','If-Match':`"${target.version}"`},body:replaced(urls)});
   const done=target,count=outputs.length;target=null;clear();$('pdfTargetInfo').textContent='';message('');
   await C.openDocument(done.id);I.dialog.close();E.status(`${done.name}의 슬라이드를 말씀 PDF ${count}장으로 교체했습니다.`);
  }catch(e){if(e.status===409){target=null;$('pdfTargetInfo').textContent='';message('다른 곳에서 문서가 바뀌었습니다. ‘확인’을 눌러 문서를 다시 불러온 뒤 교체해 주세요. 변환한 그림은 그대로 둡니다.');}
   else message('교체 중단: '+e.message+'\n이미 올린 그림은 다시 올리지 않습니다. 다시 누르면 이어서 합니다.');}
  finally{uploading=false;lock(false);}}
 $('pdfFile').onchange=()=>{read($('pdfFile').files[0]);$('pdfFile').value='';};
 const drop=$('pdfDrop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragover');};drop.ondragleave=()=>drop.classList.remove('dragover');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragover');if(e.dataTransfer.files.length!==1){message('한 번에 PDF 파일 하나를 넣어 주세요.');return;}read(e.dataTransfer.files[0]);};
 const picker=YebaeonDropboxPicker.attach($('pdfDropbox'),{accept:/\.pdf$/i,max:MAX,kind:'PDF',onFile:read});$('pdfDropboxOpen').onclick=()=>picker.toggle();
 $('pdfFind').onclick=async()=>{if(busy)return;lock(true);try{const before=target;await findTarget();if(outputs.length&&before&&(before.width!==target.width||before.height!==target.height)){clear();message('슬라이드 크기가 달라 PDF를 다시 변환해야 합니다. PDF를 다시 선택해 주세요.');}}catch(e){message(e.message);}finally{lock(false);}};
 $('pdfTarget').oninput=()=>{target=null;$('pdfTargetInfo').textContent='';lock(busy);};
 $('pdfReviewed').onchange=()=>lock(busy);$('pdfSave').onclick=save;$('pdfLargeClose').onclick=()=>$('pdfLarge').hidden=true;
 I.dialog.addEventListener('yebaeonpptkind',e=>{if(e.detail==='pdf'&&!target&&!busy&&C.authenticated()){lock(true);findTarget().catch(err=>message(err.message)).finally(()=>lock(false));}});
 window.addEventListener('yebaeonsession',e=>{if(!e.detail.authenticated&&!uploading){clear();target=null;file=null;}});
 window.YebaeonPPTPdf={read,save,findTarget,state:()=>({target,outputs,busy,file})};
})();
