(function(){'use strict';
 // 미디어 미리보기 그림: 원본에서 가로 320px(세로는 비율대로, 최대 320px) WebP를 만들어 서버(R2)에 올린다.
 // 서버에 한 번 올라가면 모두가 그 작은 그림을 받는다. Studio 미디어 창과 현황판 일괄 만들기가 함께 쓴다.
 const SIZE=320,tried=new Set();
 const call=(path,options={})=>fetch(path,{credentials:'same-origin',...options}).then(async r=>{if(!r.ok){const data=await r.json().catch(()=>({}));const e=new Error(data.message||'서버에 연결하지 못했습니다.');e.status=r.status;throw e;}return r;});
 async function encode(source){const bitmap=await createImageBitmap(source);try{const scale=Math.min(1,SIZE/bitmap.width,SIZE/bitmap.height),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,c.width,c.height);
   return await new Promise((ok,fail)=>c.toBlob(b=>b?ok(b):fail(new Error('미리보기를 만들지 못했습니다.')),'image/webp',0.8));}finally{bitmap.close();}}
 // source: 원본 Blob(없으면 서버에서 받는다). 같은 sha는 한 탭에서 한 번만 저절로 시도한다(일괄 만들기는 force).
 async function make(sha,source=null,force=false){if(tried.has(sha)&&!force)return false;tried.add(sha);const blob=source||await(await call('/api/media/'+sha+'/content')).blob();const thumb=await encode(blob);
  await call('/api/media/'+sha+'/thumbnail',{method:'PUT',headers:{'Content-Type':thumb.type||'image/webp'},body:thumb});return true;}
 async function existing(hashes){const have=new Set();for(let i=0;i<hashes.length;i+=100){const params=new URLSearchParams({thumbnails:'1'});hashes.slice(i,i+100).forEach(h=>params.append('hash',h));for(const h of (await(await call('/api/media?'+params)).json()).thumbnails)have.add(h);}return have;}
 const url=sha=>'/api/media/'+sha+'/thumbnail',original=sha=>'/api/media/'+sha+'/content';
 // 미리보기를 먼저 쓰고, 없으면 원본을 보여 준 뒤 그 원본으로 미리보기를 만들어 올린다.
 function attach(img,sha){img.src=url(sha);img.onerror=()=>{img.onerror=null;img.src=original(sha);img.addEventListener('load',()=>{make(sha).catch(()=>{});},{once:true});};}
 window.YebaeonThumbnails={make,existing,attach,url,encode};
})();
