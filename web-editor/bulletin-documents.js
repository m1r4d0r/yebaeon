(function(root){'use strict';
 const P=PP6;
 const QUESTION=/^(What|How|Why|Who|When|Where)\?/i;
 const TITLES='(?:시무|안수|은퇴|협동|원로|명예)?(?:집사|권사|장로)|형제|자매|목사|강도사|전도사|선교사|권찰|성도|청년';
 const boxText=box=>P.parseRTF(P.textNode(box)?.textContent||'').text;
 const isScripture=slide=>/\(NKRV\)\s*$/.test(slide.getAttribute('label')||'');
 const isPoint=slide=>P.textElements(slide).some(b=>QUESTION.test(boxText(b).trim()));
 const isRefLine=s=>/^\(.*\d+\s*:\s*\d.*\)$/.test(s.trim());
 function lineStyles(box){const parsed=P.parseRTF(P.textNode(box).textContent),styles=[];let at=0;
  for(const line of parsed.text.split('\n')){styles.push(P.sliceRuns(parsed.runs,at,at+Math.max(1,line.length))[0]?.style||parsed.emptyStyle);at+=line.length+1;}
  return {styles,empty:parsed.emptyStyle};}
 // lines: [{text, style, marks:[{start,end}]}]; marked ranges are underlined.
 function setLines(box,lines){const {empty}=lineStyles(box),runs=[];
  lines.forEach((line,i)=>{const style={...(line.style||empty),underline:false};if(i)runs.push({text:'\n',style});let pos=0;
   for(const m of line.marks||[]){if(m.start>pos)runs.push({text:line.text.slice(pos,m.start),style});runs.push({text:line.text.slice(m.start,m.end),style:{...style,underline:true}});pos=m.end;}
   runs.push({text:line.text.slice(pos),style});});
  P.setRuns(box,runs.filter(r=>r.text),empty);}
 function clone(model,proto){const slide=model.doc.importNode(proto,true);P.refreshIDs(slide);slide.setAttribute('hotKey','');return slide;}
 function fillTitle(slide,{series,title,ref}){
  const boxes=P.textElements(slide);if(!boxes.length)throw Error('제목 서식 슬라이드에 글상자가 없습니다.');
  const refText=ref?`(${ref})`:'';
  if(boxes.length===1){const {styles}=lineStyles(boxes[0]),lines=boxText(boxes[0]).split('\n');
   const refAt=lines.findIndex(isRefLine),body=lines.map((_,i)=>i).filter(i=>i!==refAt);
   const seriesStyle=body.length>=2?styles[body[0]]:null,titleStyle=styles[body.length>=2?body[1]:body[0]??0],refStyle=refAt>=0?styles[refAt]:titleStyle;
   setLines(boxes[0],[...(series?[{text:series,style:seriesStyle||titleStyle}]:[]),{text:title,style:titleStyle},...(refText?[{text:refText,style:refStyle}]:[])]);return;}
  const refBox=boxes.find(b=>isRefLine(boxText(b))),rest=boxes.filter(b=>b!==refBox).sort((a,b)=>P.rect(a).y-P.rect(b).y);
  if(rest.length>=2){P.setText(rest[0],series||'');P.setText(rest[1],title);}else titleLines(rest[0],series,title);
  if(refBox)P.setText(refBox,refText);}
 // A title box is either 'series, blank line, title' or the title alone (possibly broken over lines).
 function titleLines(box,series,title){const {styles,empty}=lineStyles(box),lines=boxText(box).split('\n'),gap=lines.findIndex((l,i)=>i>0&&!l.trim()&&lines.slice(i+1).some(x=>x.trim()));
  const last=lines.map((l,i)=>l.trim()?i:-1).filter(i=>i>=0).at(-1)??0,titleStyle=styles[last]||empty,seriesStyle=gap>0?styles[0]:{...titleStyle,size:Math.round((titleStyle.size||90)*0.6)};
  setLines(box,series?[{text:series,style:seriesStyle},{text:'',style:seriesStyle},{text:title,style:titleStyle}]:[{text:title,style:titleStyle}]);}
 function sentence(template,fills){const marks=[];let text='';template.split(/_{2,}/).forEach((part,i,parts)=>{text+=part;if(i<parts.length-1){const v=fills[i]||'　　　';marks.push({start:text.length,end:text.length+v.length});text+=v;}});
  const lines=[];let start=0;for(const m of text.matchAll(/[.!?]\s+/g)){lines.push([start,m.index+1]);start=m.index+m[0].length;}lines.push([start,text.length]);
  return lines.filter(([a,b])=>b>a).map(([a,b])=>({text:text.slice(a,b).trim(),marks:marks.filter(m=>m.start>=a&&m.end<=b).map(m=>{const lead=text.slice(a,b).length-text.slice(a,b).trimStart().length;return {start:m.start-a-lead,end:m.end-a-lead};})}));}
 function fillPoint(slide,question,template,fills){
  const boxes=P.textElements(slide),qBox=boxes.find(b=>QUESTION.test(boxText(b).trim())),lines=sentence(template,fills);
  if(!qBox)throw Error('대지 서식 슬라이드를 찾지 못했습니다.');
  const others=boxes.filter(b=>b!==qBox);
  if(!others.length){const {styles}=lineStyles(qBox);setLines(qBox,[...(question?[{text:question,style:styles[0]}]:[]),...lines.map(l=>({...l,style:styles[1]||styles[0]}))]);return;}
  P.setText(qBox,question||'');const target=others.reduce((a,b)=>boxText(b).length>boxText(a).length?b:a),{styles}=lineStyles(target);setLines(target,lines.map(l=>({...l,style:styles[0]})));}
 async function verseSlides(model,proto,value,materials,fromTemplate){
  const {bible}=materials,parsed=YebaeonBible.parse(value,bible);await PP6Fonts.ensure(proto);
  const box=P.textElements(proto)[0],rect=P.rect(box),style=P.parseRTF(P.textNode(box).textContent).emptyStyle,ctx=document.createElement('canvas').getContext('2d');ctx.font=PP6Fonts.css(style);
  const layout=PP6Render.layout(ctx,{runs:[{text:'한',style}],emptyStyle:style},rect),capacity=Math.max(1,Math.floor((rect.h+layout.lines[0].leading)/layout.lines[0].height)),out=[];
  for(const verse of parsed.verses){const lines=YebaeonBible.wrap(verse.text,rect.w,s=>ctx.measureText(s).width,true);for(const text of YebaeonBible.balanced(lines,capacity)){
   const slide=clone(model,proto);if(fromTemplate){P.ivar(slide,'array','cues')?.replaceChildren();P.ivar(slide,'RVMediaCue','backgroundMediaCue')?.remove();for(const a of ['notes','chordChartPath'])slide.setAttribute(a,'');}
   const boxes=P.textElements(slide);if(boxes.length<2)throw Error('말씀 서식 슬라이드에 본문·장절 글상자가 필요합니다.');boxes.forEach((b,i)=>P.setText(b,i===0?text:i===1?YebaeonBible.reference(verse):''));slide.setAttribute('label',YebaeonBible.reference(verse)+' (NKRV)');out.push(slide);}}
  return out;}
 async function scriptureProto(model,materials){const own=P.slides(model).find(isScripture);if(own)return {proto:own,fromTemplate:false};
  const {template}=materials,proto=new DOMParser().parseFromString(template.xml,'application/xml').documentElement;if(proto.tagName!=='RVDisplaySlide')throw Error('말씀 템플릿 형식 오류');return {proto,fromTemplate:true};}
 function replaceSlides(model,list){const all=P.slides(model),holder=all[0].parentNode;for(const s of all)s.remove();holder.append(...list);}
 // Sermon order: title → passage → [title → point → quotes]×N → title. Existing slides of each kind are the formats.
 async function sermon(xml,name,data,materials){
  const model=P.parse(xml,name),slides=P.slides(model),title=slides[0],points=slides.filter(isPoint),{proto,fromTemplate}=await scriptureProto(model,materials),notes=[],list=[];
  const addTitle=()=>{const s=clone(model,title);fillTitle(s,data);list.push(s);};
  addTitle();if(data.passage)list.push(...await verseSlides(model,proto,data.passage,materials,fromTemplate));
  const most=Math.max(0,...data.groups.map(g=>g.points.length));
  if(most&&!points.length)notes.push('대지 서식 슬라이드가 없어 대지를 만들지 못했습니다.');
  else if(most>points.length)notes.push(`대지 ${points.length+1}~${most} 서식이 없어 대지 ${points.length} 서식을 복제했습니다.`);
  for(const g of data.groups)for(const [i,p] of g.points.entries()){if(!points.length)break;addTitle();const s=clone(model,points[Math.min(i,points.length-1)]);fillPoint(s,g.question,p.template,p.fills);list.push(s);for(const q of p.quotes)list.push(...await verseSlides(model,proto,q,materials,fromTemplate));}
  if(data.groups.some(g=>g.points.length)&&points.length)addTitle();
  replaceSlides(model,list);return {xml:P.serialize(model),count:list.length,notes};}
 async function titlePassage(xml,name,data,materials){const model=P.parse(xml,name),title=P.slides(model)[0],{proto,fromTemplate}=await scriptureProto(model,materials),s=clone(model,title);fillTitle(s,data);
  const list=[s,...(data.passage?await verseSlides(model,proto,data.passage,materials,fromTemplate):[])];replaceSlides(model,list);return {xml:P.serialize(model),count:list.length,notes:[]};}
 function prayer(xml,name,person){
  const model=P.parse(xml,name),re=new RegExp(`^([가-힣]{2,4})(\\s*)(${TITLES})$`);let hits=0;
  for(const slide of P.slides(model))for(const box of P.textElements(slide)){const lines=boxText(box).split('\n');let changed=false;
   const next=lines.map(line=>{const m=line.trim().match(re);if(!m)return line;changed=true;hits++;return line.replace(line.trim(),person.name+m[2]+person.title);});
   if(changed)P.setText(box,next.join('\n'));}
  if(!hits)throw Error('기도 문서에서 ‘이름 직함’ 줄을 찾지 못했습니다.');
  return {xml:P.serialize(model),count:hits,notes:[]};}
 root.YebaeonBulletinDocuments={sermon,titlePassage,prayer,sentence};
})(globalThis);
