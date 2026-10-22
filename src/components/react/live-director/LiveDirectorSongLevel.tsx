import { useRef } from 'react';
type Props = { db: number; onChange: (db: number) => void; title: string; disabled: boolean; compact: boolean };
export function LiveDirectorSongLevel({ db, onChange, title, disabled, compact }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = `${db.toFixed(1)} dB`;
  return <>
    <button type="button" data-live-director-control="song-level" aria-label="Ajustar nivel de esta canción" aria-haspopup="dialog" title={`Nivel de esta canción: ${label}`}
      disabled={disabled} onClick={() => dialog.current?.showModal()}
      className={`mt-1 min-h-7 w-full rounded-lg border px-1 text-[9px] font-semibold tracking-wide focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-30 ${db < 0 ? 'border-cyan-200/30 text-cyan-100' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
      {compact ? db < 0 ? label : 'NIVEL' : db < 0 ? `Nivel ${label}` : 'Nivel canción'}
    </button>
    <dialog ref={dialog} className="ld-tools" style={{ maxWidth: 440 }} aria-labelledby="ld-song-level-title">
      <header className="ld-tools-header"><h2 id="ld-song-level-title">Nivel de esta canción</h2><button type="button" aria-label="Cerrar nivel de canción" onClick={() => dialog.current?.close()}>Cerrar</button></header>
      <div className="ld-tools-body">
        <p className="truncate" title={title}>{title}</p>
        <label className="grid gap-3 text-sm">Ajuste <output className="text-xl tabular-nums text-cyan-100">{label}</output>
          <input type="range" aria-label="Atenuación de canción en decibelios" min={-24} max={0} step={0.1} value={db} disabled={disabled}
            aria-valuetext={label} onChange={event => onChange(Number(event.target.value))} className="h-10 w-full accent-cyan-200" />
        </label>
        <p className="ld-tools-note">Baja las canciones más fuertes para igualarlas a la más suave. Conserva la mezcla, click y guía.</p>
        <p className="ld-tools-note">Se conserva por canción en esta pestaña, durante la sesión de prueba.</p>
        <button type="button" disabled={disabled || db === 0} onClick={() => onChange(0)}>Restaurar 0 dB</button>
      </div>
    </dialog>
  </>;
}
