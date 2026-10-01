(function(){'use strict';
 const records=new Map();let size=0,clock=0;
 const bytes=x=>new TextEncoder().encode(x.xml).length;
 const get=key=>{if(!records.has(key))records.set(key,{undo:[],redo:[]});return records.get(key);};
 function trim(){while(size>200*1024*1024){let candidate;for(const record of records.values())for(const list of [record.undo,record.redo])for(const item of list)if(!candidate||item.tick<candidate.item.tick)candidate={list,item};if(!candidate)break;candidate.list.splice(candidate.list.indexOf(candidate.item),1);size-=candidate.item.size;}}
 function push(list,state){const item={...state,tick:++clock,size:bytes(state)};list.push(item);size+=item.size;while(list.length>50)size-=list.shift().size;trim();}
 function discard(list){for(const item of list)size-=item.size;list.length=0;}
 window.YebaeonHistory={push(key,state){const h=get(key);discard(h.redo);push(h.undo,state);},step(key,current,redo=false){const h=get(key),source=redo?h.redo:h.undo,target=redo?h.undo:h.redo;if(!source.length)return null;const previous=source.pop();size-=previous.size;push(target,current);return previous;},state:key=>{const h=get(key);return {undo:h.undo.length,redo:h.redo.length,bytes:size};},clear(key){const h=get(key);discard(h.undo);discard(h.redo);records.delete(key);}};
})();
