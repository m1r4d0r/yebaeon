/* Preview-only aliases. Never rewrite the source RTF font names. */
(function () {
  'use strict';
  const entries=new Map(), exact=new Map();let catalog=[];
  function registerCatalog(fonts) { catalog=fonts;exact.clear();for(const f of fonts) { const family="YebaeFont-"+f.file.replace(/[^a-z0-9]/gi,"-"); const face=new FontFace(family,`url(/resources/${f.file})`,{weight:String(f.weight)});document.fonts.add(face);exact.set(f.name.toLowerCase(),{family,label:f.name,weight:f.weight,metrics:f.metrics,note:"",key:family+":"+f.weight}); } entries.clear();notify(); }
  function resolve(style) {
    const name=String(style.font||''),installed=exact.get(name.toLowerCase());if(!installed)return null;
    if(!style.bold||/bold|heavy|black/i.test(name)||/[a-z](?:EB|B)$/.test(name))return installed;
    const base=name.replace(/(?:regular|medium|light|book)(?=[_-]|$)/ig,''),candidates=[name+'Bold',base.replace(/([_-]?)(OTF)?$/i,'Bold$2'),name.replace(/(?:regular|medium|light|book)/ig,'Bold')];
    for(const candidate of candidates){const face=exact.get(candidate.toLowerCase());if(face)return face;}
    // Keep the uploaded design when the actual Bold face is missing. Never fetch a CDN substitute.
    return {...installed,weight:700,key:installed.family+':700',note:'원본 Bold 파일 없음 · 브라우저 굵게 근사'};
  }
  function styles(slide) {
    return PP6.textElements(slide).flatMap(element=>{
      const parsed=PP6.parseRTF(PP6.textNode(element)?.textContent || '');
      return parsed.runs.length?parsed.runs.map(run=>run.style):[parsed.emptyStyle];
    });
  }
  function notify(){window.dispatchEvent(new Event('pp6fontschange'));}
  function start(font) {
    if(entries.has(font.key))return entries.get(font.key);
    const entry={...font,status:'loading',wait:null};entries.set(font.key,entry);
    // A bounded wait allows offline editing. Late successes trigger a canvas redraw.
    entry.wait=new Promise(done=>{
      const timer=setTimeout(()=>{entry.status='delayed';notify();done();},6000);
      Promise.resolve().then(()=>document.fonts.load(`${font.weight} 32px ${JSON.stringify(font.family)}`,'한글 ABC')).then(faces=>{
        if(!faces.length)throw new Error('Font face not registered');
        entry.status='loaded';
      }).catch(()=>{entry.status='error';}).finally(()=>{clearTimeout(timer);notify();done();});
    });
    return entry;
  }
  async function ensure(slide) {
    const fonts=new Map(styles(slide).map(resolve).filter(Boolean).map(font=>[font.key,font]));
    await Promise.all([...fonts.values()].map(font=>start(font).wait));
    const missing=styles(slide).filter(style=>!resolve(style)).map(style=>style.font+' · 원본 폰트 미등록 · 대체 표시');
    const warnings=[...fonts.values()].flatMap(font=>[...(entries.get(font.key).status!=='loaded'?[`${font.label} 서버 폰트를 불러오지 못해 설치된 글꼴 또는 대체 글꼴로 표시합니다`]:[]),...(font.note?[font.label+' · '+font.note]:[])]);
    return [...new Set([...missing,...warnings])];
  }
  function css(style) {
    const font=resolve(style), ready=font && entries.get(font.key)?.status==='loaded';
    const family=ready?font.family:style.font;
    const weight=ready?font.weight:(style.bold?700:400);
    const fallback=/arita|myeongjo|batang|times|georgia/i.test(style.font||'')?'"Batang", serif':'"Malgun Gothic", sans-serif';
    return `${style.italic?'italic ':''}${weight} ${style.size}px ${JSON.stringify(family)}, ${fallback}`;
  }
  function descriptions(slide) {
    const lines=styles(slide).map(style=>{
      const font=resolve(style);
      if(!font)return `${style.font} · 원본 폰트 미등록 · 설치 여부에 따라 대체 표시`;
      const status=entries.get(font.key)?.status || 'loading';
      const label=({loaded:'서버 폰트 적용',loading:'서버 폰트 불러오는 중',delayed:'연결 지연 · 대체 글꼴 사용',error:'연결 실패 · 대체 글꼴 사용'})[status];
      return `${font.label} ${font.weight} · ${label}${font.note?' · '+font.note:''}`;
    });
    return [...new Set(lines)];
  }
  function metrics(style){const m=resolve(style)?.metrics;if(!m)return null;const scale=style.size/m.unitsPerEm;return {ascent:m.ascent*scale,descent:m.descent*scale,lineGap:m.lineGap*scale};}
  function state(){return [...entries.values()].map(({family,weight,status})=>({family,weight,status}));}
  window.PP6Fonts={registerCatalog,resolve,ensure,css,descriptions,state,metrics,choices:()=>[...catalog]};
})();


