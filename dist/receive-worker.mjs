import {MorseDecoder} from './morse.mjs?v=0.2.4';
import {Receiver,PROFILES,phaseProfile} from './codec.mjs?v=0.3.8';
import {TransferTracker,SameTracker} from './transfers.mjs?v=0.3.8';
let receiver,tracker,same,morse,job=0,samplesProcessed=0,sampleRate=48000;
self.onmessage=({data})=>{
  if(data.type==='init'){
    job=data.job;samplesProcessed=0;sampleRate=data.sr;
    const send=message=>self.postMessage({...message,job});
    tracker=new TransferTracker(send);same=new SameTracker(data.sr,send);morse=new MorseDecoder(data.sr,send,{wpm:data.morseWpm||15,sensitivity:data.sensitivity});
    receiver=new Receiver(data.sr,f=>f.protocol==='custom'?tracker.frame(f):same.frame(f),profile=>send({type:'sync',profile}),[...['balanced','resilient','fast'].map(key=>phaseProfile(PROFILES[key],['dbpsk','dqpsk'].includes(data.modulation)?data.modulation:'bfsk',+data.carrier)),PROFILES.same],h=>tracker.header({...h,sampleRate}),{sensitivity:data.sensitivity,onReject:h=>tracker.reject({...h,sampleRate})});
  }else if(data.type==='sensitivity'&&data.job===job){receiver?.setSensitivity(data.sensitivity);morse?.setSensitivity(data.sensitivity);
  }else if(data.type==='morse-speed'&&data.job===job){morse?.setWpm(data.wpm);
  }else if(data.type==='audio'&&data.job===job){
    receiver?.feed(data.samples);morse?.feed(data.samples);samplesProcessed+=data.samples.length;tracker.tick(samplesProcessed,sampleRate);if(data.ack)self.postMessage({type:'audio-ack',job});if(data.done){tracker.finish();same.finish();morse.finish();self.postMessage({type:'done',job});}
  }else if(data.type==='finish'&&data.job===job){tracker?.finish();same?.finish();morse?.finish();self.postMessage({type:'done',job});}
};
