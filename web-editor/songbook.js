(function(){'use strict';
 // 영광임하소서(교회 자체 찬양집) 목록과 찬양 문서의 권장 버전 안내.
 // 목록 곡: 연결된 사용 중 가사찬양이 있으면 가사찬양 권장, 없으면 악보찬양 권장. 그 밖의 곡: 악보찬양 권장.
 // 안내만 한다. 자동으로 바꾸거나 저장을 막지 않는다. 목록은 탭에서 한 번 받아 두고 버전이 바뀔 때만 다시 받는다.
 const C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels;
 const LYRICS='가사찬양',SCORE='악보찬양',SONG=new Set([LYRICS,SCORE]);
 const json=(method,body,extra={})=>({method,headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 let state=null,loading=null,byDoc=new Map(),byGroup=new Map();
 const pairCache=new Map();
 function index(){byDoc=new Map();byGroup=new Map();for(const s of state.songs)for(const id of s.links)byDoc.set(id,s);for(const g of state.groups)for(const id of g)byGroup.set(id,g);}
 function accept(data,merge=false,keepPairs=false){state={version:data.version,songs:data.songs,lyricsOnly:new Set(data.lyricsOnly||[]),groups:data.groups||[],updatedBy:data.updatedBy,updatedAt:data.updatedAt,documents:{...(merge&&state?state.documents:{}),...(data.documents||{})}};index();if(!keepPairs)pairCache.clear();window.dispatchEvent(new Event('yebaeonsongbook'));}
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
 const groupOf=id=>byGroup.get(id)||null;
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
 // 검색 결과: 가사찬양 바로 다음에 그 곡의 사용 중 악보찬양(목록 연결이나 저장된 짝)을 잇는다. 결과에 이미 있던 악보는 옮기고(앞에 있었으면 가사를 그 자리로 올린다),
 // 결과에 없던 악보는 받아 둔 목록 정보로 넣고 '가사로 찾음'을 단다(요청을 더 하지 않으므로 사용일 등은 비어 있다). 같은 문서는 한 번만 나온다.
 function arrange(list){if(!state)return list;const out=[...list],placed=new Set();
  for(let i=0;i<out.length;i++){const d=out[i];if(d.category!==LYRICS||placed.has(d.id))continue;
   const pairs=counterparts(d,SCORE,true).filter(x=>!placed.has(x.id));if(!pairs.length)continue;
   let at=i;for(const p of pairs){const j=out.findIndex(x=>x.id===p.id);if(j>=0&&j<at)at=j;}
   const block=[d,...pairs.map(p=>out.find(x=>x.id===p.id)||{...p,matchedBy:'pair'})],ids=new Set(block.map(x=>x.id));
   const rest=out.filter(x=>!ids.has(x.id)),before=out.slice(0,at).filter(x=>!ids.has(x.id)).length;rest.splice(before,0,...block);out.splice(0,out.length,...rest);
   for(const x of block)placed.add(x.id);i=before+block.length-1;}
  return out;}
 const pairTag=d=>d?.matchedBy==='pair'?el('small','song-paired','가사로 찾음'):null;

 // ── 재생목록 순서 ──
 const asDocument=(id,d)=>({id,path:d.path,name:d.path.split('/').pop(),category:d.category,state:'active',available:true});
 // 같은 곡의 다른 버전 사용 중 문서: 목록 곡은 연결로, 목록 밖 곡은 저장된 짝으로, 둘 다 없으면 이름 맞추기(stored면 이름 맞추기는 보지 않는다).
 function counterparts(d,want,stored=false){const ids=songOf(d.id)?.links||groupOf(d.id);if(ids)return ids.filter(id=>id!==d.id&&usable(id,want)).map(id=>asDocument(id,doc(id)));if(stored)return [];return (pairCache.get(d.id)||[]).filter(x=>x.category===want).map(x=>asDocument(x.id,x));}
 const orderDoc=item=>{const d=item?.kind==='document'?item.document:null;return state&&d&&d.state!=='trashed'&&SONG.has(d.category)?d:null;};
 // 목록 밖 곡의 가사찬양 행만('가사로 쓰는 곡'은 빼고): 같은 곡 악보가 있으면 [악보로], 짝을 물었는데 없으면 [악보 필요].
 const freeLyrics=item=>{const d=orderDoc(item);return d&&d.category===LYRICS&&!songOf(d.id)?d:null;};
 function hint(item){const d=freeLyrics(item);if(!d||state.lyricsOnly.has(d.id)||(!groupOf(d.id)&&!pairCache.has(d.id)))return null;const targets=counterparts(d,SCORE);return targets.length?{want:SCORE,targets}:{need:true,name:d.name,id:d.id};}
 // '가사로 쓰는 곡' 지정·해제(누구나). 곡 목록은 그대로이고 짝 찾기 결과도 그대로 둔다.
 async function setLyricsOnly(id,on){const data=await(await C().api('/songbook/lyrics-only',json('POST',{id,on}))).json();accept(data,true,true);}
 function lyricsOnlyItem(item){const d=freeLyrics(item);if(!d)return null;const on=state.lyricsOnly.has(d.id);return {label:on?'예외 처리 해제':'예외 처리',action:()=>setLyricsOnly(d.id,!on).catch(error=>alert(error.message))};}
 // 순서를 그릴 때: 아직 묻지 않은 목록 밖·짝 밖 찬양 문서만 한 요청(최대 60)으로 짝을 묻고, 답이 오면 다시 그린다.
 // 순서를 연 뒤 붙여넣기·교체·초안 복구로 들어온 문서도 이것으로 잡힌다. 묻는 중인 문서는 거듭 묻지 않고, 실패한 문서는 순서를 다시 열 때까지 묻지 않는다.
 const pairAsking=new Set(),pairFailed=new Set();
 const unpaired=items=>[...new Set(items.map(x=>x?.kind==='document'?x.document:null).filter(d=>d&&d.state!=='trashed'&&SONG.has(d.category)&&!songOf(d.id)&&!groupOf(d.id)&&!pairCache.has(d.id)&&!pairAsking.has(d.id)&&!pairFailed.has(d.id)).map(d=>d.id))].slice(0,60);
 function askPairs(items){if(!state)return;const ids=unpaired(items);if(!ids.length)return;for(const id of ids)pairAsking.add(id);
  C().api('/songbook/pairs?'+new URLSearchParams({ids:ids.join(',')})).then(r=>r.json()).then(data=>{for(const id of ids)pairCache.set(id,data.pairs?.[id]||[]);},()=>{for(const id of ids)pairFailed.add(id);})
   .finally(()=>{for(const id of ids)pairAsking.delete(id);window.dispatchEvent(new Event('yebaeonsongbook'));});}
 const hints=items=>{askPairs(items);return items.map(hint);};
 // 순서 항목 메뉴의 악보로·가사로 바꾸기 대상(없으면 빈 목록). 찬양이 아니면 null.
 function switches(item){const d=orderDoc(item);return d?{[SCORE]:d.category===LYRICS?counterparts(d,SCORE):[],[LYRICS]:d.category===SCORE?counterparts(d,LYRICS):[]}:null;}
 // 머리줄: 찬양 행이 있으면 색 범례(행 바탕과 같은 색의 네모에 가사·악보).
 function summary(items){return items.some(x=>SONG.has(x?.document?.category))?[el('span','order-legend'),el('span','order-swatch song-lyrics','가사'),el('span','order-swatch song-score','악보')]:[];}
 // 순서를 열 때 한 번: 목록 버전을 확인하고(실패 기록은 비운다), 목록 밖 찬양 행의 같은 곡 다른 버전을 한 요청으로 묻는다.
 async function prepareOrder(items){pairFailed.clear();try{await revalidate();}catch(_){return false;}
  const ids=unpaired(items);
  if(!ids.length)return true;
  for(const id of ids)pairAsking.add(id);
  try{const data=await(await C().api('/songbook/pairs?'+new URLSearchParams({ids:ids.join(',')}))).json();for(const id of ids)pairCache.set(id,data.pairs[id]||[]);}catch(_){for(const id of ids)pairFailed.add(id);return false;}
  finally{for(const id of ids)pairAsking.delete(id);}
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
  const go=make('button',{type:'button',class:'primary',onclick:()=>{box.close();window.YebaeonPPTImport?.openFor({name:name+' (악보)',pairWith:{id,name,order:window.YebaeonPlaylists?.selectedPlaylist()?.key||null}});}},'PPT 가져오기');
  const keep=make('button',{type:'button',title:'이 곡은 가사로 씁니다. 악보 표시를 달지 않고, 순서 항목 메뉴에서 해제할 수 있습니다.',onclick:async()=>{keep.disabled=true;try{await setLyricsOnly(id,true);box.close();}catch(error){note.textContent=error.message;keep.disabled=false;}}},'예외 처리');
  box.append(make('h2',{},name),make('p',{class:'dialog-help'},'영광임하소서에 없는 곡이라 악보찬양을 씁니다.\n아직 악보가 없습니다.'),note,make('div',{class:'dialog-buttons'},make('button',{type:'button',onclick:()=>box.close()},'닫기'),keep,go));
  box.addEventListener('close',()=>box.remove());document.body.append(box);box.showModal();go.focus();}
 // 순서 항목 메뉴 '짝 고르기…': 목록 밖 찬양 행만.
 function pairItem(item){const d=orderDoc(item);return d&&!songOf(d.id)?{label:'짝 고르기…',action:()=>pairDialog(d)}:null;}
 // [짝 고르기] 창: 위에 지금 짝(없으면 이름 맞추기 후보), 아래에 문서 검색(본문 포함, 이 문서와 다른 쪽 카테고리만: 가사면 악보, 악보면 가사). [짝으로]는 이 문서의 짝에 더하고(그 문서가 다른 짝에 있으면 두 짝을 합친다), [빼기]는 짝에서 뺀다.
 // 줄 모양과 미리보기는 목록 [고르기]와 같다. 목록 곡에 연결된 문서는 고를 수 없다.
 function pairDialog(d){const {el:make}=P(),box=make('dialog',{class:'library-dialog panel-dialog songbook-pick songbook-pair'});
  const close=make('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>box.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const input=make('input',{type:'search',placeholder:'문서 이름·본문','aria-label':'문서 찾기',value:stem(d.name)}),list=make('div',{class:'panel-body songbook-pick-list'}),note=make('p',{class:'panel-foot',role:'status'});
  const look=previewer(list),self={id:d.id,name:d.name,path:d.path,category:d.category};let found=[],busy=false;
  const view=id=>id===d.id?self:doc(id)?{id,...doc(id)}:{id,name:'없는 문서',category:null};
  const line=(x,actions)=>{const body=make('span',{class:'songbook-pick-body'},make('span',{class:'songbook-pick-name'},stem(x.name))),row=make('div',{class:'line-row songbook-pick-row'+(x.state&&x.state!=='active'?' dim':'')},make('span',{class:'line-title'},chip(x)||make('span',{class:'line-chip muted'},x.category||'카테고리 없음'),body),...actions);if(x.category)body.append(look(x,row));return row;};
  const act=(label,fn,disabled=false,cls='',title='')=>make('button',{type:'button',class:cls,disabled:disabled||busy,title,onclick:fn},label);
  const mine=()=>groupOf(d.id)||[d.id];
  async function run(body,text){busy=true;draw();note.textContent='저장하는 중…';try{await saveGroup(body);note.textContent=text;}catch(error){note.textContent=error.message;}busy=false;draw();}
  function choices(x){const song=songOf(x.id);if(song)return [make('span',{class:'line-meta'},`${song.number}번에 연결됨`)];if(mine().includes(x.id))return [make('span',{class:'line-meta'},'짝')];
   const next=[...new Set([...mine(),...(groupOf(x.id)||[x.id])])],cats=next.map(id=>id===x.id?x.category:view(id).category),ok=SONG.has(x.category)&&cats.includes(LYRICS)&&cats.includes(SCORE);
   return [act('짝으로',()=>run({add:next},`‘${stem(x.name)}’을 짝으로 두었습니다.`),!ok,'primary',ok?'':'가사찬양과 악보찬양을 하나 이상씩 묶습니다.')];}
  function draw(){const g=groupOf(d.id),sections=[];
   if(g)sections.push(['짝',g.map(id=>{const x=view(id);return line(x,[id===d.id?make('span',{class:'line-meta'},'이 문서'):act('빼기',()=>run({remove:id},`‘${stem(x.name)}’을 짝에서 뺐습니다.`))]);})]);
   else{const guess=(pairCache.get(d.id)||[]).filter(x=>!songOf(x.id));sections.push(['짝',[line(self,[make('span',{class:'line-meta'},'이 문서')])]]);if(guess.length)sections.push(['후보',guess.map(x=>line(x,choices(x)))]);}
   const shown=new Set([...(g||[d.id]),...(g?[]:(pairCache.get(d.id)||[]).map(x=>x.id))]),rest=found.filter(x=>!shown.has(x.id));
   if(rest.length)sections.push(['찾은 문서',rest.map(x=>line(x,choices(x)))]);
   list.replaceChildren(...sections.flatMap(([title,rows])=>[make('div',{class:'line-day'},title),...rows]));}
  async function find(){const q=input.value.trim();if(!q){found=[];draw();return;}note.textContent='찾는 중…';
   try{found=(await window.YebaeonSearch.query(q)).documents.filter(x=>x.available!==false&&x.category===(d.category===LYRICS?SCORE:LYRICS)).slice(0,30);note.textContent=found.length?'':'검색 결과가 없습니다.';}catch(error){note.textContent=error.message;}draw();}
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();find();}});
  box.append(make('div',{class:'panel-head'},make('h2',{},'짝 고르기'),make('span',{class:'songbook-pair-name'},stem(d.name)),make('span',{class:'panel-gap'}),close),make('div',{class:'songbook-tools'},input,make('button',{type:'button',onclick:find},'검색')),list,note);
  box.addEventListener('close',()=>{look.stop();box.remove();});document.body.append(box);box.showModal();draw();input.focus();}
 // PPT 가져오기의 '짝 찬양' 줄(새 악보찬양 문서). 이름으로 찾은 가사찬양은 '자동 추천'으로만 보이고 [짝으로]를 눌러야 짝이 된다.
 // [악보 필요]에서 열었으면 그 가사 문서가 처음부터 짝이다. 목록 곡 가사면 짝을 저장하지 않는다(목록 [고르기]에서 연결).
 // 고른 가사에 이미 악보 짝이 있으면 '옛 악보 짝에서 빼기'(기본 켬)를 고른다. 이름이 바뀌어 잠깐 멈추면 이름마다 한 번 묻는다.
 function pairPicker(root){
  let chosen=null,suggested=null,asked=null,timer=null,searching=false,drop=true,generation=0,name='';
  const {el:make}=P(),btn=(label,fn,cls='')=>make('button',{type:'button',class:cls,onclick:fn},label);
  const label=()=>make('span',{class:'ppt-pair-label'},'짝 찬양');
  const title=x=>{const t=make('span',{class:'ppt-pair-name'},stem(x.name));const n=songOf(x.id)?.number;if(n)t.append(el('small','song-number','영 '+n));return t;};
  const olds=()=>chosen&&!songOf(chosen.id)?(groupOf(chosen.id)||[]).filter(id=>doc(id)?.category===SCORE):[];
  function draw(){const rows=[];const x=chosen||suggested;
   if(x&&songOf(x.id))rows.push(make('div',{class:'ppt-pair-row'},label(),chip({category:LYRICS}),title(x),make('span',{class:'line-meta'},'목록 곡'),btn('다른 찬양…',()=>{searching=!searching;draw();})));
   else if(chosen){const row=make('div',{class:'ppt-pair-row chosen'},label(),chip({category:LYRICS}),title(chosen),btn('풀기',()=>{chosen=null;draw();}));rows.push(row);
    const old=olds();if(old.length){const box=make('input',{type:'checkbox',checked:drop,onchange:()=>{drop=box.checked;}});rows.push(make('label',{class:'ppt-pair-old'},box,' 옛 악보 ',make('span',{class:'ppt-pair-oldname'},old.map(id=>stem(doc(id)?.name)).join(', ')),' 짝에서 빼기'));}}
   else if(suggested){const t=title(suggested);t.append(make('span',{class:'ppt-pair-auto'},'자동 추천'));rows.push(make('div',{class:'ppt-pair-row suggested'},label(),chip({category:LYRICS}),t,btn('짝으로',()=>{chosen=suggested;draw();},'primary'),btn('다른 찬양…',()=>{searching=!searching;draw();})));}
   else rows.push(make('div',{class:'ppt-pair-row'},label(),make('span',{class:'ppt-pair-name muted'},'없음'),btn('고르기…',()=>{searching=!searching;draw();})));
   const holder=make('div',{class:'ppt-pair-search'});rows.push(holder);root.replaceChildren(...rows);
   if(searching){const b=window.YebaeonSearch.box(holder,{value:stem(name).replace(/\s*\(악보\)$/,''),label:'짝 찬양 찾기',placeholder:'가사찬양 이름·본문',limit:8,pairs:false,only:d=>d.category===LYRICS,onPick:d=>{chosen={id:d.id,name:d.name,path:d.path};searching=false;draw();}});b.focus();}}
  async function ask(){const n=name.trim();if(!n||n===asked||chosen)return;asked=n;const g=++generation;
   try{await ensure();const data=await(await C().api('/songbook/pairs?'+new URLSearchParams({name:n}))).json();if(g!==generation)return;suggested=data.matches?.[0]||null;}catch(_){if(g===generation)suggested=null;}
   if(g===generation)draw();}
  return {
   // 새로 열 때. preset({id, name}: 가사 문서)이 있으면 그것이 짝이다.
   reset(preset=null){clearTimeout(timer);generation++;chosen=preset?{id:preset.id,name:preset.name||''}:null;suggested=null;asked=null;searching=false;drop=true;name='';draw();if(preset)ensure().then(draw,()=>{});},
   name(value){name=String(value||'');clearTimeout(timer);timer=setTimeout(ask,500);},
   // 저장할 짝: {pairWith, pairDrop}. 고르지 않았거나 목록 곡이면 null.
   value(){return chosen&&!songOf(chosen.id)?{pairWith:chosen.id,pairDrop:drop?olds():[]}:null;}};}
 // 짝 저장(누구나): add는 그 문서들을 한 짝으로(다른 짝에 있던 문서는 옮긴다), remove는 짝에서 뺀다.
 async function saveGroup(body){const data=await(await C().api('/songbook/groups',json('POST',body))).json();accept(data,true,true);return state;}
 // PPT 가져오기로 악보찬양을 만들면(어디서 열었든) 열린 순서의 짝을 다시 물어 [악보 필요]가 [악보로]가 되게 한다.
 // [악보 필요]에서 연 가져오기면 그 가사 문서(목록 곡이 아니면)와 새 악보를 짝으로 저장하고, 그 순서가 아직 열려 있으면 가사 항목을 새 악보로 바꿔 저장한다.
 window.addEventListener('yebaeonpptimported',async e=>{const made=e.detail?.document,lyrics=e.detail?.pairWith;if(made?.category!==SCORE)return;
  const drop=new Set(e.detail?.pairDrop||[]);
  if(lyrics&&state&&!songOf(lyrics))try{await saveGroup({add:[...(groupOf(lyrics)||[lyrics]).filter(id=>!drop.has(id)),made.id]});}catch(error){window.YebaeonEditor?.status?.('짝을 저장하지 못했습니다: '+error.message);}
  const order=e.detail?.replaceIn,L=window.YebaeonPlaylists;
  if(lyrics&&order&&L?.selectedPlaylist()?.key===order)L.replaceDocument(lyrics,made).then(ok=>{if(ok)window.YebaeonEditor?.status?.(`순서의 ‘${stem(made.name||made.path?.split('/').pop())}’로 바꿔 저장했습니다.`);},()=>{});
  pairCache.clear();const items=window.YebaeonPlaylists?.items()||[];prepareOrder(items).then(ok=>{if(ok)window.dispatchEvent(new Event('yebaeonsongbook'));});});

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
    make('button',{type:'button',id:'songbookGroupPaste',class:'songbook-admin',hidden:true,onclick:openGroupPaste},'짝 붙여넣기'),
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

 // [짝 붙여넣기]: 한 줄에 한 짝, 문서 id를 쉼표로. 탭 뒤는 메모(무시), 빈 줄과 #로 시작하는 줄은 건너뛴다. 저장하면 지금 짝 전체를 바꾼다.
 function parseGroups(text){const groups=[],labels=[];
  String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).forEach((line,i)=>{const t=line.split('\t')[0].trim();if(!t||t.startsWith('#'))return;groups.push(t.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));labels.push(`${i+1}줄`);});
  return {groups,labels};}
 function groupChanges(groups){const key=g=>[...g].sort().join(','),now=state?.groups||[],nowKeys=new Set(now.map(key)),nextKeys=new Set(groups.map(key)),nowIds=new Set(now.flat()),nextIds=new Set(groups.flat());
  const same=groups.filter(g=>nowKeys.has(key(g))).length,changed=groups.filter(g=>!nowKeys.has(key(g))&&g.some(id=>nowIds.has(id))).length;
  return {added:groups.length-same-changed,changed,removed:now.filter(g=>!nextKeys.has(key(g))&&!g.some(id=>nextIds.has(id))).length};}
 function openGroupPaste(){const {el:make}=P(),box=make('dialog',{class:'library-dialog panel-dialog songbook-paste'});
  const close=make('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>box.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const area=make('textarea',{id:'songbookGroupText',spellcheck:false,placeholder:'# 한 줄에 한 곡. 문서 id를 쉼표로. 탭 뒤는 메모','aria-label':'짝 붙여넣기'});
  const preview=make('div',{id:'songbookGroupPreview',class:'songbook-preview',role:'status'}),save=make('button',{type:'button',class:'primary',id:'songbookGroupSave',disabled:true},'저장'),message=make('p',{class:'panel-foot',role:'status'});
  let checked=null,timer=null,sequence=0;
  function show(parsed,result){preview.replaceChildren();const errors=result?.errors||[],c=groupChanges(parsed.groups);
   preview.append(make('div',{class:'songbook-preview-sum'},make('strong',{},`짝 ${parsed.groups.length} · 문서 ${new Set(parsed.groups.flat()).size}`),make('span',{},`새로 ${c.added} · 바뀜 ${c.changed} · 빠짐 ${c.removed}`)));
   if(errors.length)preview.append(make('ul',{class:'songbook-errors'},...errors.slice(0,30).map(e=>make('li',{},e)),errors.length>30?make('li',{},`… 외 ${errors.length-30}건`):null));
   save.disabled=!result||errors.length>0;}
  async function check(){const text=area.value,g=++sequence,parsed=parseGroups(text);checked=null;save.disabled=true;if(!text.trim()){preview.replaceChildren();return;}
   preview.prepend(make('p',{class:'hint'},'서버 문서와 맞춰 보는 중…'));
   try{const result=await(await C().api('/songbook/groups?dryRun=1',json('PUT',parsed))).json();if(g!==sequence)return;checked={text,parsed};show(parsed,result);}
   catch(error){if(g===sequence){show(parsed,null);message.textContent=error.message;}}}
  area.addEventListener('input',()=>{clearTimeout(timer);sequence++;checked=null;save.disabled=true;preview.replaceChildren();message.textContent='';timer=setTimeout(check,500);});
  save.onclick=async()=>{if(!checked||checked.text!==area.value)return;save.disabled=true;message.textContent='저장하는 중…';
   try{const data=await(await C().api('/songbook/groups',json('PUT',checked.parsed,{'If-Match':`"${state.version}"`}))).json();accept(data,true);box.close();say(`짝을 저장했습니다. 짝 ${state.groups.length}`);render();}
   catch(error){message.textContent=error.message;save.disabled=false;if(error.status===409)try{await reload();render();}catch(_){}}};
  box.append(make('div',{class:'panel-head'},make('h2',{},'짝 붙여넣기'),make('span',{class:'panel-gap'}),close),make('div',{class:'panel-body songbook-paste-body'},area,preview),make('div',{class:'songbook-paste-foot'},make('button',{type:'button',onclick:()=>box.close()},'취소'),save),message);
  box.addEventListener('close',()=>box.remove());dialog.append(box);box.showModal();area.focus();}

 document.getElementById('songbookOpen')?.addEventListener('click',open);
 window.addEventListener('yebaeonsession',e=>{if(!e.detail?.authenticated){state=null;pairCache.clear();byDoc=new Map();byGroup=new Map();}});
 window.YebaeonSongbook={ensure,revalidate,reload,info,chip,tint,number,arrange,hints,switches,lyricsOnlyItem,pairItem,pairTag,pairPicker,summary,prepareOrder,hintElement,open,state:()=>state,parse,parseGroups};
})();
