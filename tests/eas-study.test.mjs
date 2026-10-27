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

// Exercise the actual playback decision and dialog handlers without producing sound.
const playCode=app.slice(app.indexOf("$('#play').onclick=()=>"),app.indexOf("$('#cancel-export').onclick="));
const dialog=$('#eas-play-dialog');dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
let starts=0,stops=0;
const dialogContext=vm.createContext({$,mode:'same',playing:false,startPlayback(){starts++;},stopPlayback(){stops++;},toast(message){warning=message;}});
vm.runInContext(playCode,dialogContext);
vm.runInContext("$('#play').onclick()",dialogContext);assert(dialog.open);assert.equal(starts,0);
vm.runInContext("$('#eas-play-cancel').onclick()",dialogContext);assert(!dialog.open);assert.equal(starts,0);
vm.runInContext("$('#play').onclick();$('#eas-play-confirm').onclick()",dialogContext);assert(!dialog.open);assert.equal(starts,1);
vm.runInContext("$('#eas-play-confirm').onclick()",dialogContext);assert.equal(starts,1);
vm.runInContext("mode='custom';$('#play').onclick()",dialogContext);assert.equal(starts,2);
vm.runInContext("playing=true;$('#play').onclick()",dialogContext);assert.equal(stops,1);
console.log('PASS EAS playback requires dialog confirmation and cancel produces no playback');

const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const privacy=await readFile(new URL('../dist/privacy.html',import.meta.url),'utf8');
const terms=await readFile(new URL('../dist/terms.html',import.meta.url),'utf8');
assert.match(html,/href="privacy\.html"/);assert.match(html,/href="terms\.html"/);
assert.match(html,/cannot frighten or mislead others/);
assert.match(html,/role="alertdialog"/);assert.match(html,/id="eas-play-cancel" class="secondary" autofocus/);
for(const text of [privacy,terms]){assert.match(text,/Last updated/);assert.doesNotMatch(text,/Draft prepared|draft for review/);assert.match(text,/contact\.timg@icloud\.com/);}
assert.match(privacy,/GitHub Pages and a Cloudflare-hosted site/);
assert.match(terms,/<h1>Use and safety guidelines<\/h1>/);
console.log('PASS privacy notice, safety guidelines, footer links, and contextual EAS warning');
