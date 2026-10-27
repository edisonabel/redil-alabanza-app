import {useCallback, useEffect, useRef, useState} from 'react';
import {entryCountAt, entryCountPlan} from '../utils/liveDirectorEntryCount';
import type {GuideAudioGraph} from '../services/DynamicGuidePlayer';
import {loadCueBuffer} from '../utils/cueAudioLibrary';
type Options = {
  enabled: boolean; identity: string; ready: boolean; playing: boolean; bpm: number;
  meter?: {numerator:number;denominator:number} | null; unoSeconds?: number | null;
  getTime:()=>number; getGraph:()=>GuideAudioGraph|null; play:()=>Promise<void>; pause:()=>void;
};
type Pending = {reject:(error:Error)=>void; timer:ReturnType<typeof setInterval>; sources:AudioBufferSourceNode[]; gains:AudioNode[]};
const abort = () => new DOMException('Conteo cancelado','AbortError');
export function useLiveDirectorEntryCount(options:Options) {
  const latest=useRef(options);latest.current=options;
  const [beat,setBeat]=useState<number|'ENTRA'|null>(null),[pending,setPending]=useState(false),[notice,setNotice]=useState('');
  const job=useRef<Pending|null>(null),generation=useRef(0);
  const assets=useRef<{context:AudioContext;promise:Promise<Map<number,AudioBuffer>>}|null>(null);
  const preparing=useRef(false),pendingIdentity=useRef('');
  const cancel=useCallback(()=>{
    const wasPending=preparing.current||!!job.current;
    generation.current++;preparing.current=false;
    const old=job.current;job.current=null;
    if(old){clearInterval(old.timer);old.sources.forEach(source=>{try{source.stop()}catch{}source.disconnect()});old.gains.forEach(node=>node.disconnect());old.reject(abort());}
    if(wasPending&&pendingIdentity.current===latest.current.identity)latest.current.pause();
    setPending(false);setBeat(null);return wasPending;
  },[]);
  const load=useCallback((graph:GuideAudioGraph)=>{
    if(assets.current?.context===graph.context)return assets.current.promise;
    // One compact library per audio context. No worklet/PCM session replacement.
    const promise=Promise.all(Array.from({length:8},async(_,i)=>{
      // Shared with DynamicGuidePlayer: the guide numbers are fetched and decoded once.
      const buffer=await loadCueBuffer(graph.context,i===7?'/audio/click-classic/quarter.wav':`/audio/guide-es/${i+1}.wav`).catch(()=>{throw new Error('No se pudo cargar el conteo.');});
      return [i===7?0:i+1,buffer] as const;
    })).then(entries=>new Map(entries));
    assets.current={context:graph.context,promise};return promise;
  },[]);
  // Warm only small count samples when this song actually needs an added count.
  useEffect(()=>{
    if(!options.enabled||!options.ready)return;
    const plan=entryCountPlan(options.bpm,options.meter,options.unoSeconds),graph=latest.current.getGraph();
    if(plan&&!plan.recorded&&graph)void load(graph).catch(()=>{assets.current=null;});
  },[options.enabled,options.ready,options.identity,options.bpm,options.meter?.numerator,options.meter?.denominator,options.unoSeconds,load]);
  useEffect(()=>{cancel();setNotice('');return()=>{cancel();};},[options.identity,cancel]);
  useEffect(()=>{
    const timer=setInterval(()=>{
      const o=latest.current;if(job.current||preparing.current)return;
      const plan=entryCountPlan(o.bpm,o.meter,o.unoSeconds);
      const next=o.enabled&&o.ready&&o.playing&&plan ? entryCountAt(plan,o.getTime()) : null;
      setBeat(previous=>previous===next?previous:next);
    },25);return()=>clearInterval(timer);
  },[]);
  const start=useCallback(async()=>{
    cancel();const token=generation.current,o=latest.current,plan=entryCountPlan(o.bpm,o.meter,o.unoSeconds);
    setNotice(''); pendingIdentity.current=o.identity;
    if(!plan)throw new Error('Configura el tempo para dar la entrada.');
    if(plan.recorded){
      preparing.current=true;setPending(true);
      try{await o.play();if(generation.current!==token){if(latest.current.identity===o.identity)o.pause();throw abort();}}
      finally{if(generation.current===token){preparing.current=false;setPending(false);}}
      return;
    }
    preparing.current=true;setPending(true);setBeat(null);
    const graph=o.getGraph();let buffers:Map<number,AudioBuffer>|null=null;
    if(graph){
      try{await graph.context.resume();buffers=await load(graph);}catch{setNotice('Conteo visual; guía no disponible.');}
    }else setNotice('Conteo visual; no hay pista Click o Guide activa.');
    if(generation.current!==token)throw abort();
    const context=graph?.context,clock=()=>context?context.currentTime:performance.now()/1000;
    const startAt=clock()+.1,endAt=startAt+plan.beats*plan.beatSeconds,sources:AudioBufferSourceNode[]=[],gains:AudioNode[]=[];
    let left:GainNode|undefined,right:GainNode|undefined,gain:GainNode|undefined;
    if(graph&&buffers){
      gain=graph.context.createGain();left=graph.context.createGain();right=graph.context.createGain();const merger=graph.context.createChannelMerger(2);
      gain.connect(left).connect(merger,0,0);gain.connect(right).connect(merger,0,1);merger.connect(graph.destination);gains.push(gain,left,right,merger);
      for(let i=0;i<plan.beats;i++){
        const buffer=buffers.get(i+1)??buffers.get(0);if(!buffer)continue;
        const source=graph.context.createBufferSource();source.buffer=buffer;source.playbackRate.value=Math.max(1,buffer.duration/(plan.beatSeconds*.9));source.connect(gain);source.start(startAt+i*plan.beatSeconds);sources.push(source);
      }
    }
    await new Promise<void>((resolve,reject)=>{
      const tick=()=>{
        if(generation.current!==token)return;
        if(graph&&gain&&left&&right){const state=graph.readState();gain.gain.setTargetAtTime(Math.max(0,Math.min(2,state.gain)),graph.context.currentTime,.005);left.gain.value=state.route==='right'?0:1;right.gain.value=state.route==='right'?1:0;}
        const elapsed=clock()-startAt;if(elapsed<0)return;
        if(clock()>=endAt){
          const current=job.current;job.current=null;if(current)clearInterval(current.timer);sources.forEach(source=>source.disconnect());gains.forEach(node=>node.disconnect());setBeat('ENTRA');
          void latest.current.play().then(()=>{if(generation.current!==token){if(latest.current.identity===o.identity)o.pause();reject(abort());return;}preparing.current=false;setPending(false);setBeat(null);resolve();}).catch(error=>{if(generation.current===token){preparing.current=false;setPending(false);setBeat(null);}reject(error);});return;
        }
        const next=Math.min(plan.beats,Math.floor(elapsed/plan.beatSeconds)+1);setBeat(previous=>previous===next?previous:next);
      };
      job.current={reject,timer:setInterval(tick,10),sources,gains};tick();
    });
  },[cancel,load]);
  return {beat,pending,notice,cancel,start,needsCount:()=>{const o=latest.current;return o.enabled&&!!entryCountPlan(o.bpm,o.meter,o.unoSeconds)&&o.getTime()<.1;}};
}
