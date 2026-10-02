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
  function text(ctx, element, warnings) {
    const parsed=P.parseRTF(P.textNode(element)?.textContent || ''), box=P.rect(element);
    warnings.push(...parsed.warnings);
    if(!box.w || !box.h)return;
    const lines=[];let line={chars:[],width:0,height:0,align:'left'};
    function end(){if(!line.height)line.height=(parsed.runs[0]?.style.size || 48)*1.2;lines.push(line);line={chars:[],width:0,height:0,align:'left'};}
    for(const run of parsed.runs) {
      const value=P.attr(element,'useAllCaps')==='true'?run.text.toUpperCase():run.text;
      for(const char of Array.from(value)) {
        if(char==='\n'){end();continue;}
        ctx.font=font(run.style);const visible=char==='\t'?'    ':char,w=ctx.measureText(visible).width;
        if(line.width+w>box.w && line.chars.length)end();
        line.align=run.style.align;line.chars.push({text:visible,width:w,style:run.style});line.width+=w;
        line.height=Math.max(line.height,run.style.size*1.2+run.style.leading);
      }
    }end();
    const total=lines.reduce((s,l)=>s+l.height,0);
    const finalStyle=lines[lines.length-1]?.chars.at(-1)?.style;
    const inkHeight=total-(finalStyle?.leading || 0);
    if(inkHeight>box.h)warnings.push('텍스트가 상자 높이를 넘습니다');
    ctx.save();ctx.translate(box.x+box.w/2,box.y+box.h/2);ctx.rotate(Number(P.attr(element,'rotation','0'))*Math.PI/180);ctx.translate(-box.w/2,-box.h/2);
    ctx.beginPath();ctx.rect(0,0,box.w,box.h);ctx.clip();
    ctx.globalAlpha=Math.max(0,Math.min(1,Number(P.attr(element,'opacity','1'))));
    if(P.attr(element,'drawingFill')==='true'){ctx.fillStyle=P.color(P.attr(element,'fillColor'));ctx.fillRect(0,0,box.w,box.h);}
    // PP6 alignment and text metrics still need native visual comparison.
    const vertical=P.attr(element,'verticalAlignment','0');
    let y=vertical==='1'?0:vertical==='2'?box.h-total:(box.h-total)/2;
    y=Math.max(0,y);
    if(P.attr(element,'drawingShadow')==='true'){ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=8;ctx.shadowOffsetY=3;}
    ctx.textBaseline='middle';
    for(const row of lines) {
      let x=row.align==='center'?(box.w-row.width)/2:row.align==='right'?box.w-row.width:0;
      for(const c of row.chars) {ctx.font=font(c.style);ctx.fillStyle=c.style.color;ctx.fillText(c.text,x,y+row.height/2);if(c.style.underline){ctx.fillRect(x,y+row.height*.8,c.width,Math.max(1,c.style.size/30));}x+=c.width;}
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
  window.PP6Render={draw,media,clear:()=>{cache.clear();clearPreviews();}};
})();
