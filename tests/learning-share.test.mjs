import assert from 'node:assert/strict';
import {createReceiverLink,readReceiverLink} from '../dist/share-settings.mjs';
import {lessonSignal,relativeSpectrum} from '../dist/lesson-signal.mjs';
for(const modulation of ['bfsk','dbpsk','dqpsk'])for(const rate of ['resilient','balanced','fast'])for(const carrier of modulation==='bfsk'?[1800]:[1800,20500]){
  const url=createReceiverLink('https://example.test/app/?private=secret#encoder',{modulation,carrier,rate});
  assert(!url.includes('secret'));assert.deepEqual(readReceiverLink(url),{modulation,carrier,rate});assert(url.endsWith('#decoder'));
}
assert.equal(readReceiverLink('https://example.test/?sl-signal=other&sl-speed=fast#decoder'),null);
assert.equal(readReceiverLink('https://example.test/?sl-signal=bfsk&sl-speed=fast#encoder'),null);
assert.equal(readReceiverLink('https://example.test/?sl-signal=bfsk&sl-signal=dqpsk&sl-speed=fast#decoder'),null);
assert.equal(readReceiverLink('https://example.test/?sl-signal=dbpsk&sl-carrier=1&sl-speed=fast#decoder'),null);
assert.throws(()=>createReceiverLink('https://example.test/',{modulation:'bfsk',rate:'bogus'}));
const low=lessonSignal('00000000'),high=lessonSignal('01010101','dbpsk',20500),spec=relativeSpectrum(high.samples,high.sr);
assert(low.samples.length>0);assert.equal(high.carrier,20500);assert.equal(spec.length,256);assert(Math.max(...spec)>.99);assert(Math.abs(spec.indexOf(Math.max(...spec))*24000/255-20500)<1000);
assert.notDeepEqual(lessonSignal('00000000','dbpsk').samples,lessonSignal('11111111','dbpsk').samples);
assert.throws(()=>lessonSignal('011'));assert.throws(()=>lessonSignal('01010101','invalid'));
console.log('PASS settings-only links, validation and interactive waveform/spectrum data');
