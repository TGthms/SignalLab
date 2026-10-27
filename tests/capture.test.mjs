import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CAPTURE_SOURCE,attachCapture} from '../dist/capture.mjs';
let Processor;const captured=[];
class BaseProcessor{constructor(){this.port={postMessage:chunk=>captured.push(new Float32Array(chunk))};}}
vm.runInNewContext(CAPTURE_SOURCE,{AudioWorkletProcessor:BaseProcessor,registerProcessor:(name,type)=>{assert.equal(name,'signal-lab-capture-v2');Processor=type;},Float32Array});
const instance=new Processor();
for(let i=0;i<32;i++)assert.equal(instance.process([[new Float32Array(128).fill(i/32)]]),true);
assert.equal(captured.length,2);assert.equal(captured[0].length,2048);assert.equal(captured[0][0],0);assert.equal(captured[1][0],.5);
console.log('PASS bundled AudioWorklet captures and batches microphone samples');
function fakeNode(extra={}){return{connected:[],closed:false,connect(node){this.connected.push(node);},disconnect(){this.closed=true;},...extra};}
let lastProcessor,output=[];
function context(fail=false){return{
  audioWorklet:{async addModule(url){assert(url.startsWith('blob:'));if(fail)throw Error('module blocked');}},
  createMediaStreamSource:()=>fakeNode(),createGain:()=>fakeNode({gain:{value:1}}),
  createAnalyser:()=>fakeNode(),createScriptProcessor:()=>{lastProcessor=fakeNode();return lastProcessor;},destination:fakeNode()
};}
globalThis.AudioWorkletNode=class{constructor(){this.port={onmessage:null};this.connected=[];}connect(n){this.connected.push(n);}disconnect(){this.closed=true;}};
const normal=await attachCapture(context(),{},samples=>output.push(samples));assert.equal(normal.method,'AudioWorklet');normal.close();
const fallback=await attachCapture(context(true),{},samples=>output.push(samples));assert.equal(fallback.method,'Compatibility capture');assert.equal(fallback.workletError,'module blocked');
const original=new Float32Array([.1,.2,.3]);lastProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>original}});assert.deepEqual(output[0],original);assert.notEqual(output[0],original);fallback.close();assert(lastProcessor.closed);assert.equal(lastProcessor.onaudioprocess,null);
console.log('PASS capture initialization, blocked-module fallback, copied samples and cleanup');
const {resumeAudioContext}=await import('../dist/capture.mjs');
for(const initial of ['suspended','interrupted']){
  const context={state:initial,async resume(){this.state='running';}};
  await resumeAudioContext(context);assert.equal(context.state,'running');
}
await resumeAudioContext({state:'running',resume(){throw Error('Already running');}});
await assert.rejects(resumeAudioContext({state:'closed'}),/closed/);
await assert.rejects(resumeAudioContext({state:'interrupted',resume:()=>new Promise(()=>{})},5),/paused/);
console.log('PASS suspended/interrupted audio recovery, closed context and stalled-resume timeout');

const {configureAudioSession}=await import('../dist/capture.mjs');
const host={audioSession:{type:'auto'}};
for(const type of ['playback','play-and-record','auto']){assert.equal(configureAudioSession(host,type),type);assert.equal(host.audioSession.type,type);}
assert.equal(configureAudioSession({},'playback'),'unsupported');
assert.equal(configureAudioSession({get audioSession(){throw Error('Blocked');}},'playback'),'unavailable');
console.log('PASS playback/recording session routing, release and unsupported-browser handling');
