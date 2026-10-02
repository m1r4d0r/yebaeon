import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const listeners={};const c=vm.createContext({window:{PP6:{},devicePixelRatio:2,addEventListener(name,fn){listeners[name]=fn;}},PP6Fonts:{css:s=>`${s.size}px Test`}});
vm.runInContext(await readFile('web-editor/render.js','utf8'),c);const R=c.window.PP6Render;
let measures=0;const ctx={font:'',fontKerning:'auto',letterSpacing:'0px',measureText(s){measures++;return {width:Array.from(s).length*10+Math.max(0,Array.from(s).length-1)*parseFloat(this.letterSpacing),fontBoundingBoxAscent:80,fontBoundingBoxDescent:20};}};
const parsed={text:'ABC\nDEF',runs:[{text:'ABC\nDEF',style:{font:'Test',size:100,leading:-30,tracking:-5,align:'center'}}],emptyStyle:{font:'Test',size:100,leading:-30}};
test('Tracking, negative leading, trailing gap and overflow use one cached model-space layout',()=>{
 const a=R.layout(ctx,parsed,{w:100,h:200});assert.equal(a.lines[0].width,20);assert.equal(a.total,170);assert.equal(a.overflow,false);const before=measures;
 const b=R.layout(ctx,parsed,{w:100,h:160});assert.equal(b.total,170);assert.equal(b.overflow,true);assert.equal(measures,before,'changing preview/box height must reuse line shaping');assert.throws(()=>a.lines[0].width=999);
 listeners.pp6fontschange();R.layout(ctx,parsed,{w:100,h:200});assert.ok(measures>before,'a loaded font invalidates the old line measurements');
});
test('Canvas pixel size follows display pixels and document aspect without exceeding the source',()=>{
 const canvas={width:400,height:225,getBoundingClientRect:()=>({width:600})};assert.equal(R.fit(canvas,{width:1920,height:1080}),true);assert.equal(canvas.width,1200);assert.equal(canvas.height,675);assert.equal(R.fit(canvas,{width:1920,height:1080}),false);
 canvas.getBoundingClientRect=()=>({width:1800});R.fit(canvas,{width:1920,height:1080});assert.equal(canvas.width,1920);assert.equal(canvas.height,1080);
});
