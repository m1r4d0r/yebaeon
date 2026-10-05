import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// 설명서 그림용 로컬 Worker를 띄우고, 시험 자료를 넣은 뒤 캡처 전용 Sync 2를 장면마다 한 번씩 실행한다.
const [tools, out] = process.argv.slice(2);
const PASSWORD = 'manual-capture-only';
const SHOTS = [['sync-main.png', '2부 예배'], ['sync-first.png', '1부 예배(품성)']];
const run = (file, args, env = {}) => new Promise((done, fail) => {
  const child = spawn(file, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
  child.once('error', fail);
  child.once('exit', code => { clearTimeout(timer); code === 0 ? done(output) : fail(new Error(`${file} exited ${code}`)); });
});
const { outputFiles } = await build({ entryPoints: ['cloudflare/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
for (const [name, select] of SHOTS) {
  // 장면마다 빈 로컬 Worker와 새 시험 폴더를 쓴다(같은 자료를 두 번 올리지 않게).
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: outputFiles[0].text, compatibilityDate: '2026-09-28', host: '127.0.0.1', port: 0, bindings: { SITE_PASSWORD: PASSWORD }, d1Databases: ['DB'], r2Buckets: ['FILES'], cf: false }));
  try {
    const origin = (await mf.ready).origin;
    const area = JSON.parse(await run(resolve(tools, 'yb2-capture-seed'), [origin, PASSWORD]));
    await run(resolve(tools, 'SyncCapture.app/Contents/MacOS/YebaeOnSync2'), [], {
      YB2_CAPTURE_ORIGIN: origin, YB2_CAPTURE_NAME: '교회 Mac', YB2_CAPTURE_PASSWORD: PASSWORD,
      YB2_CAPTURE_ROOT: area.root, YB2_CAPTURE_PLAYLIST: area.playlist, YB2_CAPTURE_PROFILE: area.profile,
      YB2_CAPTURE_SELECT: select, YB2_CAPTURE_OUT: resolve(out, name)
    });
    console.log('그림', name);
  } finally { await mf.dispose(); }
}
