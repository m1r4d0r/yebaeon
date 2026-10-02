import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const ctx=vm.createContext({window:{},atob,btoa,TextDecoder,Uint8Array});
vm.runInContext(await readFile('web-editor/pp6.js','utf8'),ctx);const P=ctx.window.PP6;
const style={font:'Arial',size:90,bold:false,italic:false,underline:false,color:'#ffffff',align:'center',leading:10};
const runs=[{text:'앞 한글 ',style},{text:'강조😀',style:{...style,font:'Georgia',bold:true,size:60,color:'#ff0000'}},{text:' 뒤\n다음',style}];
function element(){const node={textContent:P.runsRTF(runs)};return {node,querySelector:()=>node};}
test('Mixed-font Korean RTF round trips with color, size, paragraph and emoji',()=>{const parsed=P.parseRTF(P.runsRTF(runs));assert.equal(parsed.text,runs.map(r=>r.text).join(''));assert.equal(parsed.runs[1].style.font,'Georgia');assert.equal(parsed.runs[1].style.bold,true);assert.equal(parsed.runs[1].style.size,60);assert.equal(parsed.runs[1].style.color,'rgb(255,0,0)');assert.equal(parsed.runs[1].style.leading,10);assert.equal(P.parseRTF(P.textRTF('',style)).emptyStyle.size,90);});
test('Content edit retains formatting before and after insertion and deletion',()=>{const e=element(),before=P.parseRTF(e.node.textContent).text;P.setText(e,before.replace('강조','강한 강조'));let parsed=P.parseRTF(e.node.textContent);assert.equal(parsed.text,before.replace('강조','강한 강조'));assert.ok(parsed.runs.find(r=>r.text.includes('강한 강조')).style.bold);P.setText(e,parsed.text.replace('한글 ',''));parsed=P.parseRTF(e.node.textContent);assert.ok(parsed.runs.find(r=>r.text.includes('강한 강조')).style.bold);assert.equal(parsed.runs.at(-1).style.bold,false);});
test('Selection format touches only selected characters and serialized reopening retains it',()=>{const e=element(),before=P.parseRTF(e.node.textContent).text;P.formatRange(e,0,1,{size:120,color:'#00ff00'});const parsed=P.parseRTF(e.node.textContent);assert.equal(parsed.text,before);assert.equal(parsed.runs[0].text,'앞');assert.equal(parsed.runs[0].style.size,120);assert.equal(parsed.runs[0].style.color,'rgb(0,255,0)');assert.equal(parsed.runs[1].style.size,90);assert.equal(parsed.runs.find(r=>r.text==='강조😀').style.bold,true);});
test('Split run slices keep exact font styles on both sides without flattening',()=>{const a=P.sliceRuns(runs,0,7),b=P.sliceRuns(runs,7,100);assert.equal(P.parseRTF(P.runsRTF([...a,...b])).text,runs.map(r=>r.text).join(''));assert.equal(P.parseRTF(P.runsRTF(b)).runs[0].style.font,'Georgia');});
