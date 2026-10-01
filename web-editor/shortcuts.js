(function(){'use strict';
 const $=id=>document.getElementById(id),S=YebaeonSelection,E=YebaeonEditor;let altLeft=false;
 const input=target=>target?.closest('input,textarea,select,[contenteditable="true"]');
 window.addEventListener('keyup',e=>{if(e.code==='AltLeft')altLeft=false;});window.addEventListener('blur',()=>altLeft=false);
 function consume(e,action){e.preventDefault();try{const result=action();if(result?.catch)result.catch(error=>E.status(error.message));}catch(error){E.status(error.message);}}
 document.addEventListener('keydown',e=>{
  if(e.code==='AltLeft'){altLeft=true;return;}if(e.isComposing||e.keyCode===229||e.getModifierState?.('AltGraph'))return;
  const text=input(e.target),mod=e.ctrlKey||e.metaKey,pane=S.active(),dialog=e.target.closest('dialog[open]');
  if(altLeft&&e.altKey&&!mod){const actions={KeyR:()=>E.setView('reflow'),KeyE:()=>E.setView('editor'),KeyB:()=>YebaeonResources.showBible(),KeyV:()=>YebaeonResources.showMedia()};if(actions[e.code]&&!dialog){consume(e,actions[e.code]);return;}}
  if(mod&&!e.altKey&&e.code==='KeyS'){consume(e,()=>$('cloudSave').click());return;}
  if(mod&&!e.altKey&&e.code==='KeyF'&&!dialog){consume(e,()=>{$('libraryQuery').focus();$('libraryQuery').select();});return;}
  if(e.code==='Escape'){
   if(!$('contextMenu').hidden){consume(e,()=>{$('contextMenu').hidden=true;pane?.element.focus();});return;}
   if(dialog)return;
   if(!$('biblePanel').hidden){if(e.target.closest('.bible-card textarea'))return;consume(e,()=>YebaeonResources.closeBible());return;}
   if(!$('mediaDrawer').hidden){consume(e,()=>{$('mediaDrawer').hidden=true;pane?.element.focus();});return;}
   if(text){consume(e,()=>{e.target.blur();pane?.element.focus();});return;}
   if(E.view()!=='slides'){consume(e,()=>E.setView('slides'));return;}consume(e,()=>pane?.clear());return;
  }
  if(text||dialog||!pane||e.target.closest('#contextMenu')||e.target.closest('#libraryDivider'))return;
  if(mod&&!e.altKey){const actions={KeyA:()=>pane.all(),KeyC:()=>pane.options.copy?.(false),KeyX:()=>pane.options.copy?.(true),KeyV:()=>pane.options.paste?.(),KeyZ:()=>pane.options.undo?.(!!e.shiftKey),KeyY:()=>pane.options.undo?.(true)};if(actions[e.code]){consume(e,actions[e.code]);return;}}
  if(e.code==='ContextMenu'||e.code==='F10'&&e.shiftKey){consume(e,()=>pane.options.menu?.(e));return;}
  if(e.target.closest('button,a,summary')&&['Enter','Space'].includes(e.code))return;
  if(e.code==='Enter'){consume(e,()=>pane.options.open?.());return;}if(e.code==='Delete'){consume(e,()=>pane.options.remove?.());return;}if(e.code==='F2'){consume(e,()=>pane.options.rename?.());return;}
  const cols=pane.options.columns?.()||1,moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols,Home:-pane.keys.length,End:pane.keys.length,PageUp:-cols*3,PageDown:cols*3};
  if(e.code in moves&&!e.altKey){consume(e,()=>pane.move(moves[e.code],e));}
 });
 const divider=$('libraryDivider'),column=document.querySelector('.library-column');let dragging=false;
 function resize(value){value=Math.max(20,Math.min(75,value));column.style.setProperty('--library-height',value+'%');divider.setAttribute('aria-valuenow',String(Math.round(value)));try{localStorage.setItem('yebaeon.libraryHeight',value);}catch{}}
 try{const saved=Number(localStorage.getItem('yebaeon.libraryHeight'));if(saved>=20&&saved<=75)resize(saved);}catch{}
 divider.onpointerdown=e=>{dragging=true;divider.setPointerCapture(e.pointerId);};divider.onpointermove=e=>{if(dragging){const rect=column.getBoundingClientRect();resize((e.clientY-rect.top)/rect.height*100);}};divider.onpointerup=()=>dragging=false;divider.onpointercancel=()=>dragging=false;divider.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.code)){e.preventDefault();resize(Number(divider.getAttribute('aria-valuenow'))+(e.code==='ArrowUp'?-3:3));}};
 $('contextMenu').addEventListener('keydown',e=>{const items=[...$('contextMenu').querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);if(e.code==='ArrowDown'||e.code==='ArrowUp'){e.preventDefault();e.stopPropagation();items[(index+(e.code==='ArrowDown'?1:items.length-1))%items.length]?.focus();}});
 window.YebaeonKeys={leftAlt:()=>altLeft};
})();
