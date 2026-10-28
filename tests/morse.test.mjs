import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {MORSE,morsePlan,morseSignal,MorseDecoder} from '../dist/morse.mjs';
import {packet,modulate,PROFILES} from '../dist/codec.mjs';
assert.equal(morsePlan('sos 123').code,'... --- ... / .---- ..--- ...--');
assert.equal(morsePlan('hello\nworld').normalized,'HELLO WORLD');
assert.equal(morsePlan('PARIS').segments.reduce((sum,p)=>sum+p.units,0)+7,50);
assert.equal(morsePlan('E E',15).segments[1].units,7);assert.equal(morsePlan('EE',15).segments[1].units,3);
assert.throws(()=>morsePlan('hello 🌊'),/Unsupported/);assert.throws(()=>morsePlan('ß'),/Unsupported/);assert.throws(()=>morsePlan(''),/Write/);assert.throws(()=>morsePlan('A',0),/speed/);
let seed=129;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(const sr of [44100,48000])for(const wpm of [5,10,15,20,25,30,35]){
  const signal=morseSignal('HELLO WORLD 123?',wpm,sr),out=new Float32Array(signal.samples.length+173),events=[];
  const gain=.002,delay=Math.round(sr*.0023);
  for(let i=0;i<out.length;i++)out[i]=gain*((signal.samples[i-173]||0)+.25*(signal.samples[i-173-delay]||0)+(random()-.5)*.025);
  const rx=new MorseDecoder(sr,e=>events.push(e),{wpm});for(let at=0;at<out.length;at+=2048)rx.feed(out.subarray(at,at+2048));
  const last=events.at(-1)?.transfer;assert.equal(last?.state,'decoded');assert.equal(last.text,'HELLO WORLD 123?',`${sr} / ${wpm}`);assert(events.some(e=>e.transfer.state==='receiving'));assert(!events.some(e=>e.transfer.state==='verified'));
}
console.log('PASS International Morse mapping/timing, input validation and 5–35 WPM quiet acoustic streams at 44.1/48 kHz');
const text=Object.keys(MORSE).join(''),all=morseSignal(text,35),events=[],rx=new MorseDecoder(48000,e=>events.push(e),{wpm:35});rx.feed(all.samples);assert.equal(events.at(-1).transfer.text,text);
const multi=[],many=new MorseDecoder(48000,e=>multi.push(e));for(const word of ['ONE','TWO','THREE'])many.feed(morseSignal(word).samples);assert.equal(new Set(multi.map(e=>e.transfer.id)).size,3);assert.deepEqual(multi.filter(e=>e.transfer.state==='decoded').map(e=>e.transfer.text),['ONE','TWO','THREE']);
const falseResults=[],reject=new MorseDecoder(48000,e=>falseResults.push(e));reject.feed(Float32Array.from({length:48000},()=>.01*(random()-.5)));reject.feed(modulate(packet(new TextEncoder().encode('hello'),{kind:'text'}),PROFILES.balanced));reject.finish();assert.equal(falseResults.length,0);
console.log('PASS every table character, multiple messages in one Morse session and noise/custom-signal rejection');
// Check the app renders every supported symbol in real table elements.
const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
function node(tag,className,text){return {tag,className,text,children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},setAttribute(){}};}
const root=node('div'),tableContext=vm.createContext({MORSE,el:node,uiEl:node,translate:text=>text,setLocalizedAttribute(){},$:()=>root,playMorseExample(){}});
const code=app.slice(app.indexOf('function renderMorseTables('),app.indexOf('async function playMorseExample('));vm.runInContext(code+'\nrenderMorseTables()',tableContext);
assert.equal(root.children.length,3);assert(root.children.every(n=>n.tag==='table'));
function descendants(n){return [n,...n.children.flatMap(descendants)];}
const keys=descendants(root).filter(n=>n.tag==='button');assert.equal(keys.length,Object.keys(MORSE).length);assert.deepEqual(keys.map(n=>n.text).sort(),Object.keys(MORSE).sort());
console.log('PASS complete interactive letters/numbers/punctuation tables from the shared encoder alphabet');
