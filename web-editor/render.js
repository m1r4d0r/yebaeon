(function () {
  'use strict';
  const P=window.PP6;
  const cache=new Map(),previews=new Map(),layouts=new Map(),drawTokens=new WeakMap();let previewBytes=0,layoutBytes=0,revision=0;
  function clearPreviews(){revision++;previews.clear();layouts.clear();previewBytes=0;layoutBytes=0;}
  window.addEventListener('pp6fontschange',clearPreviews);
  window.addEventListener('yebaeonresourcesready',clearPreviews);
  function rememberPreview(key,canvas,warnings){const bytes=canvas.width*canvas.height*4;if(bytes>4*1024*1024)return;const previous=previews.get(key);if(previous)previewBytes-=previous.bytes;previews.delete(key);const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);previews.set(key,{image:copy,warnings,bytes});previewBytes+=bytes;while(previewBytes>32*1024*1024||previews.size>256){const first=previews.keys().next().value;previewBytes-=previews.get(first).bytes;previews.delete(first);}}
  function media(file,kind) {
    if(cache.has(file))return cache.get(file);
    const promise=new Promise(resolve=>{
      const url=URL.createObjectURL(file), el=document.createElement(kind==='RVVideoElement'?'video':'img');
      let finished=false;
      const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);URL.revokeObjectURL(url);if(el.tagName==='VIDEO'){el.pause();el.removeAttribute('src');el.load();}resolve(result);};
      const timer=setTimeout(()=>finish(null),8000);
      el.onerror=()=>finish(null);
      if(el.tagName==='VIDEO') {
        el.muted=true;el.preload='auto';
        const capture=()=>{if(!el.videoWidth)return finish(null);const canvas=document.createElement('canvas');canvas.width=el.videoWidth;canvas.height=el.videoHeight;canvas.getContext('2d').drawImage(el,0,0);finish({image:canvas,width:canvas.width,height:canvas.height,duration:el.duration});};
        el.onloadeddata=()=>{if(el.duration>0.1)el.currentTime=Math.min(.5,el.duration/2);else capture();};
        el.onseeked=capture;
      } else el.onload=()=>finish({image:el,width:el.naturalWidth,height:el.naturalHeight});
      el.src=url;
    });cache.set(file,promise);while(cache.size>24)cache.delete(cache.keys().next().value);return promise;
  }
  function font(style) {return PP6Fonts.css(style);}
  // A layout is independent of preview pixels; editor, grid and overflow share it.
  function configure(ctx,style){ctx.font=font(style);if('fontKerning' in ctx)ctx.fontKerning=style.kerning===0?'none':'auto';if('letterSpacing' in ctx)ctx.letterSpacing=(style.tracking||0)+'px';}
  function measure(ctx,value,style){configure(ctx,style);return ctx.measureText(value).width+('letterSpacing' in ctx?0:Math.max(0,Array.from(value).length-1)*(style.tracking||0));}
  function layout(ctx,parsed,box,caps=false){
    const key=JSON.stringify([revision,box.w,caps,parsed.runs,parsed.emptyStyle]);
    if(layouts.has(key)){const hit=layouts.get(key);layouts.delete(key);layouts.set(key,hit);return {...hit.result,overflow:hit.result.total>box.h};}
    const lines=[];let line={parts:[],width:0,height:0,ascent:0,descent:0,leading:0,align:'left'};
    const fontMetrics=new Map();function metrics(style){const key=font(style);if(fontMetrics.has(key))return fontMetrics.get(key);configure(ctx,style);const m=ctx.measureText('한Ag');const value=PP6Fonts.metrics?.(style)||{ascent:m.fontBoundingBoxAscent||style.size*.8,descent:m.fontBoundingBoxDescent||style.size*.2,lineGap:0};fontMetrics.set(key,value);return value;}
    function include(style){const m=metrics(style);line.ascent=Math.max(line.ascent,m.ascent);line.descent=Math.max(line.descent,m.descent);// Native PP6 reference keeps the natural line fragment when Cocoa spacing is negative.
      line.leading=Math.max(0,style.leading||0);line.height=Math.max(1,line.ascent+line.descent+line.leading);line.align=style.align;}
    function end(style){if(!line.height)include(style||parsed.emptyStyle);lines.push(line);line={parts:[],width:0,height:0,ascent:0,descent:0,leading:0,align:'left'};}
    for(const run of parsed.runs){const style=run.style,signature=JSON.stringify(style);include(style);
      for(const char of Array.from(caps?run.text.toUpperCase():run.text)){if(char==='\n'){end(style);continue;}const visible=char==='\t'?'    ':char;
        let part=line.parts.at(-1),same=part&&part.signature===signature,width=measure(ctx,(same?part.text:'')+visible,style),increment=width-(same?part.width:0);
        if(line.width+increment>box.w&&line.parts.length){end(style);part=null;same=false;width=measure(ctx,visible,style);increment=width;}
        if(same){part.text+=visible;part.width=width;}else line.parts.push({text:visible,width,style,signature});line.width+=increment;include(style);
      }
    }end(parsed.runs.at(-1)?.style);const total=Math.max(0,lines.reduce((n,l)=>n+l.height,0)-(lines.at(-1)?.leading||0));
    const result={lines,total,wrapped:lines.map(l=>l.parts.map(p=>p.text).join('')).join('\n')};
    for(const row of lines){row.parts.forEach(Object.freeze);Object.freeze(row.parts);Object.freeze(row);}Object.freeze(lines);Object.freeze(result);
    const bytes=key.length*2+parsed.runs.reduce((n,r)=>n+r.text.length,0)*4+lines.length*256;if(bytes<=262144){layouts.set(key,{result,bytes});layoutBytes+=bytes;while(layoutBytes>4*1024*1024||layouts.size>256){const first=layouts.keys().next().value;layoutBytes-=layouts.get(first).bytes;layouts.delete(first);}}
    return {...result,overflow:total>box.h};
  }
  function paintRun(ctx,part,x,y){const s=part.style;configure(ctx,s);ctx.fillStyle=s.color;ctx.strokeStyle=s.strokeColor||'#000000';ctx.lineWidth=Math.abs(s.strokeWidth||0)*s.size/100;ctx.lineJoin='round';
    const draw=(value,at)=>{if(s.strokeWidth)ctx.strokeText(value,at,y);if(!(s.strokeWidth>0))ctx.fillText(value,at,y);};
    if(!('letterSpacing' in ctx)&&s.tracking){let at=x;for(const char of Array.from(part.text)){draw(char,at);at+=ctx.measureText(char).width+s.tracking;}}else draw(part.text,x);
    if(s.underline)ctx.fillRect(x,y+Math.max(1,s.size*.08),part.width,Math.max(1,s.size/30));
  }
  function fit(canvas,model,fallback=400){const cssWidth=canvas.getBoundingClientRect().width||fallback,dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));
    // Use screen pixels, capped at the actual document resolution and 4M pixels.
    const width=Math.max(1,Math.round(Math.min(model.width,cssWidth*dpr,Math.sqrt(4194304*model.width/model.height)))),height=Math.max(1,Math.round(width*model.height/model.width));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;return true;}return false;
  }
  function text(ctx, element, warnings) {
    const parsed=P.parseRTF(P.textNode(element)?.textContent || ''), box=P.rect(element);
    warnings.push(...parsed.warnings);
    if(!box.w || !box.h)return;
    const result=layout(ctx,parsed,box,P.attr(element,'useAllCaps')==='true'),{lines,total}=result;
    if(result.overflow)warnings.push('텍스트가 상자 높이를 넘습니다');
    ctx.save();ctx.translate(box.x+box.w/2,box.y+box.h/2);ctx.rotate(Number(P.attr(element,'rotation','0'))*Math.PI/180);ctx.translate(-box.w/2,-box.h/2);
    ctx.beginPath();ctx.rect(0,0,box.w,box.h);ctx.clip();
    ctx.globalAlpha=Math.max(0,Math.min(1,Number(P.attr(element,'opacity','1'))));
    if(P.attr(element,'drawingFill')==='true'){ctx.fillStyle=P.color(P.attr(element,'fillColor'));ctx.fillRect(0,0,box.w,box.h);}
    // PP6 alignment and text metrics still need native visual comparison.
    const vertical=P.attr(element,'verticalAlignment','0');
    let y=vertical==='1'?0:vertical==='2'?box.h-total:(box.h-total)/2;
    // Keep the text block anchored to the box center/bottom even on overflow.
    // Clipping still happens at the original box; never rewrite its geometry.
    if(P.attr(element,'drawingShadow')==='true'){const source=P.ivar(element,'shadow','shadow')?.textContent||'',parts=source.split('|'),offset=parts[2]?.match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[0,0];ctx.shadowColor=P.color(parts[1]||'0 0 0 .333333');ctx.shadowBlur=Math.max(0,Number(parts[0])||0);ctx.shadowOffsetX=offset[0]||0;ctx.shadowOffsetY=-(offset[1]||0);}
    ctx.textBaseline='alphabetic';
    for(const row of lines) {
      let x=row.align==='center'?(box.w-row.width)/2:row.align==='right'?box.w-row.width:0;
      const baseline=y+row.ascent;
      for(const c of row.parts) {paintRun(ctx,c,x,baseline);x+=c.width;}
      y+=row.height;
    }ctx.restore();
  }
  async function drawFresh(canvas,model,slide,library) {
    const warnings=await PP6Fonts.ensure(slide);
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(canvas.width/model.width,canvas.height/model.height);
    ctx.fillStyle='#101216';ctx.fillRect(0,0,model.width,model.height);
    if(P.attr(slide,'drawingBackgroundColor')==='true'){ctx.fillStyle=P.color(P.attr(slide,'backgroundColor'),'#101216');ctx.fillRect(0,0,model.width,model.height);}
    const bg=P.ivar(slide,'RVMediaCue','backgroundMediaCue');
    // PP6 fixture stores frontmost text before the full-slide image behind it.
    const elements=[...(bg?P.mediaElements(bg):[]),...Array.from(P.ivar(slide,'array','displayElements')?.children || []).reverse()];
    for(const element of elements) {
      if(element.tagName==='RVTextElement'){text(ctx,element,warnings);continue;}
      if(!['RVImageElement','RVVideoElement'].includes(element.tagName)){warnings.push(`미지원 요소: ${element.tagName}`);continue;}
      const isBackground=element.parentNode===bg, name=P.basename(P.attr(element,'source'));
      const box=isBackground?{x:0,y:0,w:model.width,h:model.height}:P.rect(element);
      if(!box.w || !box.h)continue;
      const files=library.get(name) || [];
      if(!files.length && window.YebaeonResources) {const file=await window.YebaeonResources.media(P.attr(element,"source"));if(file)files.push(file);}
      const result=files.length===1?await media(files[0],element.tagName):null;
      ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
      if(!result) {
        const reason=files.length>1?'같은 이름의 파일이 여러 개':files.length===1?'브라우저에서 열 수 없는 미디어':'미디어 연결 필요';warnings.push(`${reason}: ${name}`);
        ctx.fillStyle=isBackground?'#202a39':'rgba(37,49,65,.7)';ctx.fillRect(box.x,box.y,box.w,box.h);
        ctx.fillStyle='#99acc7';ctx.font='30px "Malgun Gothic", sans-serif';ctx.textBaseline='top';ctx.fillText(reason,box.x+25,box.y+25,Math.max(1,box.w-50));ctx.font='24px "Malgun Gothic", sans-serif';ctx.fillText(name,box.x+25,box.y+70,Math.max(1,box.w-50));
      } else {
        // scaleBehavior: 0=맞추기, 1=채우기, 3=늘이기(교회 PP6에서 확인). 뜻을 모르는 2는 채우기로 그린다.
        const behavior=P.attr(element,'scaleBehavior'),scale=behavior==='0'?Math.min(box.w/result.width,box.h/result.height):Math.max(box.w/result.width,box.h/result.height);
        const w=behavior==='3'?box.w:result.width*scale,h=behavior==='3'?box.h:result.height*scale;
        ctx.globalAlpha=Math.max(0,Math.min(1,Number(P.attr(element,'opacity','1'))));
        ctx.translate(box.x+box.w/2,box.y+box.h/2);ctx.rotate(Number(P.attr(element,'rotation','0'))*Math.PI/180);
        ctx.scale(P.attr(element,'flippedHorizontally')==='true'?-1:1,P.attr(element,'flippedVertically')==='true'?-1:1);
        ctx.drawImage(result.image,-w/2,-h/2,w,h);
      }ctx.restore();
    }
    ctx.restore();return [...new Set(warnings)];
  }
  async function draw(canvas,model,slide,library){
    const token={};drawTokens.set(canvas,token);const currentRevision=revision;
    const key=library.size?null:JSON.stringify([revision,model.width,model.height,canvas.width,canvas.height,new XMLSerializer().serializeToString(slide)]);
    const hit=key&&previews.get(key);
    if(hit){previews.delete(key);previews.set(key,hit);canvas.getContext('2d').drawImage(hit.image,0,0);return [...hit.warnings];}
    // Paint atomically, so an older async draw cannot overwrite a newer edit.
    const buffer=document.createElement('canvas');buffer.width=canvas.width;buffer.height=canvas.height;
    const warnings=await drawFresh(buffer,model,slide,library);
    if(drawTokens.get(canvas)!==token)return warnings;
    if(revision!==currentRevision)return draw(canvas,model,slide,library);
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.getContext('2d').drawImage(buffer,0,0);
    if(key&&key.length<=65536)rememberPreview(key,buffer,warnings);return warnings;
  }
  window.PP6Render={draw,media,layout,fit,clear:()=>{cache.clear();clearPreviews();}};
})();



