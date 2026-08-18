import { ArrowRight, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

const MAX_SLOTS = 6;
const DEFAULT_SLOTS = 4;

const previewSingers = [
  { id: 'oscar', name: 'Óscar Delgado', avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Oscar' },
  { id: 'sarah', name: 'Sarah Méndez', avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Sarah' },
  { id: 'nathalie', name: 'Nathalie Pérez', avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Nathalie' },
  { id: 'daniel', name: 'Daniel Rojas', avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Daniel' },
  { id: 'camila', name: 'Camila Torres', avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Camila' },
  { id: 'luis', name: 'Luis Herrera', avatarUrl: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Luis' },
];

const getFirstName = (name = '') => String(name).trim().split(/\s+/)[0] || 'Integrante';

function SingerAvatar({ member, size = 'lg' }) {
  const sizeClass = size === 'sm' ? 'h-8 w-8' : 'h-12 w-12';
  return (
    <img
      src={member.avatarUrl}
      alt=""
      crossOrigin="anonymous"
      className={`${sizeClass} shrink-0 rounded-full border border-slate-200 object-cover dark:border-white/10`}
    />
  );
}

export default function EventVoiceSlotsPreview() {
  const [slotCount, setSlotCount] = useState(DEFAULT_SLOTS);
  const [assignedCount, setAssignedCount] = useState(DEFAULT_SLOTS);
  const assignedSingers = useMemo(() => previewSingers.slice(0, assignedCount), [assignedCount]);

  const addSlot = () => setSlotCount((current) => Math.min(MAX_SLOTS, current + 1));
  const assignSinger = (slotIndex) => {
    if (slotIndex >= assignedCount) {
      setAssignedCount(Math.min(slotCount, slotIndex + 1));
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 dark:bg-[#0b0d12] dark:text-white sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-500/12 text-cyan-700 dark:bg-cyan-400/12 dark:text-cyan-300">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">Gestionar evento</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Equipo · Voces</h1>
          </div>
        </div>

        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#12161f] dark:shadow-[0_18px_55px_rgba(0,0,0,0.3)] sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-700 dark:text-fuchsia-300">Voces</p>
              <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-zinc-400">Cuatro cupos normales; amplía solo cuando haga falta.</p>
            </div>

            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black tabular-nums text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
              {slotCount}/{MAX_SLOTS}
            </span>

            {slotCount < MAX_SLOTS && (
              <button
                type="button"
                onClick={addSlot}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-4 text-xs font-black text-fuchsia-700 transition-colors hover:bg-fuchsia-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/45 dark:text-fuchsia-300"
              >
                <Plus className="h-4 w-4" />
                Añadir voz
              </button>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {Array.from({ length: slotCount }, (_, slotIndex) => {
              const singer = previewSingers[slotIndex];
              const isAssigned = slotIndex < assignedCount;

              if (!isAssigned) {
                return (
                  <button
                    key={`empty-${slotIndex}`}
                    type="button"
                    onClick={() => assignSinger(slotIndex)}
                    className="inline-flex min-h-[4.5rem] min-w-[5.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-fuchsia-500/35 bg-fuchsia-500/5 px-3 text-fuchsia-700 transition-colors hover:bg-fuchsia-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/45 dark:text-fuchsia-300"
                    aria-label={`Asignar a ${singer.name} en el cupo de voz ${slotIndex + 1}`}
                  >
                    <Plus className="h-5 w-5" />
                    <span className="text-[10px] font-black uppercase tracking-[0.12em]">Voz {slotIndex + 1}</span>
                  </button>
                );
              }

              return (
                <div key={singer.id} className="flex min-w-[5.5rem] flex-col items-center gap-1.5 rounded-2xl px-2 py-1.5">
                  <SingerAvatar member={singer} />
                  <span className="max-w-20 truncate text-xs font-black">{getFirstName(singer.name)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-[1.5rem] border border-cyan-500/20 bg-white p-4 dark:border-cyan-400/15 dark:bg-[#12161f] sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Llegan a Vista vocal</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex -space-x-2">
                  {assignedSingers.map((member) => (
                    <SingerAvatar key={member.id} member={member} size="sm" />
                  ))}
                </div>
                <span className="truncate text-sm font-bold text-slate-700 dark:text-zinc-200">
                  {assignedSingers.map((member) => getFirstName(member.name)).join(' · ')}
                </span>
              </div>
            </div>

            <a
              href={`/dev/vocal-assignments?eventVoices=${assignedCount}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-black text-slate-950 transition-colors hover:bg-cyan-400"
            >
              Abrir Vista vocal
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
