import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicFiles = Object.freeze([
  'index.html', 'style.css', 'fonts.css', 'pp6.js',
  'fonts.js', 'render.js', 'selection.js', 'editor-history.js', 'bible-format.js', 'shortcuts.js', 'app.js', 'drafts.js', 'cloud.js', 'usage.js', 'playlists.js', 'resources.js', 'status.html', 'status.js', 'status.css', '_headers'
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
