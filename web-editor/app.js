(function () {
  'use strict';
  const P=window.PP6, R=window.PP6Render, $=id=>document.getElementById(id);
  let model, selected=0, dirty=false, generation=0, busy=false, editSerial=0;
  const history=[], library=new Map(), assets=new Map();
  function status(message) {$('status').textContent=message;}
  function guard(action) {return async function(...args){try{await action(...args);}catch(error){status('확인 필요: '+error.message);}};}
  function current(){return P.slides(model)[selected];}
  function groupOf(slide){return slide.parentNode.parentNode;}
  function slideText(slide){return P.textElements(slide).map(t=>P.parseRTF(P.textNode(t)?.textContent || '').text).filter(Boolean).join(' / ');}
  function title(slide){return P.attr(slide,'label') || slideText(slide).split('\n')[0] || '빈 슬라이드';}
  function changed(){dirty=true;editSerial++;window.dispatchEvent(new Event('yebaeonchange'));}
  function snapshot(){history.push({xml:P.serialize(model),selected,dirty});if(history.length>40)history.shift();changed();$('undo').disabled=false;}
  function open(xml,name,force=false) {
    const incoming=P.parse(xml,name);
    if(!force && dirty && !confirm('저장하지 않은 변경이 있습니다. 다른 문서를 열까요?'))return false;
    window.dispatchEvent(new Event('yebaeonbeforeopen'));
    model=incoming;selected=0;dirty=false;history.length=0;library.clear();assets.clear();R.clear();$('search').value='';
    editSerial++;render();status(`${name} · ${P.slides(model).length}장을 열었습니다. 배경 파일을 연결하면 미디어도 확인할 수 있습니다.`);window.dispatchEvent(new Event('yebaeonopen'));return true;
  }
  function renderList() {
    const list=$('slides');list.replaceChildren();
    const filter=$('search').value.toLocaleLowerCase(), sequence=P.slides(model), token=generation;
    for(const group of P.all(model.doc,'RVSlideGrouping')) {
      const items=sequence.map((slide,index)=>({slide,index})).filter(x=>groupOf(x.slide)===group && (!filter || (title(x.slide)+' '+slideText(x.slide)).toLocaleLowerCase().includes(filter)));
      if(!items.length)continue;
      const heading=document.createElement('div');heading.className='group-heading';heading.textContent=P.attr(group,'name','그룹');
      const count=document.createElement('span');count.textContent=items.length+'장';heading.append(count);list.append(heading);
      for(const {slide,index} of items) {
        const button=document.createElement('button');button.className='slide-row'+(index===selected?' selected':'');button.setAttribute('aria-label',`${index+1}번 ${title(slide)}`);button.setAttribute('aria-pressed',String(index===selected));button.dataset.index=index;
        const canvas=document.createElement('canvas');canvas.width=240;canvas.height=Math.round(240*model.height/model.width);button.append(canvas);
        const copy=document.createElement('div');copy.className='row-copy';const number=document.createElement('small');number.textContent=String(index+1).padStart(2,'0');const name=document.createElement('span');name.textContent=title(slide);copy.append(number,name);button.append(copy);
        button.onclick=()=>{selected=index;render();};list.append(button);
        R.draw(canvas,model,slide,library).catch(error=>{if(token===generation)status(error.message);});
      }
    }
    if(!list.children.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='검색 결과가 없습니다.';list.append(empty);}
  }
  async function preview() {
    const token=++generation, slide=current(), canvas=document.createElement('canvas');canvas.width=960;canvas.height=Math.round(960*model.height/model.width);
    const warnings=await R.draw(canvas,model,slide,library);
    if(token!==generation)return;
    const target=$('preview');target.width=canvas.width;target.height=canvas.height;target.getContext('2d').drawImage(canvas,0,0);
    $('warnings').replaceChildren();
    for(const warning of warnings){const line=document.createElement('div');line.textContent=warning;$('warnings').append(line);}
    $('png').disabled=false;
  }
  function renderEditor() {
    const slide=current();$('label').value=P.attr(slide,'label');
    $('texts').replaceChildren();
    P.textElements(slide).forEach((element,i)=>{
      const field=document.createElement('label');field.className='field';field.textContent=P.attr(element,'displayName') || `텍스트 ${i+1}`;
      const input=document.createElement('textarea');input.value=P.parseRTF(P.textNode(element)?.textContent || '').text;input.dataset.textIndex=i;
      let transaction=false;
      input.addEventListener('focus',()=>{transaction=false;});
      input.addEventListener('input',guard(()=>{if(!transaction){snapshot();transaction=true;}else changed();P.setText(element,input.value);refreshPreviewAndList();status('텍스트를 수정했습니다. 서버 또는 ZIP에 저장해 변경을 보관하세요.');}));
      field.append(input);$('texts').append(field);
    });
    if(!P.textElements(slide).length){const empty=document.createElement('p');empty.className='help';empty.textContent='이 슬라이드에는 텍스트 상자가 없습니다. 텍스트가 있는 슬라이드를 선택해 새 장을 추가할 수 있습니다.';$('texts').append(empty);}
    $('group').replaceChildren();
    P.all(model.doc,'RVSlideGrouping').forEach((group,i)=>{const o=new Option(`${i+1}. ${P.attr(group,'name','그룹')}`,String(i));o.selected=group===groupOf(slide);$('group').add(o);});
    $('mediaTarget').replaceChildren();
    P.mediaElements(slide).forEach((media,i)=>{$('mediaTarget').add(new Option(`${media.parentNode.tagName==='RVMediaCue'?'배경':'요소'} · ${P.basename(P.attr(media,'source'))}`,String(i)));});
    if(!P.ivar(slide,'RVMediaCue','backgroundMediaCue'))$('mediaTarget').add(new Option('새 배경 추가','new'));
    renderFonts();
    $('add').disabled=!P.textElements(slide).length;
  }
  function refreshPreviewAndList() {
    $('slideTitle').textContent=title(current());$('png').disabled=true;
    preview().catch(error=>status(error.message));renderList();
  }
  function renderFonts() {
    $('fonts').replaceChildren();
    for(const text of PP6Fonts.descriptions(current())){const line=document.createElement('div');line.textContent=text;$('fonts').append(line);}
  }
  let fontRefresh;
  window.addEventListener('pp6fontschange',()=>{
    clearTimeout(fontRefresh);
    fontRefresh=setTimeout(()=>{if(model){renderFonts();refreshPreviewAndList();}},40);
  });
  function render() {
    const sequence=P.slides(model);selected=Math.max(0,Math.min(selected,sequence.length-1));
    $('docTitle').textContent=model.name;$('slideCount').textContent=sequence.length+'장';$('slidePosition').textContent=`${selected+1} / ${sequence.length}`;
    $('dimensions').textContent=`${model.width} × ${model.height}`;
    $('before').disabled=selected===0;$('after').disabled=selected===sequence.length-1;$('delete').disabled=sequence.length<=1;$('undo').disabled=!history.length;
    $('mediaSummary').textContent=`연결 ${[...library.values()].reduce((n,files)=>n+files.length,0)}개 · 교체 파일은 ZIP에 함께 저장`;
    renderEditor();refreshPreviewAndList();
  }
  function link(files) {
    for(const file of files){const key=P.nfc(file.name),existing=library.get(key)||[];if(!existing.some(f=>f.name===file.name && f.webkitRelativePath===file.webkitRelativePath && f.size===file.size && f.lastModified===file.lastModified))library.set(key,[...existing,file]);}
    render();status(`${files.length}개 파일을 미리보기에 연결했습니다. 같은 이름의 후보가 여러 개면 자동 선택하지 않습니다.`);
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function safeName(name){return name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'') || '문서.pro6';}
  function move(direction) {
    const sequence=P.slides(model),slide=current(),target=sequence[selected+direction];if(!target)return;
    snapshot();target.parentNode.insertBefore(slide,direction<0?target:target.nextSibling);selected=P.slides(model).indexOf(slide);render();status('슬라이드 순서를 바꿨습니다. 그룹 경계를 넘으면 대상 그룹으로 이동합니다.');
  }
  function element(tag,attributes,children=[]) {const el=model.doc.createElement(tag);for(const [k,v] of Object.entries(attributes))el.setAttribute(k,String(v));el.append(...children);return el;}
  function createMedia(kind) {
    const position=element('RVRect3D',{rvXMLIvarName:'position'});position.textContent=`{0 0 0 ${model.width} ${model.height}}`;
    const shadow=element('shadow',{rvXMLIvarName:'shadow'});shadow.textContent='0.000000|0 0 0 1|{4, -4}';
    return element(kind,{UUID:P.uuid(),displayName:kind==='RVImageElement'?'ImageElement':'VideoElement',rvXMLIvarName:'element',source:'',opacity:'1.000000',rotation:'0.000000',scaleBehavior:'1',scaleSize:'{1, 1}',imageOffset:'{0, 0}',drawingFill:'false',drawingShadow:'false',drawingStroke:'false',fillColor:'0 0 0 0',flippedHorizontally:'false',flippedVertically:'false',locked:'false',persistent:'false',fromTemplate:'false',typeID:'0',displayDelay:'0.000000',bezelRadius:'0.000000'},[position,shadow]);
  }
  async function replace(file) {
    if(!file)return;
    if(file.size>200*1024*1024)throw new Error('새 미디어는 파일당 200MB까지 지원합니다.');
    const extension=file.name.split('.').pop().toLowerCase();
    if(!['png','jpg','jpeg','mp4','mov'].includes(extension))throw new Error('PNG, JPG, MP4, MOV 파일을 선택해 주세요.');
    const kind=['mp4','mov'].includes(extension)?'RVVideoElement':'RVImageElement',slide=current(),target=$('mediaTarget').value;
    let media=target==='new'?null:P.mediaElements(slide)[Number(target)];
    if(media && media.tagName!==kind)throw new Error('이 버전은 이미지끼리 또는 영상끼리 교체할 수 있습니다.');
    if([...assets.values()].reduce((sum,a)=>sum+a.file.size,0)+file.size>500*1024*1024)throw new Error('새 미디어 합계는 500MB까지 지원합니다.');
    status('새 미디어를 확인하고 있습니다…');
    const decoded=await R.media(file,kind);
    if(!decoded)throw new Error('이 브라우저가 파일을 읽지 못했습니다. 이미지 PNG/JPG 또는 브라우저에서 재생되는 MP4로 준비해 주세요.');
    if(kind==='RVVideoElement' && !Number.isFinite(decoded.duration))throw new Error('영상 길이를 읽을 수 없습니다.');
    const stamp=P.uuid().replace(/-/g,'').slice(0,12).toLowerCase(),name=`pp6-${stamp}.${extension}`,folder=kind==='RVVideoElement'?'Video':'Images',path=`assets/${folder}/${name}`,source=`file:///PP6-Package/${path}`;
    snapshot();
    if(!media) {
      media=createMedia(kind);
      const cue=element('RVMediaCue',{UUID:P.uuid(),rvXMLIvarName:'backgroundMediaCue',actionType:'0',alignment:'4',behavior:'1',dateAdded:'',delayTime:'0.000000',displayName:file.name,enabled:'false',nextCueUUID:'',tags:'',timeStamp:'0.000000'},[media]);
      slide.insertBefore(cue,P.ivar(slide,'array','displayElements'));
    }
    media.setAttribute('source',source);media.setAttribute('format',kind==='RVVideoElement'?'H264':extension==='png'?'PNG':'JPEG');
    media.setAttribute('manufactureName','');media.setAttribute('manufactureURL','');
    if(kind==='RVVideoElement')for(const [k,v] of Object.entries({timeScale:600,inPoint:0,outPoint:Math.round(decoded.duration*600),endPoint:Math.round(decoded.duration*600),naturalSize:`{${decoded.width}, ${decoded.height}}`,playRate:'1.000000',audioVolume:P.attr(media,'audioVolume','1.000000'),playbackBehavior:P.attr(media,'playbackBehavior','1'),fieldType:'0',frameRate:'0.000000'}))media.setAttribute(k,String(v));
    if(media.parentNode.tagName==='RVMediaCue')media.parentNode.setAttribute('displayName',file.name);
    library.set(name,[file]);assets.set(source,{file,path,originalName:file.name});render();status(`${file.name}으로 교체했습니다. 업데이트 ZIP에 새 미디어가 포함됩니다.`);
  }
  async function exportPackage() {
    const sources=new Set(P.all(model.doc,'RVImageElement, RVVideoElement').map(e=>P.attr(e,'source')));
    const orphan=[...sources].filter(s=>s.startsWith('file:///PP6-Package/') && !assets.has(s));
    // Reopened exported documents can recover their package files through file/folder linking.
    const recovered=[];
    for(const source of orphan) {
      const files=library.get(P.basename(source)) || [];
      if(files.length!==1)throw new Error('이전에 교체한 미디어를 다시 연결해 주세요: '+P.basename(source));
      const path=source.slice('file:///PP6-Package/'.length);
      if(!/^assets\/(Images|Video)\/pp6-[a-f0-9]+\.(png|jpe?g|mp4|mov)$/.test(path))throw new Error('알 수 없는 패키지 미디어 경로입니다.');
      recovered.push({path,data:files[0]});
    }
    const fresh=[...assets].filter(([source])=>sources.has(source)).map(([,asset])=>({path:asset.path,data:asset.file}));
    const unresolved=[...new Set([...sources].filter(s=>!s.startsWith('file:///PP6-Package/')).map(P.basename))].filter(name=>(library.get(name)||[]).length!==1);
    const notes=['예배온 Studio — 실험용 업데이트 패키지','', '문서: '+model.name,'슬라이드: '+P.slides(model).length,'', 'High Sierra + PP6 실기 검증 전입니다. 실제 예배 문서에 바로 덮어쓰지 마세요.', 'assets의 새 미디어는 Mac에서 설치한 후 .pro6 source 경로를 실제 위치로 바꿔야 합니다.', '이 작업을 수행하는 자동 적용 엔진은 아직 없습니다. 현재 단계에서는 읽기 전용 비교/검토용입니다.', '연결한 기존 미디어는 다시 묶지 않았습니다. 교회 Mac에 기존 파일이 있어야 합니다.', '텍스트를 수정한 상자는 첫 글자의 서식으로 통일했습니다. 나머지 요소는 기존 XML을 보존합니다.', '', '이 PC에서 연결을 확인하지 못한 기존 미디어:',...unresolved];
    const entries=[{path:'documents/'+safeName(model.name),data:P.serialize(model)},...fresh,...recovered,{path:'WEB-EDITOR-NOTES.txt',data:notes.join('\n')}];
    if(entries.reduce((n,e)=>n+(e.data instanceof Blob?e.data.size:new TextEncoder().encode(e.data).length),0)>500*1024*1024)throw new Error('업데이트 패키지가 500MB를 넘습니다.');
    const blob=await makeZip(entries);download(blob,`PP6-Update-${safeName(model.name.replace(/\.pro6$/i,''))}-테스트.zip`);dirty=false;
    status(`업데이트 ZIP을 저장했습니다. 문서 1개 · 새 미디어 ${fresh.length+recovered.length}개. 교회 Mac에서 읽기 전용 비교와 별도 복사본으로 검증하세요.`);
  }
  async function exclusive(action) {
    if(busy)return;busy=true;
    const buttons=[...document.querySelectorAll('button,input,select,textarea')];const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
    try{await action();}finally{buttons.forEach((b,i)=>b.disabled=disabled[i]);busy=false;render();}
  }
  $('open').onclick=()=>$('documentFile').click();
  $('sample').onclick=guard(()=>open(window.PP6_SAMPLE.xml,window.PP6_SAMPLE.name));
  $('documentFile').onchange=guard(async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>25*1024*1024)throw new Error('문서는 25MB까지 지원합니다.');open(await file.text(),file.name);});
  $('label').onchange=guard(()=>{if($('label').value===P.attr(current(),'label'))return;snapshot();current().setAttribute('label',$('label').value);refreshPreviewAndList();status('슬라이드 이름을 바꿨습니다.');});
  $('group').onchange=guard(()=>{const slide=current(),group=P.all(model.doc,'RVSlideGrouping')[Number($('group').value)];snapshot();let container=P.ivar(group,'array','slides');if(!container){container=element('array',{rvXMLIvarName:'slides'});group.append(container);}container.append(slide);selected=P.slides(model).indexOf(slide);render();status('선택한 그룹의 마지막으로 이동했습니다.');});
  $('search').oninput=()=>renderList();
  $('add').onclick=guard(()=>{snapshot();const slide=P.duplicate(current(),true);selected=P.slides(model).indexOf(slide);render();status('같은 배경과 텍스트 상자로 새 슬라이드를 추가했습니다. 내용을 입력하세요.');});
  $('duplicate').onclick=guard(()=>{snapshot();const slide=P.duplicate(current());selected=P.slides(model).indexOf(slide);render();status('슬라이드를 복사했습니다. 자동 실행 단서는 복사하지 않습니다.');});
  $('before').onclick=guard(()=>move(-1));$('after').onclick=guard(()=>move(1));
  $('delete').onclick=guard(()=>{if(P.slides(model).length<=1)return;snapshot();current().remove();render();status('슬라이드를 삭제했습니다. 되돌리기로 복원할 수 있습니다.');});
  $('undo').onclick=guard(()=>{const previous=history.pop();if(!previous)return;model=P.parse(previous.xml,model.name);selected=previous.selected;dirty=true;editSerial++;window.dispatchEvent(new Event('yebaeonchange'));render();status('이전 편집으로 되돌렸습니다. 변경을 보관하려면 다시 저장하세요.');});
  $('linkMedia').onclick=()=>$('mediaFiles').click();$('linkFolder').onclick=()=>$('mediaFolder').click();
  for(const id of ['mediaFiles','mediaFolder'])$(id).onchange=guard(e=>{link(Array.from(e.target.files));e.target.value='';});
  $('replaceMedia').onclick=()=>$('replacementFile').click();
  $('replacementFile').onchange=guard(async e=>{const file=e.target.files[0];e.target.value='';if(file)await exclusive(()=>replace(file));});
  $('export').onclick=guard(()=>exclusive(exportPackage));
  $('png').onclick=guard(async()=>{const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=Math.round(1920*model.height/model.width);await R.draw(canvas,model,current(),library);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG 저장에 실패했습니다.');download(blob,`pp6-web-preview-${selected+1}.png`);status('근사 미리보기 PNG를 저장했습니다. PP6 실기 화면과 대조할 때 사용할 수 있습니다.');});
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  function templateSlide(template) {
    if(template.width!==model.width || template.height!==model.height)throw new Error(`템플릿은 ${template.width}×${template.height}입니다. 같은 크기의 문서에서 사용하세요.`);
    const doc=new DOMParser().parseFromString(template.xml,'application/xml');
    if(doc.querySelector('parsererror') || doc.documentElement.tagName!=='RVDisplaySlide')throw new Error('템플릿을 읽지 못했습니다.');
    const slide=model.doc.importNode(doc.documentElement,true);P.refreshIDs(slide);
    const cues=P.ivar(slide,'array','cues');if(cues)cues.replaceChildren();
    for(const key of ['hotKey','notes','chordChartPath'])slide.setAttribute(key,'');
    return slide;
  }
  function applyTemplate(template) {
    const old=current(), copy=templateSlide(template), values=P.textElements(old).map(x=>P.parseRTF(P.textNode(x)?.textContent || '').text), boxes=P.textElements(copy);
    if(boxes.length<values.length)throw new Error('기존 텍스트 상자보다 적은 템플릿입니다. 텍스트를 먼저 정리해 주세요.');
    boxes.forEach((box,i)=>P.setText(box,values[i] || ''));
    copy.setAttribute('label',P.attr(old,'label'));
    snapshot();old.replaceWith(copy);render();status('템플릿을 적용했습니다. 텍스트는 유지되고 배경과 서식은 선택한 템플릿으로 바뀝니다.');
  }
  function addBible(verses,template) {
    if(!verses.length || verses.length>100)throw new Error('한 번에 1~100절을 선택해 주세요.');
    const base=template?templateSlide(template):current().cloneNode(true);
    if(!P.textElements(base).length)throw new Error('말씀 텍스트 상자가 있는 슬라이드나 템플릿을 선택하세요.');
    const copies=verses.map(v=>{const slide=base.cloneNode(true);P.refreshIDs(slide);const cues=P.ivar(slide,'array','cues');if(cues)cues.replaceChildren();for(const key of ['hotKey','notes','chordChartPath'])slide.setAttribute(key,'');const boxes=P.textElements(slide);boxes.forEach((x,i)=>P.setText(x,i===0?(boxes.length===1?v.text+'\n'+v.reference:v.text):i===1?v.reference:''));slide.setAttribute('label',v.reference);return slide;});
    snapshot();let after=current();for(const slide of copies){after.parentNode.insertBefore(slide,after.nextSibling);after=slide;}selected=P.slides(model).indexOf(copies[0]);render();status(`${copies.length}개 말씀 슬라이드를 추가했습니다. 본문·장절 위치와 넘침을 미리보기에서 확인하세요.`);
  }
  window.YebaeonEditor={
    open,applyTemplate,addBible,redraw:render,
    state:()=>({name:model.name,serial:editSerial,dirty}),
    document:()=>({xml:P.serialize(model),name:model.name,serial:editSerial,dirty}),
    markDirty:changed,
    markSaved(serial){if(editSerial===serial)dirty=false;},
    status,
    hasPackageMedia:()=>P.all(model.doc,'[source]').some(el=>P.attr(el,'source').startsWith('file:///PP6-Package/'))
  };
  open(window.PP6_SAMPLE.xml,window.PP6_SAMPLE.name,true);
})();
