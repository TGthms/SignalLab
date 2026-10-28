import assert from 'node:assert/strict';
import {PROFILES,phaseProfile,packet,modulate,joinAudio,Receiver,customPreambleBytes} from '../dist/codec.mjs';
import {createCustomStream} from '../dist/custom-stream.mjs';
import {TransferTracker} from '../dist/transfers.mjs';
const data=new TextEncoder().encode('Phase modulation carries actual bytes 🌊'),meta={kind:'text',mime:'text/plain'},id='1234567890abcdef';
for(const mode of ['dbpsk','dqpsk'])for(const name of ['resilient','balanced','fast'])for(const sr of [44100,48000]){
  const p=phaseProfile(PROFILES[name],mode), total=2;
  const expected=joinAudio(Array.from({length:total},(_,index)=>modulate(packet(data,meta,{id,total,index,preambleBytes:customPreambleBytes(p,index)}),p,sr)),sr,.65);
  const stream=createCustomStream(data,meta,p,total,id,sr),actual=new Float32Array(stream.length);let at=0;
  while(!stream.done){const chunk=stream.read(997);actual.set(chunk,at);at+=chunk.length;}
  assert.deepEqual(actual,expected,`${mode} ${name} ${sr}: streaming waveform`);
  const updates=[],tracker=new TransferTracker(update=>updates.push(update)),receiver=new Receiver(sr,frame=>tracker.frame(frame),null,[p],h=>tracker.header({...h,sampleRate:sr}));
  for(let i=0;i<actual.length;i+=2048)receiver.feed(actual.subarray(i,i+2048));tracker.finish();
  const result=updates.at(-1)?.transfer;assert.equal(result?.state,'verified',`${mode} ${name} ${sr}: copies`);assert.deepEqual(result.frame.payload,data);assert.equal(result.frame.modulation,mode);
}
for(const mode of ['dbpsk','dqpsk'])for(const drift of [-.001,.001]){
  const p=phaseProfile(PROFILES.balanced,mode),payload=Uint8Array.from({length:8192},(_,i)=>i%251),sr=12000;
  const signal=modulate(packet(payload,{kind:'file'},{preambleBytes:customPreambleBytes(p)}),p,sr),length=Math.ceil(signal.length*(1+drift));
  const recording=Float32Array.from({length:length+137},(_,j)=>{const t=(j-137)/(1+drift),i=Math.floor(t),fraction=t-i;return .05*((signal[i]||0)*(1-fraction)+(signal[i+1]||0)*fraction+.2*(signal[i-28]||0)+.002*Math.sin(j*3.4));});
  let received;const receiver=new Receiver(sr,frame=>received=frame,null,[p]);
  for(let i=0;i<recording.length;i+=2048)receiver.feed(recording.subarray(i,i+2048));
  assert.deepEqual(received?.payload,payload,`${mode} 8 KiB, drift ${drift}, quiet echo and offset`);
}
let seed=517;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(const mode of ['dbpsk','dqpsk']){
  const profile=phaseProfile(PROFILES.balanced,mode),frames=[];
  const noise=Float32Array.from({length:12000*4},()=>.01*(random()-.5));
  new Receiver(12000,frame=>frames.push(frame),null,[profile]).feed(noise);
  assert.equal(frames.length,0,`${mode}: noise cannot verify a frame`);
  const wrong=phaseProfile(PROFILES.balanced,mode==='dbpsk'?'dqpsk':'dbpsk');
  const signal=modulate(packet(data,meta,{preambleBytes:customPreambleBytes(profile)}),profile,12000),other=[];
  new Receiver(12000,frame=>other.push(frame),null,[wrong]).feed(signal);
  assert.equal(other.length,0,`${mode}: different modulation cannot verify a frame`);
}
console.log('PASS phase modulation: streamed output, copy verification, 44.1/48 kHz, quiet echo and ±0.1% clock drift on 8 KiB');
// Real devices commonly use different sample rates. Resample a noisy, quiet
// signal and include an echo before passing it to the receiver in chunks.
for(const mode of ['dbpsk','dqpsk'])for(const [txRate,rxRate] of [[44100,48000],[48000,44100]]){
  const p=phaseProfile(PROFILES.balanced,mode),payload=Uint8Array.from({length:512},(_,i)=>(i*37)%256);
  const source=modulate(packet(payload,{kind:'file'},{preambleBytes:customPreambleBytes(p)}),p,txRate);
  const read=index=>{const position=index*txRate/rxRate,base=Math.floor(position),fraction=position-base;return (source[base]||0)*(1-fraction)+(source[base+1]||0)*fraction;};
  const signal=Float32Array.from({length:Math.ceil(source.length*rxRate/txRate)+193},(_,i)=>.03*(read(i-193)+.25*read(i-193-Math.round(.0023*rxRate))+.01*(random()-.5)));
  let received;const receiver=new Receiver(rxRate,frame=>received=frame,null,[p]);
  for(let at=0;at<signal.length;at+=2048)receiver.feed(signal.subarray(at,at+2048));
  assert.deepEqual(received?.payload,payload,`${mode}: resampling ${txRate} to ${rxRate}`);
}
console.log('PASS phase modulation: 44.1/48 kHz cross-device resampling with noise and echo');
// Check the on-wire DQPSK phase mapping independently of the receiver.
{
  const sr=12000,p=phaseProfile(PROFILES.resilient,'dqpsk'),sps=sr*2/p.baud,pad=Math.round(sr*.18);
  const signal=modulate(Uint8Array.of(0xe4),p,sr),phases=[];
  for(let symbol=0;symbol<4;symbol++){
    let re=0,im=0;
    for(let i=Math.round(symbol*sps+sps*.2);i<Math.round(symbol*sps+sps*.8);i++){
      const sample=signal[pad+i],angle=2*Math.PI*p.carrier*i/sr;
      re+=sample*Math.cos(angle);im+=sample*Math.sin(angle);
    }
    phases.push(Math.atan2(re,im));
  }
  const expected=[Math.PI/2,3*Math.PI/2,Math.PI];
  for(let i=1;i<4;i++){
    const error=Math.atan2(Math.sin(phases[i]-phases[i-1]-expected[i-1]),Math.cos(phases[i]-phases[i-1]-expected[i-1]));
    assert(Math.abs(error)<.03,`DQPSK symbol ${i} phase mapping`);
  }
}
console.log('PASS DQPSK phase changes match the documented on-wire mapping');
// Above the audible band, a tiny clock-rate mismatch also shifts carrier phase
// significantly between symbols. Model separate device clocks directly.
for(const mode of ['dbpsk','dqpsk'])for(const name of ['resilient','balanced','fast'])for(const sr of [44100,48000])for(const drift of [-.001,.001]){
  const p=phaseProfile(PROFILES[name],mode,20500),payload=Uint8Array.from({length:256},(_,i)=>i%251),meta={kind:'file'};
  const source=modulate(packet(payload,meta,{preambleBytes:customPreambleBytes(p)}),p,sr*(1+drift));
  const signal=Float32Array.from({length:source.length+193},(_,i)=>.08*((source[i-193]||0)+.004*(random()-.5)));
  let result;const receiver=new Receiver(sr,frame=>result=frame,null,[p]);
  for(let at=0;at<signal.length;at+=2048)receiver.feed(signal.subarray(at,at+2048));
  assert.deepEqual(result?.payload,payload,`${mode} ${name} ${sr}, high carrier clock drift ${drift}`);
  assert.equal(result.carrier,20500);
}
for(const mode of ['dbpsk','dqpsk']){
  const p=phaseProfile(PROFILES.balanced,mode,20500),total=2,sr=48000;
  const expected=joinAudio(Array.from({length:total},(_,index)=>modulate(packet(data,meta,{id,total,index,preambleBytes:customPreambleBytes(p,index)}),p,sr)),sr,.65);
  const stream=createCustomStream(data,meta,p,total,id,sr),actual=new Float32Array(stream.length);let at=0;
  while(!stream.done){const chunk=stream.read(997);actual.set(chunk,at);at+=chunk.length;}
  assert.deepEqual(actual,expected,`${mode} high carrier streaming`);
  const updates=[],tracker=new TransferTracker(update=>updates.push(update)),receiver=new Receiver(sr,frame=>tracker.frame(frame),null,[p],h=>tracker.header({...h,sampleRate:sr}));
  for(let i=0;i<actual.length;i+=2048)receiver.feed(actual.subarray(i,i+2048));tracker.finish();
  assert.equal(updates.at(-1)?.transfer?.state,'verified',`${mode}: two high carrier copies`);
}
console.log('PASS 20.5 kHz phase modes: 44.1/48 kHz, simulated clock drift, streamed waveform and repeated copies');
for(const mode of ['dbpsk','dqpsk'])for(const drift of [-.001,.001]){
  const sr=48000,p=phaseProfile(PROFILES.balanced,mode,20500),payload=Uint8Array.from({length:2048},(_,i)=>(i*73)%256);
  const source=modulate(packet(payload,{kind:'file'},{preambleBytes:customPreambleBytes(p)}),p,sr*(1+drift));
  let received;const receiver=new Receiver(sr,frame=>received=frame,null,[p]);
  for(let at=0;at<source.length;at+=2048)receiver.feed(source.subarray(at,at+2048));
  assert.deepEqual(received?.payload,payload,`${mode} long high-frequency transfer, drift ${drift}`);
}
console.log('PASS 2 KiB high-frequency transfers with simulated clock drift');
