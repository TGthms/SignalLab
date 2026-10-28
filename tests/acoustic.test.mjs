import assert from 'node:assert/strict';
import {packet,modulate,Receiver,PROFILES} from '../dist/codec.mjs';
import {measureInput,PcmHistory} from '../dist/reception.mjs';
const payload=new TextEncoder().encode('Mac → iPhone. Quiet tones still carry bits. 🌊');
let seed=1701;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(const sr of [44100,48000])for(const name of ['balanced','resilient','fast']){
  for(const gain of [.01,.001]){
    const signal=modulate(packet(payload,{kind:'text'}),PROFILES[name],sr),offset=173,out=new Float32Array(offset+signal.length+sr*.1);
    // Fast is intended for clean recordings. Test realistic echo delay only on
    // the two profiles intended for acoustic transfer between nearby devices.
    const taps=name==='fast'?[[0,1]]:[[0,1],[Math.round(sr*.0023),.35],[Math.round(sr*.0077),.2]];
    for(let i=0;i<out.length;i++){let value=0;for(const [delay,scale]of taps)value+=(signal[i-offset-delay]||0)*scale;out[i]=gain*(value+(random()-.5)*.12);}
    const frames=[],rx=new Receiver(sr,f=>frames.push(f),null,[PROFILES[name]]);
    for(let at=0;at<out.length;at+=2048)rx.feed(out.subarray(at,at+2048));
    assert(frames.length,`Quiet ${name} failed at ${sr}, gain ${gain}`);assert.deepEqual(frames[0].payload,payload);
  }
  console.log(`PASS quiet ${name} at ${sr}Hz, noise and unaligned streaming${name==='fast'?'':' with room echoes'}`);
}
const noise=Float32Array.from({length:48000*3},()=>.003*(random()-.5)),falseFrames=[];
new Receiver(48000,f=>falseFrames.push(f)).feed(noise);assert.equal(falseFrames.length,0);
const silent=measureInput(new Float32Array(2048),48000);assert.equal(silent.db,-120);assert.equal(silent.custom,0);
const tone=Float32Array.from({length:2048},(_,i)=>.002*Math.sin(2*Math.PI*1200*i/48000));const metrics=measureInput(tone,48000);
assert(Math.abs(metrics.db-(-56.99))<.2);assert(metrics.custom>.95);assert(!metrics.clipping);assert(measureInput(noise.subarray(0,2048),48000).custom<.1);
assert(measureInput(Float32Array.of(1,-1,1,-1),48000).clipping);
const history=new PcmHistory(4,2),first=Float32Array.of(0,1,2,3,4);history.push(first);first.fill(99);history.push(Float32Array.of(5,6,7,8,9));assert.deepEqual([...history.samples()],[2,3,4,5,6,7,8,9]);assert.equal(history.length,8);
history.push(Float32Array.from({length:20},(_,i)=>i));assert.deepEqual([...history.samples()],[12,13,14,15,16,17,18,19]);
console.log('PASS noise rejection, quiet-tone diagnostics, RMS meter, clipping and bounded local PCM history');

const highTone=Float32Array.from({length:2048},(_,i)=>.01*Math.sin(2*Math.PI*20500*i/48000));
assert(measureInput(highTone,48000,{highFrequency:true}).high>.8);
assert(measureInput(tone,48000,{highFrequency:true}).high<.1);
assert.equal(measureInput(highTone,32000,{highFrequency:true}).high,0);
console.log('PASS optional high-frequency energy diagnostics');
const {phaseProfile,customPreambleBytes}=await import('../dist/codec.mjs');
for(const mode of ['dbpsk','dqpsk'])for(const name of ['resilient','balanced','fast']){
  const profile=phaseProfile(PROFILES[name],mode,20500),wire=modulate(packet(payload,{kind:'text'},{preambleBytes:customPreambleBytes(profile)}),profile,48000);
  const observed=measureInput(wire.subarray(48000*.4,48000*.4+2048),48000,{highFrequency:true});
  assert(observed.high>.15,`${mode} ${name}: high-frequency signal band`);
}
console.log('PASS high-frequency diagnostics on modulated phase signals');
