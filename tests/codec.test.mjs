import assert from 'node:assert/strict';
import {packet,modulate,Receiver,PROFILES,crc32,sameHeader,sameBytes,parseSame,wav} from '../dist/codec.mjs';
const utf=new TextEncoder();
assert.equal(crc32(utf.encode('123456789')),0xcbf43926);
let seed=12345;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const messages=['hello world','Signal Lab — 你好 🌊','{"message":"TEST","value":42}'];
for(const sr of [44100,48000])for(const [name,p] of Object.entries(PROFILES).filter(([n])=>n!=='same')) {
  const body=utf.encode(messages.join("\n"));const data=packet(body,{kind:'text',mime:'text/plain'});
  const signal=modulate(data,p,sr),shift=371;const noisy=new Float32Array(shift+signal.length);
  for(let i=0;i<signal.length;i++)noisy[i+shift]=signal[i]*.35+(rand()-.5)*.04;
  const frames=[];const rx=new Receiver(sr,f=>frames.push(f),null,[p]);
  for(let at=0;at<noisy.length;at+=2048)rx.feed(noisy.subarray(at,at+2048));
  assert(frames.length,`No frame ${name} ${sr}`);assert.deepEqual(frames[0].payload,body);console.log(`PASS ${name} ${sr}Hz: unaligned, noisy streaming UTF-8`);
}
const header=sameHeader({sender:'LABTEST',date:new Date('2026-10-26T05:45:00Z')});
assert.equal(parseSame(header).issued,'2990545');
for(const sr of [44100,48000]) {
  const frames=[],rx=new Receiver(sr,f=>frames.push(f),null,[PROFILES.same]);
  const s=modulate(sameBytes(header),PROFILES.same,sr);for(let at=0;at<s.length;at+=1531)rx.feed(s.subarray(at,at+1531));
  assert(frames.some(f=>f.raw===header),'SAME header failed');console.log(`PASS SAME ${sr}Hz: header and field extraction`);
}
const allBytes=Uint8Array.from({length:256},(_,i)=>i),found=[];
const rx=new Receiver(48000,f=>found.push(f),null,[PROFILES.fast]);rx.feed(modulate(packet(allBytes,{kind:'file',name:'all.bin',mime:'application/octet-stream'}),PROFILES.fast));
assert.deepEqual(found[0].payload,allBytes);
const bad=packet(utf.encode('corrupt me'),{kind:'text'});bad[bad.length-5]^=1;
const corrupted=[],rxb=new Receiver(48000,f=>corrupted.push(f),null,[PROFILES.fast]);rxb.feed(modulate(bad,PROFILES.fast));assert.equal(corrupted.length,0);
assert.throws(()=>packet(new Uint8Array(8193),{}));assert.throws(()=>sameHeader({locations:'foo'}));
const w=new DataView(wav(new Float32Array(10)));assert.equal(w.getUint32(40,true),20);
console.log('PASS binary round trip, checksum rejection, input limits, WAV framing');
// Different devices have slightly different clocks. Test a full-size all-zero
// binary file so the whitener and timing recovery are exercised together.
for(const drift of [.001,-.001]) {
  const original=new Uint8Array(8192),signal=modulate(packet(original,{kind:'file',name:'zero.bin'}),PROFILES.fast);
  const shifted=Float32Array.from({length:Math.ceil(signal.length*(1+drift))},(_,i)=>{const at=i/(1+drift),n=Math.floor(at),f=at-n;return (signal[n]||0)*(1-f)+(signal[n+1]||0)*f;});
  const frames=[],rx=new Receiver(48000,f=>frames.push(f),null,[PROFILES.fast]);
  for(let at=0;at<shifted.length;at+=2048)rx.feed(shifted.subarray(at,at+2048));
  assert(frames.length,`Clock recovery failed: ${drift}`);assert.deepEqual(frames[0].payload,original);
  console.log(`PASS full 8 KiB file with ${drift*100}% device clock drift`);
}
