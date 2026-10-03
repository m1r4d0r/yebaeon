import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://example.test';
const password = 'test-only-password';
const xml = text => `<?xml version="1.0" encoding="UTF-8"?><RVPresentationDocument versionNumber="600"><title>${text}</title></RVPresentationDocument>`;
const hash = text => createHash('sha256').update(text).digest('hex');

test('private document library with real Worker, D1 and R2 bindings', { timeout: 90000 }, async t => {
  const bundled = await build({ entryPoints: ['cloudflare/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  const options = { modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-28', bindings: { SITE_PASSWORD: password }, d1Databases: ['DB'], r2Buckets: ['FILES'], serviceBindings: { ASSETS: () => new Response('private resource', { headers: { 'Cache-Control': 'public' } }) }, cf: false };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const bucket = await mf.getR2Bucket('FILES');
  const call = (path, { cookie, method = 'GET', body, headers = {} } = {}) => mf.dispatchFetch(origin + '/api' + path, {
    method, body, ...(body instanceof ReadableStream ? {duplex:'half'} : {}), headers: { ...(method !== 'GET' && method !== 'HEAD' ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }
  });
  const signIn = (name = '은혜', extra = {}) => call('/session', { method: 'POST', body: JSON.stringify({ name, password, remember: true, ...extra }), headers: { 'Content-Type': 'application/json' } });
  const code = async (response, status, expected) => { assert.equal(response.status, status, await response.clone().text()); if (expected) assert.equal((await response.json()).error, expected); };
  let cookie, id;

  await t.test('private reads and writes require a session; unknown API stays JSON', async () => {
    for (const path of ['/dropbox/config', '/dropbox/list', '/dropbox/file?path=a.hwp', '/documents/11111111-1111-4111-a111-111111111111/usage', '/status', '/documents', '/documents/11111111-1111-4111-a111-111111111111/content', '/documents/11111111-1111-4111-a111-111111111111/versions']) {
      await code(await call(path), 401, 'login_required');
    }
    await code(await call('/documents?path=private.pro6', { method: 'POST', body: xml('private') }), 401);
    await code(await call('/unknown'), 404, 'not_found');
    assert.deepEqual(await (await call('/session')).json(), { authenticated: false, ready: true });
  });
  await t.test('origin, input validation and incorrect passwords', async () => {
    await code(await call('/session', { method: 'POST', body: '{}', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' } }), 403, 'origin_required');
    await code(await call('/session', { method: 'POST', body: '{}', headers: { Origin: '', 'Content-Type': 'application/json' } }), 403);
    await code(await signIn('', {}), 400, 'invalid_name');
    await code(await signIn('은혜', { password: '' }), 400);
    await code(await signIn('은혜', { password: 'incorrect' }), 401, 'wrong_password');
    const result = await signIn(); await code(result, 200);
    const setCookie = result.headers.get('Set-Cookie');
    assert.match(setCookie, /__Host-yebaeon=/); assert.match(setCookie, /Secure; HttpOnly; SameSite=Strict; Max-Age=2592000/);
    cookie = setCookie.split(';')[0];
    const state = await (await call('/session', { cookie })).json();
    assert.equal(state.name, '은혜'); assert.equal(state.authenticated, true);
    assert.equal((await call('/documents', { cookie })).headers.get('Cache-Control'), 'no-store');
    await code(await call('/documents', { cookie: cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a') }), 401);
    const sessionRow = await db.prepare('SELECT * FROM yebaeon_sessions').first();
    assert.equal(sessionRow.id.length, 64); assert.ok(!cookie.includes(sessionRow.id));
  });
  await t.test('upload rejects unsafe paths, malformed XML and unsupported package media', async () => {
    for (const path of ['../a.pro6', 'a/../b.pro6', '/absolute.pro6', 'a\\b.pro6', 'a//b.pro6', 'bad.txt', 'folder./b.pro6']) {
      await code(await call('/documents?path=' + encodeURIComponent(path), { cookie, method: 'POST', body: xml('x') }), 400, 'invalid_path');
    }
    for (const body of ['<html></html>', '<RVPresentationDocument><a></RVPresentationDocument>', '<!DOCTYPE RVPresentationDocument [<!ENTITY x SYSTEM "file:///etc/passwd">]><RVPresentationDocument>&x;</RVPresentationDocument>']) {
      await code(await call('/documents?path=bad.pro6', { cookie, method: 'POST', body }), 400, 'invalid_document');
    }
    await code(await call('/documents?path=bad.pro6', { cookie, method: 'POST', body: new Uint8Array([0xff]) }), 400, 'invalid_encoding');
    await code(await call('/documents?path=bad.pro6', { cookie, method: 'POST', body: xml('file:///PP6-Package/media/a.jpg') }), 422, 'package_media');
    await code(await call('/documents?path=large.pro6', { cookie, method: 'POST', body: new ReadableStream({start(controller){for(let i=0;i<401;i++)controller.enqueue(new Uint8Array(i===400 ? 1 : 65536).fill(120));controller.close();}}) }), 413, 'too_large');
    assert.equal((await bucket.list()).objects.length, 0);
  });
  await t.test('restoring old content creates a new CAS version and storage totals separate history', async () => {
    const first=(await (await call('/documents?path=restore.pro6',{cookie,method:'POST',body:xml('first')})).json()).document;
    const id=first.id;
    await code(await call(`/documents/${id}`,{cookie,method:'PUT',body:xml('second'),headers:{'If-Match':'"1"'}}),200);
    const original=await (await call(`/documents/${id}/content?version=1`,{cookie})).text();
    await code(await call(`/documents/${id}`,{cookie,method:'PUT',body:original,headers:{'If-Match':'"1"'}}),409);
    const restored=await (await call(`/documents/${id}`,{cookie,method:'PUT',body:original,headers:{'If-Match':'"2"'}})).json();
    assert.equal(restored.document.version,3);
    assert.equal(await (await call(`/documents/${id}/content?version=2`,{cookie})).text(),xml('second'));
    const status=await (await call('/status?details=1',{cookie})).json();
    assert.equal(status.storage.currentDocuments.bytes,Buffer.byteLength(xml('first')));
    assert.equal(status.storage.documentHistory.count,2);
    assert.equal(status.storage.documentHistory.bytes,Buffer.byteLength(xml('first'))+Buffer.byteLength(xml('second')));
    assert.equal(status.storage.trackedBytes,status.storage.currentDocuments.bytes+status.storage.documentHistory.bytes);
    // Leave the shared fixture empty for subsequent tests.
    await db.prepare('DELETE FROM yebaeon_document_usage WHERE document_id=?').bind(id).run();
    await db.prepare('DELETE FROM yebaeon_versions WHERE document_id=?').bind(id).run();
    await db.prepare('DELETE FROM yebaeon_documents WHERE id=?').bind(id).run();
    for(const object of (await bucket.list()).objects)await bucket.delete(object.key);
  });
  await t.test('upload preserves bytes, folder path, author and version 1; repeats are idempotent', async () => {
    const body = xml('한글 원본\r\n줄바꿈'), path = '주일예배/말씀.pro6';
    const result = await call('/documents?path=' + encodeURIComponent(path), { cookie, method: 'POST', body });
    await code(result, 201); const saved = (await result.json()).document; id = saved.id;
    assert.equal(saved.path, path); assert.equal(saved.updatedBy, '은혜'); assert.equal(saved.version, 1); assert.equal(saved.sha256, hash(body));
    const content = await call(`/documents/${id}/content`, { cookie });
    assert.equal(await content.text(), body); assert.equal(content.headers.get('X-Yebaeon-SHA256'), saved.sha256);
    assert.match(content.headers.get('Content-Disposition'), /attachment; filename\*=UTF-8''/);
    const repeat = await call('/documents?path=' + encodeURIComponent(path), { cookie, method: 'POST', body });
    assert.equal((await repeat.json()).unchanged, true);
    await code(await call('/documents?path=' + encodeURIComponent(path), { cookie, method: 'POST', body: xml('other') }), 409, 'path_exists');
    assert.equal((await bucket.list()).objects.length, 1);
    const listing = await (await call('/documents?q=' + encodeURIComponent('말씀'), { cookie })).json();
    assert.equal(listing.documents[0].id, id); assert.equal(listing.next, null);
    const head = await call(`/documents/${id}/content`, { cookie, method: 'HEAD' }); assert.equal(await head.text(), '');
  });
  await t.test('name change affects only future saves; stale saves cannot overwrite', async () => {
    await code(await call('/session', { cookie, method: 'PATCH', body: JSON.stringify({ name: '  지훈  ' }), headers: { 'Content-Type': 'application/json' } }), 200);
    await code(await call(`/documents/${id}`, { cookie, method: 'PUT', body: xml('changed') }), 428, 'version_required');
    await code(await call(`/documents/${id}`, { cookie, method: 'PUT', body: xml('changed'), headers: { 'If-Match': '"1"', Origin: 'https://attacker.test' } }), 403);
    const saved = await call(`/documents/${id}`, { cookie, method: 'PUT', body: xml('changed'), headers: { 'If-Match': '"1"' } });
    assert.equal((await saved.json()).document.updatedBy, '지훈');
    await code(await call(`/documents/${id}`, { cookie, method: 'PUT', body: xml('stale'), headers: { 'If-Match': '"1"' } }), 409, 'version_conflict');
    const unchanged = await call(`/documents/${id}`, { cookie, method: 'PUT', body: xml('changed'), headers: { 'If-Match': '"2"' } });
    assert.equal((await unchanged.json()).unchanged, true);
    const versions = (await (await call(`/documents/${id}/versions`, { cookie })).json()).versions;
    assert.deepEqual(versions.map(v => [v.version, v.author]), [[2, '지훈'], [1, '은혜']]);
    assert.equal(await (await call(`/documents/${id}/content?version=1`, { cookie })).text(), xml('한글 원본\r\n줄바꿈'));
  });
  await t.test('simultaneous writes have exactly one winner and retain every committed original', async () => {
    const responses = await Promise.all(['A', 'B'].map(text => call(`/documents/${id}`, { cookie, method: 'PUT', body: xml(text), headers: { 'If-Match': '"2"' } })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const saved = (await responses.find(r => r.status === 200).json()).document;
    const current = await (await call(`/documents/${id}`, { cookie })).json(); assert.equal(current.document.version, 3); assert.equal(current.document.sha256, saved.sha256);
    assert.equal(hash(await (await call(`/documents/${id}/content`, { cookie })).text()), saved.sha256);
    assert.equal((await (await call(`/documents/${id}/versions`, { cookie })).json()).versions.length, 3);
    assert.equal((await bucket.list()).objects.length, 3);
  });
  await t.test('failed version insert rolls back metadata instead of publishing an incomplete document', async () => {
    await db.exec("CREATE TRIGGER test_fail_version BEFORE INSERT ON yebaeon_versions WHEN NEW.version = 4 BEGIN SELECT RAISE(ABORT, 'test simulated failure'); END;");
    await code(await call(`/documents/${id}`, { cookie, method: 'PUT', body: xml('will fail'), headers: { 'If-Match': '"3"' } }), 503);
    assert.equal((await (await call(`/documents/${id}`, { cookie })).json()).document.version, 3);
    const versions = (await (await call(`/documents/${id}/versions`, { cookie })).json()).versions;
    assert.equal(versions.length, 3);
    for (const version of versions) assert.equal(hash(await (await call(`/documents/${id}/content?version=${version.version}`, { cookie })).text()), version.sha256);
    await db.exec('DROP TRIGGER test_fail_version;');
  });
  await t.test('library and history pagination do not omit or repeat rows', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => db.prepare('INSERT INTO yebaeon_documents(id,path,created_at,current_version,updated_at,updated_by,sha256,size,write_id) SELECT ?, ?, created_at, 1, updated_at, updated_by, sha256, size, ? FROM yebaeon_documents WHERE id = ?').bind('fixture-' + i, `pagination/${String(i).padStart(3, '0')}.pro6`, 'fixture-' + i, id));
    await db.batch(rows);
    const first = await (await call('/documents?q=pagination/', { cookie })).json(); assert.equal(first.documents.length, 100); assert.ok(first.next);
    const last = await (await call('/documents?q=pagination/&after=' + encodeURIComponent(first.next), { cookie })).json(); assert.equal(last.documents.length, 1); assert.equal(last.next, null);
    assert.equal(new Set([...first.documents, ...last.documents].map(d => d.id)).size, 101);
    await db.batch(Array.from({ length: 51 }, (_, i) => db.prepare('INSERT INTO yebaeon_versions SELECT document_id, ?, ?, sha256, size, author, created_at FROM yebaeon_versions WHERE document_id = ? AND version = 1').bind(i + 4, 'history-fixture-' + i, id)));
    const page = await (await call(`/documents/${id}/versions`, { cookie })).json(); assert.equal(page.versions.length, 50); assert.equal(page.next, 5);
    const tail = await (await call(`/documents/${id}/versions?before=${page.next}`, { cookie })).json(); assert.deepEqual(tail.versions.map(v => v.version), [4, 3, 2, 1]);
  });
  await t.test('special Mac names remain metadata while R2 keys use document IDs', async () => {
    const path = '찬양/원제 : 예수 & "피" %3A.pro6', body = xml('special filename');
    const result = await call('/documents?path=' + encodeURIComponent(path), { cookie, method: 'POST', body });
    await code(result, 201); const doc = (await result.json()).document;
    assert.equal(doc.path, path);
    const objects = (await bucket.list({ prefix: 'documents/' + doc.id + '/' })).objects;
    assert.equal(objects.length, 1); assert.ok(!objects[0].key.includes('원제'));
    const received = await call('/documents/' + doc.id + '/content', { cookie });
    assert.equal(await received.text(), body);
    assert.ok(received.headers.get('Content-Disposition').includes(encodeURIComponent(path.split('/').pop())));
    const repeat = await call('/documents?path=' + encodeURIComponent(path.normalize('NFD')), { cookie, method: 'POST', body });
    assert.equal((await repeat.json()).document.id, doc.id);
    const changed = await call('/documents/' + doc.id, { cookie, method: 'PUT', body: xml('updated special'), headers: { 'If-Match': '"1"' } });
    await code(changed, 200); assert.equal((await changed.json()).document.path, path);
    assert.equal(await (await call('/documents/' + doc.id + '/content', { cookie })).text(), xml('updated special'));
  });
  await t.test('usage reads existing versioned originals without changing content or upload time', async () => {
    const original = `<?xml version="1.0"?><!-- lastDateUsed="wrong" --><RVPresentationDocument notes="x &gt; y" lastDateUsed="2026-04-05T09:21:09+09:00"><slide lastDateUsed="2099-01-01T00:00:00Z"/></RVPresentationDocument>`;
    const created = await (await call('/documents?path=usage-test.pro6', { cookie, method: 'POST', body: original })).json();
    const doc = created.document;
    const usage = await call(`/documents/${doc.id}/usage?version=1`, { cookie });
    await code(usage, 200);
    assert.equal((await usage.json()).lastDateUsed, '2026-04-05T00:21:09.000Z');
    const after = (await (await call(`/documents/${doc.id}`, { cookie })).json()).document;
    assert.equal(after.updatedAt, doc.updatedAt); assert.equal(after.sha256, doc.sha256);
    assert.equal(await (await call(`/documents/${doc.id}/content`, { cookie })).text(), original);
    await code(await call(`/documents/${doc.id}/usage?version=0`, { cookie }), 400);
    await code(await call(`/documents/${doc.id}/usage?version=99`, { cookie }), 404);
    await code(await call(`/documents/${doc.id}`, { cookie, method: 'PUT', body: xml('no usage date'), headers: { 'If-Match': '"1"' } }), 200);
    assert.equal((await (await call(`/documents/${doc.id}/usage`, { cookie })).json()).lastDateUsed, null);
    assert.equal((await (await call(`/documents/${doc.id}/usage?version=1`, { cookie })).json()).lastDateUsed, '2026-04-05T00:21:09.000Z');
  });
  await t.test('global sorting, stable date pagination and legacy usage backfill', async () => {
    const ids=[];
    for(let i=0;i<130;i++) {
      const fixtureId=randomUUID(), path=`sort-fixture/${String(i).padStart(3,'0')}.pro6`, stamp=i===129 ? '2026-10-01T00:00:00.000Z' : '2026-04-01T00:00:00.000Z';
      ids.push(fixtureId);
      await db.batch([
        db.prepare('INSERT INTO yebaeon_documents(id,path,created_at,current_version,updated_at,updated_by,sha256,size,write_id) VALUES (?, ?, ?, 1, ?, ?, ?, 1, ?)').bind(fixtureId,path,stamp,stamp,'sort-test','fixture-hash',fixtureId),
        db.prepare('INSERT INTO yebaeon_versions VALUES (?, 1, ?, ?, 1, ?, ?)').bind(fixtureId,'sort-'+fixtureId,'fixture-hash','sort-test',stamp),
        db.prepare('UPDATE yebaeon_documents SET last_used=?,usage_version=1 WHERE id=?').bind(i===0 ? null : stamp,fixtureId)
      ]);
    }
    // Simulate an already-uploaded document from before the index existed.
    await db.prepare('UPDATE yebaeon_documents SET usage_version=NULL,last_used=NULL WHERE id=?').bind(ids[128]).run();
    await bucket.put('sort-'+ids[128], '<RVPresentationDocument lastDateUsed="2026-10-01T10:00:00+09:00"></RVPresentationDocument>');
    for(const fixtureId of ids.slice(1,14)) {
      await db.prepare('UPDATE yebaeon_documents SET usage_version=NULL,last_used=NULL WHERE id=?').bind(fixtureId).run();
      await bucket.put('sort-'+fixtureId,'<RVPresentationDocument lastDateUsed="2026-04-01T00:00:00Z"></RVPresentationDocument>');
    }
    const preparing=await (await call('/documents?q=sort-fixture%2F&sort=used',{cookie})).json();
    assert.equal(preparing.indexing,null);assert.equal(preparing.documents.length,100);
    assert.equal(preparing.documents[0].id,ids[129]);
    const collect=async(sort)=>{let result=[],next=null; do {const params=new URLSearchParams({q:'sort-fixture/',sort});if(next)params.set(sort.startsWith('name')?'after':'cursor',next);const page=await (await call('/documents?'+params,{cookie})).json();assert.equal(page.indexing?.remaining||0,0);result.push(...page.documents);next=page.next;}while(next);return result;};
    let after='sort-fixture/';do{const p=await(await call('/search-index?after='+encodeURIComponent(after),{cookie,method:'POST'})).json();after=p.next;}while(after);
    const used=await collect('used'); assert.equal(used.length,130);assert.equal(new Set(used.map(d=>d.id)).size,130);
    assert.equal(used[0].id,ids[128]);assert.equal(used[1].id,ids[129]);assert.equal(used.at(-1).id,ids[0]);
    const updated=await collect('updated');assert.equal(updated[0].id,ids[129]);assert.equal(updated.length,130);
    const reverse=await collect('name-desc');assert.equal(reverse[0].id,ids[129]);assert.equal(reverse.at(-1).id,ids[0]);
    const cache=await db.prepare('SELECT last_used FROM yebaeon_documents WHERE id=?').bind(ids[128]).first();assert.equal(cache.last_used,'2026-10-01T01:00:00.000Z');
    await code(await call('/documents?sort=bad',{cookie}),400);
    await code(await call('/documents?sort=updated&cursor=broken',{cookie}),400);
  });
  await t.test('status reflects committed documents and native connect/compare requests', async () => {
    const before = await (await call('/status', { cookie })).json();
    const totals = await db.prepare('SELECT COUNT(*) AS count, SUM(size) AS size FROM yebaeon_documents').first();
    assert.equal(before.storage,undefined);assert.equal(before.workers,undefined);
    assert.equal(before.documents, totals.count); assert.equal(before.bytes, totals.size); assert.ok(before.recent.length <= 12);
    const native = { 'User-Agent': 'YebaeOn-Sync/0.3 (macOS)' };
    await code(await call('/session', { cookie, headers: native }), 200);
    await code(await call('/documents', { cookie, headers: native }), 200);
    const after = await (await call('/status', { cookie })).json();
    assert.equal(after.sync.length, 1); assert.ok(after.sync[0].connectedAt); assert.ok(after.sync[0].comparedAt);
    const protectedAsset = await mf.dispatchFetch(origin + '/resources/catalog.json');
    await code(protectedAsset, 401, 'login_required');
    await code(await mf.dispatchFetch(origin + '/resources%2fcatalog.json'), 401, 'login_required');
    const allowed = await mf.dispatchFetch(origin + '/resources/catalog.json', { headers: { Cookie: cookie } });
    assert.equal(allowed.status, 200); assert.equal(await allowed.text(), 'private resource');
    assert.equal(allowed.headers.get('Cache-Control'), 'private, no-store');
  });
  await t.test('logout, expiration and password rotation invalidate server sessions', async () => {
    await code(await call('/session', { cookie, method: 'DELETE' }), 200);
    await code(await call('/documents', { cookie }), 401);
    const sessionOnly = await signIn('은혜', { remember: false });
    assert.ok(!sessionOnly.headers.get('Set-Cookie').includes('Max-Age'));
    const temporaryCookie = sessionOnly.headers.get('Set-Cookie').split(';')[0];
    await db.exec('UPDATE yebaeon_sessions SET expires_at = 0;');
    await code(await call('/documents', { cookie: temporaryCookie }), 401);
    const result = await signIn(); cookie = result.headers.get('Set-Cookie').split(';')[0];
    await mf.setOptions(convertV4MiniflareOptions({ ...options, bindings: { SITE_PASSWORD: 'rotated-test-password' } }));
    await code(await call('/documents', { cookie }), 401);
    await mf.setOptions(convertV4MiniflareOptions(options));
  });
  await t.test('repeated incorrect passwords are limited', async () => {
    await (await mf.getD1Database('DB')).exec('DELETE FROM yebaeon_login_limits;');
    for (let i = 0; i < 8; i++) await code(await signIn('은혜', { password: 'wrong' }), 401);
    const limited = await signIn(); await code(limited, 429, 'too_many_attempts'); assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  });
});


