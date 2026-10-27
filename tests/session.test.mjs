import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {packet,modulate,joinAudio,PROFILES,customPreambleBytes,sameHeader,sameBytes} from '../dist/codec.mjs';
const events=[];globalThis.self={postMessage:event=>events.push(structuredClone(event))};
await import('../dist/receive-worker.mjs?v=0.2.3');
const send=data=>self.onmessage({data}),sr=48000,meta={kind:'text',mime:'text/plain'};
send({type:'init',job:7,sr,sensitivity:'normal'});
const parts=[],ids=['1000000000000001','2000000000000002','3000000000000003'];
for(let message=0;message<3;message++){
  const profile=[PROFILES.balanced,PROFILES.resilient,PROFILES.fast][message],total=[3,1,2][message];
  for(let index=0;index<total;index++)parts.push(modulate(packet(new TextEncoder().encode(`Message ${message+1}`),meta,{id:ids[message],total,index,preambleBytes:customPreambleBytes(profile,index)}),profile));
}
const header=sameHeader({date:new Date('2026-10-26T05:45:00Z')});
// Two SAME messages without end bursts still form independent sets of three.
for(let message=0;message<2;message++)for(let copy=0;copy<3;copy++)parts.push(modulate(sameBytes(header),PROFILES.same));
const signal=joinAudio(parts,sr,.65);
for(let at=0;at<signal.length;at+=2048)send({type:'audio',job:7,samples:signal.subarray(at,at+2048)});
assert(!events.some(e=>e.type==='done'),'Live message completion must not end the session');
for(let i=0;i<ids.length;i++){
  const latest=events.filter(e=>e.type==='transfer'&&e.transfer.id===ids[i]).at(-1)?.transfer;
  assert.equal(latest?.state,'verified');assert.equal(new TextDecoder().decode(latest.frame.payload),`Message ${i+1}`);
}
const sameIds=new Set(events.filter(e=>e.type==='same-transfer').map(e=>e.transfer.id));assert.equal(sameIds.size,2);
for(const id of sameIds)assert.equal(events.filter(e=>e.type==='same-transfer'&&e.transfer.id===id).at(-1).transfer.state,'verified');
send({type:'finish',job:7});assert.equal(events.at(-1).type,'done');
console.log('PASS one uninterrupted worker session: 3 custom messages, mixed profiles/repeats, 2 independent SAME messages');
// Exercise the app's actual event routing with small DOM-independent stubs:
// older timeouts must update their log entry without replacing a newer result.
const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
const routing=app.slice(app.indexOf('function receiveTracked('),app.indexOf('function receiveLegacy('));
const shown=[],context=vm.createContext({shown,receptions:[],activeReceptionKey:null,lastTransfer:null,
  showTransfer(t){shown.push(t);}});
vm.runInContext(`function upsertReception(transfer,key){let item=receptions.find(r=>r.key===key);if(!item){item={key,transfer};receptions.unshift(item);}else item.transfer=transfer;return item;}\n${routing}`,context);
vm.runInContext(`receiveCustom({id:'first',state:'receiving'},7);receiveCustom({id:'second',state:'verified',frame:{payload:'second'}},7);receiveCustom({id:'first',state:'incomplete'},7);`,context);
assert.equal(shown.at(-1).id,'second');assert.equal(shown.length,2);
assert.equal(vm.runInContext("receptions.find(r=>r.transfer.id==='first').transfer.state",context),'incomplete');
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,children:['old payload'],replaceChildren(...v){this.children=v;}});return nodes.get(id);};
const display=app.slice(app.indexOf('function showTransfer('),app.indexOf('function receiveTracked('));
const displayContext=vm.createContext({$:node,renderProgress(){},resultCard:t=>t.frame?.payload||'Header received; no valid payload yet',status(){},transferStatus:()=>'',listening:true,busy:false,Date});
vm.runInContext(display+"\nshowTransfer({state:'receiving'});",displayContext);
assert.equal(node('#result').children[0],'Header received; no valid payload yet');
console.log('PASS independent log updates, late-timeout isolation and no stale payload under a new header');
