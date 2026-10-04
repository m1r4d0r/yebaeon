(function(root){'use strict';
 const MAX=16*1024*1024;
 const clean=s=>String(s||'').normalize('NFC').replace(/[ \t]+/g,' ').trim();
 function text(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let s='';for(let i=0;i+1<bytes.length;){const c=v.getUint16(i,true);if([1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23].includes(c)){if(c===9)s+=' ';i+=16;}else{if(c>=32)s+=String.fromCharCode(c);else if(c===10||c===13)s+='\n';i+=2;}}return clean(s);}
 function records(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];let p=0;while(p<bytes.length){if(p+4>bytes.length)throw Error('HWP 레코드가 잘렸습니다.');const h=v.getUint32(p,true);p+=4;let size=h>>>20;if(size===4095){if(p+4>bytes.length)throw Error('HWP 크기 정보 오류');size=v.getUint32(p,true);p+=4;}if(p+size>bytes.length||out.length>100000)throw Error('HWP 레코드 범위 오류');out.push({tag:h&1023,level:(h>>>10)&1023,data:bytes.subarray(p,p+size)});p+=size;}return out;}
 function tablesFromRecords(seq,offset=0){const tables=[],stack=[],paragraphs=[];for(const r of seq){while(stack.length&&r.level<=stack.at(-1).level)stack.pop();const id=r.tag===71?String.fromCharCode(...r.data.subarray(0,4)):'';
   if(id===' lbt'){const table={idx:offset+tables.length,level:r.level,cells:[]};tables.push(table);stack.push(table);continue;}
   const table=stack.at(-1);
   if(table&&r.tag===72&&r.level===table.level+1&&r.data.length>=34){const v=new DataView(r.data.buffer,r.data.byteOffset,r.data.byteLength);table.cell={col:v.getUint16(8,true),row:v.getUint16(10,true),cols:v.getUint16(12,true),rows:v.getUint16(14,true),lines:[]};table.cells.push(table.cell);}
   if(r.tag===67){const s=text(r.data);if(s){paragraphs.push(s);if(table?.cell&&r.level===table.level+2)table.cell.lines.push(...s.split('\n').map(clean).filter(Boolean));}}
 }return {tables:tables.map(t=>({idx:t.idx,cells:t.cells})),paragraphs};}
 const BOOKS='창세기 출애굽기 레위기 민수기 신명기 여호수아 사사기 룻기 사무엘상 사무엘하 열왕기상 열왕기하 역대상 역대하 에스라 느헤미야 에스더 욥기 시편 잠언 전도서 아가 이사야 예레미야 예레미야애가 에스겔 다니엘 호세아 요엘 아모스 오바댜 요나 미가 나훔 하박국 스바냐 학개 스가랴 말라기 마태복음 마가복음 누가복음 요한복음 사도행전 로마서 고린도전서 고린도후서 갈라디아서 에베소서 빌립보서 골로새서 데살로니가전서 데살로니가후서 디모데전서 디모데후서 디도서 빌레몬서 히브리서 야고보서 베드로전서 베드로후서 요한일서 요한이서 요한삼서 유다서 요한계시록'.split(' ');
 const ABBR='창 출 레 민 신 수 삿 룻 삼상 삼하 왕상 왕하 대상 대하 스 느 에 욥 시 잠 전 아 사 렘 애 겔 단 호 욜 암 옵 욘 미 나 합 습 학 슥 말 마 막 눅 요 행 롬 고전 고후 갈 엡 빌 골 살전 살후 딤전 딤후 딛 몬 히 약 벧전 벧후 요일 요이 요삼 유 계'.split(' ');
 const TITLES='(?:시무|안수|은퇴|협동|원로|명예)?(?:집사|권사|장로)|형제|자매|목사|강도사|전도사|선교사|권찰|성도|청년';
 const ORD=['첫째','둘째','셋째','넷째','다섯째'];
 const VARIANT={'입':'[입이]','합':'[합하해]','하':'[하해]','니':'[니이]'};
 const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const words=line=>line.split(' ');
 const isRef=s=>/^[가-힣]+\s*\d+\s*:\s*\d/.test(s);
 function series(body){const m=body.match(/^(.*?\d)\s*,\s*(.+)$/);return m?{series:m[1].trim(),title:m[2].trim()}:{series:'',title:body.trim()};}
 function bookName(s){let i=ABBR.indexOf(s);if(i<0)i=BOOKS.indexOf(s);if(i<0&&s.length>1)i=BOOKS.findIndex(b=>b.startsWith(s));return i<0?null:BOOKS[i];}
 function reference(value){
  const m=String(value||'').replace(/\s+/g,' ').trim().match(/^([가-힣]+)\s*(\d+)\s*:\s*([\d,\-~\s]+)$/);
  if(!m)return {error:'‘책 장:절’ 형식이 아닙니다.'};
  const book=bookName(m[1]);if(!book)return {error:`‘${m[1]}’ 책 이름을 모릅니다.`};
  const chapter=Number(m[2]),list=[];
  for(const part of m[3].replace(/\s/g,'').split(',').filter(Boolean)){const r=part.split(/[-~]/).map(Number);if(r.some(n=>!n))return {error:'절 번호를 확인하세요.'};const [a,b=a]=r;if(b<a)return {error:'끝 절이 시작 절보다 앞입니다.'};for(let n=a;n<=b;n++)list.push(n);}
  const runs=[];for(const n of [...new Set(list)].sort((a,b)=>a-b)){const last=runs.at(-1);if(last&&last.to===n-1)last.to=n;else runs.push({from:n,to:n});}
  const label=r=>`${book} ${chapter}:${r.from}`+(r.to>r.from?`-${r.to}`:'');
  return {book,chapter,runs,labels:runs.map(label),count:list.length};
 }
 function locate(line,value){const i=line.indexOf(value);if(i<0||!value)return null;const before=line.slice(0,i).split(' ').length-1;return {a:before,b:before+value.split(' ').length-1};}
 function src(key,line,text,value){const r=value===undefined?null:locate(text,value);return {key,line,a:r?r.a:null,b:r?r.b:null};}
 const item=(value,source)=>({value:value||'',src:source?[source]:[]});
 function fillBlanks(template,text,pos,end,loose){
  end=end??text.length;const parts=template.split(/_{2,}/),fills=[];
  for(let j=0;j<parts.length-1;j++){
   const before=parts[j],bw=before.trimEnd().split(/\s+/).pop()||'',bSpace=/\s$/.test(before);
   const after=parts[j+1],a0=after.trimStart().charAt(0),aSpace=/^\s/.test(after),last=!a0||/[.!?,]/.test(a0);
   const tail=last?'(?:이다|다|이)?[.,!?]':(aSpace?'\\s+':'\\s*')+(VARIANT[a0]||esc(a0));
   const tries=bw?[esc(bw)+(bSpace?'\\s+':'\\s*')]:[];if(loose||!bw)tries.push('');let m=null;
   for(const head of tries){m=new RegExp(head+'([^\\s.,!?‘’“”]+?)'+tail).exec(text.slice(pos,end));if(m)break;}
   if(!m){fills.push(null);continue;}
   const start=pos+m.index+m[0].indexOf(m[1]);fills.push({text:m[1],start});pos=start+m[1].length;
  }
  return {fills,pos};
 }

 const QUESTION=/^(What|How|Why|Who|When|Where)\?/i;
 const FIXED=/^(예배의 부름|신앙고백|성도의 교제|축복의 선포|합심기도|대표기도|드림의 찬양)/;
 function cellAt(tables,key){const [t,row,col]=key.split(':').map(Number);const c=tables.find(x=>x.idx===t)?.cells.find(x=>x.row===row&&x.col===col);return c?{c,key}:null;}
 // Blank answers come from the summary box: ~다 style sentences after 첫째·둘째·셋째.
 function summaryText(sum){let text='';const map=[];if(sum)sum.c.lines.forEach((line,li)=>{map.push({li,start:text.length,line});text+=line+'\n';});
  return {text,at(start,value){const seg=[...map].reverse().find(s=>s.start<=start);const before=seg.line.slice(0,start-seg.start).split(' ').length-1;return {key:sum.key,line:seg.li,a:before,b:before+value.split(' ').length-1};}};}
 function groups(note,sum,loose=false){const list=[],{text,at}=summaryText(sum);let g=null,p=null,pos=0;
  note.c.lines.forEach((line,li)=>{
   if(QUESTION.test(line)){g={what:item(line,src(note.key,li,line)),points:[]};list.push(g);p=null;return;}
   const pm=line.match(/^(\d+)\.\s*(.*_{2,}.*)$/);
   if(pm&&!g&&loose){const prev=li>0?note.c.lines[li-1]:'',plain=prev&&!/^■/.test(prev)&&!/^\d+\./.test(prev);g={what:plain?item(prev,src(note.key,li-1,prev)):item(),points:[]};list.push(g);}
   if(pm&&g){const template=pm[2],r=blanks(template,text,pos,g.points.length);pos=r.pos;p={template:item(template,src(note.key,li,line,template)),blanks:r.fills.map(f=>f?item(f.text,at(f.start,f.text)):item()),quotes:[]};g.points.push(p);return;}
   const qm=line.match(/^([가-힣]{1,4}\s?\d+:[\d,\-~]+)\s/);
   if(qm&&p)p.quotes.push(item(qm[1],src(note.key,li,line,qm[1])));
  });return list;}
 function blanks(template,text,pos,index){if(!text)return {fills:template.split(/_{2,}/).slice(1).map(()=>null),pos};let end,loose=false;
  const k=text.indexOf(ORD[index],pos);if(k>=0){pos=k;loose=true;const next=ORD.map(o=>text.indexOf(o,k+2)).filter(i=>i>0),nl=text.indexOf('\n',k);end=Math.min(...next,nl<0?text.length:nl);}
  return fillBlanks(template,text,pos,end,loose);}
 function songsIn(cell){const list=[];cell.c.lines.forEach((line,li)=>{if(FIXED.test(line)||line.split('/').length===3||/^[가-힣]+\s*\d+\s*:\s*\d/.test(line))return;list.push(item(/^(부름의 찬양|찬양)$/.test(line)?'':line,src(cell.key,li,line)));});return list;}
 // A user-designated region re-derives suggestions from that cell only.
 function region(tables,key,kind,extra){const cell=cellAt(tables,key);if(!cell)return null;
  if(kind==='songs')return songsIn(cell);
  if(kind==='weekday')return cell.c.lines.slice(0,2).map((line,li)=>weekdayLine(line,key,li,['수요예배','금요예배'][li]));
  if(kind==='note'){const r={series:item(),title:item(),ref:item(),groups:groups(cell,extra?cellAt(tables,extra):null,true)};const heads=cell.c.lines.map((line,li)=>({line,li})).filter(o=>/^■/.test(o.line)),refLine=heads.find(o=>/^■\s*[가-힣]+\s*\d+:\d/.test(o.line)),titleLine=heads.find(o=>o!==refLine);
   if(titleLine){const x=series(titleLine.line.replace(/^■\s*/,''));r.series=item(x.series,x.series?src(key,titleLine.li,titleLine.line,x.series):null);r.title=item(x.title,src(key,titleLine.li,titleLine.line,x.title));}
   if(refLine){const v=refLine.line.replace(/^■\s*/,'');r.ref=item(v,src(key,refLine.li,refLine.line,v));}return r;}
  if(kind==='summary'){const {text,at}=summaryText(cell);let pos=0;return extra.map((template,i)=>{const r=blanks(template,text,pos,i);pos=r.pos;return r.fills.map(f=>f?item(f.text,at(f.start,f.text)):item());});}
  return null;}
 function weekdayLine(line,key,li,day){
  const value=line.trim();
  if(new RegExp(`^[가-힣]{2,4}\\s*(${TITLES})$`).test(value))return {day,minister:value,event:'',series:item(),title:item(),ref:item()};
  const m=value.match(/^(.*?)\(([^)]+)\)\s*$/),body=(m?m[1]:value).trim(),ref=m?m[2].trim():'';
  const r=series(body);
  if(!ref)return {day,minister:'',event:value,series:item(),title:item(r.title,src(key,li,line)),ref:item()};
  return {day,minister:'',event:'',series:item(r.series,r.series?src(key,li,line,r.series):null),title:item(r.title,src(key,li,line,r.title)),ref:item(ref,src(key,li,line,ref))};
 }
 function understand(tables){
  const out={services:[],sermonGroups:[],sermon:{series:item(),title:item(),ref:item(),groups:[]},weekday:[],summary:null};
  const all=tables.flatMap(t=>t.cells.map(c=>({c,key:`${t.idx}:${c.row}:${c.col}`})));
  const order=tables.find(t=>[1,2,3].every(n=>t.cells.some(c=>c.lines.some(s=>s.replace(/\s/g,'').startsWith(n+'부예배')))));
  if(order){
   const K=c=>`${order.idx}:${c.row}:${c.col}`,covers=(c,h)=>c.col<=h.col&&c.col+c.cols>h.col;
   const heads=[1,2,3].map(n=>order.cells.find(c=>c.lines.some(s=>s.replace(/\s/g,'').startsWith(n+'부예배'))));
   const bless=order.cells.find(c=>c.lines.some(s=>/^축복의 선포/.test(s)));
   const sermonCells=order.cells.filter(c=>c.lines.some(isRef)&&(!bless||c.row<bless.row));
   const fixed=/^(예배의 부름|신앙고백|성도의 교제|축복의 선포|합심기도|대표기도)/;
   heads.forEach((h,si)=>{
    const svc={songs:[],after:null,offering:null,prayer:null};let afterSermon=false,offerNext=false,creed=false;
    for(const c of order.cells.filter(c=>c.row>h.row&&(!bless||c.row<=bless.row)&&covers(c,h)).sort((a,b)=>a.row-b.row)){
     if(sermonCells.includes(c)){afterSermon=true;continue;}
     c.lines.forEach((line,li)=>{
      if(line.split('/').length===3){const name=line.split('/')[si].trim();svc.prayer=item(name,src(K(c),li,line,name));return;}
      if(/^드림의 찬양/.test(line)){offerNext=true;return;}
      if(/^신앙고백/.test(line)){creed=true;return;}
      if(fixed.test(line)||!creed)return;
      const untitled=/^(부름의 찬양|찬양)$/.test(line),song=item(untitled?'':line,src(K(c),li,line));
      if(offerNext){svc.offering=song;offerNext=false;}else if(afterSermon){if(!svc.after)svc.after=song;else if(!svc.offering)svc.offering=song;}else svc.songs.push(song);
     });
    }
    out.services.push(svc);
   });
   out.sermonGroups=sermonCells.map(c=>{const g={services:heads.map((h,i)=>covers(c,h)?i:-1).filter(i=>i>=0),series:item(),title:item(),ref:item(),preacher:''},rest=[];
    c.lines.forEach((line,li)=>{if(!g.ref.value&&isRef(line)){const v=line.replace(/\([^)]*\)/g,'').trim();g.ref=item(v,src(K(c),li,line,v));}else if(new RegExp(`(${TITLES})$`).test(line.replace(/\s/g,'')))g.preacher=line;else rest.push({line,li});});
    if(rest.length){const r=series(rest.map(x=>x.line).join(', '));g.series=item(r.series,r.series?src(K(c),rest[0].li,rest[0].line,r.series.split(',')[0]):null);g.title=item(r.title,src(K(c),rest.at(-1).li,rest.at(-1).line));}
    return g;});
   const wk=bless&&order.cells.filter(c=>c.row>bless.row&&c.lines.length).sort((a,b)=>a.row-b.row)[0];
   if(wk)wk.lines.slice(0,2).forEach((line,li)=>out.weekday.push(weekdayLine(line,K(wk),li,['수요예배','금요예배'][li])));
  }
  const S=out.sermon,heads=all.flatMap(x=>x.c.lines.map((line,li)=>({x,line,li}))).filter(o=>/^■/.test(o.line));
  const refLine=heads.find(o=>/^■\s*[가-힣]+\s*\d+:\d/.test(o.line)),titleLine=heads.find(o=>o!==refLine);
  if(titleLine){const body=titleLine.line.replace(/^■\s*/,''),r=series(body);S.series=item(r.series,r.series?src(titleLine.x.key,titleLine.li,titleLine.line,r.series):null);S.title=item(r.title,src(titleLine.x.key,titleLine.li,titleLine.line,r.title));}
  if(refLine){const v=refLine.line.replace(/^■\s*/,'');S.ref=item(v,src(refLine.x.key,refLine.li,refLine.line,v));}
  const sum=all.find(x=>x.c.lines.some(s=>/(^|\s)첫째,/.test(s)));if(sum)out.summary=sum.key;
  const note=all.find(x=>x.c.lines.some(s=>QUESTION.test(s)));
  if(note)S.groups=groups(note,sum);
  return out;
 }
 function splitName(value){const m=String(value||'').trim().match(new RegExp(`^([가-힣\\s]{2,6}?)\\s*(${TITLES})$`));return m?{name:m[1].replace(/\s/g,''),title:m[2]}:null;}
 function songQuery(value){const v=String(value||'').trim(),hymn=v.match(/^찬송가\s*(\d+)/);return hymn?hymn[1]:v.replace(/\([^)]*\)/g,'').trim();}
 function read(buffer){const bytes=new Uint8Array(buffer);if(bytes.length>MAX)throw Error('주보는 16MB 이내 HWP 파일을 선택하세요.');const {CFB,Inflate}=root.YebaeonHWPBinary;const file=CFB.read(bytes,{type:'array'});
  const stream=name=>{const entry=CFB.find(file,name);if(!entry?.content)throw Error('HWP '+name+' 정보가 없습니다.');return new Uint8Array(entry.content);};
  const header=stream('FileHeader');if(new TextDecoder().decode(header.subarray(0,17))!=='HWP Document File'||header.length<40)throw Error('HWP 5 문서가 아닙니다.');const flags=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(36,true);if(flags&6)throw Error('암호화·배포용 주보는 지원하지 않습니다. 일반 HWP로 저장해 주세요.');
  let total=0;const tables=[],paragraphs=[];const paths=file.FullPaths.filter(p=>/\/BodyText\/Section\d+$/.test(p)).sort((a,b)=>Number(a.match(/\d+$/)[0])-Number(b.match(/\d+$/)[0]));
  for(const path of paths){let data=stream(path);if(flags&1){const chunks=[];let size=0;const dec=new Inflate(chunk=>{size+=chunk.length;if(size+total>MAX)throw Error('주보 본문이 너무 큽니다.');chunks.push(chunk);});dec.push(data,true);data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}}
   total+=data.length;if(total>MAX)throw Error('주보 본문이 너무 큽니다.');const parsed=tablesFromRecords(records(data),tables.length);tables.push(...parsed.tables);paragraphs.push(...parsed.paragraphs);}
  return {tables,paragraphs};}
 function parse(buffer){const {tables,paragraphs}=read(buffer);const dates=[...new Set(paragraphs.flatMap(s=>[...s.matchAll(/\b(20\d{2})\.(\d{2})\.(\d{2})\b/g)].map(m=>m.slice(1).join('-'))))];
  return {date:dates.length===1?dates[0]:'',tables,...understand(tables)};}
 root.YebaeonBulletinParser={parse,read,understand,region,records,tablesFromRecords,reference,splitName,songQuery,fillBlanks,words,clean};
})(globalThis);
