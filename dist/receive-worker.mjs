import {Receiver} from './codec.mjs?v=0.2.1';
import {TransferTracker,SameTracker} from './transfers.mjs?v=0.2.1';
let receiver,tracker,same,job=0,samplesProcessed=0,sampleRate=48000;
self.onmessage=({data})=>{
  if(data.type==='init'){
    job=data.job;samplesProcessed=0;sampleRate=data.sr;
    const send=message=>self.postMessage({...message,job});
    tracker=new TransferTracker(send);same=new SameTracker(data.sr,send);
    receiver=new Receiver(data.sr,f=>f.protocol==='custom'?tracker.frame(f):same.frame(f),profile=>send({type:'sync',profile}),undefined,h=>tracker.header({...h,sampleRate}));
  }else if(data.type==='audio'&&data.job===job){
    receiver?.feed(data.samples);samplesProcessed+=data.samples.length;tracker.tick(samplesProcessed,sampleRate);if(data.done){tracker.finish();same.finish();self.postMessage({type:'done',job});}
  }else if(data.type==='finish'&&data.job===job){tracker?.finish();same?.finish();self.postMessage({type:'done',job});}
};
