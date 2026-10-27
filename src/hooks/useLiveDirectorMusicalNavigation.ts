import {useCallback,useEffect,useRef,useState} from 'react';
import type {TrackData} from '../services/MultitrackEngine';
type Prepared={serial:number;completion:Promise<boolean>};
type Pending={kind:'restart'|'song';id:string;title:string;phase:'preparing'|'ready';boundary:number|null};
type Options={enabled:boolean;identity:string;playing:boolean;ready:boolean;busy:boolean;getTime:()=>number;
  sectionEnd:(time:number)=>number|null;recordedEntry:boolean;
  prepareSong?:(id:string)=>Promise<{tracks:TrackData[];recordedEntry:boolean;startSeconds?:number}>;
  prepareAudio?:(tracks:TrackData[],pauseAtTarget?:boolean,startSeconds?:number)=>Promise<Prepared>;
  prepareRestart?:(pauseAtTarget:boolean)=>Promise<Prepared>;
  schedule?:(serial:number,boundary:number)=>void;cancelAudio?:()=>void;
  afterRestart?:()=>void;
  beforeArm:()=>void;select:(id:string,recorded:boolean)=>void;startCount:()=>Promise<void>;
};
export function useLiveDirectorMusicalNavigation(options:Options){
 const latest=useRef(options);latest.current=options;
 const[pending,setPending]=useState<Pending|null>(null),[notice,setNotice]=useState('');
 const job=useRef<Pending|null>(null),generation=useRef(0),committing=useRef(false);
 const cancel=useCallback(()=>{if(!job.current)return false;generation.current++;job.current=null;latest.current.cancelAudio?.();setPending(null);setNotice('');return true;},[]);
 useEffect(()=>{if(job.current)latest.current.cancelAudio?.();generation.current++;job.current=null;setPending(null);setNotice('');},[options.identity]);
 useEffect(()=>()=>{if(job.current)latest.current.cancelAudio?.();generation.current++;},[]);
 useEffect(()=>{if(pending&&(!options.enabled||!options.playing||!options.ready||options.busy)&&!committing.current)cancel();},[options.enabled,options.playing,options.ready,options.busy,pending,cancel]);
 const arm=useCallback(async(kind:'restart'|'song',id:string,title:string)=>{
  const o=latest.current;if(!o.enabled){setNotice('Este motor necesita pausa para cambiar de canción.');return false;}if(!o.ready||!o.playing||o.busy)return false;
  cancel();
  // Lock the end of the section that was playing when the user requested the
  // change. Preparing destination stems must never move the boundary forward
  // to a bar or a later section and make the transition feel unexpected.
  const requestedAt=o.getTime(),boundary=o.sectionEnd(requestedAt);
  if(boundary===null||boundary-requestedAt<.05){setNotice('No hay tiempo suficiente para preparar el cambio antes del final de esta sección.');return false;}
  o.beforeArm();const token=++generation.current;
  const initial:Pending={kind,id,title,phase:'preparing',boundary:null};job.current=initial;setPending(initial);setNotice('');
  try{
   // Sin forma de cargar la siguiente canción sonando, no se finge el cambio con un reinicio de esta.
   if(kind==='song'&&!o.prepareSong)throw new Error('Esta pantalla no puede preparar la siguiente canción sin pausa.');
   const destination=kind==='song'?await o.prepareSong?.(id):null;
   if(generation.current!==token)return false;
   const recorded=kind==='song'?destination?.recordedEntry??false:o.recordedEntry;
   const prepared=kind==='song'&&destination?await o.prepareAudio?.(destination.tracks,!recorded,destination.startSeconds):await o.prepareRestart?.(!recorded);
   if(generation.current!==token)return false;
   if(!prepared)throw new Error('El motor no admite este cambio preparado.');
   latest.current.schedule?.(prepared.serial,boundary);
   const armed={...initial,phase:'ready' as const,boundary};job.current=armed;setPending(armed);
   const done=await prepared.completion;if(generation.current!==token)return false;
   if(!done)throw new Error('El audio no estuvo listo para el cierre. La canción continúa.');
   committing.current=true;job.current=null;setPending(null);setNotice('');
   if(kind==='song')latest.current.select(id,recorded);else {latest.current.afterRestart?.();if(!recorded)await latest.current.startCount();}
   committing.current=false;return true;
  }catch(error){if(generation.current===token){job.current=null;latest.current.cancelAudio?.();setPending(null);setNotice(error instanceof Error?error.message:'No se pudo preparar el cambio.');}committing.current=false;return false;}
 },[cancel]);
 return{pending,notice,cancel,arm,clearNotice:()=>setNotice('')};
}
