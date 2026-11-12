// 이름 맞추기: 문서 이름과 영광임하소서 목록의 검색어가 같은 곡인지 본다.
// 열쇠는 NFC → 소문자 → 숫자·영문·한글만 남긴 글이다. 괄호 안은 따로 떼어 보조 열쇠로 쓴다.
// 같은 곡: 열쇠가 같거나, 한쪽이 다른 쪽으로 시작하고 짧은 쪽이 5글자 이상일 때. 가운데 포함은 보지 않는다.
export const MIN_PREFIX = 5;
export const SONG_CATEGORIES = Object.freeze(['가사찬양', '악보찬양']);
export const normalizeKey = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣]/g, '');
const BRACKETS = /[(（\[]([^()（）\[\]]*)[)）\]]/g;
function split(value) {
  const aux = [];
  const main = String(value ?? '').normalize('NFC').replace(BRACKETS, (_, inner) => { aux.push(inner); return ' '; });
  return { main, aux };
}
const unique = keys => [...new Set(keys.filter(Boolean))];
// 문서 이름: 폴더와 .pro6를 빼고, 앞의 번호 앞붙이(038 , 영122_)와 뒤의 _Wide·PPT·피피티·copy·-숫자·끝 숫자를 반복해서 뺀다.
export function documentKeys(path) {
  const name = String(path ?? '').split('/').pop().replace(/\.pro6$/i, '');
  const { main, aux } = split(name);
  let text = main.trim(), before;
  do { before = text; text = text.replace(/^영\s*\d{1,3}[\s_.-]*/, '').replace(/^\d{1,3}[\s_.-]+/, '').trim(); } while (text !== before);
  do { before = text; text = text.replace(/(?:[\s_-]+wide|[\s_-]*ppt|[\s_-]*피피티|[\s_-]*copy|-\d+|\d+)$/i, '').replace(/[\s_.-]+$/, ''); } while (text !== before);
  return { main: normalizeKey(text), aux: unique(aux.map(normalizeKey)) };
}
// 검색어: 괄호 밖이 본 열쇠, 괄호 안은 보조 열쇠.
export function termKeys(term) {
  const { main, aux } = split(term);
  return { main: normalizeKey(main), aux: unique(aux.map(normalizeKey)) };
}
export const allKeys = keys => unique([keys.main, ...keys.aux]);
export function sameKey(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_PREFIX && long.startsWith(short);
}
export const sameSong = (left, right) => allKeys(left).some(a => allKeys(right).some(b => sameKey(a, b)));

// 색인한 문서 본 열쇠(song_key)로 짝을 찾는다. 같음은 등호, '내가 앞머리'는 범위, '남이 앞머리'는 내 열쇠의 5글자 이상 앞머리들을 IN으로.
// 표 전체를 훑지 않는다(EXPLAIN QUERY PLAN: yebaeon_documents_song_key 색인 검색).
export function matchQuery(keys, categories = SONG_CATEGORIES) {
  const list = unique(keys), ranges = list.filter(k => k.length >= MIN_PREFIX), exact = new Set(list);
  for (const k of ranges) for (let n = MIN_PREFIX; n < k.length; n++) exact.add(k.slice(0, n));
  const marks = categories.map(() => '?').join(',');
  const columns = 'd.id,d.path,d.category,d.state,d.song_key AS songKey';
  const sql = `SELECT ${columns} FROM json_each(?) r JOIN yebaeon_documents d INDEXED BY yebaeon_documents_song_key ON d.song_key>=r.value AND d.song_key<r.value||char(1114111) WHERE d.state='active' AND d.category IN (${marks})
    UNION SELECT ${columns} FROM yebaeon_documents d INDEXED BY yebaeon_documents_song_key WHERE d.song_key IN (SELECT value FROM json_each(?)) AND d.state='active' AND d.category IN (${marks})`;
  return { sql, args: [JSON.stringify(ranges), ...categories, JSON.stringify([...exact]), ...categories] };
}

// 문서 표의 song_key 열과 색인. 새 문서·이름 바꾸기 때 채우고, 이전부터 있던 문서는 이전 작업에서 한 번만 채운다.
export async function migrateSongKey(db) {
  if (await db.prepare("SELECT name FROM yebaeon_schema_migrations WHERE name='song-key-v1'").first()) return;
  const columns = new Set((await db.prepare('PRAGMA table_info(yebaeon_documents)').all()).results.map(r => r.name));
  if (!columns.has('song_key')) await db.prepare('ALTER TABLE yebaeon_documents ADD COLUMN song_key TEXT').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS yebaeon_documents_song_key ON yebaeon_documents(song_key)').run();
  await fillSongKeys(db);
  await db.prepare("INSERT OR IGNORE INTO yebaeon_schema_migrations(name) VALUES ('song-key-v1')").run();
}
// 비어 있는 song_key를 한 번 채운다. 문서 표를 한 번 읽고, 문서마다 기본 키로 한 줄씩 쓴다(200문장씩 묶음).
// json_each와 엮은 한 문장 UPDATE는 SQLite가 문서 표를 거듭 훑으므로(행 읽기가 문서 수의 제곱) 쓰지 않는다.
export async function fillSongKeys(db, chunk = 200) {
  const rows = (await db.prepare('SELECT id,path FROM yebaeon_documents WHERE song_key IS NULL').all()).results;
  for (let i = 0; i < rows.length; i += chunk) {
    await db.batch(rows.slice(i, i + chunk).map(r => db.prepare('UPDATE yebaeon_documents SET song_key=? WHERE id=? AND song_key IS NULL').bind(documentKeys(r.path).main, r.id)));
  }
  return rows.length;
}
