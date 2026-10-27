export function nextMusicalBar(time:number,bpm:number,meter:{numerator:number;denominator:number}|null|undefined,origin=0,lead=.15):number|null {
  if(!Number.isFinite(time)||!Number.isFinite(bpm)||bpm<30||bpm>300)return null;
  const beats=meter?.numerator??4,denominator=meter?.denominator??4;
  if(!Number.isInteger(beats)||beats<1||beats>16||![1,2,4,8,16].includes(denominator))return null;
  const bar=60/bpm*4/denominator*beats,base=Number.isFinite(origin)?origin:0;
  return base+Math.ceil((time+lead-base)/bar)*bar;
}
