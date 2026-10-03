import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// ppt-codec 2.2.23 reverses OfficeArtFOPTEOPID bits 14/15. Keep this
// version-checked build patch explicit, rather than modifying node_modules.
// [MS-ODRAW] 2.2.8: fBid=0x4000, fComplex=0x8000.
export const pptCodecFix={name:'ppt-codec-officeart',setup(b){
 b.onLoad({filter:/ppt-codec[\\/]dist[\\/]drawing[\\/](properties|blips)\.js$/},async({path})=>{
  let s=await readFile(path,'utf8');
  const pairs=path.endsWith('properties.js')?[
   ['const OPID_FCOMPLEX = 16384;','const OPID_FCOMPLEX = 32768;'],
   ['const OPID_FBID = 32768;','const OPID_FBID = 16384;']
  ]:[['if (blip !== void 0) blips.push(blip);','blips.push(blip);']];
  // Missing/unsupported blips must retain their 1-based store slot.
  for(const [from,to] of pairs){if(!s.includes(from))throw Error('Review ppt-codec compatibility patch: '+path);s=s.replace(from,to);}
  return {contents:s,loader:'js'};
 });
}};
let pending;
export function buildPPT(){return pending??=(async()=>{
 const result=await build({absWorkingDir:root,entryPoints:['web-editor/ppt-engine-entry.mjs'],bundle:true,minify:true,format:'iife',globalName:'YebaeonPPTEngine',platform:'browser',target:'chrome100',write:false,plugins:[pptCodecFix],define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
 const names=['ppt-codec','archive-codec','byte-codec','document-schema.js','cfb','@aiden0z/pptx-renderer','html-to-image','jszip','echarts','zrender','fast-xml-parser','strnum','tslib','mtx-decompressor','pako','lie','immediate','readable-stream','safe-buffer','setimmediate','core-util-is','inherits','isarray','process-nextick-args','string_decoder','util-deprecate','codepage','crc-32','adler-32','zod','ssf','wmf','frac'];
 let notices='Bundled browser PPT import components. See the pinned package-lock.json.\nUnmodified MPL-2.0 mtx-decompressor source: https://github.com/ChristopherVR/mtx-decompressor (npm 1.8.0).\n';
 for(const name of names){for(const file of ['LICENSE','LICENSE.txt','LICENSE.md','LICENSE.markdown','license','THIRD_PARTY_NOTICES.md']){try{notices+='\n===== '+name+' / '+file+' =====\n'+await readFile(root+'node_modules/'+name+'/'+file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}}}
 return [['ppt-engine.js',result.outputFiles[0].contents],['ppt-LICENSES.txt',Buffer.from(notices)]];
})();}
