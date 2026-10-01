import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parsePlaylist,editPlaylist} from '../cloudflare/playlist-format.mjs';
const context=vm.createContext({window:{},TextEncoder});
for(const file of ['bible-format','editor-history'])vm.runInContext(await readFile(`web-editor/${file}.js`,'utf8'),context);
const B=context.window.YebaeonBible,H=context.window.YebaeonHistory;
const bible={books:Array.from({length:66},(_,i)=>({name:i===42?'요한복음':'책'+i,chapters:[{number:3,verses:Array.from({length:36},(_,i)=>({number:i+1,text:'본문 '+i}))},{number:4,verses:Array.from({length:54},(_,i)=>({number:i+1,text:'본문 '+i}))}]}))};
test('Bible ranges cross chapters, preserve reference, reject reverse and invalid ranges',()=>{
 const p=B.parse('요 3 16 4 2',bible);assert.equal(p.verses.length,23);assert.equal(p.reference,'요한복음 3:16-4:2');
 assert.equal(B.parse('요한복음 3:16-18',bible).verses.length,3);assert.equal(B.parse('요 3',bible).verses.length,36);
 for(const query of ['요 0 1','요 3 37','요 4 2 3 16','요 3 18 16','요 3 x 16'])assert.throws(()=>B.parse(query,bible));
});
test('Bible lines split evenly and preserve Korean and surrogate pairs',()=>{
 assert.deepEqual(Array.from(B.balanced(['1','2','3','4','5'],4)),['1\n2\n3','4\n5']);
 const lines=B.wrap('가나다라마😀바',3,s=>Array.from(s).length,false);assert.equal(lines.join(''),'가나다라마😀바');assert.ok(lines.every(s=>Array.from(s).length<=3));
});
test('Document history is independent, bounded to fifty and redo clears on new edit',()=>{
 for(let i=0;i<55;i++)H.push('a',{xml:'state'+i});assert.equal(H.state('a').undo,50);assert.equal(H.state('b').undo,0);
 assert.equal(H.step('a',{xml:'current'}).xml,'state54');assert.equal(H.state('a').redo,1);assert.equal(H.step('a',{xml:'changed'},true).xml,'current');
 H.step('a',{xml:'new'});H.push('a',{xml:'branch'});assert.equal(H.state('a').redo,0);
});
test('Removed playlist headers can be restored but extra injected structure is rejected',()=>{
 const p=parsePlaylist('<RVPlaylistDocument><RVPlaylistNode><RVPlaylistNode UUID="A"><array rvXMLIvarName="children"/></RVPlaylistNode></RVPlaylistNode></RVPlaylistDocument>');
 const header='<RVHeaderCue UUID="H" displayName="기도"/>';
 assert.equal(parsePlaylist(editPlaylist(p,'A',[{headerXML:header}],new Map(),'~/Documents/ProPresenter6')).playlists[0].items[0].name,'기도');
 for(const raw of [header+'<foo/>','<RVDocumentCue UUID="D"/>',header+'</array></RVPlaylistNode><RVPlaylistNode UUID="B"><array rvXMLIvarName="children">'])assert.throws(()=>editPlaylist(p,'A',[{headerXML:raw}],new Map(),'~/Documents/ProPresenter6'));
});
