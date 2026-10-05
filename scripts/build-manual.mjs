// 사용설명서: docs/manual/NN-<id>.md 원문 하나에서 화면(/manual/), 페이지별 원문(/manual/<id>.md),
// 전체 한 파일(/manual/llms-full.txt)과 목록(/manual/llms.txt), 그림(/manual/img/)을 만든다.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const IMAGE = /^[a-z0-9-]+\.(png|webp|jpg)$/;
const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function parsePage(name, text) {
  const match = /^(\d+)-([a-z0-9-]+)\.md$/.exec(name);
  if (!match) throw new Error(`설명서 파일 이름은 NN-id.md여야 합니다: ${name}`);
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!front) throw new Error(`설명서 머리말(---)이 없습니다: ${name}`);
  const meta = Object.fromEntries(front[1].split('\n').map(line => /^(\w+):\s*(.*)$/.exec(line)).filter(Boolean).map(m => [m[1], m[2].trim()]));
  if (!meta.title || !meta.group) throw new Error(`설명서 title·group이 필요합니다: ${name}`);
  return { id: match[2], title: meta.title, group: meta.group, lede: meta.lede || '', admin: meta.admin === 'true', md: text.slice(front[0].length).trim() };
}

export const pageMarkdown = page => `# ${page.title}\n\n${page.lede ? `> ${page.lede}\n\n` : ''}${page.md}\n`;

export async function buildManual(sourceRoot, updated = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })) {
  const folder = join(sourceRoot, 'docs/manual');
  let names;
  try { names = (await readdir(folder)).filter(name => name.endsWith('.md')).sort(); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const pages = await Promise.all(names.map(async name => parsePage(name, await readFile(join(folder, name), 'utf8'))));
  if (new Set(pages.map(p => p.id)).size !== pages.length) throw new Error('설명서 id가 겹칩니다.');
  let images = [];
  try { images = (await readdir(join(folder, 'img'))).filter(name => IMAGE.test(name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const page of pages) {
    for (const [, src] of page.md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const image = /^img\/(.+)$/.exec(src)?.[1];
      if (!image || !images.includes(image)) throw new Error(`${page.id}: 그림이 없습니다 ${src}`);
    }
  }
  const blocks = pages.map(p => `<script type="text/markdown" data-id="${p.id}" data-group="${escapeAttr(p.group)}" data-title="${escapeAttr(p.title)}" data-lede="${escapeAttr(p.lede)}"${p.admin ? ' data-admin="1"' : ''}>\n${p.md.replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>예배온 사용설명서</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/manual.css">
<link rel="alternate" type="text/plain" href="llms-full.txt" title="설명서 전체(Markdown)"></head>
<body data-updated="${updated}">
<header class="top"><div class="top-in">
 <button class="tbtn menu-btn" id="menuBtn" aria-label="목차 열기">☰</button>
 <a class="brand" href="#${pages[0]?.id || ''}"><img src="/favicon.svg" width="28" height="28" alt="">예배온 <small>사용설명서</small></a>
 <button class="search" id="searchBtn" aria-label="설명서 검색">⌕ <span>설명서에서 찾기</span><kbd>Ctrl K</kbd></button>
 <button class="tbtn" id="bookBtn" title="A5 책자처럼 이어서 보기">책자 보기</button>
 <button class="tbtn" id="themeBtn" aria-label="밝기 바꾸기" title="밝기 바꾸기">◐</button>
</div></header>
<div class="shell"><nav class="side" id="side" aria-label="설명서 목차"></nav><main id="main"></main><aside class="toc" id="toc" aria-label="이 페이지에서"></aside></div>
<section class="book" id="book" aria-label="책자 보기"></section>
${blocks}
<script src="/manual.js"></script>
</body></html>
`;
  const full = `# 예배온 사용설명서\n\n기준일 ${updated}. 그림은 같은 폴더의 img/에 있습니다.\n\n` + pages.map(p => `## ${p.title}\n\n${p.lede ? `> ${p.lede}\n\n` : ''}${p.md.replace(/^(#{2,3}) /gm, '#$1 ')}\n`).join('\n---\n\n');
  const index = `# 예배온 사용설명서\n\n> 예배온 Studio(웹)와 교회 Mac의 Sync 2 사용법. 전체 한 파일: llms-full.txt\n\n` + [...new Set(pages.map(p => p.group))].map(g => `## ${g}\n\n` + pages.filter(p => p.group === g).map(p => `- [${p.title}](${p.id}.md): ${p.lede}`).join('\n')).join('\n\n') + '\n';
  return [
    ['manual/index.html', Buffer.from(html)],
    ['manual/llms-full.txt', Buffer.from(full)],
    ['manual/llms.txt', Buffer.from(index)],
    ...pages.map(p => [`manual/${p.id}.md`, Buffer.from(pageMarkdown(p))]),
    ...await Promise.all(images.map(async name => [`manual/img/${name}`, await readFile(join(folder, 'img', name))]))
  ];
}
