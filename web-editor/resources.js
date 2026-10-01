(function(){
  'use strict';
  const $=id=>document.getElementById(id),editor=window.YebaeonEditor;
  let catalog=null,templates=[],bible=null,loading=null;
  const mediaFiles=new Map();
  const normalize=value=>{try{return decodeURIComponent(value).replace(/^file:\/\//,'').normalize('NFC');}catch(_){return value.normalize('NFC');}};
  async function resource(name){const r=await fetch('/resources/'+name,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error(r.status===401?'입장한 뒤 자료를 사용할 수 있습니다.':'자료를 불러오지 못했습니다.');return r;}
  async function boot(){
    if(catalog)return catalog;if(loading)return loading;
    loading=(async()=>{const data=await (await resource('catalog.json')).json();PP6Fonts.registerCatalog(data.fonts);catalog=data;editor.redraw();return data;})();
    try{return await loading;}finally{loading=null;}
  }
  async function media(source){
    if(!catalog)return null;
    const match=catalog.media.find(x=>normalize(x.source)===normalize(source));
    if(!match)return null; // Never guess missing media from a basename alone.
    if(!mediaFiles.has(match.file))mediaFiles.set(match.file,resource(match.file).then(r=>r.blob()).then(b=>new File([b],match.name,{type:'image/png'})).catch(()=>null));
    return mediaFiles.get(match.file);
  }
  function fillTemplates(){const query=$('templateQuery').value.normalize('NFC').toLowerCase(),old=$('templateSelect').value;const select=$('templateSelect');select.replaceChildren(new Option('현재 슬라이드의 서식',''));for(const t of templates)if((t.name+' '+t.label).normalize('NFC').toLowerCase().includes(query))select.add(new Option(`${t.name} · ${t.label} · ${t.width}×${t.height}`,t.id));if([...select.options].some(x=>x.value===old))select.value=old;}
  const chosen=()=>templates.find(x=>x.id===$('templateSelect').value);
  const book=()=>bible.books[Number($('bibleBook').value)];
  const chapter=()=>book().chapters[Number($('bibleChapter').value)];
  function preview(){if(!bible)return;const from=Number($('bibleFrom').value),to=Number($('bibleTo').value);const selected=chapter().verses.filter(x=>x.number>=from && x.number<=to);$('biblePreview').textContent=selected.map(x=>`${x.number}. ${x.text}`).join('\n');}
  function verses(){for(const id of ['bibleFrom','bibleTo']){const select=$(id);select.replaceChildren();for(const v of chapter().verses)select.add(new Option(v.number+'절',String(v.number)));}preview();}
  function chapters(){const select=$('bibleChapter');select.replaceChildren();book().chapters.forEach((c,i)=>select.add(new Option(c.number+'장',String(i))));verses();}
  async function show(){
    if(!YebaeonCloud.needUser())return;
    $('resourcesDialog').showModal();$('resourceMessage').textContent='자료를 불러오고 있습니다…';
    try{const c=await boot();if(!templates.length)templates=await (await resource('templates.json')).json();if(!bible)bible=await (await resource('bible.json')).json();fillTemplates();$('bibleBook').replaceChildren();bible.books.forEach((b,i)=>$('bibleBook').add(new Option(b.name,String(i))));chapters();$('resourceMessage').textContent=`폰트 ${c.fonts.length}종 · 템플릿 ${c.templateFiles}개 파일 / ${c.templates}개 슬라이드 · ${c.bible.name} ${c.bible.verses.toLocaleString()}절`;}
    catch(e){$('resourceMessage').textContent=e.message;}
  }
  $('resourceOpen').onclick=show;$('resourceClose').onclick=()=>$('resourcesDialog').close();$('serverStatus').onclick=()=>window.open('/status','_blank','noopener');
  $('templateQuery').oninput=fillTemplates;$('bibleBook').onchange=chapters;$('bibleChapter').onchange=verses;$('bibleFrom').onchange=()=>{if(Number($('bibleTo').value)<Number($('bibleFrom').value))$('bibleTo').value=$('bibleFrom').value;preview();};$('bibleTo').onchange=preview;
  $('templateApply').onclick=()=>{try{const t=chosen();if(!t)throw new Error('적용할 템플릿을 선택해 주세요.');editor.applyTemplate(t);$('resourcesDialog').close();}catch(e){$('resourceMessage').textContent=e.message;}};
  $('bibleAdd').onclick=()=>{try{if(!bible)throw new Error('성경 자료를 먼저 불러와 주세요.');const from=Number($('bibleFrom').value),to=Number($('bibleTo').value);const values=chapter().verses.filter(v=>v.number>=from && v.number<=to).map(v=>({text:v.text,reference:`${book().name} ${chapter().number}:${v.number} (개역개정)`}));editor.addBible(values,chosen());$('resourcesDialog').close();}catch(e){$('resourceMessage').textContent=e.message;}};
  window.addEventListener('yebaeonsession',event=>{if(event.detail.authenticated)boot().catch(()=>{});else {catalog=null;mediaFiles.clear();}});
  window.YebaeonResources={boot,media};
})();
