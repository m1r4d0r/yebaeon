(function(){
 'use strict';
 const $=id=>document.getElementById(id),E=YebaeonEditor,C=YebaeonCloud,L=YebaeonPlaylists;
 let busy=false,failed=false;
 const summary=document.createElement('button');summary.type='button';summary.setAttribute('aria-label','저장 상태와 범위');summary.id='saveScope';summary.className='save-summary';$('cloudSave').before(summary);
 const base=name=>String(name||'').replace(/\.pro6$/i,'');
 // 서버 저장 한 번에 올릴 것: 이 탭의 미저장 문서 전부, 주보로 넘긴 문서 초안, 열린 순서, 이 탭에서 고치다 떠난 순서와 주보로 넘긴 순서 초안.
 function work(){const memory=C.pendingAll(),ids=new Set(memory.map(r=>r.id)),waiting=L.pendingSummary();
  const drafted=waiting.docs.filter(r=>!ids.has(r.base.id)&&!E.isDirty(r.base.id)).map(r=>({id:r.base.id,xml:r.xml,name:r.name,serial:r.serial,base:r.base,baseXML:r.baseXML,draftID:r.id}));
  return {docs:[...memory,...drafted],lists:waiting.playlists,current:L.state().dirty};}
 function update(){const w=work(),orders=w.lists.length+(w.current?1:0),changed=w.docs.length||orders;
  summary.classList.toggle('save-failed',failed);
  $('cloudSave').disabled=busy||!C.authenticated()||!changed;
  $('cloudSave').textContent=busy?'저장 중…':'서버 저장';
  $('cloudSave').title='저장하지 않은 모든 문서와 순서를 서버에 저장';
  summary.textContent=busy?'저장 중':failed?'! 저장 실패':changed?(window.YebaeonResponsive?.phone()?`수정 ${w.docs.length+orders}`:[w.docs.length?`문서 ${w.docs.length}`:'',orders?`순서 ${orders}`:''].filter(Boolean).join(' · ')+' 수정'):(!C.authenticated()?'연결 안 됨':!L.selectedPlaylist()&&!C.linked()?'대기':window.YebaeonResponsive?.phone()?'✓':'✓ 저장됨');
  summary.title='저장하지 않은 문서·순서 전체';summary.setAttribute('aria-label',summary.textContent+' · 저장 상태와 범위');
 }
 let locked=[],focusBefore=null;
 function lock(value){busy=value;if(value){focusBefore=document.activeElement;locked=[...document.querySelectorAll('main,.topbar,.responsive-nav,dialog,#biblePanel,#mediaDrawer')].map(element=>[element,element.inert]);for(const [element] of locked)element.inert=true;}else{for(const [element,inert] of locked)element.inert=inert;locked=[];focusBefore?.focus();}update();}
 document.addEventListener('keydown',event=>{if(busy&&!event.target.closest?.('#choiceDialog')){event.preventDefault();event.stopImmediatePropagation();}},true);
 // 문서를 먼저, 순서를 나중에 올린다. 문서 하나가 실패해도 나머지 문서는 저장하고, 실패한 것은 브라우저 초안에 남는다.
 // 문서 충돌은 그 자리에서 최신 불러오기·사본 저장·나중에를 고르고, 순서 충돌은 덮어쓴 뒤 무엇이 바뀌었는지 마지막에 한꺼번에 보여 준다.
 async function saveAll(){if(busy||!C.needUser())return;
  failed=false;lock(true);let done=0,total=0;const errors=[],notes=[];L.takeReports();
  try{
   await C.checkpointDraft();await L.checkpoint();await L.refreshPending();
   const w=work();total=w.docs.length+w.lists.length+(w.current?1:0);let current=w.current;if(!total)return;let n=0;
   for(const record of w.docs){E.status(`서버 저장 ${++n}/${total} · ${base(record.name)}`);try{await C.saveRecord(record);done++;}catch(error){if(error.status===409&&error.code==='version_conflict'){try{const r=await C.resolveConflict(record);let text=r.text;if(r.copy){const placed=await L.placeCopy(record.id,r.copy);text+=placed.length?`\n  사본을 ${placed.map(n=>`‘${n}’`).join(', ')} 순서에서 원래 문서 바로 아래에 넣었습니다. 둘을 비교해 하나를 옮기거나 지우세요.`:'\n  순서에는 넣지 않았습니다(이 문서가 든 열린 순서가 없음).';}notes.push(text);done++;continue;}catch(choice){error=choice;}}errors.push(`${base(record.name)}: ${error.message}`);}}
   // 문서가 하나라도 실패하면 순서는 올리지 않는다(순서가 가리킬 문서 내용이 아직 서버에 없을 수 있다).
   if(errors.length)errors.push('문서 저장 실패로 순서는 저장하지 않았습니다.');
   else{
   for(const record of w.lists){E.status(`서버 저장 ${++n}/${total} · ${record.name} 순서`);try{await L.saveRecord(record);done++;}catch(error){errors.push(`${record.name} 순서: ${error.message}`);}}
   if(!current&&L.state().dirty){current=true;total++;}
   if(current){E.status(`서버 저장 ${++n}/${total} · ${L.selectedPlaylist()?.name||''} 순서`);if(await L.save({refresh:false}))done++;else errors.push(`${L.selectedPlaylist()?.name||''} 순서: ${$('playlistsMessage').textContent||'저장 실패'}`);}
   }
   failed=errors.length>0;const reports=L.takeReports();
   if(reports.length)notes.push(...reports.map(r=>`${r.name}: ${r.who} 저장한 순서를 덮어썼습니다.\n  ${r.lines.join('\n  ')}`));
   if(notes.length)await C.choose(failed?'저장 결과 (일부 실패)':'저장 결과',notes.join('\n\n')+(failed?'\n\n저장하지 못한 것: '+errors.join(' / '):''),[['ok','확인','primary']]);
   E.status(failed?`${done}/${total}개 저장 · 실패 ${errors.length}개 — ${errors.join(' / ')} 남은 변경은 브라우저 초안에 보존됩니다.`:`${done}개 서버 저장 완료`);
  }catch(error){failed=true;E.status(`${done}/${total}개 저장 후 멈춤 · ${error.message} 남은 변경은 브라우저 초안에 보존됩니다.`);}
  finally{lock(false);await L.refreshPending();await window.YebaeonSyncLights.refresh();}
 }
 $('cloudSave').onclick=saveAll;
 window.YebaeonSave={update,busy:()=>busy,save:saveAll};
 for(const event of ['yebaeonchange','yebaeonrender','yebaeonclouddocument','yebaeoncloudsaved','yebaeonorderhistory','yebaeonsession'])window.addEventListener(event,()=>queueMicrotask(update));

 update();
})();
