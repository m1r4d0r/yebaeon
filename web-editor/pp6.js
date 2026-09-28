/* Small, offline PP6 reader/editor. Unedited XML elements and RTF are retained. */
(function () {
  'use strict';
  const all = (node, selector) => Array.from(node.querySelectorAll(selector));
  const ivar = (node, tag, name) => Array.from(node.children).find(e => e.tagName === tag && e.getAttribute('rvXMLIvarName') === name);
  const attr = (node, key, fallback = '') => node.getAttribute(key) ?? fallback;
  const nfc = s => s.normalize('NFC');
  function basename(source) {
    let path = source;
    try { path = decodeURIComponent(path); } catch (_) { /* Retain malformed paths for diagnosis. */ }
    return nfc(path.replace(/\\/g, '/').split('/').pop() || '');
  }
  function uuid() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function rect(node) {
    const v = (ivar(node, 'RVRect3D', 'position')?.textContent || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    return {x:v[0] || 0, y:v[1] || 0, w:v[3] || 0, h:v[4] || 0};
  }
  function color(value, fallback = '#ffffff') {
    const v = value.trim().split(/\s+/).map(Number);
    return v.length >= 3 && v.every(Number.isFinite) ? `rgba(${v.slice(0,3).map(x=>Math.round(x*255)).join(',')},${v[3] ?? 1})` : fallback;
  }
  function groupAt(raw, start) {
    let depth = 0;
    for (let i=start;i<raw.length;i++) {
      if (raw[i] === '\\') { i++; continue; }
      if (raw[i] === '{') depth++;
      if (raw[i] === '}' && --depth === 0) return raw.slice(start, i+1);
    }
    return '';
  }
  function parseRTF(b64) {
    let raw;
    try { raw = atob(b64.trim()); } catch (_) { throw new Error('읽을 수 없는 RTF 텍스트가 있습니다.'); }
    const fonts = {};
    const fontStart = raw.indexOf('{\\fonttbl');
    const fontTable = fontStart < 0 ? '' : groupAt(raw, fontStart);
    for (const m of fontTable.matchAll(/\\f(\d+)((?:(?!\\f\d)[\s\S])*?);/g)) {
      fonts[m[1]] = m[2].replace(/\\[a-z]+-?\d*\s?/gi, '').replace(/[{}\r\n]/g, '').trim();
    }
    const colors = ['#ffffff'];
    const colorStart = raw.indexOf('{\\colortbl');
    const table = colorStart < 0 ? '' : groupAt(raw, colorStart);
    table.split(';').slice(1).forEach(part => {
      const rgb = ['red','green','blue'].map(k => Number(part.match(new RegExp('\\\\'+k+'(\\d+)'))?.[1] || 0));
      if (/\\red/.test(part)) colors.push(`rgb(${rgb.join(',')})`);
    });
    const defaults = {font:0, size:48, bold:false, italic:false, underline:false, color:1, align:'left', leading:0};
    let state = {...defaults, skip:false, uc:1, cp:1252};
    const stack = [], runs = [], warnings = new Set();
    let bytes = [], fallback = 0, lastStyle = null;
    function currentStyle() { return {font:fonts[state.font] || 'Arial', size:state.size, bold:state.bold, italic:state.italic,
      underline:state.underline, color:colors[state.color] || '#ffffff', align:state.align, leading:state.leading}; }
    function emit(text) {
      if (state.skip || !text) return;
      const style = currentStyle();
      const previous = runs[runs.length-1];
      if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text;
      else runs.push({text, style});
    }
    function flush() {
      if (!bytes.length) return;
      const encoding = ({949:'euc-kr', 1252:'windows-1252', 65001:'utf-8', 932:'shift_jis', 936:'gbk', 950:'big5'})[state.cp];
      if (!encoding) warnings.add(`문자 인코딩 ${state.cp} 근사 처리`);
      const decoded = new TextDecoder(encoding || 'windows-1252').decode(new Uint8Array(bytes));
      if (decoded.includes('\uFFFD')) warnings.add('해석하지 못한 문자가 있습니다');
      emit(decoded); bytes = [];
    }
    function byte(value) { if (fallback) fallback--; else bytes.push(value); }
    const destinations = new Set(['fonttbl','colortbl','expandedcolortbl','stylesheet','info','pict','object','header','footer','fldinst','listtable','listoverridetable']);
    for (let i=0; i<raw.length;) {
      const c=raw[i++];
      if (c==='{' || c==='}') {
        flush();
        if(c==='}' && !state.skip)lastStyle=currentStyle();
        if (c==='{') stack.push({...state}); else state=stack.pop() || state;
        continue;
      }
      if (c==='\r' || c==='\n') continue;
      if (c!=='\\') { byte(c.charCodeAt(0)); continue; }
      const next=raw[i];
      if (next==="'") { byte(parseInt(raw.slice(i+1,i+3),16)); i+=3; continue; }
      if ('\\{}'.includes(next)) { byte(next.charCodeAt(0)); i++; continue; }
      flush();
      if (next==='*') { state.skip=true; i++; continue; }
      if (next==='\n' || next==='\r') { emit('\n'); i++; if(next==='\r' && raw[i]==='\n')i++; continue; }
      if (next==='~' || next==='_') { if(fallback)fallback--; else emit(next==='~'?'\u00A0':'\u2011'); i++; continue; }
      const m=/^([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i));
      if (!m) { i++; continue; }
      i+=m[0].length;
      const word=m[1], value=m[2] === undefined ? 1 : Number(m[2]);
      if(destinations.has(word))state.skip=true;
      if(state.skip)continue;
      if(word==='ansicpg')state.cp=value;
      else if(word==='uc')state.uc=Math.max(0,value);
      else if(word==='u'){emit(String.fromCharCode((value+65536)%65536));fallback=state.uc;}
      else if(word==='f')state.font=value;
      else if(word==='fs')state.size=Math.max(1,value/2);
      else if(word==='b')state.bold=value!==0;
      else if(word==='i')state.italic=value!==0;
      else if(word==='ul')state.underline=value!==0;
      else if(word==='ulnone')state.underline=false;
      else if(word==='cf')state.color=value;
      else if(['ql','qc','qr','qj'].includes(word))state.align=({ql:'left',qc:'center',qr:'right',qj:'left'})[word];
      else if(word==='slleading')state.leading=value/20;
      else if(word==='pard'){state.align='left';state.leading=0;}
      else if(word==='plain')Object.assign(state,defaults);
      else if(word==='par' || word==='line')emit('\n');
      else if(word==='tab')emit('\t');
      else if(['emdash','endash','bullet','lquote','rquote','ldblquote','rdblquote'].includes(word))emit(({emdash:'—',endash:'–',bullet:'•',lquote:'‘',rquote:'’',ldblquote:'“',rdblquote:'”'})[word]);
    }
    flush();
    return {text:runs.map(r=>r.text).join(''), runs, emptyStyle:lastStyle || currentStyle(), fonts:Object.values(fonts), warnings:[...warnings]};
  }
  function escapeRTF(text) {
    let result='';
    for(let i=0;i<text.length;i++) {
      const c=text[i], code=text.charCodeAt(i);
      if(c==='\n')result+='\\line\n';
      else if(c==='\t')result+='\\tab ';
      else if('\\{}'.includes(c))result+='\\'+c;
      else if(code>126)result+='\\u'+(code>32767?code-65536:code)+'?';
      else if(code>=32)result+=c;
    }
    return result;
  }
  function textRTF(text, style) {
    const s=style || {font:'Arial',size:90,color:'#ffffff',align:'center',bold:false};
    const rgb=s.color.match(/\d+/g)?.slice(0,3) || [255,255,255];
    const raw=`{\\rtf1\\ansi\\ansicpg1252\\uc1\n{\\fonttbl\\f0\\fnil ${escapeRTF(s.font)};}\n{\\colortbl;\\red${rgb[0]}\\green${rgb[1]}\\blue${rgb[2]};}\n\\pard\\${({left:'ql',center:'qc',right:'qr'})[s.align] || 'ql'}\\slleading${Math.round((s.leading || 0)*20)}\\f0\\fs${Math.round(s.size*2)}\\cf1\\b${s.bold?1:0}\\i${s.italic?1:0}\\ul${s.underline?1:0} ${escapeRTF(text)}}`;
    return btoa(raw);
  }
  function textNode(element) { return element.querySelector('NSString[rvXMLIvarName="RTFData"]'); }
  function parse(xml, name) {
    if(/<!DOCTYPE/i.test(xml))throw new Error('DOCTYPE가 포함된 문서는 지원하지 않습니다.');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror') || doc.documentElement.tagName!=='RVPresentationDocument')throw new Error('올바른 PP6 .pro6 문서가 아닙니다.');
    const width=Number(attr(doc.documentElement,'width')), height=Number(attr(doc.documentElement,'height'));
    if(!(width>0 && height>0 && width<=16384 && height<=16384))throw new Error('지원하지 않는 슬라이드 크기입니다.');
    const model={doc,name,original:xml,width,height};
    const slides=all(doc,'RVDisplaySlide');
    if(!slides.length || slides.length>1000)throw new Error('슬라이드가 1~1,000개인 문서를 열어 주세요.');
    for(const t of all(doc,'RVTextElement'))parseRTF(textNode(t)?.textContent || '');
    return model;
  }
  function slides(model) { return all(model.doc,'RVSlideGrouping > array[rvXMLIvarName="slides"] > RVDisplaySlide'); }
  function textElements(slide) { return all(slide,'RVTextElement'); }
  function mediaElements(slide) { return all(slide,'RVImageElement, RVVideoElement'); }
  function setText(element,text) {
    const node=textNode(element);
    if(!node)throw new Error('텍스트 데이터가 없는 상자입니다.');
    const original=parseRTF(node.textContent);
    if(original.text===text)return;
    node.textContent=textRTF(text,original.runs.find(r=>r.text.trim())?.style || original.runs[0]?.style || original.emptyStyle);
  }
  function refreshIDs(node) {
    const map=new Map();
    for(const e of [node,...all(node,'*')]) for(const key of ['UUID','uuid']) {
      if(e.hasAttribute(key)) { const old=attr(e,key), value=uuid();map.set(old,value);e.setAttribute(key,value); }
    }
    for(const e of [node,...all(node,'*')])for(const a of Array.from(e.attributes))if(map.has(a.value))e.setAttribute(a.name,map.get(a.value));
  }
  function duplicate(slide, blank=false) {
    const copy=slide.cloneNode(true);refreshIDs(copy);
    // New slides must not repeat side-effect cues such as audio, timers or commands.
    const cues=ivar(copy,'array','cues');if(cues)cues.replaceChildren();
    for(const key of ['hotKey','notes','chordChartPath'])copy.setAttribute(key,'');
    copy.setAttribute('label',blank?'새 슬라이드':(attr(slide,'label')?attr(slide,'label')+' 복사':''));
    if(blank) {
      for(const element of textElements(copy))setText(element,'');
      if(!textElements(copy).length)throw new Error('텍스트 상자가 있는 슬라이드를 선택해 새 슬라이드를 추가해 주세요.');
    }
    slide.parentNode.insertBefore(copy,slide.nextSibling);return copy;
  }
  function serialize(model) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(model.doc.documentElement);
  }
  window.PP6={all,ivar,attr,nfc,basename,uuid,rect,color,parseRTF,textRTF,textNode,parse,slides,textElements,mediaElements,setText,duplicate,serialize};
})();
