(function(root){'use strict';
 const SERMON=/^(주일예배말씀|청년부\s*말씀|[123]부\s*말씀)(?!\s*목사님)/;
 const PRAYER=/^[123]\s*부\s*기도$/;
 const ENDING=/엔딩|마지막 화면/;
 const firstSunday=date=>!!date&&Number(date.slice(8,10))<=7;
 // 1부 has two playlists: the 품성 service on the first Sunday of a month, 클래식 otherwise.
 function playlistFor(service,date,names){
  const pick=test=>names.find(n=>test(n.replace(/\s/g,'')));
  if(service===1)return pick(n=>n.startsWith('2부'))||'';
  if(service===2)return pick(n=>n.includes('청년'))||pick(n=>n.startsWith('3부'))||'';
  return pick(n=>n.startsWith('1부')&&n.includes(firstSunday(date)?'품성':'클래식'))||pick(n=>n.startsWith('1부'))||'';
 }
 // 2부 is the main service; when sermons split, the group containing 2부 keeps 주일예배말씀.
 function sermonDoc(services){if(services.includes(1))return '주일예배말씀';if(services.length===1)return services[0]===2?'청년부 말씀':'1부 말씀';return '주일예배말씀';}
 function sermonIndex(names,from=0){const main=names.findIndex((n,i)=>i>from&&SERMON.test(n.trim()));if(main<0)return {main:-1,last:-1};return {main,last:/목사님\s*ppt/i.test(names[main+1]||'')?main+1:main};}
 // Returns the new item list for one service. Song slots change only when the user chose a document.
 function songPlan(names,service,{songs=[],after=null,offering=null,sermon=null}){
  const rows=names.map((name,index)=>({name,index,action:'keep'})),warnings=[];
  const creed=names.findIndex(n=>/사도신경/.test(n)),prayer=names.findIndex((n,i)=>i>creed&&PRAYER.test(n.trim()));
  const ending=names.findIndex(n=>ENDING.test(n));
  const chosen=songs.filter(s=>s?.choice);
  if(creed<0||prayer<0){if(chosen.length)warnings.push('사도신경과 기도 사이를 찾지 못해 찬양 영역을 바꾸지 않습니다.');}
  else if(chosen.length){const old=rows.slice(creed+1,prayer).map(r=>({...r,action:'remove'}));rows.splice(creed+1,old.length,...old,...chosen.map(s=>({name:s.choice.name,document:s.choice,action:'insert'})));}
  const at=sermonIndex(rows.map(r=>r.action==='remove'?'':r.name),creed);
  if(sermon&&at.main>=0&&rows[at.main].name.trim()!==sermon.name)rows[at.main]={...rows[at.main],previous:rows[at.main].name,name:sermon.name,document:sermon,action:'replace',slot:'말씀'};
  const put=(offset,s,slot)=>{if(!s?.choice||s.choice.keep)return;if(at.last<0){warnings.push(slot+': 말씀 문서를 찾지 못해 바꾸지 않습니다.');return;}const i=at.last+offset,endAt=rows.findIndex(r=>ENDING.test(r.name));if(!rows[i]||(endAt>=0&&i>=endAt)){warnings.push(slot+': 자리가 엔딩 뒤라 바꾸지 않습니다.');return;}rows[i]={...rows[i],previous:rows[i].name,name:s.choice.name,document:s.choice,action:'replace',slot};};
  put(1,after,'설교 후 찬양');if(service<2)put(2,offering,'헌금 찬양');
  if(ending<0&&rows.some(r=>r.action!=='keep'))warnings.push('엔딩 문서를 찾지 못했습니다. 바뀌는 자리를 확인하세요.');
  return {rows:rows.filter(r=>r.action!=='remove'),removed:rows.filter(r=>r.action==='remove'),changed:rows.some(r=>r.action!=='keep'),warnings,currentAfter:at.last>=0?names[at.last+1]:'',currentOffering:at.last>=0&&service<2?names[at.last+2]:''};
 }
 root.YebaeonBulletinPlan={playlistFor,sermonDoc,songPlan,sermonIndex,PRAYER};
})(globalThis);
