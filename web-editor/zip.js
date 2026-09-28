/* ZIP STORE writer: UTF-8 names, CRC32, no external library or network. */
(function () {
  const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes) { let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0; }
  function header(size) {const bytes=new Uint8Array(size), view=new DataView(bytes.buffer);return {bytes,u16:(p,v)=>view.setUint16(p,v,true),u32:(p,v)=>view.setUint32(p,v,true)};}
  window.makeZip=async function(entries) {
    const local=[],central=[];let offset=0, centralSize=0;
    if(entries.length>65535)throw new Error('ZIP 파일 수 제한을 넘었습니다.');
    for(const entry of entries) {
      if(entry.path.startsWith('/') || entry.path.split('/').some(p=>p==='..') || /\\/.test(entry.path))throw new Error('잘못된 패키지 경로입니다.');
      const name=new TextEncoder().encode(entry.path),data=entry.data instanceof Blob?new Uint8Array(await entry.data.arrayBuffer()):new TextEncoder().encode(entry.data);
      if(offset+data.length>0xffffffff)throw new Error('이 버전은 4GB 이상 ZIP을 지원하지 않습니다.');
      const crc=crc32(data),h=header(30);
      h.u32(0,0x04034b50);h.u16(4,20);h.u16(6,0x0800);h.u16(12,33);h.u32(14,crc);h.u32(18,data.length);h.u32(22,data.length);h.u16(26,name.length);
      local.push(h.bytes,name,data);
      const c=header(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(8,0x0800);c.u16(14,33);c.u32(16,crc);c.u32(20,data.length);c.u32(24,data.length);c.u16(28,name.length);c.u32(42,offset);
      central.push(c.bytes,name);offset+=30+name.length+data.length;centralSize+=46+name.length;
    }
    const end=header(22);end.u32(0,0x06054b50);end.u16(8,entries.length);end.u16(10,entries.length);end.u32(12,centralSize);end.u32(16,offset);
    return new Blob([...local,...central,end.bytes],{type:'application/zip'});
  };
})();
