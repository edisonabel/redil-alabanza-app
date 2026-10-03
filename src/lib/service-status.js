import { isSinFiltrosEvent } from './ministry-config.js';

export const isServiceCanceled = (event) => Boolean(String(event?.sin_servicio_motivo || '').trim());
export const getSinFiltrosNotice = (event) => (
  isSinFiltrosEvent(event) && isServiceCanceled(event)
    ? { title: 'Este sábado no hay Sin Filtros', reason: String(event.sin_servicio_motivo).trim() }
    : null
);
