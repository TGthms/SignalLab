/* Signal Lab audio modem. Pure DSP and framing; shared by the app, worker and tests. */
export const PROFILES = {
  balanced: { name: 'Balanced', baud: 300, zero: 1200, one: 2400 },
  resilient: { name: 'Resilient', baud: 100, zero: 1200, one: 2400 },
  fast: { name: 'Fast', baud: 600, zero: 1200, one: 2400 },
  same: { name: 'SAME', baud: 1 / .00192, zero: 1562.5, one: 4 / .00192 }
};
export const MAX_PAYLOAD = 8192;
// Microphone signals can be tens of dB below generated WAV levels. Keep the
// acquisition/clock floor near numerical silence; CRC and grammar validate data.
export const SENSITIVITY = {
  low: { floor: 1e-7, syncErrors: 0 },
  normal: { floor: 1e-9, syncErrors: 1 },
  high: { floor: 1e-11, syncErrors: 2 }
};
// A fixed-duration training lead gives phone audio routes time to settle.
export const customPreambleBytes = (profile,index=0) => Math.max(8, Math.ceil(profile.baud * (index===0?1.8:.32) / 8));
function bitErrors(word){word >>>= 0;let n=0;while(word){word&=word-1;n++;}return n;}
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let i=0; i<8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
function scrambleStep(state) { state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0; }
export function packet(payload, meta, transmission = {}) {
  if (payload.length > MAX_PAYLOAD) throw new Error('Keep the payload at 8 KiB or less.');
  const m = enc.encode(JSON.stringify(meta));
  if (m.length < 2 || m.length > 1024) throw new Error('File metadata is too long.');
  const total = transmission.total ?? 1, index = transmission.index ?? 0;
  const id = transmission.id ?? '0000000000000000';
  if (![1,2,3].includes(total) || !Number.isInteger(index) || index < 0 || index >= total) throw new Error('Invalid repetition plan.');
  if (!/^[a-f0-9]{16}$/i.test(id)) throw new Error('A transfer ID must contain 16 hex digits.');
  const body = new Uint8Array(21 + m.length + payload.length), v = new DataView(body.buffer);
  body[0]=2; v.setUint16(1,m.length); v.setUint32(3,payload.length);
  body[7]=total;body[8]=index;
  for(let i=0;i<8;i++)body[9+i]=parseInt(id.slice(i*2,i*2+2),16);
  v.setUint32(17,crc32(body.subarray(0,17)));
  body.set(m,21);body.set(payload,21+m.length);
  const preamble=transmission.preambleBytes??32;
  if(!Number.isInteger(preamble)||preamble<8||preamble>256)throw Error('Invalid preamble length.');
  const start=preamble+4,bytes=new Uint8Array(start+body.length+4);bytes.fill(0x55,0,preamble);
  bytes.set([0x53,0x4c,0x41,0x42],preamble);bytes.set(body,start);
  new DataView(bytes.buffer).setUint32(bytes.length-4,crc32(body));
  let state=0x1a2b3c4d;for(let i=start;i<bytes.length;i++){state=scrambleStep(state);bytes[i]^=state&255;}
  return bytes;
}
export function modulate(bytes, profile=PROFILES.balanced, sampleRate=48000, amplitude=.65) {
  const spb=sampleRate/profile.baud, padding=Math.round(sampleRate*.18);
  const out=new Float32Array(padding*2+Math.ceil(bytes.length*8*spb));
  let phase=0, idx=padding,previous=profile.zero;
  const transition=profile.name==='SAME'?0:Math.round(spb*(profile.smooth??.1));
  for(let bit=0;bit<bytes.length*8;bit++) {
    const freq=(bytes[bit>>3]>>(bit&7))&1 ? profile.one : profile.zero;
    const end=padding+Math.round((bit+1)*spb);
    const begin=idx;
    for(;idx<end;idx++) {
      // Round the frequency change over the first 10% of a custom symbol.
      // Its middle remains a pure tone for the receiver; SAME is untouched.
      const u=transition?Math.min(1,(idx-begin)/transition):1;
      const shaped=previous+(freq-previous)*(.5-.5*Math.cos(Math.PI*u));
      out[idx]=Math.sin(phase)*amplitude;phase=(phase+2*Math.PI*shaped/sampleRate)%(2*Math.PI);
    }
    previous=freq;
  }
  const ramp=Math.round(sampleRate*.002);
  for(let i=0;i<ramp;i++) {out[padding+i]*=i/ramp;out[idx-1-i]*=i/ramp;}
  return out;
}
export function joinAudio(parts, sr=48000, gap=1) {
  const silence=Math.round(sr*gap), size=parts.reduce((n,p)=>n+p.length,0)+silence*Math.max(0,parts.length-1);
  const out=new Float32Array(size); let at=0;
  parts.forEach((p,i)=>{out.set(p,at);at+=p.length+(i<parts.length-1?silence:0);});return out;
}
export function sameBytes(header) {const out=new Uint8Array(16+header.length);out.fill(0xab,0,16);out.set(enc.encode(header),16);return out;}
export function sameHeader({origin='EAS', event='RWT', locations='006037', duration='0015', sender='LABTEST', date=new Date()}) {
  if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(event)) throw new Error('Originator and event codes need three uppercase letters.');
  const locs=locations.split(/[,\s]+/).filter(Boolean);
  if(!locs.length||locs.length>31||locs.some(l=>!/^\d{6}$/.test(l))) throw new Error('Enter 1–31 six-digit SAME location codes, separated by commas.');
  if(!/^\d{4}$/.test(duration)||+duration.slice(2)>59) throw new Error('Duration must be HHMM, with minutes below 60.');
  if(!/^[A-Z0-9 /-]{1,8}$/.test(sender)) throw new Error('Station ID needs 1–8 uppercase letters, numbers, spaces, / or -.');
  if(!Number.isFinite(date.getTime())) throw new Error('Choose a valid issue time.');
  const day=Math.floor((Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())-Date.UTC(date.getUTCFullYear(),0,0))/86400000);
  const stamp=String(day).padStart(3,'0')+String(date.getUTCHours()).padStart(2,'0')+String(date.getUTCMinutes()).padStart(2,'0');
  return `ZCZC-${origin}-${event}-${locs.join('-')}+${duration}-${stamp}-${sender.padEnd(8,' ')}-`;
}
export function parseSame(header) {
  const m=header.match(/^ZCZC-([A-Z]{3})-([A-Z]{3})-((?:\d{6}-)*\d{6})\+(\d{4})-(\d{7})-([\x20-\x7e]{8})-$/);
  if(!m) return null;
  return {origin:m[1],event:m[2],locations:m[3].split('-'),duration:m[4],issued:m[5],sender:m[6].trim(),raw:header};
}
export function wav(samples,sr=48000) {
  const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b);
  const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((s,i)=>v.setInt16(44+i*2,Math.max(-1,Math.min(1,s))*32767,true));return b;
}

// Eight interleaved timing candidates recover unaligned bit clocks. Tone energies
// use quadrature correlation over the middle 80% of a symbol. Frames are accepted
// only after CRC-32 validation (custom mode) or complete grammar matching (SAME).
class Demodulator {
  constructor(sr,profile,onFrame,onProgress,onHeader,options={}) {
    Object.assign(this,{sr,profile,onFrame,onProgress,onHeader,onReject:options.onReject});this.spb=sr/profile.baud;this.hop=this.spb/8;
    this.n=Math.round(this.spb*.8);this.tick=0;this.base=0;this.buffer=new Float32Array(0);
    this.previousConfidence=0;this.previousPower=0;this.peaks=[0,0];this.setSensitivity(options.sensitivity);
    this.track=Array.from({length:8},(_,phase)=>({shift:0,history:0,bits:0,bytes:null,bit:0,byte:0,expected:0,next:phase,rng:0x1a2b3c4d}));
    this.kernels=[profile.zero,profile.one].map(f=>({c:Float32Array.from({length:this.n},(_,i)=>Math.cos(2*Math.PI*f*i/sr)),s:Float32Array.from({length:this.n},(_,i)=>Math.sin(2*Math.PI*f*i/sr))}));
  }
  setSensitivity(value){this.sensitivity=SENSITIVITY[value]||SENSITIVITY.normal;}
  feed(chunk) {
    const all=new Float32Array(this.buffer.length+chunk.length);all.set(this.buffer);all.set(chunk,this.buffer.length);this.buffer=all;
    while(true) {
      const at=Math.round(this.tick*this.hop)-this.base;
      if(at+this.n>all.length) break;
      let p0=0,p1=0;
      for(let k=0;k<2;k++) {
        let re=0,im=0;const {c,s}=this.kernels[k];
        for(let j=0;j<this.n;j++){re+=all[at+j]*c[j];im+=all[at+j]*s[j];}
        if(k===0)p0=re*re+im*im;else p1=re*re+im*im;
      }
      const power=(p0+p1)/(this.n*this.n);
      // Alternating preamble exposes both tone levels. Leaky peaks compensate
      // for speaker/microphone coloration without multiplying captured PCM.
      // SAME retains its existing decision path.
      let a=p0,b=p1;
      if(this.profile.name!=='SAME'){
        this.peaks[0]=Math.max(p0,this.peaks[0]*.999);
        this.peaks[1]=Math.max(p1,this.peaks[1]*.999);
        const ratio=Math.max(.0625,Math.min(16,(this.peaks[0]+1e-20)/(this.peaks[1]+1e-20)));
        b*=ratio;
      }
      const bit=b>a?1:0,confidence=(b-a)/(a+b+1e-15);
      if(power>this.sensitivity.floor&&this.previousPower>this.sensitivity.floor&&confidence*this.previousConfidence<0){
        const crossing=this.tick-1-this.previousConfidence/(confidence-this.previousConfidence);
        for(const t of this.track)if(t.bytes){
          // A tone transition locates a bit boundary. Move the sampling clock
          // gently toward the middle of each bit, following device-clock drift.
          let error=((crossing+4-t.next)%8+12)%8-4;
          t.next+=error*.18;
        }
      }
      for(const t of this.track)if(this.tick>=t.next){t.next+=8;this.accept(t,bit,power);}
      this.previousConfidence=confidence;this.previousPower=power;this.tick++;
    }
    const cut=Math.max(0,Math.round(this.tick*this.hop)-this.base);this.buffer=all.slice(cut);this.base+=cut;
  }
  reset(t){t.bytes=null;t.bit=0;t.byte=0;t.expected=0;t.validHeader=null;}
  accept(t,bit,power) {
    // Shift bit-serial sync; LSB-first byte order produces these bit-reversed words.
    t.history=((t.history<<1)|(t.shift>>>31))>>>0;t.shift=((t.shift<<1)|bit)>>>0;t.bits++;
    if(t.bytes) {
      t.byte|=bit<<t.bit;t.bit++;
      if(t.bit!==8)return;
      let b=t.byte;t.byte=0;t.bit=0;
      if(this.profile.name!=='SAME'){t.rng=scrambleStep(t.rng);b^=t.rng&255;}
      t.bytes.push(b);
      if(this.profile.name==='SAME') {
        if(b<32||b>126||t.bytes.length>300){this.reset(t);return;}
        if(b===45) {
          const raw='ZCZC'+String.fromCharCode(...t.bytes);const parsed=parseSame(raw);
          if(parsed){this.onFrame({protocol:'same',...parsed,samplePosition:Math.round(this.tick*this.hop)});this.reset(t);}
        }
      } else {
        if(t.bytes.length===7) {
          const a=Uint8Array.from(t.bytes),v=new DataView(a.buffer),ml=v.getUint16(1),pl=v.getUint32(3);
          if(![1,2].includes(a[0])||ml>1024||pl>MAX_PAYLOAD||ml<2){this.reset(t);return;}
          t.expected=(a[0]===2?21:7)+ml+pl+4;
        }
        if(t.bytes[0]===2 && t.bytes.length===21) {
          const a=Uint8Array.from(t.bytes),v=new DataView(a.buffer);
          if(![1,2,3].includes(a[7])||a[8]>=a[7]||crc32(a.subarray(0,17))!==v.getUint32(17)){this.reset(t);return;}
          t.validHeader={protocol:'custom',version:2,profile:this.profile.name,total:a[7],index:a[8],id:Array.from(a.subarray(9,17),b=>b.toString(16).padStart(2,'0')).join(''),payloadLength:v.getUint32(3),metadataLength:v.getUint16(1),samplePosition:Math.round(this.tick*this.hop)};this.onHeader?.(t.validHeader);
        }
        if(t.expected&&t.bytes.length===t.expected) {
          const a=Uint8Array.from(t.bytes),v=new DataView(a.buffer),end=a.length-4;
          if(crc32(a.subarray(0,end))===v.getUint32(end)) {
            try {
              const ml=v.getUint16(1),start=a[0]===2?21:7,meta=JSON.parse(dec.decode(a.subarray(start,start+ml)));
              if(!meta||typeof meta!=='object'||Array.isArray(meta))throw Error();
              const transmission=a[0]===2?{id:Array.from(a.subarray(9,17),b=>b.toString(16).padStart(2,'0')).join(''),total:a[7],index:a[8]}:null;
              this.onFrame({protocol:'custom',version:a[0],profile:this.profile.name,meta,payload:a.slice(start+ml,end),crc:crc32(a.subarray(0,end)),transmission,samplePosition:Math.round(this.tick*this.hop)});
            }catch{}
          }else if(t.validHeader)this.onReject?.(t.validHeader);
          this.reset(t);
        }
      }
      return;
    }
    if(power<this.sensitivity.floor)return;
    const custom=0xca328242; // bit-reversed S L A B
    const same=0x5ac25ac2; // bit-reversed Z C Z C
    const eom=0x72727272;
    if(this.profile.name==='SAME'&&t.shift===eom){this.onFrame({protocol:'eom',raw:'NNNN',samplePosition:Math.round(this.tick*this.hop)});t.shift=0;}
    const exact=t.shift===(this.profile.name==='SAME'?same:custom);
    const trained=this.profile.name!=='SAME'&&t.bits>=64&&Math.min(bitErrors(t.history^0x55555555),bitErrors(t.history^0xaaaaaaaa))<=6;
    const tolerant=trained&&bitErrors(t.shift^custom)<=this.sensitivity.syncErrors;
    if(exact||tolerant) {t.bytes=[];t.bit=0;t.byte=0;t.expected=0;t.rng=0x1a2b3c4d;this.onProgress?.(this.profile.name);}
  }
}
export class Receiver {
  constructor(sr,onFrame,onProgress,profiles=Object.values(PROFILES),onHeader,options={}) {
    this.demods=profiles.map(p=>new Demodulator(sr,p,onFrame,onProgress,onHeader,options));
  }
  setSensitivity(value){for(const d of this.demods)d.setSensitivity(value);}
  feed(samples){for(const d of this.demods)d.feed(samples);}
}
