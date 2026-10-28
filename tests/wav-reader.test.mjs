import assert from 'node:assert/strict';
import {wav,Receiver,PROFILES} from '../dist/codec.mjs';
import {createCustomStream,wavHeader,pcm16} from '../dist/custom-stream.mjs';
import {readWavInfo,readWavChunks} from '../dist/wav-reader.mjs';
const samples=Float32Array.of(-1,-.5,0,.5,1),file=new Blob([wav(samples,48000)]),info=await readWavInfo(file);
assert.equal(info.sr,48000);assert.equal(info.channels,1);assert.equal(info.frames,samples.length);
const read=[];for await(const chunk of readWavChunks(file,info,{framesPerChunk:2}))read.push(...chunk);
for(let i=0;i<samples.length;i++)assert(Math.abs(read[i]-samples[i])<.0001);
const stereoHeader=new Uint8Array(wavHeader(2,48000)),hv=new DataView(stereoHeader.buffer);
hv.setUint16(22,2,true);hv.setUint32(28,48000*4,true);hv.setUint16(32,4,true);hv.setUint32(40,8,true);hv.setUint32(4,44,true);
const stereo=new Blob([stereoHeader,pcm16(Float32Array.of(1,-1,.5,.5))]),stereoInfo=await readWavInfo(stereo),mixed=[];
for await(const chunk of readWavChunks(stereo,stereoInfo,{framesPerChunk:1}))mixed.push(...chunk);
assert.equal(mixed.length,2);assert(Math.abs(mixed[0])<.001);assert(Math.abs(mixed[1]-.5)<.001);
assert.equal(await readWavInfo(new Blob(['not a wav file'])),null);
await assert.rejects(readWavInfo(new Blob([new Uint8Array(wav(samples)).slice(0,45)])),/incomplete/i);
const payload=Uint8Array.from({length:3800},(_,i)=>i%251),meta={kind:'file',name:'long.bin'},sr=12000,id='1234567890abcdef';
const generator=createCustomStream(payload,meta,PROFILES.resilient,1,id,sr),parts=[wavHeader(generator.length,sr)];
while(!generator.done)parts.push(pcm16(generator.read(sr*2)));
const long=new Blob(parts),longInfo=await readWavInfo(long);assert(longInfo.duration>300);
let frame,count=0,max=0;const receiver=new Receiver(sr,result=>frame=result,null,[PROFILES.resilient]);
for await(const chunk of readWavChunks(long,longInfo)){count++;max=Math.max(max,chunk.length);receiver.feed(chunk);}
assert(count>1);assert(max<=32768);assert.deepEqual(frame?.payload,payload);
// Exercise a >50 MB file without allocating it: the file-like object records
// the largest slice requested by the parser and reader.
const largeData=60*1024*1024,largeHeader=wavHeader(largeData/2,48000);let maxRead=0;
const largeFile={size:largeHeader.length+largeData,slice(start,end){maxRead=Math.max(maxRead,end-start);const part=new Uint8Array(end-start);if(start<largeHeader.length)part.set(largeHeader.subarray(start,Math.min(end,largeHeader.length)));return new Blob([part]);}};
const largeInfo=await readWavInfo(largeFile);const iterator=readWavChunks(largeFile,largeInfo);assert.equal((await iterator.next()).value.length,32768);assert(maxRead<=65536);assert(largeFile.size>50*1024*1024);
console.log('PASS bounded WAV import, validation and >5-minute streamed decoding');
// Exercise the actual import coordinator when an I/O read fails after a chunk.
const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
const code=app.slice(app.indexOf('async function decodeWavFile('),app.indexOf("$('#audio-file').onchange"));
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:''});return nodes.get(id);};
let terminated=false,context;
const worker={postMessage(){queueMicrotask(()=>context.streamAck(false));},terminate(){terminated=true;}};
context=vm.createContext({$,worker,job:1,streamAck:null,makeWorker:()=>1,showPage(){},status(){},formatNumber:(value,options)=>new Intl.NumberFormat('en',options).format(value),setLocalizedText(node,source,values={}){node.textContent=source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(_,key)=>String(values[key]??''));},async *readWavChunks(){yield new Float32Array([0]);throw Error('read failed');}});
vm.runInContext(code,context);
await assert.rejects(vm.runInContext("decodeWavFile({name:'bad.wav'},{frames:2,sr:48000})",context),/read failed/);
assert(terminated);assert.equal(context.worker,null);assert.equal(context.job,2);assert.equal(context.streamAck,null);
console.log('PASS failed WAV import releases its decoder worker');
