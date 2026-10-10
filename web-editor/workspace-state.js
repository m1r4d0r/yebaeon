/* Same-tab navigation metadata; document content stays in the draft store. */
(function(){
 'use strict';
 const key='yebaeon.workspace';let saved=null;
 try{const value=JSON.parse(sessionStorage.getItem(key));if(value?.version===1&&['playlists','order','edit'].includes(value.page))saved=value;}catch(_){}
 document.body.dataset.page=saved?.page||'playlists';
 window.YebaeonWorkspace={saved,write(value){try{sessionStorage.setItem(key,JSON.stringify({version:1,...value}));}catch(_){}},clear(){try{sessionStorage.removeItem(key);}catch(_){}}};
})();
