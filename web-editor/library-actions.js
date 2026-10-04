(function(){'use strict';
 const $=id=>document.getElementById(id),C=YebaeonCloud,P=PP6;
 let sourceXML=null,prepared=null,creating=false,listId=null,emptyLibraryXML=null,sourceGeneration=0,appendTarget=null,insertTarget=null;
 // 서버 카테고리 정책표를 불러오기 전 기본값. 창을 열 때 library-manage.js가 서버 목록으로 바꾼다.
 const names=['가사찬양','악보찬양','예배순서','특별순서','옛날자료'];
 const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 const dialog=$('newDocumentDialog');
 for(const category of names)$('newDocumentCategory').add(new Option(category,category));
 function filename(value){value=value.trim().normalize('NFC').replace(/\.pro6$/i,'');if(!value||/[\\/\x00-\x1f\x7f]/.test(value)||value.length>155)throw new Error('문서 이름은 폴더 구분 없이 1~155자로 입력해 주세요.');return value+'.pro6';}
 function blankDocument(category){
   const rtf=P.textRTF('',{font:'NanumGothicOTF',size:110,bold:true,color:'rgb(255,255,255)',align:'center'});
   return `<RVPresentationDocument UUID="${P.uuid()}" versionNumber="600" width="1920" height="1080" category="${escape(category)}" lastDateUsed="" usedCount="0"><array rvXMLIvarName="groups"><RVSlideGrouping UUID="${P.uuid()}" name="기본"><array rvXMLIvarName="slides"><RVDisplaySlide UUID="${P.uuid()}" label="" enabled="true" drawingBackgroundColor="true" backgroundColor="0 0 0 1"><array rvXMLIvarName="displayElements"><RVTextElement UUID="${P.uuid()}" opacity="1" verticalAlignment="0" drawingFill="false" drawingShadow="false"><RVRect3D rvXMLIvarName="position">{80 90 0 1760 900}</RVRect3D><NSString rvXMLIvarName="RTFData">${rtf}</NSString></RVTextElement></array><array rvXMLIvarName="cues"/></RVDisplaySlide></array></RVSlideGrouping></array></RVPresentationDocument>`;
 }
 function copyDocument(xml,category){
   const model=P.parse(xml,'복제.pro6'),root=model.doc.documentElement,map=P.refreshIDs(root);
   // PP6 arrangements can store UUID references as string elements as well as
   // attributes. Rewrite exact UUIDs only; media paths and lyric RTF stay intact.
   for(const node of P.all(root,'NSString'))if(map.has(node.textContent))node.textContent=map.get(node.textContent);
   root.setAttribute('UUID',root.getAttribute('UUID')||P.uuid());root.setAttribute('category',category);
   root.setAttribute('lastDateUsed','');root.setAttribute('usedCount','0');
   return P.serialize(model);
 }
 async function newDocument(doc=null,{after=null}={}){
   if(!C.needUser()||creating)return;
   appendTarget=doc?null:YebaeonPlaylists.selectedPlaylist();insertTarget=doc&&after&&YebaeonPlaylists.selectedPlaylist()?.editable?{playlist:YebaeonPlaylists.selectedPlaylist().key,item:after}:null;
   if(!doc&&(!appendTarget?.editable||YebaeonPlaylists.state().busy||YebaeonSave?.busy())){YebaeonEditor.status('문서를 추가할 재생목록을 먼저 선택하세요.');return;}
   const generation=++sourceGeneration;sourceXML=null;prepared=null;$('newDocumentTitle').textContent=doc?'문서 복제':'문서 추가';$('newDocumentMessage').textContent='';$('newDocumentName').value=doc?doc.name.replace(/\.pro6$/i,'')+' 복사':'';if([...$('newDocumentCategory').options].some(o=>o.value==='예배순서'))$('newDocumentCategory').value='예배순서';$('newDocumentSubmit').disabled=!!doc;dialog.showModal();
   if(doc){try{const value=await C.documentCopySource(doc.id);if(!dialog.open||generation!==sourceGeneration)return;sourceXML=value.xml;const category=P.parse(sourceXML,'source').doc.documentElement.getAttribute('category')||'미결';if(![...$('newDocumentCategory').options].some(o=>o.value===category))$('newDocumentCategory').add(new Option(category,category));$('newDocumentCategory').value=category;$('newDocumentMessage').textContent=value.local?'이 브라우저에서 편집 중인 내용을 복제합니다. 원본의 미저장 변경도 그대로 남습니다.':'서버에 저장된 가사·서식·배경을 복제합니다. 원본은 바뀌지 않습니다.';if(insertTarget)$('newDocumentMessage').textContent+=' 복제본은 순서에서 원본 바로 뒤에 넣습니다.';$('newDocumentSubmit').disabled=false;}catch(error){$('newDocumentMessage').textContent=error.message;}}
   if(appendTarget){$('newDocumentMessage').textContent=appendTarget.name+' 순서 맨 아래에 추가합니다. 순서는 서버 저장으로 확정하세요.';}
   $('newDocumentSubmit').textContent=doc?'복제':'만들고 추가';$('newDocumentName').focus();$('newDocumentName').select();
 }
 $('documentNew').onclick=()=>newDocument();$('newDocumentClose').onclick=()=>{if(!creating)dialog.close();};
 dialog.addEventListener('cancel',e=>{if(creating)e.preventDefault();});
 $('newDocumentForm').onsubmit=async e=>{e.preventDefault();if(creating)return;creating=true;$('newDocumentSubmit').disabled=true;
   try{const name=filename($('newDocumentName').value),category=$('newDocumentCategory').value,key=name+'\0'+category;
     if(!category||category==='__new__')throw new Error('카테고리를 골라 주세요.');
     if(prepared?.key!==key)prepared={key,xml:sourceXML?copyDocument(sourceXML,category):blankDocument(category)};
     if(appendTarget&&YebaeonPlaylists.selectedPlaylist()?.key!==appendTarget.key)throw new Error('재생목록이 바뀌었습니다. 창을 닫고 추가할 순서에서 다시 시작하세요.');
     const made=await C.createDocument(name,prepared.xml);
     if(appendTarget){
       if(YebaeonPlaylists.selectedPlaylist()?.key===appendTarget.key&&YebaeonPlaylists.appendDocuments([made])){window.YebaeonResponsive?.navigate('order');YebaeonEditor.status(made.name+' · 순서 맨 아래에 추가됨. 서버 저장으로 순서를 확정하세요.');}
       else YebaeonEditor.status('문서는 서버에 생성됐지만 순서에는 추가하지 못했습니다. 이름으로 검색해 추가하세요.');
     }else if(insertTarget){
       if(YebaeonPlaylists.selectedPlaylist()?.key===insertTarget.playlist&&YebaeonPlaylists.insertAfter(insertTarget.item,[made]))YebaeonEditor.status(made.name.replace(/\.pro6$/i,'')+' · 원본 바로 뒤에 추가됨. 서버 저장으로 순서를 확정하세요.');
       else YebaeonEditor.status('복제한 문서는 서버에 생성됐지만 순서에는 추가하지 못했습니다. 이름으로 검색해 추가하세요.');
     }
     dialog.close();
   }catch(error){$('newDocumentMessage').textContent=error.message;}finally{creating=false;$('newDocumentSubmit').disabled=false;}
 };
 const lists=()=>YebaeonPlaylists.libraries();
 $('playlistNew').onclick=()=>{if(!C.needUser())return;if(YebaeonPlaylists.state().busy||YebaeonSave?.busy())return;const select=$('newPlaylistLibrary');select.replaceChildren();for(const l of lists())select.add(new Option(l.path,l.id));if(!lists().length)select.add(new Option('기본 재생목록',''));listId=crypto.randomUUID().toUpperCase();emptyLibraryXML=null;$('newPlaylistName').value='';$('newPlaylistMessage').textContent='';$('newPlaylistDialog').showModal();$('newPlaylistName').focus();};
 $('newPlaylistClose').onclick=()=>$('newPlaylistDialog').close();
 $('newPlaylistForm').onsubmit=async e=>{e.preventDefault();const button=$('newPlaylistSubmit');button.disabled=true;
   try{const name=$('newPlaylistName').value.trim();if(!name)throw new Error('재생목록 이름을 입력해 주세요.');let id=$('newPlaylistLibrary').value;
     if(!id){const xml=emptyLibraryXML||(emptyLibraryXML=`<RVPlaylistDocument versionNumber="600"><RVPlaylistNode UUID="${crypto.randomUUID().toUpperCase()}" displayName="root" type="0" rvXMLIvarName="rootNode"><array rvXMLIvarName="children"/></RVPlaylistNode></RVPlaylistDocument>`);const made=await(await C.api('/playlists?path='+encodeURIComponent('기본.pro6pl'),{method:'POST',body:xml})).json();id=made.library.id;$('newPlaylistLibrary').add(new Option(made.library.path,id));$('newPlaylistLibrary').value=id;}
     const latest=(await(await C.api('/playlists/'+id)).json()).library;
     const result=await(await C.api(`/playlists/${id}/nodes`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':`"${latest.version}"`},body:JSON.stringify({name,id:listId})})).json();
     $('newPlaylistDialog').close();await YebaeonPlaylists.acceptLibrary(result.library,result.playlist.id);
   }catch(error){$('newPlaylistMessage').textContent=error.message;}finally{button.disabled=false;}
 };
 async function archive(library,node){
   if(YebaeonPlaylists.state().dirty||YebaeonPlaylists.state().busy||YebaeonSave?.busy()){ $('playlistsMessage').textContent='현재 변경사항을 저장한 뒤 보관해 주세요.';return; }
   if(!confirm(`‘${node.name}’ 재생목록을 보관할까요? 순서와 확보된 문서 사본을 남기고 사용 중 목록에서 제외합니다. 이미지·영상 원본 전송은 별도입니다.`))return;
   try{const latest=(await(await C.api(`/playlists/${library.id}/plan?`+new URLSearchParams({node:node.id}))).json());const result=await(await C.api(`/playlists/${library.id}/archive?`+new URLSearchParams({node:node.id}),{method:'POST',headers:{'Content-Type':'application/json','If-Match':`"${latest.library.version}"`},body:JSON.stringify({baseNodeHash:latest.playlist.sha256})})).json();await YebaeonPlaylists.acceptLibrary(result.library);$('playlistsMessage').textContent=result.missing?.length?`보관됨 · 원본이 없던 문서 ${result.missing.length}개는 확인 필요`:'재생목록을 보관했습니다.';}catch(error){$('playlistsMessage').textContent=error.message;}
 }
 async function archives(){
   if(!C.needUser())return;$('playlistArchivesDialog').showModal();const target=$('playlistArchivesList');target.replaceChildren();$('playlistArchivesMessage').textContent='보관 목록을 불러오고 있습니다…';
   try{let after='';do{const data=await(await C.api('/playlists?'+new URLSearchParams({scope:'archived',after}))).json();for(const item of data.archives){const row=document.createElement('div');row.className='archive-row';const label=document.createElement('strong');label.textContent=item.name;const inspect=document.createElement('button');inspect.textContent='보관 문서';inspect.onclick=async()=>{inspect.disabled=true;try{const data=await(await C.api(`/playlists/${item.libraryId}/archive?`+new URLSearchParams({node:item.id}))).json();let detail=row.querySelector('.archive-files');if(!detail){detail=document.createElement('div');detail.className='archive-files';row.append(detail);}detail.replaceChildren();for(const doc of data.documents){const link=document.createElement('a');link.textContent=doc.path.replace(/\.pro6$/i,'')+' · 보관 당시 원본';link.href=`/api/playlists/${item.libraryId}/archive?`+new URLSearchParams({node:item.id,document:doc.id});link.download=doc.path.split('/').pop();detail.append(link);}if(data.missing?.length){const p=document.createElement('p');p.textContent='보관 당시 원본 누락: '+data.missing.join(', ');detail.append(p);}}catch(error){$('playlistArchivesMessage').textContent=error.message;}finally{inspect.disabled=false;}};
     const restore=document.createElement('button');restore.textContent='사용 중으로 복원';restore.onclick=async()=>{if(YebaeonPlaylists.state().dirty||YebaeonSave?.busy()){ $('playlistArchivesMessage').textContent='현재 변경사항을 먼저 저장해 주세요.';return;}restore.disabled=true;try{const latest=(await(await C.api('/playlists/'+item.libraryId)).json()).library;const result=await(await C.api(`/playlists/${item.libraryId}/restore?`+new URLSearchParams({node:item.id}),{method:'POST',headers:{'Content-Type':'application/json','If-Match':`"${latest.version}"`},body:'{}'})).json();await YebaeonPlaylists.acceptLibrary(result.library,item.id);row.remove();$('playlistArchivesMessage').textContent='복원했습니다. 현재 문서에 연결됩니다. 배경·영상은 교회에서 확인해 주세요.';}catch(error){$('playlistArchivesMessage').textContent=error.message;}finally{restore.disabled=false;}};row.append(label,inspect,restore);target.append(row);}after=data.next||'';}while(after);$('playlistArchivesMessage').textContent=target.children.length?'순서 복원은 현재 문서에 연결됩니다. 보관 당시 문서는 별도로 내려받을 수 있습니다.':'보관한 재생목록이 없습니다.';}catch(error){$('playlistArchivesMessage').textContent=error.message;}
 }
 $('playlistArchives').onclick=archives;$('playlistArchivesClose').onclick=()=>$('playlistArchivesDialog').close();
 window.YebaeonLibraryActions={blankDocument,copyDocument,duplicate:newDocument,archive,blankDocument,copyDocument};
})();
