(function(){'use strict';
 // 영광임하소서(교회 자체 찬양집) 목록과 찬양 문서의 권장 버전 안내.
 // 목록 곡: 연결된 사용 중 가사찬양이 있으면 가사찬양 권장, 없으면 악보찬양 권장. 그 밖의 곡: 악보찬양 권장.
 // 안내만 한다. 자동으로 바꾸거나 저장을 막지 않는다. 목록은 탭에서 한 번 받아 두고 버전이 바뀔 때만 다시 받는다.
 const C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels;
 const LYRICS='가사찬양',SCORE='악보찬양',SONG=new Set([LYRICS,SCORE]);
 const json=(method,body,extra={})=>({method,headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 let state=null,loading=null,byDoc=new Map();
 const pairCache=new Map();
 function index(){byDoc=new Map();for(const s of state.songs)for(const id of s.links)byDoc.set(id,s);}
 function accept(data,merge=false,keepPairs=false){state={version:data.version,songs:data.songs,lyricsOnly:new Set(data.lyricsOnly||[]),updatedBy:data.updatedBy,updatedAt:data.updatedAt,documents:{...(merge&&state?state.documents:{}),...(data.documents||{})}};index();if(!keepPairs)pairCache.clear();window.dispatchEvent(new Event('yebaeonsongbook'));}
 async function get(etag){
  const response=await fetch('/api/songbook',{credentials:'same-origin',cache:'no-store',headers:etag?{'If-None-Match':etag}:{}});
  if(response.status===304)return null;
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||'영광임하소서 목록을 받지 못했습니다.');}
  return response.json();
 }
 // 처음 한 번 전체를 받는다. 실패하면 다음에 다시 시도한다.
 function ensure(){if(state)return Promise.resolve(state);if(!loading)loading=get().then(data=>{accept(data);return state;}).finally(()=>{loading=null;});return loading;}
 // 버전 확인: 같으면 304(서버 1행). 다를 때만 다시 받는다.
 async function revalidate(){if(!state)return ensure();const data=await get(`"${state.version}"`);if(data)accept(data);return state;}
 // 목록 창을 열 때: 연결 문서의 이름·상태를 새로 본다.
 async function reload(){accept(await get());return state;}

 const doc=id=>state?.documents[id]||null;
 const usable=(id,category)=>{const d=doc(id);return !!d&&d.state==='active'&&d.category===category;};
 const songOf=id=>byDoc.get(id)||null;
 const recommended=song=>song&&song.links.some(id=>usable(id,LYRICS))?LYRICS:SCORE;
 // 찬양 문서의 표시 정보. 다른 카테고리는 null(표시하지 않음). 목록을 아직 못 받았으면 권장을 정하지 않는다.
 function info(d){if(!d||!SONG.has(d.category))return null;if(!state)return {category:d.category,recommended:null,number:null};const song=songOf(d.id);return {category:d.category,recommended:recommended(song)===d.category,number:song?.number??null};}
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 const kind=category=>category===LYRICS?'lyrics':'score';
 // 카테고리 칩: 두 글자로 줄이고(마우스를 올리면 전체 이름), 찬양은 색으로 칠한다. 행 바탕도 같은 색(tint)으로 칠한다.
 const SHORT={'가사찬양':'가사','악보찬양':'악보','예배순서':'예배','특별순서':'특별'};
 function chip(d){if(!d?.category)return null;const c=el('span','doc-category song-chip '+(SONG.has(d.category)?kind(d.category):'other'),SHORT[d.category]||d.category);c.title=d.category;return c;}
 const tint=d=>SONG.has(d?.category)?(d.category===LYRICS?'song-lyrics':'song-score'):'';
 function number(d){const i=info(d);return i?.number?el('small','song-number','영 '+i.number):null;}
 // 검색 결과 순서는 그대로 두되, 목록에 있는 같은 곡의 가사·악보 문서가 함께 나오면 가사를 그 악보 바로 앞에 둔다.
 function arrange(list){if(!state)return list;let out=[...list];
  for(const song of new Set(out.map(d=>SONG.has(d.category)?songOf(d.id):null).filter(Boolean))){
   const mine=out.filter(d=>songOf(d.id)===song),lyrics=mine.filter(d=>d.category===LYRICS),score=mine.find(d=>d.category===SCORE);if(!lyrics.length||!score)continue;
   const rest=out.filter(d=>!lyrics.includes(d));rest.splice(rest.indexOf(score),0,...lyrics);out=rest;}
  return out;}

 // ── 재생목록 순서 ──
 const asDocument=(id,d)=>({id,path:d.path,name:d.path.split('/').pop(),category:d.category,state:'active',available:true});
 // 같은 곡의 다른 버전 사용 중 문서: 목록 곡은 연결로, 목록 밖 곡은 순서를 열 때 물은 이름 맞추기 짝으로.
 function counterparts(d,want){const song=songOf(d.id);if(song)return song.links.filter(id=>id!==d.id&&usable(id,want)).map(id=>asDocument(id,doc(id)));return (pairCache.get(d.id)||[]).filter(x=>x.category===want).map(x=>asDocument(x.id,x));}
 const orderDoc=item=>{const d=item?.kind==='document'?item.document:null;return state&&d&&d.state!=='trashed'&&SONG.has(d.category)?d:null;};
 // 목록 밖 곡의 가사찬양 행만('가사로 쓰는 곡'은 빼고): 같은 곡 악보가 있으면 [악보로], 짝을 물었는데 없으면 [악보 필요].
 const freeLyrics=item=>{const d=orderDoc(item);return d&&d.category===LYRICS&&!songOf(d.id)?d:null;};
 function hint(item){const d=freeLyrics(item);if(!d||state.lyricsOnly.has(d.id)||!pairCache.has(d.id))return null;const targets=counterparts(d,SCORE);return targets.length?{want:SCORE,targets}:{need:true,name:d.name,id:d.id};}
 // '가사로 쓰는 곡' 지정·해제(누구나). 곡 목록은 그대로이고 짝 찾기 결과도 그대로 둔다.
 async function setLyricsOnly(id,on){const data=await(await C().api('/songbook/lyrics-only',json('POST',{id,on}))).json();accept(data,true,true);}
 function lyricsOnlyItem(item){const d=freeLyrics(item);if(!d)return null;const on=state.lyricsOnly.has(d.id);return {label:on?'가사로 쓰기 해제':'가사로 쓰기',action:()=>setLyricsOnly(d.id,!on).catch(error=>alert(error.message))};}
 const hints=items=>items.map(hint);
 // 순서 항목 메뉴의 악보로·가사로 바꾸기 대상(없으면 빈 목록). 찬양이 아니면 null.
 function switches(item){const d=orderDoc(item);return d?{[SCORE]:d.category===LYRICS?counterparts(d,SCORE):[],[LYRICS]:d.category===SCORE?counterparts(d,LYRICS):[]}:null;}
 // 머리줄: 찬양 행이 있으면 색 범례(행 바탕과 같은 색의 네모에 가사·악보).
 function summary(items){return items.some(x=>SONG.has(x?.document?.category))?[el('span','order-legend'),el('span','order-swatch song-lyrics','가사'),el('span','order-swatch song-score','악보')]:[];}
 // 순서를 열 때 한 번: 목록 버전을 확인하고, 목록 밖 찬양 행의 같은 곡 다른 버전을 한 요청으로 묻는다.
 async function prepareOrder(items){try{await revalidate();}catch(_){return false;}
  const ids=[...new Set(items.map(x=>x.kind==='document'?x.document:null).filter(d=>d&&d.state!=='trashed'&&SONG.has(d.category)&&!songOf(d.id)&&!pairCache.has(d.id)).map(d=>d.id))].slice(0,60);
  if(!ids.length)return true;
  try{const data=await(await C().api('/songbook/pairs?'+new URLSearchParams({ids:ids.join(',')}))).json();for(const id of ids)pairCache.set(id,data.pairs[id]||[]);}catch(_){return false;}
  return true;}
 const stem=name=>String(name||'').replace(/\.pro6$/i,'');
 function hintElement(h,{disabled,onPick}){
  if(h.need){const b=el('button','order-tag need','악보 필요');b.type='button';b.onclick=e=>{e.stopPropagation();needDialog(stem(h.name),h.id);};return b;}
  const button=el('button','order-tag go','악보로');button.type='button';button.disabled=!!disabled;
  button.title=h.targets.length===1?stem(h.targets[0].name):`${h.targets.length}개 중 고르기`;
  button.onclick=e=>{e.stopPropagation();if(h.targets.length===1)onPick(h.targets[0]);else window.YebaeonSelection.menu(e,h.targets.map(t=>({label:stem(t.name),action:()=>onPick(t)})));};
  return button;}
 // [악보 필요]: 작업된 악보가 없다는 안내와 PPT 가져오기(악보 용도·악보찬양·이름을 미리 채움).
 function needDialog(name,id){const {el:make}=P(),box=make('dialog',{class:'entry-dialog songbook-need'}),note=make('p',{class:'dialog-message',role:'status'});
  const go=make('button',{type:'button',class:'primary',onclick:()=>{box.close();window.YebaeonPPTImport?.openFor({name:name+' (악보)'});}},'PPT 가져오기');
  const keep=make('button',{type:'button',title:'이 가사 문서는 가사로 씁니다. 순서 항목 메뉴에서 해제할 수 있습니다.',onclick:async()=>{keep.disabled=true;try{await setLyricsOnly(id,true);box.close();}catch(error){note.textContent=error.message;keep.disabled=false;}}},'가사로 쓰기');
  box.append(make('h2',{},name),make('p',{class:'dialog-help'},'영광임하소서에 없는 곡이라 악보찬양을 씁니다.\n아직 악보가 없습니다.'),note,make('div',{class:'dialog-buttons'},make('button',{type:'button',onclick:()=>box.close()},'닫기'),keep,go));
  box.addEventListener('close',()=>box.remove());document.body.append(box);box.showModal();go.focus();}
 // PPT 가져오기로 악보찬양을 만들면(어디서 열었든) 열린 순서의 짝을 다시 물어 [악보 필요]가 [악보로]가 되게 한다.
 window.addEventListener('yebaeonpptimported',e=>{if(e.detail?.document?.category!==SCORE)return;pairCache.clear();const items=window.YebaeonPlaylists?.items()||[];prepareOrder(items).then(ok=>{if(ok)window.dispatchEvent(new Event('yebaeonsongbook'));});});

 // ── 영광임하소서 목록 창 ──
 let dialog=null,admin=false,candidates={},filter='all',query='';
 const say=text=>{const m=document.getElementById('songbookMessage');if(m)m.textContent=text||'';};
 const squeeze=v=>String(v||'').normalize('NFC').toLowerCase().replace(/\s+/g,'');
 const STATE_LABEL={trashed:'휴지통',archived:'보관함'};
 function frame(){
  if(dialog)return dialog;const {el:make}=P();
  const close=make('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>dialog.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const toggle=make('div',{class:'pill-toggle songbook-filter',role:'group','aria-label':'보기'},...[['all','전체'],['check','확인 필요'],['empty','문서 없음']].map(([id,label])=>make('button',{type:'button','data-filter':id,'aria-pressed':String(id===filter),class:id==='check'?'needs-check':'',onclick:()=>{filter=id;render();}},label,make('span',{class:'songbook-count'}))));
  const search=make('input',{type:'search',id:'songbookQuery',placeholder:'번호·검색어·문서 이름','aria-label':'목록 찾기',oninput:()=>{query=squeeze(search.value);render();}});
  dialog=make('dialog',{class:'library-dialog panel-dialog songbook-dialog',id:'songbookDialog','aria-labelledby':'songbookTitle'},
   make('div',{class:'panel-head'},make('h2',{id:'songbookTitle'},'영광임하소서 목록'),
    make('button',{type:'button',id:'songbookPaste',class:'songbook-admin',hidden:true,onclick:openPaste},'목록 붙여넣기'),
    make('button',{type:'button',id:'songbookAdd',class:'songbook-admin',hidden:true,onclick:()=>editSong(null)},'곡 추가'),
    make('span',{class:'panel-gap'}),close),
   make('div',{class:'songbook-tools'},search,toggle),
   make('div',{class:'panel-body'},make('div',{id:'songbookRows',class:'songbook-rows',role:'table','aria-label':'영광임하소서 목록'})),
   make('p',{id:'songbookMessage',class:'panel-foot',role:'status'}));
  document.body.append(dialog);return dialog;}
 async function open(){
  if(!C().needUser())return;frame();P().hideAccount?.();if(!dialog.open)dialog.showModal();say('목록을 불러오고 있습니다…');
  try{
   const [, found, adminState]=await Promise.all([reload(),C().api('/songbook/candidates').then(r=>r.json()),C().api('/admin').then(r=>r.json()).catch(()=>({admin:false}))]);
   candidates=found.candidates||{};admin=!!adminState.admin;
   for(const b of dialog.querySelectorAll('.songbook-admin'))b.hidden=!admin;
   say(state.version?`${state.updatedBy} · ${new Date(state.updatedAt).toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Seoul'})} 저장`:(admin?'아직 목록이 없습니다. [목록 붙여넣기]로 넣어 주세요.':'아직 목록이 없습니다.'));
  }catch(error){say(error.message);}
  render();}
 const candidateList=song=>(candidates[song.number]||[]).filter(d=>!byDoc.has(d.id)&&!song.nots.includes(d.id));
 function docCell(song,category){const cell=el('div','songbook-docs');
  for(const id of song.links){const d=doc(id),cat=d?.category;if((category===LYRICS)!==(cat===LYRICS))continue;
   const line=el('span','songbook-doc'+(d&&d.state==='active'?'':' dim'),d?d.name:'없는 문서');line.title=d?d.path:id;
   if(d&&STATE_LABEL[d.state])line.append(el('small',null,STATE_LABEL[d.state]));if(d&&!SONG.has(cat))line.append(el('small',null,cat||'카테고리 없음'));cell.append(line);}
  return cell;}
 function matches(song){if(!query)return true;if(String(song.number).startsWith(query))return true;
  return song.terms.some(t=>squeeze(t).includes(query))||song.links.some(id=>squeeze(doc(id)?.name).includes(query));}
 function render(){
  if(!dialog)return;const rows=document.getElementById('songbookRows'),songs=state?.songs||[];
  const counts={all:songs.length,check:songs.filter(s=>candidateList(s).length).length,empty:songs.filter(s=>!s.links.length).length};
  for(const b of dialog.querySelectorAll('.songbook-filter button')){b.setAttribute('aria-pressed',String(b.dataset.filter===filter));b.querySelector('.songbook-count').textContent=' '+counts[b.dataset.filter];b.classList.toggle('has-items',b.dataset.filter==='check'&&counts.check>0);}
  const {el:make}=P(),head=make('div',{class:'songbook-row songbook-head',role:'row'},...['번호','검색어','가사찬양','악보찬양'].map(t=>make('span',{role:'columnheader'},t)),admin?make('span',{role:'columnheader','aria-label':'관리'}):null);
  rows.classList.toggle('with-admin',admin);
  const shown=songs.filter(s=>(filter==='all'||(filter==='check'?candidateList(s).length:!s.links.length))&&matches(s));
  rows.replaceChildren(head,...shown.map(song=>{
   const found=candidateList(song).length,terms=make('div',{class:'songbook-terms'},make('strong',{},song.terms[0]||''),...song.terms.slice(1).map(t=>make('span',{},t)),found?make('span',{class:'songbook-candidates'},'후보 '+found):null);
   const row=make('div',{class:'songbook-row line-row',role:'row','data-number':String(song.number)},
    make('div',{class:'songbook-number'},make('strong',{},String(song.number)),song.key?make('small',{},song.key):null),terms,docCell(song,LYRICS),docCell(song,SCORE),
    admin?make('div',{class:'songbook-actions'},make('button',{type:'button',onclick:()=>pick(song)},'고르기'),P().kebab(()=>[{label:'검색어 고치기',onclick:()=>editSong(song)},...song.links.map(id=>({label:'연결 빼기 · '+(doc(id)?.name||id),onclick:()=>change(song,{links:song.links.filter(x=>x!==id)},'연결을 뺐습니다.')})),{label:'곡 지우기',danger:true,onclick:()=>removeSong(song)}])):null);
   return row;}));
  if(!shown.length)rows.append(el('p','songbook-empty',songs.length?'맞는 곡이 없습니다.':'목록이 비어 있습니다.'));
 }
 // 곡 하나 고치기(PATCH). 409면 최신 목록을 다시 읽는다.
 async function patch(number,song){
  try{const data=await(await C().api('/songbook',json('PATCH',{number,song},{'If-Match':`"${state.version}"`}))).json();accept(data,true);return true;}
  catch(error){say(error.message);if(error.status===409){try{await reload();}catch(_){}}render();return false;}}
 async function change(song,fields,done){const next={...song,...fields};if(await patch(song.number,next)){say(done);render();}}
 async function removeSong(song){if(!confirm(`${song.number}번 ‘${song.terms[0]}’을 목록에서 지울까요? 문서는 그대로입니다.`))return;if(await patch(song.number,null)){say(`${song.number}번을 지웠습니다.`);render();}}
 // 곡 추가·검색어 고치기
 function editSong(song){const {el:make}=P();
  const form=make('form',{class:'songbook-form'}),f=(label,input)=>make('label',{class:'field'},label,input);
  const num=make('input',{type:'number',min:1,max:999,required:true,value:song?String(song.number):''}),key=make('input',{maxLength:8,value:song?.key||'',placeholder:'C, Am, Bb'}),terms=make('input',{required:true,value:song?song.terms.join(' / '):'',placeholder:'검색어 / 다른 이름'});
  const message=make('p',{class:'dialog-message',role:'status'}),box=make('dialog',{class:'entry-dialog songbook-edit'});
  form.append(make('h2',{},song?`${song.number}번 고치기`:'곡 추가'),f('번호',num),f('조',key),f('검색어(/로 구분)',terms),message,make('div',{class:'dialog-buttons'},make('button',{type:'button',onclick:()=>box.close()},'취소'),make('button',{class:'primary',type:'submit'},'저장')));
  form.onsubmit=async e=>{e.preventDefault();const next={...(song||{links:[],nots:[]}),number:Number(num.value),key:key.value.trim(),terms:terms.value.split('/').map(t=>t.trim()).filter(Boolean)};
   try{const data=await(await C().api('/songbook',json('PATCH',{number:song?song.number:null,song:next},{'If-Match':`"${state.version}"`}))).json();accept(data,true);box.close();say(song?`${next.number}번을 고쳤습니다.`:`${next.number}번을 넣었습니다.`);render();}
   catch(error){message.textContent=error.message;if(error.status===409)try{await reload();render();}catch(_){}}};
  box.append(form);box.addEventListener('close',()=>box.remove());dialog.append(box);box.showModal();num.focus();}
 // [고르기] 줄의 내용 미리보기. 가사찬양은 첫 가사 두 줄(제목뿐인 장은 건너뜀), 악보찬양과 글 없는 문서는 첫 악보 장(배경 그림만·제목 장은 건너뜀)의 작은 그림.
 // 창에 보이는 줄의 문서만, 창이 열려 있는 동안 문서마다 한 번 받는다(Studio가 문서를 열 때 쓰는 내용 요청, 그림은 PP6Render). 누르면 앞 장 최대 4장을 줄 아래에 펼친다.
 const titleKey=v=>String(v||'').normalize('NFC').replace(/\.pro6$/i,'').replace(/^(?:영\s*\d{1,3}[\s_.-]*|\d{1,3}[\s_.-]+)/,'').replace(/(?:[\s_-]+wide|[\s_-]*ppt|[\s_-]*피피티|-\d+|\d+)$/i,'').toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣]/g,'');
 function slideText(slide){const P6=window.PP6;return P6.textElements(slide).map(e=>{try{return P6.parseRTF(P6.textNode(e)?.textContent||'').text||'';}catch(_){return '';}}).join('\n');}
 const isTitle=(text,name)=>{const k=titleKey(text),n=titleKey(name);return !k||k===n||n.includes(k);};
 function lyricLines(model,name){const lines=[];for(const slide of window.PP6.slides(model)){const text=slideText(slide);if(isTitle(text,name))continue;for(const l of text.split(/\n+/).map(x=>x.trim()).filter(Boolean)){lines.push(l);if(lines.length===2)return lines;}}return lines;}
 const hasImage=slide=>Array.from(window.PP6.ivar(slide,'array','displayElements')?.children||[]).some(e=>e.tagName==='RVImageElement');
 function scoreSlide(model,name){const slides=window.PP6.slides(model);return slides.find(hasImage)||slides.find(s=>!isTitle(slideText(s),name))||slides[0]||null;}
 function slideCanvas(model,slide,width){const c=document.createElement('canvas');c.width=width;c.height=Math.round(width*model.height/model.width);window.PP6Render.draw(c,model,slide,new Map()).catch(()=>{});return c;}
 function previewer(root){
  const cache=new Map(),open=new Set(),fills=new WeakMap();
  const watch='IntersectionObserver' in window?new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){watch.unobserve(e.target);fills.get(e.target)?.();}},{root,rootMargin:'120px'}):null;
  const load=d=>{if(!cache.has(d.id)){const p=d.available===false||!d.id?Promise.reject(Error('none')):C().api('/documents/'+encodeURIComponent(d.id)+'/content').then(r=>r.text()).then(xml=>window.PP6.parse(xml,d.name||'문서'));p.catch(()=>{});cache.set(d.id||'',p);}return cache.get(d.id||'');};
  const panel=(d,row,model)=>{row.nextElementSibling?.classList.contains('songbook-pick-slides')&&row.nextElementSibling.remove();if(!open.has(d.id))return;
   const slides=window.PP6.slides(model).slice(0,4),box=document.createElement('div');box.className='songbook-pick-slides';for(const slide of slides)box.append(slideCanvas(model,slide,240));row.after(box);};
  function look(d,row){
   const button=document.createElement('button');button.type='button';button.className='songbook-preview';button.disabled=true;button.textContent='…';
   const fill=async()=>{
    try{const model=await load(d),lines=d.category==='가사찬양'?lyricLines(model,d.name):[];
     if(lines.length){const text=lines.join(' / ');button.replaceChildren(el('span','songbook-preview-text',text));button.title=text;}
     else{const slide=scoreSlide(model,d.name);if(!slide)throw Error('none');button.replaceChildren(slideCanvas(model,slide,176));}
     button.disabled=false;button.onclick=()=>{if(open.has(d.id))open.delete(d.id);else open.add(d.id);button.setAttribute('aria-expanded',String(open.has(d.id)));panel(d,row,model);};button.setAttribute('aria-expanded',String(open.has(d.id)));if(open.has(d.id))panel(d,row,model);}
    catch(_){button.replaceChildren(el('span','songbook-preview-none','미리보기 없음'));button.disabled=true;}};
   if(watch){fills.set(button,fill);watch.observe(button);}else fill();
   return button;}
  look.stop=()=>watch?.disconnect();
  return look;}
 // [고르기]: 후보와 문서 검색에서 골라 [연결] 또는 [아님]. 가사·악보는 문서 카테고리를 따른다.
 function pick(song){const {el:make}=P(),box=make('dialog',{class:'library-dialog panel-dialog songbook-pick'});
  const close=make('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>box.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const input=make('input',{type:'search',placeholder:'문서 이름·본문','aria-label':'문서 찾기'}),list=make('div',{class:'panel-body songbook-pick-list'}),note=make('p',{class:'panel-foot',role:'status'});
  let found=[];
  const current=()=>state.songs.find(s=>s.number===song.number)||song;
  const look=previewer(list);
  const line=(d,actions)=>{const body=make('span',{class:'songbook-pick-body'},make('span',{class:'songbook-pick-name'},d.name.replace(/\.pro6$/i,''))),row=make('div',{class:'line-row songbook-pick-row'},make('span',{class:'line-title'},chip(d)||make('span',{class:'line-chip muted'},d.category||'카테고리 없음'),body),...actions);body.append(look(d,row));return row;};
  const act=(label,fn,disabled=false,cls='')=>make('button',{type:'button',class:cls,disabled,onclick:fn},label);
  async function apply(fields,text){const s=current();if(await patch(s.number,{...s,...fields})){note.textContent=text;for(const k of Object.keys(candidates))candidates[k]=candidates[k].filter(d=>!byDoc.has(d.id));draw();render();}}
  function choices(d){const s=current(),linked=s.links.includes(d.id),other=byDoc.get(d.id),not=s.nots.includes(d.id),ok=SONG.has(d.category);
   if(linked)return [make('span',{class:'line-meta'},'연결됨')];if(other&&other!==s)return [make('span',{class:'line-meta'},`${other.number}번에 연결됨`)];
   return [act('연결',()=>apply({links:[...s.links,d.id],nots:s.nots.filter(x=>x!==d.id)},`‘${d.name.replace(/\.pro6$/i,'')}’을 연결했습니다.`),!ok,'primary'),not?act('아님 취소',()=>apply({nots:s.nots.filter(x=>x!==d.id)},'아님을 취소했습니다.')):act('아님',()=>apply({nots:[...s.nots,d.id]},`‘${d.name.replace(/\.pro6$/i,'')}’은 이 곡이 아님으로 두었습니다.`),!ok)];}
  function draw(){const s=current(),groups=[];
   const linked=s.links.map(id=>doc(id)?{id,...doc(id)}:{id,name:'없는 문서',category:null});
   if(linked.length)groups.push(['연결',linked.map(d=>line(d,[act('연결 빼기',()=>apply({links:s.links.filter(x=>x!==d.id)},'연결을 뺐습니다.'))]))]);
   const cands=candidateList(s);if(cands.length)groups.push(['후보',cands.map(d=>line(d,choices(d)))]);
   if(found.length)groups.push(['찾은 문서',found.map(d=>line(d,choices(d)))]);
   const nots=s.nots.map(id=>doc(id)?{id,...doc(id)}:{id,name:'없는 문서',category:null});if(nots.length)groups.push(['아님',nots.map(d=>line(d,[act('아님 취소',()=>apply({nots:s.nots.filter(x=>x!==d.id)},'아님을 취소했습니다.'))]))]);
   list.replaceChildren(...groups.flatMap(([title,rows])=>[make('div',{class:'line-day'},title),...rows]));if(!groups.length)list.append(make('p',{class:'songbook-empty'},'후보가 없습니다. 위 검색칸에서 문서를 찾아 주세요.'));}
  async function find(){const q=input.value.trim();if(!q){found=[];draw();return;}note.textContent='찾는 중…';
   try{found=(await window.YebaeonSearch.query(q)).documents.filter(d=>d.available!==false).slice(0,30);note.textContent=found.length?'':'검색 결과가 없습니다.';}catch(error){note.textContent=error.message;}draw();}
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();find();}});
  box.append(make('div',{class:'panel-head'},make('h2',{},`${song.number}번 ${song.terms[0]||''}`),make('span',{class:'panel-gap'}),close),make('div',{class:'songbook-tools'},input,make('button',{type:'button',onclick:find},'검색')),list,note);
  box.addEventListener('close',()=>{look.stop();box.remove();});dialog.append(box);box.showModal();draw();input.focus();}
 // [목록 붙여넣기]: 번호<TAB>조<TAB>검색어(/)<TAB>연결 id(,)<TAB>아님 id(,). 첫 줄이 '번호'로 시작하면 머리줄.
 function parse(text){const songs=[],labels=[],errors=[],ids=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
  String(text||'').replace(/^﻿/,'').split(/\r?\n/).forEach((line,i)=>{if(!line.trim())return;if(i===0&&/^\s*번호/.test(line))return;const cols=line.split('\t'),label=`${i+1}행`;
   if(cols.length<3){errors.push(`${label}: 번호·조·검색어 세 칸이 탭으로 나뉘어 있어야 합니다.`);return;}
   const n=cols[0].trim();songs.push({number:/^\d{1,4}$/.test(n)?Number(n):null,key:cols[1].trim(),terms:cols[2].split('/').map(t=>t.trim()).filter(Boolean),links:ids(cols[3]),nots:ids(cols[4])});labels.push(label);});
  return {songs,labels,errors};}
 const sameSong=(a,b)=>a&&b&&JSON.stringify([a.key,a.terms,[...a.links].sort(),[...a.nots].sort()])===JSON.stringify([b.key,b.terms,[...b.links].sort(),[...b.nots].sort()]);
 function openPaste(){const {el:make}=P(),box=make('dialog',{class:'library-dialog panel-dialog songbook-paste'});
  const close=make('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>box.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const area=make('textarea',{id:'songbookPasteText',spellcheck:false,placeholder:'번호\t조\t검색어(/로 구분)\t연결 문서 id(,로 구분)\t아님 문서 id(,로 구분)','aria-label':'목록 붙여넣기'});
  const preview=make('div',{id:'songbookPreview',class:'songbook-preview',role:'status'}),save=make('button',{type:'button',class:'primary',id:'songbookPasteSave',disabled:true},'저장'),message=make('p',{class:'panel-foot',role:'status'});
  let checked=null,timer=null,sequence=0;
  function show(parsed,result){preview.replaceChildren();const errors=[...parsed.errors,...(result?.errors||[])];
   const links=parsed.songs.reduce((n,s)=>n+s.links.length,0),before=new Map((state?.songs||[]).map(s=>[s.number,s])),after=new Set(parsed.songs.map(s=>s.number));
   const added=parsed.songs.filter(s=>!before.has(s.number)).length,changed=parsed.songs.filter(s=>before.has(s.number)&&!sameSong(before.get(s.number),s)).length,removed=[...before.keys()].filter(n=>!after.has(n)).length;
   const docs=result?.documents||{},dim=parsed.songs.flatMap(s=>s.links).map(id=>docs[id]?.state).filter(x=>x&&x!=='active');
   preview.append(make('div',{class:'songbook-preview-sum'},make('strong',{},`곡 ${parsed.songs.length} · 연결 ${links}`),make('span',{},`새로 ${added} · 바뀜 ${changed} · 빠짐 ${removed}`),dim.length?make('span',{},['trashed','archived'].map(k=>dim.filter(x=>x===k).length?`${STATE_LABEL[k]} ${dim.filter(x=>x===k).length}`:'').filter(Boolean).join(' · ')):null));
   if(errors.length)preview.append(make('ul',{class:'songbook-errors'},...errors.slice(0,30).map(e=>make('li',{},e)),errors.length>30?make('li',{},`… 외 ${errors.length-30}건`):null));
   save.disabled=!result||errors.length>0||!parsed.songs.length;}
  async function check(){const text=area.value,g=++sequence,parsed=parse(text);checked=null;save.disabled=true;
   if(!text.trim()){preview.replaceChildren();return;}
   if(parsed.errors.length||!parsed.songs.length){show(parsed,null);return;}
   preview.prepend(make('p',{class:'hint'},'서버 문서와 맞춰 보는 중…'));
   try{const result=await(await C().api('/songbook?dryRun=1',json('PUT',{songs:parsed.songs,labels:parsed.labels}))).json();if(g!==sequence)return;checked={text,parsed};show(parsed,result);}
   catch(error){if(g===sequence){show(parsed,null);message.textContent=error.message;}}}
  area.addEventListener('input',()=>{clearTimeout(timer);sequence++;checked=null;save.disabled=true;preview.replaceChildren();message.textContent='';timer=setTimeout(check,500);});
  save.onclick=async()=>{if(!checked||checked.text!==area.value)return;save.disabled=true;message.textContent='저장하는 중…';
   try{const data=await(await C().api('/songbook',json('PUT',{songs:checked.parsed.songs,labels:checked.parsed.labels},{'If-Match':`"${state.version}"`}))).json();accept(data);
    try{candidates=(await(await C().api('/songbook/candidates')).json()).candidates||{};}catch(_){}
    box.close();say(`목록을 저장했습니다. 곡 ${state.songs.length}`);render();}
   catch(error){message.textContent=error.message;save.disabled=false;if(error.status===409)try{await reload();render();}catch(_){}}};
  box.append(make('div',{class:'panel-head'},make('h2',{},'목록 붙여넣기'),make('span',{class:'panel-gap'}),close),make('div',{class:'panel-body songbook-paste-body'},area,preview),make('div',{class:'songbook-paste-foot'},make('button',{type:'button',onclick:()=>box.close()},'취소'),save),message);
  box.addEventListener('close',()=>box.remove());dialog.append(box);box.showModal();area.focus();}

 document.getElementById('songbookOpen')?.addEventListener('click',open);
 window.addEventListener('yebaeonsession',e=>{if(!e.detail?.authenticated){state=null;pairCache.clear();byDoc=new Map();}});
 window.YebaeonSongbook={ensure,revalidate,reload,info,chip,tint,number,arrange,hints,switches,lyricsOnlyItem,summary,prepareOrder,hintElement,open,state:()=>state,parse};
})();
