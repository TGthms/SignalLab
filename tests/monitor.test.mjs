import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'stale',value:'bfsk',hidden:false,style:{width:'70%'},attrs:{},classList:{remove(){},toggle(){}},setAttribute(k,v){this.attrs[k]=v;}});return nodes.get(id);};
const reset=app.slice(app.indexOf('function resetInputMonitor('),app.indexOf('function cleanupMicrophone('));
const resetContext=vm.createContext({$,inputMetrics:{rms:.2},captureReady:true,capturedSamples:5000,lastTransfer:null});
vm.runInContext(reset+'\nresetInputMonitor();',resetContext);
assert.equal($('#input-state').textContent,'Microphone stopped');assert.equal($('#input-db').textContent,'—');assert.equal($('#input-meter-bar').style.width,'0%');assert.equal($('#decode-stage').textContent,'Stopped');assert.match($('#input-detail').textContent,/Microphone is off/);assert(!$('#input-detail').textContent.includes('Input is active'));
// A queued decoder completion after Stop must not replace stopped status with
// advice about importing a cleaner recording; late sync must not resurrect LIVE.
let latestStatus;const posted=[];
class WorkerStub{postMessage(value){posted.push(value);}terminate(){}}
const workerCode=app.slice(app.indexOf('function receiverPlan('),app.indexOf("try{sensitivity=localStorage")) .replace('import.meta.url',JSON.stringify(new URL('../dist/app.mjs',import.meta.url).href));
const workerContext=vm.createContext({$,Worker:WorkerStub,URL,worker:null,job:0,activeReceptionKey:null,lastTransfer:null,lastSyncAt:0,sensitivity:'normal',listening:false,performance,setBusy(){},status(message,state){latestStatus={message,state};},resetInputMonitor(){vm.runInContext('resetInputMonitor()',resetContext);},transferStatus:()=>'',cleanupMicrophone(){},toast(){}});
vm.runInContext(workerCode+"\nmakeWorker(48000,'microphone');worker.onmessage({data:{job:1,type:'sync',profile:'Balanced'}});worker.onmessage({data:{job:1,type:'done'}});",workerContext);
assert.throws(()=>vm.runInContext('requireCarrierRate(20500, 32000)',workerContext),/44.1 kHz/);vm.runInContext('requireCarrierRate(20500, 44100);requireCarrierRate(1800, 32000)',workerContext);
assert.match(latestStatus.message,/Microphone stopped/);assert.notEqual(latestStatus.state,'error');assert.equal($('#decode-stage').textContent,'Stopped');
vm.runInContext("makeWorker(48000);worker.onmessage({data:{job:2,type:'done'}});",workerContext);assert.match(latestStatus.message,/cleaner recording/);
for(const value of ['bfsk','dbpsk:1800','dbpsk:20500','dqpsk:1800','dqpsk:20500']){
  $('#rx-signal').value=value;vm.runInContext('makeWorker(48000)',workerContext);
  const [modulation,carrier]=value.split(':');assert.equal(posted.at(-1).modulation,modulation);assert.equal(posted.at(-1).carrier,+carrier||1800);
}
console.log('PASS stopped meter/guidance reset, delayed microphone completion and ignored post-Stop sync');
const clock=app.slice(app.indexOf('function clockLabel('),app.indexOf('function stopPlayback('));
let now=1000;
const clockContext=vm.createContext({$,playing:true,playbackMonitor:{context:{currentTime:11},start:10,duration:5,stage:'Transmission'},performance:{now:()=>now}});
vm.runInContext(clock+'\npaintPlayback()',clockContext);assert.equal($('#playback-time').textContent,'0:01.0 / 0:05.0');assert.equal($('#playback-progress').value,1);
now=9000;vm.runInContext('paintPlayback()',clockContext);assert.equal($('#playback-progress').value,1,'Clock must freeze when audio context time freezes');
vm.runInContext('playbackMonitor.context.currentTime=99;paintPlayback()',clockContext);assert.equal($('#playback-progress').value,5);
vm.runInContext("playbackMonitor={speech:true,start:1000,stage:'Spoken announcement'};paintPlayback()",clockContext);assert($('#playback-progress').hidden);assert.equal($('#playback-time').textContent,'0:08.0 elapsed');
console.log('PASS separate audio-clock timeline, duration clamp and honest unknown-duration speech progress');
let currentSource,monitor;
const c={currentTime:4,sampleRate:48000,destination:{},createBuffer:()=>({copyToChannel(){}}),createBufferSource(){currentSource={connect(n){this.target=n;},start(at){this.startedAt=at;},disconnect(){this.closed=true;}};return currentSource;},createAnalyser(){monitor={connect(n){this.target=n;},disconnect(){this.closed=true;}};return monitor;}};
const playbackCode=app.slice(app.indexOf('async function playBuffer('),app.indexOf('function speak('));
const playbackContext=vm.createContext({audioContext:async()=>c,setAudioSession(){},listening:false,setPlayUI(){},source:null,outputAnalyser:null,outputWave:null,playbackMonitor:null,Float32Array});
vm.runInContext(playbackCode+'\nvar completed=playBuffer(new Float32Array(48000),48000);',playbackContext);
await new Promise(resolve=>setImmediate(resolve));assert.equal(currentSource.target,monitor);assert.equal(monitor.target,c.destination);assert.equal(currentSource.startedAt,4);currentSource.onended();await vm.runInContext('completed',playbackContext);assert(monitor.closed&&currentSource.closed);
const points=[],g={setTransform(){},clearRect(){},beginPath(){},moveTo(x,y){points.push([x,y]);},lineTo(x,y){points.push([x,y]);},stroke(){}};
const drawing=app.slice(app.indexOf('function drawScope('),app.indexOf('function animate('));
const drawingContext=vm.createContext({$,canvas:{clientWidth:100,clientHeight:40},g,window:{devicePixelRatio:1},previewSamples:new Float32Array(300).fill(.9),previewRate:12000,listening:false,playing:true,outputAnalyser:{getFloatTimeDomainData(a){a.fill(.25);}},outputWave:new Float32Array(2048),playbackMonitor:{context:{sampleRate:48000}},inputMetrics:null});
vm.runInContext(drawing+'\ndrawScope()',drawingContext);assert.equal(points.length,100,'One waveform; no extra position line');assert(Math.abs(points[0][1]-15.5)<1e-5,'Waveform must use measured output, not generated preview');assert.equal($('#scope-window-end').textContent,'25 ms');
assert(!app.includes("$('#volume')"));
console.log('PASS live output graph wiring, analyser waveform, no overlaid cursor and no app volume control');
