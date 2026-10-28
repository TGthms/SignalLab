// Measurements are diagnostic, not a validity decision. Only decoded frame CRCs
// (or complete SAME grammar) establish whether a payload was received.
export function measureInput(samples,sampleRate,{highFrequency=false}={}){
  let sum=0,peak=0;for(const x of samples){sum+=x*x;peak=Math.max(peak,Math.abs(x));}
  const rms=Math.sqrt(sum/Math.max(1,samples.length));
  function tonePower(frequency){
    const coefficient=2*Math.cos(2*Math.PI*frequency/sampleRate);let a=0,b=0;
    for(const x of samples){const next=x+coefficient*a-b;b=a;a=next;}
    return Math.max(0,a*a+b*b-coefficient*a*b);
  }
  const divisor=samples.length*sum;
  const fraction=frequencies=>divisor?Math.min(1,2*frequencies.reduce((total,f)=>total+tonePower(f),0)/divisor):0;
  const custom=fraction([1200,2400]),same=fraction([1562.5,4/.00192]);
  const morse=fraction([700]);
  // Sum distinct DFT bins around the selected high carrier, including its
  // modulation sidebands. Energy is only a clue, not a decoded signal.
  let high=0;
  if(highFrequency&&sampleRate>=44100&&samples.length){
    const step=sampleRate/samples.length,first=Math.ceil(19500/step),last=Math.min(Math.floor(21500/step),Math.floor(samples.length/2)-1);
    for(let bin=first;bin<=last;bin++)high+=tonePower(bin*step);
    high=divisor?Math.min(1,2*high/divisor):0;
  }
  return{rms,peak,db:rms?Math.max(-120,20*Math.log10(rms)):-120,custom,same,morse,high,clipping:peak>=.98};
}

export class PcmHistory {
  constructor(sampleRate,seconds=30){this.sampleRate=sampleRate;this.limit=Math.ceil(sampleRate*seconds);this.parts=[];this.length=0;}
  push(samples){
    const copy=new Float32Array(samples.subarray(Math.max(0,samples.length-this.limit)));
    this.parts.push(copy);this.length+=copy.length;
    while(this.length>this.limit){const excess=this.length-this.limit,first=this.parts[0];if(first.length<=excess){this.parts.shift();this.length-=first.length;}else{this.parts[0]=first.slice(excess);this.length-=excess;}}
  }
  samples(){const result=new Float32Array(this.length);let at=0;for(const part of this.parts){result.set(part,at);at+=part.length;}return result;}
}
