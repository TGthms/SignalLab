import {PROFILES,phaseProfile,modulate} from './codec.mjs?v=0.3.8';
// Eight visible bits are transmitted left-to-right, the same LSB-first order as
// the modem. Spectrum is relative to its own strongest bin, not a sound meter.
export function lessonSignal(bits,mode='bfsk',carrier=1800,sr=48000){
  if(!/^[01]{8}$/.test(bits))throw Error('Enter exactly eight 0s and 1s.');
  if(!['bfsk','dbpsk','dqpsk'].includes(mode))throw Error('Choose a modulation method.');
  let byte=0;for(let i=0;i<8;i++)byte|=Number(bits[i])<<i;
  const profile=phaseProfile(PROFILES.balanced,mode,carrier),padding=Math.round(sr*.18),audio=modulate(Uint8Array.of(byte),profile,sr);
  return {samples:audio.slice(padding,audio.length-padding),sr,mode,carrier:mode==='bfsk'?null:profile.carrier};
}
export function relativeSpectrum(samples,sr,bins=256){
  if(!samples.length)return new Float32Array(bins);
  const n=Math.min(2048,samples.length),out=new Float32Array(bins);let max=0;
  for(let k=0;k<bins;k++){
    const omega=Math.PI*k/(bins-1);let re=0,im=0;
    for(let i=0;i<n;i++){const window=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,n-1)),a=omega*i;re+=samples[i]*window*Math.cos(a);im-=samples[i]*window*Math.sin(a);}
    out[k]=Math.hypot(re,im);max=Math.max(max,out[k]);
  }
  if(max)for(let i=0;i<bins;i++)out[i]/=max;return out;
}
