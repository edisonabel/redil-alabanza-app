import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  LayoutDashboard,
  Music4,
  ShieldCheck,
  Users2,
} from 'lucide-react';

const TABS = [
  { id: 'operacion', label: 'Operacion', icon: LayoutDashboard },
  { id: 'repertorio', label: 'Repertorio', icon: Music4 },
  { id: 'equipo', label: 'Equipo', icon: Users2 },
  { id: 'sistema', label: 'Sistema', icon: ShieldCheck },
];

const toneMap = {
  brand: 'from-blue-500/14 to-cyan-500/8 text-blue-700 dark:text-blue-200 border-blue-200/70 dark:border-blue-500/20',
  blue: 'from-sky-500/14 to-blue-500/8 text-sky-700 dark:text-sky-200 border-sky-200/70 dark:border-sky-500/20',
  amber: 'from-amber-500/18 to-orange-500/8 text-amber-700 dark:text-amber-200 border-amber-200/70 dark:border-amber-500/20',
  emerald: 'from-emerald-500/18 to-teal-500/8 text-emerald-700 dark:text-emerald-200 border-emerald-200/70 dark:border-emerald-500/20',
  danger: 'from-rose-500/18 to-red-500/8 text-rose-700 dark:text-rose-200 border-rose-200/70 dark:border-rose-500/20',
  neutral: 'from-zinc-400/8 to-zinc-200/5 text-zinc-700 dark:text-zinc-200 border-zinc-200/70 dark:border-zinc-800',
};

const statusTone = {
  listo: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/25',
  riesgo: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/25',
  incompleto: 'bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/12 dark:text-rose-200 dark:ring-rose-500/25',
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));

const formatDateTime = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const formatShortDate = (value) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
  }).format(date);
};

const getInitials = (name = '') =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || '')
    .join('') || 'RD';

function PanelCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-[28px] border border-zinc-200/80 bg-white/92 p-4 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/92 dark:shadow-[0_26px_90px_-52px_rgba(0,0,0,0.7)] ${className}`}>
      {(title || subtitle || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-950 dark:text-zinc-50">{title}</h2>
            ) : null}
            {subtitle ? (
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

function MetricCard({ metric }) {
  const tone = toneMap[metric?.tone] || toneMap.neutral;
  return (
    <article className={`rounded-[24px] border bg-gradient-to-br p-4 ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{metric?.label || 'Metrica'}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{metric?.value || '--'}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-300/80">{metric?.detail || ''}</p>
    </article>
  );
}

function StatusBadge({ status = 'riesgo' }) {
  const label = status === 'listo' ? 'Listo' : status === 'incompleto' ? 'Incompleto' : 'Con riesgo';
  return <span className={`inline-flex h-8 items-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusTone[status] || statusTone.riesgo}`}>{label}</span>;
}

function AvatarCell({ name, avatarUrl }) {
  return (
    <div className="flex items-center gap-3">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name || 'Avatar'} className="h-10 w-10 rounded-full border border-white/70 object-cover shadow-sm dark:border-zinc-800" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {getInitials(name)}
        </div>
      )}
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{name || 'Sin nombre'}</span>
    </div>
  );
}

function MiniProgress({ percent, tone = 'brand' }) {
  const fillTone =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'danger'
          ? 'bg-rose-500'
          : 'bg-blue-500';

  return (
    <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-900">
      <div className={`h-full rounded-full ${fillTone}`} style={{ width: `${clampPercent(percent)}%` }} />
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-[22px] border border-dashed border-zinc-200 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <p className="font-medium text-zinc-800 dark:text-zinc-200">{title}</p>
      <p className="mt-1 leading-6">{detail}</p>
    </div>
  );
}

function BarList({ items = [], tone = 'brand', valueSuffix = '', emptyTitle = 'Sin datos', emptyDetail = 'No hay suficientes registros para mostrar este bloque.' }) {
  if (!items.length) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  const maxValue = Math.max(...items.map((item) => Number(item?.count || 0)), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const percent = (Number(item?.count || 0) / maxValue) * 100;
        return (
          <div key={`${item.label}-${item.count}`} className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{item.label}</span>
              <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{item.count}{valueSuffix}</span>
            </div>
            <MiniProgress percent={percent} tone={tone} />
          </div>
        );
      })}
    </div>
  );
}

function LinkButton({ href, label, tone = 'neutral' }) {
  const styles =
    tone === 'brand'
      ? 'bg-blue-600 text-white hover:bg-blue-500'
      : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800';

  return (
    <a href={href} className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors ${styles}`}>
      {label}
    </a>
  );
}

function UpcomingServiceItem({ item }) {
  return (
    <article className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.title}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatDateTime(item.dateIso)}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="mt-4 grid gap-3 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Lider</p>
          <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{item.leaderName || 'Sin definir'}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Setlist</p>
          <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{item.setlistCount} canciones</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Roster</p>
          <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{item.rosterCount} asignaciones</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton href={item.programacionHref} label="Abrir programacion" />
        {item.ensayoHref ? <LinkButton href={item.ensayoHref} label="Abrir ensayo" tone="brand" /> : null}
        {!item.ensayoHref ? <LinkButton href={item.repertorioHref} label="Cargar setlist" /> : null}
      </div>
    </article>
  );
}

function AlertList({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin alertas activas" detail="La ventana actual no muestra riesgos operativos relevantes." />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-[20px] border px-4 py-3 ${
            item.level === 'danger'
              ? 'border-rose-200 bg-rose-50/70 dark:border-rose-500/20 dark:bg-rose-500/10'
              : 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-500/10'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${item.level === 'danger' ? 'text-rose-500' : 'text-amber-500'}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {item.serviceTitle ? `${item.serviceTitle} | ${formatShortDate(item.dateIso)} | ` : ''}
                {item.detail}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionSummary({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin resumen operativo" detail="Aun no hay un proximo servicio en la ventana seleccionada." />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{item.label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50">{item.value}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

function WorkloadList({ items = [] }) {
  if (!items.length) {
    return <EmptyState title="Sin carga detectada" detail="No hay asignaciones futuras dentro de la ventana actual." />;
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-[20px] border border-zinc-200/80 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
          <div className="min-w-0">
            <AvatarCell name={item.name} avatarUrl={item.avatarUrl} />
            <p className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400">{(item.roles || []).join(' | ') || 'Sin roles visibles'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">{item.services}</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">servicios</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SimpleList({ items = [], renderItem, emptyTitle, emptyDetail }) {
  if (!items.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return <div className="space-y-3">{items.map(renderItem)}</div>;
}

export default function PanelControl({ data }) {
  const [activeTab, setActiveTab] = useState('operacion');
  const [activePeriod, setActivePeriod] = useState(data?.activePeriod || data?.periods?.[0]?.id || 'proximos_45');
  const activeSnapshot = data?.snapshots?.[activePeriod] || {};
  const activeData = activeSnapshot?.[activeTab] || {};
  const activePeriodMeta = activeSnapshot?.meta || {};

  return (
    <div className="relative z-10">
      <section className="rounded-[32px] border border-zinc-200/80 bg-white/94 px-4 py-5 shadow-[0_24px_90px_-58px_rgba(15,23,42,0.45)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/94 dark:shadow-[0_30px_120px_-60px_rgba(0,0,0,0.78)] sm:px-6 sm:py-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200">
              <Activity className="h-3.5 w-3.5" />
              {data?.header?.title || 'Panel'}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-zinc-950 dark:text-zinc-50 sm:text-4xl">
              {data?.header?.subtitle || 'Estado del ministerio'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {data?.header?.helper || 'Vista operativa del sistema.'}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {(data?.periods || []).map((period) => {
                const isActive = activePeriod === period.id;
                return (
                  <button
                    key={period.id}
                    type="button"
                    onClick={() => setActivePeriod(period.id)}
                    className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50'
                    }`}
                  >
                    {period.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Periodo</p>
              <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{activePeriodMeta?.label || 'Actual'}</p>
            </div>
            <div className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{activePeriodMeta?.serviceLabel || 'Servicios'}</p>
              <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{activePeriodMeta?.serviceValue || '--'}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{activePeriodMeta?.serviceDetail || 'Sin resumen para este periodo.'}</p>
            </div>
            <div className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">Actualizado</p>
              <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatDateTime(data?.generatedAt)}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-zinc-950 text-white shadow-lg shadow-zinc-950/15 dark:bg-white dark:text-zinc-950'
                    : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(activeData?.kpis || []).map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      {activeTab === 'operacion' ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="space-y-6">
            <PanelCard title={activeData?.heroTitle || 'Proximo servicio'} subtitle={activeData?.heroSubtitle || 'Lo mas importante para alinear en el siguiente evento.'} action={activeData?.nextService ? <StatusBadge status={activeData.nextService.status} /> : null}>
              {activeData?.nextService ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">{activeData.nextService.title}</h3>
                      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                        {formatDateTime(activeData.nextService.dateIso)}
                        {activeData.nextService.leaderName ? ` | Lider: ${activeData.nextService.leaderName}` : ''}
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-blue-200/80 bg-blue-50/80 px-4 py-3 text-right dark:border-blue-500/20 dark:bg-blue-500/10">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-200">Readiness</p>
                      <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-blue-700 dark:text-blue-100">{activeData.nextService.readinessScore}%</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {(activeData.nextService.readinessChecks || []).map((check) => (
                      <div key={check.key} className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{check.label}</p>
                          <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${check.ok ? statusTone.listo : statusTone.riesgo}`}>
                            {check.ok ? 'OK' : 'Pendiente'}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">{check.detail}</p>
                      </div>
                    ))}
                  </div>

                  <SectionSummary items={activeData.nextService.summary || []} />
                </div>
              ) : (
                <EmptyState title={activeData?.emptyFocusTitle || 'Sin servicios cercanos'} detail={activeData?.emptyFocusDetail || 'No hay eventos publicados o visibles en la ventana actual.'} />
              )}
            </PanelCard>

            <PanelCard title="Alertas operativas" subtitle="Pendientes que pueden bloquear un ensayo o un servicio.">
              <AlertList items={activeData?.alerts || []} />
            </PanelCard>
          </div>

          <div className="space-y-6">
            <PanelCard title={activeData?.listTitle || 'Servicios proximos'} subtitle={activeData?.listSubtitle || 'Acceso rapido a los eventos que requieren atencion.'}>
              <SimpleList items={activeData?.upcomingServices || []} emptyTitle={activeData?.emptyListTitle || 'Sin servicios en la ventana'} emptyDetail={activeData?.emptyListDetail || 'Cuando haya programacion proxima, aparecera aqui.'} renderItem={(item) => <UpcomingServiceItem key={item.id} item={item} />} />
            </PanelCard>
          </div>
        </div>
      ) : null}

      {activeTab === 'repertorio' ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <PanelCard title="Canciones mas usadas" subtitle="Las piezas que mas sostienen las playlists recientes.">
              <BarList items={activeData?.topSongs || []} tone="brand" emptyTitle="Sin uso suficiente" emptyDetail="Todavia no hay suficientes playlists para establecer un ranking." />
            </PanelCard>

            <PanelCard title="Distribucion del repertorio" subtitle="Balance real del catalogo para tomar decisiones de refresh.">
              <div className="grid gap-6 lg:grid-cols-3">
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Categoria</p>
                  <BarList items={activeData?.categoryDistribution || []} tone="amber" emptyTitle="Sin categorias" emptyDetail="No hay categorias suficientes para mostrar." />
                </div>
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Voz</p>
                  <BarList items={activeData?.voiceDistribution || []} tone="blue" emptyTitle="Sin perfiles vocales" emptyDetail="No hay datos vocales para mostrar." />
                </div>
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Tema</p>
                  <BarList items={activeData?.themeDistribution || []} tone="emerald" emptyTitle="Sin temas" emptyDetail="No hay temas suficientes para mostrar." />
                </div>
              </div>
            </PanelCard>
          </div>

          <div className="space-y-6">
            <PanelCard title="Cobertura de recursos" subtitle="Que tan listo esta el repertorio para ensayo y montaje.">
              <div className="space-y-4">
                {(activeData?.resourceCoverage || []).map((item) => (
                  <div key={item.label} className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{item.label}</span>
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{item.count}/{item.total}</span>
                    </div>
                    <MiniProgress percent={item.percent} tone={item.percent >= 80 ? 'emerald' : item.percent >= 50 ? 'amber' : 'danger'} />
                  </div>
                ))}
              </div>
            </PanelCard>
          </div>
        </div>
      ) : null}

      {activeTab === 'equipo' ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <PanelCard title="Carga por miembro" subtitle="Quien esta sosteniendo mas servicios en la ventana actual.">
              <WorkloadList items={activeData?.workload || []} />
            </PanelCard>

            <PanelCard title="Conflictos por ausencias" subtitle="Cruces reales entre disponibilidad y servicios proximos.">
              <SimpleList
                items={activeData?.conflicts || []}
                emptyTitle="Sin conflictos detectados"
                emptyDetail="No hay ausencias que choquen con eventos visibles."
                renderItem={(item) => (
                  <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.name}</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.serviceTitle} | {formatShortDate(item.dateIso)} | {item.detail}</p>
                  </div>
                )}
              />
            </PanelCard>
          </div>

          <div className="space-y-6">
            <PanelCard title="Cobertura por rol" subtitle="Cuantas personas hay disponibles para cada rol.">
              <BarList items={(activeData?.roleCoverage || []).map((item) => ({ label: item.label, count: item.count }))} tone="blue" emptyTitle="Sin roles cargados" emptyDetail="No hay roles suficientes para medir cobertura." />
            </PanelCard>

            <PanelCard title="Roles con baja cobertura" subtitle="Puntos fragiles del equipo para reforzar.">
              <SimpleList
                items={activeData?.lowCoverageRoles || []}
                emptyTitle="Cobertura sana"
                emptyDetail="No hay roles con cobertura baja en este momento."
                renderItem={(item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.label}</p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Codigo: {item.code || 'sin codigo'}</p>
                    </div>
                    <span className="text-2xl font-semibold tracking-[-0.04em] text-zinc-900 dark:text-zinc-50">{item.count}</span>
                  </div>
                )}
              />
            </PanelCard>

            <PanelCard title="Personas sin asignacion proxima" subtitle="Buen lugar para repartir mejor la carga.">
              <SimpleList
                items={activeData?.idleProfiles || []}
                emptyTitle="Todos estan sirviendo"
                emptyDetail="No hay perfiles ociosos en la ventana actual."
                renderItem={(item) => (
                  <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
                    <AvatarCell name={item.name} avatarUrl={item.avatarUrl} />
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{(item.roles || []).join(' | ') || 'Sin roles'}</p>
                  </div>
                )}
              />
            </PanelCard>
          </div>
        </div>
      ) : null}

      {activeTab === 'sistema' ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <PanelCard title="Eventos con huecos" subtitle="Servicios que aun no llegan a un estado sano.">
              <SimpleList
                items={activeData?.eventGaps || []}
                emptyTitle="Eventos sanos"
                emptyDetail="No hay huecos importantes en la ventana actual."
                renderItem={(item) => (
                  <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{formatDateTime(item.dateIso)}</p>
                      </div>
                      <CalendarClock className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{item.detail}</p>
                  </div>
                )}
              />
            </PanelCard>

            <PanelCard title="Perfiles incompletos" subtitle="Personas a las que todavia les falta informacion basica.">
              <SimpleList
                items={activeData?.profileGaps || []}
                emptyTitle="Perfiles completos"
                emptyDetail="Todos los perfiles visibles ya tienen lo basico."
                renderItem={(item) => (
                  <div key={item.id} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/65">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.name}</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Falta: {item.missing.join(' | ')}</p>
                  </div>
                )}
              />
            </PanelCard>
          </div>

          <div className="space-y-6">
            <PanelCard title="Huecos del catalogo" subtitle="Canciones que siguen incompletas dentro del sistema.">
              <SimpleList
                items={activeData?.songGaps || []}
                emptyTitle="Catalogo sano"
                emptyDetail="No hay huecos relevantes detectados en canciones."
                renderItem={(item) => (
                  <div key={item.title} className="rounded-[20px] border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/65">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</p>
                      <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white dark:bg-white dark:text-zinc-950">{item.count}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.items || []).map((name) => (
                        <span key={`${item.title}-${name}`} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{name}</span>
                      ))}
                    </div>
                  </div>
                )}
              />
            </PanelCard>

            <PanelCard title="Warnings tecnicos" subtitle="Problemas de consulta o fallbacks que conviene vigilar.">
              <SimpleList
                items={activeData?.warnings || []}
                emptyTitle="Sin warnings"
                emptyDetail="Las consultas principales respondieron sin alertas."
                renderItem={(item, index) => (
                  <div key={`${item}-${index}`} className="rounded-[20px] border border-amber-200 bg-amber-50/80 p-4 text-sm leading-6 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                    {item}
                  </div>
                )}
              />
            </PanelCard>
          </div>
        </div>
      ) : null}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-zinc-200/80 bg-white/92 px-4 py-4 text-xs text-zinc-500 shadow-[0_16px_45px_-40px_rgba(15,23,42,0.45)] dark:border-zinc-800 dark:bg-zinc-950/92 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4" />
          Vista pensada para decisiones operativas, no para vanity metrics.
        </div>
        <a href="/programacion" className="inline-flex items-center gap-2 font-semibold text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-300 dark:hover:text-blue-200">
          Abrir programacion
          <ChevronRight className="h-4 w-4" />
        </a>
      </footer>
    </div>
  );
}
