/* Preview-only aliases. Never rewrite the source RTF font names. */
(function () {
  'use strict';
  const entries=new Map(), exact=new Map();let catalog=[];
  function registerCatalog(fonts) { catalog=fonts;for(const f of fonts) { const family="YebaeFont-"+f.file.split(".")[0]; const face=new FontFace(family,`url(/resources/${f.file})`,{weight:String(f.weight)});document.fonts.add(face);exact.set(f.name.toLowerCase(),{family,label:f.name,weight:f.weight,note:"",key:family+":"+f.weight}); } entries.clear();notify(); }
  function resolve(style) {
    const name=String(style.font || ''); const installed=exact.get(name.toLowerCase()); if(installed&&!style.bold)return installed; if(installed&&style.bold){if(/bold|heavy|black|[a-z](?:EB|B)$/.test(name))return installed;const base=name.replace(/(?:regular|medium|light|book)(?=[_-]|$)/ig,'');const candidates=[base.replace(/([_-]?)(OTF)?$/i,'Bold$2'),name.replace(/(?:regular|medium|light|book)/ig,'Bold')];for(const candidate of candidates){const face=exact.get(candidate.toLowerCase());if(face)return face;}if(!/arita|nanumgothic|nanummyeongjo/i.test(name))return {...installed,weight:Math.max(700,installed.weight)};} const key=name.toLowerCase().replace(/[\s_-]/g,'');
    let family, label, weight=400, note='';
    if(key.startsWith('aritaburi') || key.startsWith('아리따부리')) {
      family='PP6 Arita Buri';label='아리따부리';weight=500;
      if(/hairline|thin/.test(key))weight=100;
      else if(/light/.test(key))weight=300;
      else if(/semibold/.test(key))weight=600;
      else if(/bold/.test(key))weight=700;
    } else if(key.startsWith('nanumgothic') || key.startsWith('나눔고딕')) {
      // Coding, Eco and Light are different designs, not aliases of this CDN face.
      if(/coding|eco|light/.test(key))return null;
      family='PP6 Nanum Gothic';label='나눔고딕';
    } else if(key.startsWith('nanummyeongjo') || key.startsWith('나눔명조')) {
      if(/eco/.test(key))return null;
      family='PP6 Nanum Myeongjo';label='나눔명조';
      if(/yethangul|옛한글/.test(key))note='옛한글판은 일반 나눔명조로 미리보기';
    } else return null;
    if(family!=='PP6 Arita Buri')weight=/extrabold/.test(key)?800:/bold/.test(key)?700:400;
    if(style.bold&&weight<600)weight=700;
    return {family,label,weight,note,key:family+':'+weight};
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
    return [...fonts.values()].filter(font=>entries.get(font.key).status!=='loaded').map(font=>`${font.label} 웹폰트를 불러오지 못해 설치된 글꼴 또는 대체 글꼴로 표시합니다`);
  }
  function css(style) {
    const font=resolve(style), ready=font && entries.get(font.key)?.status==='loaded';
    const family=ready?font.family:style.font;
    const weight=ready?font.weight:(style.bold?700:400);
    const fallback=font && font.family!=='PP6 Nanum Gothic'?'"Batang", serif':'"Malgun Gothic", sans-serif';
    return `${style.italic?'italic ':''}${weight} ${style.size}px ${JSON.stringify(family)}, ${fallback}`;
  }
  function descriptions(slide) {
    const lines=styles(slide).map(style=>{
      const font=resolve(style);
      if(!font)return `${style.font} · 웹폰트 미등록 · 설치 여부에 따라 대체 표시`;
      const status=entries.get(font.key)?.status || 'loading';
      const label=({loaded:'웹폰트 적용',loading:'웹폰트 불러오는 중',delayed:'연결 지연 · 대체 글꼴 사용',error:'연결 실패 · 대체 글꼴 사용'})[status];
      return `${font.label} ${font.weight} · ${label}${font.note?' · '+font.note:''}`;
    });
    return [...new Set(lines)];
  }
  function state(){return [...entries.values()].map(({family,weight,status})=>({family,weight,status}));}
  window.PP6Fonts={registerCatalog,resolve,ensure,css,descriptions,state,choices:()=>[...catalog,...['HairLine','Light','Medium','SemiBold','Bold'].map(n=>({name:'Arita-buri-'+n+'_OTF'}))]};
})();

