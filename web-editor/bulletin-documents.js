(function(root){'use strict';
 const P=PP6;
 const QUESTION=/^(What|How|Why|Who|When|Where)\?/i;
 const TITLES='(?:시무|안수|은퇴|협동|원로|명예)?(?:집사|권사|장로)|형제|자매|목사|강도사|전도사|선교사|권찰|성도|청년';
 const boxText=box=>P.parseRTF(P.textNode(box)?.textContent||'').text;
 const balancedRanges=new WeakMap();
 function balanceTitle(box,text){P.setText(box,text);balancedRanges.set(box,[{start:0,end:text.length}]);}
 // 실제 글꼴·자간으로 한 줄을 넘는 제목/대지만 가운데 어절에서 나눈다.
 // 직접 입력한 개행과 빈칸 답의 밑줄 등 기존 run 서식은 그대로 둔다.
 async function balanceSlide(slide){
  const boxes=P.textElements(slide).filter(b=>balancedRanges.has(b));if(!boxes.length)return;
  await PP6Fonts.ensure(slide);const ctx=document.createElement('canvas').getContext('2d');
  for(const box of boxes){const parsed=P.parseRTF(P.textNode(box).textContent),rect=P.rect(box),caps=P.attr(box,'useAllCaps')==='true';let runs=parsed.runs;
   if(!(rect.w>0))continue;
   for(const range of [...balancedRanges.get(box)].reverse()){
    const text=parsed.text.slice(range.start,range.end);if(!text.trim()||/[\r\n]/.test(text))continue;
    const measure=(a,b,w=rect.w)=>PP6Render.layout(ctx,{runs:P.sliceRuns(parsed.runs,range.start+a,range.start+b),emptyStyle:parsed.emptyStyle},{...rect,w},caps);
    if(measure(0,text.length).lines.length<=1)continue;
    let best=null;
    for(const m of text.matchAll(/[ \t]+/g)){const a=m.index,b=a+m[0].length;if(!text.slice(0,a).trim()||!text.slice(b).trim())continue;
     const left=measure(0,a,1e9).lines[0].width,right=measure(b,text.length,1e9).lines[0].width,overflow=Math.max(0,left-rect.w)+Math.max(0,right-rect.w),difference=Math.abs(left-right);
     if(!best||overflow<best.overflow||overflow===best.overflow&&difference<best.difference)best={a,b,overflow,difference};
    }
    if(best){const start=range.start+best.a,end=range.start+best.b,style=P.sliceRuns(parsed.runs,start,start+1)[0]?.style||parsed.emptyStyle;
     runs=[...P.sliceRuns(runs,0,start),{text:'\n',style},...P.sliceRuns(runs,end,Infinity)];}
   }
   P.setRuns(box,runs,parsed.emptyStyle);balancedRanges.delete(box);
  }
 }
 const isScripture=slide=>/\(NKRV\)\s*$/.test(slide.getAttribute('label')||'');
 const isPoint=slide=>P.textElements(slide).some(b=>QUESTION.test(boxText(b).trim()));
 const isRefLine=s=>/^\(.*\d+\s*:\s*\d.*\)$/.test(s.trim());
 function lineStyles(box){const parsed=P.parseRTF(P.textNode(box).textContent),styles=[];let at=0;
  for(const line of parsed.text.split('\n')){styles.push(P.sliceRuns(parsed.runs,at,at+Math.max(1,line.length))[0]?.style||parsed.emptyStyle);at+=line.length+1;}
  return {styles,empty:parsed.emptyStyle};}
 // lines: [{text, style, marks:[{start,end}]}]; marked ranges are underlined.
 function setLines(box,lines){const {empty}=lineStyles(box),runs=[];
  let offset=0;const ranges=[];for(const [i,line] of lines.entries()){if(i)offset++;if(line.balance)ranges.push({start:offset,end:offset+line.text.length});offset+=line.text.length;}if(ranges.length)balancedRanges.set(box,ranges);
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
   setLines(boxes[0],[...(series?[{text:series,style:seriesStyle||titleStyle}]:[]),{text:title,style:titleStyle,balance:true},...(refText?[{text:refText,style:refStyle}]:[])]);return;}
  const refBox=boxes.find(b=>isRefLine(boxText(b))),rest=boxes.filter(b=>b!==refBox).sort((a,b)=>P.rect(a).y-P.rect(b).y);
  if(rest.length>=2){P.setText(rest[0],series||'');balanceTitle(rest[1],title);}else titleLines(rest[0],series,title);
  if(refBox)P.setText(refBox,refText);}
 // A title box is either 'series, blank line, title' or the title alone (possibly broken over lines).
 function titleLines(box,series,title){const {styles,empty}=lineStyles(box),lines=boxText(box).split('\n'),gap=lines.findIndex((l,i)=>i>0&&!l.trim()&&lines.slice(i+1).some(x=>x.trim()));
  const last=lines.map((l,i)=>l.trim()?i:-1).filter(i=>i>=0).at(-1)??0,titleStyle=styles[last]||empty,seriesStyle=gap>0?styles[0]:{...titleStyle,size:Math.round((titleStyle.size||90)*0.6)};
  setLines(box,series?[{text:series,style:seriesStyle},{text:'',style:seriesStyle},{text:title,style:titleStyle,balance:true}]:[{text:title,style:titleStyle,balance:true}]);}
 function sentence(template,fills){const marks=[];let text='';template.split(/_{2,}/).forEach((part,i,parts)=>{text+=part;if(i<parts.length-1){const v=fills[i]||'　　　';marks.push({start:text.length,end:text.length+v.length});text+=v;}});
  // 문장 끝(. ! ?)과 직접 넣은 줄바꿈에서 줄을 나눈다.
  const lines=[];let start=0;for(const m of text.matchAll(/[.!?]\s+|\n/g)){lines.push([start,m[0]==='\n'?m.index:m.index+1]);start=m.index+m[0].length;}lines.push([start,text.length]);
  return lines.filter(([a,b])=>b>a).map(([a,b])=>({text:text.slice(a,b).trim(),marks:marks.filter(m=>m.start>=a&&m.end<=b).map(m=>{const lead=text.slice(a,b).length-text.slice(a,b).trimStart().length;return {start:m.start-a-lead,end:m.end-a-lead};})}));}
 function fillPoint(slide,question,template,fills){
  const boxes=P.textElements(slide),qBox=boxes.find(b=>QUESTION.test(boxText(b).trim())),lines=sentence(template,fills);
  if(!qBox)throw Error('대지 서식 슬라이드를 찾지 못했습니다.');
  const others=boxes.filter(b=>b!==qBox);
  if(!others.length){const {styles}=lineStyles(qBox);setLines(qBox,[...(question?[{text:question,style:styles[0],balance:true}]:[]),...lines.map(l=>({...l,style:styles[1]||styles[0],balance:true}))]);return;}
  balanceTitle(qBox,question||'');const target=others.reduce((a,b)=>boxText(b).length>boxText(a).length?b:a),{styles}=lineStyles(target);setLines(target,lines.map(l=>({...l,style:styles[0],balance:true})));}
 async function verseSlides(model,proto,value,materials,fromTemplate){
  const {bible}=materials,parsed=YebaeonBible.parse(value,bible);await PP6Fonts.ensure(proto);
  const box=P.textElements(proto)[0],rect=P.rect(box),parsedBox=P.parseRTF(P.textNode(box).textContent),style=parsedBox.runs.find(r=>r.text.trim())?.style||parsedBox.emptyStyle,ctx=document.createElement('canvas').getContext('2d');ctx.font=PP6Fonts.css(style);
  const layout=PP6Render.layout(ctx,{runs:[{text:'한',style}],emptyStyle:style},rect),capacity=Math.max(1,Math.floor((rect.h+layout.lines[0].leading)/layout.lines[0].height)),out=[];
  // 화면이 그리는 계산(글꼴·자간 포함)으로 한 줄에 들어가는지 재서, 어절 단위로만 줄을 나눈다.
  const fits=text=>PP6Render.layout(ctx,{runs:[{text,style}],emptyStyle:style},rect).lines.length<=1?0:Infinity;
  for(const verse of parsed.verses){const lines=YebaeonBible.wrap(verse.text,rect.w,fits,true);for(const text of YebaeonBible.balanced(lines,capacity)){
   const slide=clone(model,proto);if(fromTemplate){P.ivar(slide,'array','cues')?.replaceChildren();P.ivar(slide,'RVMediaCue','backgroundMediaCue')?.remove();for(const a of ['notes','chordChartPath'])slide.setAttribute(a,'');}
   const boxes=P.textElements(slide);if(boxes.length<2)throw Error('말씀 서식 슬라이드에 본문·장절 글상자가 필요합니다.');boxes.forEach((b,i)=>P.setText(b,i===0?text:i===1?YebaeonBible.reference(verse):''));slide.setAttribute('label',YebaeonBible.reference(verse)+' (NKRV)');out.push(slide);}}
  return out;}
 async function scriptureProto(model,materials){const own=P.slides(model).find(isScripture);if(own)return {proto:own,fromTemplate:false};
  const {template}=materials,proto=new DOMParser().parseFromString(template.xml,'application/xml').documentElement;if(proto.tagName!=='RVDisplaySlide')throw Error('말씀 템플릿 형식 오류');return {proto,fromTemplate:true};}
 function replaceSlides(model,list){const all=P.slides(model),holder=all[0].parentNode;for(const s of all)s.remove();holder.append(...list);}
 // Sermon order: title → passage → [title → point → quotes]×N → title. Existing slides of each kind are the formats.
 // 제목(첫 글상자 장과 같은 글의 장)·말씀(NKRV)·대지가 아닌 장은 지우지 않는다. 제목보다 앞에 있던 것은 맨 앞, 나머지는 맨 뒤에 모아 둔다.
 const slideText=slide=>P.textElements(slide).map(boxText).join('\n').trim();
 async function sermon(xml,name,data,materials){
  const model=P.parse(xml,name),slides=P.slides(model),at=slides.findIndex(s=>P.textElements(s).length&&!isScripture(s)&&!isPoint(s)),title=at>=0?slides[at]:null,points=slides.filter(isPoint),{proto,fromTemplate}=await scriptureProto(model,materials),notes=[],list=[];
  const titleText=title?slideText(title):'',known=s=>s===title||isScripture(s)||isPoint(s)||!!titleText&&slideText(s)===titleText;
  const front=slides.filter((s,i)=>!known(s)&&(at<0||i<at)),back=slides.filter((s,i)=>!known(s)&&at>=0&&i>at);
  const addTitle=()=>{if(!title){list.push(madeTitle(model,proto,fromTemplate,data));return;}const s=clone(model,title);fillTitle(s,data);list.push(s);};
  addTitle();if(data.passage)list.push(...await verseSlides(model,proto,data.passage,materials,fromTemplate));
  const most=Math.max(0,...data.groups.map(g=>g.points.length));
  if(most&&!points.length)notes.push('대지 서식 슬라이드가 없어 대지를 만들지 못했습니다.');
  else if(most>points.length)notes.push(`대지 ${points.length+1}~${most} 서식이 없어 대지 ${points.length} 서식을 복제했습니다.`);
  for(const g of data.groups)for(const [i,p] of g.points.entries()){if(!points.length)break;addTitle();const s=clone(model,points[Math.min(i,points.length-1)]);fillPoint(s,g.question,p.template,p.fills);list.push(s);for(const q of p.quotes)list.push(...await verseSlides(model,proto,q,materials,fromTemplate));}
  if(data.groups.some(g=>g.points.length)&&points.length)addTitle();
  if(front.length||back.length)notes.push(`형식 밖 장 ${front.length+back.length}개는 지우지 않고 ${[front.length?`앞에 ${front.length}개`:'',back.length?`뒤에 ${back.length}개`:''].filter(Boolean).join(', ')} 모아 두었습니다.`);
  await Promise.all(list.map(balanceSlide));replaceSlides(model,[...front,...list,...back]);return {xml:P.serialize(model),count:list.length,notes};}
 // 우리가 만드는 제목 장: 말씀 서식 슬라이드를 그대로 빌려 본문 글상자에 ‘시리즈·빈 줄·제목’, 장절 글상자에 ‘(장절)’을 넣는다.
 function madeTitle(model,proto,fromTemplate,{series,title,ref}){const slide=clone(model,proto);if(fromTemplate){P.ivar(slide,'array','cues')?.replaceChildren();P.ivar(slide,'RVMediaCue','backgroundMediaCue')?.remove();for(const a of ['notes','chordChartPath'])slide.setAttribute(a,'');}
  const boxes=P.textElements(slide);if(boxes.length<2)throw Error('말씀 서식 슬라이드에 본문·장절 글상자가 필요합니다.');const {empty}=lineStyles(boxes[0]),big={...empty,size:Math.round((empty.size||60)*1.35),bold:true},small={...empty,size:Math.round((empty.size||60)*0.8)};
  setLines(boxes[0],series?[{text:series,style:small},{text:'',style:small},{text:title,style:big,balance:true}]:[{text:title,style:big,balance:true}]);P.setText(boxes[1],ref?`(${ref})`:'');boxes.slice(2).forEach(b=>P.setText(b,''));slide.setAttribute('label',title.split('\n')[0]);return slide;}
 // 문서 전체를 [제목 → 말씀]으로 다시 만든다. 주중 말씀 문서(made)는 [표지 → 제목 → 말씀 → 제목].
 // 주중 말씀 문서(made)는 첫 말씀(NKRV) 장 바로 앞 장을 지난 제목 장으로 보고, 그보다 앞의 장(표지)은 맨 앞에 그대로 둔다.
 // 그 밖에는 첫 장을 제목 서식으로 쓰고, 첫 장에 글상자가 없을 때만 말씀 서식으로 만든다.
 async function titlePassage(xml,name,data,materials,{made=false}={}){const model=P.parse(xml,name),slides=P.slides(model),first=slides[0],{proto,fromTemplate}=await scriptureProto(model,materials);let s,covers=[];if(made){const verse=slides.findIndex(isScripture),before=verse<0?slides.slice(0,1):slides.slice(0,verse),old=before.at(-1);covers=before.slice(0,-1);
   // 지난 제목 장에 글상자가 있으면 그 장의 디자인(배경·글상자·글꼴)을 그대로 두고 글자만 바꾼다. 그림뿐인 제목 장이면 말씀 서식으로 만든다.
   if(old&&P.textElements(old).length){s=clone(model,old);fillTitle(s,data);s.setAttribute('label',data.title.split('\n')[0]);}else s=madeTitle(model,proto,fromTemplate,data);}
  else if(!P.textElements(first).length)s=madeTitle(model,proto,fromTemplate,data);else{s=clone(model,first);fillTitle(s,data);}
  await balanceSlide(s);const list=[...covers,s,...(data.passage?await verseSlides(model,proto,data.passage,materials,fromTemplate):[])];
  // 주중 말씀 문서는 말씀 뒤에 같은 제목 장을 한 번 더 둔다(새 ID, 큐·단축키·메모·코드 차트 없음).
  if(made){const end=clone(model,s);P.ivar(end,'array','cues')?.replaceChildren();for(const a of ['notes','chordChartPath'])end.setAttribute(a,'');list.push(end);}
  replaceSlides(model,list);return {xml:P.serialize(model),count:list.length,notes:covers.length?[`표지 ${covers.length}장은 맨 앞에 그대로 두었습니다.`]:[]};}
 // 기도 장은 정본(1부 ‘대표기도 / 고웅 목사’) 모양으로 고정한다: 한 글상자, 가운데 정렬, ‘대표기도’ 120 · 줄바꿈 · ‘이름 직함’ 150.
 // 글꼴·색·그림자는 고치는 글상자의 첫 글자 서식을 따른다. 기도 장이 여럿이면 정본 모양(두 줄)인 장 하나만 남기고, 글자가 없는 장(표지·첫화면)은 그대로 둔다.
 const PRAYER_HEAD=/^대표\s*기도$/,PRAYER_WORD=/대표\s*기도/;
 const prayerName=()=>new RegExp(`(?:^|\\s)([가-힣]{2,4})(\\s*)(${TITLES})$`);
 const prayerLines=box=>boxText(box).normalize('NFC').split('\n').map(l=>l.trim()).filter(Boolean);
 const isPrayerBox=box=>prayerLines(box).some(l=>PRAYER_WORD.test(l)||prayerName().test(l));
 const canonicalBox=box=>{const lines=prayerLines(box);return lines.length===2&&PRAYER_HEAD.test(lines[0])&&prayerName().test(lines[1]);};
 function prayer(xml,name,person){
  const model=P.parse(xml,name),found=P.slides(model).filter(s=>P.textElements(s).some(isPrayerBox));
  if(!found.length)throw Error('기도 문서에서 ‘대표기도’나 ‘이름 직함’ 글자가 든 장을 찾지 못했습니다.');
  const keep=found.find(s=>P.textElements(s).some(canonicalBox))||found[0],boxes=P.textElements(keep).filter(isPrayerBox),box=boxes.find(canonicalBox)||boxes[0];
  const parsed=P.parseRTF(P.textNode(box).textContent),first=parsed.runs.find(r=>r.text.trim())?.style||parsed.emptyStyle,style={...first,align:'center',underline:false};
  if(!canonicalBox(box)){P.setRect(box,{x:Math.round(model.width*0.1),y:Math.round(model.height*0.3),w:Math.round(model.width*0.8),h:Math.round(model.height*0.4)});box.setAttribute('verticalAlignment','0');}
  P.setRuns(box,[{text:'대표기도',style:{...style,size:120}},{text:'\n',style:{...style,size:120}},{text:person.name+' '+person.title,style:{...style,size:150}}],{...style,size:150});
  for(const other of boxes)if(other!==box)P.setText(other,'');
  for(const s of found)if(s!==keep)s.remove();
  const notes=found.length>1?[`기도 장 ${found.length}개 중 하나만 남겼습니다.`]:[];
  return {xml:P.serialize(model),count:1,notes};}
 root.YebaeonBulletinDocuments={sermon,titlePassage,prayer,sentence};
})(globalThis);
