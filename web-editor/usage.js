(function () {
  'use strict';
  const cache = new Map(), queue = []; let active = 0;
  const format = value => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
  function drain() {
    while (active < 4 && queue.length) {
      const job = queue.shift(); active++;
      job().finally(() => { active--; drain(); });
    }
  }
  function read(doc) {
    const key = doc.id + ':' + doc.version;
    if (!cache.has(key)) {
      cache.set(key, new Promise((resolve, reject) => {
        queue.push(async () => {
          try {
            const r = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/usage?version=${doc.version}`, { credentials: 'same-origin', cache: 'no-store' });
            if (!r.ok) throw new Error('최근 사용일 조회 실패');
            resolve(await r.json());
          } catch (error) { cache.delete(key); reject(error); }
        });
      }));
      drain();
    }
    return cache.get(key);
  }
  window.YebaeonUsage = {
    show(element, doc, label = true) {
      const prefix = label ? '최근 사용일 (PP6) · ' : '';
      element.textContent = prefix + '확인 중…';
      element.title = 'ProPresenter 문서의 lastDateUsed · 한국시간. 서버 저장 시각과 별개입니다.';
      const source = Object.prototype.hasOwnProperty.call(doc, 'lastDateUsed') ? (doc.usageError ? read(doc) : Promise.resolve(doc)) : read(doc);
      source.then(data => {
        if (element.isConnected) element.textContent = prefix + (data.lastDateUsed ? format(data.lastDateUsed) : '기록 없음');
      }).catch(() => {
        if (element.isConnected) element.textContent = prefix + '확인 실패 · 목록 새로고침';
      });
    }
  };
})();
