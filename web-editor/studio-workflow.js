(function(){
 'use strict';
 const $=id=>document.getElementById(id),E=YebaeonEditor,C=YebaeonCloud,P=PP6,L=YebaeonPlaylists;
 let busy=false;
 const summary=document.createElement('span');summary.id='saveScope';summary.className='save-summary';summary.setAttribute('role','status');$('cloudSave').before(summary);
 function scope(){const playlist=L.saveScope();return playlist?{...playlist,playlist:true}:{name:E.state().name.replace(/\.pro6$/i,''),ids:C.linked()?[C.linked().id]:[],dirty:false,playlist:false};}
 function update(){const selected=scope(),docs=selected.ids.filter(id=>E.isDirty(id)),changed=docs.length||selected.dirty;
  $('cloudSave').disabled=busy||!C.authenticated()||!changed;
  $('cloudSave').textContent=busy?'저장 중…':'변경사항 저장 Ctrl+S';
  $('cloudSave').title=(selected.playlist?selected.name+'의 수정한 문서와 순서':'현재 문서')+'를 서버에 저장';
  summary.textContent=changed?[docs.length?`문서 ${docs.length}개`:'',selected.dirty?'순서 변경':''].filter(Boolean).join(' · '):'';
  summary.title=selected.playlist?selected.name+' 일괄 저장':'현재 문서 저장';
 }
 let locked=[],focusBefore=null;
 function lock(value){busy=value;if(value){focusBefore=document.activeElement;locked=[...document.querySelectorAll('main,.topbar,dialog,#biblePanel,#mediaDrawer')].map(element=>[element,element.inert]);for(const [element] of locked)element.inert=true;}else{for(const [element,inert] of locked)element.inert=inert;locked=[];focusBefore?.focus();}update();}
 document.addEventListener('keydown',event=>{if(busy){event.preventDefault();event.stopImmediatePropagation();}},true);
 async function saveAll(){if(busy||!C.needUser())return;const selected=scope(),records=C.pendingDocuments(selected.ids);if(!records.length&&!selected.dirty)return;
  lock(true);let done=0;summary.classList.remove('save-failed');
  try{
   // A single captured scope; never switch documents to save their cached drafts.
   await C.checkpointDraft();await L.checkpoint();
   for(const record of records){E.status(`${selected.name} · 문서 ${done+1}/${records.length} 저장 중…`);await C.saveRecord(record);done++;}
   if(selected.playlist&&selected.dirty){if(L.saveScope()?.key!==selected.key)throw new Error('재생목록이 바뀌어 순서 저장을 멈췄습니다.');if(!await L.save({refresh:false}))throw new Error($('playlistsMessage').textContent||'순서 저장에 실패했습니다.');}
   E.status(`${selected.name} · ${done?`문서 ${done}개`:''}${done&&selected.dirty?' · ':''}${selected.dirty?'순서 ':''}서버 저장 완료`);
  }catch(error){summary.classList.add('save-failed');E.status(`문서 ${done}/${records.length}개 저장 완료 · ${error.message} 남은 변경은 초안에 보존됩니다.`);}
  finally{lock(false);await window.YebaeonSyncLights.refresh();}
 }
 $('cloudSave').onclick=saveAll;
 window.YebaeonSave={update,busy:()=>busy,save:saveAll};
 for(const event of ['yebaeonchange','yebaeonrender','yebaeonclouddocument','yebaeoncloudsaved','yebaeonorderhistory','yebaeonsession'])window.addEventListener(event,()=>queueMicrotask(update));

 update();
})();
