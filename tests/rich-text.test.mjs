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

test('Korean font names remain Unicode in font-table rewrites',()=>{const parsed=P.parseRTF(P.textRTF('한글',{...style,font:'아리따부리'}));assert.equal(parsed.runs[0].style.font,'아리따부리');});

test('Uploaded exact Bold faces win; missing Bold keeps the uploaded design with an explicit approximation',async()=>{
 const c=vm.createContext({window:{dispatchEvent(){}},document:{fonts:{add(){}}},FontFace:class{},Event:class{}});vm.runInContext(await readFile('web-editor/fonts.js','utf8'),c);const F=c.window.PP6Fonts;
 const catalog=[{name:'SeoulHangangB',file:'bold.woff2',weight:400},{name:'NanumMyeongjoOTFExtraBold',file:'extra.woff2',weight:700},{name:'Arita-buri-Medium_OTF',file:'medium.woff2',weight:500},{name:'NanumGothicOTF',file:'regular.otf',weight:400},{name:'NanumGothicOTFBold',file:'bold.otf',weight:600}];
 F.registerCatalog(catalog);assert.equal(F.resolve({font:'SeoulHangangB',bold:true}).weight,400);assert.equal(F.resolve({font:'NanumMyeongjoOTFExtraBold',bold:true}).weight,700);assert.equal(F.resolve({font:'NanumGothicOTF',bold:true}).family,'YebaeFont-bold-otf');assert.equal(F.resolve({font:'NanumGothicOTF',bold:true}).weight,600);
 const missing=F.resolve({font:'Arita-buri-Medium_OTF',bold:true});assert.equal(missing.family,'YebaeFont-medium-woff2');assert.match(missing.note,/원본 Bold 파일 없음/);assert.equal(F.resolve({font:'Arita-buri-SemiBold_OTF',bold:true}),null);
 F.registerCatalog([...catalog,{name:'Arita-buri-Bold_OTF',file:'arita-bold.otf',weight:700}]);const exact=F.resolve({font:'Arita-buri-Medium_OTF',bold:true});assert.equal(exact.family,'YebaeFont-arita-bold-otf');assert.equal(exact.note,'');
});
test('PP6 Cocoa tracking, negative leading and text stroke survive edits, split and partial formatting',()=>{
 const raw='{\\rtf1\\ansi{\\fonttbl{\\f0\\fnil NanumGothicOTF;}}{\\colortbl;\\red255\\green255\\blue255;}\\pard\\pardeftab720\\slleading-600\\qc\\partightenfactor0\\f0\\b\\fs198\\cf1\\expnd-20\\expndtw-100\\kerning1\\strokewidth-100\\strokec0 A\\line B}';
 const node={textContent:btoa(raw)},e={querySelector:()=>node};const before=P.parseRTF(node.textContent);assert.equal(before.text,'A\nB');const original=before.runs[0].style;assert.equal(original.tracking,-5);assert.equal(original.leading,-30);assert.equal(original.strokeWidth,-5);assert.equal(original.strokeColor,'rgb(0,0,0)');assert.equal(original.kerning,1);
 P.setText(e,'A changed\nB');assert.equal(JSON.stringify(P.parseRTF(node.textContent).runs[0].style),JSON.stringify(original),'text-only edits preserve the visual format fingerprint');P.formatRange(e,0,1,{color:'#ff0000'});const after=P.parseRTF(node.textContent);for(const run of after.runs){assert.equal(run.style.tracking,-5);assert.equal(run.style.leading,-30);assert.equal(run.style.strokeWidth,-5);assert.equal(run.style.strokeColor,'rgb(0,0,0)');assert.equal(run.style.kerning,1);assert.match(run.style.paragraphControls,/pardeftab720/);}
 const split=P.parseRTF(P.runsRTF(P.sliceRuns(after.runs,2,after.text.length),after.emptyStyle));assert.equal(split.runs[0].style.strokeWidth,-5);assert.equal(split.runs[0].style.tracking,-5);
});
