import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveDirectorView from '../src/components/react/LiveDirectorView';
import type { EventPlaybackRequest, QueueSelectionOptions } from '../src/hooks/useLiveDirectorEventAdvance';
import { buildLiveDirectorSectionsFromMarkers, normalizePersistedLiveDirectorSession } from '../src/utils/liveDirectorSongSession';
import '../src/styles/global.css';
import './style.css';
import clickGrids from './click-grids.json';

type Song = {id:string; titulo:string; cantante:string; tonalidad:string; bpm:number; timeSignature?:{numerator:number;denominator:number}; artworkUrl?:string; section_markers:unknown; multitrack_session:any};
function Lab() {
  // Local browser test harness: endpoints remain mocked or blocked by the lab server.
  const labEventId = new URLSearchParams(location.search).get('labEvent') || '';

  const [songs,setSongs]=useState<Song[]>([]);
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const [autoPlayRequest,setAutoPlayRequest]=useState<EventPlaybackRequest|null>(null);
  const selectionToken=useRef(0);
  const selectSong=(id:string,options?:QueueSelectionOptions)=>{
    const token=++selectionToken.current;
    setAutoPlayRequest(options?.autoPlay && labEventId ? {songId:id,token} : null);
    setSelected(id);
  };
  const cancelAutoPlay=()=>{selectionToken.current++;setAutoPlayRequest(null);};
  const mixes=useRef<Record<string,any>>({});
  useEffect(()=>{fetch('/api/lab/songs').then(r=>{if(!r.ok)throw new Error('No se pudo abrir la copia de canciones.');return r.json();}).then(data=>{setSongs(data.songs);setSelected(data.songs.find((s:Song)=>s.titulo==='Providencia')?.id || data.songs[0]?.id || '');}).catch(e=>setError(e.message));},[]);
  const song=songs.find(s=>s.id===selected);
  const clickGrid=song ? (clickGrids as Record<string,{bpm:number;originSeconds:number}>)[song.id] : undefined;
  const resolvedSession=useMemo(()=>{
    if(!song)return null;
    const session=normalizePersistedLiveDirectorSession(song.multitrack_session,{songId:song.id,songTitle:song.titulo});
    const localMix=mixes.current[song.id];
    return session && localMix ? {...session,tracks:session.tracks.map(track=>({...track,...localMix.tracks?.find((t:any)=>t.id===track.id)})),...(localMix.groups?{mixGroups:localMix.groups}:{})}:session;
  },[song]);
  // Como ModoEnsayoDirector: la siguiente canción se carga sonando para el cambio preparado sin silencio.
  const prepareQueueSong=async(id:string)=>{
    const next=songs.find(s=>s.id===id);
    const session=next?normalizePersistedLiveDirectorSession(next.multitrack_session,{songId:next.id,songTitle:next.titulo}):null;
    if(!session)throw new Error('Esta canción todavía no tiene stems preparados.');
    const localMix=mixes.current[id];
    return localMix?{...session,tracks:session.tracks.map(track=>({...track,...localMix.tracks?.find((t:any)=>t.id===track.id)}))}:session;
  };
  const sections=useMemo(()=>song?buildLiveDirectorSectionsFromMarkers(song.section_markers):[],[song]);
  const queue=useMemo(()=>songs.map(s=>({id:s.id,title:s.titulo,subtitle:s.cantante,artworkUrl:s.artworkUrl})),[songs]);
  return <>
    <div className="lab-banner" role="status"><strong>EXPERIMENTAL</strong><span>Copia de prueba · Los ajustes no cambian Alabanza</span><a className="lab-mode" href={labEventId ? "/" : "/?labEvent=lab-playback-preview"}>{labEventId ? "Canción suelta" : "Probar evento"}</a><label>Canción <select aria-label="Canción de prueba" value={selected} disabled={!songs.length} onChange={event=>selectSong(event.target.value)}>{songs.map(s=><option key={s.id} value={s.id}>{s.titulo}</option>)}</select></label></div>
    {error?<main className="lab-message" role="alert"><h1>No se pudo abrir la prueba</h1><p>{error}</p><button onClick={()=>location.reload()}>Reintentar</button></main>:!song?<main className="lab-message" aria-live="polite">Abriendo copia de prueba…</main>:<LiveDirectorView
      experimentalTools eventId={labEventId} eventTitle={labEventId ? 'Evento de prueba local' : ''} key={new URLSearchParams(location.search).has('labRetainView') ? 'queue' : song.id} mode="ensayo" songId={song.id} songTitle={song.titulo} songKey={song.tonalidad} songArtworkUrl={song.artworkUrl}
      title="LiveDirector · Experimental" subtitle={song.titulo} bpm={clickGrid?.bpm ?? song.bpm} timeSignature={song.timeSignature} generatedClickGrid={clickGrid}
      initialSession={resolvedSession} sections={sections} requiresSongContext
      queueSongs={queue} activeQueueSongId={song.id} onSelectQueueSong={selectSong} onPrepareQueueSong={prepareQueueSong}
      onResolveQueueSongTracks={labEventId?async(id:string)=>(await prepareQueueSong(id)).tracks.filter((track:any)=>track.enabled!==false):undefined}
      autoPlayRequest={autoPlayRequest} onCancelAutoPlay={cancelAutoPlay} onAutoPlayHandled={token=>setAutoPlayRequest(previous=>previous?.token===token?null:previous)}
      autoStartPadWithTransport={false} onEventMixChange={mix=>{mixes.current[song.id]=mix;}}
      onBack={()=>{location.reload();}} backLabel="Reiniciar prueba" className="lab-director"
      operationalChips={[{id:'lab',label:'PRUEBA',value:'Local',tone:'info',active:true}]}
    />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Lab/>);
