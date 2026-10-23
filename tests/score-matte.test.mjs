import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSet,score} from '../web-editor/score-matte/synthetic.mjs';
import {buildPlate,matteFrame,singlePlate,MARK} from '../web-editor/score-matte/matte-core.mjs';
import {dilate,otsu,rank,components} from '../web-editor/score-matte/matte-ops.mjs';

const W=960,H=540;
const set=makeSet({width:W,height:H,count:6,smudge:2});
const plate=buildPlate(set.frames);

test('기본 연산: 최대 필터·연결 요소·오츠', ()=>{
 const m=new Uint8Array(25);m[12]=255;
 assert.deepEqual([...rank(m,5,5,1,true)].map(v=>v?1:0),[0,0,0,0,0,0,1,1,1,0,0,1,1,1,0,0,1,1,1,0,0,0,0,0,0]);
 const c=components(Uint8Array.from([1,0,0,0,1,0,0,0,1]),3,3);
 assert.equal(c.count,1,'대각선도 이어진다');
 const hist=new Float64Array(256);hist[20]=50;hist[200]=50;
 const r=otsu(hist);assert.ok(r.threshold>20&&r.threshold<=200);assert.ok(r.separation>.9);
});

test('배경판: 네비게이터·로고는 배경, 오선·음자리표·제목은 악보로 나눈다', ()=>{
 assert.equal(plate.report.frames,6);
 assert.ok(plate.report.backgroundParts>0&&plate.report.scoreParts>0);
 assert.ok(plate.zones.length>0,'하단 네비게이터 자리');
 const y=Math.round(300*W/1920),x=Math.round(900*W/1920);
 assert.equal(plate.scoreConst[y*W+x],1,'첫 오선은 고정 악보');
});

test('장마다: 찌꺼기 없이 악보만, 입체 음표 머리는 불투명', ()=>{
 for(const f of [0,1,3]){
  const r=matteFrame(set.frames[f],plate),s=score(r,set.truth[f],set.notes[f],set.nav[f]);
  assert.ok(s.residue<120,`${f}장 찌꺼기 ${s.residue}`);
  assert.ok(s.lostShare<.02,`${f}장 잃은 악보 ${s.lostShare}`);
  assert.ok(s.noteSolid>.95,`${f}장 음표 머리 ${s.noteSolid}`);
  assert.equal(s.navLeft,0,`${f}장 네비게이터`);
 }
});

test('정교하게 붓: 칠한 곳의 얼룩은 지우고 검은 악보는 남긴다', ()=>{
 const f=2,sm=set.smudge[f],before=score(matteFrame(set.frames[f],plate),set.truth[f],set.notes[f],set.nav[f],sm);
 assert.ok(before.areaLeft>.9,'붓 없이는 얼룩이 남는다');
 const brush=dilate(Uint8Array.from(sm,v=>v?1:0),W,H,3),marks=new Uint8Array(W*H);
 for(let i=0;i<marks.length;i++)if(brush[i])marks[i]=MARK.refine;
 const r=matteFrame(set.frames[f],plate,{},marks),after=score(r,set.truth[f],set.notes[f],set.nav[f],sm);
 assert.ok(after.areaLeft<.15,`얼룩 ${after.areaLeft}`);
 let ink=0,kept=0;for(let i=0;i<marks.length;i++)if(brush[i]&&set.truth[f][i]>=225){ink++;if(r.data[i*4+3]>=128)kept++;}
 assert.ok(kept/ink>.75,`붓 아래 악보 ${kept}/${ink}`);
});

test('지우기 붓: 오선에 붙은 덩어리는 칠한 칸만 지운다', ()=>{
 const f=2,sm=set.smudge[f],marks=new Uint8Array(W*H);
 for(let i=0;i<marks.length;i++)if(sm[i])marks[i]=MARK.erase;
 const s=score(matteFrame(set.frames[f],plate,{},marks),set.truth[f],set.notes[f],set.nav[f]);
 let under=0;for(let i=0;i<marks.length;i++)if(marks[i]&&set.truth[f][i]>=225)under++;
 assert.ok(s.lost<under+150,`오선 전체가 지워지면 안 됨: ${s.lost} / 붓 아래 ${under}`);
});

test('한 장 모드와 크기 검사', ()=>{
 const one=singlePlate(set.frames[0]);assert.equal(one.frames,1);assert.match(one.report.warnings[0],/한 장/);
 assert.throws(()=>buildPlate([set.frames[0],{width:10,height:10,data:new Uint8ClampedArray(400)}]),/크기가 같아야/);
});
