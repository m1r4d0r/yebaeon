(function(root){'use strict';
 const MAX=16*1024*1024;
 const clean=s=>String(s||'').normalize('NFC').replace(/[ \t]+/g,' ').trim();
 function text(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let s='';for(let i=0;i+1<bytes.length;){const c=v.getUint16(i,true);if([1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23].includes(c)){if(c===9)s+=' ';i+=16;}else{if(c>=32)s+=String.fromCharCode(c);else if(c===10||c===13)s+='\n';i+=2;}}return clean(s);}
 function records(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];let p=0;while(p<bytes.length){if(p+4>bytes.length)throw Error('HWP 레코드가 잘렸습니다.');const h=v.getUint32(p,true);p+=4;let size=h>>>20;if(size===4095){if(p+4>bytes.length)throw Error('HWP 크기 정보 오류');size=v.getUint32(p,true);p+=4;}if(p+size>bytes.length||out.length>100000)throw Error('HWP 레코드 범위 오류');out.push({tag:h&1023,level:(h>>>10)&1023,data:bytes.subarray(p,p+size)});p+=size;}return out;}
 function tablesFromRecords(seq){const tables=[],stack=[],paragraphs=[];for(const r of seq){while(stack.length&&r.level<=stack.at(-1).level)stack.pop();   const id=r.tag===71?String.fromCharCode(...r.data.subarray(0,4)):'';
   if(id===' lbt') {const table={level:r.level,cells:[]};tables.push(table);stack.push(table);continue;}
   const table=stack.at(-1);
   if(table&&r.tag===72&&r.level===table.level+1&&r.data.length>=34){const v=new DataView(r.data.buffer,r.data.byteOffset,r.data.byteLength);table.cell={col:v.getUint16(8,true),row:v.getUint16(10,true),cols:v.getUint16(12,true),rows:v.getUint16(14,true),lines:[]};table.cells.push(table.cell);}
   if(r.tag===67){const s=text(r.data);if(s){paragraphs.push(s);if(table?.cell&&r.level===table.level+2)table.cell.lines.push(...s.split('\n').map(clean).filter(Boolean));}}
 }return {tables,paragraphs};}
 function parseTables(tables,paragraphs=[]){
  const matches=tables.filter(t=>[1,2,3].every(n=>t.cells.some(c=>c.lines.some(s=>s.replace(/\s/g,'').startsWith(n+'부예배')))));
  if(matches.length!==1)throw Error('1·2·3부 예배 표를 하나로 식별하지 못했습니다. 주보 양식을 확인해 주세요.');
  const t=matches[0],heads=[1,2,3].map(n=>t.cells.find(c=>c.lines.some(s=>s.replace(/\s/g,'').startsWith(n+'부예배'))));
  const prayer=t.cells.find(c=>c.lines.some(s=>/대표기도/.test(s))),blessing=t.cells.find(c=>c.lines.some(s=>/축복의 선포/.test(s)));
  if(!prayer||!blessing)throw Error('대표기도·축복의 선포 경계를 찾지 못했습니다.');
  const worship=t.cells.filter(c=>c.row>heads[0].row&&c.row<=blessing.row);
  const sermon=worship.find(c=>c.row>prayer.row&&c.lines.some(s=>/^[가-힣]+\s*\d+\s*:\s*\d/.test(s)));
  if(!sermon)throw Error('설교 본문을 찾지 못했습니다.');
  const reference=clean(sermon.lines[0].replace(/\([^)]*\)/g,''));
  const preacher=sermon.lines.find(s=>/(목사|강도사|전도사)\s*$/.test(s))||'';
  const title=sermon.lines.slice(1).filter(s=>s!==preacher).join('\n');
  const names=prayer.lines.slice(1).join(' ').split('/').map(clean);
  const warnings=[];if(names.length!==3)warnings.push('대표기도자 세 명을 구분하지 못했습니다. 직접 확인하세요.');
  const services=heads.map((h,i)=>{const items=[];for(const c of worship.filter(c=>c.col<=h.col&&c.col+c.cols>h.col).sort((a,b)=>a.row-b.row)){
    if(c===sermon){items.push({kind:'scripture',label:'말씀 본문',value:reference},{kind:'sermon',label:'설교 제목',value:title},{kind:'preacher',label:'설교자',value:preacher});continue;}
    if(c===prayer){items.push({kind:'prayer',label:'대표기도',value:names.length===3?names[i]:''});continue;}
    for(const line of c.lines){if(/드림의 찬양\(/.test(line))continue;
     const fixed=/^(예배의 부름|신앙고백|성도의 교제|축복의 선포)/.test(line);
     items.push({kind:fixed?'fixed':/^(부름의 찬양|찬양)$/.test(line)?'unknown':'song',label:fixed?line:'찬양',value:line});
    }
  }return {name:(i+1)+'부',items};});
  const dates=[...new Set(paragraphs.flatMap(s=>[...s.matchAll(/\b(20\d{2})\.(\d{2})\.(\d{2})\b/g)].map(m=>m.slice(1).join('-'))))];
  if(dates.length!==1)warnings.push('주보 날짜를 하나로 확인하지 못했습니다.');
  return {date:dates.length===1?dates[0]:'',services,warnings,reference,title,preacher};
 }
 function parse(buffer){const bytes=new Uint8Array(buffer);if(bytes.length>MAX)throw Error('주보는 16MB 이내 HWP 파일을 선택하세요.');const {CFB,Inflate}=root.YebaeonHWPBinary;const file=CFB.read(bytes,{type:'array'});
  const stream=name=>{const item=CFB.find(file,name);if(!item?.content)throw Error('HWP '+name+' 정보가 없습니다.');return new Uint8Array(item.content);};
  const header=stream('FileHeader');if(new TextDecoder().decode(header.subarray(0,17))!=='HWP Document File'||header.length<40)throw Error('HWP 5 문서가 아닙니다.');const flags=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(36,true);if(flags&6)throw Error('암호화·배포용 주보는 지원하지 않습니다. 일반 HWP로 저장해 주세요.');
  let total=0;const tables=[],paragraphs=[];const paths=file.FullPaths.filter(p=>/\/BodyText\/Section\d+$/.test(p)).sort((a,b)=>Number(a.match(/\d+$/)[0])-Number(b.match(/\d+$/)[0]));
  for(const path of paths){let data=stream(path);if(flags&1){const chunks=[];let size=0;const dec=new Inflate(chunk=>{size+=chunk.length;if(size+total>MAX)throw Error('주보 본문이 너무 큽니다.');chunks.push(chunk);});dec.push(data,true);data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}}
   total+=data.length;if(total>MAX)throw Error('주보 본문이 너무 큽니다.');const parsed=tablesFromRecords(records(data));tables.push(...parsed.tables);paragraphs.push(...parsed.paragraphs);
  }return parseTables(tables,paragraphs);
 }
 root.YebaeonBulletinParser={parse,parseTables,records,tablesFromRecords,clean};
})(globalThis);
