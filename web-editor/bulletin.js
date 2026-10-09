(function(){'use strict';
 const $=id=>document.getElementById(id),C=YebaeonCloud,L=YebaeonPlaylists,P=PP6,BP=YebaeonBulletinParser,PL=YebaeonBulletinPlan,D=YebaeonBulletinDocuments;
 const STEPS=[['song','찬양'],['prayer','기도'],['sermon','주일말씀'],['weekday','주중말씀'],['review','검토·적용']],SVC=['1부','2부','청년예배'];
 const dialog=document.createElement('dialog');dialog.id='bulletinDialog';dialog.className='bulletin-dialog studio-import-dialog';dialog.setAttribute('aria-labelledby','bulletinHeading');
 dialog.innerHTML=`<header><strong id="bulletinHeading">주보로 준비</strong><button id="bulletinClose" class="import-close" aria-label="주보로 준비 닫기" title="닫기">×</button></header>
 <div id="bulletinStart" class="import-start"></div>
 <section id="bulletinSection" aria-labelledby="bulletinHeading"><nav id="bulletinSteps" class="bulletin-steps" role="tablist" aria-label="준비 단계"></nav>
 <div id="bulletinMain" class="bulletin-main"><div id="bulletinSource" class="bulletin-source"></div><div id="bulletinWork" class="bulletin-body bulletin-work"></div></div>
 <footer class="bulletin-actions import-actions"><small id="bulletinMessage" role="status"></small><button id="bulletinPrev">이전</button><button id="bulletinNext" class="primary">다음</button></footer>
 <div id="bulletinScrim" class="bulletin-scrim" hidden></div><div id="bulletinSheet" class="bulletin-sheet" hidden role="dialog" aria-label="주보에서 고르기"><div class="bulletin-grab"></div><div class="bulletin-sheet-head"></div><div class="bulletin-sheet-body"></div></div></section>
`;
 document.body.append(dialog);const start=YebaeonDropboxPicker.start($('bulletinStart'),{accept:/\.hwp$/i,inputAccept:'.hwp',max:16*1024*1024,kind:'주보(HWP)',initial:'HANWOORI/06주보/주일주보',onFile:file=>run(()=>loadFile(file))});start.input.id='bulletinFile';const button=document.createElement('button');button.id='bulletinOpen';button.className='studio-tool';button.title='주보로 준비';button.setAttribute('aria-label','주보로 준비');button.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/></svg><span>주보로 준비</span>';if($('studioGlobalTools'))$('studioGlobalTools').append(button);else $('serverStatus').before(button);
 let work=null,busy=false,seq=0;
 const ui={active:null,fresh:false,sheet:false,all:false,openLine:null};
 const recoveryKey='yebaeon.bulletin.work',plans=new Map();
 let aliases={};try{aliases=JSON.parse(localStorage.getItem('yebaeon.bulletin.songs')||'{}');}catch{}
 const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;};
 const dateLabel=el('label','file-start-date'),dateInput=el('input');dateInput.type='text';dateInput.placeholder='YYYY. MM. DD.';dateInput.id='bulletinDate';dateInput.setAttribute('aria-label','주보 날짜');dateLabel.append(dateInput);start.info.append(dateLabel);dateLabel.hidden=true;
 dateInput.oninput=()=>dateInput.setCustomValidity('');
 dateInput.onchange=()=>{if(!work)return;const parts=dateInput.value.trim().match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/),value=parts?`${parts[1]}-${parts[2].padStart(2,'0')}-${parts[3].padStart(2,'0')}`:'';if(!value||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value){dateInput.setCustomValidity('날짜를 2026. 10. 11. 형식으로 입력하세요.');dateInput.reportValidity();return;}dateInput.setCustomValidity('');work.date=value;pickTargets();save();render();};
 const mobile=()=>matchMedia('(max-width:600px)').matches;
 const message=s=>$('bulletinMessage').textContent=s;
 const get=id=>work.slots[id];
 // Mac(PP6)이 올린 이름은 한글 자모를 푼 꼴(NFD)일 수 있다. 비교·규칙 검사 전에 NFC로 맞춘다.
 // 순서 항목의 연결 문서 id. 서버 plan은 document.id로만 준다(documentId는 Studio에서 넣은 항목에만 있다).
 const docId=x=>x?.documentId||x?.document?.id||null;
 const base=name=>String(name||'').normalize('NFC').replace(/\.pro6$/i,'').trim();
 const songKey=v=>'song:'+BP.songQuery(v).normalize('NFC').replace(/[\s\p{P}]/gu,'');
 function slot(o){const s={id:'s'+(++seq),value:'',src:[],sug:false,skip:false,locked:false,note:'',kind:'text',choice:null,query:null,...o};if(s.value)s.sug=true;work.slots[s.id]=s;return s.id;}
 const val=x=>x?{value:x.value||'',src:x.src||[]}:{};
 function build(parsed,file){
  work={file,date:parsed.date,tables:parsed.tables,summary:parsed.summary,slots:{},songs:[],after:[],offer:[],prayer:[],main:null,extra:[],weekday:[],step:'song',svc:0,targets:[],include:{},includeManual:{},reviewInput:null,results:null};
  for(let i=0;i<3;i++){const s=parsed.services[i]||{songs:[]};
   work.songs[i]=(s.songs.length?s.songs:[{}]).map((x,k)=>slot({step:'song',svc:i,kind:'song',label:'찬양 '+(k+1),...val(x)}));
   work.after[i]=slot({step:'song',svc:i,kind:'song',label:'설교 후 찬양',...val(s.after)});
   work.offer[i]=i===2?slot({step:'song',svc:i,kind:'song',label:'헌금 찬양',locked:true,skip:true,note:'청년예배 헌금 찬양은 고정'}):slot({step:'song',svc:i,kind:'song',label:'헌금 찬양',...val(s.offering)});
   work.prayer[i]=slot({step:'prayer',kind:'prayer',label:SVC[i]+' 기도',...val(s.prayer)});}
  const groups=parsed.sermonGroups.length?parsed.sermonGroups:[{services:[0,1,2]}],main=groups.find(g=>g.services.includes(1))||groups[0],S=parsed.sermon;
  work.main={services:main.services,doc:PL.sermonDoc(main.services),series:slot({step:'sermon',label:'시리즈명',...val(S.series)}),title:slot({step:'sermon',label:'제목',...val(S.title.value?S.title:main.title)}),ref:slot({step:'sermon',kind:'ref',label:'설교 본문',...val(S.ref.value?S.ref:main.ref)}),
   groups:makeGroups(S.groups,parsed.summary)};
  for(const g of groups)if(g!==main)work.extra.push({services:g.services,preacher:g.preacher,doc:PL.sermonDoc(g.services),series:slot({step:'sermon',label:'시리즈명',...val(g.series)}),title:slot({step:'sermon',label:'제목',...val(g.title)}),ref:slot({step:'sermon',kind:'ref',label:'설교 본문',...val(g.ref)})});
  work.weekday=makeWeekday(parsed.weekday);
  pickTargets();
 }
 function makeGroups(groups,zone){return groups.map(g=>({what:slot({step:'sermon',label:'대지 질문',...val(g.what)}),points:g.points.map(p=>({tpl:slot({step:'sermon',kind:'template',label:'대지 문장',...val(p.template)}),blanks:p.blanks.map((x,k)=>slot({step:'sermon',label:'빈칸 '+(k+1),...val(x),zone})),quotes:p.quotes.map(q=>slot({step:'sermon',kind:'ref',label:'인용구',...val(q)}))}))}));}
 function makeWeekday(list){const day=work.date?new Date(work.date+'T00:00:00'):null;return ['수요예배','금요예배'].map((name,d)=>{const w=list[d]||{series:{},title:{},ref:{}},dt=day?new Date(day.getTime()+(d?5:3)*864e5):null,skip=!!w.minister||!!w.event||!w.title?.value;
  return {day:name,doc:d?'금요예배말씀':'수요예배',date:dt?`${dt.getMonth()+1}/${dt.getDate()}`:'',minister:w.minister||'',event:w.event||'',series:slot({step:'weekday',label:'시리즈명',...val(w.series),skip}),title:slot({step:'weekday',label:'제목',...val(w.title),skip}),ref:slot({step:'weekday',kind:'ref',label:'본문',...val(w.ref),skip})};});}
 const groupSlots=G=>[G.what,...G.points.flatMap(p=>[p.tpl,...p.blanks,...p.quotes])];
 // The user tells which cell is a region when the automatic reading misses it; suggestions are re-derived from that cell.
 function tools(key){const list=[];if(!work)return list;
  if(work.step==='sermon'){list.push(['설교 노트로',()=>designate('note',key)]);if(work.main.groups.some(g=>g.points.length))list.push(['말씀 요약으로',()=>designate('summary',key)]);}
  if(work.step==='weekday')list.push(['주중예배 칸으로',()=>designate('weekday',key)]);
  return list;}
 function designate(kind,key){let said='';const say=t=>said=t;const M=work.main,points=M.groups.flatMap(g=>g.points);
  const r=BP.region(work.tables,key,kind,kind==='note'?work.summary:kind==='summary'?points.map(p=>get(p.tpl).value):undefined);
  if(kind==='note'){if(!r.groups.length&&!r.title.value){message('이 칸에서 제목(■)이나 대지(What?·How? 등)를 찾지 못했습니다.');return;}
   for(const k of ['series','title','ref'])if(r[k].value)Object.assign(get(M[k]),{value:r[k].value,src:r[k].src,sug:true,skip:false});
   if(r.groups.length){for(const G of M.groups)for(const id of groupSlots(G))delete work.slots[id];M.groups=makeGroups(r.groups,work.summary);}say('설교 노트를 이 칸에서 다시 읽었습니다.');}
  if(kind==='summary'){work.summary=key;let filled=0;points.forEach((p,i)=>{syncBlanks(p);p.blanks.forEach((id,k)=>{const x=r[i]?.[k],s=get(id);s.zone=key;if(x?.value){Object.assign(s,{value:x.value,src:x.src,sug:true,skip:false});filled++;}});});say(filled?`빈칸 ${filled}개를 이 칸에서 찾았습니다.`:'이 칸에서 빈칸 답을 찾지 못했습니다. 낱말을 눌러 채우세요.');}
  if(kind==='weekday'){if(!r.length){message('이 칸에 글이 없습니다.');return;}for(const W of work.weekday)for(const id of [W.series,W.title,W.ref])delete work.slots[id];work.weekday=makeWeekday(r);say('주중예배를 이 칸에서 다시 읽었습니다.');}
  ui.active=null;reviewOps=null;staged=null;save();render();message(said);}
 function playlists(){return L.libraries().flatMap(l=>l.playlists.map(p=>({key:l.id+'/'+p.id,library:l.id,node:p.id,name:String(p.name).normalize('NFC')})));}
 function pickTargets(){const all=playlists(),names=all.map(p=>p.name);work.targets=[0,1,2].map(i=>all.find(p=>p.name===PL.playlistFor(i,work.date,names))?.key||'');}
 const target=i=>playlists().find(p=>p.key===work.targets[i]);
 async function plan(key,fresh=false){if(!key)return null;const [library,node]=key.split('/');if(fresh||!plans.has(key))plans.set(key,C.api(`/playlists/${library}/plan?`+new URLSearchParams({node,includeIndexed:'1'})).then(r=>r.json()).catch(e=>{plans.delete(key);throw e;}));return plans.get(key);}
 const names=p=>p.items.map(x=>base(x.name||x.document?.name).split('/').pop());
 async function findDoc(name){const data=await YebaeonSearch.query(name);return data.documents.filter(d=>d.available!==false&&base(d.name)===name);}
 async function docFromPlaylist(test,name){const all=playlists().filter(p=>test(p.name));for(const p of all){const data=await plan(p.key);const item=data.items.find(x=>base(x.name||x.document?.name)===name&&docId(x));if(item)return item.document||{id:docId(item),name};}const found=await findDoc(name);return found.length===1?found[0]:null;}
 /* ---------- source ---------- */
 function role(t){const all=t.cells.flatMap(c=>c.lines);if(t.cells.some(c=>c.lines.some(s=>s.replace(/\s/g,'').startsWith('1부예배'))))return '예배순서';if(all.some(s=>/^■/.test(s)))return '설교 노트';if(t.cells.some(c=>`${t.idx}:${c.row}:${c.col}`===work.summary))return '말씀 요약';if(all.some(s=>/^\d+\.\s*\S+\s*:/.test(s)))return '교회 소식';return '표 '+(t.idx+1);}
 function inStep(s){if(s.step!==work.step)return false;return work.step!=='song'||s.svc===work.svc;}
 function marks(){const m=new Map(),add=(r,c)=>{const k=r.key+':'+r.line;if(!m.has(k))m.set(k,[]);m.get(k).push({...r,c});};for(const s of Object.values(work.slots))if((work.step==='song'?s.step==='song':inStep(s))&&!s.skip)for(const r of s.src)add(r,'sug');const a=ui.active&&get(ui.active);if(a)for(const r of a.src)add(r,'act');return m;}
 function tree(root,keys){const m=marks(),a=ui.active&&get(ui.active),small=mobile();
  for(const t of work.tables){const full=work.step==='song',compact=full&&!!keys;const cells=t.cells.filter(c=>(full||c.lines.length)&&(!keys||keys.has(`${t.idx}:${c.row}:${c.col}`)));if(!cells.length)continue;const box=el('div','bulletin-table');box.append(el('h4',null,compact?'찬양':role(t)));const layout=full?(compact?songLayout(t,cells,box):tableLayout(t,box)):null;
   for(const c of cells.sort((x,y)=>x.row-y.row||x.col-y.col)){const key=`${t.idx}:${c.row}:${c.col}`,cell=layout?.get(c)||el('div');cell.className='bulletin-cell'+(a?.zone===key?' zone':'');cell.dataset.sourceKey=key;
    const acts=tools(key);if(acts.length){const bar=el('div','bulletin-cell-tools');for(const [label,fn] of acts){const b=el('button',null,label);b.onclick=()=>{fn();if(small)closeSheet();};bar.append(b);}cell.append(bar);}
    c.lines.forEach((line,li)=>{if(compact&&!Object.values(work.slots).some(s=>s.step==='song'&&s.src.some(r=>r.key===key&&r.line===li)))return;const mk=m.get(key+':'+li)||[],cls=wi=>{let r='';for(const x of mk)if(x.a===null||(wi>=x.a&&wi<=x.b))r=x.c==='act'?'act':(r||'sug');return r;};
     if(small){const open=ui.openLine===key+':'+li,b=el('button','bulletin-mline'+(mk.length?' sug':'')+(mk.some(x=>x.c==='act')?' active':'')+(open?' open':''),line);b.onclick=()=>{ui.openLine=open?null:key+':'+li;sheet();};cell.append(b);
      if(open){const chips=el('div','bulletin-chips'),whole=el('button','whole','줄 전체 넣기');whole.onclick=()=>pickLine(key,li,line);chips.append(whole);BP.words(line).forEach((w,wi)=>{const x=el('button',cls(wi),w);x.onclick=()=>pickWord(key,li,wi,w);chips.append(x);});cell.append(chips);}}
     else{const row=el('div','bulletin-line'),pil=el('button','pil','¶');pil.title='줄 전체 넣기';pil.setAttribute('aria-label','줄 전체 넣기');pil.onclick=()=>pickLine(key,li,line);const txt=el('span');BP.words(line).forEach((w,wi)=>{if(wi)txt.append(' ');const x=el('span','w '+cls(wi),w);x.onclick=()=>pickWord(key,li,wi,w);txt.append(x);});row.append(pil,txt);cell.append(row);}});
    if(!layout?.has(c))box.append(cell);}root.append(box);}
  if(!root.children.length)root.append(el('p','bulletin-note','이 단계와 연결된 주보 부분이 없습니다. ‘전체 주보’에서 찾으세요.'));}
 // 찬양이 있는 행만 남기고 예배별 열을 3열로 압축한다. 출처 키는 원문 좌표를 쓴다.
 function songLayout(t,cells,box){
  const heads=[1,2,3].map(n=>t.cells.find(c=>c.lines.some(s=>s.replace(/\s/g,'').startsWith(n+'부예배'))));if(heads.some(h=>!h))return null;
  const cols=heads.map(h=>h.col),rows=[...new Set(cells.map(c=>c.row))].sort((a,b)=>a-b),nodes=new Map(),occupied=new Set();
  const wrap=el('div','bulletin-source-scroll'),table=el('table','bulletin-source-grid'),head=el('thead'),header=el('tr'),body=el('tbody');table.setAttribute('aria-label','찬양 원문 표');
  ['1부예배','2부예배','3부예배'].forEach(name=>{const th=el('th',null,name);th.scope='col';header.append(th);});head.append(header);
  for(const r of rows){const row=el('tr');for(let i=0;i<3;i++){if(occupied.has(r+':'+i))continue;const c=cells.find(c=>c.row===r&&c.col<=cols[i]&&c.col+c.cols>cols[i]),td=el('td');if(c){const covered=cols.map((k,j)=>k>=c.col&&k<c.col+c.cols?j:-1).filter(j=>j>=0),height=rows.filter(k=>k>=r&&k<r+c.rows);td.colSpan=covered.length;td.rowSpan=height.length;for(const k of height)for(const j of covered)occupied.add(k+':'+j);nodes.set(c,td);}row.append(td);}body.append(row);}
  table.append(head,body);wrap.append(table);box.append(wrap);return nodes;
 }
 // HWP의 행·열과 병합 범위를 유지한다. 빈 칸도 자리를 차지한다.
 function tableLayout(t,box){
  if(t.cells.some(c=>![c.row,c.col,c.rows,c.cols].every(Number.isInteger)||c.row<0||c.col<0||c.rows<1||c.cols<1||c.row+c.rows>512||c.col+c.cols>128))return null;
  const nr=Math.max(...t.cells.map(c=>c.row+c.rows)),nc=Math.max(...t.cells.map(c=>c.col+c.cols)),grid=Array.from({length:nr},()=>Array(nc).fill(null)),nodes=new Map();
  for(const c of t.cells)for(let r=c.row;r<c.row+c.rows;r++)for(let k=c.col;k<c.col+c.cols;k++){if(grid[r][k])return null;grid[r][k]=c;}
  const wrap=el('div','bulletin-source-scroll'),table=el('table','bulletin-source-grid'),body=el('tbody');table.setAttribute('aria-label',role(t)+' 원문 표');
  for(let r=0;r<nr;r++){const row=el('tr');for(let k=0;k<nc;k++){const c=grid[r][k];if(c&&(c.row!==r||c.col!==k))continue;const cell=el('td');if(c){cell.rowSpan=c.rows;cell.colSpan=c.cols;nodes.set(c,cell);}row.append(cell);}body.append(row);}
  table.append(body);wrap.append(table);box.append(wrap);return nodes;
 }
 function revealSource(root=$('bulletinSource')){const mark=root.querySelector('.w.act,.bulletin-mline.active');if(!mark)return;const box=mark.closest('.bulletin-source-scroll');if(box){const a=mark.getBoundingClientRect(),b=box.getBoundingClientRect();if(a.left<b.left||a.right>b.right)box.scrollLeft+=a.left-b.left-box.clientWidth/3;}
  const a=mark.getBoundingClientRect(),b=root.getBoundingClientRect();if(a.top<b.top+8||a.bottom>b.bottom-8)root.scrollTop+=a.top-b.top-root.clientHeight/3;
 }
 function stepKeys(){const keys=new Set();for(const s of Object.values(work.slots))if(work.step==='song'?s.step==='song':inStep(s)){for(const r of s.src)keys.add(r.key);if(s.zone&&ui.active===s.id)keys.add(s.zone);}return keys;}
 function source(){const box=$('bulletinSource');box.replaceChildren();if(!work||work.step==='review')return;const bar=el('div','bulletin-source-bar'),lab=el('label'),cb=el('input');cb.type='checkbox';cb.checked=ui.all;cb.onchange=()=>{ui.all=cb.checked;source();};lab.append(cb,'전체 주보');bar.append(el('span',null,ui.all?'주보 전체':work.step==='song'?'찬양 원문 · 선택한 부분은 주황색':'이 단계와 관련된 부분'),lab);box.append(bar);tree(box,ui.all||work.step==='song'&&!stepKeys().size?null:stepKeys());}
 function sheet(){const on=!!(work&&mobile()&&ui.sheet&&ui.active);$('bulletinSheet').hidden=$('bulletinScrim').hidden=!on;if(!on)return;const s=get(ui.active),head=$('bulletinSheet').querySelector('.bulletin-sheet-head'),body=$('bulletinSheet').querySelector('.bulletin-sheet-body');
  head.replaceChildren();const b=el('b',null,s.label);b.append(el('span',null,s.value||'줄을 눌러 낱말을 고르세요'));const all=el('button',null,ui.all?'관련 부분':'전체 주보');all.onclick=()=>{ui.all=!ui.all;sheet();};const done=el('button','primary','완료');done.onclick=closeSheet;head.append(b,all,done);
  body.replaceChildren();const keys=new Set(s.src.map(r=>r.key));if(s.zone)keys.add(s.zone);tree(body,work.step==='song'?(ui.all||!stepKeys().size?null:stepKeys()):(ui.all||!keys.size?null:keys));if(!ui.openLine)revealSource(body);}
 function closeSheet(){ui.sheet=false;ui.openLine=null;sheet();}
 const cleanWord=w=>w.replace(/^[■‘“(]+/,'').replace(/[,’”)]+$/,'');
 function cleanLine(line,kind){let v=line.replace(/^■\s*/,'');if(kind==='template')v=v.replace(/^\d+\.\s*/,'');if(kind==='ref'){const m=v.match(/^([가-힣]{1,6}\s?\d+\s*:\s*[\d,\-~]+)/)||v.match(/\(([가-힣]{1,6}\s?\d+:[\d,\-~]+)\)\s*$/);if(m)v=m[1];}return v.trim();}
 function targetSlot(){const s=ui.active&&get(ui.active);if(!s){message('채울 칸을 먼저 고르세요.');return null;}if(s.locked){message(s.note);return null;}return s;}
 function pickWord(key,li,wi,w){const s=targetSlot();if(!s)return;w=cleanWord(w);if(ui.fresh||s.kind==='prayer'){s.value=w;s.src=[{key,line:li,a:wi,b:wi}];}else{s.value=(s.value?s.value+' ':'')+w;const l=s.src.at(-1);if(l&&l.key===key&&l.line===li&&l.b===wi-1)l.b=wi;else s.src.push({key,line:li,a:wi,b:wi});}changed(s);}
 function pickLine(key,li,line){const s=targetSlot();if(!s)return;if(s.kind==='prayer'&&line.split('/').length===3){line.split('/').forEach((name,i)=>Object.assign(get(work.prayer[i]),{value:name.trim(),src:[{key,line:li,a:null,b:null}],sug:false,skip:false}));ui.fresh=false;save();render();if(mobile())closeSheet();return;}s.value=cleanLine(line,s.kind);s.src=[{key,line:li,a:null,b:null}];changed(s);if(mobile())closeSheet();}
 function changed(s){s.sug=false;s.skip=false;if(s.kind==='song'){s.choice=null;s.query=null;}ui.fresh=false;save();render();}
 /* ---------- work ---------- */
 function activate(id){if(ui.active===id)return;const typing=document.activeElement?.id==='bulletin-'+id;ui.active=id;ui.fresh=true;ui.openLine=null;render();revealSource();if(typing){const box=document.getElementById('bulletin-'+id);box?.focus();box?.setSelectionRange?.(box.value.length,box.value.length);}}
 function slotRow(id,extra){const s=get(id),row=el('div','bulletin-slot'+(ui.active===id?' active':'')+(s.skip?' skipped':'')+(s.locked?' locked':''));
  const multi=['제목','대지 질문','대지 문장'].includes(s.label),lab=el('label',null,s.label),inp=el(multi?'textarea':'input',s.sug?'sug':'');if(multi){inp.rows=Math.min(4,Math.max(2,s.value.split('\n').length));inp.title='Enter로 줄을 바꿀 수 있습니다';}inp.id='bulletin-'+id;lab.htmlFor=inp.id;const song=s.kind==='song'&&!s.locked;inp.value=song?(s.query??BP.songQuery(s.value)):s.value;inp.disabled=s.locked;inp.placeholder=s.locked?'':song?'찬양 이름·가사로 찾기':'주보에서 골라 채우기';if(song)inp.setAttribute('aria-label',s.label+' 찬양 검색어');
  inp.oninput=()=>{s.sug=false;inp.className='';if(song){s.query=inp.value;if(!s.src.length)s.value=inp.value;return;}s.value=inp.value;};inp.onchange=()=>{save();if(!song)render();};
  const acts=el('div','acts'),src=el('button','src','주보');src.onclick=e=>{e.stopPropagation();activate(id);ui.sheet=true;sheet();};const skip=el('button','skip',s.skip?'넘김':'넘어가기');skip.disabled=s.locked;skip.onclick=e=>{e.stopPropagation();s.skip=!s.skip;save();render();};acts.append(src,skip);
  const meta=el('div','meta');if(!s.locked)meta.append(el('span',null,s.src.length?'주보에서 가져옴':'주보 힌트 없음'));if(s.note)meta.append(el('span',null,s.note));
  if(s.kind==='prayer'&&s.value){const n=BP.splitName(s.value);meta.append(n?el('span','ok',`이름 ${n.name} · 직함 ${n.title}`):el('span','bad','이름과 직함을 나누지 못했습니다'));}
  if(s.kind==='ref'&&s.value){const r=BP.reference(s.value);meta.append(r.error?el('span','bad',r.error):el('span','ok',r.labels.join(' + ')+` · ${r.count}절`));}
  if(s.kind==='song'&&!s.locked&&s.value)meta.append(el('span',s.choice?'ok':'',s.choice?'고름: '+s.choice.name:'후보를 고르세요'));
  row.append(lab,inp,acts,meta);if(extra)extra(row);
  if(song&&!s.skip&&ui.active===id&&(s.value||s.query))row.append(candidates(s,inp));
  row.addEventListener('click',e=>{if(e.target.closest('.acts,.bulletin-cands'))return;activate(id);});inp.addEventListener('focus',()=>activate(id));return row;}
 function candidates(s,input){const box=el('div','bulletin-cands'),remembered=aliases[songKey(s.value)],on=c=>s.choice?.id===c.id;
  const pick=c=>{s.choice=on(c)?null:c;if(s.choice){aliases[songKey(s.value)]={id:c.id,name:c.name};try{localStorage.setItem('yebaeon.bulletin.songs',JSON.stringify(aliases));}catch{}shareChoice(s,c);}save();render();};
  YebaeonSearch.box(box,{input,itemClass:'cand',
   decorate:d=>({tag:[d.category,remembered?.id===d.id?'지난번에 고름':'',d.matchedBy==='content'?'가사 일치':''].filter(Boolean).join(' · ')||d.path,on:on({id:d.id})}),
   onQuery:q=>{if(q!==BP.songQuery(s.value))s.query=q;save();},
   onPick:doc=>pick({id:doc.id,name:base(doc.name),...doc.category?{category:doc.category}:{}})}).run();
  return box;}
 // 설교 후 찬양·헌금 찬양은 예배마다 보통 같다. 한 예배에서 고르면 아직 고르지 않은 다른 예배의 같은 자리에도 넣는다(주보 글이 다르면 넣지 않음).
 function shareChoice(s,c){for(const list of [work.after,work.offer]){const k=list.indexOf(s.id);if(k<0)continue;list.forEach((id,j)=>{const o=id&&get(id);if(j===k||!o||o.choice||o.skip||o.locked)return;if(o.value.trim()&&s.value.trim()&&songKey(o.value)!==songKey(s.value))return;o.choice={...c};o.note='다른 예배에서 고른 곡';});}}
 function group(t,sub){const g=el('div','bulletin-group'),h=el('div','gh');h.append(el('h4',null,t));if(sub)h.append(el('small',null,sub));g.append(h);return g;}
 const v=id=>{const s=get(id);return s.skip?'':s.value.trim();};
 function stepSong(root){const tabs=el('div','bulletin-svc');SVC.forEach((n,i)=>{const b=el('button',null,n);b.setAttribute('aria-selected',String(i===work.svc));b.onclick=()=>{work.svc=i;ui.active=null;save();render();};tabs.append(b);});root.append(tabs);
  const i=work.svc,sel=el('select');sel.setAttribute('aria-label',SVC[i]+' 재생목록');sel.add(new Option('재생목록을 고르세요',''));for(const p of playlists())sel.add(new Option(p.name,p.key));sel.value=work.targets[i];sel.onchange=()=>{work.targets[i]=sel.value;save();render();};
  const tl=el('label','bulletin-target');tl.append('적용할 재생목록',sel);root.append(tl);
  const g1=group('예배 전 찬양','사도신경 다음 ~ 기도 앞');work.songs[i].forEach((id,k)=>g1.append(slotRow(id,row=>{if(work.songs[i].length>1){const x=el('button','x','삭제');x.onclick=e=>{e.stopPropagation();delete work.slots[id];work.songs[i].splice(k,1);work.songs[i].forEach((sid,j)=>get(sid).label='찬양 '+(j+1));ui.active=null;save();render();};row.querySelector('.acts').append(x);}})));
  const add=el('button','bulletin-add','+ 찬양 추가');add.onclick=()=>{const id=slot({step:'song',svc:i,kind:'song',label:'찬양 '+(work.songs[i].length+1)});work.songs[i].push(id);activate(id);};g1.append(add);
  const g2=group('설교 후 · 헌금 찬양','말씀(목사님 ppt가 있으면 그 다음) 바로 뒤');g2.append(slotRow(work.after[i]),slotRow(work.offer[i]));root.append(g1,g2);
 }
 function stepPrayer(root){const g=group('대표기도','기도 문서를 직접 고침 · 이름과 직함만');work.prayer.forEach(id=>g.append(slotRow(id)));root.append(g);}
 function stepSermon(root){const M=work.main,g0=group(M.doc,M.services.map(i=>SVC[i]).join('·')+' · 직접 고침');g0.append(slotRow(M.series),slotRow(M.title),slotRow(M.ref));root.append(g0);
  if(!M.groups.length){const g=group('대지','1쪽에 대지가 없습니다');g.append(el('p','bulletin-note','대지가 없으면 제목과 본문 슬라이드만 만듭니다.'));const add=el('button','bulletin-add','+ 대지 묶음');add.onclick=()=>{M.groups.push({what:slot({step:'sermon',label:'대지 질문'}),points:[{tpl:slot({step:'sermon',kind:'template',label:'대지 문장'}),blanks:[],quotes:[]}]});save();render();};g.append(add);root.append(g);}
  M.groups.forEach((G,gi)=>{const g=group(M.groups.length>1?`대지 묶음 ${gi+1}`:'대지',G.points.length+'개');g.append(slotRow(G.what));
   G.points.forEach((p,pi)=>{const h=el('div','gh');h.append(el('h4',null,'대지 '+(pi+1)));g.append(h,slotRow(p.tpl));syncBlanks(p);p.blanks.forEach(id=>g.append(slotRow(id)));
    p.quotes.forEach((id,qi)=>g.append(slotRow(id,row=>{const x=el('button','x','삭제');x.onclick=e=>{e.stopPropagation();delete work.slots[id];p.quotes.splice(qi,1);ui.active=null;save();render();};row.querySelector('.acts').append(x);})));
    const add=el('button','bulletin-add','+ 인용구');add.onclick=()=>{const id=slot({step:'sermon',kind:'ref',label:'인용구'});p.quotes.push(id);activate(id);};g.append(add);});
   const addP=el('button','bulletin-add','+ 대지');addP.onclick=()=>{G.points.push({tpl:slot({step:'sermon',kind:'template',label:'대지 문장'}),blanks:[],quotes:[]});save();render();};g.append(addP);root.append(g);});
  const gp=group('만들어질 슬라이드','기존 슬라이드 서식을 복제해 글만 바꿈');gp.append(slides(sermonData(M)));root.append(gp);
  for(const E of work.extra){const g=group(E.doc,E.services.map(i=>SVC[i]).join('·')+(E.preacher?' · '+E.preacher:''));g.append(el('p','bulletin-note warn',`주보 표에서 설교 칸이 나뉘었습니다. ${E.doc} 문서를 고치고 ${E.services.map(i=>SVC[i]).join('·')} 순서의 말씀 자리에 넣습니다.`));g.append(slotRow(E.series),slotRow(E.title),slotRow(E.ref),slides(simpleData(E)));root.append(g);}}
 function syncBlanks(p){const n=(v(p.tpl).match(/_{2,}/g)||[]).length;while(p.blanks.length<n)p.blanks.push(slot({step:'sermon',label:'빈칸 '+(p.blanks.length+1),zone:work.summary}));}
 function stepWeekday(root){for(const W of work.weekday){const g=group(W.day,`${W.date} · ${W.doc} 문서 직접 고침`);if(W.minister)g.append(el('p','bulletin-note',`${W.minister} 준비 · 제목과 본문은 당일까지 모름 → 넘어감`));if(W.event)g.append(el('p','bulletin-note',`‘${W.event}’ · 본문 없음 → 넘어감`));g.append(slotRow(W.series),slotRow(W.title),slotRow(W.ref),slides(simpleData(W)));root.append(g);}root.append(el('p','bulletin-note','새벽기도 줄은 다루지 않습니다.'));}
 function sermonData(M){return {series:v(M.series),title:v(M.title),ref:refLabel(v(M.ref)),passage:v(M.ref),groups:M.groups.map(G=>({question:v(G.what),points:G.points.filter(p=>v(p.tpl)).map(p=>({template:v(p.tpl),fills:p.blanks.map(v),quotes:p.quotes.map(v).filter(Boolean)}))}))};}
 function simpleData(W){return {series:v(W.series),title:v(W.title),ref:refLabel(v(W.ref)),passage:v(W.ref),groups:[]};}
 function refLabel(value){const r=BP.reference(value);return r.error?value:r.labels.join(', ');}
 function slides(d){const wrap=el('div','bulletin-slides');if(!d.title)return wrap;let n=0;const card=(cls,...parts)=>{const c=el('div','sl'+(cls?' '+cls:''));c.append(...parts);wrap.append(c);n++;c.append(el('span','no',String(n)));return c;};
  const title=()=>card('',...(d.series?[el('div','ser',d.series)]:[]),el('div','ttl',d.title),el('div','ser',d.ref?`(${d.ref})`:''));
  const verses=value=>{const r=BP.reference(value);if(r.error){card('warn',el('div',null,value),el('div','ser',r.error));return;}for(const run of r.runs)for(let x=run.from;x<=run.to;x++)card('',el('span','ref',`${r.book} ${r.chapter}:${x}`),el('div','ser','개역개정 본문'));};
  title();if(d.passage)verses(d.passage);
  for(const g of d.groups)for(const p of g.points){title();const line=el('div','ttl');for(const l of D.sentence(p.template,p.fills)){let pos=0;const row=el('div');for(const m of l.marks){row.append(l.text.slice(pos,m.start),el('u',null,l.text.slice(m.start,m.end)));pos=m.end;}row.append(l.text.slice(pos));line.append(row);}card('',...(g.question?[el('div','ser',g.question)]:[]),line);for(const q of p.quotes)verses(q);}
  if(d.groups.some(g=>g.points.length))title();return wrap;}
 /* ---------- review & apply ---------- */
 async function operations(){const ops=[];const people=work.prayer.map(v);
  for(let i=0;i<3;i++){const t=target(i);if(!t){ops.push({key:'svc'+i,label:SVC[i]+' 재생목록',kind:'error',lines:[['bad','적용할 재생목록을 고르지 않았습니다.']]});continue;}
   const p=await plan(t.key);const pick=id=>{const s=get(id);return s.skip||s.locked?null:{choice:s.choice};};
   const sermonFor=await sermonTarget(i);const r=PL.songPlan(names(p),i,{songs:work.songs[i].map(pick).filter(Boolean),after:pick(work.after[i]),offering:pick(work.offer[i]),sermon:sermonFor});
   const lines=[];for(const x of r.removed)lines.push(['del',x.name]);for(const x of r.rows.filter(x=>x.action==='insert'))lines.push(['add','+ '+x.name]);for(const x of r.rows.filter(x=>x.action==='replace'))lines.push(['add',`${x.slot}: ${x.previous||'말씀'} → ${x.name}`]);
   const waiting=work.songs[i].map(get).filter(s=>!s.skip&&s.value&&!s.choice).length;if(waiting)lines.push(['wait',`찬양 ${waiting}곡은 고르지 않아 넣지 않음`+(r.removed.length?'':' · 찬양 영역 그대로')]);
   for(const w of r.warnings)lines.push(['wait',w]);
   ops.push({key:'svc'+i,label:t.name,sub:'재생목록',kind:'playlist',service:i,target:t.key,lines:lines.length?lines:[['','바뀌는 것 없음']],skip:!r.changed});
   const at=names(p).findIndex(n=>PL.PRAYER.test(n)),name=at>=0?names(p)[at]:'',item=at>=0?p.items[at]:null;const person=BP.splitName(people[i]);
   if(people[i]&&!(docId(item)&&ops.some(o=>o.doc===docId(item))))ops.push({key:'prayer'+i,label:name||SVC[i]+' 기도',sub:'문서',kind:'prayer',doc:docId(item),person,lines:docId(item)?[[person?'add':'bad',person?`이름 ${person.name} · 직함 ${person.title}`:'이름과 직함을 나누지 못했습니다']]:[['bad','순서에서 기도 문서를 찾지 못했습니다.']]});}
  const M=work.main,md=sermonData(M),mainDoc=await docFromPlaylist(n=>/^2부/.test(n.replace(/\s/g,'')),M.doc);
  ops.push({key:'sermon',label:M.doc,sub:'문서',kind:'sermon',doc:mainDoc?.id,data:md,lines:mainDoc?[['add',summary(md)]]:[['bad',M.doc+' 문서를 찾지 못했습니다.']]});
  for(const E of work.extra){const doc=await extraDoc(E),d=simpleData(E);ops.push({key:'extra'+E.services.join(''),label:E.doc,sub:'문서',kind:'simple',doc:doc?.id,data:d,lines:doc?[['add',summary(d)]]:[['bad',E.doc+' 문서를 찾지 못했습니다. 이름을 확인하세요.']]});}
  for(const W of work.weekday){if(!v(W.title))continue;const doc=await docFromPlaylist(n=>n.replace(/\s/g,'')===W.day,W.doc),d=simpleData(W);ops.push({key:'wk'+W.day,label:W.doc,sub:'문서',kind:'simple',weekday:true,doc:doc?.id,data:d,lines:doc?[['add',summary(d)]]:[['bad',W.doc+' 문서를 찾지 못했습니다.']]});}
  // 검토 화면은 작업 단계 순서대로: 1·2·3부 재생목록 → 기도자 → 말씀 → 주중예배(같은 묶음 안에서는 만든 순서).
  const rank=o=>o.weekday?3:o.kind==='prayer'?1:o.kind==='sermon'||o.kind==='simple'?2:0;
  return ops.map((o,i)=>[o,i]).sort((a,b)=>rank(a[0])-rank(b[0])||a[1]-b[1]).map(([o])=>o);}
 function summary(d){const verses=value=>{const r=BP.reference(value);return r.error?0:r.count;};const points=d.groups.reduce((a,g)=>a+g.points.length,0),quotes=d.groups.reduce((a,g)=>a+g.points.reduce((b,p)=>b+p.quotes.reduce((c,q)=>c+verses(q),0),0),0);
  return `제목 “${d.title}” · 본문 ${verses(d.passage)}절`+(points?` · 대지 ${points} · 인용구 ${quotes}절`:'');}
 async function sermonTarget(i){const E=work.extra.find(e=>e.services.includes(i));if(E){const doc=await extraDoc(E);return doc?{id:doc.id,name:base(doc.name)}:null;}if(!work.main.services.includes(i))return null;const doc=await docFromPlaylist(n=>/^2부/.test(n.replace(/\s/g,'')),work.main.doc);return doc?{id:doc.id,name:base(doc.name)}:null;}
 async function extraDoc(E){const found=await findDoc(E.doc);return found.length===1?found[0]:null;}
 let reviewOps=null;
 // 검토·적용: 들어오면 바로 미리 보기를 만든다(항목마다 체크·바뀌는 것·전후 비교가 한 칸). 체크나 날짜를 바꾸면 다시 만든다. ‘적용’이 Studio로 넘긴다.
 let previewKey=null;
 function refreshReview(){const key=JSON.stringify([work.date,work.targets,work.main,work.extra,work.weekday,Object.values(work.slots).map(s=>[s.id,s.value,s.skip,s.locked,s.choice])]);
  if(work.reviewInput===key)return;
  work.includeManual??=Object.fromEntries(Object.keys(work.include).map(k=>[k,true]));
  for(const k of Object.keys(work.include))if(!work.includeManual[k])delete work.include[k];
  if(work.reviewInput)work.results=null;
  work.reviewInput=key;reviewOps=null;staged=null;previewKey=null;save();
 }

 function stepReview(root){refreshReview();const inputKey=work.reviewInput,reviewWork=work;
  if(work.results){const g=group('적용 결과');const ul=el('ul','bulletin-results');for(const r of work.results)ul.append(el('li',r.ok?'ok':'bad',`${r.label} · ${r.text}`));g.append(ul);if(work.results.some(r=>!r.ok))g.append(el('p','bulletin-note','실패한 항목만 다시 미리 보기를 만들어 적용할 수 있습니다. 적용한 항목은 Studio에서 ‘서버 저장’을 눌러야 서버에 갑니다.'));root.append(g);}
  root.append(el('p','bulletin-note','바뀌는 모습을 확인하고 ‘적용’을 누르면 Studio에 저장 필요 상태로 넘기고 창을 닫습니다. 서버 저장은 Studio에서 합니다. 빼고 싶은 항목은 체크를 끄세요. 아직 Studio에도 서버에도 넘기지 않았습니다.'));
  const list=el('div','bulletin-review');root.append(list);list.append(el('p','bulletin-note','바뀌는 것을 계산하는 중…'));
  (reviewOps||(reviewOps=operations())).then(ops=>{if(work!==reviewWork||work.step!=='review'||work.reviewInput!==inputKey||!list.isConnected)return;list.replaceChildren();for(const o of ops){if(!(o.key in work.include))work.include[o.key]=!o.skip&&!o.lines.some(l=>l[0]==='bad');const r=staged?.get(o.key),d=el('div','bulletin-op'+(work.include[o.key]?'':' off')+(r&&!r.ok?' bad':'')),lab=el('label'),cb=el('input');cb.type='checkbox';cb.checked=work.include[o.key];cb.disabled=busy||o.lines.some(l=>l[0]==='bad')||o.kind==='error';cb.onchange=()=>{work.include[o.key]=cb.checked;work.includeManual[o.key]=true;save();render();};
    lab.append(cb,o.label,el('small',null,o.sub||''));d.append(lab);for(const [c,t] of o.lines.filter(l=>l[0]==='bad'||l[0]==='wait'))d.append(el('small','bulletin-op-note '+c,t));
    if(r&&work.include[o.key]){d.classList.add('bulletin-staged');d.append(el('small','bulletin-staged-note',r.text));if(r.ok)d.append(preview(r));}else if(work.include[o.key]&&!work.results?.some(x=>x.key===o.key&&x.ok))d.append(el('small','bulletin-staged-note','미리 보기 만드는 중…'));
    list.append(d);}foot();
   const missing=ops.filter(o=>work.include[o.key]&&!staged?.has(o.key)&&!work.results?.some(x=>x.key===o.key&&x.ok)).map(o=>o.key),key=JSON.stringify([work.date,missing]);if(missing.length&&!busy&&previewKey!==key){previewKey=key;run(apply);}}).catch(e=>{list.replaceChildren(el('p','bulletin-note bad',e.message));});}
 // 적용은 두 단계다. ‘미리 보기’는 바뀐 문서와 순서를 이 창에서만 만들어 보여 주고, ‘적용’은 그것을 Studio의 미저장 문서·순서(브라우저 초안)로 넘긴다.
 // 서버에는 쓰지 않는다. 서버에는 Studio에서 재생목록을 열어 ‘서버 저장’을 누를 때 간다.
 // 적용할 때는 서버의 최신 버전을 다시 읽어 같은 변경을 만든다. 같은 문서를 여러 항목이 고치면 chain으로 앞 항목의 결과 위에 잇는다.
 let staged=null;
 // 미리 보기를 만든 항목 가운데 지금 체크된 것. 체크를 끄고 켜도 만든 미리 보기는 그대로 두고, 새로 켠 항목만 더 만든다.
 const chosen=()=>staged?[...staged.values()].filter(r=>work.include[r.key]):[];
 async function rewrite(id,transform,layout='side',chain=null){const prior=chain?.get(id);if(!prior&&C.pendingDocuments([id]).length)throw Error('이 문서에 서버에 저장하지 않은 변경이 있습니다. Studio에서 먼저 서버 저장하세요.');
  let doc,original;if(prior)({doc,original}=prior);else{doc=(await(await C.api('/documents/'+id)).json()).document;const data=await(await C.api(`/documents/${id}/content?version=${doc.version}`)).arrayBuffer();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');if(hash!==doc.sha256)throw Error('문서 원본 확인에 실패했습니다.');original=new TextDecoder('utf-8',{fatal:true}).decode(data);}
  const before=prior?prior.xml:original,r=await transform(before,doc.name);chain?.set(id,{doc,original,xml:r.xml});
  return {text:r.notes.length?r.notes.join(' · '):'바뀐 슬라이드 확인',preview:{kind:'document',before,xml:r.xml,name:doc.name,layout}};}
 async function applyPlaylist(o){const p=await plan(o.target,true);if(!p.playlist.editable)throw Error('이 순서는 편집할 수 없습니다.');const i=o.service,pick=id=>{const s=get(id);return s.skip||s.locked?null:{choice:s.choice};};
  const r=PL.songPlan(names(p),i,{songs:work.songs[i].map(pick).filter(Boolean),after:pick(work.after[i]),offering:pick(work.offer[i]),sermon:await sermonTarget(i)});if(!r.changed)return {text:'바뀌는 것 없음',stage:async()=>'바뀌는 것 없음'};
  const items=r.rows.map(x=>x.action==='keep'?structuredClone(p.items[x.index]):{kind:'document',name:base(x.document.name),document:x.document,documentId:x.document.id,path:x.document.path,issue:x.document.available===false?'missing':null,sharedWith:[]});
  return {text:`순서 ${items.length}개`,preview:{kind:'playlist',before:names(p).map((name,index)=>({name,removed:r.removed.some(x=>x.index===index),replaced:r.rows.some(x=>x.action==='replace'&&x.index===index)})),rows:r.rows.map(x=>({name:x.name,changed:x.action!=='keep'}))},
   async stage(){await L.stageDraft(p,items);plans.delete(o.target);return `순서 ${items.length}개 · 저장 필요`;}};}
 function stageOp(o,need,chain){if(o.kind==='prayer')return rewrite(o.doc,(xml,name)=>D.prayer(xml,name,o.person),'side',chain);if(o.kind==='sermon')return rewrite(o.doc,async(xml,name)=>D.sermon(xml,name,o.data,await need()),'stack',chain);if(o.kind==='simple')return rewrite(o.doc,async(xml,name)=>D.titlePassage(xml,name,o.data,await need(),{made:!!o.weekday}),'side',chain);return applyPlaylist(o);}
 // 문서마다 그 문서가 든 재생목록 키들. 그 목록에 ‘저장 필요’를 붙인다.
 async function docMarks(){const m=new Map();for(const [k,p] of plans){let data;try{data=await p;}catch{continue;}for(const x of data.items)if(docId(x)){if(!m.has(docId(x)))m.set(docId(x),new Set());m.get(docId(x)).add(k);}}return m;}
 async function todoOps(){const ops=await reviewOps;const todo=ops.filter(o=>work.include[o.key]&&!work.results?.some(r=>r.key===o.key&&r.ok));if(!todo.length)throw Error('적용할 항목이 없습니다.');return [...todo.filter(o=>o.kind!=='playlist'),...todo.filter(o=>o.kind==='playlist')];}
 async function apply(){const todo=(await todoOps()).filter(o=>!staged?.has(o.key));
  let materials=null;const need=()=>materials||(materials=YebaeonResources.bulletinMaterials());const next=new Map(staged||[]),chain=new Map();
  for(const [n,o] of todo.entries()){message(`${n+1}/${todo.length} ${o.label} 만드는 중…`);
   try{next.set(o.key,{key:o.key,label:o.label,ok:true,op:o,...await stageOp(o,need,chain)});}catch(e){next.set(o.key,{key:o.key,label:o.label,ok:false,text:e.message});}}
  staged=next;message(chosen().every(r=>r.ok)?'바뀐 내용을 확인하고 ‘적용’을 누르세요. 적용해도 서버에는 Studio에서 ‘서버 저장’을 누를 때 갑니다.':'만들지 못한 항목이 있습니다. 나머지는 확인한 뒤 적용할 수 있습니다.');render();}
 async function commit(){const results=(work.results||[]).filter(r=>r.ok);
  let materials=null;const need=()=>materials||(materials=YebaeonResources.bulletinMaterials());const chain=new Map(),docs=[],lists=[];
  const ready=chosen();for(const [n,r] of ready.entries()){if(!r.ok){results.push({key:r.key,label:r.label,ok:false,text:r.text});continue;}message(`${n+1}/${ready.length} ${r.label} 만드는 중…`);
   try{if(r.op.kind==='playlist')plans.delete(r.op.target);const fresh=await stageOp(r.op,need,chain);(r.op.kind==='playlist'?lists:docs).push({r,fresh});}catch(e){results.push({key:r.key,label:r.label,ok:false,text:e.message});}}
  const marks=await docMarks(),failed=new Map();
  for(const [id,c] of chain){try{await C.stageDocument(c.doc,c.original,c.xml,[...(marks.get(id)||[])]);}catch(e){failed.set(id,e.message);}}
  for(const {r,fresh} of docs)results.push(failed.has(r.op.doc)?{key:r.key,label:r.label,ok:false,text:failed.get(r.op.doc)}:{key:r.key,label:r.label,ok:true,text:fresh.text+' · 저장 필요'});
  for(const {r,fresh} of lists){try{results.push({key:r.key,label:r.label,ok:true,text:await fresh.stage()});}catch(e){results.push({key:r.key,label:r.label,ok:false,text:e.message});}}
  staged=null;work.results=results;save();await L.refreshPending();
  if(results.every(r=>r.ok)){dialog.close();YebaeonEditor.status('주보 내용을 Studio에 적용했습니다. 서버에는 아직 저장하지 않았습니다. ‘저장 필요’가 붙은 재생목록을 열어 ‘서버 저장’을 누르세요.');render();return;}message('일부 항목을 적용하지 못했습니다. 결과를 확인하세요.');render();}
 // 바뀌기 전과 뒤를 실제 모양으로 보여 준다. 설교처럼 긴 문서는 위(전)·아래(후) 두 줄을 가로로 넘기고, 나머지는 나란히 둔다.
 function thumbs(xml,name){const model=PP6.parse(xml,name),strip=el('div','bulletin-thumbs');for(const slide of PP6.slides(model)){const c=document.createElement('canvas');c.width=192;c.height=Math.round(192*model.height/model.width);strip.append(c);PP6Render.draw(c,model,slide,new Map()).catch(()=>{});}if(!strip.children.length)strip.append(el('small',null,'슬라이드 없음'));return strip;}
 function side(title,body){const box=el('div','bulletin-compare-side');box.append(el('strong',null,title),body);return box;}
 function order(rows,after){const list=el('ol','bulletin-order-pane');rows.forEach((row,i)=>{const li=el('li',after?(row.changed?'added':''):(row.removed?'removed':row.replaced?'replaced':''));li.append(el('span','n',String(i+1)),el('span','dot'),el('span','nm',row.name));list.append(li);});return list;}
 function preview(r){const p=r.preview,box=el('div','bulletin-compare'+(p?.layout==='stack'?' stack':''));if(!p)return box;
  if(p.kind==='document'){const count=xml=>PP6.slides(PP6.parse(xml,p.name)).length;box.append(side(`변경 전 · ${count(p.before)}장`,thumbs(p.before,p.name)),side(`변경 후 · ${count(p.xml)}장`,thumbs(p.xml,p.name)));}
  else if(p.kind==='playlist')box.append(side('변경 전',order(p.before,false)),side('변경 후',order(p.rows,true)));
  return box;}
 /* ---------- shell ---------- */
 function steps(){const nav=$('bulletinSteps');nav.replaceChildren();if(!work)return;for(const [id,name] of STEPS){const b=el('button');b.setAttribute('role','tab');b.setAttribute('aria-selected',String(work.step===id));b.append(name);
  if(id!=='review'){const left=Object.values(work.slots).filter(s=>s.step===id&&!s.locked&&!s.skip&&(s.kind==='song'?s.value&&!s.choice:!s.value.trim())).length;b.append(el('span','n'+(left?' left':''),left?String(left):'✓'));}
  b.onclick=()=>{work.step=id;ui.active=null;save();render();};nav.append(b);}}
 function foot(){const prev=$('bulletinPrev'),next=$('bulletinNext');if(!work){prev.hidden=next.hidden=true;return;}prev.hidden=next.hidden=false;const i=STEPS.findIndex(s=>s[0]===work.step);prev.disabled=busy||i===0;
  next.disabled=busy;if(work.step==='review'){const done=work.results&&work.results.every(r=>r.ok);const usable=chosen().some(r=>r.ok);next.textContent=done?'닫기':usable?'적용':busy?'미리 보기 만드는 중…':'미리 보기 다시 만들기';}else next.textContent=i===3?'검토하기':'다음';}
 // 화면을 다시 그리는 동안 포커스된 입력칸이 빠지면 change가 다시 render를 부른다. 끝난 뒤 한 번 더 그린다.
 let rendering=false,again=false;
 function render(){if(rendering){again=true;return;}rendering=true;try{draw();}finally{rendering=false;}if(again){again=false;render();}}
 function draw(){start.setName(work?work.file:'');dateLabel.hidden=!work;dateInput.value=work?.date?work.date.replace(/-/g,'. ')+'.':'';dateInput.disabled=busy;steps();const root=$('bulletinWork');root.replaceChildren();
  $('bulletinMain').classList.toggle('single',!work||work.step==='review');
  if(!work){root.append(el('p','bulletin-empty','위의 ‘내 컴퓨터에서 불러오기’나 ‘드롭박스에서 가져오기’로 HWP 주보를 여세요. 찬양·기도·주일말씀·주중말씀을 미리 채워 두고, 마지막에 적용하면 Studio에 저장 필요 상태로 넘깁니다.'));}
  else ({song:stepSong,prayer:stepPrayer,sermon:stepSermon,weekday:stepWeekday,review:stepReview})[work.step](root);
  source();sheet();foot();if(work&&work.step!=='review')message(mobile()?'':'칸을 고르고 왼쪽 주보에서 낱말이나 ¶(줄 전체)를 누르세요.');}
 function save(){if(!work)return;try{sessionStorage.setItem(recoveryKey,JSON.stringify({author:C.worker(),work,seq}));}catch{message('브라우저에 작업을 보존하지 못했습니다. 이 창을 닫으면 다시 채워야 합니다.');}}
 function lock(value){busy=value;dialog.setAttribute('aria-busy',String(value));for(const e of dialog.querySelectorAll('button,input,select'))e.disabled=value;if(!value)render();}
 async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){message(e.message);}finally{lock(false);}}
 async function loadFile(file){if(!/\.hwp$/i.test(file.name))throw Error('HWP 5 파일을 선택하세요.');if(file.size>16*1024*1024)throw Error('16MB 이내 주보를 선택하세요.');const parsed=BP.parse(await file.arrayBuffer());plans.clear();YebaeonSearch.clear();reviewOps=null;staged=null;previewKey=null;ui.active=null;build(parsed,file.name);save();render();message(file.name+(parsed.date?'':' · 주보 날짜를 찾지 못했습니다. 파일 이름 옆에 날짜를 입력하세요.'));}
 button.onclick=()=>{if(!C.needUser())return;if(!work){try{const saved=JSON.parse(sessionStorage.getItem(recoveryKey)||'null');if(saved?.author===C.worker()&&saved.work&&confirm('이 탭의 주보 준비 작업을 이어서 할까요?')){work=saved.work;seq=saved.seq||0;}}catch{message('보존한 주보 작업을 읽지 못했습니다. 주보를 다시 여세요.');}}render();dialog.showModal();};
 $('bulletinClose').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});$('bulletinScrim').onclick=closeSheet;
 $('bulletinPrev').onclick=()=>{const i=STEPS.findIndex(s=>s[0]===work.step);if(i>0){work.step=STEPS[i-1][0];ui.active=null;save();render();}};
 $('bulletinNext').onclick=()=>{const i=STEPS.findIndex(s=>s[0]===work.step);if(work.step!=='review'){work.step=STEPS[i+1][0];ui.active=null;save();render();return;}if(work.results&&work.results.every(r=>r.ok)){dialog.close();return;}if(chosen().some(r=>r.ok)){run(commit);return;}staged=null;run(apply);};
 window.addEventListener('yebaeonsession',e=>{if(!e.detail.authenticated){work=null;staged=null;plans.clear();YebaeonSearch.clear();reviewOps=null;dialog.close();}});
 window.YebaeonBulletin={loadFile,state:()=>work,go(step){work.step=step;ui.active=null;render();}};render();
})();
