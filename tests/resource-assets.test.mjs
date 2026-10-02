import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceName,splitTemplates} from '../scripts/build.mjs';

test('ZIP filename repair recovers Hangul without rewriting correct names',()=>{
  assert.equal(resourceName('ßäëßàÑßå╝ßäÇßàºßå╝'),'성경');
  assert.equal(resourceName('ßäÄßàíßå½ßäïßàúßå╝'),'찬양');
  for(const value of ['성경','Georgia','Café','A & B'])assert.equal(resourceName(value),value);
});
test('template index omits XML while selected assets preserve exact original bytes',()=>{
  const xml='<RVDisplaySlide UUID="x"><NSString>한글 &amp; 원본</NSString></RVDisplaySlide>';
  const original=[{id:'a',name:'ßäëßàÑßå╝ßäÇßàºßå╝',label:'본문',width:1920,height:1080,xml},{id:'b',name:'성경',label:'둘째',width:1920,height:1080,xml}];
  const assets=splitTemplates(Buffer.from(JSON.stringify(original))),index=JSON.parse(assets[0][1]);
  assert.equal(index.length,2);assert.equal(index[0].name,'성경');assert.equal(index[0].xml,undefined);
  assert.equal(index[0].file,index[1].file);assert.equal(assets.length,2);
  assert.equal(JSON.parse(assets.find(([name])=>name===index[0].file)[1]).xml,xml);
  assert.deepEqual({...index[0],name:original[0].name,file:undefined,xml},{...original[0],file:undefined});
});
