import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import * as CFB from 'cfb';
const context=vm.createContext({TextDecoder,TextEncoder,console,Uint8Array,DataView});
for(const f of ['hwp-binary','bulletin-parser'])vm.runInContext(await readFile(`web-editor/${f}.js`,'utf8'),context);
const P=context.YebaeonBulletinParser;
export function syntheticHWP(){
 const rec=(tag,level,data)=>{const h=Buffer.alloc(4);h.writeUInt32LE(tag+(level<<10)+(data.length<<20));return Buffer.concat([h,data]);};
 const entries=[rec(71,1,Buffer.from(' lbt'))];
 const cell=(col,row,cols,rows,lines)=>{const d=Buffer.alloc(47);d.writeUInt16LE(col,8);d.writeUInt16LE(row,10);d.writeUInt16LE(cols,12);d.writeUInt16LE(rows,14);entries.push(rec(72,2,d));for(const line of lines)entries.push(rec(67,3,Buffer.from(line+'\r','utf16le')));};
 for(let i=0;i<3;i++)cell(i,0,1,1,[(i+1)+'부예배']);
 cell(0,1,3,1,['신앙고백(사도신경)']);cell(0,2,1,1,['부름의 찬양']);cell(0,3,1,1,['찬송가 100']);cell(1,2,1,2,['합성 찬양 A','합성 찬양 B']);cell(2,2,1,2,['합성 찬양 C']);
 cell(0,4,3,1,['합심기도 후 대표기도','가집사 / 나권사 / 다형제']);cell(0,5,3,1,['창세기 1:1-2(구약.p.1)','합성 설교','시험 목사']);cell(0,6,3,1,['합성 찬양 D']);cell(0,7,3,1,['축복의 선포']);
 entries.push(rec(67,0,Buffer.from('2026.10.04','utf16le')));
 const file=CFB.utils.cfb_new();const header=Buffer.alloc(256);header.write('HWP Document File');header.writeUInt32LE(1,36);CFB.utils.cfb_add(file,'FileHeader',header);CFB.utils.cfb_add(file,'BodyText/Section0',deflateRawSync(Buffer.concat(entries)));return Buffer.from(CFB.write(file,{type:'buffer'}));
}
test('HWP binary and merged cells separate worship services without OCR',()=>{const p=P.parse(syntheticHWP());assert.equal(p.date,'2026-10-04');assert.equal(p.reference,'창세기 1:1-2');assert.equal(p.services[0].items.find(x=>x.kind==='prayer').value,'가집사');assert.equal(p.services[1].items.filter(x=>x.kind==='song').length,3);assert.ok(p.services[0].items.some(x=>x.kind==='unknown'));assert.ok(!p.services[0].items.some(x=>x.value==='합성 찬양 A'));assert.equal(p.services[2].items.find(x=>x.kind==='prayer').value,'다형제');});
test('unrecognized or ambiguous table does not guess',()=>{assert.throws(()=>P.parseTables([],[]),/식별/);assert.throws(()=>P.records(new Uint8Array([1])),/잘렸/);assert.throws(()=>P.parse(new Uint8Array(17*1024*1024)),/16MB/);});
