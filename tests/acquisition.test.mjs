import assert from 'node:assert/strict';
import {packet,modulate,Receiver,PROFILES,customPreambleBytes,joinAudio} from '../dist/codec.mjs';
import {TransferTracker} from '../dist/transfers.mjs';
const payload=new TextEncoder().encode('hello'),meta={kind:'text',mime:'text/plain'};
function decode(signal,sr=48000,profile=PROFILES.balanced,options={}){
  const frames=[],headers=[],rejected=[];
  const rx=new Receiver(sr,f=>frames.push(f),null,[profile],h=>headers.push(h),{...options,onReject:h=>rejected.push(h)});
  for(let at=0;at<signal.length;at+=2048)rx.feed(signal.subarray(at,at+2048));
  return {frames,headers,rejected};
}
// Frequency coloration plus an echo train previously lost entire packets.
for(const sr of [44100,48000])for(const cutoff of [300,900,1800])for(const delay of [.003,.005,.01,.02]){
  const signal=modulate(packet(payload,meta),PROFILES.balanced,sr),out=new Float32Array(signal.length+sr*.1);
  const a=1-Math.exp(-2*Math.PI*cutoff/sr),lag=Math.round(delay*sr);let low=0;
  for(let i=0;i<out.length;i++){low+=a*((signal[i]||0)-low);out[i]=low*.04+(out[i-lag]||0)*.45;}
  const result=decode(out,sr);assert(result.frames.length,`Colored echo channel failed: ${sr}, ${cutoff}, ${delay}`);assert.deepEqual(result.frames[0].payload,payload);
}
console.log('PASS tone balancing through colored channels and echo trains at 44.1/48 kHz');
// A phone route may omit an initial segment. Training length is independent of
// repeat count: a single copy must work too; this does not relax CRC validation.
for(const sr of [44100,48000])for(const profile of Object.values(PROFILES).filter(p=>p.name!=='SAME')){
  const preambleBytes=customPreambleBytes(profile),signal=modulate(packet(payload,meta,{preambleBytes}),profile,sr);
  const result=decode(signal.subarray(Math.round(sr*1.1)),sr,profile);
  assert(result.frames.length,`Startup truncation failed: ${profile.name} at ${sr}`);assert.deepEqual(result.frames[0].payload,payload);
}
console.log('PASS single-copy acquisition after 1.1 seconds of missing startup audio');
for(const damaged of [0,1,2,3]){
  const bytes=packet(payload,meta);for(let i=0;i<damaged;i++)bytes[32+i]^=4;
  const signal=modulate(bytes);
  for(const [sensitivity,limit]of [['low',0],['normal',1],['high',2]]){
    const result=decode(signal,48000,PROFILES.balanced,{sensitivity});
    assert.equal(result.frames.length>0,damaged<=limit,`${sensitivity}, ${damaged} damaged sync bits`);
  }
}
const faint=modulate(packet(payload,meta),PROFILES.balanced,48000,.00002);
assert.equal(decode(faint,48000,PROFILES.balanced,{sensitivity:'normal'}).frames.length,0);
assert(decode(faint,48000,PROFILES.balanced,{sensitivity:'high'}).frames.length);
let seed=843;const noise=Float32Array.from({length:48000*3},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed/4294967296-.5)*.01;});
assert.equal(decode(noise,48000,PROFILES.balanced,{sensitivity:'high'}).frames.length,0);
console.log('PASS sensitivity changes acquisition tolerance/floor; noise never earns a verified frame');
const bad=packet(payload,meta);bad[bad.length-5]^=1;
const failed=decode(modulate(bad));assert.equal(failed.frames.length,0);assert(failed.rejected.length);assert.equal(failed.rejected[0].index,0);
const events=[],tracker=new TransferTracker(e=>events.push(e));
tracker.reject({...failed.rejected[0],sampleRate:48000});tracker.finish();assert.deepEqual(events.at(-1).transfer.failed,[0]);assert.equal(events.at(-1).transfer.state,'incomplete');
const good=decode(modulate(packet(payload,meta))).frames[0];tracker.frame(good);assert.equal(events.at(-1).transfer.state,'verified');assert.deepEqual(events.at(-1).transfer.failed,[]);
console.log('PASS checksum-failed copy diagnostics and later valid-copy recovery');
const id='1234567890abcdef',lateEvents=[],late=new TransferTracker(e=>lateEvents.push(e));
const parts=[1,2].map(index=>modulate(packet(payload,meta,{id,total:3,index,preambleBytes:customPreambleBytes(PROFILES.balanced)})));
const rx=new Receiver(48000,f=>late.frame(f),null,[PROFILES.balanced],h=>late.header({...h,sampleRate:48000}));
rx.feed(joinAudio(parts,48000,.65));late.finish();assert.deepEqual(lateEvents.at(-1).transfer.received,[1,2]);assert.equal(lateEvents.at(-1).transfer.state,'incomplete');
const timing=[],clock=new TransferTracker(e=>timing.push(e));const headers=[];
const three=joinAudio([0,1,2].map(index=>modulate(packet(payload,meta,{id,total:3,index,preambleBytes:customPreambleBytes(PROFILES.balanced)}))),48000,.65);
const clockRx=new Receiver(48000,f=>clock.frame(f),null,[PROFILES.balanced],h=>{headers.push(h);clock.header({...h,sampleRate:48000});});
for(let at=0;at<three.length;at+=2048){clockRx.feed(three.subarray(at,at+2048));clock.tick(at+2048,48000);}
assert.equal(timing.at(-1).transfer.state,'verified');assert(!timing.some(e=>e.transfer.state==='incomplete'));
console.log('PASS missing first copy stays incomplete; longer preambles do not cause premature timeouts');
