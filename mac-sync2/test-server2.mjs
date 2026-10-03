import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Sync 2 엔진 검사용 로컬 Worker. 빈 서버에서 시작하며 자료는 YB2Test가 API로 넣는다.
const { outputFiles } = await build({ entryPoints: ['cloudflare/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: outputFiles[0].text, compatibilityDate: '2026-09-28', host: '127.0.0.1', port: 0, bindings: { SITE_PASSWORD: 'native-integration-only' }, d1Databases: ['DB'], r2Buckets: ['FILES'], cf: false }));
try {
  const url = await mf.ready;
  const child = spawn(process.argv[2] || './mac-sync2/build/yb2-test', [url.origin], { stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, 'Sync 2 engine integration process');
  } finally { clearTimeout(timer); }
} finally { await mf.dispose(); }
