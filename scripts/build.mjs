import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const publicFiles = Object.freeze([
  'index.html', 'style.css', 'fonts.css', 'pp6.js', 'zip.js',
  'fonts.js', 'render.js', 'sample-demo.js', 'app.js', '_headers'
]);

export async function build({ sourceRoot = root, outputDir = join(root, 'dist') } = {}) {
  // Read an explicit list: the local source folder may contain private fixtures.
  const contents = await Promise.all(publicFiles.map(async name => {
    const source = join(sourceRoot, name === '_headers' ? 'cloudflare' : 'web-editor', name);
    if (!(await lstat(source)).isFile()) throw new Error(`Expected a regular source file: ${name}`);
    return [name, await readFile(source)];
  }));
  await mkdir(outputDir, { recursive: true });
  if (!(await lstat(outputDir)).isDirectory()) throw new Error('Output must be a regular directory.');
  const entries = await readdir(outputDir, { withFileTypes: true });
  // Never publish unexpected leftovers or follow symlinks in the output folder.
  if (entries.some(entry => !entry.isFile() || !publicFiles.includes(entry.name))) {
    throw new Error('Unexpected files in the output directory. Use an empty dist directory.');
  }
  await Promise.all(contents.map(([name, bytes]) => writeFile(join(outputDir, name), bytes)));
  return [...publicFiles];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = await build();
  console.log(`Built ${files.length - 1} public app files and response headers in dist/.`);
}
