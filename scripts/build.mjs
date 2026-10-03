import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { XMLParser } from 'fast-xml-parser';

const formatContext={window:{},TextDecoder,Uint8Array,atob};
runInNewContext(readFileSync(new URL('../web-editor/pp6.js',import.meta.url),'utf8'),formatContext);
const templateParser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',preserveOrder:true,trimValues:false,parseTagValue:false});
export function templateFormatHash(xml){
  const tree=templateParser.parse(xml),elements=[];let root={};
  const content=(nodes,tag)=>{const node=nodes.find(n=>n[tag]&&n[':@']?.rvXMLIvarName===({RVRect3D:'position',NSString:'RTFData',shadow:'shadow'})[tag]);return node?.[tag]?.map(x=>x['#text']||'').join('')||'';};
  function visit(nodes){for(const node of nodes){const type=Object.keys(node).find(k=>k!==':@');if(type==='RVDisplaySlide')root=node[':@']||{};if(['RVTextElement','RVImageElement','RVVideoElement'].includes(type))elements.push({type,attrs:node[':@']||{},position:content(node[type],'RVRect3D'),shadow:content(node[type],'shadow'),...(type==='RVTextElement'?{rtf:content(node[type],'NSString')}:{})});if(Array.isArray(node[type]))visit(node[type]);}}
  visit(tree);return createHash('sha256').update(formatContext.window.PP6.templateFormatData(root,elements)).digest('hex');
}

// ZIP tools may interpret UTF-8 filename bytes as CP437. Only accept a strict
// UTF-8 round-trip producing Hangul; leave already-correct names untouched.
const cp437High = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
export function resourceName(value) {
  if(typeof value !== 'string')return value;
  const bytes=[];
  for(const char of value){const code=char.codePointAt(0),index=cp437High.indexOf(char);if(code<128)bytes.push(code);else if(index>=0)bytes.push(index+128);else return value.normalize('NFC');}
  try{const decoded=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes));if(/\p{Script=Hangul}/u.test(decoded))return decoded.normalize('NFC');}catch{}
  return value.normalize('NFC');
}
export function splitTemplates(bytes) {
  const assets=new Map();
  const index=JSON.parse(bytes).map(template=>{
    const {xml,...metadata}=template;
    if(typeof xml!=='string')throw new Error('Template XML is missing');
    const file='template-'+createHash('sha256').update(xml).digest('hex').slice(0,24)+'.json';
    assets.set(file,Buffer.from(JSON.stringify({xml})));
    return {...metadata,name:resourceName(metadata.name),label:resourceName(metadata.label),file,format:templateFormatHash(xml)};
  });
  return [['templates.json',Buffer.from(JSON.stringify(index))],...assets];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicFiles = Object.freeze([
  'hwp-binary.js', 'bulletin-parser.js', 'bulletin-documents.js', 'bulletin.js', 'bulletin.css', 'responsive.js', 'responsive.css', 'index.html', 'favicon.svg', 'favicon.ico', 'style.css', 'fonts.css', 'pp6.js',
  'fonts.js', 'studio-workflow.js', 'layout-editor.js', 'render.js', 'selection.js', 'editor-history.js', 'bible-format.js', 'shortcuts.js', 'app.js', 'drafts.js', 'cloud.js', 'usage.js', 'playlists.js', 'resources.js', 'library-actions.js', 'status.html', 'status.js', 'status.css', '_headers'
]);

export async function build({ sourceRoot = root, outputDir = join(root, 'dist') } = {}) {
  // Read an explicit list: the local source folder may contain private fixtures.
  const contents = await Promise.all(publicFiles.map(async name => {
    const source = join(sourceRoot, name === '_headers' ? 'cloudflare' : 'web-editor', name);
    if (!(await lstat(source)).isFile()) throw new Error(`Expected a regular source file: ${name}`);
    return [name, await readFile(source)];
  }));
  let resources = [];
  let catalogBytes;
  try { catalogBytes = await readFile(join(sourceRoot, 'church-resources/catalog.json'), 'utf8'); } catch (error) { if(error.code !== 'ENOENT') throw error; }
  const resourceRoot = join(sourceRoot, 'church-resources');
  if (catalogBytes !== undefined) {
    const catalog = JSON.parse(catalogBytes);
    const names = [...new Set(['catalog.json', 'templates.json', 'bible.json', ...catalog.fonts.map(x => x.file), ...catalog.media.map(x => x.file)])];
    resources = await Promise.all(names.map(async name => {
      if (!/^[a-z0-9.-]+$/.test(name)) throw new Error('Invalid resource filename');
      const path = join(resourceRoot, name);
      let bytes;
      try {
        if (!(await lstat(path)).isFile()) throw new Error('Resource must be a regular file');
        bytes = await readFile(path);
      } catch(error) {
        if(error.code !== 'ENOENT' || !['bible.json','templates.json'].includes(name)) throw error;
        if (!(await lstat(path + '.gz')).isFile()) throw new Error('Resource must be a regular file');
        bytes = gunzipSync(await readFile(path + '.gz'));
      }
      if (bytes.length > 25 * 1024 * 1024) throw new Error('Resource exceeds asset size limit');
      return [name, bytes];
    }));
  }
  if (resources.length) {
    const templates=resources.find(([name])=>name==='templates.json');
    if(templates)resources=[...resources.filter(([name])=>name!=='templates.json'),...splitTemplates(templates[1])];
    const sizes=new Map(resources.map(([name,bytes])=>[name,bytes.length]));
    const index=resources.findIndex(([name])=>name==='catalog.json');
    const catalog=JSON.parse(resources[index][1]);
    catalog.storage={mediaBytes:catalog.media.reduce((sum,x)=>sum+sizes.get(x.file),0),fontBytes:catalog.fonts.reduce((sum,x)=>sum+sizes.get(x.file),0)};
    resources[index][1]=Buffer.from(JSON.stringify(catalog));
  }
  await mkdir(outputDir, { recursive: true });
  if (!(await lstat(outputDir)).isDirectory()) throw new Error('Output must be a regular directory.');
  const entries = await readdir(outputDir, { withFileTypes: true });
  // Never publish unexpected leftovers or follow symlinks in the output folder.
  if (entries.some(entry => entry.name === 'resources' ? !entry.isDirectory() || !resources.length : !entry.isFile() || !publicFiles.includes(entry.name))) {
    throw new Error('Unexpected files in the output directory. Use an empty dist directory.');
  }
  await Promise.all(contents.map(([name, bytes]) => writeFile(join(outputDir, name), bytes)));
  if (resources.length) {
    const target = join(outputDir, 'resources'); await mkdir(target, { recursive: true });
    const entries = await readdir(target, { withFileTypes: true });
    if (entries.some(x => !x.isFile() || !resources.some(([name]) => name === x.name))) throw new Error('Unexpected resource files');
    await Promise.all(resources.map(([name, bytes]) => writeFile(join(target, name), bytes)));
  }
  return [...publicFiles, ...resources.map(([name]) => 'resources/' + name)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = await build();
  console.log(`Built ${files.length - 1} public app files and response headers in dist/.`);
}


