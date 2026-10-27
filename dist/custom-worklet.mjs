import {createCustomStream} from './custom-stream.mjs?v=0.3.2';
class CustomTransmitter extends AudioWorkletProcessor {
  constructor(options){super();const {data,meta,profile,total,id}=options.processorOptions;this.stream=createCustomStream(data,meta,profile,total,id,sampleRate);this.stopped=false;this.port.onmessage=({data})=>{if(data==='stop')this.stopped=true;};}
  process(_inputs,outputs){const out=outputs[0][0];if(!this.stopped){this.stream.readInto(out);if(!this.stream.done)return true;}this.port.postMessage('done');return false;}
}
registerProcessor('signal-lab-custom-transmitter',CustomTransmitter);
