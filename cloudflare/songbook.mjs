import { HttpError, bodyJSON, json, method, sameOrigin } from './http.mjs';
import { requireAdmin } from './admin.mjs';
import { SONG_CATEGORIES, allKeys, documentKeys, matchQuery, sameSong, termKeys } from './song-key.mjs';

// 영광임하소서 목록: 곡마다 {number, key, terms, links, nots}. 작은 표 하나에 JSON 한 행(버전·저장자·저장 시각)으로 둔다.
// 읽기는 1행, 쓰기는 If-Match(버전)로 충돌을 막는다. 표는 처음 쓸 때 만든다(스키마 버전과 무관한 추가 표).
// 문서 id로 잇고, 목록은 자동으로 고치지 않는다(연결 문서가 휴지통·보관함이어도 그대로 둔다).
const ready = new WeakSet();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SONGS = 999, MAX_BODY = 512 * 1024, MAX_PAIR_IDS = 60;
// 요청마다 감싼 DB(measuredDB)가 새로 생기므로 원래 바인딩으로 기억한다.
async function table(db) {
  const raw = db.rawDB || db;
  if (ready.has(raw)) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS yebaeon_songbook (id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, data TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
  ready.add(raw);
}
async function current(db) {
  const row = await db.prepare('SELECT version,data,updated_by,updated_at FROM yebaeon_songbook WHERE id=1').first();
  return row ? { version: row.version, songs: JSON.parse(row.data), updatedBy: row.updated_by, updatedAt: row.updated_at } : { version: 0, songs: [], updatedBy: null, updatedAt: null };
}
const etag = version => `"${version}"`;
function baseVersion(request) {
  const match = request.headers.get('If-Match');
  if (!match || !/^"(0|[1-9][0-9]*)"$/.test(match)) throw new HttpError(428, 'version_required', '목록의 기준 버전이 필요합니다.');
  return Number(match.slice(1, -1));
}
const conflict = () => new HttpError(409, 'songbook_conflict', '다른 관리자가 먼저 목록을 바꿨습니다. 목록 창을 다시 열어 최신 목록에서 고쳐 주세요.');

// 곡 하나의 모양을 맞추고 틀린 곳을 모은다. label은 오류 문구 앞에 붙는다(예: '3행').
const CONTROL = /[\u0000-\u001f\u007f]/;
export function cleanSong(input, label = '') {
  const errors = [], at = text => errors.push((label ? label + ': ' : '') + text);
  const number = input?.number;
  if (!Number.isInteger(number) || number < 1 || number > 999) at('번호는 1~999입니다.');
  const key = typeof input?.key === 'string' ? input.key.normalize('NFC').trim() : '';
  if (input?.key != null && typeof input.key !== 'string') at('조를 확인해 주세요.');
  else if (key.length > 8 || CONTROL.test(key) || key.includes('/')) at('조는 8자 이내 짧은 글입니다(C, Am, Bb 등).');
  const terms = Array.isArray(input?.terms) ? input.terms.map(t => typeof t === 'string' ? t.normalize('NFC').trim() : null) : null;
  if (!terms || terms.length < 1 || terms.length > 8 || terms.some(t => t === null || !t)) at('검색어는 1~8개입니다.');
  else for (const t of terms) if (t.length > 80 || CONTROL.test(t) || t.includes('/')) { at(`검색어 ‘${t.slice(0, 20)}’: 80자 이내, 탭·제어문자·'/' 없이 적어 주세요.`); break; }
  const ids = name => {
    const list = input?.[name] == null ? [] : input[name];
    if (!Array.isArray(list) || list.some(x => typeof x !== 'string')) { at('문서 id 목록을 확인해 주세요.'); return []; }
    const clean = [...new Set(list.map(x => x.trim().toLowerCase()))];
    for (const x of clean) if (!UUID.test(x)) { at(`문서 id ‘${x.slice(0, 40)}’ 형식이 아닙니다.`); return []; }
    return clean;
  };
  const links = ids('links'), nots = ids('nots');
  const both = links.filter(x => nots.includes(x));
  if (both.length) at(`같은 문서가 연결과 아님에 함께 있습니다(${both[0]}).`);
  return { song: { number, key, terms: terms || [], links, nots }, errors };
}
// 목록 전체: 번호 고유, 한 문서는 한 곡에만 연결.
export function cleanSongs(input, labels = []) {
  if (!Array.isArray(input) || input.length > MAX_SONGS) return { songs: [], errors: [`곡은 ${MAX_SONGS}곡까지입니다.`] };
  const errors = [], songs = [], numbers = new Map(), owners = new Map();
  input.forEach((value, i) => {
    const label = labels[i] || `${i + 1}번째 곡`, { song, errors: own } = cleanSong(value, label);
    errors.push(...own); songs.push(song);
    if (numbers.has(song.number)) errors.push(`${label}: 번호 ${song.number}가 ${numbers.get(song.number)}와 겹칩니다.`); else numbers.set(song.number, label);
    for (const id of song.links) { if (owners.has(id)) errors.push(`${label}: 문서 ${id}가 ${owners.get(id)}에도 연결돼 있습니다. 한 문서는 한 곡에만 연결합니다.`); else owners.set(id, label); }
  });
  songs.sort((a, b) => a.number - b.number);
  return { songs, errors };
}
// 문서 정보(이름·카테고리·상태). id마다 기본 키 조회 1행.
async function documentsOf(db, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 500) {
    const rows = (await db.prepare('SELECT d.id,d.path,d.category,d.state FROM json_each(?) j JOIN yebaeon_documents d ON d.id=j.value').bind(JSON.stringify(ids.slice(i, i + 500))).all()).results;
    for (const r of rows) out[r.id] = { name: r.path.split('/').pop().replace(/\.pro6$/i, ''), path: r.path, category: r.category ?? null, state: r.state || 'active' };
  }
  return out;
}
const songIds = songs => [...new Set(songs.flatMap(s => [...s.links, ...s.nots]))];
// 서버 문서와 대조: 없는 id, 찬양이 아닌 카테고리의 연결.
function documentErrors(songs, docs, only = null) {
  const errors = [];
  for (const s of songs) {
    for (const id of s.links) { if (only && !only.has(id)) continue; const d = docs[id]; if (!d) errors.push(`${s.number}번: 서버에 없는 문서 id ${id}`); else if (!SONG_CATEGORIES.includes(d.category)) errors.push(`${s.number}번: ‘${d.name}’은 ${d.category || '카테고리 없음'} 문서라 연결할 수 없습니다(가사찬양·악보찬양만).`); }
    for (const id of s.nots) { if (only && !only.has(id)) continue; if (!docs[id]) errors.push(`${s.number}번: 서버에 없는 문서 id ${id}(아님)`); }
  }
  return errors;
}
function invalid(errors) {
  const shown = errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n… 외 ${errors.length - 5}건` : '');
  const error = new HttpError(400, 'invalid_songbook', shown);
  return error;
}
async function write(db, user, base, songs) {
  const now = new Date().toISOString(), data = JSON.stringify(songs), next = base + 1;
  const result = base === 0
    ? await db.prepare('INSERT OR IGNORE INTO yebaeon_songbook(id,version,data,updated_by,updated_at) VALUES (1,1,?,?,?)').bind(data, user.author, now).run()
    : await db.prepare('UPDATE yebaeon_songbook SET version=?,data=?,updated_by=?,updated_at=? WHERE id=1 AND version=?').bind(next, data, user.author, now, base).run();
  if (result.meta.changes !== 1) throw conflict();
  return { version: next, songs, updatedBy: user.author, updatedAt: now };
}

export async function songbookRoute(request, env, user, action) {
  const db = env.DB;
  await table(db);
  if (action === 'pairs') return pairsRoute(request, env);
  if (action === 'candidates') return candidatesRoute(request, env);
  if (action) throw new HttpError(404, 'not_found', '없는 요청입니다.');
  method(request, ['GET', 'PUT', 'PATCH']);
  if (request.method === 'GET') {
    // 버전이 같으면 304(1행 읽기). 다르면 목록과 연결 문서의 이름·카테고리·상태를 함께 준다.
    const state = await current(db);
    if (request.headers.get('If-None-Match') === etag(state.version)) return new Response(null, { status: 304, headers: { 'Cache-Control': 'no-store', ETag: etag(state.version) } });
    return json({ ...state, documents: await documentsOf(db, songIds(state.songs)) }, 200, { ETag: etag(state.version) });
  }
  sameOrigin(request);
  await requireAdmin(request, env, user);
  const body = await bodyJSON(request, MAX_BODY);
  if (request.method === 'PUT') {
    // 전체 교체(목록 붙여넣기). dryRun이면 쓰지 않고 검사 결과와 문서 정보만 돌려준다.
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    const { songs, errors } = cleanSongs(body?.songs, Array.isArray(body?.labels) ? body.labels.map(String) : []);
    const docs = errors.length && !dryRun ? {} : await documentsOf(db, songIds(songs));
    errors.push(...documentErrors(songs, docs));
    if (dryRun) return json({ errors, documents: docs });
    const base = baseVersion(request);
    if (errors.length) throw invalid(errors);
    const state = await write(db, user, base, songs);
    return json({ ...state, documents: docs }, 200, { ETag: etag(state.version) });
  }
  // PATCH: 곡 하나. {number: 지금 번호(새 곡이면 null), song: 바뀐 곡(지우면 null)}
  const base = baseVersion(request), state = await current(db);
  if (state.version !== base) throw conflict();
  const from = body?.number ?? null;
  if (from !== null && !state.songs.some(s => s.number === from)) throw new HttpError(404, 'not_found', `${from}번 곡이 목록에 없습니다.`);
  if (from === null && body?.song == null) throw new HttpError(400, 'invalid_songbook', '바꿀 곡을 확인해 주세요.');
  const before = state.songs.find(s => s.number === from);
  const rest = state.songs.filter(s => s.number !== from);
  const list = body?.song == null ? rest : [...rest, body.song];
  const { songs, errors } = cleanSongs(list, list.map(s => s === body?.song ? '고친 곡' : `${s.number}번`));
  // 새로 넣은 id만 서버 문서와 대조한다(이미 목록에 있던 id는 그대로 둔다).
  const changed = body?.song == null ? null : songs.find(s => s.number === body.song.number);
  const known = new Set(before ? [...before.links, ...before.nots] : []), added = changed ? [...changed.links, ...changed.nots].filter(id => !known.has(id)) : [];
  const docs = added.length && !errors.length ? await documentsOf(db, added) : {};
  if (changed && !errors.length) errors.push(...documentErrors([changed], docs, new Set(added)));
  if (errors.length) throw invalid(errors);
  const saved = await write(db, user, base, songs);
  return json({ ...saved, documents: docs }, 200, { ETag: etag(saved.version) });
}

// 이름 맞추기 질의: 열쇠들에 맞는 사용 중 찬양 문서. 행은 색인으로 찾은 것만 읽는다.
async function matches(db, keys, categories) {
  if (!keys.length) return [];
  const { sql, args } = matchQuery(keys, categories);
  return (await db.prepare(sql).bind(...args).all()).results;
}
const view = r => ({ id: r.id, name: r.path.split('/').pop().replace(/\.pro6$/i, ''), path: r.path, category: r.category });

// 목록 창의 '확인 필요': 곡마다 이름 맞추기 후보 중 이 곡의 연결·아님, 다른 곡 연결이 아닌 사용 중 찬양 문서.
async function candidatesRoute(request, env) {
  method(request, ['GET']);
  const db = env.DB, state = await current(db);
  const linked = new Set(state.songs.flatMap(s => s.links)), songKeys = state.songs.map(s => s.terms.map(termKeys));
  const rows = await matches(db, songKeys.flatMap(list => list.flatMap(allKeys)), SONG_CATEGORIES);
  const candidates = {};
  state.songs.forEach((song, i) => {
    const nots = new Set(song.nots), found = rows.filter(r => !linked.has(r.id) && !nots.has(r.id) && songKeys[i].some(k => sameSong(documentKeys(r.path), k)));
    if (found.length) candidates[song.number] = found.map(view);
  });
  return json({ version: state.version, candidates });
}

// 순서의 목록 밖 찬양 행: 같은 곡의 다른 버전(가사찬양 ↔ 악보찬양) 사용 중 문서. 목록의 어느 곡에든 연결된 문서는 뺀다.
async function pairsRoute(request, env) {
  method(request, ['GET']);
  const db = env.DB, ids = [...new Set((new URL(request.url).searchParams.get('ids') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))];
  if (ids.length > MAX_PAIR_IDS || ids.some(id => !UUID.test(id))) throw new HttpError(400, 'invalid_ids', '문서 id를 확인해 주세요.');
  if (!ids.length) return json({ pairs: {} });
  const state = await current(db), linked = new Set(state.songs.flatMap(s => s.links));
  const sources = (await db.prepare('SELECT d.id,d.path,d.category FROM json_each(?) j JOIN yebaeon_documents d ON d.id=j.value').bind(JSON.stringify(ids)).all()).results
    .filter(r => SONG_CATEGORIES.includes(r.category)).map(r => ({ id: r.id, keys: documentKeys(r.path), want: r.category === '가사찬양' ? '악보찬양' : '가사찬양' }));
  if (!sources.length) return json({ version: state.version, pairs: {} });
  const wanted = [...new Set(sources.map(s => s.want))];
  const rows = await matches(db, sources.flatMap(s => allKeys(s.keys)), wanted);
  const pairs = {};
  for (const s of sources) {
    const found = rows.filter(r => r.id !== s.id && r.category === s.want && !linked.has(r.id) && sameSong(documentKeys(r.path), s.keys));
    if (found.length) pairs[s.id] = found.map(view);
  }
  return json({ version: state.version, pairs });
}
