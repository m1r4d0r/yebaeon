/* One grip interaction for mouse, pen and touch; ordinary rows keep scrolling. */
(function(){
 'use strict';
 const S=window.YebaeonSelection,L=window.YebaeonPlaylists,$=id=>document.getElementById(id);
 let drag=null,frame=0,suppressClickUntil=0;
 const marker=document.createElement('div');marker.id='studioDropMarker';marker.hidden=true;marker.setAttribute('aria-hidden','true');
 const markerLabel=document.createElement('span');marker.append(markerLabel);
 const ghost=document.createElement('div');ghost.id='studioDragGhost';ghost.hidden=true;ghost.setAttribute('aria-hidden','true');
 const announcement=document.createElement('div');announcement.className='studio-drag-announcement';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');
 document.body.append(marker,ghost,announcement);
 function dispatch(active,kind){
  document.body.classList.toggle('studio-dragging',active);
  document.body.classList.toggle('studio-drag-documents',active&&kind==='documents');
  window.dispatchEvent(new CustomEvent('yebaeondragchange',{detail:{active,kind}}));
 }
 function visibleBox(node){
  const rect=node.getBoundingClientRect();
  let top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom),left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right);
  for(let parent=node.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
   const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
   if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
   if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right);}
  }
  return {top,bottom,left,right,width:right-left,height:bottom-top};
 }
 function targetAt(x,y){
  const list=$('playlistItems');if(!list||!list.getClientRects().length)return null;
  const box=visibleBox(list);if(box.width<=0||box.height<=0||x<box.left||x>box.right||y<box.top||y>box.bottom)return null;
  // A modal, toolbar or another pane cannot become a hidden drop target.
  const hit=document.elementFromPoint(x,y);if(!hit||!list.contains(hit)&&hit!==list)return null;
  const rows=[...list.querySelectorAll(':scope > .order-item')];
  const next=rows.find(row=>{const rect=row.getBoundingClientRect();return y<rect.top+rect.height/2;});
  const index=next?Number(next.dataset.key):rows.length;
  const edge=next?next.getBoundingClientRect().top:rows.length?rows[rows.length-1].getBoundingClientRect().bottom:box.top+6;
  return {index,list,box,y:Math.max(box.top+2,Math.min(box.bottom-2,edge))};
 }
 function scrollContainer(list){
  for(let node=list;node&&node!==document.body;node=node.parentElement){
   if(node.scrollHeight>node.clientHeight+1&&/auto|scroll/.test(getComputedStyle(node).overflowY))return node;
  }
  return null;
 }
 function paint(){
  if(!drag?.moved)return;
  const width=Math.min(260,innerWidth-16);
  ghost.style.maxWidth=width+'px';ghost.style.left=Math.max(8,Math.min(innerWidth-width-8,drag.x-24))+'px';ghost.style.top=Math.max(8,Math.min(innerHeight-48,drag.y-48))+'px';
  drag.target=L.canDrop(drag.payload)?targetAt(drag.x,drag.y):null;
  marker.hidden=!drag.target;
  if(drag.target){marker.style.left=(drag.target.box.left+3)+'px';marker.style.top=(drag.target.y-1)+'px';marker.style.width=Math.max(0,drag.target.box.width-6)+'px';
   const moving=drag.payload.pane.options.kind==='order',removedBefore=moving?new Set(drag.payload.keys.map(Number).filter(index=>index<drag.target.index)).size:0;
   markerLabel.textContent=(drag.target.index-removedBefore+1)+'번에 '+(moving?'이동':'추가');
  }
  ghost.classList.toggle('can-drop',!!drag.target);
 }
 function tick(){
  frame=0;if(!drag?.moved)return;
  if(!drag.handle.isConnected||!L.canDrop(drag.payload)){cancel();return;}
  paint();
  if(drag.target){
   const scroller=scrollContainer(drag.target.list);
   if(scroller){const box=visibleBox(scroller),edge=Math.min(40,box.height/4);let delta=0;
    if(drag.y<box.top+edge)delta=-Math.ceil((box.top+edge-drag.y)/5);
    else if(drag.y>box.bottom-edge)delta=Math.ceil((drag.y-box.bottom+edge)/5);
    if(delta)scroller.scrollTop+=delta;
   }
  }
  frame=requestAnimationFrame(tick);
 }
 function cancel(){
  if(!drag)return;
  const old=drag;drag=null;cancelAnimationFrame(frame);frame=0;
  if(old.moved)suppressClickUntil=Date.now()+450;
  if(old.handle.hasPointerCapture?.(old.pointer))old.handle.releasePointerCapture(old.pointer);
  marker.hidden=true;ghost.hidden=true;old.handle.removeAttribute('aria-pressed');
  if(old.moved)dispatch(false,old.payload.pane.options.kind);
 }
 document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('.studio-drag-handle');
  if(!handle||event.button!==0||!event.isPrimary||!L.dragState().editable)return;
  cancel();
  const row=handle.closest('[data-key]'),payload=S.dragPayload(row);if(!L.canDrop(payload))return;
  event.preventDefault();event.stopPropagation();
  drag={handle,payload,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false,target:null};
  try{handle.setPointerCapture(event.pointerId);}catch(_){cancel();}
 },true);
 document.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.pointer)return;
  drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.moved){
   if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
   if(!L.canDrop(drag.payload)){cancel();return;}
   drag.moved=true;drag.handle.setAttribute('aria-pressed','true');
   const kind=drag.payload.pane.options.kind,count=drag.payload.keys.length;
   ghost.textContent=count>1?count+'개 '+(kind==='documents'?'문서 추가':'순서 이동'):drag.handle.closest('[data-key]').querySelector('strong')?.textContent||'순서 이동';
   ghost.hidden=false;dispatch(true,kind);
   announcement.textContent='원하는 순서 위치에 놓으세요. Escape 키로 취소할 수 있습니다.';
   frame=requestAnimationFrame(tick);
  }
  event.preventDefault();paint();
 },{capture:true,passive:false});
 document.addEventListener('pointerup',event=>{
  if(!drag||event.pointerId!==drag.pointer)return;
  const old=drag;old.x=event.clientX;old.y=event.clientY;paint();
  const target=old.moved?old.target:null;event.preventDefault();event.stopPropagation();cancel();
  if(target&&L.dropSelection(old.payload,target.index))announcement.textContent=old.payload.pane.options.kind==='documents'?'선택 문서를 순서에 추가했습니다.':'순서를 변경했습니다.';
  else if(old.moved)announcement.textContent='이동을 취소했습니다.';
 },true);
 document.addEventListener('pointercancel',event=>{if(drag?.pointer===event.pointerId)cancel();},true);
 document.addEventListener('lostpointercapture',event=>{if(drag?.pointer===event.pointerId)cancel();},true);
 window.addEventListener('click',event=>{
  if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 window.addEventListener('keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();announcement.textContent='이동을 취소했습니다.';}},true);
 window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
 window.addEventListener('yebaeonplaylistopen',cancel);
 window.YebaeonStudioDrag={cancel,active:()=>!!drag};
})();
