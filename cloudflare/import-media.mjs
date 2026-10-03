import {XMLParser} from 'fast-xml-parser';
import {HttpError} from './http.mjs';
const prefix='file:///YebaeOn-Media/';
const parser=new XMLParser({ignoreAttributes:false,preserveOrder:true,attributeNamePrefix:'',parseTagValue:false,processEntities:true});
// Only our content-addressed imports opt in. Ordinary Mac documents retain
// their existing explicit media-registration protocol and query cost.
export async function importedMedia(db,bytes){
 const xml=new TextDecoder().decode(bytes);if(!xml.includes(prefix))return [];
 const refs=[];let slide=0;
 function walk(nodes){for(const n of nodes){const tag=Object.keys(n).find(k=>k!==':@');if(tag==='RVDisplaySlide')slide++;
  if(['RVImageElement','RVVideoElement'].includes(tag)){
   const source=n[':@']?.source||'';
   if(source.startsWith(prefix)){const m=/^file:\/\/\/YebaeOn-Media\/([a-f0-9]{64})\.png$/.exec(source);if(!m||slide<1)throw new HttpError(422,'invalid_import_media','가져온 이미지 경로가 올바르지 않습니다.');refs.push({id:'import-'+refs.length,sha256:m[1],source,slide});}
  }if(Array.isArray(n[tag]))walk(n[tag]);
 }}walk(parser.parse(xml));
 if(refs.length>900)throw new HttpError(413,'too_many_import_images','문서 이미지가 너무 많습니다. 문서를 나누어 주세요.');
 const hashes=[...new Set(refs.map(r=>r.sha256))];
 for(let i=0;i<hashes.length;i+=80){const part=hashes.slice(i,i+80),rows=(await db.prepare(`SELECT sha256 FROM yebaeon_media_assets WHERE sha256 IN (${part.map(()=>'?').join(',')})`).bind(...part).all()).results;if(rows.length!==part.length)throw new HttpError(409,'import_image_missing','이미지 업로드가 완료되지 않았습니다. 다시 시도해 주세요.');}
 return refs;
}
export function importMediaStatements(db,refs,id,version,writeId,now){return refs.map(r=>db.prepare(`INSERT INTO yebaeon_media_references(document_id,document_version,reference_id,asset_sha256,source,slide_index,created_at) SELECT id,?,?,?,?,?,? FROM yebaeon_documents WHERE id=? AND write_id=?`).bind(version,r.id,r.sha256,r.source,r.slide,now,id,writeId));}
