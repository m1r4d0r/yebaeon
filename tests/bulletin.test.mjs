import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import * as CFB from 'cfb';
const context=vm.createContext({TextDecoder,TextEncoder,console,Uint8Array,DataView});
for(const f of ['hwp-binary','bulletin-parser','bulletin-plan','bible-format'])vm.runInContext(await readFile(`web-editor/${f}.js`,'utf8'),context);
const P=context.YebaeonBulletinParser,PL=context.YebaeonBulletinPlan,B=context.YebaeonBible;
const plain=v=>JSON.parse(JSON.stringify(v));
// Synthetic Sunday bulletin: sermon note, summary box, order table with a separate 청년예배 sermon cell and a weekday cell.
export function syntheticHWP({changed=false}={}){
 const rec=(tag,level,data)=>{const h=Buffer.alloc(4);h.writeUInt32LE(tag+(level<<10)+(data.length<<20));return Buffer.concat([h,data]);};
 const entries=[];
 const table=cells=>{entries.push(rec(71,1,Buffer.from(' lbt')));for(const [col,row,cols,rows,lines] of cells){const d=Buffer.alloc(47);d.writeUInt16LE(col,8);d.writeUInt16LE(row,10);d.writeUInt16LE(cols,12);d.writeUInt16LE(rows,14);entries.push(rec(72,2,d));for(const line of lines)entries.push(rec(67,3,Buffer.from(line+'\r','utf16le')));}};
 table([[0,0,1,1,['■ 합성 시리즈3, 합성 설교 제목!','■ 창세기 1:1-3',changed?'질문 합성 믿음의 원리는?':'What? 합성 믿음의 원리는?','1. 믿음은 _______이 아닙니다. 믿기 위해 _______하십시오.','창1:1 태초에 합성 인용','2. 믿음은 ________입니다.','요13:36,37 합성 인용 둘','=> 결단 문장은 쓰지 않음']]]);
 table([[0,0,1,1,['합성 나눔 제목',(changed?'하나, ':'첫째, ')+'믿음은 의심이 아니다. 믿기 위해 기도해야 한다.',(changed?'둘, ':'둘째, ')+'믿음은 순종이다. 끝.']]]);
 table([[0,0,1,1,[changed?'1부':'1부예배']],[1,0,1,1,[changed?'2부':'2부예배']],[2,0,1,1,[changed?'3부':'3부예배']],
  [0,1,1,1,['예배의 부름(시편 1:1)','부름의 찬양']],[1,1,2,1,['신앙고백(사도신경)']],[0,2,1,1,['신앙고백(사도신경)']],[1,2,1,2,['합성 찬양 A','합성 찬양 B']],[2,2,1,2,['합성 찬양 C']],[0,3,1,1,['찬송가 100']],
  [0,4,3,1,['합심기도 후 대표기도','가나다집사 / 라마바시무집사 / 사아자형제']],[0,5,3,1,['성도의 교제 & 합성 소식']],
  [0,6,2,1,['창세기 1:1-3(구약.p.1)','합성 설교 제목!','시 험 목사']],[2,6,1,1,['요 3:16','청년 합성 설교','차카타 강도사']],
  [0,7,2,1,['합성 찬양 D(영광 1)']],[2,7,1,1,['합성 찬양 E']],[0,8,3,1,['드림의 찬양(헌금함에 직접 넣어주시고, 찬양으로 봉헌합니다)','합성 찬양 F(영광 2)']],[0,9,3,1,['축복의 선포']],
  [1,10,2,1,['파하가전도사','합성 기도2, 금요 합성 제목(눅22:31,32)','새벽 합성 줄']]]);
 entries.push(rec(67,0,Buffer.from('2026.10.04','utf16le')));
 const file=CFB.utils.cfb_new();const header=Buffer.alloc(256);header.write('HWP Document File');header.writeUInt32LE(1,36);CFB.utils.cfb_add(file,'FileHeader',header);CFB.utils.cfb_add(file,'BodyText/Section0',deflateRawSync(Buffer.concat(entries)));return Buffer.from(CFB.write(file,{type:'buffer'}));
}
test('bulletin understanding fills songs, prayers, sermons and weekday lines without OCR',()=>{
 const p=P.parse(syntheticHWP());assert.equal(p.date,'2026-10-04');
 assert.deepEqual(plain(p.services.map(s=>s.songs.map(x=>x.value))),[['찬송가 100'],['합성 찬양 A','합성 찬양 B'],['합성 찬양 C']],'부름의 찬양 above 신앙고백 is reused, not extracted');
 assert.deepEqual(plain(p.services.map(s=>s.prayer.value)),['가나다집사','라마바시무집사','사아자형제']);
 assert.deepEqual(plain(p.services.map(s=>[s.after?.value,s.offering?.value])),[['합성 찬양 D(영광 1)','합성 찬양 F(영광 2)'],['합성 찬양 D(영광 1)','합성 찬양 F(영광 2)'],['합성 찬양 E','합성 찬양 F(영광 2)']]);
 assert.deepEqual(plain(p.sermonGroups.map(g=>[g.services,g.title.value,g.ref.value,g.preacher])),[[[0,1],'합성 설교 제목!','창세기 1:1-3','시 험 목사'],[[2],'청년 합성 설교','요 3:16','차카타 강도사']]);
 assert.equal(p.sermon.series.value,'합성 시리즈3');assert.equal(p.sermon.title.value,'합성 설교 제목!');assert.equal(p.sermon.ref.value,'창세기 1:1-3');
 const g=p.sermon.groups[0];assert.equal(g.what.value,'What? 합성 믿음의 원리는?');
 assert.deepEqual(plain(g.points.map(x=>x.blanks.map(b=>b.value))),[['의심','기도'],['순종']]);
 assert.deepEqual(plain(g.points.map(x=>x.quotes.map(q=>q.value))),[['창1:1'],['요13:36,37']]);
 assert.equal(g.points[0].blanks[0].src[0].key,p.summary,'blank hints point into the summary box');
 assert.deepEqual(plain(p.weekday.map(w=>[w.day,w.minister,w.series.value,w.title.value,w.ref.value])),[['수요예배','파하가전도사','','',''],['금요예배','','합성 기도2','금요 합성 제목','눅22:31,32']]);
});
test('missing order table leaves suggestions empty instead of failing',()=>{
 const u=P.understand([]);assert.equal(u.services.length,0);assert.equal(u.sermonGroups.length,0);assert.equal(u.weekday.length,0);
 assert.throws(()=>P.records(new Uint8Array([1])),/잘렸/);assert.throws(()=>P.parse(new Uint8Array(17*1024*1024)),/16MB/);
});
test('names, series and references follow bulletin conventions',()=>{
 assert.deepEqual(plain(P.splitName('라마바시무집사')),{name:'라마바',title:'시무집사'});assert.deepEqual(plain(P.splitName('차카타 강도사')),{name:'차카타',title:'강도사'});assert.equal(P.splitName('이름만'),null);
 assert.deepEqual(plain(P.reference('요13:36,37').labels),['요한복음 13:36-37']);assert.equal(P.reference('눅22:31,32').count,2);assert.deepEqual(plain(P.reference('막14:31,38-40').labels),['마가복음 14:31','마가복음 14:38-40']);assert.match(P.reference('없는책 1:1').error,/책 이름/);
 assert.equal(P.songQuery('찬송가 288'),'288');assert.equal(P.songQuery('나의 가는 길(영광 165)'),'나의 가는 길');
 const w=P.understand([{idx:0,cells:[{col:0,row:0,cols:1,rows:1,lines:['1부예배']},{col:1,row:0,cols:1,rows:1,lines:['2부예배']},{col:2,row:0,cols:1,rows:1,lines:['3부예배']},{col:0,row:1,cols:3,rows:1,lines:['축복의 선포']},{col:0,row:2,cols:3,rows:1,lines:['하늘빛선교사','청소년부 수련회']}]}]).weekday;
 assert.equal(w[0].minister,'하늘빛선교사');assert.equal(w[1].event,'청소년부 수련회');
 const f=P.understand([{idx:0,cells:[{col:0,row:0,cols:1,rows:1,lines:['1부예배']},{col:1,row:0,cols:1,rows:1,lines:['2부예배']},{col:2,row:0,cols:1,rows:1,lines:['3부예배']},{col:0,row:1,cols:3,rows:1,lines:['축복의 선포']},{col:0,row:2,cols:3,rows:1,lines:['담임목사','빛난 길, 고요한 밤(사무엘상 9:1-27)']}]}]).weekday[1];
 assert.equal(f.series.value,'');assert.equal(f.title.value,'빛난 길, 고요한 밤','a comma is a series break only after a number');
});
test('Bible accepts comma verses within a chapter and names the missing verse',()=>{
 const books=Array.from({length:66},(_,i)=>({name:i===42?'요한복음':'책'+i,chapters:[{number:13,verses:Array.from({length:38},(_,k)=>({number:k+1,text:'절'+(k+1)}))}]}));const bible={books};
 assert.deepEqual(plain(B.parse('요13:36,37',bible).verses.map(v=>v.start.verse)),[36,37]);assert.deepEqual(plain(B.parse('요 13:1,5-6',bible).verses.map(v=>v.start.verse)),[1,5,6]);
 assert.throws(()=>B.parse('요13:36,39',bible),/요한복음 13:39/);assert.throws(()=>B.parse('요13:39',bible),/요한복음 13:39/);
});
const youth=['첫화면','사도신경(구)','나의 곡','말씀 앞에서','3부 기도','주일예배말씀','주일예배말씀 목사님 ppt','말씀 앞에서 경외함으로','광고','나의 모습 나의 소유','2026엔딩','마무리'];
test('playlist plan changes only chosen song slots and respects the ending',()=>{
 const none=PL.songPlan(youth,2,{songs:[{choice:null}],after:{choice:null}});assert.equal(none.changed,false,'nothing chosen keeps the order');
 const r=PL.songPlan(youth,2,{songs:[{choice:{id:'n1',name:'새 곡'}},{choice:null}],after:{choice:{id:'n2',name:'새 설교 후'}},offering:{choice:{id:'n3',name:'헌금'}}});
 assert.deepEqual(plain(r.rows.map(x=>x.name)),['첫화면','사도신경(구)','새 곡','3부 기도','주일예배말씀','주일예배말씀 목사님 ppt','새 설교 후','광고','나의 모습 나의 소유','2026엔딩','마무리'],'청년예배 offering stays fixed; a song named 말씀 is not the sermon');
 assert.deepEqual(plain(r.removed.map(x=>x.name)),['나의 곡','말씀 앞에서']);
 const noPpt=['첫화면','사도신경','292 곡','1부기도','광고','주일예배말씀','나는 믿네','세상 흔들리고','하나님께로 더 가까이','마지막 화면(1부 예배)'];
 const c=PL.songPlan(noPpt,0,{after:{choice:{id:'a',name:'A'}},offering:{choice:{id:'b',name:'B'}}});assert.deepEqual(plain(c.rows.slice(6).map(x=>x.name)),['A','B','하나님께로 더 가까이','마지막 화면(1부 예배)'],'songs after the offering remain');
 const tight=PL.songPlan(['사도신경','1부기도','주일예배말씀','설교 후','엔딩'],0,{offering:{choice:{id:'b',name:'B'}}});assert.equal(tight.changed,false);assert.match(tight.warnings[0],/엔딩/);
 const keep=PL.songPlan(noPpt,0,{after:{choice:{id:'x',name:'나는 믿네',keep:true}}});assert.equal(keep.changed,false);
 const swap=PL.songPlan(youth,2,{sermon:{id:'y',name:'청년부 말씀'}});assert.equal(swap.rows[5].name,'청년부 말씀');assert.equal(swap.rows[6].name,'주일예배말씀 목사님 ppt');
 const back=PL.songPlan(['사도신경','3부 기도','청년부 말씀','x','엔딩'],2,{sermon:{id:'m',name:'주일예배말씀'}});assert.equal(back.rows[2].name,'주일예배말씀','a shared sermon returns to 주일예배말씀');
 assert.equal(PL.songPlan(youth,2,{sermon:{id:'m',name:'주일예배말씀'}}).changed,false);
});
test('target playlists and sermon documents follow the service rules',()=>{
 const names=['1부 예배(품성)','1부 예배(클래식)','2부 예배','청년예배','수요예배'];
 assert.equal(PL.playlistFor(0,'2026-10-04',names),'1부 예배(품성)');assert.equal(PL.playlistFor(0,'2026-10-11',names),'1부 예배(클래식)');assert.equal(PL.playlistFor(1,'2026-10-11',names),'2부 예배');assert.equal(PL.playlistFor(2,'',names),'청년예배');
 assert.equal(PL.sermonDoc([0,1,2]),'주일예배말씀');assert.equal(PL.sermonDoc([1]),'주일예배말씀');assert.equal(PL.sermonDoc([0]),'1부 말씀');assert.equal(PL.sermonDoc([2]),'청년부 말씀');
});
test('a designated region re-derives suggestions when the format changed',()=>{
 const p=P.parse(syntheticHWP({changed:true}));assert.equal(p.services.length,0);assert.equal(p.sermon.groups.length,0);assert.equal(p.summary,null);
 const key=(t,row,col)=>`${t}:${row}:${col}`;
 assert.deepEqual(plain(P.region(p.tables,key(2,2,1),'songs').map(x=>x.value)),['합성 찬양 A','합성 찬양 B']);
 const note=P.region(p.tables,key(0,0,0),'note',key(1,0,0));assert.equal(note.title.value,'합성 설교 제목!');assert.equal(note.groups[0].what.value,'질문 합성 믿음의 원리는?');
 assert.deepEqual(plain(note.groups[0].points.map(x=>x.blanks.map(b=>b.value))),[['의심','기도'],['순종']],'blanks follow anchors without ordinal words');
 assert.deepEqual(plain(P.region(p.tables,key(1,0,0),'summary',['믿음은 _______이 아닙니다.']).map(r=>r.map(x=>x.value))),[['의심']]);
 const w=P.region(p.tables,key(2,10,1),'weekday');assert.equal(w[0].minister,'파하가전도사');assert.equal(w[1].title.value,'금요 합성 제목');
 assert.deepEqual(plain(P.region(p.tables,key(2,9,0),'songs')),[],'fixed lines are not songs');
});
