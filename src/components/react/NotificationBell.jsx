import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

const formatRelative = (value, _tick = 0) => {
  if (!value) return 'Ahora';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ahora';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);

  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 604800) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  return rtf.format(Math.round(diffSeconds / 604800), 'week');
};

export default function NotificationBell({ inline = false, direction = 'down' }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [tick, setTick] = useState(0);
  const rootRef = useRef(null);

  const unreadCount = useMemo(
    () => notifications.reduce((total, item) => total + (item?.leida ? 0 : 1), 0),
    [notifications],
  );

  const fetchNotifications = async (userId) => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('notificaciones')
      .select('id, perfil_id, titulo, contenido, leida, fecha_creacion')
      .eq('perfil_id', userId)
      .order('fecha_creacion', { ascending: false })
      .limit(25);

    if (error) {
      console.error('Error al consultar notificaciones:', error);
      return;
    }

    setNotifications(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    let active = true;
    let channel = null;

    const boot = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) return;
      if (!session?.user?.id) {
        setCurrentUserId('');
        setNotifications([]);
        setLoading(false);
        return;
      }

      const uid = session.user.id;
      setCurrentUserId(uid);
      await fetchNotifications(uid);
      if (!active) return;
      setLoading(false);

      channel = supabase
        .channel(`notificaciones-ui-${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notificaciones',
            filter: `perfil_id=eq.${uid}`,
          },
          () => {
            fetchNotifications(uid);
          },
        )
        .subscribe();
    };

    boot();

    return () => {
      active = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const onEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [open]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setTick((v) => v + 1), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  const markAsRead = async (id) => {
    if (!id || !currentUserId) return;
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, leida: true } : item)),
    );

    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id)
      .eq('perfil_id', currentUserId);

    if (error) {
      console.error('Error al marcar notificación como leída:', error);
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, leida: false } : item)),
      );
    }
  };

  if (!currentUserId && !loading) return null;

  const rootClass = inline
    ? 'relative inline-flex'
    : 'relative ml-auto inline-flex';
  const rootStyle = undefined;
  const buttonClass = inline
    ? 'relative w-12 h-12 bg-background border border-border text-content rounded-full flex items-center justify-center group-active:scale-90 transition-transform'
    : 'relative h-11 w-11 rounded-2xl border border-border bg-surface/95 text-content shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-[1.02] hover:border-brand/40';
  const dropdownBaseClass =
    'absolute w-80 z-50 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl backdrop-blur-xl';
  const dropdownPositionClass =
    direction === 'up'
      ? 'bottom-full mb-4 left-1/2 -translate-x-1/2 origin-bottom'
      : 'right-0 top-full mt-2 origin-top-right';
  const dropdownClass = `${dropdownBaseClass} ${dropdownPositionClass}`;

  return (
    <div
      ref={rootRef}
      className={rootClass}
      style={rootStyle}
    >
      <button
        type="button"
        aria-label="Abrir notificaciones"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={buttonClass}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto h-5 w-5"
          aria-hidden="true"
        >
          <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path d="M9 17a3 3 0 0 0 6 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] h-[18px] rounded-full bg-red-500 px-1 text-[10px] leading-[18px] font-bold text-white shadow-md">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={dropdownClass}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-content">Notificaciones</p>
            <span className="text-xs text-content-muted">{unreadCount} nuevas</span>
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-sm text-content-muted">Cargando...</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-content">Sin notificaciones</p>
                <p className="mt-1 text-xs text-content-muted">Cuando haya novedades aparecerán aquí.</p>
              </div>
            ) : (
              notifications.map((item) => {
                const unread = !item?.leida;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (unread) markAsRead(item.id);
                    }}
                    className={`w-full border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 ${
                      unread ? 'bg-brand/10 hover:bg-brand/15' : 'hover:bg-background/70'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {unread ? (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" />
                      ) : (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-border" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-content">
                          {item?.titulo || 'Notificación'}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-content-muted">
                          {item?.contenido || 'Sin contenido'}
                        </p>
                        <p className="mt-2 text-[11px] uppercase tracking-wide text-content-muted">
                          {formatRelative(item?.fecha_creacion, tick)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
