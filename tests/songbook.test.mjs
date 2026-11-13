import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { documentKeys, termKeys, sameSong, fillSongKeys, matchQuery } from '../cloudflare/song-key.mjs';
import { songbookRoute } from '../cloudflare/songbook.mjs';
import { measuredDB } from '../cloudflare/db-cost.mjs';

// 합성 이름만 쓴다. 실제 목록 자료(곡 제목·번호·문서 id)는 저장소에 두지 않는다.
const pair = (doc, term) => sameSong(documentKeys(doc + '.pro6'), termKeys(term));
test('이름 맞추기: 앞머리·앞 번호·꼬리, 가운데 포함과 4글자 앞머리는 짝이 아님', () => {
  assert.ok(pair('내 주 같은 분 없네 그 어느 누구도', '내 주 같은 분 없네'));
  assert.ok(pair('038 예수 우리 왕이여', '예수 우리 왕이여'));
  assert.ok(pair('영122_예수 우리 왕이여', '예수 우리 왕이여'));
  assert.equal(documentKeys('주님 말씀하시면-2.pro6').main, '주님말씀하시면');
  assert.equal(documentKeys('찬양/마라나타_Wide.pro6').main, '마라나타');
  assert.equal(documentKeys('항상 진실케 PPT.pro6').main, '항상진실케');
  assert.equal(documentKeys('은혜 아니면 copy 2.pro6').main, '은혜아니면');
  assert.ok(pair('주님 말씀하시면-2', '주님 말씀하시면'));
  assert.ok(pair('항상 진실케 PPT', '항상 진실케'));
  assert.ok(!pair('거룩하신 하나님 온 세상', '거룩하신 하나님 주께 감사드리세'));
  assert.ok(!pair('마라나타', '마라나타 주님 오소서'), '4글자 앞머리는 짝이 아니다');
  assert.ok(!pair('하나님의 은혜', '은혜'), '가운데 포함은 보지 않는다');
  assert.deepEqual(termKeys('주 품에 (Still)'), { main: '주품에', aux: ['still'] });
  assert.ok(pair('Still', '주 품에 (Still)'), '괄호 안 검색어는 보조 열쇠');
});

test('영광임하소서 목록 API와 이름 맞추기 색인', { timeout: 120000 }, async t => {
  const bundle = await build({ entryPoints: ['cloudflare/worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-28', bindings: { SITE_PASSWORD: 'songbook-test', ADMIN_PASSWORD: 'songbook-admin' }, d1Databases: ['DB'], r2Buckets: ['FILES'], cf: false }));
  t.after(() => mf.dispose());
  const origin = 'https://songbook.test'; let cookie = '', admin = '';
  const call = (path, method = 'GET', body, headers = {}) => mf.dispatchFetch(origin + '/api' + path, { method, body, headers: { 'Content-Type': 'application/json', Cookie: [cookie, admin].filter(Boolean).join('; '), ...(method === 'GET' ? {} : { Origin: origin }), ...headers } });
  const ok = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return status === 304 ? null : response.json(); };
  const login = await call('/session', 'POST', JSON.stringify({ name: 'fixture', password: 'songbook-test' })); await ok(login); cookie = login.headers.get('Set-Cookie').split(';')[0];
  const db = await mf.getD1Database('DB');
  const xml = category => `<RVPresentationDocument category="${category}" lastDateUsed="2026-10-01T00:00:00Z"><RVTextElement><NSString rvXMLIvarName="RTFData">${Buffer.from('{\\rtf1 lyrics}').toString('base64')}</NSString></RVTextElement></RVPresentationDocument>`;
  const create = async (name, category) => (await ok(await call('/documents?path=' + encodeURIComponent(name + '.pro6'), 'POST', xml(category), { 'Content-Type': 'application/xml' }), 201)).document;
  const key = async id => (await db.prepare('SELECT song_key FROM yebaeon_documents WHERE id=?').bind(id).first()).song_key;

  // song_key: 생성·이름 바꾸기
  const lyric = await create('합성 노래 하나 둘 셋', '가사찬양');
  const score = await create('012 합성 노래 하나 둘 셋_Wide', '악보찬양');
  const score2 = await create('합성 노래 하나 둘 셋 그 다음 줄', '악보찬양');
  const otherCategory = await create('합성 노래 하나 둘 셋 순서', '예배순서');
  const short = await create('합성 노래 하나 둘 셋 넷', '악보찬양');
  const trashed = await create('합성 노래 하나 둘 셋 PPT', '악보찬양');
  const linkedElsewhere = await create('합성 노래 하나 둘 셋-2', '악보찬양');
  const middle = await create('새 합성 노래 하나 둘 셋', '악보찬양');
  assert.equal(await key(lyric.id), '합성노래하나둘셋');
  assert.equal(await key(score.id), '합성노래하나둘셋');
  await ok(await call(`/documents/${short.id}/rename`, 'POST', JSON.stringify({ path: '합성 노래.pro6' }), { 'If-Match': `"${short.version}"` }));
  assert.equal(await key(short.id), '합성노래', '이름을 바꾸면 song_key도 바뀐다');
  await ok(await call(`/documents/${trashed.id}/state`, 'POST', JSON.stringify({ action: 'trash' })));

  // 보충: 비운 song_key를 한 번 채운다. 채운 행은 다시 쓰지 않는다.
  await db.prepare('UPDATE yebaeon_documents SET song_key=NULL WHERE id IN (?,?)').bind(lyric.id, score2.id).run();
  assert.equal(await fillSongKeys(db), 2);
  assert.equal(await key(lyric.id), '합성노래하나둘셋');
  assert.equal(await key(score2.id), '합성노래하나둘셋그다음줄');
  assert.equal(await fillSongKeys(db), 0);
  const plan = (await db.prepare('EXPLAIN QUERY PLAN ' + matchQuery(['합성노래하나둘셋', '합성']).sql).bind(...matchQuery(['합성노래하나둘셋', '합성']).args).all()).results.map(r => r.detail).join('\n');
  assert.match(plan, /yebaeon_documents_song_key/); assert.doesNotMatch(plan, /SCAN d\b/, plan);

  // GET: 빈 목록은 버전 0, ETag가 같으면 304
  let state = await ok(await call('/songbook'));
  assert.equal(state.version, 0); assert.deepEqual(state.songs, []);
  await ok(await call('/songbook', 'GET', undefined, { 'If-None-Match': '"0"' }), 304);
  const songs = [{ number: 58, key: 'G', terms: ['합성 노래 하나 둘 셋'], links: [lyric.id, linkedElsewhere.id], nots: [] }, { number: 7, key: 'Am', terms: ['다른 합성 곡'], links: [], nots: [] }];
  // 관리자 아님 403, If-Match 없음 428
  assert.equal((await call('/songbook', 'PUT', JSON.stringify({ songs }), { 'If-Match': '"0"' })).status, 403);
  const adminLogin = await call('/admin', 'POST', JSON.stringify({ password: 'songbook-admin' })); await ok(adminLogin); admin = adminLogin.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call('/songbook', 'PUT', JSON.stringify({ songs }))).status, 428);
  assert.equal((await call('/songbook', 'PUT', JSON.stringify({ songs }), { 'If-Match': '"0"', Origin: 'https://evil.test' })).status, 403);
  // 검증 오류
  const bad = async (list, pattern) => { const r = await call('/songbook', 'PUT', JSON.stringify({ songs: list }), { 'If-Match': '"0"' }); assert.equal(r.status, 400); assert.match((await r.json()).message, pattern); };
  await bad([{ number: 0, key: 'C', terms: ['가'] }], /번호는 1~999/);
  await bad([{ number: 1, key: 'C', terms: ['가'] }, { number: 1, key: 'D', terms: ['나'] }], /번호 1가/);
  await bad([{ number: 1, key: 'C', terms: [] }], /검색어는 1~8개/);
  await bad([{ number: 1, key: 'C', terms: ['가/나'] }], /'\/' 없이/);
  await bad([{ number: 1, key: 'C', terms: ['가\t나'] }], /탭/);
  await bad([{ number: 1, key: 'C', terms: ['가'.repeat(81)] }], /80자/);
  await bad([{ number: 1, key: 'Cmaj7/G', terms: ['가'] }], /조는/);
  await bad([{ number: 1, key: 'C', terms: ['가'], links: ['not-a-uuid'] }], /형식이 아닙니다/);
  await bad([{ number: 1, key: 'C', terms: ['가'], links: [lyric.id], nots: [lyric.id] }], /연결과 아님/);
  await bad([{ number: 1, key: 'C', terms: ['가'], links: [lyric.id] }, { number: 2, key: 'C', terms: ['나'], links: [lyric.id] }], /한 곡에만 연결/);
  await bad([{ number: 1, key: 'C', terms: ['가'], links: [otherCategory.id] }], /연결할 수 없습니다/);
  await bad([{ number: 1, key: 'C', terms: ['가'], links: ['00000000-0000-4000-8000-000000000000'] }], /서버에 없는 문서/);
  // 미리 검사(dryRun)는 쓰지 않는다
  const check = await ok(await call('/songbook?dryRun=1', 'PUT', JSON.stringify({ songs: [{ number: 1, key: 'C', terms: ['가'], links: [otherCategory.id] }] })));
  assert.equal(check.errors.length, 1); assert.equal(check.documents[otherCategory.id].category, '예배순서');
  assert.equal((await ok(await call('/songbook'))).version, 0);

  // PUT 전체 교체
  state = await ok(await call('/songbook', 'PUT', JSON.stringify({ songs }), { 'If-Match': '"0"' }));
  assert.equal(state.version, 1); assert.deepEqual(state.songs.map(s => s.number), [7, 58]); assert.equal(state.documents[lyric.id].category, '가사찬양');
  assert.equal((await call('/songbook', 'PUT', JSON.stringify({ songs }), { 'If-Match': '"0"' })).status, 409, '옛 버전으로 쓰면 409');
  const response = await call('/songbook'); assert.equal(response.headers.get('ETag'), '"1"');
  await ok(await call('/songbook', 'GET', undefined, { 'If-None-Match': '"1"' }), 304);

  // PATCH: 곡 추가·수정·삭제, 연결·아님 고치기
  state = await ok(await call('/songbook', 'PATCH', JSON.stringify({ number: null, song: { number: 221, key: 'Bb', terms: ['셋째 합성 곡'] } }), { 'If-Match': '"1"' }));
  assert.equal(state.version, 2); assert.deepEqual(state.songs.map(s => s.number), [7, 58, 221]);
  assert.equal((await call('/songbook', 'PATCH', JSON.stringify({ number: 7, song: { number: 7, key: 'Am', terms: ['다른 합성 곡'], links: [lyric.id] } }), { 'If-Match': '"2"' })).status, 400, '다른 곡에 연결된 문서는 거부');
  assert.equal((await call('/songbook', 'PATCH', JSON.stringify({ number: 7, song: null }), { 'If-Match': '"1"' })).status, 409);
  state = await ok(await call('/songbook', 'PATCH', JSON.stringify({ number: 7, song: null }), { 'If-Match': '"2"' }));
  assert.deepEqual(state.songs.map(s => s.number), [58, 221]);
  state = await ok(await call('/songbook', 'PATCH', JSON.stringify({ number: 58, song: { ...state.songs[0], nots: [middle.id] } }), { 'If-Match': '"3"' }));
  assert.equal(state.version, 4); assert.equal(state.documents[middle.id].name, '새 합성 노래 하나 둘 셋');

  // 확인 필요 후보: 같은 곡의 사용 중 찬양 문서. 다른 카테고리·휴지통·다른 곡 연결·아님·5글자 미만 앞머리는 빼고
  const candidates = (await ok(await call('/songbook/candidates'))).candidates;
  assert.deepEqual(candidates['58'].map(d => d.id).sort(), [score.id, score2.id].sort());
  // 짝 찾기: 목록 밖 가사 문서의 같은 곡 악보찬양. 목록에 연결된 문서는 빼고
  const free = await create('목록밖 합성 찬양 노래', '가사찬양'), freeScore = await create('목록밖 합성 찬양 노래 (악보)', '악보찬양'), freeLong = await create('목록밖 합성 찬양 노래 둘째 줄', '악보찬양');
  await create('목록밖 합', '악보찬양'); await create('목록밖 합성 찬양 노래 순서', '예배순서');
  const pairs = (await ok(await call('/songbook/pairs?ids=' + [free.id, lyric.id].join(',')))).pairs;
  assert.deepEqual(pairs[free.id].map(d => d.id).sort(), [freeScore.id, freeLong.id].sort());
  assert.ok(!pairs[lyric.id].some(d => d.id === linkedElsewhere.id || d.id === trashed.id));
  // 악보 행은 같은 곡의 가사를 찾는다(순서 항목 메뉴의 '가사로 바꾸기')
  const reverse = (await ok(await call('/songbook/pairs?ids=' + freeScore.id))).pairs;
  assert.deepEqual(reverse[freeScore.id].map(d => [d.id, d.category]), [[free.id, '가사찬양']]);
  assert.deepEqual((await ok(await call('/songbook/pairs?ids=' + otherCategory.id))).pairs, {}, '찬양이 아닌 문서는 짝을 찾지 않는다');
  assert.equal((await call('/songbook/pairs?ids=nope')).status, 400);

  // '가사로 쓰는 곡': 관리자가 아니어도 지정·해제, 가사찬양만, 곡 목록 전체 교체(PUT) 뒤에도 남는다.
  const plainAdmin = admin; admin = '';
  const lyricsOnly = (id, on) => call('/songbook/lyrics-only', 'POST', JSON.stringify({ id, on }));
  let marked = await ok(await lyricsOnly(free.id, true));
  assert.deepEqual(marked.lyricsOnly, [free.id]);
  assert.equal((await lyricsOnly(freeScore.id, true)).status, 400, '악보찬양은 지정할 수 없다');
  assert.equal((await lyricsOnly('nope', true)).status, 400);
  assert.deepEqual((await ok(await call('/songbook'))).lyricsOnly, [free.id]);
  admin = plainAdmin;
  const kept = await ok(await call('/songbook'));
  await ok(await call('/songbook', 'PUT', JSON.stringify({ songs: kept.songs }), { 'If-Match': `"${kept.version}"` }));
  assert.deepEqual((await ok(await call('/songbook'))).lyricsOnly, [free.id], '목록 붙여넣기는 가사로 쓰는 곡을 지우지 않는다');
  admin = '';
  marked = await ok(await lyricsOnly(free.id, false));
  assert.deepEqual(marked.lyricsOnly, []);
  admin = plainAdmin;
  // 목록 밖 짝(groups): 누구나 묶고 뺀다. 가사·악보가 하나 이상씩, 목록 곡 문서·찬양 아닌 문서는 거부, 다른 짝의 문서는 옮긴다.
  admin = '';
  const group = body => call('/songbook/groups', 'POST', JSON.stringify(body));
  const freeTwo = await create('목록밖 둘째 합성 노래', '가사찬양');
  let grouped = await ok(await group({ add: [free.id, freeScore.id] }));
  assert.deepEqual(grouped.groups, [[free.id, freeScore.id]]); assert.equal(grouped.documents[freeScore.id].category, '악보찬양');
  const refused = async (body, pattern) => { const r = await group(body); assert.equal(r.status, 400); assert.match((await r.json()).message, pattern); };
  await refused({ add: [freeScore.id, freeLong.id] }, /가사찬양과 악보찬양/);
  await refused({ add: [lyric.id, freeLong.id] }, /목록 곡 문서/);
  await refused({ add: [otherCategory.id, freeLong.id] }, /찬양 아닌 문서/);
  await refused({ add: [free.id] }, /2~20개/);
  await refused({ add: [free.id, 'nope'] }, /형식이 아닙니다/);
  await refused({ add: [free.id, '00000000-0000-4000-8000-000000000000'] }, /없는 문서/);
  assert.equal((await call('/songbook/groups', 'POST', JSON.stringify({ add: [free.id, freeLong.id] }), { Origin: 'https://evil.test' })).status, 403);
  grouped = await ok(await group({ add: [free.id, freeLong.id] }));
  assert.deepEqual(grouped.groups, [[free.id, freeLong.id]], '옮겨서 악보만 남은 짝은 지운다');
  grouped = await ok(await group({ add: [freeTwo.id, freeScore.id] }));
  assert.deepEqual(grouped.groups, [[free.id, freeLong.id], [freeTwo.id, freeScore.id]]);
  let fetched = await ok(await call('/songbook'));
  assert.deepEqual(fetched.groups, grouped.groups); assert.equal(fetched.documents[freeTwo.id].name, '목록밖 둘째 합성 노래', 'GET은 짝 문서 정보도 준다');
  assert.deepEqual((await ok(await group({ remove: lyric.id }))).groups, grouped.groups, '짝에 없는 문서 빼기는 그대로');
  grouped = await ok(await group({ remove: freeScore.id }));
  assert.deepEqual(grouped.groups, [[free.id, freeLong.id]], '빼서 가사만 남은 짝은 지운다');
  await ok(await lyricsOnly(free.id, true)); await ok(await lyricsOnly(free.id, false));
  assert.deepEqual((await ok(await call('/songbook'))).groups, [[free.id, freeLong.id]], '예외 처리는 짝을 지우지 않는다');
  // 짝 붙여넣기(관리자 전체 교체): 미리 검사는 줄마다 오류를 돌려주고 쓰지 않는다.
  assert.equal((await call('/songbook/groups', 'PUT', JSON.stringify({ groups: [[free.id, freeLong.id]] }), { 'If-Match': `"${fetched.version}"` })).status, 403);
  admin = plainAdmin;
  const dry = await ok(await call('/songbook/groups?dryRun=1', 'PUT', JSON.stringify({ groups: [[free.id, freeLong.id], [freeTwo.id, freeScore.id, free.id], [lyric.id, score2.id], [otherCategory.id, freeScore.id], [freeTwo.id, '00000000-0000-4000-8000-000000000000']], labels: ['1줄', '2줄', '4줄', '5줄', '6줄'] })));
  const joined = dry.errors.join('\n');
  assert.match(joined, /2줄: 두 짝에 들어간 문서/); assert.match(joined, /4줄: 목록 곡 문서 ‘합성 노래 하나 둘 셋’\(영 58\)/); assert.match(joined, /5줄: 찬양 아닌 문서/); assert.match(joined, /6줄: 없는 문서/);
  assert.equal(dry.documents[freeTwo.id].category, '가사찬양');
  fetched = await ok(await call('/songbook'));
  assert.deepEqual(fetched.groups, [[free.id, freeLong.id]]);
  assert.equal((await call('/songbook/groups', 'PUT', JSON.stringify({ groups: [[free.id, freeScore.id]] }))).status, 428);
  assert.equal((await call('/songbook/groups', 'PUT', JSON.stringify({ groups: [[lyric.id, freeScore.id]] }), { 'If-Match': `"${fetched.version}"` })).status, 400);
  fetched = await ok(await call('/songbook/groups', 'PUT', JSON.stringify({ groups: [[free.id, freeScore.id, freeLong.id], [freeTwo.id, score2.id]] }), { 'If-Match': `"${fetched.version}"` }));
  assert.deepEqual(fetched.groups, [[free.id, freeScore.id, freeLong.id], [freeTwo.id, score2.id]]);
  // 목록 곡에 연결하면 그 문서는 짝에서 빠지고, 규칙에 맞지 않게 된 짝은 지운다. 목록 전체 교체는 짝을 그대로 둔다.
  const song221 = fetched.songs.find(s => s.number === 221);
  fetched = await ok(await call('/songbook', 'PATCH', JSON.stringify({ number: 221, song: { ...song221, links: [freeScore.id] } }), { 'If-Match': `"${fetched.version}"` }));
  assert.deepEqual(fetched.groups, [[free.id, freeLong.id], [freeTwo.id, score2.id]]);
  fetched = await ok(await call('/songbook', 'PUT', JSON.stringify({ songs: fetched.songs.map(s => s.number === 221 ? { ...s, links: [freeScore.id, freeTwo.id] } : s) }), { 'If-Match': `"${fetched.version}"` }));
  assert.deepEqual(fetched.groups, [[free.id, freeLong.id]], '가사가 목록 곡으로 간 짝은 지운다');
  assert.deepEqual((await ok(await call('/songbook'))).groups, [[free.id, freeLong.id]]);
  // 비용: 목록 GET 304는 1행, 전체 GET은 1행 + 연결 문서 수
  const measure = async headers => { const DB = measuredDB(db); await songbookRoute(new Request(origin + '/api/songbook', { headers }), { DB }, { author: 'fixture' }); return DB.metrics().reduce((n, q) => n + q.rowsRead, 0); };
  const latest = (await ok(await call('/songbook'))).version;
  assert.equal(await measure({ 'If-None-Match': `"${latest}"` }), 1);
  const last = await ok(await call('/songbook')), shown = Object.keys(last.documents).length;
  assert.equal(shown, 7, '연결·아님 문서 5 + 짝 문서 2');
  const full = await measure({}); assert.ok(full <= 1 + 2 * shown, String(full));
});
