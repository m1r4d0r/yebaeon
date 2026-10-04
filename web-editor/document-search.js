(function(){'use strict';
 // 문서 검색 한 가지. 왼쪽 검색창, 주보 찬양 후보, PPT 교체 대상이 모두 이것을 쓴다.
 // 서버의 관련성순(이름 같음 → 시작 → 포함 → 낱말 모두 → 본문만)과 본문 색인을 쓰며, 같은 검색어는 1분 동안 다시 묻지 않는다.
 const C=YebaeonCloud,TTL=60000,cache=new Map();
 const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=text;return x;};
 const stem=name=>String(name||'').replace(/\.pro6$/i,'');
 // query: {documents, next}. cursor로 다음 쪽을 받는다. includeArchived는 옛날자료까지 본다.
 async function query(q,{cursor=null,includeArchived=false,fresh=false}={}){q=String(q||'').trim();if(!q)return {documents:[],next:null};
  const params=new URLSearchParams({q,sort:'relevance',includeIndexed:'1'});if(includeArchived)params.set('includeArchived','1');if(cursor)params.set('cursor',cursor);
  const key=params.toString(),hit=cache.get(key);if(!fresh&&hit&&Date.now()-hit.at<TTL)return hit.data;
  const data=C.api('/documents?'+params).then(r=>r.json());cache.set(key,{at:Date.now(),data});try{return await data;}catch(e){cache.delete(key);throw e;}}
 const clear=()=>cache.clear();
 // 작은 검색창: [검색어][검색] 아래 결과 단추. extras는 결과 앞에 둘 단추(예: 지금 이 자리), decorate(doc)는 {tag,on}을 돌려준다.
 function box(container,{value='',placeholder='문서 이름·본문',label='문서 검색',limit=30,itemClass='',extras=()=>[],decorate=()=>({}),onPick,onQuery}={}){
  const root=el('div','doc-search'),row=el('div','doc-search-row'),input=el('input'),go=el('button',null,'검색'),list=el('div','doc-search-list');
  input.type='search';input.value=value;input.placeholder=placeholder;input.setAttribute('aria-label',label);go.type='button';row.append(input,go);root.append(row,list);container.replaceChildren(root);
  const item=(doc,info={})=>{const b=el('button','doc-search-item'+(itemClass?' '+itemClass:'')+(info.on?' on':''));b.type='button';b.append(el('span','nm',stem(doc.name)),el('span','tag',info.tag??(doc.matchedBy==='content'?'본문 일치':doc.category||'')));b.onclick=()=>onPick?.(doc,info);return b;};
  let generation=0;
  async function run(){const q=input.value.trim(),g=++generation;onQuery?.(q);list.replaceChildren(...extras().map(x=>item(x.doc,x)));if(!q)return;list.append(el('p','hint','찾는 중…'));
   try{const docs=(await query(q)).documents.filter(d=>d.available!==false);if(g!==generation)return;list.querySelector('.hint')?.remove();
    for(const d of docs.slice(0,limit))list.append(item(d,decorate(d)));
    if(!docs.length)list.append(el('p','hint','검색 결과가 없습니다. 검색어를 고쳐 보세요.'));else if(docs.length>limit)list.append(el('p','hint','결과가 많습니다. 검색어를 더 구체적으로 입력하세요.'));}
   catch(e){if(g===generation){list.querySelector('.hint')?.remove();list.append(el('p','hint bad',e.message));}}}
  go.onclick=run;input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();run();}};
  return {run,input,focus:()=>input.focus(),element:root};
 }
 window.addEventListener('yebaeoncloudsaved',clear);
 window.YebaeonSearch={query,box,clear,stem};
})();
