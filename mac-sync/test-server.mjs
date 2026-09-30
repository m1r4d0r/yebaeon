import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({ entryPoints: ['cloudflare/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: outputFiles[0].text, compatibilityDate: '2026-09-28', host: '127.0.0.1', port: 0, bindings: { SITE_PASSWORD: 'native-integration-only' }, d1Databases: ['DB'], r2Buckets: ['FILES'], cf: false }));
try {
  const url = await mf.ready;
  const origin = url.origin;
  const login = await mf.dispatchFetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fixture', password: 'native-integration-only', remember: true }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  // Sorted after the Korean roundtrip path, so row 0 remains the roundtrip document.
  for (let i = 0; i < 101; i++) {
    const path = `힣-page/${String(i).padStart(3, '0')}.pro6`;
    const response = await mf.dispatchFetch(`${origin}/api/documents?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: '<RVPresentationDocument versionNumber="600"><text>synthetic</text></RVPresentationDocument>' });
    assert.equal(response.status, 201);
  }
  const child = spawn('./mac-sync/sync-integration', [origin], { stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, 'native integration process');
  } finally { clearTimeout(timer); }
} finally { await mf.dispose(); }
