(function () {
  'use strict';
  const P=window.PP6;
  const cache=new Map(),previews=new Map(),drawTokens=new WeakMap();let previewBytes=0,revision=0;
  function clearPreviews(){revision++;previews.clear();previewBytes=0;}
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
  // All previews and overflow checks share this layout, including mixed fonts.
  function layout(ctx,parsed,box,caps=false){
    const lines=[];let line={parts:[],width:0,height:0,ascent:0,descent:0,align:'left'};
    function end(){if(!line.height){const style=parsed.runs[0]?.style||parsed.emptyStyle;ctx.font=font(style);const m=ctx.measureText('한Ag');line.ascent=m.fontBoundingBoxAscent||style.size*.8;line.descent=m.fontBoundingBoxDescent||style.size*.2;line.height=Math.max(style.size*1.2,line.ascent+line.descent)+(style.leading||0);}lines.push(line);line={parts:[],width:0,height:0,ascent:0,descent:0,align:'left'};}
    for(const run of parsed.runs){const style=run.style;ctx.font=font(style);const metric=ctx.measureText('한Ag'),ascent=metric.fontBoundingBoxAscent||style.size*.8,descent=metric.fontBoundingBoxDescent||style.size*.2;
      for(const char of Array.from(caps?run.text.toUpperCase():run.text)){if(char==='\n'){end();continue;}const visible=char==='\t'?'    ':char;ctx.font=font(style);let part=line.parts.at(-1),same=part&&JSON.stringify(part.style)===JSON.stringify(style),width=ctx.measureText((same?part.text:'')+visible).width,increment=width-(same?part.width:0);
        if(line.width+increment>box.w&&line.parts.length){end();part=null;same=false;width=ctx.measureText(visible).width;increment=width;}
        if(same){part.text+=visible;part.width=width;}else line.parts.push({text:visible,width,style});line.width+=increment;line.align=style.align;line.ascent=Math.max(line.ascent,ascent);line.descent=Math.max(line.descent,descent);line.height=Math.max(line.height,Math.max(style.size*1.2,ascent+descent)+(style.leading||0));
      }
    }end();const total=lines.reduce((n,l)=>n+l.height,0),last=lines.at(-1)?.parts.at(-1)?.style||parsed.emptyStyle;return {lines,total,overflow:total-(last.leading||0)>box.h,wrapped:lines.map(l=>l.parts.map(p=>p.text).join('')).join('\n')};
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
    y=Math.max(0,y);
    if(P.attr(element,'drawingShadow')==='true'){ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=8;ctx.shadowOffsetY=3;}
    ctx.textBaseline='alphabetic';
    for(const row of lines) {
      let x=row.align==='center'?(box.w-row.width)/2:row.align==='right'?box.w-row.width:0;
      const baseline=y+(row.height-row.ascent-row.descent)/2+row.ascent;
      for(const c of row.parts) {ctx.font=font(c.style);ctx.fillStyle=c.style.color;ctx.fillText(c.text,x,baseline);if(c.style.underline)ctx.fillRect(x,baseline+Math.max(1,c.style.size*.08),c.width,Math.max(1,c.style.size/30));x+=c.width;}
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
        // scaleBehavior mapping is approximate until PP6 reference screenshots exist.
        const scale=P.attr(element,'scaleBehavior')==='0'?Math.min(box.w/result.width,box.h/result.height):Math.max(box.w/result.width,box.h/result.height);
        const w=result.width*scale,h=result.height*scale;
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
    if(drawTokens.get(canvas)!==token||revision!==currentRevision)return warnings;
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.getContext('2d').drawImage(buffer,0,0);
    if(key&&key.length<=65536)rememberPreview(key,buffer,warnings);return warnings;
  }
  window.PP6Render={draw,media,layout,clear:()=>{cache.clear();clearPreviews();}};
})();

