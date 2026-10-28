import {formatDate,formatNumber,formatUnit,getLocale,setLocalizedAttribute,setLocalizedParts,setLocalizedText,translate} from './i18n.mjs?v=0.7.1';
import {EAS_EVENTS,EVENT_GROUPS,eventExplanation} from './eas-events.mjs?v=0.1.0';
import {lessonSignal,relativeSpectrum} from './lesson-signal.mjs?v=0.4.0';
import {readWavInfo,readWavChunks} from './wav-reader.mjs?v=0.4.0';
import {createReceiverLink,readReceiverLink} from './share-settings.mjs?v=0.4.0';
import {makeDemo} from './demo.mjs?v=0.3.8';
import {customDuration} from './signal-plan.mjs?v=0.3.8';
import {createCustomStream,writeWavChunks} from './custom-stream.mjs?v=0.3.8';
import {MORSE,MORSE_FREQUENCY,morsePlan,morseSignal} from './morse.mjs?v=0.2.5';
import {PROFILES,phaseProfile,MAX_PAYLOAD,customPreambleBytes,packet,modulate,joinAudio,sameBytes,sameHeader,wav} from './codec.mjs?v=0.3.8';
import {attachCapture,resumeAudioContext,configureAudioSession,releaseMicrophone,ListeningWakeLock} from './capture.mjs?v=0.2.5';
import {measureInput,PcmHistory} from './reception.mjs?v=0.4.0';
import {describeLocation,searchLocations,STATES,PARTITIONS} from './locations.mjs?v=0.3.0';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const utf=new TextEncoder(),textDecoder=new TextDecoder();
const defaultText='Hello from the other side of the room. 🌊',defaultJson=JSON.stringify({message:'Hello through sound',experiment:1},null,2);
const drafts={text:$('#message').value,json:defaultJson};
let localizedDefaultText=defaultText,localizedDefaultJson=defaultJson,localizedDefaultMorse='HELLO WORLD';
let mode='custom',kind='text',page='encoder',lesson='modem',payloadFile=null,voice=null;
let micCtx=null,micClosing=Promise.resolve(),lastResumeAt=0;
let ctx=null,source=null,playing=false,playToken=0,speechCancel=null;
let worker=null,job=0,busy=false,listening=false,stream=null,capture=null,analyser=null,listenToken=0;
let streamAck=null,customCancel=null,exporting=false,exportCancelled=false;const loadedWorklets=new WeakSet();
let receptions=[],lastTransfer=null,activeReceptionKey=null,locationRows=[],themePreference='system',toastTimer;
let sensitivity='normal',captureReady=false,capturedSamples=0;
let inputHistory=null,inputMetrics=null,captureStarted=0,lastSampleAt=0,lastMeterAt=0,healthTimer=null,lastSyncAt=0;
let previewSamples=null,previewRate=12000,liveWave=null,lastPaint=0,previewTimer,outputAnalyser=null,outputWave=null,playbackMonitor=null;
window.addEventListener('signal-lab-locale-change',()=>{
  const previousText=localizedDefaultText,localizedText=translate(defaultText);
  if(drafts.text===previousText)drafts.text=localizedText;
  if($('#message').value===previousText&&kind==='text')$('#message').value=localizedText;
  localizedDefaultText=localizedText;
  const previousJson=localizedDefaultJson;if(drafts.json===previousJson){const value={message:translate('Hello through sound'),experiment:1};drafts.json=JSON.stringify(value,null,2);if($('#message').value===previousJson&&kind==='json')$('#message').value=drafts.json;localizedDefaultJson=drafts.json;}
  if($('#morse-message').value===localizedDefaultMorse){const next=translate('HELLO WORLD');try{morsePlan(next);$('#morse-message').value=next;localizedDefaultMorse=next;}catch{$('#morse-message').value='HELLO WORLD';localizedDefaultMorse='HELLO WORLD';}}
  const morseExample=$('#morse-example-text');
  try{$('#morse-example-code').textContent=morsePlan(morseExample.textContent,15).code;}
  catch{morseExample.textContent='HELLO WORLD';$('#morse-example-code').textContent='.... . .-.. .-.. --- / .-- --- .-. .-.. -..';}
  renderMorseTables();updateLocations();renderLocationReference();renderHistory();renderEarlierReceptions();updateReceiverSettings();updateSensitivity();
  if(lastTransfer){const item=receptions.find(entry=>entry.key===activeReceptionKey);showTransfer(lastTransfer,item);}
  if($('#location-search').value.trim().length>=2)$('#location-search').dispatchEvent(new Event('input'));
  updatePreview();
});
const copyWord = count => {const locale=getLocale(),form=new Intl.PluralRules(locale).select(count);if(locale==='ar'&&form==='two')return 'نسختين';return {source:form==='one'||(locale==='cs'&&form==='few')?'copy':'copies'};};
const bytesLabel=n=>n<1024?`${formatNumber(n)} B`:`${formatNumber(n/1024,{maximumFractionDigits:n%1024?1:0})} KiB`;
const timeLabel=n=>n>=60?`${formatUnit(Math.floor(n/60),'minute')} ${formatUnit(Math.ceil(n%60),'second')}`:formatUnit(n,'second',{maximumFractionDigits:1});
const err=e=>translate(e?.message||String(e),e?.i18nValues||{});
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function uiEl(tag,className,text){const node=el(tag,className);if(text!==undefined)setLocalizedText(node,text);return node;}
function toast(message,error=false){clearTimeout(toastTimer);setLocalizedText($('#toast'),message);$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?8000:4500);}
function download(data,name,type='application/octet-stream'){
  const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function copyText(value){try{await navigator.clipboard.writeText(value);toast('Copied.');}catch{toast('Clipboard access is unavailable. Select the text and copy it manually.',true);}}

// Appearance follows the OS until a light/dark preference is explicitly saved.
try{themePreference=localStorage.getItem('signal-lab-theme')||'system';}catch{}
if(!['system','light','dark'].includes(themePreference))themePreference='system';
const colorQuery=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){const theme=themePreference==='system'?(colorQuery.matches?'dark':'light'):themePreference;document.documentElement.dataset.theme=theme;$('#theme').value=themePreference;$('meta[name="theme-color"]').content=theme==='dark'?'#151616':'#efefed';}
$('#theme').onchange=()=>{themePreference=$('#theme').value;try{localStorage.setItem('signal-lab-theme',themePreference);}catch{}applyTheme();};
colorQuery.addEventListener('change',()=>{if(themePreference==='system')applyTheme();});applyTheme();

function showPage(next){
  const previous=page;
  page=['encoder','decoder','learn','history'].includes(next)?next:'encoder';
  $$('.page').forEach(n=>n.hidden=n.id!==`page-${page}`);$$('.nav').forEach(n=>{n.classList.toggle('active',n.dataset.page===page);n.setAttribute('aria-current',n.dataset.page===page?'page':'false');});
  const hash=page==='learn'?`#learn/${lesson}`:`#${page}`;if(location.hash!==hash){const method=location.hash?'pushState':'replaceState';window.history[method](null,'',hash);}
  if(previous!==page){window.scrollTo(0,0);const active=document.activeElement;if(active?.closest('.page')?.hidden){const heading=$(`#page-${page} h1`);heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  updateInspector();updateLayout();if(page==='encoder'&&!listening&&!playing)updatePreview();requestAnimationFrame(drawScope);
}
function openLesson(next){lesson=['modem','verification','same','morse','reception'].includes(next)?next:'modem';$$('.lesson').forEach(n=>n.hidden=n.id!==`lesson-${lesson}`);$$('.lesson-tabs [data-lesson]').forEach(n=>{const selected=n.dataset.lesson===lesson;n.classList.toggle('selected',selected);n.setAttribute('aria-pressed',String(selected));});showPage('learn');if(lesson==='modem')updateExperiment();}
$$('[data-page]').forEach(n=>n.onclick=()=>showPage(n.dataset.page));
$('.brand').onclick=e=>{e.preventDefault();showPage('encoder');window.scrollTo(0,0);};
$$('[data-lesson]').forEach(n=>n.onclick=()=>openLesson(n.dataset.lesson));
function openDeviceGuide(){openLesson('modem');const details=$('#device-research');details.open=true;details.scrollIntoView({block:'start'});}
$('#open-device-research').onclick=openDeviceGuide;$('#open-device-guide').onclick=openDeviceGuide;
window.addEventListener('hashchange',()=>{const [next,topic]=location.hash.slice(1).split('/');if(next==='learn')openLesson(topic||lesson);else showPage(next);});
function updateLayout(){$('.app-layout').classList.toggle('reading',(page==='learn'||page==='history')&&!listening&&!playing);}
function updateInspector(){
  const sameMode=mode==='same'&&page==='encoder',morseMode=mode==='morse'&&page==='encoder';$('#rail-location').hidden=!sameMode;
  $('#inspector-title').textContent=page==='decoder'?'Read what arrived':morseMode?'Rhythm carries the letter':sameMode?'Read the location code':page==='learn'?'Try it, then inspect it':'Inside the signal';
  $('#inspector-copy').textContent=page==='decoder'?'Custom data checks every declared copy. SAME compares header bursts. Morse reads tone timing without a checksum; match the receive speed to the sender.':morseMode?'Morse keys one tone on and off. A dash lasts three dots; gaps separate elements, letters, and words. Open the table to see and hear each character.':sameMode?'PSSCCC is the Geographical Area block. The leading digit chooses a partition; the other five identify a state and county or equivalent area.':page==='learn'?'Use the encoder’s loopback control to test an actual audio waveform. Then watch the decoder count and compare its copies.':$('#modulation').value==='bfsk'?'Two tones represent the bits in your message. The receiver finds the timing, reads the header, and checks the data.':'Changes in carrier phase represent the bits. The receiver compares symbols, reads the header, and checks the data.';
  $('#inspector-learn').dataset.lesson=morseMode?'morse':page==='decoder'?'verification':sameMode?'same':'modem';
  $('.keyboard-hint').hidden=page!=='encoder';
}

// Bundled NOAA names keep place lookup local. Unknown codes are never invented.
fetch(new URL('./data/locations.json',import.meta.url)).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{locationRows=data.rows;updateLocations();initLocationReference();}).catch(()=>{setLocalizedText($('#location-summary'),'Location names could not load. Code format explanations are still available.');});
function updateLocations(){
  const codes=$('#locations').value.split(/[,\s]+/).filter(Boolean),summary=$('#location-summary');summary.replaceChildren();
  for(const code of codes.slice(0,31)){
    const d=describeLocation(code,locationRows),card=el('div','location-chip');
    if(!d){card.append(uiEl('p','',`${code}: enter six digits (PSSCCC).`));summary.append(card);continue;}
    const top=el('div','location-chip-top'),placeName=d.name?`${d.name}, ${translate(d.state||'')}`:translate('Name not found in bundled NOAA directory');top.append(el('code','',code),el('strong','',placeName));card.append(top);
    card.append(uiEl('p','',d.partition==='0'?'All / unspecified portions':`${d.partitionName} partition — only where locally defined`));
    const parts=el('div','code-parts');parts.append(el('span','',`P ${d.partition}`),document.createTextNode(' / '),el('span','',`SS ${d.stateCode}`),document.createTextNode(` ${d.state||''} / `),el('span','',`CCC ${d.countyCode}`),document.createTextNode(` ${d.name||'County / equivalent area'}`));card.append(parts);summary.append(card);
  }
  if(codes.length>31)summary.append(uiEl('p','field-help','A SAME header can contain at most 31 location codes.'));
  const first=describeLocation(codes[0]||'',locationRows),rail=$('#rail-location');rail.replaceChildren();
  if(first){const placeName=first.name?`${first.name}, ${translate(first.state||'')}`:translate('Name not found in bundled NOAA directory');rail.append(el('code','',`${first.partition} · ${first.stateCode} · ${first.countyCode}`),el('div','',placeName),el('div','field-help',translate(first.partitionName)));}
}
// The bundled directory is a snapshot, and non-zero partitions are only labels:
// selecting one does not imply that local alert authorities actually use it.
function initLocationReference(){
  const states=$('#location-reference-state');states.replaceChildren();
  for(const abbr of [...new Set(locationRows.map(row=>row[2]))].sort((a,b)=>(STATES[a]||a).localeCompare(STATES[b]||b))){const option=el('option','',STATES[abbr]||abbr);option.value=abbr;states.append(option);}
  states.value='CA';const partition=$('#location-reference-partition');partition.replaceChildren();
  PARTITIONS.forEach((name,index)=>{const option=el('option','',`${index} · ${name}`);option.value=String(index);partition.append(option);});
  renderLocationReference();
}
function renderLocationReference(){
  const states=$('#location-reference-state'),partition=$('#location-reference-partition'),list=$('#location-reference-list');
  if(!states.options.length)return;
  for(const option of states.options)option.textContent=translate(STATES[option.value]||option.value);
  for(const option of partition.options)option.textContent=`${option.value} · ${translate(PARTITIONS[+option.value])}`;
  list.replaceChildren();
  for(const [code,name] of locationRows.filter(row=>row[2]===states.value)){
    const actual=partition.value+code.slice(1),button=el('button','location-reference-item');button.type='button';
    const label=el('span','',name),number=el('code','',actual);button.append(label,number,el('span','','+'));
    button.onclick=()=>{const codes=$('#locations').value.split(/[,\s]+/).filter(Boolean);if(!codes.includes(actual)){if(codes.length>=31){toast('A header can include at most 31 areas.',true);return;}codes.push(actual);$('#locations').value=codes.join(', ');updateLocations();updatePreview();}};
    list.append(button);
  }
}
$('#location-reference-state').onchange=renderLocationReference;$('#location-reference-partition').onchange=renderLocationReference;
// FCC titles and the short study explanations are explicitly marked English.
for(const group of EVENT_GROUPS){const section=el('section','event-reference-group'),heading=el('h4','',group.name),list=el('dl');
  for(const code of group.codes){const entry=el('div','event-reference-entry'),term=el('dt'),description=el('dd','',eventExplanation(code));term.append(el('code','',code),document.createTextNode(` · ${EAS_EVENTS[code]}`));entry.append(term,description);list.append(entry);}
  section.append(heading,list);$('#event-reference-list').append(section);
}
// Keep the seven existing translated choices; add FCC names as an English
// reference, marked with its language for assistive technology.
for(const [code,name] of Object.entries(EAS_EVENTS))if(!$('#event').querySelector(`option[value="${code}"]`)){const option=el('option','',`${code} · ${name}`);option.value=code;option.lang='en';$('#event').append(option);}
$('#toggle-location-help').onclick=()=>{const details=$('#location-help');details.open=!details.open;$('#toggle-location-help').setAttribute('aria-expanded',String(details.open));};
$('#location-help').addEventListener('toggle',()=>$('#toggle-location-help').setAttribute('aria-expanded',String($('#location-help').open)));
$('#location-search').oninput=()=>{
  const container=$('#location-search-results'),query=$('#location-search').value;container.replaceChildren();if(query.trim().length<2)return;
  const rows=searchLocations(query,locationRows,abbr=>translate(STATES[abbr]||abbr));if(!rows.length){container.append(uiEl('div','search-empty','No matches in the bundled NOAA directory.'));return;}
  for(const [code,name,abbr]of rows){const button=el('button');button.type='button';button.append(el('span','',`${name}, ${translate(STATES[abbr]||abbr)}`),el('code','',code+' +'));button.onclick=()=>{const codes=$('#locations').value.split(/[,\s]+/).filter(Boolean);if(!codes.includes(code)){if(codes.length>=31){toast('A header can include at most 31 areas.',true);return;}codes.push(code);$('#locations').value=codes.join(', ');}$('#location-search').value='';container.replaceChildren();updateLocations();updatePreview();};container.append(button);}
};
$('#copy-header').onclick=()=>{try{copyText(currentHeader());}catch(e){toast(err(e),true);}};

function setMode(next){if(playing)stopPlayback();mode=next;$('#custom-fields').hidden=mode!=='custom';$('#same-fields').hidden=mode!=='same';$('#morse-fields').hidden=mode!=='morse';$('#same-legal-reminder').hidden=mode!=='same';$('#export').hidden=mode==='same';$('#transmit-actions').classList.toggle('same-actions',mode==='same');$('#loopback').classList.toggle('primary',mode==='same');$('#loopback').classList.toggle('secondary',mode!=='same');$('#play').classList.toggle('secondary',mode==='same');$('#play').classList.toggle('primary',mode!=='same');$('#play-label').textContent=mode==='same'?'Play tones':'Transmit';['custom','same','morse'].forEach(m=>{const n=$(`#${m}-mode`);n.classList.toggle('selected',m===mode);n.setAttribute('aria-pressed',String(m===mode));});updateInspector();updatePreview();}
$('#custom-mode').onclick=()=>setMode('custom');$('#same-mode').onclick=()=>setMode('same');$('#morse-mode').onclick=()=>setMode('morse');
function setKind(next){if(kind!=='file')drafts[kind]=$('#message').value;kind=next;$$('[data-kind]').forEach(n=>{n.classList.toggle('active',n.dataset.kind===kind);n.setAttribute('aria-pressed',String(n.dataset.kind===kind));});$('#text-editor').hidden=kind==='file';$('#file-editor').hidden=kind!=='file';if(kind!=='file')$('#message').value=drafts[kind];$('#encoding-label').textContent=kind==='json'?'JSON / UTF-8':'UTF-8';$('#payload-label').textContent=kind==='json'?'JSON':kind==='file'?'File':'Message';updatePreview();}
$$('[data-kind]').forEach(n=>n.onclick=()=>setKind(n.dataset.kind));
$$('[data-repeat]').forEach(n=>n.onclick=()=>{$('#repeat').value=n.dataset.repeat;$$('[data-repeat]').forEach(b=>{b.classList.toggle('selected',b===n);b.setAttribute('aria-pressed',String(b===n));});updatePreview();});
async function selectPayload(file){if(!file)return;if(file.size>MAX_PAYLOAD)throw Error('Choose a file of 8 KiB or less.');payloadFile={data:new Uint8Array(await file.arrayBuffer()),name:file.name,mime:file.type||'application/octet-stream'};$('#payload-name').textContent=file.name;setLocalizedText($('#payload-size'),'{size} / ready',{size:bytesLabel(file.size)});updatePreview();}
$('#payload-file').onchange=async e=>{try{await selectPayload(e.target.files[0]);}catch(e){toast(err(e),true);}e.target.value='';};
const drop=$('#payload-drop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragover');};drop.ondragleave=()=>drop.classList.remove('dragover');drop.ondrop=async e=>{e.preventDefault();drop.classList.remove('dragover');try{await selectPayload(e.dataTransfer.files[0]);}catch(e){toast(err(e),true);}};
function payload(){
  if(kind==='file'){if(!payloadFile)throw Error('Choose a file first.');return{data:payloadFile.data,meta:{kind:'file',name:payloadFile.name,mime:payloadFile.mime}};}
  const value=$('#message').value;if(!value.trim())throw Error('Write a message first.');
  if(kind==='json'){try{JSON.parse(value);}catch{throw Error('Invalid JSON. Check the brackets, commas, and quotes.');}}
  return{data:utf.encode(value),meta:{kind,mime:kind==='json'?'application/json':'text/plain'}};
}
function updateUTC(){if($('#auto-time').checked)$('#issued').value=new Date().toISOString().slice(0,16);$('#issued').disabled=$('#auto-time').checked;}
function currentHeader(){return sameHeader({origin:$('#origin').value,event:$('#event').value,locations:$('#locations').value,duration:$('#duration').value,sender:$('#sender').value,date:$('#auto-time').checked?new Date():new Date($('#issued').value+'Z')});}
updateUTC();
function attentionSignal(sr){const a=new Float32Array(sr*8);for(let i=0;i<a.length;i++){const ramp=Math.min(1,i/(sr*.01),(a.length-1-i)/(sr*.01));a[i]=.32*(Math.sin(2*Math.PI*853*i/sr)+Math.sin(2*Math.PI*960*i/sr))*ramp;}return a;}
function customPlan(){const {data,meta}=payload();const id=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');return {data,meta,id,total:+$('#repeat').value,profile:phaseProfile(PROFILES[$('#profile').value],$('#modulation').value,+$('#carrier').value)};}
function buildSignal(){
  const sr=48000;
  if(mode==='morse')return morseSignal($('#morse-message').value,+$('#morse-wpm').value,sr);
  updateUTC();const header=currentHeader(),padding=Math.round(.18*sr);
  const burst=modulate(sameBytes(header),PROFILES.same,sr).slice(padding,-padding),end=modulate(sameBytes('NNNN'),PROFILES.same,sr).slice(padding,-padding);
  const heads=joinAudio([burst,burst,burst],sr,1),ends=joinAudio([end,end,end],sr,1),leading=new Float32Array(sr*.25),headParts=[leading,heads];
  if($('#attention').checked)headParts.push(attentionSignal(sr));
  const head=joinAudio(headParts,sr,1),tail=joinAudio([ends,leading],sr,.25),parts=[head];if(voice)parts.push(voice.data);parts.push(tail);
  return{samples:joinAudio(parts,sr,1),sr,head,tail,header,speech:!voice&&$('#speak').checked?$('#announcement').value.trim():null};
}
const pSource=value=>({balanced:'Balanced',resilient:'Resilient',fast:'Fast'}[value]||value);
function refreshSettingsLink(){const url=createReceiverLink(location.href,{modulation:$('#modulation').value,carrier:+$('#carrier').value,rate:$('#profile').value});$('#share-link').value=url;return url;}
const speedProfiles=['resilient','balanced','fast'];
function updateSpeedControls(){
  const profile=$('#profile').value,slider=$('#speed-preset'),p=PROFILES[profile];slider.value=String(speedProfiles.indexOf(profile));slider.style.setProperty('--preset-fill',`${+slider.value*50}%`);
  setLocalizedAttribute(slider,'aria-valuetext','{profile}, {baud} bits per second',{profile:{source:pSource(profile)},baud:formatNumber(p.baud)});setLocalizedText($('#speed-preset-value'),'{profile} · {baud} bit/s',{profile:{source:pSource(profile)},baud:formatNumber(p.baud)});
  const rx=$('#rx-speed-preset'),key=speedProfiles[+rx.value]||'balanced',rp=PROFILES[key];rx.style.setProperty('--preset-fill',`${+rx.value*50}%`);
  setLocalizedAttribute(rx,'aria-valuetext','{profile}, {baud} bits per second',{profile:{source:pSource(key)},baud:formatNumber(rp.baud)});setLocalizedText($('#rx-speed-value'),'{profile} · {baud} bit/s',{profile:{source:pSource(key)},baud:formatNumber(rp.baud)});
  rx.disabled=$('#rx-rate-auto').checked||listening||busy;$('#rx-rate-auto').disabled=listening||busy;
}
$('#speed-preset').oninput=()=>{$('#profile').value=speedProfiles[+$('#speed-preset').value];updatePreview();};
$('#rx-speed-preset').oninput=()=>{updateSpeedControls();$('#shared-settings-note').hidden=true;};$('#rx-rate-auto').onchange=()=>{updateSpeedControls();updateReceiveSignalHelp();$('#shared-settings-note').hidden=true;};

function updatePreview(){
  updateSpeedControls();refreshSettingsLink();$('#signal-limit').hidden=true;$('#signal-limit').textContent='';
  const size=kind==='file'?(payloadFile?.data.length||0):utf.encode($('#message').value).length;
  $('#byte-count').textContent=formatNumber(size);$('#byte-count').style.color=size>MAX_PAYLOAD?'var(--accent)':'';
  $('#profile-help').textContent={balanced:'Start here for short transfers between nearby devices.',resilient:'Longer symbols for a noisy channel. Three times the transfer time.',fast:'For clean recordings and controlled conditions. Shorter, less forgiving symbols.'}[$('#profile').value];
  const total=+$('#repeat').value,modulation=$('#modulation').value,carrier=+$('#carrier').value;$('#carrier-field').hidden=modulation==='bfsk';const high=modulation!=='bfsk'&&carrier===20500;setLocalizedText($('#signal-high span'),'{modulation} · {frequency} kHz',{modulation:modulation==='bfsk'?'DBPSK':modulation.toUpperCase(),frequency:formatNumber(20.5,{minimumFractionDigits:1,maximumFractionDigits:1})});for(const [id,selected] of [['signal-standard',modulation==='bfsk'],['signal-high',high]]){const button=$('#'+id);button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}$('#open-device-guide').hidden=!high;$('#signal-choice-help').textContent=high?'A 20.5 kHz signal can be harder to hear, but some people and animals can hear it. Start low; device support varies.':modulation==='bfsk'?'Two distinct pitches carry your message. Choose high frequency to explore a different sound.':'The carrier is audible. Choose high frequency to explore 20.5 kHz.';$('#modulation-help').firstChild.textContent={bfsk:'BFSK uses two pitches. Match this setting in the receiver. ',dbpsk:'DBPSK uses changes in carrier phase. Match this setting in the receiver. ',dqpsk:'DQPSK sends two bits per phase change. Match this setting in the receiver. '}[modulation];setLocalizedText($('.transmission-settings summary span'),'{modulation}{carrier} · {profile} · {total} {copyWord}',{modulation:modulation.toUpperCase(),carrier:modulation==='bfsk'?'':` · ${formatNumber(carrier/1000,{minimumFractionDigits:1,maximumFractionDigits:1})} kHz`,profile:{source:pSource($('#profile').value)},total:formatNumber(total),copyWord:copyWord(total)});setLocalizedText($('#repeat-help'),total===1?'The receiver expects one copy and checks its CRC-32 checksum.':'The header announces {total} copies. Each must pass CRC-32 and match before the transfer is fully verified.',{total});
  const p=mode==='same'?PROFILES.same:phaseProfile(PROFILES[$('#profile').value],modulation,carrier);
  if(!listening){$('#scope-frequency').textContent=mode==='morse'?'700 Hz':mode==='same'?`${formatNumber(1.56,{minimumFractionDigits:2,maximumFractionDigits:2})} / ${formatNumber(2.08,{minimumFractionDigits:2,maximumFractionDigits:2})} kHz`:modulation==='bfsk'?`${formatNumber(1.2,{minimumFractionDigits:1,maximumFractionDigits:1})} / ${formatNumber(2.4,{minimumFractionDigits:1,maximumFractionDigits:1})} kHz`:`${formatNumber(carrier/1000,{minimumFractionDigits:1,maximumFractionDigits:1})} kHz`;$('#scope-protocol').textContent=mode==='morse'?'MORSE / OOK':mode==='same'?'SAME / AFSK':`${modulation.toUpperCase()} / v2`;setLocalizedText($('#scope-rate'),mode==='morse'?'{rate} WPM':'{rate} bit/s',{rate:formatNumber(mode==='morse'?+$('#morse-wpm').value:p.baud,{minimumFractionDigits:mode==='same'?2:0,maximumFractionDigits:mode==='same'?2:0})});}
  try{
    let seconds,signalSize=size;
    if(mode==='custom'){
      const {data,meta}=payload();
      seconds=customDuration(data,meta,p,total);
      if(!playing&&!listening){previewRate=p.carrier===20500?48000:12000;previewSamples=modulate(packet(data.slice(0,160),meta,{preambleBytes:customPreambleBytes(p)}),p,previewRate);}
    }else if(mode==='morse'){
      const signal=buildSignal();seconds=signal.samples.length/signal.sr;signalSize=signal.normalized.length;$('#morse-code').textContent=signal.code;$('#morse-normalized').textContent=signal.normalized;setLocalizedText($('#morse-unit'),'Dot {dot} ms · Dash {dash} ms',{dot:formatNumber(Math.round(signal.unit*1000)),dash:formatNumber(Math.round(signal.unit*3000))});
      if(!playing&&!listening){previewSamples=signal.samples;previewRate=signal.sr;}
    }else{
      const header=currentHeader();$('#header-preview').textContent=header;signalSize=header.length;
      const signal=buildSignal();seconds=signal.samples.length/signal.sr;if(signal.speech)seconds+=signal.speech.split(/\s+/).length/2.5;
      if(!playing&&!listening){previewSamples=signal.samples.subarray(0,Math.min(signal.samples.length,48000*5));previewRate=48000;}
    }
    $('#duration-estimate').textContent=timeLabel(seconds)+(mode==='same'&&$('#speak').checked&&!voice&&$('#announcement').value.trim()?' ≈':'');
    if(mode==='same'||mode==='morse')setLocalizedText($('#size-estimate'),'{count} chars',{count:formatNumber(signalSize)});else $('#size-estimate').textContent=bytesLabel(signalSize);$('#size-label').textContent=mode==='morse'?'Text':mode==='same'?'Header':'Message';
  }catch(error){$('#duration-estimate').textContent='—';$('#size-estimate').textContent=bytesLabel(size);if(!playing&&!listening)previewSamples=null;if(mode==='same')$('#header-preview').textContent=err(error);if(mode==='morse'){$('#morse-code').textContent=err(error);$('#morse-normalized').textContent='—';}}
  if(!playing&&!listening)drawScope();updateInspector();
}
$('#copy-settings').onclick=()=>copyText(refreshSettingsLink());
$('.share-settings').addEventListener('toggle',()=>{if($('.share-settings').open)refreshSettingsLink();});
$('#signal-standard').onclick=()=>{$('#modulation').value='bfsk';$('#carrier').value='1800';updatePreview();};
$('#signal-high').onclick=()=>{if($('#modulation').value==='bfsk')$('#modulation').value='dbpsk';$('#carrier').value='20500';updatePreview();};
$$('#morse-message,#morse-wpm,#message,#profile,#modulation,#carrier,#origin,#event,#locations,#duration,#sender,#issued,#auto-time,#attention,#speak,#announcement').forEach(n=>n.addEventListener('input',()=>{if(n.id==='morse-wpm'&&!listening){$('#morse-rx-wpm').value=n.value;updateReceiverSettings();}if(n.id==='auto-time')updateUTC();if(n.id==='locations')updateLocations();clearTimeout(previewTimer);previewTimer=setTimeout(updatePreview,120);}));
// Selecting the signal must not play it; only an explicit confirmation enables it.
$('#attention').onchange=()=>{
  if(!$('#attention').checked)return;
  $('#attention').checked=false;
  const dialog=$('#eas-attention-dialog');
  if(typeof dialog.showModal!=='function'){toast('This browser cannot show the attention signal warning. The signal remains off.',true);return;}
  if(!dialog.open)dialog.showModal();
};
$('#eas-attention-cancel').onclick=()=>$('#eas-attention-dialog').close();
$('#eas-attention-confirm').onclick=()=>{const dialog=$('#eas-attention-dialog');if(!dialog.open)return;dialog.close();if(mode==='same'){$('#attention').checked=true;updatePreview();}};


function newAudioContext(){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw Error('Web Audio is unavailable in this browser.');return new C({latencyHint:'interactive'});}
async function decodeRecordedAudio(context,file){try{return await context.decodeAudioData(await file.arrayBuffer());}catch{throw Error('Could not decode that recording.');}}
async function microphoneContext(){await micClosing;setAudioSession('play-and-record');micCtx=newAudioContext();await resumeAudioContext(micCtx);return micCtx;}
async function audioContext(){await micClosing;if(!ctx||ctx.state==='closed'){ctx=newAudioContext();}await resumeAudioContext(ctx);return ctx;}
async function loadVoice(file){
  if(!file)return;if(file.size>25*1024*1024)throw Error('Choose an announcement smaller than 25 MB.');const c=await audioContext(),audio=await decodeRecordedAudio(c,file);if(audio.duration>90)throw Error('Keep announcements to 90 seconds or less.');
  const data=new Float32Array(Math.ceil(audio.duration*48000));for(let ch=0;ch<audio.numberOfChannels;ch++){const samples=audio.getChannelData(ch);for(let i=0;i<data.length;i++){const at=i*audio.sampleRate/48000,a=Math.floor(at),f=at-a;data[i]+=((samples[a]||0)*(1-f)+(samples[a+1]||0)*f)/audio.numberOfChannels;}}
  voice={name:file.name,data};setLocalizedText($('#voice-status'),'{fileName} / {duration} / included in playback',{fileName:file.name,duration:timeLabel(audio.duration)});$('#clear-voice').hidden=false;updatePreview();
}
$('#voice-file').onchange=async e=>{try{await loadVoice(e.target.files[0]);}catch(e){toast(err(e),true);}e.target.value='';};
$('#clear-voice').onclick=()=>{voice=null;$('#voice-status').textContent='Recorded audio and browser speech are for playback only. EAS WAV export is unavailable.';$('#clear-voice').hidden=true;updatePreview();};
function setPlayUI(){
  updateLayout();
  $('#play-label').textContent=playing?'Stop':mode==='same'?'Play tones':'Transmit';$('#play-icon').textContent=playing?'■':'▶';
  $('#playback-timeline').hidden=!playing;$('#morse-stop-example').hidden=!playing;
  if(listening){$('#scope-state').textContent='Microphone · live';$('#scope-caption').textContent='Scaled input';}
  else{$('#scope-state').textContent=playing?(playbackMonitor?.speech?'Speech playback':'Output · live'):'Signal preview';$('#scope-caption').textContent=playing?(playbackMonitor?.speech?'Speech waveform unavailable':'Output waveform'):'25 ms sample';}
  paintPlayback();
}
function setAudioSession(type){const result=configureAudioSession(navigator,type),label={unsupported:'Unavailable',unavailable:'Unavailable',auto:'Automatic',playback:'Playback','play-and-record':'Playback and recording'}[result]||result;setLocalizedText($('#diag-session'),label);return result;}
function releaseAudioSession(){setAudioSession(listening?'play-and-record':'auto');}
function clockLabel(seconds){const tenths=Math.max(0,Math.floor(seconds*10)),minutes=Math.floor(tenths/600),secondsPart=(tenths%600)/10;return `${formatNumber(minutes)}:${formatNumber(secondsPart,{useGrouping:false,minimumIntegerDigits:2,minimumFractionDigits:1,maximumFractionDigits:1})}`;}
function paintPlayback(){
  if(!playing)return;const m=playbackMonitor;
  $('#playback-stage').textContent=m?.stage||'Preparing audio';
  const elapsed=m?Math.max(0,m.speech?(performance.now()-m.start)/1000:m.context.currentTime-m.start):0;
  const duration=m?.duration,progress=$('#playback-progress');progress.hidden=!Number.isFinite(duration);
  if(Number.isFinite(duration)){
    const position=Math.min(duration,elapsed);progress.max=duration||1;progress.value=position;
    $('#playback-time').textContent=`${clockLabel(position)} / ${clockLabel(duration)}`;
    setLocalizedAttribute(progress,'aria-valuetext','{position} of {duration} seconds',{position:formatNumber(position,{minimumFractionDigits:1,maximumFractionDigits:1}),duration:formatNumber(duration,{minimumFractionDigits:1,maximumFractionDigits:1})});
  }else $('#playback-time').textContent=m?.speech?`${clockLabel(elapsed)} elapsed`:'Starting…';
}
function stopPlayback(){playing=false;playToken++;customCancel?.();customCancel=null;if(source){try{source.stop();}catch{}source=null;}window.speechSynthesis?.cancel();speechCancel?.();speechCancel=null;playbackMonitor=null;outputAnalyser=null;outputWave=null;releaseAudioSession();setPlayUI();updatePreview();}
async function playBuffer(samples,sr,stage='Transmission'){
  const c=await audioContext();setAudioSession(listening?'play-and-record':'playback');
  await new Promise(resolve=>{
    const buffer=c.createBuffer(1,samples.length,sr);buffer.copyToChannel(samples,0);
    const currentSource=c.createBufferSource(),monitor=c.createAnalyser();monitor.fftSize=2048;
    source=currentSource;currentSource.buffer=buffer;currentSource.connect(monitor);monitor.connect(c.destination);
    outputAnalyser=monitor;outputWave=new Float32Array(monitor.fftSize);
    const state={context:c,start:c.currentTime,duration:samples.length/sr,stage};playbackMonitor=state;
    currentSource.onended=()=>{currentSource.disconnect();monitor.disconnect();if(outputAnalyser===monitor){outputAnalyser=null;outputWave=null;}resolve();};
    currentSource.start(state.start);setPlayUI();
  });
}
function speak(text){return new Promise((resolve,reject)=>{
  if(!('speechSynthesis'in window)){reject(Error('Speech synthesis is unavailable. Attach a recording instead.'));return;}
  const u=new SpeechSynthesisUtterance(text);playbackMonitor={speech:true,start:performance.now(),stage:'Spoken announcement'};setPlayUI();
  u.onend=()=>{speechCancel=null;resolve();};u.onerror=e=>{speechCancel=null;if(['canceled','interrupted'].includes(e.error))resolve();else reject(Error('Speech synthesis failed. Attach a recording instead.'));};speechCancel=resolve;window.speechSynthesis.speak(u);
});}
async function playCustom(plan,token){
  const c=await audioContext();if(token!==playToken)return;
  requireCarrierRate(plan.profile.carrier,c.sampleRate);
  const duration=createCustomStream(plan.data,plan.meta,plan.profile,plan.total,plan.id,c.sampleRate).duration;
  let node,finish=()=>{};
  if(c.audioWorklet && typeof AudioWorkletNode!=='undefined'){
    try{if(!loadedWorklets.has(c)){await c.audioWorklet.addModule(new URL('./custom-worklet.mjs?v=0.3.8',import.meta.url));loadedWorklets.add(c);}
    if(token!==playToken)return;
    node=new AudioWorkletNode(c,'signal-lab-custom-transmitter',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:plan});}catch(error){if(!c.createScriptProcessor)throw error;}
  }
  if(!node && c.createScriptProcessor){
    const generator=createCustomStream(plan.data,plan.meta,plan.profile,plan.total,plan.id,c.sampleRate);node=c.createScriptProcessor(4096,0,1);
    node.onaudioprocess=e=>{const out=e.outputBuffer.getChannelData(0);generator.readInto(out);if(generator.done)finish();};
  }else if(!node)throw Error('This browser cannot stream audio playback. Try a current standalone browser.');
  const monitor=c.createAnalyser();monitor.fftSize=2048;node.connect(monitor);monitor.connect(c.destination);outputAnalyser=monitor;outputWave=new Float32Array(monitor.fftSize);
  playbackMonitor={context:c,start:c.currentTime,duration,stage:'Transmission'};setPlayUI();
  await new Promise((resolve,reject)=>{let settled=false;finish=error=>{if(settled)return;settled=true;node.disconnect();monitor.disconnect();if(outputAnalyser===monitor){outputAnalyser=null;outputWave=null;}customCancel=null;if(error)reject(error);else resolve();};customCancel=()=>finish();if(node.port){node.port.onmessage=({data})=>{if(data==='done')finish();};node.onprocessorerror=()=>finish(Error('Audio streaming failed. Try a current standalone browser.'));}});
}
async function exportCustom(plan){
  const generator=createCustomStream(plan.data,plan.meta,plan.profile,plan.total,plan.id),parts=[];let writer;
  if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:'signal-lab-message.wav',types:[{description:'WAV audio',accept:{'audio/wav':['.wav']}}]});writer=await handle.createWritable();}
  const append=async bytes=>{if(writer)await writer.write(bytes);else parts.push(bytes);};
  try{await writeWavChunks(generator,append,{cancelled:()=>exportCancelled,onProgress:progress=>setLocalizedText($('#export-status'),'Preparing WAV · {percent}%',{percent:formatNumber(Math.round(progress*100))}),yieldControl:()=>new Promise(resolve=>setTimeout(resolve,0))});if(writer)await writer.close();else download(new Blob(parts,{type:'audio/wav'}),'signal-lab-message.wav','audio/wav');}
  catch(e){if(writer)await writer.abort().catch(()=>{});throw e;}
}
async function startPlayback(){
  try{
    const signal=mode==='custom'?null:buildSignal(),plan=mode==='custom'?customPlan():null;setAudioSession(listening?'play-and-record':'playback');await audioContext();playing=true;const token=++playToken;playbackMonitor=null;setPlayUI();
    if(plan)await playCustom(plan,token);else if(signal.speech){await playBuffer(signal.head,signal.sr,'SAME headers & attention');if(token!==playToken)return;await speak(signal.speech);if(token!==playToken)return;await playBuffer(signal.tail,signal.sr,'SAME end markers');}else await playBuffer(signal.samples,signal.sr);
    if(token===playToken){playing=false;source=null;playbackMonitor=null;releaseAudioSession();setPlayUI();updatePreview();}
  }catch(e){stopPlayback();toast(err(e),true);}
}
$('#play').onclick=()=>{
  if(playing){stopPlayback();return;}
  if(mode==='same'){
    const dialog=$('#eas-play-dialog');
    if(dialog.open)return;
    const hasAttention=$('#attention').checked;$('#eas-dialog-attention').hidden=!hasAttention;dialog.setAttribute('aria-describedby',hasAttention?'eas-dialog-description eas-dialog-attention eas-dialog-legal':'eas-dialog-description eas-dialog-legal');
    if(typeof dialog.showModal!=='function'){toast('This browser cannot show the EAS safety confirmation. Use the silent decoder test or a current browser.',true);return;}
    dialog.showModal();
    return;
  }
  startPlayback();
};
$('#eas-play-cancel').onclick=()=>$('#eas-play-dialog').close();
$('#eas-play-confirm').onclick=()=>{const dialog=$('#eas-play-dialog');if(!dialog.open)return;dialog.close();if(mode==='same'&&!playing)startPlayback();};
$('#cancel-export').onclick=()=>{exportCancelled=true;$('#export-status').textContent='Cancelling WAV export…';};
$('#export').onclick=async()=>{if(mode==='same'){toast('EAS WAV export is unavailable. Use the silent decoder test to study the signal.',true);return;}if(exporting)return;exporting=true;exportCancelled=false;$('#export').disabled=true;try{if(mode==='custom'){$('#export-status').hidden=false;$('#cancel-export').hidden=false;$('#export-status').textContent=window.showSaveFilePicker?'Preparing WAV…':'Preparing WAV in memory; large files may take time.';await exportCustom(customPlan());toast('WAV exported.');}else{const signal=buildSignal();download(wav(signal.samples,signal.sr),'signal-lab-morse.wav','audio/wav');toast('WAV exported.');}}catch(e){if(e.name!=='AbortError')toast(err(e),true);}finally{exporting=false;$('#export').disabled=false;$('#export-status').hidden=true;$('#cancel-export').hidden=true;}};
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!$('#eas-play-dialog').open&&!$('#eas-attention-dialog').open&&page==='encoder'&&!['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(document.activeElement?.tagName)&&!document.activeElement?.isContentEditable){e.preventDefault();$('#play').click();}});
for(const [id,freq]of [['bit-zero',1200],['bit-one',2400]])$(('#'+id)).onclick=async()=>{try{setAudioSession(listening?'play-and-record':'playback');const c=await audioContext(),o=c.createOscillator(),v=c.createGain();o.frequency.value=freq;o.connect(v);v.connect(c.destination);v.gain.setValueAtTime(0,c.currentTime);v.gain.linearRampToValueAtTime(.12,c.currentTime+.02);v.gain.setValueAtTime(.12,c.currentTime+.45);v.gain.linearRampToValueAtTime(0,c.currentTime+.5);o.start();o.stop(c.currentTime+.51);o.onended=()=>{o.disconnect();v.disconnect();if(!playing)releaseAudioSession();};}catch(e){if(!playing)releaseAudioSession();toast(err(e),true);}};
function drawExperiment(canvas,values,envelope=false){
  const width=Math.max(180,canvas.clientWidth||300),height=112,scale=window.devicePixelRatio||1;canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  const g=canvas.getContext('2d');g.setTransform(scale,0,0,scale,0,0);g.clearRect(0,0,width,height);
  g.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--line').trim();g.lineWidth=1;g.beginPath();g.moveTo(0,height/2);g.lineTo(width,height/2);g.stroke();
  g.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();g.lineWidth=envelope?1:1.5;g.beginPath();
  for(let x=0;x<width;x++){
    const start=Math.min(values.length-1,Math.floor(x/width*values.length));
    if(envelope){const end=Math.min(values.length,Math.max(start+1,Math.floor((x+1)/width*values.length)));let lo=values[start],hi=lo;for(let i=start+1;i<end;i++){lo=Math.min(lo,values[i]);hi=Math.max(hi,values[i]);}g.moveTo(x,height/2-hi*height*.42);g.lineTo(x,height/2-lo*height*.42);}
    else{const y=height/2-values[start]*(height*.42);if(x===0)g.moveTo(x,y);else g.lineTo(x,y);}
  }g.stroke();
}
function updateExperiment(){
  const mode=$('#experiment-mode').value;$('#experiment-carrier-field').hidden=mode==='bfsk';
  try{const result=lessonSignal($('#experiment-bits').value,mode,+$('#experiment-carrier').value),count=Math.min(result.samples.length,Math.round(result.sr*.02));
    drawExperiment($('#experiment-wave'),result.samples.subarray(0,count),true);drawExperiment($('#experiment-spectrum'),relativeSpectrum(result.samples,result.sr).map(x=>2*x-1));
    $('#experiment-status').textContent=`${mode.toUpperCase()} · 300 bit/s · first 20 ms shown`;
  }catch(error){$('#experiment-status').textContent=err(error);for(const id of ['experiment-wave','experiment-spectrum']){const canvas=$('#'+id);canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}}
}
for(const id of ['experiment-bits','experiment-mode','experiment-carrier'])$('#'+id).addEventListener('input',updateExperiment);
$('#byte-character').oninput=()=>{const s=$('#byte-character').value,bytes=utf.encode(s);$('#byte-output').textContent=bytes.length?Array.from(bytes,b=>`${b.toString(16).padStart(2,'0').toUpperCase()} → ${b.toString(2).padStart(8,'0')}`).join(' / '):'Type a character to see its UTF-8 bytes.';};

function status(message,state='ready'){if(message?.parts)setLocalizedParts($('#rx-status'),message.parts);else setLocalizedText($('#rx-status'),message);$('#rx-dot').classList.toggle('active',state==='active');$('#rx-dot').classList.toggle('error',state==='error');}
function setBusy(value){busy=value;$('#rx-signal').disabled=value||listening;updateSpeedControls();for(const id of ['loopback','demo','decoder-demo','audio-file'])$('#'+id).disabled=value||listening;$('#listen').disabled=value;$('.import-audio').classList.toggle('disabled',value||listening);}
function receiverPlan(){const [modulation,carrier]=$('#rx-signal').value.split(':');return {modulation,carrier:+carrier||1800};}
function updateReceiveSignalHelp(){const speed=$('#rx-rate-auto').checked?'Speed is detected automatically.':'Manual speed is on; match the sender’s speed.',carrier=receiverPlan().carrier===20500?'High frequency needs at least 44.1 kHz audio and compatible devices.':'SAME and Morse still work.';setLocalizedText($('#rx-signal-help'),'Match the sender’s signal and frequency. {speed} {carrier}',{speed:{source:speed},carrier:{source:carrier}});}
$('#rx-signal').onchange=()=>{updateReceiveSignalHelp();$('#shared-settings-note').hidden=true;};updateReceiveSignalHelp();
function requireCarrierRate(carrier,sr){if(+carrier===20500&&sr<44100)throw Error('The 20.5 kHz carrier needs an audio sample rate of at least 44.1 kHz. Try a different audio device or the 1.8 kHz carrier.');}
function makeWorker(sr,inputKind='recording',modulation=receiverPlan().modulation,carrier=receiverPlan().carrier,rate=$('#rx-rate-auto').checked?'auto':speedProfiles[+$('#rx-speed-preset').value]){
  if(modulation!=='bfsk')requireCarrierRate(carrier,sr);
  worker?.terminate();worker=new Worker(new URL('./receive-worker.mjs?v=0.4.1',import.meta.url),{type:'module'});const current=++job;lastTransfer=null;activeReceptionKey=null;lastSyncAt=0;$('#decode-stage').textContent='Waiting for a signal';
  $('#copy-progress').hidden=true;$('#result').hidden=true;$('#result-source').hidden=true;$('#empty-result').hidden=false;$('#earlier-receptions').hidden=true;$('#earlier-receptions-list').replaceChildren();
  worker.onmessage=({data})=>{
    if(data.job!==current)return;
    if(data.type==='audio-ack'){streamAck?.();streamAck=null;}
    else if(data.type==='transfer')receiveCustom(data.transfer,current);
    else if(data.type==='same-transfer')receiveSame(data.transfer,current);
    else if(data.type==='legacy')receiveLegacy(data.frame,current);
    else if(data.type==='morse-transfer')receiveTracked(data.transfer,current);
    else if(data.type==='sync'){if(inputKind==='microphone'&&!listening)return;lastSyncAt=performance.now();setLocalizedText($('#decode-stage'),'{profile} sync detected',{profile:{source:pSource(data.profile)}});status({parts:[{source:'{profile}: signal lock. Reading header…',values:{profile:{source:pSource(data.profile)}}}]},'active');}
    else if(data.type==='done'){
      $('#cancel-test').hidden=true;setBusy(false);
      if(inputKind==='microphone'&&!listening){resetInputMonitor();status(lastTransfer?{parts:[{source:'Microphone stopped. '},...transferStatus(lastTransfer).parts]}:'Microphone stopped. No valid message received this session.');return;}
      if(lastTransfer)status(transferStatus(lastTransfer),lastTransfer.state==='conflict'?'error':'ready');
      else status('No complete signal found. Try a cleaner recording or the Resilient profile.','error');
    }
  };
  worker.onerror=()=>{streamAck?.(true);streamAck=null;setBusy(false);cleanupMicrophone();status('Decoder stopped. Reload the app and try again.','error');toast('Audio worker failed.',true);};
  worker.postMessage({type:'init',job:current,sr,sensitivity,modulation,carrier,rate,morseWpm:+$('#morse-rx-wpm').value});return current;
}
try{sensitivity=localStorage.getItem('signal-lab-sensitivity')||'normal';}catch{}
if(!['low','normal','high'].includes(sensitivity))sensitivity='normal';
function updateReceiverSettings(){const labels={low:'Lower',normal:'Normal',high:'Higher'};setLocalizedText($('.receiver-settings summary span'),'{sensitivity} · {wpm} WPM Morse',{sensitivity:{source:labels[sensitivity]},wpm:formatNumber(+$('#morse-rx-wpm').value)});}
function updateSensitivity(){
  $('#sensitivity').value=sensitivity;updateReceiverSettings();
  $('#sensitivity-help').textContent={low:'Strict sync detection for a clean signal. Useful if background sounds cause frequent false locks.',normal:'Automatic tone balancing with a small allowance for damaged sync bits. Start here.',high:'Lower detection floor and a wider sync search for weak signals. May show more false locks; checksums remain mandatory.'}[sensitivity];
}
$('#sensitivity').onchange=()=>{sensitivity=$('#sensitivity').value;try{localStorage.setItem('signal-lab-sensitivity',sensitivity);}catch{}updateSensitivity();worker?.postMessage({type:'sensitivity',job,sensitivity});};
updateSensitivity();
$('#open-morse-settings').onclick=()=>{$('.receiver-settings').open=true;$('#morse-rx-wpm').focus();};
$('#morse-rx-wpm').onchange=()=>{updateReceiverSettings();worker?.postMessage({type:'morse-speed',job,wpm:+$('#morse-rx-wpm').value});};
async function decodeSignal(samples,sr,label){
  if(listening)throw Error('Stop the microphone before decoding a recording or running a demo.');setBusy(true);const labelSource=label==='the demo waveform'?'the demo waveform':label==='generated audio'?'generated audio':null;status({parts:[{source:'Decoding {label}…',values:{label:labelSource?{source:labelSource}:label}}]},'active');const current=makeWorker(sr,'recording',label==='the demo waveform'?'bfsk':undefined,undefined,label==='the demo waveform'?'balanced':undefined);if(label==='the demo waveform')setLocalizedText($('#result-source'),'Demo result · generated on this device');else if(label==='generated audio')setLocalizedText($('#result-source'),'Test result · generated on this device');else setLocalizedText($('#result-source'),'Imported recording · {fileName}',{fileName:label});$('#result-source').hidden=false;showPage('decoder');
  const length=sr*2;for(let at=0;at<samples.length;at+=length){const part=samples.slice(at,at+length);worker.postMessage({type:'audio',job:current,samples:part,done:at+length>=samples.length},[part.buffer]);}
  previewSamples=samples;previewRate=sr;drawScope();
}
async function decodeCustom(plan){
  if(listening)throw Error('Stop the microphone before testing a signal.');setBusy(true);const generator=createCustomStream(plan.data,plan.meta,plan.profile,plan.total,plan.id),current=makeWorker(generator.sr,'recording',plan.profile.modulation||'bfsk',plan.profile.carrier,speedProfiles.find(key=>PROFILES[key].baud===plan.profile.baud));$('#rx-speed-preset').value=String(speedProfiles.findIndex(key=>PROFILES[key].baud===plan.profile.baud));updateSpeedControls();$('#rx-signal').value=plan.profile.modulation?`${plan.profile.modulation}:${plan.profile.carrier}`:'bfsk';$('#shared-settings-note').hidden=true;updateReceiveSignalHelp();$('#result-source').textContent='Test result · generated on this device';$('#result-source').hidden=false;showPage('decoder');
  $('#cancel-test').textContent='Cancel test';$('#cancel-test').hidden=false;let sent=0;while(!generator.done&&current===job){const chunk=generator.read(generator.sr*2);sent+=chunk.length;status(`Testing generated audio · ${formatNumber(Math.round(sent/generator.length*100))}%`,'active');await new Promise((resolve,reject)=>{streamAck=failed=>failed?reject(Error('Decoder stopped.')):resolve();worker.postMessage({type:'audio',job:current,samples:chunk,done:generator.done,ack:true},[chunk.buffer]);});}
}
$('#cancel-test').onclick=()=>{job++;worker?.terminate();worker=null;streamAck?.();streamAck=null;$('#cancel-test').hidden=true;setBusy(false);status('Test cancelled.');};
$('#loopback').onclick=async()=>{try{if(mode==='custom')await decodeCustom(customPlan());else{if(mode==='morse')$('#morse-rx-wpm').value=$('#morse-wpm').value;const s=buildSignal();await decodeSignal(s.samples,s.sr,'generated audio');}}catch(e){setBusy(false);toast(err(e),true);}};
async function demo(){try{const id=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');const signal=makeDemo(id);await decodeSignal(signal.samples,signal.sr,'the demo waveform');}catch(e){setBusy(false);toast(err(e),true);}}
$('#demo').onclick=demo;$('#decoder-demo').onclick=demo;
async function decodeWavFile(file,info){
  if(!info.frames)throw Error('This WAV has no audio samples.');
  const current=makeWorker(info.sr);setLocalizedText($('#result-source'),'Imported WAV · {fileName}',{fileName:file.name});$('#result-source').hidden=false;showPage('decoder');
  $('#cancel-test').textContent='Cancel import';$('#cancel-test').hidden=false;let sent=0;
  try{
    for await(const chunk of readWavChunks(file,info)){
      if(current!==job)return;sent+=chunk.length;status(`Decoding WAV · ${formatNumber(Math.round(sent/info.frames*100))}%`,'active');
      await new Promise((resolve,reject)=>{streamAck=failed=>failed?reject(Error('Decoder stopped.')):resolve();worker.postMessage({type:'audio',job:current,samples:chunk,done:sent===info.frames,ack:true},[chunk.buffer]);});
    }
  }catch(error){
    // A failed read or post must not leave a worker or stale acknowledgement alive.
    if(current===job){job++;worker?.terminate();worker=null;streamAck=null;}
    throw error;
  }
}
$('#audio-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    if(listening)throw Error('Stop the microphone before importing a recording.');setBusy(true);status('Opening recording…','active');
    let info;try{info=await readWavInfo(file);}catch(error){if(!/not supported|only uncompressed/i.test(err(error))||file.size>50*1024*1024)throw error;}
    if(info){await decodeWavFile(file,info);return;}
    if(file.size>50*1024*1024)throw Error('For recordings over 50 MB, use an uncompressed PCM WAV.');
    const c=await audioContext(),audio=await decodeRecordedAudio(c,file);if(audio.duration>300)throw Error('For recordings over five minutes, use an uncompressed PCM WAV.');
    const samples=new Float32Array(audio.length);for(let ch=0;ch<audio.numberOfChannels;ch++){const channel=audio.getChannelData(ch);for(let i=0;i<audio.length;i++)samples[i]+=channel[i]/audio.numberOfChannels;}await decodeSignal(samples,audio.sampleRate,file.name);
  }catch(e){setBusy(false);$('#cancel-test').hidden=true;status('Could not decode that recording.','error');toast(err(e),true);}
};

// Stop microphone tracks before releasing processing nodes, including failures
// during initialization and permission/device changes.
function resetInputMonitor(){
  inputMetrics=null;captureReady=false;capturedSamples=0;
  $('#input-state').textContent='Microphone stopped';$('#input-db').textContent='—';
  $('#input-meter').setAttribute('aria-valuenow','-90');$('#input-meter').classList.remove('clipping');$('#input-meter-bar').style.width='0%';
  $('#input-detail').textContent='Microphone is off. Start it to receive another signal. Saved results remain in the Log.';
  $('#decode-stage').textContent=lastTransfer?'Stopped · last result below':'Stopped';
}
function cleanupMicrophone(){
  listening=false;$('#rx-signal').disabled=busy;listenToken++;const stoppedToken=listenToken;clearInterval(healthTimer);healthTimer=null;wakeLock.stop();
  const owned={stream,capture,context:micCtx};stream=null;capture=null;micCtx=null;analyser=null;liveWave=null;
  const closing=releaseMicrophone(owned);micClosing=Promise.all([micClosing,closing]).then(()=>{
    if(stoppedToken===listenToken&&!listening){setAudioSession(playing?'playback':'auto');$('#diag-context').textContent='Closed / released';}
  }).catch(()=>{if(stoppedToken===listenToken)$('#diag-context').textContent='Release failed / reload to retry';});
  setBusy(false);
  $('#listen-label').textContent='Start microphone';$('#listen').classList.remove('listening');$('#rx-badge').textContent='Idle';
  resetInputMonitor();setPlayUI();updatePreview();
  setAudioSession(playing?'playback':'auto');$('#diag-input').textContent='Stopped';$('#diagnostic-summary').textContent='Microphone stopped';$('#diag-context').textContent='Releasing…';$('#restart-microphone').hidden=true;$('#input-state').textContent='Microphone stopped';
}
function stopListening(){
  if(listening){
    worker?.postMessage({type:'finish',job});
    for(const item of [...receptions])if(item.key.startsWith(`${job}:`)&&item.transfer.state==='receiving'){
      const incomplete={...item.transfer,state:'incomplete'};
      if(incomplete.protocol==='same')receiveSame(incomplete,job);else if(incomplete.protocol==='morse')receiveTracked(incomplete,job);else receiveCustom(incomplete,job);
    }
  }
  cleanupMicrophone();status('Microphone stopped. Any missing copies are marked incomplete.');
}
function paintInputMetrics(samples,sampleRate){
  const now=performance.now();lastSampleAt=now;inputHistory.push(samples);capturedSamples+=samples.length;
  if(!captureReady&&capturedSamples>=sampleRate*.25){captureReady=true;$('#rx-badge').textContent='Live';if(!lastTransfer)status('Microphone ready. Transmit now; keep this tab in the foreground.','active');}$('#save-capture').disabled=false;
  if(now-lastMeterAt<180)return;lastMeterAt=now;inputMetrics=measureInput(samples,sampleRate,{highFrequency:receiverPlan().carrier===20500});
  const m=inputMetrics,db=Math.max(-90,Math.min(0,m.db)),quiet=m.db<-80;
  if(m.db<=-119)$('#input-db').textContent='−∞ dBFS';else setLocalizedText($('#input-db'),'{level} dBFS',{level:formatNumber(Math.round(m.db))});
  $('#input-meter').setAttribute('aria-valuenow',String(Math.round(db)));$('#input-meter').classList.toggle('clipping',m.clipping);$('#input-meter-bar').style.width=`${(db+90)/90*100}%`;
  $('#input-state').textContent=m.clipping?'Input is clipping':quiet?'Very quiet input':m.high>.15?'High-frequency energy detected':m.custom>.18?'Custom modem tones detected':m.same>.18?'SAME tones detected':m.morse>.45?'Morse tone detected':'Microphone is hearing audio';
  $('#input-detail').textContent=m.clipping?'Lower the Mac playback volume to reduce distortion.':quiet?'Little audio is reaching the microphone. Check playback volume and move the devices closer.':m.high>.15?'Energy near 20.5 kHz is reaching the microphone. Other sounds can also appear here; a valid packet still needs to be decoded.':m.custom>.18?'Custom tone energy is arriving. If no header locks, try Resilient and a short message.':m.same>.18?'SAME tone energy is arriving. Waiting for complete header bursts.':m.morse>.45?'700 Hz tone energy is arriving. Match Morse receive speed to the sender.':'Input is active. Play a signal from the other device; ordinary speech and breath do not contain a modem packet.';
}
function checkCaptureHealth(){
  if(!listening)return;const now=performance.now(),contextState=micCtx?.state||'closed',paused=contextState!=='running',stalled=now-(lastSampleAt||captureStarted)>3000,track=stream?.getAudioTracks()[0],muted=track?.muted||track?.readyState==='ended';
  if(paused&&contextState!=='closed'&&document.visibilityState==='visible'&&now-lastResumeAt>3000){lastResumeAt=now;resumeAudioContext(micCtx).catch(()=>{});}
  setLocalizedText($('#diag-context'),contextState);$('#rx-badge').textContent=paused||stalled||muted?'Paused':captureReady?'Live':'Starting';$('#restart-microphone').hidden=!(paused||stalled||muted);
  if(paused||stalled||muted){
    if(paused)setLocalizedText($('#input-state'),'Audio context {state}',{state:{source:contextState}});else $('#input-state').textContent=muted?'Microphone muted by the system':'No microphone samples arriving';
    $('#input-detail').textContent='Tap Restart microphone, keep this tab in the foreground, and check that no call or other app is using audio.';
    status('Microphone capture is paused. Tap Restart microphone.','error');
  }else if(!lastTransfer&&lastSyncAt&&now-lastSyncAt>5000){
    $('#decode-stage').textContent='Sync seen; no complete valid packet yet';
  }
}
$('#restart-microphone').onclick=()=>{stopListening();$('#listen').onclick();};
$('#save-capture').onclick=()=>{if(!inputHistory?.length){toast('No microphone samples have arrived yet.',true);return;}download(wav(inputHistory.samples(),inputHistory.sampleRate),'signal-lab-microphone.wav','audio/wav');toast('Saved the captured microphone audio locally.');};
const wakeLock=new ListeningWakeLock(navigator,document,state=>$('#diag-wake').textContent=state);
document.addEventListener('visibilitychange',()=>{if(listening&&document.visibilityState==='visible'){wakeLock.ensure();resumeAudioContext(micCtx).catch(()=>checkCaptureHealth());}});

$('#diag-secure').textContent=window.isSecureContext?'Yes / secure context':'No / HTTPS required';$('#diag-api').textContent=navigator.mediaDevices?.getUserMedia?'Available':'Unavailable';
$('#listen').onclick=async()=>{
  if(listening){stopListening();return;}
  $('#listen').disabled=true;const token=++listenToken;
  try{
    if(!window.isSecureContext)throw Error('Microphone capture requires HTTPS or localhost. Open the live HTTPS app.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser does not expose microphone access. Open the standalone app in Safari, Chrome, Firefox, or Edge.');
    status('Waiting for microphone permission…','active');const c=await microphoneContext();
    if(token!==listenToken){await releaseMicrophone({context:c});if(micCtx===c)micCtx=null;return;}
    const input=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
    if(token!==listenToken){input.getTracks().forEach(t=>t.stop());return;}stream=input;
    await resumeAudioContext(c);
    const current=makeWorker(c.sampleRate,'microphone');inputHistory=new PcmHistory(c.sampleRate,30);inputMetrics=null;captureReady=false;capturedSamples=0;lastSampleAt=0;lastMeterAt=0;$('#save-capture').disabled=true;
    capture=await attachCapture(c,input,samples=>{if(listening&&current===job){paintInputMetrics(samples,c.sampleRate);worker?.postMessage({type:'audio',job:current,samples},[samples.buffer]);}});
    await resumeAudioContext(c);
    if(token!==listenToken){capture.close();input.getTracks().forEach(t=>t.stop());return;}
    analyser=capture.analyser;listening=true;$('#rx-signal').disabled=true;setBusy(false);wakeLock.start();captureStarted=performance.now();$('#input-monitor').hidden=false;$('#input-state').textContent='Waiting for microphone samples';healthTimer=setInterval(checkCaptureHealth,500);$('#listen-label').textContent='Stop microphone';$('#listen').classList.add('listening');$('#rx-badge').textContent='Starting';setPlayUI();
    $('#scope-protocol').textContent='Data / SAME / Morse';setLocalizedText($('#scope-rate'),'{rate} kHz',{rate:formatNumber(c.sampleRate/1000,{minimumFractionDigits:1,maximumFractionDigits:1})});$('#scope-frequency').textContent=receiverPlan().modulation!=='bfsk'&&receiverPlan().carrier===20500?`${formatNumber(.7,{minimumFractionDigits:1,maximumFractionDigits:1})}–${formatNumber(20.5,{minimumFractionDigits:1,maximumFractionDigits:1})} kHz`:`${formatNumber(.7,{minimumFractionDigits:1,maximumFractionDigits:1})}–${formatNumber(2.4,{minimumFractionDigits:1,maximumFractionDigits:1})} kHz`;
    $('#diag-engine').textContent=capture.method;$('#diag-rate').textContent=`${formatNumber(c.sampleRate)} Hz`;$('#diag-input').textContent=input.getAudioTracks()[0]?.label||'Default microphone';$('#diagnostic-summary').textContent=capture.method;
    setLocalizedText($('#diag-context'),c.state);
    const settings=input.getAudioTracks()[0]?.getSettings?.()||{};
    setLocalizedText($('#diag-processing'),'{echo}: {echoState} / {noise}: {noiseState} / {agc}: {agcState}',{echo:{source:'Echo'},echoState:{source:settings.echoCancellation===true?'on':settings.echoCancellation===false?'off':'not reported'},noise:{source:'Noise'},noiseState:{source:settings.noiseSuppression===true?'on':settings.noiseSuppression===false?'off':'not reported'},agc:{source:'AGC'},agcState:{source:settings.autoGainControl===true?'on':settings.autoGainControl===false?'off':'not reported'}});
    if(capture.workletError)setLocalizedAttribute($('#diag-engine'),'title','AudioWorklet is unavailable');
    input.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(listening){checkCaptureHealth();status('Microphone input ended. Listening remains enabled; reconnect the input and tap Restart microphone.','error');}}));
    status('Starting audio capture. Wait for Microphone ready before transmitting.','active');
  }catch(error){
    cleanupMicrophone();const message={NotAllowedError:'Microphone access was declined or blocked by this browser. Allow it in site settings, or open the standalone app.',NotFoundError:'No microphone found. Connect one, or import a recording.',NotReadableError:'Microphone unavailable. Close other apps using it and retry.'}[error.name]||err(error);
    status(message,'error');$('#diag-engine').textContent='Failed to start';$('#diagnostics').open=true;toast(message,true);
  }finally{$('#listen').disabled=false;}
};

function transferStatus(t){
  if(t.protocol==='morse')return {parts:[{source:t.state==='decoded'?'Morse decoded · timing only, no checksum.':t.state==='incomplete'?'Morse reception ended mid-message. Review the decoded text.':'Receiving Morse characters…'}]};
  if(t.state==='conflict')return {parts:[{source:'Copies conflict. This transfer is not verified.'}]};
  const received=t.protocol==='same'?t.copies:t.received.length;
  if(t.protocol==='same')return {parts:[{source:'{received} / 3 matching SAME headers',values:{received:formatNumber(received)}},...(t.endCopies?[{source:' · {received} / 3 end bursts',values:{received:formatNumber(t.endCopies)}}]:[]),...(t.state==='incomplete'?[{source:' · incomplete'}]:[]),{source:'.'}]};
  if(t.legacy)return {parts:[{source:'Legacy packet passed CRC-32. Its format does not declare a copy plan.'}]};
  if(t.state==='verified')return {parts:[{source:'{received} / {total} copies verified.',values:{received:formatNumber(received),total:formatNumber(t.total)}},{source:' '},{source:t.total>1?'All payload bytes match.':'CRC-32 passed.'}]};
  if(t.state==='incomplete'){const missing=Array.from({length:t.total},(_,i)=>i).filter(i=>!t.received.includes(i)).map(i=>i+1);return {parts:[{source:'{received} / {total} valid copies.',values:{received:formatNumber(received),total:formatNumber(t.total)}},{source:' '},{source:missing.length===1?'Copy {index} was not verified.':'Copies {indices} were not verified.',values:missing.length===1?{index:formatNumber(missing[0])}:{indices:missing.map(value=>formatNumber(value)).join(', ')} }]};}
  return {parts:[{source:'{received} / {total} copies verified.',values:{received:formatNumber(received),total:formatNumber(t.total)}},{source:' '},{source:'Waiting for {count} more.',values:{count:formatNumber(t.total-received)}}]};
}
function renderProgress(t){
  if(t.protocol==='morse'){$('#copy-progress').hidden=true;return;}
  $('#copy-progress').hidden=false;const isSame=t.protocol==='same',received=isSame?Array.from({length:t.copies},(_,i)=>i):t.received;
  if(isSame||t.legacy)setLocalizedText($('#copy-plan'),isSame?'SAME / three header bursts':'Legacy packet / no copy plan');
  else setLocalizedText($('#copy-plan'),'Transfer {id} / {total} {copyWord} expected',{id:t.id.slice(0,8),total:formatNumber(t.total),copyWord:copyWord(t.total)});
  $('#copy-status').textContent=`${formatNumber(received.length)} / ${formatNumber(t.total)}`;
  const slots=$('#copy-slots');slots.replaceChildren();for(let i=0;i<t.total;i++){const valid=received.includes(i),announced=!isSame&&t.announced?.includes(i),state=valid?'received':announced&&t.state==='receiving'?'announced':'';const slot=el('div','copy-slot '+state),label=valid?(isSame?'Matching':'Verified'):t.failed?.includes(i)?'CRC failed':announced?'Header only':t.state==='incomplete'?'Not detected':'Waiting';slot.append(uiEl('span','',`${valid?'✓':t.state==='incomplete'?'–':announced?'⋯':'○'} Copy ${formatNumber(i+1)}`),uiEl('small','',label));slots.append(slot);}
  if(isSame){setLocalizedParts($('#copy-explanation'),[{source:'{copies}/3 parsed headers match. SAME has no checksum; matching headers do not authenticate an alert.',values:{copies:formatNumber(t.copies)}},...(t.endCopies?[{source:' '},{source:'End markers: {copies}/3.',values:{copies:formatNumber(t.endCopies)}}]:[])]);return;}
  let explanation;
  if(t.state==='conflict')explanation='Different content was received under the same transfer ID. Verification failed.';
  else if(t.legacy)explanation='This older packet has no declared repetition information.';
  else if(t.state==='verified')explanation=t.total>1?'Every copy passed CRC-32. Metadata and original payload bytes match.':'The declared single copy passed its full-frame CRC-32 check.';
  else if(t.state==='incomplete')explanation='Not detected = no valid header. Header only = plan decoded, but no valid full payload. CRC failed = a complete candidate failed its checksum. Verified = full checksum passed.';
  else explanation='The header declares the plan before the payload completes. Only full checksum-valid copies earn a check.';
  setLocalizedText($('#copy-explanation'),explanation);
}
function upsertReception(t,key){let item=receptions.find(r=>r.key===key);if(!item){item={key,at:new Date(),transfer:t};receptions.unshift(item);if(receptions.length>50)receptions.pop();}else item.transfer=t;$('#count').textContent=receptions.length;renderHistory();return item;}
function showTransfer(t,item){$('#decode-stage').textContent=t.protocol==='morse'?(t.state==='decoded'?'Morse decoded':t.state==='incomplete'?'Morse interrupted':'Reading Morse timing'):t.state==='verified'?'Payload verified':t.state==='incomplete'?'Incomplete copy set':t.state==='conflict'?'Copy conflict':t.frame?'Payload received; checking copies':'Transfer header read';renderProgress(t);$('#empty-result').hidden=true;$('#result').hidden=false;$('#result').replaceChildren(resultCard(t,item?.at||new Date()));status(transferStatus(t),t.state==='conflict'?'error':listening||busy?'active':'ready');}
function receiveTracked(value,current){const key=`${current}:${value.id}`,known=receptions.some(r=>r.key===key),item=upsertReception(value,key);if(!known||key===activeReceptionKey){activeReceptionKey=key;lastTransfer=value;showTransfer(value,item);}renderEarlierReceptions();}
function receiveCustom(t,current){receiveTracked({...t,protocol:'custom'},current);}
function receiveSame(t,current){receiveTracked(t,current);}
function receiveLegacy(frame,current){const t={id:`legacy-${frame.crc}`,protocol:'custom',frame,total:1,received:[0],announced:[0],state:'verified',legacy:true};lastTransfer=t;const key=`${current}:${t.id}`,item=upsertReception(t,key);activeReceptionKey=key;showTransfer(t,item);renderEarlierReceptions();}
function resultCard(t,at){
  const frame=t.frame,card=el('div'),heading=el('div','result-heading');
  const label=t.state==='conflict'?'Copy conflict':t.protocol==='morse'?(t.state==='decoded'?'Morse decoded':t.state==='incomplete'?'Morse interrupted':'Receiving Morse'):t.protocol==='same'?(t.copies===3?'3 matching SAME headers':'SAME header / '+formatNumber(t.copies)+' of 3'):t.legacy?'Legacy / CRC passed':t.state==='verified'?`${formatNumber(t.total)} of ${formatNumber(t.total)} copies verified`:t.state==='incomplete'?'Incomplete transfer':!frame?'Receiving transfer':'Payload received / verifying';
  heading.append(uiEl('strong',t.state==='conflict'?'conflict':t.state!=='verified'?'pending':'',label));const time=el('time','',formatDate(at,{hour:'2-digit',minute:'2-digit',second:'2-digit'}));time.dateTime=at.toISOString();heading.append(time);card.append(heading);
  if(t.protocol==='morse'){
    card.append(el('pre','result-text',frame.text||'…'),el('div','morse-received-code',frame.code||''));
    const actions=el('div','result-actions'),copy=uiEl('button','text-button','Copy text'),save=uiEl('button','text-button','Save text ↓');copy.onclick=()=>copyText(frame.text);save.onclick=()=>download(frame.text,'received-morse.txt','text/plain');actions.append(copy,save);
    const meta=el('div','result-meta');setLocalizedText(meta,'{wpm} WPM / {frequency} Hz / timing decoded · no checksum',{wpm:formatNumber(frame.wpm),frequency:formatNumber(frame.frequency)});card.append(actions,meta);return card;
  }
  if(!frame){card.append(uiEl('p','field-help',t.state==='incomplete'?'A valid transfer header arrived, but no full payload passed its checksum.':'Transfer header received. Waiting for a checksum-valid payload.'),uiEl('div','result-meta',`${t.profile} / ${t.total} copies expected / ${formatNumber(t.payloadLength)} payload bytes / ID ${t.id}`));return card;}
  if(frame.protocol==='custom'){
    const isFile=!['text','json'].includes(frame.meta.kind),text=textDecoder.decode(frame.payload);
    if(isFile)card.append(el('p','result-text',String(frame.meta.name||'received.bin')),el('p','field-help',`${bytesLabel(frame.payload.length)} / ${String(frame.meta.mime||'binary data')}`));else card.append(el('pre','result-text',text));
    const actions=el('div','result-actions'),save=uiEl('button','text-button',isFile?'Save original file ↓':'Save payload ↓');save.onclick=()=>download(frame.payload,isFile?String(frame.meta.name||'received.bin').replace(/[\/\\\x00-\x1f]/g,'_'):frame.meta.kind==='json'?'received.json':'received.txt');actions.append(save);
    if(!isFile){const copy=uiEl('button','text-button','Copy text');copy.onclick=()=>copyText(text);actions.append(copy);}const meta=el('div','result-meta'),carrier=frame.carrier?` · ${formatNumber(frame.carrier/1000,{minimumFractionDigits:1,maximumFractionDigits:1})} kHz`:'';setLocalizedParts(meta,[{source:'{modulation}{carrier} · {profile}',values:{modulation:(frame.modulation||'bfsk').toUpperCase(),carrier,profile:{source:frame.profile}}},{source:' / '},{source:bytesLabel(frame.payload.length)},{source:' / CRC-32 passed'},...(t.total>1?[{source:' / {count} matching copies',values:{count:formatNumber(t.received.length)}}]:[])]);card.append(actions,meta);
    if(t.state==='incomplete'||t.state==='conflict')card.append(uiEl('p','field-help',t.state==='conflict'?'Content differs across copies. Download contains the first valid copy.':'These bytes passed their checksum, but the declared set of copies is incomplete.'));
  }else{
    const fields=el('div','decoded-fields'),events=EAS_EVENTS;
    const names=frame.locations.map(c=>{const d=describeLocation(c,locationRows),area=d?.name?`${d.name}, ${translate(d.state||'')}`:'Unknown area';return `${c} / ${area}`;}).join('; ');
    for(const [name,value]of [['Event',frame.event],['Originator',frame.origin],['Geographical areas',names],['Purge time',`${formatNumber(+frame.duration.slice(0,2))}h ${formatNumber(+frame.duration.slice(2))}m`],['Issued / UTC',`Day ${formatNumber(+frame.issued.slice(0,3))} / ${frame.issued.slice(3,5)}:${frame.issued.slice(5)}`],['Station ID',frame.sender]]){const d=el('div'),valueNode=el('div');if(name==='Event'){const eventName=events[value]||'Event code',description=uiEl('span','',eventName);if(getLocale()!=='en'&&translate(eventName)===eventName)description.lang='en';valueNode.append(el('span','',`${value} / `),description);}else valueNode.append(el('span','',value));d.append(uiEl('span','',name),valueNode);fields.append(d);}card.append(fields,el('div','decoded-raw',frame.raw),uiEl('div','result-meta',`${formatNumber(t.copies)}/3 matching headers / ${formatNumber(t.endCopies)}/3 end bursts / SAME has no CRC`));
  }
  return card;
}
function renderEarlierReceptions(){const section=$('#earlier-receptions'),list=$('#earlier-receptions-list'),previous=receptions.filter(item=>item.key.startsWith(`${job}:`)&&item.key!==activeReceptionKey);section.hidden=previous.length===0;list.replaceChildren();for(const item of previous){const card=el('article','earlier-reception-card');card.append(resultCard(item.transfer,item.at));list.append(card);}}
function renderHistory(){const list=$('#history-list');list.replaceChildren();if(!receptions.length){list.append(uiEl('div','history-empty','No receptions yet.'));return;}for(const item of receptions){const card=el('article','history-card');card.append(resultCard(item.transfer,item.at));list.append(card);}}
$('#clear-history').onclick=()=>{receptions=[];$('#count').textContent='0';renderHistory();renderEarlierReceptions();toast('Log cleared.');};

function renderMorseTables(){
  const root=$('#morse-tables');root.replaceChildren();
  for(const [title,chars]of [['Letters','ABCDEFGHIJKLMNOPQRSTUVWXYZÉ'],['Numbers','0123456789'],['Punctuation',".,:?'-/()\"=+@"]]){
    const table=el('table','morse-table'),caption=uiEl('caption','',title),head=el('thead'),row=el('tr'),body=el('tbody');
    for(const text of ['Character','Morse','Character','Morse']){const th=uiEl('th','',text);th.scope='col';row.append(th);}head.append(row);
    const half=Math.ceil(chars.length/2);
    for(let i=0;i<half;i++){
      const tr=el('tr');for(const at of [i,i+half]){
        const char=chars[at],td=el('td'),code=el('td');if(char){const button=el('button','morse-key',char);setLocalizedAttribute(button,'aria-label',`Hear ${char} in Morse code`);button.onclick=()=>playMorseExample(char);td.append(button);code.append(el('code','',MORSE[char].replaceAll('.','·').replaceAll('-','−')));}tr.append(td,code);
      }body.append(tr);
    }table.append(caption,head,body);root.append(table);
  }
}
async function playMorseExample(char){
  if(playing)stopPlayback();
  try{const audio=morseSignal(char,15,48000,{tail:.2});setAudioSession(listening?'play-and-record':'playback');await audioContext();playing=true;const token=++playToken;await playBuffer(audio.samples,audio.sr,`Morse · ${char} · 15 WPM`);if(token===playToken){playing=false;playbackMonitor=null;releaseAudioSession();setPlayUI();updatePreview();}}
  catch(e){stopPlayback();toast(err(e),true);}
}
$('#morse-stop-example').onclick=()=>stopPlayback();
renderMorseTables();
const canvas=$('#scope'),g=canvas.getContext('2d');
function drawScope(){
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
  const dpr=window.devicePixelRatio||1;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=w*dpr;canvas.height=h*dpr;}
  g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  let samples=previewSamples,sampleRate=previewRate,live=false;
  if(listening&&analyser){if(!liveWave||liveWave.length!==analyser.fftSize)liveWave=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(liveWave);samples=liveWave;sampleRate=micCtx.sampleRate;live=true;}
  else if(playing){
    samples=null;
    if(outputAnalyser&&outputWave){outputAnalyser.getFloatTimeDomainData(outputWave);samples=outputWave;sampleRate=playbackMonitor.context.sampleRate;live=true;}
  }
  const count=samples?Math.min(samples.length,Math.round(sampleRate*.025)):0;
  let offset=0;
  if(!live&&samples)while(offset<samples.length-count&&Math.abs(samples[offset])<.02)offset++;
  const displayGain=listening?Math.min(1000,Math.max(1,.18/Math.max(inputMetrics?.rms||0,1e-5))):1;
  $('#scope-window-end').textContent=count?`${formatNumber(Math.round(count/sampleRate*1000))} ms`:'—';
  g.strokeStyle='#c1f794';g.lineWidth=1;g.beginPath();
  if(!count){g.moveTo(0,h/2);g.lineTo(w,h/2);}else for(let x=0;x<w;x++){
    const at=offset+Math.min(count-1,Math.floor(x/w*count)),y=h/2-Math.max(-1,Math.min(1,samples[at]*displayGain))*h*.45;
    x?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.stroke();
}
function animate(time){if(time-lastPaint>70&&(playing||listening)){drawScope();paintPlayback();lastPaint=time;}requestAnimationFrame(animate);}requestAnimationFrame(animate);new ResizeObserver(drawScope).observe(canvas);
window.addEventListener('pagehide',()=>{stopPlayback();cleanupMicrophone();worker?.terminate();ctx?.close();});
updatePreview();updateLocations();const shared=readReceiverLink(location.href);if(shared){$('#rx-signal').value=shared.modulation==='bfsk'?'bfsk':`${shared.modulation}:${shared.carrier}`;$('#rx-rate-auto').checked=true;$('#rx-speed-preset').value=String(speedProfiles.indexOf(shared.rate));updateSpeedControls();updateReceiveSignalHelp();setLocalizedText($('#shared-settings-note'),'Shared settings applied. Sender speed: {profile} · {baud} bit/s. The receiver detects speed automatically; start the microphone when ready.',{profile:{source:pSource(shared.rate)},baud:formatNumber(PROFILES[shared.rate].baud)});$('#shared-settings-note').hidden=false;}const [initial,topic]=location.hash.slice(1).split('/');if(initial==='learn')openLesson(topic);else showPage(initial);
