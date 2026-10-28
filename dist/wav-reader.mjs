// Read uncompressed RIFF/WAVE incrementally. Each PCM chunk is bounded and can
// be transferred to the decoder worker without loading the entire file.
const ascii=(v,at,n)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+at,n));
export async function readWavInfo(file){
  if(file.size<12)throw Error('This WAV file is incomplete.');
  const head=new DataView(await file.slice(0,12).arrayBuffer());
  if(ascii(head,0,4)!=='RIFF'||ascii(head,8,4)!=='WAVE')return null;
  const end=head.getUint32(4,true)+8;if(end>file.size||end<12)throw Error('This WAV file is incomplete.');
  let at=12,format=null,data=null,count=0;
  while(at+8<=end&&count++<4096){
    const h=new DataView(await file.slice(at,at+8).arrayBuffer()),id=ascii(h,0,4),length=h.getUint32(4,true),start=at+8,next=start+length+(length&1);
    if(start+length>end||next>end)throw Error('This WAV file contains an incomplete chunk.');
    if(id==='fmt '){
      if(length<16)throw Error('This WAV format header is incomplete.');
      const f=new DataView(await file.slice(start,start+Math.min(length,40)).arrayBuffer());
      let encoding=f.getUint16(0,true);const channels=f.getUint16(2,true),sr=f.getUint32(4,true),byteRate=f.getUint32(8,true),align=f.getUint16(12,true),bits=f.getUint16(14,true);
      if(encoding===0xfffe){
        if(length<40||f.getUint16(16,true)<22||f.getUint16(18,true)!==bits)throw Error('This extensible WAV format is not supported.');
        const guid=Array.from(new Uint8Array(f.buffer,f.byteOffset+24,16));
        const suffix=[0,0,0,0,16,0,128,0,0,170,0,56,155,113];
        if(!suffix.every((v,i)=>guid[i+2]===v))throw Error('This extensible WAV encoding is not supported.');
        encoding=f.getUint16(24,true);
      }
      if(![1,3].includes(encoding)||!(encoding===1?[8,16,24,32].includes(bits):bits===32))throw Error('Only uncompressed PCM or 32-bit float WAV is supported for streaming.');
      if(!Number.isInteger(sr)||sr<8000||sr>192000||channels<1||channels>8||align!==channels*bits/8||byteRate!==sr*align)throw Error('This WAV audio format is invalid or unsupported.');
      format={encoding,channels,sr,align,bits};
    }else if(id==='data'&&!data)data={offset:start,length};
    at=next;if(format&&data)break;
  }
  if(!format||!data)throw Error('This WAV file is missing audio or format information.');
  if(data.length%format.align)throw Error('This WAV file ends in a partial audio frame.');
  return {...format,...data,frames:data.length/format.align,duration:data.length/format.align/format.sr};
}
export async function* readWavChunks(file,info,{framesPerChunk=32768}={}){
  if(!Number.isInteger(framesPerChunk)||framesPerChunk<1||framesPerChunk>262144)throw Error('Invalid audio chunk size.');
  const {offset,length,align,bits,encoding,channels}=info,bytes=bits/8;
  for(let pos=0;pos<length;pos+=framesPerChunk*align){
    const size=Math.min(framesPerChunk*align,length-pos),buffer=await file.slice(offset+pos,offset+pos+size).arrayBuffer();
    if(buffer.byteLength!==size)throw Error('This WAV file ended unexpectedly.');
    const v=new DataView(buffer),out=new Float32Array(size/align);
    for(let frame=0;frame<out.length;frame++){
      let sum=0;for(let channel=0;channel<channels;channel++){
        const i=frame*align+channel*bytes;let x;
        if(encoding===3)x=v.getFloat32(i,true);
        else if(bits===8)x=(v.getUint8(i)-128)/128;
        else if(bits===16)x=v.getInt16(i,true)/32768;
        else if(bits===24){let n=v.getUint8(i)|(v.getUint8(i+1)<<8)|(v.getUint8(i+2)<<16);if(n&0x800000)n|=0xff000000;x=n/8388608;}
        else x=v.getInt32(i,true)/2147483648;
        sum+=Number.isFinite(x)?Math.max(-1,Math.min(1,x)):0;
      }out[frame]=sum/channels;
    }
    yield out;
  }
}
