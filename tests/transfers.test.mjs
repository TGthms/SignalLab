import assert from 'node:assert/strict';
import {packet,modulate,joinAudio,Receiver,PROFILES,sameHeader,sameBytes} from '../dist/codec.mjs';
import {TransferTracker,SameTracker} from '../dist/transfers.mjs';
const payload=new TextEncoder().encode('Three independent copies. 你好 🌊'),meta={kind:'text',mime:'text/plain'};
function run(total,{omit=[],corrupt=[],conflict=false}={}){
  const events=[],headers=[],id='0123456789abcdef',tracker=new TransferTracker(e=>events.push(e));
  const parts=[];
  for(let index=0;index<total;index++){
    if(omit.includes(index))continue;
    const data=packet(conflict&&index===1?new Uint8Array(payload).fill(33):payload,meta,{total,index,id});
    if(corrupt.includes(index))data[data.length-5]^=4;
    parts.push(modulate(data,PROFILES.fast));
  }
  const signal=joinAudio(parts,48000,.65),rx=new Receiver(48000,f=>tracker.frame(f),null,[PROFILES.fast],h=>{headers.push(h);tracker.header({...h,sampleRate:48000});});
  for(let at=0;at<signal.length;at+=2048){rx.feed(signal.subarray(at,at+2048));tracker.tick(at+2048,48000);}
  tracker.finish();return{events,headers,last:events.at(-1).transfer};
}
for(const total of [1,2,3]){
  const {events,last,headers}=run(total);
  assert.equal(headers[0].total,total);assert.equal(headers[0].index,0);
  assert(events.findIndex(e=>e.transfer.frame)>0,'Opening header must arrive before payload');
  assert.equal(last.state,'verified');assert.equal(last.received.length,total);assert.deepEqual(last.frame.payload,payload);
  console.log(`PASS ${total}x: plan before payload, distinct verified matching copies`);
}
for(const scenario of [{omit:[1]},{corrupt:[1]}]){const {last}=run(3,scenario);assert.equal(last.state,'incomplete');assert.deepEqual(last.received,[0,2]);}
assert.equal(run(3,{conflict:true}).last.state,'conflict');
console.log('PASS missing copies, corrupt copies, conflicting payloads');
const events=[],t=new TransferTracker(e=>events.push(e));
const frame={protocol:'custom',profile:'Fast',meta,payload,transmission:{id:'fedcba9876543210',total:3,index:0}};
for(let i=0;i<8;i++)t.frame(frame);assert.equal(events.at(-1).transfer.received.length,1);
t.header({id:'fedcba9876543210',total:3,index:1,payloadLength:payload.length,metadataLength:50,samplePosition:48000,sampleRate:48000,profile:'Fast'});t.tick(48000*100,48000);assert.equal(events.at(-1).transfer.state,'incomplete');
console.log('PASS phase-candidate deduplication and live missing-copy timeout');
const header=sameHeader({date:new Date('2026-10-26T05:45:00Z')}),sameEvents=[],same=new SameTracker(48000,e=>sameEvents.push(e));
const signal=joinAudio([0,1,2].map(()=>modulate(sameBytes(header),PROFILES.same)),48000,.64);
// modulate adds .36s padding; + .64s yields exactly 1s between burst data.
const rx=new Receiver(48000,f=>same.frame(f),null,[PROFILES.same]);rx.feed(signal);same.finish();
assert.equal(sameEvents.at(-1).transfer.copies,3);assert.equal(sameEvents.at(-1).transfer.state,'verified');
const single=[],one=new SameTracker(48000,e=>single.push(e));const rxOne=new Receiver(48000,f=>one.frame(f),null,[PROFILES.same]);rxOne.feed(modulate(sameBytes(header),PROFILES.same));one.finish();assert.equal(single.at(-1).transfer.copies,1);assert.equal(single.at(-1).transfer.state,'incomplete');
console.log('PASS SAME physical-burst counting, 3 matching copies and incomplete single header');
