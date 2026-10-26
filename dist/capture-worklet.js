class Capture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(2048);this.at=0;}
  process(inputs){
    const ch=inputs[0]?.[0];if(ch){for(let i=0;i<ch.length;i++){this.buffer[this.at++]=ch[i];if(this.at===2048){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(2048);this.at=0;}}}
    return true;
  }
}
registerProcessor('signal-capture',Capture);
