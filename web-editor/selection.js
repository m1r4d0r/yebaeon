(function(){'use strict';
  let active=null,clipboard=null,drag=null,menuDialog=null;
  const bindings=new WeakMap();
  function dragPayload(row){const binding=bindings.get(row);if(!binding)return null;const {pane,key}=binding;pane.activate();if(!pane.chosen.has(key))pane.select(key);return {pane,keys:pane.values(),context:window.YebaeonPlaylists?.dragState?.()};}
  class Selection {
    constructor(element,options={}){this.element=element;this.options=options;this.keys=[];this.chosen=new Set();this.anchor=null;this.cursor=null;element.addEventListener('pointerdown',()=>this.activate());element.addEventListener('focusin',()=>this.activate());}
    activate(){active=this;document.querySelectorAll('.pane.focused').forEach(e=>e.classList.remove('focused'));this.element.classList.add('focused');window.dispatchEvent(new Event('yebaeonfocus'));}
    setKeys(keys){this.keys=keys;this.chosen=new Set([...this.chosen].filter(k=>keys.includes(k)));if(!keys.includes(this.anchor))this.anchor=null;if(!keys.includes(this.cursor))this.cursor=keys[0]??null;this.paint();}
    select(key,event={}){this.activate();if(event.shiftKey&&this.anchor!==null){const a=this.keys.indexOf(this.anchor),b=this.keys.indexOf(key);if(!event.ctrlKey&&!event.metaKey)this.chosen.clear();this.keys.slice(Math.min(a,b),Math.max(a,b)+1).forEach(k=>this.chosen.add(k));}else if(event.ctrlKey||event.metaKey){if(this.chosen.has(key))this.chosen.delete(key);else this.chosen.add(key);this.anchor=key;}else{this.chosen=new Set([key]);this.anchor=key;}this.cursor=key;this.paint();this.options.onSelect?.(key,event);}
    paint(){for(const el of this.element.querySelectorAll('[data-key]')){const key=el.dataset.key;el.classList.toggle('selected',this.chosen.has(key));el.classList.toggle('current',key===this.cursor);el.setAttribute('aria-selected',String(this.chosen.has(key)));}this.options.onPaint?.();}
    values(){return this.keys.filter(k=>this.chosen.has(k));}
    all(){this.chosen=new Set(this.keys);this.paint();}
    clear(){this.chosen.clear();this.paint();}
    move(delta,event){const from=Math.max(0,this.keys.indexOf(this.cursor));const key=this.keys[Math.max(0,Math.min(this.keys.length-1,from+delta))];if(key===undefined)return;this.select(key,event);this.element.querySelector('[data-key="'+CSS.escape(key)+'"]')?.scrollIntoView({block:'nearest'});}
    bind(el,key){
      el.dataset.key=key;el.setAttribute('role','option');el.tabIndex=-1;bindings.set(el,{pane:this,key});
      el.addEventListener('click',e=>{if(e.target.closest('button'))return;this.element.focus({preventScroll:true});this.select(key,e);});
      if(['documents','order'].includes(this.options.kind)){
        const handle=document.createElement('button');handle.type='button';handle.className='studio-drag-handle'+(this.options.kind==='documents'?' responsive-drag':'');
        handle.setAttribute('aria-label',this.options.kind==='documents'?'끌어 원하는 순서에 추가':'끌어 순서 변경');handle.title=handle.getAttribute('aria-label');handle.draggable=false;
        handle.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});el.append(handle);
      }
      el.draggable=true;el.addEventListener('dragstart',e=>{
        if(window.YebaeonStudioDrag?.active()||e.target.closest('.studio-drag-handle')){e.preventDefault();return;}
        drag=dragPayload(el);e.dataTransfer.effectAllowed='copyMove';e.dataTransfer.setData('text/plain','예배온 항목');
      });
      el.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.drop-before,.drop-after').forEach(e=>e.classList.remove('drop-before','drop-after'));});
    }
  }
  function closeMenu(){const el=document.getElementById('contextMenu');el.hidden=true;if(menuDialog){menuDialog.removeEventListener('close',closeMenu);menuDialog=null;}if(el.parentElement!==document.body)document.body.append(el);}
  function menu(event,items){event.preventDefault();closeMenu();const el=document.getElementById('contextMenu'),dialog=event.target?.closest?.('dialog[open]')||document.activeElement?.closest?.('dialog[open]');if(dialog){menuDialog=dialog;dialog.append(el);dialog.addEventListener('close',closeMenu);}
    el.replaceChildren();for(const item of items){const b=document.createElement('button');b.role='menuitem';b.textContent=item.label;b.disabled=!!item.disabled;if(item.danger)b.className='danger';b.onclick=()=>{closeMenu();Promise.resolve().then(item.action).catch(e=>window.YebaeonEditor.status(e.message));};el.append(b);}el.hidden=false;el.style.left=Math.min(event.clientX||20,innerWidth-230)+'px';el.style.top=Math.min(event.clientY||80,innerHeight-el.offsetHeight-12)+'px';el.querySelector('button:not(:disabled)')?.focus();}
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#contextMenu'))closeMenu();});
  window.YebaeonSelection={Selection,active:()=>active,clipboard:()=>clipboard,copy:value=>{clipboard=value;},drag:()=>drag,dragPayload,menu};
})();
