import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LiveDirectorSectionVisual } from '../../../utils/liveDirectorSongSession';
import { MAX_ARRANGEMENT_SECTIONS, originalArrangement, resolveArrangement, type ArrangementEntry } from '../../../utils/liveDirectorArrangement';
type Props = { open: boolean; playing: boolean; busy: boolean; sections: LiveDirectorSectionVisual[]; entries: ArrangementEntry[] | null; onClose: () => void; onApply: (entries: ArrangementEntry[] | null) => Promise<void> };
const clock = (time: number) => {
  const [seconds, fraction] = (time % 60).toFixed(3).split('.');
  const tail = fraction.replace(/0+$/, '');
  return `${Math.floor(time / 60)}:${seconds.padStart(2, '0')}${tail ? ',' + tail : ''}`;
};
const control = 'inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/15 bg-white/[.04] px-2 text-white/75 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-30 disabled:hover:bg-transparent';
export function LiveDirectorArrangementEditor(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ArrangementEntry[]>(() => props.entries?.map(entry => ({ ...entry })) ?? originalArrangement(props.sections));
  const [selected, setSelected] = useState(props.sections[0]?.id ?? '');
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (props.open && !dialog.current?.open) {
      dialog.current?.showModal();
    } else if (!props.open && dialog.current?.open) dialog.current.close();
  }, [props.open]);
  const close = () => { props.onClose(); dialog.current?.close(); };
  const locked = props.playing || props.busy || applying;
  const sources = new Map(props.sections.map(section => [section.id, section]));
  const duration = draft.reduce((total, entry) => { const section = sources.get(entry.sectionId); return total + (section ? section.endTime - section.startTime : 0); }, 0);
  const duplicate = (index: number, sectionId: string) => {
    if (locked || draft.length >= MAX_ARRANGEMENT_SECTIONS) return;
    const entry = { id: crypto.randomUUID(), sectionId };
    setDraft(previous => [...previous.slice(0, index), entry, ...previous.slice(index)]);
    setAnnouncement(`${sources.get(sectionId)?.name ?? 'Sección'} agregada en posición ${index + 1}.`);
  };
  const move = (index: number, direction: number) => {
    setDraft(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
    setAnnouncement(`Sección movida a la posición ${index + direction + 1}.`);
  };
  const apply = async (restore = false) => {
    if (locked) return;
    setApplying(true); setError('');
    try {
      if (!restore) resolveArrangement(props.sections, draft);
      await props.onApply(restore ? null : draft);
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo aplicar el arreglo.'); }
    finally { setApplying(false); }
  };
  return <dialog ref={dialog} onClose={props.onClose} onCancel={event => { if (applying) event.preventDefault(); }} aria-labelledby="ld-arrangement-title" aria-describedby="ld-arrangement-description"
    className="m-auto flex-col w-[min(700px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-white/15 bg-[#202426] p-4 text-white shadow-2xl backdrop:bg-black/70">
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#202426] pb-3">
      <div><h2 id="ld-arrangement-title" className="text-lg font-semibold">Editar canción</h2><p className="mt-1 text-xs text-white/55">{draft.length} secciones · {clock(duration)} de arreglo</p></div>
      <button type="button" className={control} disabled={applying} onClick={close} aria-label="Cerrar editor de canción"><X size={18}/></button>
    </header>
    <p id="ld-arrangement-description" className="text-sm text-white/65">Agrega partes de esta canción y cambia su orden. Los stems originales se conservan.</p>
    {props.playing ? <p className="mt-2 text-xs text-amber-100">Pausa la canción para editar.</p> : null}
    <div className="mt-4 flex gap-2">
      <label className="min-w-0 flex-1"><span className="sr-only">Sección para agregar</span><select aria-label="Sección para agregar" disabled={locked} value={selected} onChange={event => setSelected(event.target.value)} className={`${control} w-full justify-start bg-[#191d1f] text-sm`}>
        {props.sections.map(section => <option key={section.id} value={section.id}>{section.name} · {clock(section.startTime)}</option>)}
      </select></label>
      <button type="button" className={`${control} gap-1.5 text-sm`} disabled={locked || !selected || draft.length >= MAX_ARRANGEMENT_SECTIONS} onClick={() => duplicate(draft.length, selected)}><Plus size={16}/>Agregar</button>
    </div>
    <ol aria-label="Secciones del arreglo" className="mt-3 divide-y divide-white/10">
      {draft.map((entry, index) => { const section = sources.get(entry.sectionId); return <li key={entry.id} data-arrangement-entry={entry.id} className="flex min-h-14 items-center gap-2 py-2">
        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-white/35">{index + 1}</span>
        <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: section?.accent }}/>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{section?.name ?? 'Sección no disponible'}</p><p className="text-[11px] tabular-nums text-white/40">{clock(section?.startTime ?? 0)}–{clock(section?.endTime ?? 0)} · original</p></div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className={control} aria-label={`Subir sección ${index + 1}`} disabled={locked || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14}/></button>
          <button type="button" className={control} aria-label={`Bajar sección ${index + 1}`} disabled={locked || index === draft.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14}/></button>
          <button type="button" className={control} aria-label={`Duplicar sección ${index + 1}`} disabled={locked || draft.length >= MAX_ARRANGEMENT_SECTIONS} onClick={() => duplicate(index + 1, entry.sectionId)}><Copy size={14}/></button>
          <button type="button" className={`${control} hover:text-rose-200`} aria-label={`Quitar sección ${index + 1}`} disabled={locked || draft.length <= 1} onClick={() => { setDraft(previous => previous.filter(item => item.id !== entry.id)); setAnnouncement('Sección quitada del arreglo.'); }}><Trash2 size={14}/></button>
        </div>
      </li>; })}
    </ol>
    <div className="min-h-6 pt-2 text-xs text-amber-100" role="status">{error || announcement}</div>
    <footer className="sticky bottom-0 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#202426] pt-3">
      <button type="button" className={`${control} text-xs`} disabled={locked} onClick={() => props.entries ? void apply(true) : setDraft(originalArrangement(props.sections))}>Restaurar original</button>
      <div className="flex gap-2"><button type="button" className={`${control} text-xs`} disabled={applying} onClick={close}>Cancelar</button><button type="button" className={`${control} border-cyan-200/40 bg-cyan-200/10 px-4 text-sm text-cyan-100`} disabled={locked || !draft.length} onClick={() => { void apply(); }}>{applying ? 'Aplicando…' : 'Aplicar arreglo'}</button></div>
    </footer>
    <p className="mt-3 text-[11px] text-white/40">Solo esta prueba. Aplicar vuelve al principio del arreglo; los cambios se descartan al recargar.</p>
  </dialog>;
}
