import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import worker from '../cloudflare/worker.mjs';
import { build, buildInfo, publicFiles, generatedPublicFiles } from '../scripts/build.mjs';

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
    assert.deepEqual((await readdir(outputDir)).sort(), [...publicFiles,...generatedPublicFiles].sort());
    assert.equal(await readFile(join(outputDir, 'shortcuts.js'), 'utf8'), 'shortcuts.js');
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
  assert.equal((await health.json()).mode, 'document-library');
  assert.equal(health.headers.get('Cache-Control'), 'no-store');
  const setup = await worker.fetch(new Request('https://example.test/api/session'), env);
  assert.deepEqual(await setup.json(), { authenticated: false, ready: false });
  const locked = await worker.fetch(new Request('https://example.test/api/documents'), env);
  assert.equal(locked.status, 503);
  const head = await worker.fetch(new Request('https://example.test/api/health', { method: 'HEAD' }), env);
  assert.equal(await head.text(), '');
  const post = await worker.fetch(new Request('https://example.test/api/health', { method: 'POST' }), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  for (const path of ['/api', '/api/files/private.pro6']) {
    const response = await worker.fetch(new Request('https://example.test' + path), env);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'not_found');
  }
});

test('non-API requests retain the asset response including missing-file status', async () => {
  const request = new Request('https://example.test/sample-data.js');
  const response = await worker.fetch(request, {
    ASSETS: { fetch(received) { assert.equal(received, request); return new Response('Not found', { status: 404 }); } }
  });
  assert.equal(response.status, 404);
});

test('build info names the deploy run, commit and newest changelog lines first', async () => {
  const info = await buildInfo(undefined, { GITHUB_RUN_NUMBER: '42', GITHUB_SHA: '0123456789abcdef' });
  const data = JSON.parse(info.match(/^window\.YEBAEON_BUILD=(.*);$/m)[1]);
  assert.equal(data.number, '42'); assert.equal(data.commit, '0123456');
  assert.ok(data.changes.length > 0 && data.changes.length <= 5); assert.ok(data.changes.every(c => /^\d{4}-\d{2}-\d{2}: /.test(c) && !/main 병합·배포\)$/.test(c)));
  assert.match(info, /console\.info/);
});

test('manual builds the page, per-page Markdown, one-file Markdown and checked images', async () => {
  const { buildManual } = await import('../scripts/build-manual.mjs');
  const folder = await mkdtemp(join(tmpdir(), 'yebaeon-manual-test-'));
  try {
    await mkdir(join(folder, 'docs/manual/img'), { recursive: true });
    await writeFile(join(folder, 'docs/manual/img/shot.png'), 'png');
    await writeFile(join(folder, 'docs/manual/01-intro.md'), '---\ntitle: 소개\ngroup: 시작하기\nlede: 한 줄\n---\n\n## 처음\n\n![화면](img/shot.png)\n');
    await writeFile(join(folder, 'docs/manual/02-admin.md'), '---\ntitle: 관리\ngroup: 관리자\nadmin: true\n---\n\n본문 </script> 끝\n');
    const files = new Map((await buildManual(folder, '2026-10-05')).map(([name, bytes]) => [name, bytes.toString()]));
    assert.deepEqual([...files.keys()].sort(), ['manual/admin.md', 'manual/img/shot.png', 'manual/index.html', 'manual/intro.md', 'manual/llms-full.txt', 'manual/llms.txt']);
    assert.match(files.get('manual/index.html'), /data-id="admin"[^>]*data-admin="1"/);
    assert.doesNotMatch(files.get('manual/index.html'), /본문 <\/script>/, 'page text cannot close its own script block');
    assert.match(files.get('manual/intro.md'), /^# 소개\n\n> 한 줄\n/);
    assert.match(files.get('manual/llms-full.txt'), /## 소개[\s\S]*### 처음[\s\S]*## 관리/);
    await writeFile(join(folder, 'docs/manual/03-broken.md'), '---\ntitle: 깨짐\ngroup: 참고\n---\n\n![없음](img/missing.png)\n');
    await assert.rejects(buildManual(folder), /그림이 없습니다/);
  } finally { await rm(folder, { recursive: true }); }
});
