// pdf.js legacy 빌드가 메우지 않는 Promise.withResolvers(Chrome 119·Safari 17.4 미만에 없음)를 채운다.
// 변환기 앞과 작업자 파일 앞에 같이 넣는다.
if(typeof Promise.withResolvers!=='function')Object.defineProperty(Promise,'withResolvers',{configurable:true,writable:true,value:function(){let resolve,reject;const promise=new this((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}});
