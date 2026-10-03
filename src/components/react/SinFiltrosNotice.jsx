import { getSinFiltrosNotice } from '../../lib/service-status.js';

export default function SinFiltrosNotice({ event, dateLabel, onManage }) {
    const notice = getSinFiltrosNotice(event);
    if (!notice) return null;
    return (
        <div className="rounded-2xl border border-blue-400/25 bg-blue-500/10 p-5 text-content">
            {dateLabel && <p className="mb-3 text-xs font-semibold text-content-muted">{dateLabel}</p>}
            <p className="text-lg font-bold leading-snug">{notice.title}</p>
            <p className="mt-2 break-words text-sm leading-relaxed text-content-muted"><span className="font-semibold">Motivo:</span> {notice.reason}</p>
            {onManage && <button type="button" onClick={onManage} className="mt-4 min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-background focus-visible:outline-2 focus-visible:outline-brand">Editar este día</button>}
        </div>
    );
}
