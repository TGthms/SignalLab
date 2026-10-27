// International Morse alphabet and timing, ITU-R M.1677-1. This mode carries
// characters directly; it does not add custom framing, copy plans or checksums.
export const MORSE={A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.','É':'..-..','.':'.-.-.-',',':'--..--',':':'---...','?':'..--..',"'":'.----.','-':'-....-','/':'-..-.','(':'-.--.',')':'-.--.-','"':'.-..-.','=':'-...-','+':'.-.-.','@':'.--.-.'};
const REVERSE=Object.fromEntries(Object.entries(MORSE).map(([char,code])=>[code,char]));
export const MORSE_FREQUENCY=700;
export function morsePlan(text,wpm=15){
  if(!Number.isFinite(+wpm)||+wpm<5||+wpm>35)throw Error('Choose a Morse speed from 5 to 35 WPM.');
  const chars=Array.from(String(text));
  const unsupported=[...new Set(chars.filter(c=>!/^\s$/.test(c)&&!Object.hasOwn(MORSE,c.toUpperCase())))];
  if(unsupported.length)throw Error('Unsupported Morse characters: '+unsupported.slice(0,8).join(' ') + '. Use the Morse table, or Custom data for other text.');
  const normalized=chars.map(c=>c.toUpperCase()).join('').trim().replace(/\s+/g,' ');
  if(!normalized)throw Error('Write a Morse message first.');if(normalized.length>120)throw Error('Keep Morse messages at 120 characters or fewer.');
  const unit=1.2/+wpm,segments=[],tokens=[];
  normalized.split(' ').forEach((word,wi)=>{
    if(wi){segments.push({tone:false,units:7});tokens.push('/');}
    [...word].forEach((char,ci)=>{
      if(ci)segments.push({tone:false,units:3});const code=MORSE[char];tokens.push(code);
      [...code].forEach((mark,mi)=>{if(mi)segments.push({tone:false,units:1});segments.push({tone:true,units:mark==='.'?1:3});});
    });
  });
  const duration=segments.reduce((sum,p)=>sum+p.units*unit,0),tail=Math.max(14*unit,1.2)+.15;
  if(duration>180)throw Error('This Morse message exceeds three minutes. Shorten it or increase the speed.');
  return{normalized,code:tokens.join(' '),segments,unit,wpm:+wpm,frequency:MORSE_FREQUENCY,duration,tail};
}
export function morseSignal(text,wpm=15,sampleRate=48000,{tail}={}){
  const plan=morsePlan(text,wpm),lead=.18,end=tail??plan.tail;
  const samples=new Float32Array(Math.ceil((lead+plan.duration+end)*sampleRate));let units=0;
  for(const segment of plan.segments){
    const start=Math.round((lead+units*plan.unit)*sampleRate);units+=segment.units;const stop=Math.round((lead+units*plan.unit)*sampleRate);
    if(segment.tone)for(let i=start;i<stop;i++){
      const ramp=Math.min(1,(i-start)/(sampleRate*.004),(stop-1-i)/(sampleRate*.004));
      samples[i]=.6*Math.sin(2*Math.PI*plan.frequency*(i-start)/sampleRate)*Math.max(0,ramp);
    }
  }
  return{...plan,samples,sr:sampleRate};
}
export class MorseDecoder {
  constructor(sr,onUpdate,{wpm=15,sensitivity='normal'}={}){
    Object.assign(this,{sr,onUpdate});this.n=Math.round(sr*.015);this.hop=Math.round(sr*.005);this.buffer=new Float32Array();this.position=0;this.counter=0;this.current=null;this.pattern='';this.on=false;this.edge=0;this.lastMark=0;
    this.c=Float32Array.from({length:this.n},(_,i)=>Math.cos(2*Math.PI*MORSE_FREQUENCY*i/sr));this.s=Float32Array.from({length:this.n},(_,i)=>Math.sin(2*Math.PI*MORSE_FREQUENCY*i/sr));this.setWpm(wpm);this.setSensitivity(sensitivity);
  }
  setSensitivity(value){this.floor={low:1e-7,normal:1e-9,high:1e-11}[value]??1e-9;}
  setWpm(value){if(!Number.isFinite(+value)||+value<5||+value>35)throw Error('Invalid Morse receive speed.');if(this.current)this.finish();this.wpm=+value;this.unit=1.2/this.wpm;}
  feed(chunk){
    const all=new Float32Array(this.buffer.length+chunk.length);all.set(this.buffer);all.set(chunk,this.buffer.length);let at=0;
    for(;at+this.n<=all.length;at+=this.hop){
      let re=0,im=0,sum=0;for(let i=0;i<this.n;i++){const x=all[at+i];re+=x*this.c[i];im+=x*this.s[i];sum+=x*x;}
      const power=(re*re+im*im)/(this.n*this.n),fraction=sum?2*(re*re+im*im)/(this.n*sum):0;
      const tone=power>this.floor&&fraction>(this.on?.42:.6),time=(this.position+at)/this.sr;
      if(tone!==this.on){
        const span=time-this.edge;
        if(this.on)this.mark(span);
        else if(this.current&&this.current.text&&time-this.lastMark>=5*this.unit&&!this.current.text.endsWith(' ')){this.current.text+=' ';this.current.tokens.push('/');}
        this.on=tone;this.edge=time;
      }
      if(!tone&&this.current){const quiet=time-this.edge;if(quiet>=2*this.unit)this.letter();if(quiet>=Math.max(14*this.unit,1.2))this.finish();}
    }
    this.position+=at;this.buffer=all.slice(at);
  }
  mark(duration){
    const ratio=duration/this.unit;this.lastMark=this.edge+duration;
    if(ratio<.4)return;
    if(ratio>4.8){if(this.current){this.pattern+='?';this.letter();}return;}
    if(!this.current)this.current={id:'morse-'+(++this.counter),protocol:'morse',state:'receiving',text:'',tokens:[],wpm:this.wpm,frequency:MORSE_FREQUENCY};
    this.pattern+=ratio<2?'.':'-';if(this.pattern.length>6)this.letter();
  }
  letter(){if(!this.current||!this.pattern)return;this.current.text+=REVERSE[this.pattern]||'�';this.current.tokens.push(this.pattern);this.pattern='';this.emit();}
  finish(){
    if(this.on&&this.current){this.pattern+='?';this.current.truncated=true;}
    this.letter();if(this.current){this.current.text=this.current.text.trim();this.current.state=this.current.truncated?'incomplete':'decoded';this.emit();}
    this.current=null;this.pattern='';
  }
  emit(){const t=this.current;this.onUpdate({type:'morse-transfer',transfer:{...t,tokens:[...t.tokens],code:t.tokens.join(' '),frame:{protocol:'morse',text:t.text,code:t.tokens.join(' '),wpm:t.wpm,frequency:t.frequency}}});}
}
