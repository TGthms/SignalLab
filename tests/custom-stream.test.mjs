import assert from 'node:assert/strict';
import {packet,modulate,joinAudio,PROFILES,customPreambleBytes,wav} from '../dist/codec.mjs';
import {createCustomStream,wavHeader,pcm16} from '../dist/custom-stream.mjs';
const data=new TextEncoder().encode('Chunk boundaries 🌊'),meta={kind:'text',mime:'text/plain'},id='1234567890abcdef';
for(const sr of [44100,48000])for(const profile of [PROFILES.balanced,PROFILES.resilient,PROFILES.fast])for(const total of [1,2,3]){
  const expected=joinAudio(Array.from({length:total},(_,index)=>modulate(packet(data,meta,{total,index,id,preambleBytes:customPreambleBytes(profile,index)}),profile,sr)),sr,.65);
  const stream=createCustomStream(data,meta,profile,total,id,sr),actual=new Float32Array(stream.length);let at=0;
  while(!stream.done){const chunk=stream.read(997);actual.set(chunk,at);at+=chunk.length;}
  assert.equal(at,expected.length);for(let i=0;i<at;i++)assert.equal(actual[i],expected[i],`sample ${i} ${profile.name} ${sr}`);
  const bytes=new Uint8Array(wav(expected,sr));assert.deepEqual(wavHeader(expected.length,sr),bytes.slice(0,44));assert.deepEqual(pcm16(actual),bytes.slice(44));
}
const long=createCustomStream(new Uint8Array(8192),{kind:'file'},PROFILES.resilient,3,id);assert(long.duration>300);assert.equal(long.read(4800).length,4800);
console.log('PASS streaming PCM matches existing waveform and WAV across chunk boundaries; long transfer generates in bounded chunks');
// Exercise a >5-minute transfer end-to-end without retaining its waveform.
const {Receiver}=await import('../dist/codec.mjs');
const longPayload=new Uint8Array(3800).map((_,i)=>i%251),longMeta={kind:'file',name:'long.bin',mime:'application/octet-stream'},longStream=createCustomStream(longPayload,longMeta,PROFILES.resilient,1,id,12000);
assert(longStream.duration>300);let decoded;const receiver=new Receiver(12000,frame=>decoded=frame,undefined,[PROFILES.resilient]);
while(!longStream.done)receiver.feed(longStream.read(12000));
assert.deepEqual(decoded?.payload,longPayload);
console.log('PASS a greater-than-five-minute transmission decodes from bounded chunks');
const {writeWavChunks}=await import('../dist/custom-stream.mjs');
const wavStream=createCustomStream(data,meta,PROFILES.fast,1,id,12000),written=[],progress=[];
await writeWavChunks(wavStream,async chunk=>written.push(chunk),{onProgress:value=>progress.push(value)});
const expectedWav=new Uint8Array(wav(modulate(packet(data,meta,{total:1,index:0,id,preambleBytes:customPreambleBytes(PROFILES.fast,0)}),PROFILES.fast,12000),12000));
const joined=new Uint8Array(written.reduce((n,a)=>n+a.length,0));let offset=0;for(const part of written){joined.set(part,offset);offset+=part.length;}
assert.deepEqual(joined,expectedWav);assert.equal(progress.at(-1),1);
const cancelled=createCustomStream(data,meta,PROFILES.fast,1,id,12000);let chunks=0;
await assert.rejects(writeWavChunks(cancelled,async()=>{chunks++;},{cancelled:()=>chunks>=2}),{name:'AbortError'});
console.log('PASS chunked WAV export, progress and cancellation');
