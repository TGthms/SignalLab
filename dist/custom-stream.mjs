import {packet, customPreambleBytes} from './codec.mjs?v=0.3.8';

// Generate the same signal as modulate/joinAudio without retaining PCM for the
// whole transfer. State carries phase and bit boundaries across arbitrary chunks.
export function createCustomStream(data, meta, profile, total, id, sr=48000) {
  const parts=Array.from({length:total},(_,index)=>packet(data,meta,{total,index,id,preambleBytes:customPreambleBytes(profile,index)}));
  const spb=sr/profile.baud,padding=Math.round(sr*.18),gap=Math.round(sr*.65),ramp=Math.round(sr*.002),transition=Math.round(spb*(profile.smooth??.1));
  const partLengths=parts.map(bytes=>2*padding+Math.ceil(bytes.length*8*spb));
  const length=partLengths.reduce((a,b)=>a+b,0)+gap*(total-1);
  let part=0,position=0,phase=0,previous=profile.zero,bit=0,begin=0,freq=profile.zero,inGap=false,gapPos=0,generated=0,phaseSymbol=-1;
  function nextSample(){
    if(part>=parts.length)return 0;
    if(inGap){if(++gapPos>=gap){inGap=false;gapPos=0;part++;position=0;phase=0;previous=profile.zero;bit=0;begin=0;phaseSymbol=-1;}return 0;}
    const bytes=parts[part],bits=bytes.length*8,toneIndex=position-padding,toneEnd=Math.round(bits*spb);let sample=0;
    if(toneIndex>=0&&toneIndex<toneEnd){
      if(profile.modulation && profile.modulation!=='bfsk'){
        const width=profile.modulation==='dqpsk'?2:1,sps=spb*width;
        let symbol=Math.floor(toneIndex/sps);
        while(toneIndex>=Math.round((symbol+1)*sps))symbol++;
        while(symbol>0 && toneIndex<Math.round(symbol*sps))symbol--;
        if(symbol!==phaseSymbol){const at=symbol*width,value=(bytes[at>>3]>>(at&7))&((1<<width)-1);phase+=width===1?value*Math.PI:[0,Math.PI/2,3*Math.PI/2,Math.PI][value];phaseSymbol=symbol;}
        const start=Math.round(symbol*sps),end=Math.round((symbol+1)*sps),x=(toneIndex-start)/(end-start);
        sample=Math.fround(Math.sin(2*Math.PI*profile.carrier*toneIndex/sr+phase)*.65*Math.min(1,x/.1,(1-x)/.1));
      }else{
      while(bit<bits && toneIndex>=Math.round((bit+1)*spb)){previous=freq;bit++;begin=Math.round(bit*spb);}
      freq=(bytes[bit>>3]>>(bit&7))&1?profile.one:profile.zero;
      const u=transition?Math.min(1,(toneIndex-begin)/transition):1;
      const shaped=previous+(freq-previous)*(.5-.5*Math.cos(Math.PI*u));
      sample=Math.fround(Math.sin(phase)*.65);phase=(phase+2*Math.PI*shaped/sr)%(2*Math.PI);
      if(toneIndex<ramp)sample=Math.fround(sample*(toneIndex/ramp));
      if(toneEnd-1-toneIndex<ramp)sample=Math.fround(sample*((toneEnd-1-toneIndex)/ramp));
      }
    }
    position++;
    if(position===partLengths[part]){if(part<parts.length-1){inGap=true;gapPos=0;}else part++;}
    return sample;
  }
  return {sr,length,duration:length/sr,readInto(out){const n=Math.min(out.length,length-generated);for(let i=0;i<n;i++)out[i]=nextSample();if(n<out.length)out.fill(0,n);generated+=n;return n;},read(maxSamples){const out=new Float32Array(Math.min(maxSamples,length-generated));this.readInto(out);return out;},get position(){return generated;},get done(){return generated>=length;}};
}

export function wavHeader(length,sr){const b=new ArrayBuffer(44),v=new DataView(b),str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length*2,true);return new Uint8Array(b);}
export function pcm16(samples){const b=new ArrayBuffer(samples.length*2),v=new DataView(b);for(let i=0;i<samples.length;i++)v.setInt16(i*2,Math.max(-1,Math.min(1,samples[i]))*32767,true);return new Uint8Array(b);}

// The sink may be a file stream or an in-memory fallback; only one PCM chunk is
// constructed at a time. A cooperative yield keeps cancellation responsive.
export async function writeWavChunks(generator,write,{cancelled=()=>false,onProgress=()=>{},yieldControl=()=>Promise.resolve()}={}){
  await write(wavHeader(generator.length,generator.sr));
  while(!generator.done){
    if(cancelled())throw new DOMException('Export cancelled.','AbortError');
    await write(pcm16(generator.read(generator.sr*2)));
    onProgress(generator.position/generator.length);
    await yieldControl();
  }
  if(cancelled())throw new DOMException('Export cancelled.','AbortError');
}
