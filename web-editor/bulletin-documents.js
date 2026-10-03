(function(root){'use strict';
 const P=PP6;
 const key=s=>s.normalize('NFC').toLowerCase().replace(/\.pro6$/i,'').replace(/[\s\p{P}]/gu,'');
 const query=s=>s.replace(/\([^)]*\)/g,'').trim();
 function textBoxes(model){return P.slides(model).flatMap((slide,si)=>P.textElements(slide).map((box,bi)=>({box,si,bi,text:P.parseRTF(P.textNode(box)?.textContent||'').text})));}
 async function make(item){
  if(item.kind==='scripture'){
   const {bible,template}=await YebaeonResources.bulletinMaterials(),parsed=YebaeonBible.parse(item.value,bible);
   const model=P.parse(YebaeonLibraryActions.blankDocument('예배순서'),'말씀.pro6');model.doc.documentElement.setAttribute('width',template.width);model.doc.documentElement.setAttribute('height',template.height);
   const proto=new DOMParser().parseFromString(template.xml,'application/xml').documentElement;
   if(proto.tagName!=='RVDisplaySlide')throw Error('말씀 템플릿 형식 오류');await PP6Fonts.ensure(proto);
   const box=P.textElements(proto)[0],rect=P.rect(box),style=P.parseRTF(P.textNode(box).textContent).emptyStyle,ctx=document.createElement('canvas').getContext('2d');ctx.font=PP6Fonts.css(style);
   const layout=PP6Render.layout(ctx,{runs:[{text:'한',style}],emptyStyle:style},rect),capacity=Math.max(1,Math.floor((rect.h+layout.lines[0].leading)/layout.lines[0].height));
   const holder=P.slides(model)[0].parentNode;holder.replaceChildren();
   for(const verse of parsed.verses){const lines=YebaeonBible.wrap(verse.text,rect.w,s=>ctx.measureText(s).width,true);for(const value of YebaeonBible.balanced(lines,capacity)){
    const slide=model.doc.importNode(proto,true);P.refreshIDs(slide);P.ivar(slide,'array','cues')?.replaceChildren();P.ivar(slide,'RVMediaCue','backgroundMediaCue')?.remove();for(const a of ['hotKey','notes','chordChartPath'])slide.setAttribute(a,'');
    const boxes=P.textElements(slide);if(boxes.length<2)throw Error('말씀 템플릿에 본문·장절 글상자가 필요합니다.');boxes.forEach((b,i)=>P.setText(b,i===0?value:i===1?YebaeonBible.reference(verse):''));slide.setAttribute('label',YebaeonBible.reference(verse)+' (NKRV)');holder.append(slide);
   }}return P.serialize(model);
  }
  const xml=item.sourceXML?YebaeonLibraryActions.copyDocument(item.sourceXML,'예배순서'):YebaeonLibraryActions.blankDocument('예배순서');const model=P.parse(xml,item.label+'.pro6'),boxes=textBoxes(model);
  const index=item.sourceXML?Number(item.boxIndex):0;if(!Number.isInteger(index)||!boxes[index])throw Error('바꿀 글상자를 선택하세요.');P.setText(boxes[index].box,item.value);return P.serialize(model);
 }
 root.YebaeonBulletinDocuments={key,query,textBoxes,make};
})(globalThis);
