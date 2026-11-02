import { ArrowLeft, ArrowRight, Copy, Minus, MoreHorizontal, Plus, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { buildSectionWavePath } from '../../../utils/liveDirectorSectionWave';
import type { LiveDirectorSectionVisual } from '../../../utils/liveDirectorSongSession';
import { MAX_ARRANGEMENT_SECTIONS, originalArrangement, resolveArrangement, arrangementDuration, type ArrangementEntry } from '../../../utils/liveDirectorArrangement';
type Props = { busy: boolean; sections: LiveDirectorSectionVisual[]; entries: ArrangementEntry[] | null; eventTitle?: string; onClose: () => void; onApply: (entries: ArrangementEntry[] | null) => Promise<void> };
const clock = (time: number) => `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
const control = 'inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/30 px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-30';
export function LiveDirectorArrangementEditor(props: Props) {
  const [draft, setDraft] = useState<ArrangementEntry[]>(() => props.entries?.map(entry => ({ ...entry })) ?? originalArrangement(props.sections));
  const history = useRef<ArrangementEntry[][]>([]);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [insertion, setInsertion] = useState<number | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const locked = props.busy || applying;
  const sources = new Map(props.sections.map(section => [section.id, section]));
  const waves = useMemo(() => new Map(props.sections.map((section, index) => [section.id, buildSectionWavePath(index + 1, 18)])), [props.sections]);
  const change = (next: ArrangementEntry[]) => {
    history.current = [...history.current.slice(-39), draft]; setDraft(next); setMenu(null); setError('');
  };
  const insert = (index: number, sectionId: string) => {
    if (locked || draft.length >= MAX_ARRANGEMENT_SECTIONS) return;
    change([...draft.slice(0, index), { id: crypto.randomUUID(), sectionId }, ...draft.slice(index)]); setInsertion(null);
  };
  const move = (index: number, delta: number) => {
    const next = [...draft]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change(next);
  };
  const apply = async () => {
    if (locked) return;
    setApplying(true); setError('');
    try {
      resolveArrangement(props.sections, draft);
      const original = originalArrangement(props.sections);
      const restored = draft.length === original.length && draft.every((entry, index) => entry.sectionId === original[index].sectionId);
      await props.onApply(restored ? null : draft); props.onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo aplicar el arreglo.'); }
    finally { setApplying(false); }
  };
  return <section aria-label="Editar secciones de la canción" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-cyan-200/25 bg-[#1b1f21]">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
      <div className="min-w-0 flex-1"><h2 className="text-xs font-semibold text-cyan-100">Editar secciones</h2><p className="truncate text-[10px] text-white/50" title={props.eventTitle}>{props.eventTitle ? `Evento · ${props.eventTitle}` : 'Temporal · se descarta al salir'} · {clock(arrangementDuration(resolveArrangement(props.sections, draft)))}</p></div>
      <button type="button" className={control} disabled={locked || !history.current.length} aria-label="Deshacer cambio de sección" onClick={() => { const previous = history.current.pop(); if (previous) { setDraft(previous); setMenu(null); setInsertion(null); } }}><Undo2 size={15}/></button>
      <button type="button" className={control} disabled={locked} onClick={() => { change(originalArrangement(props.sections)); setInsertion(null); }}>Restaurar original</button>
      <button type="button" className={control} disabled={applying} onClick={props.onClose}>Cancelar</button>
      <button type="button" className={`${control} border-cyan-200/40 bg-cyan-200/10 text-cyan-100`} disabled={locked} onClick={() => { void apply(); }}>{applying ? 'Guardando…' : props.eventTitle ? 'Guardar en este evento' : 'Aplicar temporalmente'}</button>
    </header>
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2 overflow-x-auto px-3 py-3" aria-label="Secciones del arreglo">
      {draft.map((entry, index) => {
        const section = sources.get(entry.sectionId)!;
        const wave = waves.get(entry.sectionId)!;
        return <div key={entry.id} className="flex shrink-0 items-stretch gap-2">
          <button type="button" className={`${control} self-center rounded-full`} aria-label={`Insertar sección en posición ${index + 1}`} disabled={locked || draft.length >= MAX_ARRANGEMENT_SECTIONS} onClick={() => { setInsertion(index); setMenu(null); }}><Plus size={17}/></button>
          <article data-arrangement-entry={entry.id} className="relative isolate flex w-[190px] min-h-[110px] shrink-0 flex-col justify-center overflow-hidden rounded-2xl border px-3 py-2" style={{ borderColor: section.border, background: section.surface }}>
            <svg data-arrangement-wave="true" aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-1/2 -z-10 h-[75%] -translate-y-1/2" style={{ width: 'calc(100% - 1.5rem)' }} viewBox={`0 0 ${wave.viewBoxWidth} 100`} preserveAspectRatio="none">
              <path d={wave.path} fill="none" stroke="white" strokeOpacity="0.24" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
            </svg>
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent,rgba(12,15,17,0.5))]"/>
            <div className="mb-2 flex items-center justify-between gap-2">
              <button type="button" className={`${control} rounded-full border-rose-200/45 bg-rose-500/65`} aria-label={`Quitar sección ${index + 1}`} disabled={locked || draft.length <= 1} onClick={() => { change(draft.filter(item => item.id !== entry.id)); setInsertion(null); }}><Minus size={16}/></button>
              <span className="rounded bg-black/45 px-1.5 py-0.5 text-[10px] tabular-nums text-white/75">{index + 1}</span>
              <button type="button" className={`${control} rounded-full`} aria-label={`Opciones de sección ${index + 1}`} aria-expanded={menu === entry.id} disabled={locked} onClick={() => { setMenu(menu === entry.id ? null : entry.id); setInsertion(null); }}><MoreHorizontal size={17}/></button>
            </div>
            {menu === entry.id ? <div className="flex flex-wrap gap-1" role="group" aria-label={`Opciones de ${section.name}`}>
              <button className={control} type="button" disabled={locked || index === 0} aria-label={`Mover sección ${index + 1} a la izquierda`} onClick={() => move(index, -1)}><ArrowLeft size={14}/></button>
              <button className={control} type="button" disabled={locked || index === draft.length - 1} aria-label={`Mover sección ${index + 1} a la derecha`} onClick={() => move(index, 1)}><ArrowRight size={14}/></button>
              <button className={control} type="button" disabled={locked || draft.length >= MAX_ARRANGEMENT_SECTIONS} aria-label={`Duplicar sección ${index + 1}`} onClick={() => insert(index + 1, entry.sectionId)}><Copy size={14}/></button>
            </div> : <><h3 className="truncate text-sm font-semibold text-white">{section.name}</h3><p className="mt-1 text-[10px] tabular-nums text-white/50">{clock(section.startTime)} · {section.endTime - section.startTime}s</p></>}
          </article>
        </div>;
      })}
      <button type="button" className={`${control} self-center rounded-full`} aria-label={`Insertar sección en posición ${draft.length + 1}`} disabled={locked || draft.length >= MAX_ARRANGEMENT_SECTIONS} onClick={() => { setInsertion(draft.length); setMenu(null); }}><Plus size={17}/></button>
    </div>
    {insertion !== null && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-[6px]"
      onPointerDown={event => { if (event.target === event.currentTarget) setInsertion(null); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="ld-add-section-title" data-arrangement-add="true"
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setInsertion(null); } }}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[1.4rem] border border-white/12 bg-[#16191b] shadow-[0_32px_72px_rgba(0,0,0,0.5)]">
        <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <h3 id="ld-add-section-title" className="text-lg font-semibold text-white">Agregar sección</h3>
          <button type="button" className={`${control} min-h-11 px-4 text-sm`} onClick={() => setInsertion(null)}>Cerrar</button>
        </header>
        <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto px-4 pb-4 sm:grid-cols-3" role="group" aria-label="Sección para agregar">
          {props.sections.map((section, index) => <button key={section.id} type="button" autoFocus={index === 0} disabled={locked} data-arrangement-add-section={section.id}
            className="min-h-16 rounded-xl border px-4 py-2 text-left hover:brightness-125 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50"
            style={{ borderColor: section.border, background: section.surface }} onClick={() => insert(insertion, section.id)}>
            <span className="block truncate text-base font-semibold text-white">{section.name}</span>
            <span className="block text-xs tabular-nums text-white/60">{clock(section.startTime)}</span>
          </button>)}
        </div>
      </div>
    </div>}
    {error && <p role="alert" className="shrink-0 px-3 pb-2 text-xs text-rose-100">{error}</p>}
  </section>;
}
