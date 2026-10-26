// Inline worklet avoids a second network request in embedded browsers. The
// ScriptProcessor fallback supports hosts that block AudioWorklet modules.
export const CAPTURE_SOURCE = `class SignalCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(2048);this.at=0;}
  process(inputs){const ch=inputs[0]?.[0];if(ch)for(let i=0;i<ch.length;i++){
    this.buffer[this.at++]=ch[i];if(this.at===2048){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(2048);this.at=0;}
  }return true;}
}registerProcessor('signal-lab-capture-v2',SignalCapture);`;
const loaded=new WeakMap();
export async function attachCapture(context,stream,onSamples){
  const source=context.createMediaStreamSource(stream),mute=context.createGain();mute.gain.value=0;
  let node,method,workletError;
  try{
    if(!context.audioWorklet||typeof AudioWorkletNode==='undefined')throw Error('AudioWorklet is unavailable');
    if(!loaded.has(context)){
      const url=URL.createObjectURL(new Blob([CAPTURE_SOURCE],{type:'text/javascript'}));
      const ready=context.audioWorklet.addModule(url).finally(()=>URL.revokeObjectURL(url));
      loaded.set(context,ready);
    }
    await loaded.get(context);
    node=new AudioWorkletNode(context,'signal-lab-capture-v2');node.port.onmessage=({data})=>onSamples(data);method='AudioWorklet';
  }catch(error){
    workletError=error.message;
    if(typeof context.createScriptProcessor!=='function'){source.disconnect();throw Error('Audio capture is blocked in this browser. Open the live HTTPS app in Safari, Chrome, Firefox, or Edge.');}
    node=context.createScriptProcessor(4096,1,1);
    node.onaudioprocess=e=>onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));method='Compatibility capture';
  }
  source.connect(node);node.connect(mute);mute.connect(context.destination);
  const analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);
  return {method,workletError,analyser,close(){if(node.port)node.port.onmessage=null;else node.onaudioprocess=null;source.disconnect();node.disconnect();mute.disconnect();analyser.disconnect();}};
}

// iOS may interrupt the audio context when microphone routing changes. Resume
// after getUserMedia/graph setup as well as from the original user gesture.
export async function resumeAudioContext(context,timeoutMs=3000){
  if(context.state==='closed')throw Error('Audio context closed. Restart the microphone.');
  if(context.state==='running')return;
  let timeout;
  try{
    await Promise.race([context.resume(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Audio is paused by the browser. Tap Restart microphone and keep this tab open.')),timeoutMs);})]);
  }finally{clearTimeout(timeout);}
  if(context.state&&context.state!=='running')throw Error('Audio is still '+context.state+'. Tap Restart microphone.');
}
