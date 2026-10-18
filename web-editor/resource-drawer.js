(function(){'use strict';
 // 성경·미디어 하단 서랍: 편집 칸 아래에 늘 보이는 손잡이. 높이는 닫힘(손잡이만)·반·전체 세 단계다.
 // 탭은 기존 [성경]·[미디어] 단추를 그대로 옮겨 쓴다(단축키 Alt+B·Alt+V와 여닫기 동작 그대로). 어느 창이 보이는지가 곧 서랍 상태다.
 // 반 높이는 손잡이로 바꿀 수 있고 그 비율을 이 브라우저에 기억한다. 위 끝 근처에 놓으면 전체, 아래 끝 근처면 닫힘.
 const $=id=>document.getElementById(id),R=window.YebaeonResources;
 const KEY='yebaeon.drawer.half.v1',ORDER=['closed','half','full'];
 const column=document.querySelector('.editing-column'),bible=$('biblePanel'),media=$('mediaDrawer');
 if(!column||!bible||!media)return;
 const make=(tag,cls,html)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(html!=null)x.innerHTML=html;return x;};
 const drawer=make('section','resource-drawer');drawer.id='resourceDrawer';drawer.setAttribute('aria-label','성경·미디어 서랍');
 const handle=make('div','resource-drawer-handle','<span class="resource-drawer-grip" aria-hidden="true"></span>');
 const tabs=make('div','resource-drawer-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','서랍 탭');
 const hint=make('span','resource-drawer-hint');
 const up=make('button','resource-drawer-step','▲'),down=make('button','resource-drawer-step','▼');up.type=down.type='button';up.id='drawerUp';down.id='drawerDown';up.setAttribute('aria-label','서랍 한 단계 올리기');down.setAttribute('aria-label','서랍 한 단계 내리기');
 tabs.append($('resourceOpen'),$('mediaOpen'));handle.append(tabs,hint,up,down);
 const body=make('div','resource-drawer-body');body.append(bible,media);drawer.append(handle,body);column.append(drawer);column.classList.add('has-resource-drawer');
 let state='closed',tab='media',wanted=null,ratio=.45;
 try{const v=Number(localStorage.getItem(KEY));if(v>0.15&&v<0.9)ratio=v;}catch(_){}
 const handleHeight=()=>handle.offsetHeight||36;
 const maxHeight=()=>Math.max(handleHeight(),column.clientHeight-(column.querySelector('.studio-editor-toolbar')?.offsetHeight||0)-(parseFloat(getComputedStyle(drawer).bottom)||0));
 function heightOf(s){const max=maxHeight(),h=handleHeight();return s==='closed'?h:s==='full'?max:Math.max(Math.min(h+140,max),Math.min(max-60,Math.round(max*ratio)));}
 function paint(height=heightOf(state)){drawer.dataset.state=state;document.body.classList.toggle('resource-drawer-open',state!=='closed');drawer.style.height=height+'px';column.style.setProperty('--resource-drawer-height',(state==='closed'?handleHeight():height)+'px');
  for(const [b,name] of [[$('resourceOpen'),'bible'],[$('mediaOpen'),'media']]){const on=state!=='closed'&&tab===name;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  hint.textContent=state==='closed'?'눌러서 열기 · 끌어올리기':state==='half'?'끌어서 높이 조절 · 위 끝까지 올리면 전체':'끌어내리면 반';up.disabled=state==='full';down.disabled=state==='closed';}
 // 열린 창이 바뀌면 서랍을 맞춘다. 창을 열고 닫는 기존 코드(단추·단축키·닫기·Esc)를 그대로 쓴다.
 function sync(){const b=!bible.hidden,m=!media.hidden;if(b&&m){if(tab==='bible'){R.closeBible();return;}media.hidden=true;return;}
  if(b||m){tab=b?'bible':'media';if(state==='closed')state=wanted||'half';}else state='closed';wanted=null;paint();}
 new MutationObserver(sync).observe(bible,{attributes:true,attributeFilter:['hidden']});new MutationObserver(sync).observe(media,{attributes:true,attributeFilter:['hidden']});
 function openTab(next){wanted=next;if(tab==='bible')R.showBible();else R.showMedia();}
 function set(next){if(next===state)return;if(next==='closed'){if(!bible.hidden)R.closeBible();media.hidden=true;return;}if(state==='closed'){openTab(next);return;}state=next;paint();}
 const step=dir=>set(ORDER[Math.max(0,Math.min(2,ORDER.indexOf(state)+dir))]);
 up.onclick=()=>step(1);down.onclick=()=>step(-1);
 // 손잡이 끌기: 반 사이 높이는 기억하고, 끝 근처는 전체·닫힘. 빠르게 튕기면 그 방향 한 단계. 움직이지 않고 떼면 열기·닫기.
 let drag=null;
 handle.addEventListener('pointerdown',e=>{if(e.button>0||e.target.closest('button'))return;drag={y:e.clientY,h:drawer.offsetHeight,last:e.clientY,at:performance.now(),v:0,moved:false,id:e.pointerId};handle.setPointerCapture(e.pointerId);drawer.classList.add('dragging');});
 handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dy=e.clientY-drag.y;if(Math.abs(dy)>4)drag.moved=true;if(!drag.moved)return;const now=performance.now();drag.v=(e.clientY-drag.last)/Math.max(1,now-drag.at);drag.last=e.clientY;drag.at=now;
  const h=Math.max(handleHeight(),Math.min(maxHeight(),drag.h-dy));drawer.style.height=h+'px';column.style.setProperty('--resource-drawer-height',h+'px');});
 function end(e){if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;drawer.classList.remove('dragging');
  if(!d.moved){set(state==='closed'?'half':'closed');return;}
  if(Math.abs(d.v)>0.8){if(d.v<0)set(state==='closed'?'half':'full');else set(state==='full'?'half':'closed');paint();return;}
  const h=drawer.offsetHeight,max=maxHeight(),edge=Math.max(48,max*.08);
  if(h>=max-edge)set('full');else if(h<=handleHeight()+edge)set('closed');else{ratio=h/max;try{localStorage.setItem(KEY,String(ratio));}catch(_){}if(state==='closed')openTab('half');else{state='half';}}
  paint();}
 handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
 if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(!drag)paint();}).observe(column);
 sync();
 window.YebaeonDrawer={state:()=>state,tab:()=>tab,set,ratio:()=>ratio};
})();
