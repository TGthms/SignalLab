import {PROFILES,MAX_PAYLOAD,packet,modulate,joinAudio,sameBytes,sameHeader,wav} from './codec.mjs?v=0.2.1';
import {attachCapture,resumeAudioContext} from './capture.mjs?v=0.2.1';
import {measureInput,PcmHistory} from './reception.mjs?v=0.2.1';
import {describeLocation,searchLocations,STATES} from './locations.mjs?v=0.2.1';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const utf=new TextEncoder(),textDecoder=new TextDecoder();
const drafts={text:$('#message').value,json:JSON.stringify({message:'Hello through sound',experiment:1},null,2)};
let mode='custom',kind='text',page='encoder',lesson='modem',payloadFile=null,voice=null;
let ctx=null,source=null,gain=null,playing=false,playToken=0,speechCancel=null;
let worker=null,job=0,busy=false,listening=false,stream=null,capture=null,analyser=null,listenToken=0;
let receptions=[],lastTransfer=null,locationRows=[],themePreference='system',toastTimer;
let inputHistory=null,inputMetrics=null,captureStarted=0,lastSampleAt=0,lastMeterAt=0,healthTimer=null,lastSyncAt=0;
let previewSamples=null,previewRate=12000,liveWave=null,lastPaint=0,scopeStart=0,scopeDuration=0,previewTimer;
const bytesLabel=n=>n<1024?`${n} B`:`${(n/1024).toFixed(n%1024?1:0)} KiB`;
const timeLabel=n=>n>=60?`${Math.floor(n/60)}m ${Math.ceil(n%60)}s`:`${n.toFixed(1)}s`;
const err=e=>e?.message||String(e);
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function toast(message,error=false){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?8000:4500);}
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
  page=['encoder','decoder','learn','history'].includes(next)?next:'encoder';
  $$('.page').forEach(n=>n.hidden=n.id!==page);$$('.nav').forEach(n=>{n.classList.toggle('active',n.dataset.page===page);n.setAttribute('aria-current',n.dataset.page===page?'page':'false');});
  const hash=page==='learn'?`#learn/${lesson}`:`#${page}`;if(location.hash!==hash)window.history.replaceState(null,'',hash);
  updateInspector();requestAnimationFrame(drawScope);
}
function openLesson(next){lesson=['modem','verification','same','reception'].includes(next)?next:'modem';$$('.lesson').forEach(n=>n.hidden=n.id!==`lesson-${lesson}`);$$('.lesson-tabs [data-lesson]').forEach(n=>n.classList.toggle('selected',n.dataset.lesson===lesson));showPage('learn');}
$$('[data-page]').forEach(n=>n.onclick=()=>showPage(n.dataset.page));
$$('[data-lesson]').forEach(n=>n.onclick=()=>openLesson(n.dataset.lesson));
window.addEventListener('hashchange',()=>{const [next,topic]=location.hash.slice(1).split('/');if(next==='learn')openLesson(topic||lesson);else showPage(next);});
function updateInspector(){
  const sameMode=mode==='same'&&page==='encoder';$('#rail-location').hidden=!sameMode;
  $('#inspector-title').textContent=page==='decoder'?'Every copy counts':sameMode?'Read the location code':page==='learn'?'Try it, then inspect it':'Inside the signal';
  $('#inspector-copy').textContent=page==='decoder'?'The opening header declares how many copies to expect. Each full copy must pass its checksum and match the others.':sameMode?'PSSCCC is the Geographical Area block. The leading digit chooses a partition; the other five identify a state and county or equivalent area.':page==='learn'?'Use the encoder’s loopback control to test an actual audio waveform. Then watch the decoder count and compare its copies.':'Two tones represent the bits in your message. The receiver finds the timing, reads the header, and checks the data.';
  $('#inspector-learn').dataset.lesson=page==='decoder'?'verification':sameMode?'same':'modem';
  $('.keyboard-hint').hidden=page!=='encoder';
}

// Bundled NOAA names keep place lookup local. Unknown codes are never invented.
fetch(new URL('./data/locations.json',import.meta.url)).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{locationRows=data.rows;updateLocations();}).catch(()=>{$('#location-summary').textContent='Location names could not load. Code format explanations are still available.';});
function updateLocations(){
  const codes=$('#locations').value.split(/[,\s]+/).filter(Boolean),summary=$('#location-summary');summary.replaceChildren();
  for(const code of codes.slice(0,31)){
    const d=describeLocation(code,locationRows),card=el('div','location-chip');
    if(!d){card.append(el('p','',`${code}: enter six digits (PSSCCC).`));summary.append(card);continue;}
    const top=el('div','location-chip-top');top.append(el('code','',code),el('strong','',d.label));card.append(top);
    card.append(el('p','',d.partition==='0'?'All / unspecified portions':`${d.partitionName} partition — only where locally defined`));
    const parts=el('div','code-parts');parts.append(el('span','',`P ${d.partition}`),document.createTextNode(' / '),el('span','',`SS ${d.stateCode}`),document.createTextNode(` ${d.state||''} / `),el('span','',`CCC ${d.countyCode}`),document.createTextNode(` ${d.name||'County / equivalent area'}`));card.append(parts);summary.append(card);
  }
  if(codes.length>31)summary.append(el('p','field-help','A SAME header can contain at most 31 location codes.'));
  const first=describeLocation(codes[0]||'',locationRows),rail=$('#rail-location');rail.replaceChildren();
  if(first)rail.append(el('code','',`${first.partition} · ${first.stateCode} · ${first.countyCode}`),el('div','',first.label),el('div','field-help',first.partitionName));
}
$('#toggle-location-help').onclick=()=>{const details=$('#location-help');details.open=!details.open;$('#toggle-location-help').setAttribute('aria-expanded',String(details.open));};
$('#location-help').addEventListener('toggle',()=>$('#toggle-location-help').setAttribute('aria-expanded',String($('#location-help').open)));
$('#location-search').oninput=()=>{
  const container=$('#location-search-results'),query=$('#location-search').value;container.replaceChildren();if(query.trim().length<2)return;
  const rows=searchLocations(query,locationRows);if(!rows.length){container.append(el('div','search-empty','No matches in the bundled NOAA directory.'));return;}
  for(const [code,name,abbr]of rows){const button=el('button');button.type='button';button.append(el('span','',`${name}, ${STATES[abbr]||abbr}`),el('code','',code+' +'));button.onclick=()=>{const codes=$('#locations').value.split(/[,\s]+/).filter(Boolean);if(!codes.includes(code)){if(codes.length>=31){toast('A header can include at most 31 areas.',true);return;}codes.push(code);$('#locations').value=codes.join(', ');}$('#location-search').value='';container.replaceChildren();updateLocations();updatePreview();};container.append(button);}
};
$('#copy-header').onclick=()=>{try{copyText(currentHeader());}catch(e){toast(err(e),true);}};

function setMode(next){if(playing)stopPlayback();mode=next;$('#custom-fields').hidden=mode!=='custom';$('#same-fields').hidden=mode!=='same';['custom','same'].forEach(m=>{const n=$(`#${m}-mode`);n.classList.toggle('selected',m===mode);n.setAttribute('aria-pressed',String(m===mode));});updateInspector();updatePreview();}
$('#custom-mode').onclick=()=>setMode('custom');$('#same-mode').onclick=()=>setMode('same');
function setKind(next){if(kind!=='file')drafts[kind]=$('#message').value;kind=next;$$('[data-kind]').forEach(n=>{n.classList.toggle('active',n.dataset.kind===kind);n.setAttribute('aria-pressed',String(n.dataset.kind===kind));});$('#text-editor').hidden=kind==='file';$('#file-editor').hidden=kind!=='file';if(kind!=='file')$('#message').value=drafts[kind];$('#encoding-label').textContent=kind==='json'?'JSON / UTF-8':'UTF-8';updatePreview();}
$$('[data-kind]').forEach(n=>n.onclick=()=>setKind(n.dataset.kind));
$$('[data-repeat]').forEach(n=>n.onclick=()=>{$('#repeat').value=n.dataset.repeat;$$('[data-repeat]').forEach(b=>{b.classList.toggle('selected',b===n);b.setAttribute('aria-pressed',String(b===n));});updatePreview();});
async function selectPayload(file){if(!file)return;if(file.size>MAX_PAYLOAD)throw Error('Choose a file of 8 KiB or less.');payloadFile={data:new Uint8Array(await file.arrayBuffer()),name:file.name,mime:file.type||'application/octet-stream'};$('#payload-name').textContent=file.name;$('#payload-size').textContent=`${bytesLabel(file.size)} / ready`;updatePreview();}
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
function buildSignal(){
  const sr=48000;
  if(mode==='custom'){
    const {data,meta}=payload(),total=+$('#repeat').value,id=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join(''),profile=PROFILES[$('#profile').value];
    const parts=Array.from({length:total},(_,index)=>modulate(packet(data,meta,{total,index,id}),profile,sr));
    return{samples:joinAudio(parts,sr,.65),sr,total,id};
  }
  updateUTC();const header=currentHeader(),padding=Math.round(.18*sr);
  const burst=modulate(sameBytes(header),PROFILES.same,sr).slice(padding,-padding),end=modulate(sameBytes('NNNN'),PROFILES.same,sr).slice(padding,-padding);
  const heads=joinAudio([burst,burst,burst],sr,1),ends=joinAudio([end,end,end],sr,1),leading=new Float32Array(sr*.25),headParts=[leading,heads];
  if($('#attention').checked)headParts.push(attentionSignal(sr));
  const head=joinAudio(headParts,sr,1),tail=joinAudio([ends,leading],sr,.25),parts=[head];if(voice)parts.push(voice.data);parts.push(tail);
  return{samples:joinAudio(parts,sr,1),sr,head,tail,header,speech:!voice&&$('#speak').checked?$('#announcement').value.trim():null};
}
function updatePreview(){
  const size=kind==='file'?(payloadFile?.data.length||0):utf.encode($('#message').value).length;
  $('#byte-count').textContent=size.toLocaleString();$('#byte-count').style.color=size>MAX_PAYLOAD?'var(--accent)':'';
  $('#profile-help').textContent={balanced:'Start here for short transfers between nearby devices.',resilient:'Longer symbols for a noisy channel. Three times the transfer time.',fast:'For clean recordings and controlled conditions. Shorter, less forgiving symbols.'}[$('#profile').value];
  const total=+$('#repeat').value;$('#repeat-help').textContent=total===1?'The receiver expects one copy and checks its CRC-32 checksum.':`The header announces ${total} copies. Each must pass CRC-32 and match before the transfer is fully verified.`;
  const p=mode==='same'?PROFILES.same:PROFILES[$('#profile').value];
  if(!listening){$('#scope-frequency').textContent=mode==='same'?'1.56 / 2.08 kHz':'1.2 / 2.4 kHz';$('#scope-protocol').textContent=mode==='same'?'SAME / AFSK':'BFSK / V2';$('#scope-rate').textContent=`${p.baud.toFixed(mode==='same'?2:0)} BIT/S`;}
  try{
    let seconds,signalSize=size;
    if(mode==='custom'){
      const {data,meta}=payload(),length=packet(data,meta).length;
      seconds=(length*8/p.baud+.36)*total+(total-1)*.65;
      if(!playing&&!listening){previewSamples=modulate(packet(data.slice(0,160),meta),p,12000);previewRate=12000;}
    }else{
      const header=currentHeader();$('#header-preview').textContent=header;signalSize=header.length;
      const signal=buildSignal();seconds=signal.samples.length/signal.sr;if(signal.speech)seconds+=signal.speech.split(/\s+/).length/2.5;
      if(!playing&&!listening){previewSamples=signal.samples.subarray(0,Math.min(signal.samples.length,48000*5));previewRate=48000;}
    }
    $('#duration-estimate').textContent=timeLabel(seconds)+(mode==='same'&&$('#speak').checked&&!voice&&$('#announcement').value.trim()?' ≈':'');
    $('#size-estimate').textContent=mode==='same'?`${signalSize} chars`:bytesLabel(signalSize);$('#size-label').textContent=mode==='same'?'HEADER':'PAYLOAD';
  }catch(error){$('#duration-estimate').textContent='—';$('#size-estimate').textContent=bytesLabel(size);if(!playing&&!listening)previewSamples=null;if(mode==='same')$('#header-preview').textContent=err(error);}
  if(!playing&&!listening)drawScope();
}
$$('#message,#profile,#origin,#event,#locations,#duration,#sender,#issued,#auto-time,#attention,#speak,#announcement').forEach(n=>n.addEventListener('input',()=>{if(n.id==='auto-time')updateUTC();if(n.id==='locations')updateLocations();clearTimeout(previewTimer);previewTimer=setTimeout(updatePreview,120);}));
$('#volume').oninput=()=>{$('#volume-value').textContent=$('#volume').value+'%';if(gain)gain.gain.value=+$('#volume').value/100;};

async function audioContext(){if(!ctx||ctx.state==='closed'){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw Error('Web Audio is unavailable. Try a current Safari, Chrome, Firefox, or Edge browser.');ctx=new C({latencyHint:'interactive'});}await resumeAudioContext(ctx);return ctx;}
async function loadVoice(file){
  if(!file)return;if(file.size>25*1024*1024)throw Error('Choose an announcement smaller than 25 MB.');const c=await audioContext(),audio=await c.decodeAudioData(await file.arrayBuffer());if(audio.duration>90)throw Error('Keep announcements to 90 seconds or less.');
  const data=new Float32Array(Math.ceil(audio.duration*48000));for(let ch=0;ch<audio.numberOfChannels;ch++){const samples=audio.getChannelData(ch);for(let i=0;i<data.length;i++){const at=i*audio.sampleRate/48000,a=Math.floor(at),f=at-a;data[i]+=((samples[a]||0)*(1-f)+(samples[a+1]||0)*f)/audio.numberOfChannels;}}
  voice={name:file.name,data};$('#voice-status').textContent=`${file.name} / ${timeLabel(audio.duration)} / included in WAV`;$('#clear-voice').hidden=false;updatePreview();
}
$('#voice-file').onchange=async e=>{try{await loadVoice(e.target.files[0]);}catch(e){toast(err(e),true);}e.target.value='';};
$('#clear-voice').onclick=()=>{voice=null;$('#voice-status').textContent='Recorded audio goes into the WAV. Browser speech is live playback only.';$('#clear-voice').hidden=true;updatePreview();};
function setPlayUI(){ $('#play-label').textContent=playing?'Stop':'Transmit';$('#play-icon').textContent=playing?'■':'▶';if(!listening){$('#scope-state').textContent=playing?'TRANSMITTING':'SIGNAL PREVIEW';$('#scope-caption').textContent=playing?'OUTPUT ACTIVE':'READY';}}
function stopPlayback(){playing=false;playToken++;if(source){try{source.stop();}catch{}source=null;}window.speechSynthesis?.cancel();speechCancel?.();speechCancel=null;setPlayUI();}
async function playBuffer(samples,sr){
  const c=await audioContext();await new Promise(resolve=>{const buffer=c.createBuffer(1,samples.length,sr);buffer.copyToChannel(samples,0);const currentSource=c.createBufferSource(),currentGain=c.createGain();source=currentSource;gain=currentGain;currentSource.buffer=buffer;currentGain.gain.value=+$('#volume').value/100;currentSource.connect(currentGain);currentGain.connect(c.destination);currentSource.onended=()=>{currentSource.disconnect();currentGain.disconnect();resolve();};scopeStart=performance.now();scopeDuration=samples.length/sr;previewSamples=samples;previewRate=sr;currentSource.start();});
}
function speak(text){return new Promise((resolve,reject)=>{if(!('speechSynthesis'in window)){reject(Error('Speech synthesis is unavailable. Attach a recording instead.'));return;}const u=new SpeechSynthesisUtterance(text);u.volume=+$('#volume').value/100;u.onend=()=>{speechCancel=null;resolve();};u.onerror=e=>{speechCancel=null;if(['canceled','interrupted'].includes(e.error))resolve();else reject(Error('Speech synthesis failed. Attach a recording instead.'));};speechCancel=resolve;window.speechSynthesis.speak(u);});}
$('#play').onclick=async()=>{
  if(playing){stopPlayback();return;}
  try{if(+$('#volume').value===0){toast('Output is muted. Raise the volume slider first.');return;}
    const signal=buildSignal();await audioContext();playing=true;const token=++playToken;setPlayUI();
    if(signal.speech){await playBuffer(signal.head,signal.sr);if(token!==playToken)return;await speak(signal.speech);if(token!==playToken)return;await playBuffer(signal.tail,signal.sr);}else await playBuffer(signal.samples,signal.sr);
    if(token===playToken){playing=false;source=null;setPlayUI();updatePreview();}
  }catch(e){stopPlayback();toast(err(e),true);}
};
$('#export').onclick=()=>{try{const signal=buildSignal();download(wav(signal.samples,signal.sr),mode==='same'?'signal-lab-same-study.wav':'signal-lab-message.wav','audio/wav');toast(signal.speech?'WAV saved. To include speech in the file, attach recorded audio.':'WAV exported, including the declared copy plan.');}catch(e){toast(err(e),true);}};
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&page==='encoder'&&!['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(document.activeElement?.tagName)&&!document.activeElement?.isContentEditable){e.preventDefault();$('#play').click();}});
for(const [id,freq]of [['bit-zero',1200],['bit-one',2400]])$(('#'+id)).onclick=async()=>{try{const c=await audioContext(),o=c.createOscillator(),v=c.createGain();o.frequency.value=freq;o.connect(v);v.connect(c.destination);v.gain.setValueAtTime(0,c.currentTime);v.gain.linearRampToValueAtTime(.12,c.currentTime+.02);v.gain.setValueAtTime(.12,c.currentTime+.45);v.gain.linearRampToValueAtTime(0,c.currentTime+.5);o.start();o.stop(c.currentTime+.51);o.onended=()=>{o.disconnect();v.disconnect();};}catch(e){toast(err(e),true);}};
$('#byte-character').oninput=()=>{const s=$('#byte-character').value,bytes=utf.encode(s);$('#byte-output').textContent=bytes.length?Array.from(bytes,b=>`${b.toString(16).padStart(2,'0').toUpperCase()} → ${b.toString(2).padStart(8,'0')}`).join(' / '):'Type a character to see its UTF-8 bytes.';};

function status(message,state='ready'){$('#rx-status').textContent=message;$('#rx-dot').classList.toggle('active',state==='active');$('#rx-dot').classList.toggle('error',state==='error');}
function setBusy(value){busy=value;for(const id of ['loopback','demo','decoder-demo','audio-file','listen'])$('#'+id).disabled=value;}
function makeWorker(sr){
  worker?.terminate();worker=new Worker(new URL('./receive-worker.mjs?v=0.2.1',import.meta.url),{type:'module'});const current=++job;lastTransfer=null;lastSyncAt=0;$('#decode-stage').textContent='Waiting for a signal';
  $('#copy-progress').hidden=true;$('#result').hidden=true;$('#empty-result').hidden=false;
  worker.onmessage=({data})=>{
    if(data.job!==current)return;
    if(data.type==='transfer')receiveCustom(data.transfer,current);
    else if(data.type==='same-transfer')receiveSame(data.transfer,current);
    else if(data.type==='legacy')receiveLegacy(data.frame,current);
    else if(data.type==='sync'){lastSyncAt=performance.now();$('#decode-stage').textContent=`${data.profile} sync detected`;status(`${data.profile}: signal lock. Reading header…`,'active');}
    else if(data.type==='done'){
      setBusy(false);
      if(lastTransfer)status(transferStatus(lastTransfer),lastTransfer.state==='conflict'?'error':'ready');
      else status('No complete signal found. Try a cleaner recording or the Resilient profile.','error');
    }
  };
  worker.onerror=e=>{setBusy(false);cleanupMicrophone();status('Decoder stopped. Reload the app and try again.','error');toast(e.message||'Audio worker failed.',true);};
  worker.postMessage({type:'init',job:current,sr});return current;
}
async function decodeSignal(samples,sr,label){
  if(listening)stopListening();setBusy(true);status(`Decoding ${label}…`,'active');const current=makeWorker(sr);showPage('decoder');
  const length=sr*2;for(let at=0;at<samples.length;at+=length){const part=samples.slice(at,at+length);worker.postMessage({type:'audio',job:current,samples:part,done:at+length>=samples.length},[part.buffer]);}
  previewSamples=samples;previewRate=sr;drawScope();
}
$('#loopback').onclick=async()=>{try{const s=buildSignal();await decodeSignal(s.samples,s.sr,'generated audio');}catch(e){setBusy(false);toast(err(e),true);}};
async function demo(){setMode('custom');setKind('text');$('#message').value='Signal received. Three copies, same message. 🌊';drafts.text=$('#message').value;$('#repeat').value='3';$$('[data-repeat]').forEach(n=>{const selected=n.dataset.repeat==='3';n.classList.toggle('selected',selected);n.setAttribute('aria-pressed',String(selected));});updatePreview();try{const s=buildSignal();await decodeSignal(s.samples,s.sr,'the demo waveform');}catch(e){setBusy(false);toast(err(e),true);}}
$('#demo').onclick=demo;$('#decoder-demo').onclick=demo;
$('#audio-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{if(file.size>50*1024*1024)throw Error('Choose a recording smaller than 50 MB.');if(listening)stopListening();setBusy(true);status('Opening recording…','active');const c=await audioContext(),audio=await c.decodeAudioData(await file.arrayBuffer());if(audio.duration>300)throw Error('Choose a recording no longer than five minutes.');const samples=new Float32Array(audio.length);for(let ch=0;ch<audio.numberOfChannels;ch++){const channel=audio.getChannelData(ch);for(let i=0;i<audio.length;i++)samples[i]+=channel[i]/audio.numberOfChannels;}await decodeSignal(samples,audio.sampleRate,file.name);
  }catch(e){setBusy(false);status('Could not decode that recording. Try an uncompressed WAV.','error');toast(err(e),true);}
};

// Stop microphone tracks before releasing processing nodes, including failures
// during initialization and permission/device changes.
function cleanupMicrophone(){
  listening=false;listenToken++;clearInterval(healthTimer);healthTimer=null;stream?.getTracks().forEach(t=>t.stop());stream=null;capture?.close();capture=null;analyser=null;liveWave=null;
  $('#listen-label').textContent='Start microphone';$('#listen').classList.remove('listening');$('#rx-badge').textContent='IDLE';
  $('#scope-state').textContent=playing?'TRANSMITTING':'SIGNAL PREVIEW';$('#scope-caption').textContent=playing?'OUTPUT ACTIVE':'READY';
  $('#diag-input').textContent='Stopped';$('#diagnostic-summary').textContent='Microphone stopped';$('#diag-context').textContent=ctx?.state||'Not started';$('#restart-microphone').hidden=true;$('#input-state').textContent='Microphone stopped';
}
function stopListening(){
  if(listening){
    worker?.postMessage({type:'finish',job});
    if(lastTransfer?.state==='receiving'){
      const incomplete={...lastTransfer,state:'incomplete'};
      if(incomplete.protocol==='same')receiveSame(incomplete,job);else receiveCustom(incomplete,job);
    }
  }
  cleanupMicrophone();status('Microphone stopped. Any missing copies are marked incomplete.');
}
function paintInputMetrics(samples,sampleRate){
  const now=performance.now();lastSampleAt=now;inputHistory.push(samples);$('#save-capture').disabled=false;
  if(now-lastMeterAt<180)return;lastMeterAt=now;inputMetrics=measureInput(samples,sampleRate);
  const m=inputMetrics,db=Math.max(-90,Math.min(0,m.db)),quiet=m.db<-80;
  $('#input-db').textContent=m.db<=-119?'−∞ dBFS':`${Math.round(m.db)} dBFS`;
  $('#input-meter').setAttribute('aria-valuenow',String(Math.round(db)));$('#input-meter').classList.toggle('clipping',m.clipping);$('#input-meter-bar').style.width=`${(db+90)/90*100}%`;
  $('#input-state').textContent=m.clipping?'Input is clipping':quiet?'Very quiet input':m.custom>.18?'Custom modem tones detected':m.same>.18?'SAME tones detected':'Microphone is hearing audio';
  $('#input-detail').textContent=m.clipping?'Lower the Mac playback volume to reduce distortion.':quiet?'Little audio is reaching the microphone. Check playback volume and move the devices closer.':m.custom>.18?'Custom tone energy is arriving. If no header locks, try Resilient and a short message.':m.same>.18?'SAME tone energy is arriving. Waiting for complete header bursts.':'Input is active. Play a signal from the other device; ordinary speech and breath do not contain a modem packet.';
}
function checkCaptureHealth(){
  if(!listening)return;const now=performance.now(),paused=ctx.state!=='running',stalled=now-(lastSampleAt||captureStarted)>3000,muted=stream?.getAudioTracks()[0]?.muted;
  $('#diag-context').textContent=ctx.state;$('#rx-badge').textContent=paused||stalled||muted?'PAUSED':'LIVE';$('#restart-microphone').hidden=!(paused||stalled||muted);
  if(paused||stalled||muted){
    $('#input-state').textContent=paused?`Audio context ${ctx.state}`:muted?'Microphone muted by the system':'No microphone samples arriving';
    $('#input-detail').textContent='Tap Restart microphone, keep this tab in the foreground, and check that no call or other app is using audio.';
    status('Microphone capture is paused. Tap Restart microphone.','error');
  }else if(!lastTransfer&&lastSyncAt&&now-lastSyncAt>5000){
    $('#decode-stage').textContent='Sync seen; no complete valid packet yet';
  }
}
$('#restart-microphone').onclick=()=>{stopListening();$('#listen').onclick();};
$('#save-capture').onclick=()=>{if(!inputHistory?.length){toast('No microphone samples have arrived yet.',true);return;}download(wav(inputHistory.samples(),inputHistory.sampleRate),'signal-lab-microphone.wav','audio/wav');toast('Saved the captured microphone audio locally.');};
window.addEventListener('visibilitychange',()=>{if(listening&&document.visibilityState==='visible')resumeAudioContext(ctx).catch(()=>checkCaptureHealth());});

$('#diag-secure').textContent=window.isSecureContext?'Yes / secure context':'No / HTTPS required';$('#diag-api').textContent=navigator.mediaDevices?.getUserMedia?'Available':'Unavailable';
$('#listen').onclick=async()=>{
  if(listening){stopListening();return;}
  $('#listen').disabled=true;const token=++listenToken;
  try{
    if(!window.isSecureContext)throw Error('Microphone capture requires HTTPS or localhost. Open the live HTTPS app.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser does not expose microphone access. Open the standalone app in Safari, Chrome, Firefox, or Edge.');
    status('Waiting for microphone permission…','active');const c=await audioContext();
    const input=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
    if(token!==listenToken){input.getTracks().forEach(t=>t.stop());return;}stream=input;
    await resumeAudioContext(c);
    const current=makeWorker(c.sampleRate);inputHistory=new PcmHistory(c.sampleRate,30);inputMetrics=null;lastSampleAt=0;lastMeterAt=0;$('#save-capture').disabled=true;
    capture=await attachCapture(c,input,samples=>{if(listening&&current===job){paintInputMetrics(samples,c.sampleRate);worker?.postMessage({type:'audio',job:current,samples},[samples.buffer]);}});
    await resumeAudioContext(c);
    if(token!==listenToken){capture.close();input.getTracks().forEach(t=>t.stop());return;}
    analyser=capture.analyser;listening=true;captureStarted=performance.now();$('#input-monitor').hidden=false;$('#input-state').textContent='Waiting for microphone samples';healthTimer=setInterval(checkCaptureHealth,500);$('#listen-label').textContent='Stop microphone';$('#listen').classList.add('listening');$('#rx-badge').textContent='LIVE';$('#scope-state').textContent='MIC INPUT';$('#scope-caption').textContent='AUTO-SCALED INPUT';
    $('#scope-protocol').textContent='AUTO DETECT';$('#scope-rate').textContent=`${(c.sampleRate/1000).toFixed(1)} kHz`;$('#scope-frequency').textContent='1.2–2.4 kHz';
    $('#diag-engine').textContent=capture.method;$('#diag-rate').textContent=`${c.sampleRate.toLocaleString()} Hz`;$('#diag-input').textContent=input.getAudioTracks()[0]?.label||'Default microphone';$('#diagnostic-summary').textContent=capture.method;
    $('#diag-context').textContent=c.state;
    const settings=input.getAudioTracks()[0]?.getSettings?.()||{};
    $('#diag-processing').textContent=[['echoCancellation','Echo'],['noiseSuppression','Noise'],['autoGainControl','AGC']].map(([key,label])=>`${label}: ${settings[key]===true?'on':settings[key]===false?'off':'not reported'}`).join(' / ');
    if(capture.workletError)$('#diag-engine').title=capture.workletError;
    input.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(listening){stopListening();status('Microphone disconnected. Choose an available input and restart.','error');}}));
    status('Listening. Transmit a signal nearby; keep this tab in the foreground.','active');
  }catch(error){
    cleanupMicrophone();const message={NotAllowedError:'Microphone access was declined or blocked by this browser. Allow it in site settings, or open the standalone app.',NotFoundError:'No microphone found. Connect one, or import a recording.',NotReadableError:'Microphone unavailable. Close other apps using it and retry.'}[error.name]||err(error);
    status(message,'error');$('#diag-engine').textContent='Failed to start';$('#diagnostics').open=true;toast(message,true);
  }finally{$('#listen').disabled=false;}
};

function transferStatus(t){
  if(t.state==='conflict')return 'Copies conflict. This transfer is not verified.';
  const received=t.protocol==='same'?t.copies:t.received.length;
  if(t.protocol==='same')return `${received} / 3 matching SAME headers${t.endCopies?` · ${t.endCopies} / 3 end bursts`:''}${t.state==='incomplete'?' · incomplete':''}.`;
  if(t.legacy)return 'Legacy packet passed CRC-32. Its format does not declare a copy plan.';
  if(t.state==='verified')return `${received} / ${t.total} copies verified. ${t.total>1?'All payload bytes match.':'CRC-32 passed.'}`;
  if(t.state==='incomplete')return `${received} / ${t.total} valid copies. Transfer incomplete; missing copies were not verified.`;
  return `${received} / ${t.total} copies verified. Waiting for ${t.total-received} more.`;
}
function renderProgress(t){
  $('#copy-progress').hidden=false;const isSame=t.protocol==='same',received=isSame?Array.from({length:t.copies},(_,i)=>i):t.received;
  $('#copy-plan').textContent=isSame?'SAME / three header bursts':t.legacy?'Legacy packet / no copy plan':`Transfer ${t.id.slice(0,8)} / ${t.total} ${t.total===1?'copy':'copies'} expected`;
  $('#copy-status').textContent=`${received.length} / ${t.total}`;
  const slots=$('#copy-slots');slots.replaceChildren();for(let i=0;i<t.total;i++){const valid=received.includes(i),announced=!isSame&&t.announced?.includes(i),state=valid?'received':announced&&t.state==='receiving'?'announced':'';slots.append(el('div','copy-slot '+state,`${valid?'✓':t.state==='incomplete'?'–':announced?'⋯':'○'} Copy ${i+1}`));}
  $('#copy-explanation').textContent=t.state==='conflict'?'Different content was received under the same transfer ID. Verification failed.':isSame?`${t.copies}/3 parsed headers match. SAME has no checksum.${t.endCopies?` End markers: ${t.endCopies}/3.`:''}`:t.legacy?'This older packet has no declared repetition information.':t.state==='verified'?t.total>1?'Every copy passed CRC-32. Metadata and original payload bytes match.':'The declared single copy passed its full-frame CRC-32 check.':t.state==='incomplete'?'At least one expected copy is missing or corrupt. Available bytes remain marked incomplete.':'The header declares the plan before the payload completes. Only full checksum-valid copies earn a check.';
}
function upsertReception(t,key){let item=receptions.find(r=>r.key===key);if(!item){item={key,at:new Date(),transfer:t};receptions.unshift(item);if(receptions.length>50)receptions.pop();}else item.transfer=t;$('#count').textContent=receptions.length;renderHistory();return item;}
function showTransfer(t,item){$('#decode-stage').textContent=t.state==='verified'?'Payload verified':t.state==='incomplete'?'Incomplete copy set':t.state==='conflict'?'Copy conflict':t.frame?'Payload received; checking copies':'Transfer header read';renderProgress(t);if(t.frame){$('#empty-result').hidden=true;$('#result').hidden=false;$('#result').replaceChildren(resultCard(t,item?.at||new Date()));}status(transferStatus(t),t.state==='conflict'?'error':listening||busy?'active':'ready');}
function receiveCustom(t,current){const value={...t,protocol:'custom'};lastTransfer=value;let item;if(t.frame)item=upsertReception(value,`${current}:${t.id}`);showTransfer(value,item);}
function receiveSame(t,current){lastTransfer=t;const item=upsertReception(t,`${current}:${t.id}`);showTransfer(t,item);}
function receiveLegacy(frame,current){const t={id:`legacy-${frame.crc}`,protocol:'custom',frame,total:1,received:[0],announced:[0],state:'verified',legacy:true};lastTransfer=t;const item=upsertReception(t,`${current}:${t.id}`);showTransfer(t,item);}
function resultCard(t,at){
  const frame=t.frame,card=el('div'),heading=el('div','result-heading');
  const label=t.state==='conflict'?'COPY CONFLICT':t.protocol==='same'?(t.copies===3?'3 MATCHING SAME HEADERS':'SAME HEADER / '+t.copies+' OF 3'):t.legacy?'LEGACY / CRC PASSED':t.state==='verified'?`${t.total} OF ${t.total} / VERIFIED`:t.state==='incomplete'?'INCOMPLETE TRANSFER':'PAYLOAD RECEIVED / VERIFYING';
  heading.append(el('strong',t.state==='conflict'?'conflict':t.state!=='verified'?'pending':'',label));const time=el('time','',at.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}));time.dateTime=at.toISOString();heading.append(time);card.append(heading);
  if(frame.protocol==='custom'){
    const isFile=!['text','json'].includes(frame.meta.kind),text=textDecoder.decode(frame.payload);
    if(isFile)card.append(el('p','result-text',String(frame.meta.name||'received.bin')),el('p','field-help',`${bytesLabel(frame.payload.length)} / ${String(frame.meta.mime||'binary data')}`));else card.append(el('pre','result-text',text));
    const actions=el('div','result-actions'),save=el('button','text-button',isFile?'Save original file ↓':'Save payload ↓');save.onclick=()=>download(frame.payload,isFile?String(frame.meta.name||'received.bin').replace(/[\/\\\x00-\x1f]/g,'_'):frame.meta.kind==='json'?'received.json':'received.txt');actions.append(save);
    if(!isFile){const copy=el('button','text-button','Copy text');copy.onclick=()=>copyText(text);actions.append(copy);}card.append(actions,el('div','result-meta',`${frame.profile} / ${bytesLabel(frame.payload.length)} / CRC-32 passed${t.total>1?' / '+t.received.length+' matching copies':''}`));
    if(t.state==='incomplete'||t.state==='conflict')card.append(el('p','field-help',t.state==='conflict'?'Content differs across copies. Download contains the first valid copy.':'These bytes passed their checksum, but the declared set of copies is incomplete.'));
  }else{
    const fields=el('div','decoded-fields'),events={RWT:'Required Weekly Test',RMT:'Required Monthly Test',DMO:'Practice / Demo Warning',TOR:'Tornado Warning',SVR:'Severe Thunderstorm Warning',FFW:'Flash Flood Warning',CEM:'Civil Emergency Message'};
    const names=frame.locations.map(c=>{const d=describeLocation(c,locationRows);return `${c} / ${d?.label||'Unknown area'}`;}).join('; ');
    for(const [name,value]of [['EVENT',`${frame.event} / ${events[frame.event]||'Event code'}`],['ORIGINATOR',frame.origin],['GEOGRAPHICAL AREAS',names],['PURGE TIME',`${+frame.duration.slice(0,2)}h ${+frame.duration.slice(2)}m`],['ISSUED / UTC',`Day ${frame.issued.slice(0,3)} / ${frame.issued.slice(3,5)}:${frame.issued.slice(5)}`],['STATION ID',frame.sender]]){const d=el('div');d.append(el('span','',name),el('div','',value));fields.append(d);}card.append(fields,el('div','decoded-raw',frame.raw),el('div','result-meta',`${t.copies}/3 matching headers / ${t.endCopies}/3 end bursts / SAME has no CRC`));
  }
  return card;
}
function renderHistory(){const list=$('#history-list');list.replaceChildren();if(!receptions.length){list.append(el('div','history-empty','No receptions yet.'));return;}for(const item of receptions){const card=el('article','history-card');card.append(resultCard(item.transfer,item.at));list.append(card);}}
$('#clear-history').onclick=()=>{receptions=[];$('#count').textContent='0';renderHistory();toast('Log cleared.');};

const canvas=$('#scope'),g=canvas.getContext('2d');
function drawScope(){
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const dpr=window.devicePixelRatio||1;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=w*dpr;canvas.height=h*dpr;}g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  let samples=previewSamples;if(listening&&analyser){if(!liveWave||liveWave.length!==analyser.fftSize)liveWave=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(liveWave);samples=liveWave;}
  g.strokeStyle='#c1f794';g.lineWidth=1;g.beginPath();
  if(!samples?.length){g.moveTo(0,h/2);g.lineTo(w,h/2);}else if(listening){const displayGain=Math.min(1000,Math.max(1,.18/Math.max(inputMetrics?.rms||0,1e-5)));for(let x=0;x<w;x++){const at=Math.floor(x/w*samples.length),y=h/2-Math.max(-1,Math.min(1,samples[at]*displayGain))*h*.45;x?g.lineTo(x,y):g.moveTo(x,y);}}else{
    // A short time window exposes individual tone cycles instead of flattening
    // an entire multi-second packet into an uninformative solid envelope.
    const count=Math.min(samples.length,Math.round(previewRate*.025));
    let offset=playing?Math.floor((performance.now()-scopeStart)/1000*previewRate):0;
    if(!playing)while(offset<samples.length-count&&Math.abs(samples[offset])<.02)offset++;
    offset=Math.max(0,Math.min(offset,samples.length-count));
    for(let x=0;x<w;x++){const at=offset+Math.min(count-1,Math.floor(x/w*count)),y=h/2-samples[at]*h*.6;x?g.lineTo(x,y):g.moveTo(x,y);}

  }g.stroke();if(playing&&scopeDuration){const x=Math.min(1,(performance.now()-scopeStart)/1000/scopeDuration)*w;g.strokeStyle='#f3ffe8';g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
}
function animate(time){if(time-lastPaint>70&&(playing||listening)){drawScope();lastPaint=time;}requestAnimationFrame(animate);}requestAnimationFrame(animate);new ResizeObserver(drawScope).observe(canvas);
window.addEventListener('pagehide',()=>{stopPlayback();cleanupMicrophone();worker?.terminate();ctx?.close();});
updatePreview();updateLocations();const [initial,topic]=location.hash.slice(1).split('/');if(initial==='learn')openLesson(topic);else showPage(initial);
