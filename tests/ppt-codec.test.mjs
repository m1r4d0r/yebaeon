import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pptCodecFix} from '../scripts/build-ppt.mjs';
import {runInNewContext} from 'node:vm';

test('legacy PPT property bits distinguish image id from complex image name',async()=>{
 const result=await build({stdin:{contents:"export {readShapeProperties} from 'ppt-codec/drawing/properties';export {readRecordAt} from 'ppt-codec/record/tree';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'T',platform:'browser',plugins:[pptCodecFix]});
 const context={Uint8Array,DataView,TextDecoder,TextEncoder};runInNewContext(result.outputFiles[0].text,context);
 // Independent MS-ODRAW bytes, not the library's writer: SpContainer → FOPT.
 const b=new Uint8Array(32),v=new DataView(b.buffer);v.setUint16(0,15,true);v.setUint16(2,0xf004,true);v.setUint32(4,24,true);
 v.setUint16(8,(2<<4)|3,true);v.setUint16(10,0xf00b,true);v.setUint32(12,16,true);
 v.setUint16(16,0x4104,true);v.setUint32(18,7,true); // fBid=bit14, pib=260
 v.setUint16(22,0xc380,true);v.setUint32(24,4,true); // fComplex=bit15
 b[28]=65;const p=context.T.readShapeProperties(context.T.readRecordAt(b,0));
 assert.equal(p.get(260).value,7);assert.equal(p.get(260).complex,undefined);assert.deepEqual([...p.get(896).complex],[65,0,0,0]);
});
