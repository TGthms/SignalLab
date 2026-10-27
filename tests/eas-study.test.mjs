import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
const nodes=new Map();
function $(selector){if(!nodes.has(selector)){const classes=new Set();nodes.set(selector,{hidden:false,disabled:false,textContent:'',classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},setAttribute(){}});}return nodes.get(selector);}
let downloads=0,warning='';
const context=vm.createContext({$,mode:'custom',playing:false,exporting:false,stopPlayback(){},updateInspector(){},updatePreview(){},toast(message){warning=message;},download(){downloads++;}});
const modeCode=app.slice(app.indexOf('function setMode('),app.indexOf("$('#custom-mode').onclick"));
const exportCode=app.slice(app.indexOf("$('#export').onclick=async()=>"),app.indexOf("\nwindow.addEventListener('keydown'"));
vm.runInContext(modeCode+'\n'+exportCode,context);
vm.runInContext("setMode('same')",context);
assert.equal($('#export').hidden,true);assert.equal($('#loopback').classList.contains('primary'),true);assert.equal($('#play-label').textContent,'Play tones');
await vm.runInContext("$('#export').onclick()",context);
assert.equal(downloads,0);assert.match(warning,/unavailable/i);
vm.runInContext("setMode('morse')",context);assert.equal($('#export').hidden,false);assert.equal($('#play-label').textContent,'Transmit');
vm.runInContext("setMode('custom')",context);assert.equal($('#export').hidden,false);
console.log('PASS EAS export guard, study action, and export availability in other modes');

const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const privacy=await readFile(new URL('../dist/privacy.html',import.meta.url),'utf8');
const terms=await readFile(new URL('../dist/terms.html',import.meta.url),'utf8');
assert.match(html,/href="privacy\.html"/);assert.match(html,/href="terms\.html"/);
assert.match(html,/cannot frighten or mislead others/);
for(const text of [privacy,terms]){assert.match(text,/Last updated/);assert.doesNotMatch(text,/Draft prepared|draft for review/);assert.match(text,/contact\.timg@icloud\.com/);}
assert.match(privacy,/GitHub Pages and a Cloudflare-hosted site/);
assert.match(terms,/<h1>Use and safety guidelines<\/h1>/);
console.log('PASS privacy notice, safety guidelines, footer links, and contextual EAS warning');
