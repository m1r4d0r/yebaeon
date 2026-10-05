(function(){'use strict';
 // 사용설명서 화면. 원문은 빌드가 페이지마다 <script type="text/markdown">으로 넣는다(docs/manual/*.md).
 // 같은 원문을 /manual/<id>.md, /manual/llms-full.txt로도 내보내 AI 대화에 붙이거나 받을 수 있다.
 const $=s=>document.querySelector(s),META=document.body.dataset,UPDATED=META.updated||'',SITE=location.origin;
 const pages=[...document.querySelectorAll('script[type="text/markdown"]')].map(s=>({id:s.dataset.id,group:s.dataset.group,title:s.dataset.title,lede:s.dataset.lede||'',admin:s.dataset.admin==='1',md:s.textContent.replace(/^\n/,'').replace(/\s+$/,'')}));
 const groups=[...new Set(pages.map(p=>p.group))];
 const esc=t=>t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 // 작은 Markdown: 제목·문단·목록·표·알림 상자·그림·굵게·코드·링크·kbd, [[버튼]]·[[!강조 버튼]], ::flow 흐름.
 function inline(t){return t.replace(/`([^`]+)`/g,(_,c)=>'<code>'+esc(c)+'</code>').replace(/\[\[(!?)([^\]]+)\]\]/g,(_,p,b)=>`<span class="ui${p?' p':''}">${b}</span>`).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((#[\w-]+)\)/g,'<a href="$2">$1</a>');}
 const slug=(t,used)=>{let s=t.replace(/<[^>]+>/g,'').trim().replace(/[^\w가-힣]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'h';while(used.has(s))s+='-2';used.add(s);return s;};
 const BLOCK=/^(#{2,3} |\||>|\d+\. |- |::|!\[)/;
 function render(md){const lines=md.split('\n'),out=[],used=new Set(),heads=[];let i=0;
  while(i<lines.length){const l=lines[i];let m;
   if(!l.trim()){i++;continue;}
   if((m=/^(#{2,3}) (.+)/.exec(l))){const id=slug(m[2],used);heads.push({lv:m[1].length,id,text:m[2].replace(/<[^>]+>/g,'')});out.push(`<h${m[1].length} id="${id}">${inline(m[2])}</h${m[1].length}>`);i++;continue;}
   if((m=/^!\[([^\]]*)\]\(([^)\s]+)\)(\{small\})?$/.exec(l))){out.push(`<figure${m[3]?' class="small"':''}><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy">${m[1]?`<figcaption>${inline(m[1])}</figcaption>`:''}</figure>`);i++;continue;}
   if(l.startsWith('::flow ')){const parts=l.slice(7).split(';').map(x=>x.split('|').map(s=>s.trim()));out.push('<div class="flow">'+parts.map(([b,s])=>`<div class="n"><b>${b}</b><span>${s||''}</span></div>`).join('<span class="a" aria-hidden="true">→</span>')+'</div>');i++;continue;}
   if(l.startsWith('|')){const rows=[];while(i<lines.length&&lines[i].startsWith('|'))rows.push(lines[i++]);const cells=r=>r.slice(1,-1).split('|').map(c=>c.trim());out.push(`<div class="tw"><table><thead><tr>${cells(rows[0]).map(c=>`<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(r=>'<tr>'+cells(r).map(c=>`<td>${inline(c)}</td>`).join('')+'</tr>').join('')}</tbody></table></div>`);continue;}
   if(l.startsWith('>')){const q=[];while(i<lines.length&&lines[i].startsWith('>'))q.push(lines[i++].replace(/^> ?/,''));const kind=(/^\[!(\w+)\]/.exec(q[0])||[])[1],label={TIP:['tip','도움말'],WARNING:['warn','주의'],NOTE:['note','참고'],ADMIN:['admin','관리자']}[kind]||['note',''];if(kind)q.shift();out.push(`<div class="call ${label[0]}">${label[1]?`<b class="t">${label[1]}</b>`:''}<p>${inline(q.join(' '))}</p></div>`);continue;}
   if(/^(\d+\.|-) /.test(l)){const ol=/^\d/.test(l),items=[];while(i<lines.length&&/^(\d+\.|-) /.test(lines[i]))items.push(lines[i++].replace(/^(\d+\.|-) /,''));out.push(`<${ol?'ol':'ul'}>${items.map(x=>`<li>${inline(x)}</li>`).join('')}</${ol?'ol':'ul'}>`);continue;}
   const p=[];while(i<lines.length&&lines[i].trim()&&!BLOCK.test(lines[i]))p.push(lines[i++]);out.push(`<p>${inline(p.join(' '))}</p>`);}
  return {html:out.join('\n'),heads};}
 const pageMD=p=>`# ${p.title}\n\n> ${p.lede}\n\n${p.md}\n`;
 const ask=service=>{const prompt=`예배온 사용설명서(${SITE}/manual/llms-full.txt)를 읽고, 이 설명서를 기준으로 내 질문에 답해 줘. 질문: `;return service==='chatgpt'?'https://chatgpt.com/?q='+encodeURIComponent(prompt):'https://claude.ai/new?q='+encodeURIComponent(prompt);};
 function toast(t){const e=document.createElement('div');e.className='toast';e.setAttribute('role','status');e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),1800);}
 async function copyText(text,done){try{await navigator.clipboard.writeText(text);toast(done);}catch{showRaw(text,'복사가 막혀 있어요. 아래 글을 선택해 복사하세요.');}}
 async function allMD(){const r=await fetch('llms-full.txt');if(!r.ok)throw new Error('설명서 전체를 불러오지 못했어요.');return r.text();}
 let cur=pages[0]?.id;const current=()=>pages.find(p=>p.id===cur)||pages[0];
 function showRaw(text,note){const p=current();$('#main').innerHTML=`<div class="crumb"><a href="#${p.id}">← ${esc(p.title)}로 돌아가기</a></div><h1>Markdown 원문</h1><p class="lede">${note}</p><pre class="raw" tabindex="0">${esc(text)}</pre>`;$('#toc').replaceChildren();}
 function nav(id){$('#side').innerHTML=groups.map(g=>`<h4>${g}</h4>`+pages.filter(p=>p.group===g).map(p=>`<a href="#${p.id}"${p.id===id?' class="cur" aria-current="page"':''}>${p.title}${p.admin?'<span class="badge">관리자</span>':''}</a>`).join('')).join('');}
 function show(id){const p=pages.find(x=>x.id===id)||pages[0];cur=p.id;const {html,heads}=render(p.md),n=pages.indexOf(p),prev=pages[n-1],next=pages[n+1];
  $('#main').innerHTML=`<div class="crumb">${p.group}${p.admin?' <span class="badge">관리자</span>':''}</div>
  <div class="head-row"><h1>${p.title}</h1><div class="copy"><button class="tbtn" id="copyBtn" aria-haspopup="true" aria-expanded="false">이 페이지 복사 ▾</button>
   <div class="pop" id="copyPop" hidden>
    <button data-act="page"><b>Markdown으로 복사</b><small>이 페이지를 AI 대화나 메모에 붙여 넣기</small></button>
    <a href="${p.id}.md" target="_blank" rel="noopener"><b>Markdown으로 보기</b><small>이 페이지 원문 주소. AI 대화에 링크로 붙여도 돼요</small></a>
    <hr>
    <button data-act="all"><b>설명서 전체 복사</b><small>모든 페이지를 한 덩어리로</small></button>
    <a href="llms-full.txt" download="예배온-사용설명서.md"><b>설명서 전체 받기 (.md)</b><small>파일로 저장</small></a>
    <hr>
    <a href="${ask('chatgpt')}" target="_blank" rel="noopener"><b>ChatGPT에게 물어보기 ↗</b><small>설명서 주소를 넣은 새 대화</small></a>
    <a href="${ask('claude')}" target="_blank" rel="noopener"><b>Claude에게 물어보기 ↗</b><small>설명서 주소를 넣은 새 대화</small></a>
   </div></div></div>
  ${p.lede?`<p class="lede">${p.lede}</p>`:''}<article>${html}</article>
  <div class="pager">${prev?`<a href="#${prev.id}"><small>이전</small><b>${prev.title}</b></a>`:'<span></span>'}${next?`<a class="nx" href="#${next.id}"><small>다음</small><b>${next.title}</b></a>`:'<span></span>'}</div>
  <p class="stamp">${UPDATED?`기준일 ${UPDATED} · `:''}화면 문구가 다르면 화면이 맞아요. 관리자에게 알려 주시면 고칩니다.</p>`;
  $('#toc').innerHTML=heads.length?'<b>이 페이지에서</b>'+heads.map(h=>`<a href="#${p.id}" data-h="${h.id}"${h.lv===3?' class="h3"':''}>${esc(h.text)}</a>`).join(''):'';
  nav(p.id);document.title=p.title+' · 예배온 사용설명서';window.scrollTo(0,0);document.body.classList.remove('nav-open');
  const btn=$('#copyBtn'),pop=$('#copyPop');btn.onclick=e=>{e.stopPropagation();pop.hidden=!pop.hidden;btn.setAttribute('aria-expanded',String(!pop.hidden));};
  pop.onclick=async e=>{const a=e.target.closest('[data-act]');if(!a)return;pop.hidden=true;if(a.dataset.act==='page')copyText(pageMD(p),'이 페이지를 복사했어요');else try{copyText(await allMD(),'설명서 전체를 복사했어요');}catch(error){toast(error.message);}};
  for(const a of $('#toc').querySelectorAll('a'))a.onclick=e=>{e.preventDefault();document.getElementById(a.dataset.h)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
  for(const img of $('#main').querySelectorAll('figure img'))img.onclick=()=>zoom(img);
  spy();}
 function zoom(img){const d=document.createElement('div');d.className='zoom';d.setAttribute('role','dialog');d.setAttribute('aria-label',img.alt||'그림 크게 보기');d.innerHTML=`<img src="${img.getAttribute('src')}" alt="">`;d.onclick=()=>d.remove();document.addEventListener('keydown',function k(e){if(e.key==='Escape'){d.remove();document.removeEventListener('keydown',k);}});document.body.append(d);}
 function spy(){const links=[...$('#toc').querySelectorAll('a')];if(!links.length)return;let on=links[0];for(const a of links){const h=document.getElementById(a.dataset.h);if(h&&h.getBoundingClientRect().top<120)on=a;}links.forEach(a=>a.classList.toggle('cur',a===on));}
 addEventListener('scroll',spy,{passive:true});
 document.addEventListener('click',()=>{const pop=$('#copyPop');if(pop)pop.hidden=true;});
 function route(){const id=location.hash.slice(1);if(document.body.classList.contains('booking'))book(false);show(pages.some(p=>p.id===id)?id:pages[0].id);}
 addEventListener('hashchange',route);
 // 검색: 제목이 맞으면 위, 본문만 맞으면 아래.
 function search(){const d=document.createElement('div');d.className='sdlg';d.innerHTML='<div class="sbox" role="dialog" aria-label="설명서 검색"><input id="manualQuery" placeholder="버튼 이름이나 하고 싶은 일 (예: 휴지통, 받기, 배경)" autocomplete="off" aria-label="찾을 말"><div class="sres" id="manualResults"></div></div>';document.body.append(d);
  const q=d.querySelector('input'),r=d.querySelector('.sres');let sel=0;const close=()=>d.remove();d.onclick=e=>{if(e.target===d)close();};
  const run=()=>{const t=q.value.trim();const hits=pages.map(p=>{const plain=p.md.replace(/!\[[^\]]*\]\([^)]*\)|\[\[!?|\]\]|<[^>]+>|[#*`>|]/g,' ').replace(/\s+/g,' ');const k=t?plain.indexOf(t):0;const score=!t?1:p.title.includes(t)?3:k>=0?2:0;return {p,score,snip:t&&k>=0?plain.slice(Math.max(0,k-24),k+60):p.lede};}).filter(h=>h.score).sort((a,b)=>b.score-a.score).slice(0,8);sel=0;
   r.innerHTML=hits.length?hits.map((h,n)=>`<a href="#${h.p.id}"${n===0?' class="on"':''}><b>${h.p.title}</b>${h.p.admin?' <span class="badge">관리자</span>':''}<small>${t?esc(h.snip).split(esc(t)).join(`<mark>${esc(t)}</mark>`):esc(h.snip)}</small></a>`).join(''):'<p>찾는 내용이 없어요. 다른 낱말로 찾아보세요.</p>';
   for(const a of r.querySelectorAll('a'))a.onclick=close;};
  q.oninput=run;q.onkeydown=e=>{const as=[...r.querySelectorAll('a')];if(e.key==='Escape')close();else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&as.length){e.preventDefault();sel=(sel+(e.key==='ArrowDown'?1:-1)+as.length)%as.length;as.forEach((a,n)=>a.classList.toggle('on',n===sel));}else if(e.key==='Enter'&&as[sel]){location.hash=as[sel].getAttribute('href');close();}};run();q.focus();}
 $('#searchBtn').onclick=search;addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();search();}});
 $('#menuBtn').onclick=()=>document.body.classList.toggle('nav-open');
 // 밝기: 시스템 → 밝게 → 어둡게
 $('#themeBtn').onclick=()=>{const r=document.documentElement,n={'':'light',light:'dark',dark:''}[r.dataset.theme||''];if(n)r.dataset.theme=n;else delete r.dataset.theme;try{localStorage.setItem('yebaeon-manual-theme',n);}catch{ /* 기억하지 못해도 바뀐다 */ }};
 try{const t=localStorage.getItem('yebaeon-manual-theme');if(t)document.documentElement.dataset.theme=t;}catch{ /* 시스템 밝기를 따른다 */ }
 // 책자 보기: 같은 원문을 A5 쪽으로 잇는다. 브라우저 인쇄(PDF 저장)도 이 모양이다.
 function book(on){document.body.classList.toggle('booking',on);$('#bookBtn').classList.toggle('on',on);if(!on)return;let n=1;const folio=t=>`<div class="folio"><span>예배온 사용설명서</span><span>${t}</span></div>`;
  const sheets=[`<div class="sheet cover"><div><p>사용설명서${UPDATED?` · ${UPDATED} 판`:''}</p><h1>예배온<br>Studio · Sync 2</h1></div><p>집에서 고치고, 교회 Mac으로 받기</p></div>`,
   `<div class="sheet toc-sheet"><h1>차례</h1>${groups.map(g=>`<h2>${g}</h2><ol>${pages.filter(p=>p.group===g).map(p=>`<li><span>${p.title}</span>${p.admin?'<span class="badge">관리자</span>':''}</li>`).join('')}</ol>`).join('')}${folio(++n)}</div>`];
  for(const p of pages)sheets.push(`<div class="sheet"><div class="crumb">${p.group}</div><h1>${p.title}</h1>${p.lede?`<p class="lede">${p.lede}</p>`:''}<article>${render(p.md).html}</article>${folio(++n)}</div>`);
  $('#book').innerHTML='<p class="book-note">A5 책자 미리보기예요. 브라우저의 인쇄에서 ‘PDF로 저장’을 고르면 이 모양 그대로 저장돼요. 긴 페이지는 다음 쪽으로 이어집니다.</p>'+sheets.join('');window.scrollTo(0,0);}
 $('#bookBtn').onclick=()=>book(!document.body.classList.contains('booking'));
 addEventListener('beforeprint',()=>{if(!document.body.classList.contains('booking'))book(true);});
 route();
})();
