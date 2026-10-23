// 악보 배경 걷기 실험실. 사이트에는 score-lab.html·score-lab.js·score-matte-worker.js로 둔다(Studio와 따로).
// `node scripts/build-score-lab.mjs <출력.html>`은 PPT 변환기와 작업자까지 한 파일에 넣은 실험실을 만든다.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildPPT} from './build-ppt.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const common={absWorkingDir:root,bundle:true,minify:true,format:'iife',platform:'browser',target:'chrome100',write:false,legalComments:'inline',logLevel:'error'};
let pending;
export function buildScoreLab(){return pending??=(async()=>{
 const [lab,worker]=await Promise.all([build({...common,entryPoints:['web-editor/score-lab.mjs']}),build({...common,entryPoints:['web-editor/score-matte/matte-worker.mjs']})]);
 return [['score-lab.js',Buffer.from(lab.outputFiles[0].contents)],['score-matte-worker.js',Buffer.from(worker.outputFiles[0].contents)]];
})();}
// artifact면 문서 틀(doctype·html·head·body)을 빼고 내용만 둔다(게시할 때 틀이 씌워진다).
export async function standalone({artifact=false}={}){
 const files=new Map([...await buildScoreLab(),...await buildPPT()]),html=await readFile(root+'web-editor/score-lab.html','utf8');
 const inline=b=>Buffer.from(b).toString('utf8').replace(/<\/script/gi,'<\\/script');
 const tag='<script src="score-lab.js"></script>';if(!html.includes(tag))throw Error('score-lab.html script tag changed');
 const page=artifact?html.replace(/<!doctype html>\s*|<\/?html[^>]*>\s*|<\/?head>\s*|<\/?body>\s*/gi,'').replace(/<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/,''):html;
 return page.replace(tag,()=>`<script>window.SCORE_MATTE_WORKER_URL=URL.createObjectURL(new Blob([${JSON.stringify(files.get('score-matte-worker.js').toString('utf8'))}],{type:'text/javascript'}));</script>\n<script>${inline(files.get('ppt-engine.js'))}</script>\n<script>${inline(files.get('score-lab.js'))}</script>`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const out=process.argv[2];if(!out)throw Error('출력 경로를 주세요.');
 await writeFile(out,await standalone({artifact:process.argv.includes('--artifact')}));console.log('wrote',out);
}
