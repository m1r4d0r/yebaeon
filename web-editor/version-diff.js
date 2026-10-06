(function(){'use strict';
 // 버전 비교. 문서는 두 버전의 슬라이드를 실제 모양으로 나란히 두고 바뀜·추가·삭제를 칠한다(주보 비교와 같은 그림).
 // 예배 순서는 항목 이름 목록을 비교한다. 원본은 비교를 누를 때만 받는다.
 const C=()=>window.YebaeonCloud,P=()=>window.YebaeonPanels;
 let dialog=null,sequence=0;
 function frame(){
  if(dialog)return dialog;
  const {el}=P();
  dialog=el('dialog',{class:'library-dialog panel-dialog diff-dialog',id:'versionDiffDialog','aria-labelledby':'versionDiffTitle'});
  const close=el('button',{type:'button',class:'panel-close','aria-label':'닫기',onclick:()=>dialog.close()});close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const only=el('input',{type:'checkbox',id:'versionDiffOnly',onchange:()=>dialog.classList.toggle('only-changed',only.checked)});
  dialog.append(el('div',{class:'panel-head'},el('div',{class:'panel-title'},el('h2',{id:'versionDiffTitle'}),el('p',{id:'versionDiffSub',class:'panel-sub',role:'status'})),el('label',{class:'diff-only',id:'versionDiffOnlyLabel'},only,'바뀐 것만'),close),
   el('div',{id:'versionDiffCols',class:'diff-cols'}),el('div',{id:'versionDiffBody',class:'panel-body'}),
   el('div',{class:'panel-actions'},el('span',{class:'diff-legend'},el('span',{},el('i',{style:'background:#d99a1e'}),'바뀜'),el('span',{},el('i',{style:'background:#1f7a4a'}),'추가'),el('span',{},el('i',{style:'background:#b4233c'}),'삭제')),el('span'),el('span',{id:'versionDiffActions',style:'display:flex;gap:8px;flex:none'})));
  document.body.append(dialog);return dialog;
 }
 function begin(title){
  const d=frame();d.querySelector('#versionDiffTitle').textContent=title;d.querySelector('#versionDiffSub').textContent='불러오는 중…';
  d.querySelector('#versionDiffBody').replaceChildren();d.querySelector('#versionDiffCols').replaceChildren();d.querySelector('#versionDiffActions').replaceChildren();
  d.querySelector('#versionDiffOnly').checked=false;d.classList.remove('only-changed');if(!d.open)d.showModal();return ++sequence;
 }
 // 가장 긴 공통 부분열로 짝을 맞춘다. 사이에 남은 앞·뒤 칸은 차례로 '바뀜'으로 묶고, 남는 쪽은 추가·삭제.
 function align(a,b,same=(x,y)=>x===y){
  const n=a.length,m=b.length,t=Array.from({length:n+1},()=>new Int32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)t[i][j]=same(a[i],b[j])?t[i+1][j+1]+1:Math.max(t[i+1][j],t[i][j+1]);
  const out=[];let i=0,j=0,gapA=[],gapB=[];
  const flush=()=>{const k=Math.min(gapA.length,gapB.length);for(let x=0;x<k;x++)out.push({kind:'changed',a:gapA[x],b:gapB[x]});for(const x of gapA.slice(k))out.push({kind:'removed',a:x});for(const y of gapB.slice(k))out.push({kind:'added',b:y});gapA=[];gapB=[];};
  while(i<n||j<m){if(i<n&&j<m&&same(a[i],b[j])){flush();out.push({kind:'same',a:i,b:j});i++;j++;}else if(j<m&&(i>=n||t[i][j+1]>=t[i+1][j]))gapB.push(j++);else gapA.push(i++);}
  flush();return out;
 }
 // 글자 단위 차이: 지운 것은 del, 넣은 것은 ins.
 function textDiff(before,after){
  const {el}=P(),a=[...before],b=[...after];if(a.length*b.length>250000)return [el('del',{},before),'\n',el('ins',{},after)];
  const parts=[],ops=[];const n=a.length,m=b.length,t=Array.from({length:n+1},()=>new Int32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)t[i][j]=a[i]===b[j]?t[i+1][j+1]+1:Math.max(t[i+1][j],t[i][j+1]);
  let i=0,j=0;while(i<n||j<m){if(i<n&&j<m&&a[i]===b[j]){ops.push(['=',a[i]]);i++;j++;}else if(j<m&&(i>=n||t[i][j+1]>=t[i+1][j]))ops.push(['+',b[j++]]);else ops.push(['-',a[i++]]);}
  for(const [op,ch] of ops){const last=parts[parts.length-1];if(last&&last[0]===op)last[1]+=ch;else parts.push([op,ch]);}
  return parts.map(([op,text])=>op==='='?text:el(op==='+'?'ins':'del',{},text));
 }
 const slideText=slide=>PP6.textElements(slide).map(e=>{const node=PP6.textNode(e);try{return node?PP6.parseRTF(node.textContent).text.trim():'';}catch(_){return '';}}).filter(Boolean).join('\n');
 function canvas(model,slide){const c=document.createElement('canvas');c.width=320;c.height=Math.round(320*model.height/model.width);PP6Render.draw(c,model,slide,new Map()).catch(()=>{});return c;}
 async function documentXML(id,version){return await(await C().api(`/documents/${id}/content?version=${version}`)).text();}

 // 문서 두 버전 비교. older·newer는 버전 번호.
 async function documentDiff(doc,older,newer,{title,restore}={}){
  const {el,when}=P(),run=begin(title||`버전 ${older} ↔ ${newer===doc.version?'현재(버전 '+newer+')':'버전 '+newer}`),d=dialog;
  try{
   const [xa,xb,versions]=await Promise.all([documentXML(doc.id,older),documentXML(doc.id,newer),C().api(`/documents/${doc.id}/versions`).then(r=>r.json()).catch(()=>null)]);
   if(run!==sequence)return;
   const name=doc.name||doc.path?.split('/').pop()||'문서',ma=PP6.parse(xa,name),mb=PP6.parse(xb,name),sa=PP6.slides(ma),sb=PP6.slides(mb);
   const ta=sa.map(slideText),tb=sb.map(slideText),pairs=align(ta,tb);
   const meta=v=>{const x=versions?.versions?.find(r=>r.version===v);return x?`${when(x.createdAt)} · ${x.author}`:'';};
   const count=k=>pairs.filter(p=>p.kind===k).length;
   d.querySelector('#versionDiffSub').textContent=`${doc.path||name} · 바뀜 ${count('changed')} · 추가 ${count('added')} · 삭제 ${count('removed')}`;
   d.querySelector('#versionDiffCols').replaceChildren(el('span'),el('span',{},`버전 ${older}${meta(older)?' · '+meta(older):''}`),el('span',{},`${newer===doc.version?'현재 · ':''}버전 ${newer}${meta(newer)?' · '+meta(newer):''}`),el('span'));
   const label={same:'같음',changed:'바뀜',added:'추가',removed:'삭제'},body=d.querySelector('#versionDiffBody');
   pairs.forEach((p,index)=>{
    const before=p.a!==undefined?el('div',{class:'diff-side before'},canvas(ma,sa[p.a])):el('div',{class:'diff-side before'},el('div',{class:'none'},'없음'));
    const after=p.b!==undefined?el('div',{class:'diff-side after'},canvas(mb,sb[p.b])):el('div',{class:'diff-side after'},el('div',{class:'none'},'없음'));
    if(p.kind==='changed'){before.append(el('div',{class:'diff-text'},...textDiff(ta[p.a],tb[p.b]).filter(x=>typeof x==='string'||x.tagName!=='INS')));after.append(el('div',{class:'diff-text'},...textDiff(ta[p.a],tb[p.b]).filter(x=>typeof x==='string'||x.tagName!=='DEL')));}
    else if(p.kind==='added')after.append(el('div',{class:'diff-text'},el('ins',{},tb[p.b]||'(글 없음)')));
    else if(p.kind==='removed')before.append(el('div',{class:'diff-text'},el('del',{},ta[p.a]||'(글 없음)')));
    body.append(el('div',{class:'diff-row '+p.kind},el('span',{class:'n'},String(index+1)),before,after,el('span',{class:'diff-state'},label[p.kind])));
   });
   if(!pairs.length)body.append(el('p',{class:'line-empty'},'슬라이드가 없습니다.'));
   else if(!pairs.some(p=>p.kind!=='same'))body.prepend(el('p',{class:'line-empty'},'슬라이드 글은 같습니다. 서식·그림만 바뀌었을 수 있습니다.'));
   const actions=d.querySelector('#versionDiffActions'),download=el('a',{class:'line-btn',href:`/api/documents/${doc.id}/content?version=${older}`,download:name.replace(/\.pro6$/i,'')+`-v${older}.pro6`,style:'border:1px solid #ccd6e6;border-radius:6px;padding:6px 10px;color:inherit;text-decoration:none'},`버전 ${older} .pro6 받기`);
   actions.append(download);
   if(restore)actions.append(el('button',{type:'button',class:'primary',onclick:async()=>{try{await restore();d.close();}catch(error){d.querySelector('#versionDiffSub').textContent=error.message;}}},`버전 ${older}으로 복원`));
  }catch(error){if(run===sequence)d.querySelector('#versionDiffSub').textContent=error.message;}
 }
 // 예배 순서 두 버전: 항목 이름 목록.
 function orderNames(xml){const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement,list=[...root.children].find(c=>c.getAttribute('rvXMLIvarName')==='children');return list?[...list.children].map(c=>c.getAttribute('displayName')||c.getAttribute('name')||'(이름 없음)'):[];}
 async function orderDiff(item){
  const {el}=P(),run=begin(`${item.path.split('/').pop()} · 순서 v${item.version-1} → v${item.version}`),d=dialog;
  try{
   const get=v=>C().api(`/playlists/${item.id}/nodes?`+new URLSearchParams({node:item.node,version:String(v)})).then(r=>r.json());
   const [a,b]=await Promise.all([get(item.version-1),get(item.version)]);if(run!==sequence)return;
   const na=orderNames(a.node.xml),nb=orderNames(b.node.xml),pairs=align(na,nb);
   const added=new Set(pairs.filter(p=>p.kind==='added'||p.kind==='changed').map(p=>p.b)),removed=new Set(pairs.filter(p=>p.kind==='removed'||p.kind==='changed').map(p=>p.a));
   d.querySelector('#versionDiffSub').textContent=`이 저장으로 바뀐 것 · 들어옴 ${added.size} · 빠짐 ${removed.size}${a.node.name!==b.node.name?` · 이름 ‘${a.node.name}’ → ‘${b.node.name}’`:''}`;
   const list=(names,marks,cls)=>el('ol',{class:'diff-order'},...names.map((n,i)=>el('li',{class:marks.has(i)?cls:''},el('span',{class:'n'},String(i+1)),el('span',{class:'dot'}),el('span',{class:'nm'},n))));
   d.querySelector('#versionDiffBody').append(el('div',{class:'diff-orders'},el('div',{},el('strong',{},`v${item.version-1} · ${a.node.updatedBy}`),list(na,removed,'removed')),el('div',{},el('strong',{},`v${item.version} · ${b.node.updatedBy}`),list(nb,added,'added'))));
  }catch(error){if(run===sequence)d.querySelector('#versionDiffSub').textContent=error.message;}
 }
 // 작업 이력 한 줄: 그 저장으로 바뀐 것(바로 앞 버전 → 그 버전).
 function activity(item){
  if(item.kind==='document')return documentDiff({id:item.id,path:item.path,name:item.path.split('/').pop(),version:Infinity},item.version-1,item.version,{title:`${item.path.split('/').pop().replace(/\.pro6$/i,'')} · v${item.version-1} → v${item.version}`,restore:false});
  if(item.node)return orderDiff(item);
 }
 // 저장 이력: 고른 버전 ↔ 현재. restore를 주면 [이 버전으로 복원]이 붙는다.
 function documentAgainstCurrent(doc,older,restore){frame().querySelector('#versionDiffOnlyLabel').hidden=false;return documentDiff(doc,older,doc.version,{restore});}
 window.YebaeonDiff={document:documentAgainstCurrent,activity:item=>{frame().querySelector('#versionDiffOnlyLabel').hidden=item.kind!=='document';return activity(item);},align};
})();
