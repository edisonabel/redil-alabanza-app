import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveDirectorView from '../src/components/react/LiveDirectorView';
import { buildLiveDirectorSectionsFromMarkers, normalizePersistedLiveDirectorSession } from '../src/utils/liveDirectorSongSession';
import '../src/styles/global.css';
import './style.css';
import clickGrids from './click-grids.json';

type Song = {id:string; titulo:string; cantante:string; tonalidad:string; bpm:number; section_markers:unknown; multitrack_session:any};
function Lab() {
  const [songs,setSongs]=useState<Song[]>([]);
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const mixes=useRef<Record<string,any>>({});
  useEffect(()=>{fetch('/api/lab/songs').then(r=>{if(!r.ok)throw new Error('No se pudo abrir la copia de canciones.');return r.json();}).then(data=>{setSongs(data.songs);setSelected(data.songs.find((s:Song)=>s.titulo==='Providencia')?.id || data.songs[0]?.id || '');}).catch(e=>setError(e.message));},[]);
  const song=songs.find(s=>s.id===selected);
  const clickGrid=song ? (clickGrids as Record<string,{bpm:number;originSeconds:number}>)[song.id] : undefined;
  const resolvedSession=useMemo(()=>{
    if(!song)return null;
    const session=normalizePersistedLiveDirectorSession(song.multitrack_session,{songId:song.id,songTitle:song.titulo});
    const localMix=mixes.current[song.id];
    return session && localMix ? {...session,tracks:session.tracks.map(track=>({...track,...localMix.tracks?.find((t:any)=>t.id===track.id)}))}:session;
  },[song]);
  const sections=useMemo(()=>song?buildLiveDirectorSectionsFromMarkers(song.section_markers):[],[song]);
  const queue=useMemo(()=>songs.map(s=>({id:s.id,title:s.titulo,subtitle:s.cantante})),[songs]);
  return <>
    <div className="lab-banner" role="status"><strong>EXPERIMENTAL</strong><span>Copia de prueba · Los ajustes no cambian Alabanza</span><label>Canción <select aria-label="Canción de prueba" value={selected} disabled={!songs.length} onChange={event=>setSelected(event.target.value)}>{songs.map(s=><option key={s.id} value={s.id}>{s.titulo}</option>)}</select></label></div>
    {error?<main className="lab-message" role="alert"><h1>No se pudo abrir la prueba</h1><p>{error}</p><button onClick={()=>location.reload()}>Reintentar</button></main>:!song?<main className="lab-message" aria-live="polite">Abriendo copia de prueba…</main>:<LiveDirectorView
      experimentalTools key={song.id} mode="ensayo" songId={song.id} songTitle={song.titulo} songKey={song.tonalidad}
      title="LiveDirector · Experimental" subtitle={song.titulo} bpm={clickGrid?.bpm ?? song.bpm} generatedClickGrid={clickGrid}
      initialSession={resolvedSession} sections={sections} requiresSongContext
      queueSongs={queue} activeQueueSongId={song.id} onSelectQueueSong={setSelected}
      autoStartPadWithTransport={false} onEventMixChange={mix=>{mixes.current[song.id]=mix;}}
      onBack={()=>{location.reload();}} backLabel="Reiniciar prueba" className="lab-director"
      operationalChips={[{id:'lab',label:'PRUEBA',value:'Local',tone:'info',active:true}]}
    />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Lab/>);
