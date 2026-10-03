import { CalendarOff, Pencil } from 'lucide-react';
import { getSinFiltrosNotice } from '../../lib/service-status.js';
import { EVENT_CARD_CLASS_NAME } from '../../lib/event-card-layout.js';

const eventDateFormatter = new Intl.DateTimeFormat('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota',
});

export default function SinFiltrosNotice({ event, dateLabel, onManage, variant = 'card' }) {
    const notice = getSinFiltrosNotice(event);
    if (!notice) return null;
    const date = new Date(event.fecha_hora);
    const dateParts = Number.isNaN(date.getTime()) ? null
        : Object.fromEntries(eventDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
    const manageButton = onManage && (
        <button type="button" onClick={onManage} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-bold text-content transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar este día
        </button>
    );

    if (variant === 'list') {
        return <article className="relative flex w-full min-w-0 flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-4 text-content md:flex-row md:items-center md:gap-8 md:rounded-[24px] md:px-8 md:py-6 programacion-sin-filtros-surface">
            <div className="min-w-0">
                {dateLabel && <p className="mb-2 text-xs font-semibold text-content-muted">{dateLabel}</p>}
                <h3 className="text-lg font-extrabold leading-snug">{notice.title}</h3>
                <p className="mt-2 break-words text-sm leading-relaxed text-content-muted"><span className="font-semibold">Motivo:</span> {notice.reason}</p>
            </div>
            {onManage && <div className="shrink-0 md:w-44">{manageButton}</div>}
        </article>;
    }

    return <article className={`${EVENT_CARD_CLASS_NAME} programacion-sin-filtros-surface text-content`} aria-label={dateLabel ? `Sin Filtros · ${dateLabel}` : 'Sin Filtros sin servicio'}>
        <header>
            <p className="mb-1 text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-content-muted/80">Sin Filtros</p>
            {dateParts ? <div className="mb-2 flex items-baseline gap-1">
                <span className="text-[2.75rem] font-normal leading-none tracking-tighter">{dateParts.day}</span>
                <span className="ml-0.5 text-3xl font-light leading-none tracking-tight">{dateParts.month}</span>
                <span className="ml-1 text-xs font-bold text-content-muted">{dateParts.year}</span>
            </div> : <p className="mb-2 text-sm font-semibold text-content-muted">{dateLabel}</p>}
            <span className="inline-flex rounded-md border border-info/30 bg-info/10 px-2.5 py-0.5 text-[10px] font-bold uppercase leading-relaxed tracking-widest text-info">Sábado</span>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-info/20 bg-info/5 text-info" aria-hidden="true"><CalendarOff className="h-6 w-6" /></span>
            <h3 className="max-w-[15rem] text-[1.4rem] font-extrabold leading-tight tracking-tight">{notice.title}</h3>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-content-muted">Motivo</p>
            <p className="mt-1.5 max-w-full break-words text-sm leading-relaxed text-content-muted">{notice.reason}</p>
        </div>
        {onManage && <footer className="mt-auto border-t border-border pt-4">{manageButton}</footer>}
    </article>;
}
