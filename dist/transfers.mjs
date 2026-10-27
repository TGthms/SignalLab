import {crc32,PROFILES,customPreambleBytes} from './codec.mjs?v=0.2.3';

// Repetition is part of the wire protocol, not a timer or a UI assumption.
export class TransferTracker {
  constructor(onUpdate){this.onUpdate=onUpdate;this.transfers=new Map();}
  header(h){
    let t=this.transfers.get(h.id);
    if(!t){
      if(this.transfers.size>=50)this.transfers.delete(this.transfers.keys().next().value);
      t={id:h.id,total:h.total,received:[],announced:[],failed:[],state:'receiving',payloadLength:h.payloadLength,profile:h.profile};
      this.transfers.set(h.id,t);
    }
    if(t.total!==h.total||t.payloadLength!==h.payloadLength){t.state='conflict';this.emit(t);return;}
    if(Number.isFinite(h.samplePosition)&&Number.isFinite(h.metadataLength)&&!t.deadline){
      const baud=Object.values(PROFILES).find(p=>p.name===h.profile)?.baud||300;
      const rest=(h.metadataLength+h.payloadLength+4)*8/baud;
      // Use the longest lead for future copies so v0.2.2 senders also fit.
      const full=(Math.max(32,customPreambleBytes({baud}))+4+21+h.metadataLength+h.payloadLength+4)*8/baud+.36;
      t.deadlineSeconds=h.samplePosition/h.sampleRate+rest+(h.total-h.index-1)*(full+.65)+1;
      t.deadline=Number.isFinite(t.deadlineSeconds);
    }
    if(!t.announced.includes(h.index)){t.announced.push(h.index);this.emit(t);}
  }
  reject(h){this.header(h);const t=this.transfers.get(h.id);if(t&&!t.received.includes(h.index)&&!t.failed.includes(h.index)){t.failed.push(h.index);this.emit(t);}}
  frame(f){
    if(!f.transmission){this.onUpdate({type:'legacy',frame:f});return;}
    const h={...f.transmission,payloadLength:f.payload.length,profile:f.profile};this.header(h);
    const t=this.transfers.get(h.id);if(!t||t.state==='conflict')return;
    const fingerprint=crc32(f.payload)+':'+JSON.stringify(f.meta);
    // Compare actual bytes as well as metadata; a CRC is integrity detection,
    // not a cryptographic equality or authenticity guarantee.
    if(t.frame&&(t.fingerprint!==fingerprint||!f.payload.every((b,i)=>t.frame.payload[i]===b))){t.state='conflict';this.emit(t);return;}
    if(t.received.includes(h.index))return;
    t.failed=t.failed.filter(i=>i!==h.index);t.fingerprint=fingerprint;t.frame=f;t.received.push(h.index);t.received.sort();
    t.state=t.received.length===t.total?'verified':'receiving';this.emit(t);
  }
  tick(samplePosition,sr){for(const t of this.transfers.values())if(t.state==='receiving'&&t.deadline&&samplePosition/sr>t.deadlineSeconds){t.state='incomplete';this.emit(t);}}
  finish(){for(const t of this.transfers.values())if(t.state==='receiving'){t.state='incomplete';this.emit(t);}}
  emit(t){this.onUpdate({type:'transfer',transfer:{...t,received:[...t.received],announced:[...t.announced],failed:[...t.failed]}});}
}

// SAME always transmits three bursts. Demodulator phases detect each physical
// burst within a few milliseconds; sample positions prevent counting those
// phase candidates as independent copies.
export class SameTracker {
  constructor(sr,onUpdate){this.sr=sr;this.onUpdate=onUpdate;this.current=null;this.counter=0;}
  frame(f){
    const time=f.samplePosition/this.sr;
    if(f.protocol==='same'){
      const expectedSpacing=(16+f.raw.length)*8/(1/.00192)+1;
      let t=this.current;
      if(!t||t.ended||(t.copies===3&&time-t.lastHeader>=.15)||time-t.lastHeader>expectedSpacing+2){
        if(t&&!t.ended)this.finish();
        t={id:'same-'+(++this.counter),protocol:'same',frame:f,copies:0,total:3,endCopies:0,ended:false,lastHeader:-Infinity,lastEnd:-Infinity,conflict:false};this.current=t;
      }
      if(time-t.lastHeader<.15)return;
      if(t.frame.raw!==f.raw)t.conflict=true;
      t.lastHeader=time;t.copies=Math.min(3,t.copies+1);this.emit(t);
    }else if(f.protocol==='eom'&&this.current){
      const t=this.current;if(time-t.lastEnd<.15)return;t.lastEnd=time;t.endCopies=Math.min(3,t.endCopies+1);t.ended=t.endCopies===3;this.emit(t);
    }
  }
  finish(){const t=this.current;if(t){t.finished=true;this.emit(t);}}
  emit(t){this.onUpdate({type:'same-transfer',transfer:{...t,state:t.conflict?'conflict':t.copies===3?'verified':t.finished?'incomplete':'receiving'}});}
}
