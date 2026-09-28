import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import worker from '../cloudflare/worker.mjs';
import { build, publicFiles } from '../scripts/build.mjs';

test('publication includes only app assets, even with private local fixtures', async () => {
  const prefix = join(tmpdir(), 'yebaeon-build-test-');
  const folder = await mkdtemp(prefix);
  try {
    await mkdir(join(folder, 'web-editor'));
    await mkdir(join(folder, 'cloudflare'));
    for (const name of publicFiles) {
      await writeFile(join(folder, name === '_headers' ? 'cloudflare' : 'web-editor', name), name);
    }
    await writeFile(join(folder, 'web-editor', 'sample-data.js'), 'PRIVATE CHURCH DATA');
    await writeFile(join(folder, 'web-editor', 'private.pro6'), 'PRIVATE DOCUMENT');
    const outputDir = join(folder, 'dist');
    await build({ sourceRoot: folder, outputDir });
    assert.deepEqual((await readdir(outputDir)).sort(), [...publicFiles].sort());
    assert.equal(await readFile(join(outputDir, 'sample-demo.js'), 'utf8'), 'sample-demo.js');
    await writeFile(join(outputDir, 'unexpected.pro6'), 'PRIVATE LEFTOVER');
    await assert.rejects(build({ sourceRoot: folder, outputDir }), /Unexpected files/);
  } finally {
    assert.ok(resolve(folder).startsWith(resolve(prefix)) && resolve(folder) !== resolve(tmpdir()));
    await rm(folder, { recursive: true });
  }
});

test('health check is read-only; unimplemented API paths never serve the editor', async () => {
  const env = { ASSETS: { fetch() { throw new Error('API must not serve HTML'); } } };
  Object.defineProperties(env, {
    DB: { get() { throw new Error('Storage must not be accessed'); } },
    FILES: { get() { throw new Error('Storage must not be accessed'); } }
  });
  const health = await worker.fetch(new Request('https://example.test/api/health'), env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, 'local-editor');
  assert.equal(health.headers.get('Cache-Control'), 'no-store');
  const head = await worker.fetch(new Request('https://example.test/api/health', { method: 'HEAD' }), env);
  assert.equal(await head.text(), '');
  const post = await worker.fetch(new Request('https://example.test/api/health', { method: 'POST' }), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  for (const path of ['/api', '/api/documents', '/api/files/private.pro6']) {
    const response = await worker.fetch(new Request('https://example.test' + path), env);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'not_found' });
  }
});

test('non-API requests retain the asset response including missing-file status', async () => {
  const request = new Request('https://example.test/sample-data.js');
  const response = await worker.fetch(request, {
    ASSETS: { fetch(received) { assert.equal(received, request); return new Response('Not found', { status: 404 }); } }
  });
  assert.equal(response.status, 404);
});
