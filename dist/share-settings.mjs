const modes=['bfsk','dbpsk','dqpsk'],rates=['resilient','balanced','fast'];
export function createReceiverLink(href,{modulation,carrier,rate}){
  if(!modes.includes(modulation)||!rates.includes(rate)||modulation!=='bfsk'&&![1800,20500].includes(+carrier))throw Error('Invalid signal settings.');
  const url=new URL(href);url.search='';url.hash='decoder';url.searchParams.set('sl-signal',modulation);url.searchParams.set('sl-speed',rate);
  if(modulation!=='bfsk')url.searchParams.set('sl-carrier',String(+carrier));return url.href;
}
export function readReceiverLink(href){
  const url=new URL(href);if(url.hash!=='#decoder')return null;
  const q=url.searchParams,signal=q.get('sl-signal'),rate=q.get('sl-speed'),carrier=q.get('sl-carrier');
  if(!modes.includes(signal)||!rates.includes(rate)||q.getAll('sl-signal').length!==1||q.getAll('sl-speed').length!==1)return null;
  if(signal==='bfsk'){if(carrier!==null)return null;return {modulation:signal,carrier:1800,rate};}
  if(q.getAll('sl-carrier').length!==1||!['1800','20500'].includes(carrier))return null;
  return {modulation:signal,carrier:+carrier,rate};
}
