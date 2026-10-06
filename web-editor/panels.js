(function(){'use strict';
 // 이력·초안·교회 Mac 창이 함께 쓰는 조각: 날짜 묶음, 한 줄 행, ⋯ 메뉴, 작업자 메뉴 닫기.
 const $=id=>document.getElementById(id);
 function el(tag,props={},...children){const node=document.createElement(tag);for(const [k,v] of Object.entries(props||{})){if(k==='class')node.className=v;else if(k==='style')node.style.cssText=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(k.startsWith('aria-')||k.startsWith('data-')||k==='role')node.setAttribute(k,v);else if(v!==undefined&&v!==null&&v!==false)node[k]=v;}for(const c of children.flat())if(c!==null&&c!==undefined&&c!==false)node.append(c);return node;}
 const KST={timeZone:'Asia/Seoul'};
 const dayKey=at=>new Intl.DateTimeFormat('en-CA',{...KST,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 const clock=at=>new Intl.DateTimeFormat('ko-KR',{...KST,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
 // 오늘 · 10월 6일 (월) / 어제 · 10월 5일 (일) / 10월 3일 (금)
 function dayLabel(at){
  const key=dayKey(at),today=dayKey(Date.now()),yesterday=dayKey(Date.now()-864e5);
  const text=new Intl.DateTimeFormat('ko-KR',{...KST,month:'long',day:'numeric',weekday:'short'}).format(new Date(at));
  return key===today?'오늘 · '+text:key===yesterday?'어제 · '+text:text;
 }
 // 오늘 14:32 / 어제 08:10 / 10월 3일 09:15 / 2025년 12월 1일 09:15
 function when(at){
  if(!at)return '';const key=dayKey(at);
  if(key===dayKey(Date.now()))return '오늘 '+clock(at);
  if(key===dayKey(Date.now()-864e5))return '어제 '+clock(at);
  const sameYear=key.slice(0,4)===dayKey(Date.now()).slice(0,4);
  return new Intl.DateTimeFormat('ko-KR',{...KST,...(sameYear?{}:{year:'numeric'}),month:'long',day:'numeric'}).format(new Date(at))+' '+clock(at);
 }
 // 목록에 날짜 머리줄을 끼워 넣는다. 더 보기로 이어 붙일 때도 같은 날이면 머리줄을 다시 넣지 않는다.
 function dayed(list,at){if(list.dataset.day!==dayKey(at)){list.dataset.day=dayKey(at);list.append(el('div',{class:'line-day'},dayLabel(at)));}}
 const kinds={document:['문서','kind-doc'],playlist:['순서','kind-order'],file:['파일','kind-file']};
 const kind=k=>el('span',{class:'line-kind '+(kinds[k]||kinds.file)[1]},(kinds[k]||kinds.file)[0]);
 const chip=(text,cls='')=>el('span',{class:'line-chip '+cls},text);

 // ⋯ 메뉴: 행 안에 겹쳐 뜬다. 바깥을 누르거나 Esc, 항목을 누르면 닫힌다.
 let openMenu=null;
 function closeMenu(){if(!openMenu)return;openMenu.menu.remove();openMenu.row.classList.remove('menu-open');openMenu.button.setAttribute('aria-expanded','false');openMenu=null;}
 // items(): [{label, note, danger, disabled, onclick}] — 누를 때마다 다시 만든다.
 function kebab(items,label='더 보기'){
  const button=el('button',{type:'button',class:'line-more','aria-label':label,'aria-haspopup':'menu','aria-expanded':'false',title:label});
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  button.onclick=event=>{
   event.stopPropagation();const same=openMenu?.button===button;closeMenu();if(same)return;
   const menu=el('div',{class:'line-menu',role:'menu'},...items().map(item=>el('button',{type:'button',role:'menuitem',class:item.danger?'danger':'',disabled:!!item.disabled,onclick:e=>{e.stopPropagation();closeMenu();item.onclick();}},el('span',{},item.label),item.note?el('small',{},item.note):null)));
   const row=button.closest('.line-row')||button.parentElement;row.classList.add('menu-open');row.append(menu);
   button.setAttribute('aria-expanded','true');openMenu={menu,button,row};menu.querySelector('button:not(:disabled)')?.focus();
  };
  return button;
 }
 document.addEventListener('pointerdown',event=>{if(openMenu&&!openMenu.menu.contains(event.target)&&event.target!==openMenu.button&&!openMenu.button.contains(event.target))closeMenu();},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&openMenu){event.preventDefault();event.stopPropagation();const b=openMenu.button;closeMenu();b.focus();}},true);
 document.addEventListener('close',closeMenu,true);

 // 작업자 메뉴: 바깥을 누르거나 Esc, 항목을 누르면 닫힌다.
 const menu=$('accountMenu'),account=$('cloudAccount');
 function hideAccount(){if(menu.hidden)return;menu.hidden=true;account.setAttribute('aria-expanded','false');}
 document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!account.contains(event.target))hideAccount();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){hideAccount();account.focus();}});
 menu.addEventListener('click',event=>{if(event.target.closest('button'))setTimeout(hideAccount);});
 function accountName(name){$('accountNameLabel').textContent=name||'';$('accountAvatar').textContent=(name||'').trim().slice(0,1);}
 function draftCount(n){const c=$('draftCount');c.hidden=!n;c.textContent=n?String(n):'';$('draftOpen').setAttribute('aria-label',n?`브라우저 초안 ${n}개`:'브라우저 초안');}

 window.YebaeonPanels={el,dayKey,dayLabel,clock,when,dayed,kind,chip,kebab,closeMenu,hideAccount,accountName,draftCount};
})();
