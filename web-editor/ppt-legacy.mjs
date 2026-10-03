import * as CFB from 'cfb';
import {readPptStreams} from 'ppt-codec/read';
import {readCurrentUserAtom} from 'ppt-codec/stream/current-user';
import {buildPersistDirectory,resolvePersistObject} from 'ppt-codec/stream/persist';
import {childRecords,findChild,findDescendants} from 'ppt-codec/record/tree';
import {readSlideListWithText} from 'ppt-codec/document/slide-list';
import {readShapeProperties} from 'ppt-codec/drawing/properties';
import {readDrawingShapes} from 'ppt-codec/drawing/shapes';
import {readBlipStore} from 'ppt-codec/drawing/blips';
const u32=(r,at)=>new DataView(r.data.buffer,r.data.byteOffset,r.data.byteLength).getUint32(at,true);
const rgb=n=>'#'+[n&255,(n>>>8)&255,(n>>>16)&255].map(n=>n.toString(16).padStart(2,'0')).join('');
export function legacy(bytes){
 const cfb=CFB.read(bytes,{type:'array'}),stream=name=>{const e=CFB.find(cfb,name);if(!e)throw Error('PPT 필수 스트림이 없습니다: '+name);return new Uint8Array(e.content);};
 const current=stream('Current User'),data=stream('PowerPoint Document'),cu=readCurrentUserAtom(current);
 if(cu.encrypted)throw Error('암호를 해제한 PPT 파일을 선택해 주세요.');
 const pictures=CFB.find(cfb,'Pictures'),pics=pictures?new Uint8Array(pictures.content):undefined;
 const {directory,currentEdit}=buildPersistDirectory(data,cu.offsetToCurrentEdit),resolve=id=>resolvePersistObject(data,directory,id,'presentation');
 const doc=resolve(currentEdit.docPersistIdRef),children=childRecords(doc),list=children.find(r=>r.header.recType===4080&&r.header.recInstance===0);
 const ordered=list?readSlideListWithText(list):[];
 if(!ordered.length||ordered.length>120)throw Error('PPT는 1~120장까지 가져올 수 있습니다.');
 const parsed=readPptStreams(current,data,undefined,pics),blips=readBlipStore(doc,pics);
 const deck={kind:'ppt',width:parsed.slides[0].size.widthPt,height:parsed.slides[0].size.heightPt,slides:[],warnings:['구형 PPT의 글꼴·마스터 장식·특수 도형은 원본과 다를 수 있습니다. 모든 장을 미리보기로 확인하세요.']};
 const masterList=children.find(r=>r.header.recType===4080&&r.header.recInstance===1),masters=new Map((masterList?readSlideListWithText(masterList):[]).map(p=>[p.slideId,resolve(p.persistIdRef)]));
 for(let i=0;i<ordered.length;i++){
  const record=resolve(ordered[i].persistIdRef),records=childRecords(record),drawing=findChild(records,1036),atom=findChild(records,1007),master=atom?masters.get(u32(atom,12)):null;
  const all=drawing?findDescendants(drawing,61444):[],meta=drawing?readDrawingShapes(drawing):[];
  const scheme=findChild(records,2032),color=n=>rgb((n&0x08000000)&&scheme?u32(scheme,(n&255)*4):n);
  const backgroundShape=all.find(r=>{const f=findChild(childRecords(r),61450);return f&&(u32(f,4)&0x400);})||(master?findDescendants(master,61444).find(r=>{const f=findChild(childRecords(r),61450);return f&&(u32(f,4)&0x400);}):null);
  const props=backgroundShape?readShapeProperties(backgroundShape):new Map(),get=(p,id,otherwise)=>p.get(id)?.value??otherwise;
  const blip=blips[get(props,390,0)-1];
  const slide={shapes:parsed.slides[i].shapes,images:[],background:blip?{bytes:blip.bytes,type:'image/'+blip.format}:null,color:color(get(props,385,0xffffff)),warnings:[]};
  slide.shapes.forEach((shape,j)=>{
   const m=meta[j],p=m?.properties||new Map(),f=shape.frame;
   const raw=all.find(r=>{const a=findChild(childRecords(r),61450);return a&&u32(a,0)===m?.spid;});
   const identity=raw?findChild(childRecords(raw),61450):null;
   shape.geometry=identity?.header.recInstance||1;shape.fill=(get(p,447,0)&0x100000)?((get(p,447,0)&16)?color(get(p,385,0xffffff)):null):null;
   shape.fillOpacity=Math.max(0,Math.min(1,get(p,386,65536)/65536));
   shape.flipH=!!(identity&&(u32(identity,4)&64));shape.flipV=!!(identity&&(u32(identity,4)&128));
   const image=shape.blocks.find(b=>b.kind==='image');
   if(image)slide.images.push({name:'이미지 '+(j+1),url:`data:image/${image.format};base64,${image.base64}`,x:f.xPt,y:f.yPt,w:f.widthPt,h:f.heightPt,rotation:shape.rotationDeg||0,flipH:shape.flipH,flipV:shape.flipV,crop:{top:get(p,256,0)/65536,bottom:get(p,257,0)/65536,left:get(p,258,0)/65536,right:get(p,259,0)/65536}});
   if(!shape.blocks.length&&get(p,260,0))slide.warnings.push('표시할 수 없는 이미지가 있습니다. PPTX 또는 이미지로 다시 저장해 주세요.');
   if(shape.blocks.some(b=>!['image','paragraph','table'].includes(b.kind)))slide.warnings.push('일부 개체는 정지 화면으로 변환되지 않습니다.');
  });
  deck.slides.push(slide);
 }
 return deck;
}
