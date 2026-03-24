import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const PUSH_SW_PATH = '/push-sw.js';
const PUSH_SW_SCOPE = '/push-notifications/';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function getPushRegistration() {
  return navigator.serviceWorker.register(PUSH_SW_PATH, { scope: PUSH_SW_SCOPE });
}

async function waitForServiceWorkerActivation(registration) {
  if (registration?.active) return registration;

  const worker = registration?.installing || registration?.waiting;
  if (!worker) return registration;

  await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Push: el service worker no llegó a activarse a tiempo.'));
    }, 10000);

    const handleStateChange = () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timeoutId);
        worker.removeEventListener('statechange', handleStateChange);
        resolve();
      }
    };

    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });

  return registration;
}

export default function BotonNotificaciones({
  userId,
  className = '',
  compact = false,
}) {
  console.log('DEBUG PUSH: userId recibido =', userId);
  const [isReady, setIsReady] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [permissionState, setPermissionState] = useState('default');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorState, setErrorState] = useState('');
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);

  const buttonLabel = useMemo(() => {
    if (!userId) return 'Inicia sesión para activar';
    if (isLoading) return 'Activando...';
    if (isSubscribed) return 'Notificaciones Activadas';
    return 'Activar Notificaciones';
  }, [isLoading, isSubscribed, userId]);

  useEffect(() => {
    let active = true;

    const syncState = async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (active) {
          setIsSupported(false);
          setIsReady(true);
        }
        return;
      }

      try {
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIOS =
          /iphone|ipad|ipod/.test(userAgent) ||
          (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
        const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

        const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
        const subscription = registration ? await registration.pushManager.getSubscription() : null;

        if (!active) return;

        setIsIOSDevice(Boolean(isIOS));
        setIsStandaloneApp(Boolean(standalone));
        setPermissionState(Notification.permission);
        setIsSubscribed(Boolean(subscription));
      } catch (error) {
        console.error('Push: no se pudo leer el estado actual de suscripción', error);
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    };

    syncState();

    return () => {
      active = false;
    };
  }, []);

  const handleSubscribe = async () => {
    if (!isSupported || isLoading) return;

    if (Notification.permission === 'denied') {
      if (isIOSDevice) {
        setErrorState('bloqueado_ios');
      } else {
        setStatusMessage('El navegador bloqueó las notificaciones. Revisa los permisos del sitio.');
      }
      return;
    }

    const publicVapidKey = import.meta.env.PUBLIC_VAPID_KEY;
    if (!publicVapidKey) {
      console.error('Push: falta PUBLIC_VAPID_KEY en el entorno del frontend');
      setStatusMessage('Falta configurar la llave pública de notificaciones.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('');
    setErrorState('');

    try {
      const currentPermission = Notification.permission;
      const permission =
        currentPermission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
      setPermissionState(permission);

      if (permission !== 'granted') {
        if (permission === 'denied' && isIOSDevice) {
          setErrorState('bloqueado_ios');
        }
        setStatusMessage(
          permission === 'denied'
            ? 'El navegador bloqueó las notificaciones.'
            : 'Permiso no concedido.'
        );
        return;
      }

      const registration = await getPushRegistration();
      const targetRegistration = await waitForServiceWorkerActivation(registration);

      let subscription = await targetRegistration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await targetRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
        });
      }

      if (!userId) {
        console.error('Error crítico: userId no fue proporcionado al componente.');
        setStatusMessage('Error de sesión');
        return;
      }

      const subscriptionJson = JSON.parse(JSON.stringify(subscription));
      const subscriptionEndpoint = subscriptionJson?.endpoint || '';

      if (!subscriptionEndpoint) {
        console.error('Push: la suscripción no incluye endpoint válido', subscriptionJson);
        setStatusMessage('No se pudo preparar la suscripción del dispositivo.');
        return;
      }

      let saveError = null;

      const { error: upsertError } = await supabase
        .from('suscripciones_push')
        .upsert(
          [
            {
              user_id: userId,
              endpoint: subscriptionEndpoint,
              suscripcion: subscriptionJson,
            },
          ],
          {
            onConflict: 'endpoint',
          }
        );

      if (!upsertError) {
        saveError = null;
      } else {
        const missingModernColumns = ['endpoint', 'updated_at'].some((columnName) => (
          String(upsertError?.message || '').toLowerCase().includes(columnName)
        ));

        if (!missingModernColumns) {
          saveError = upsertError;
        } else {
          const { data: existingRows, error: existingError } = await supabase
            .from('suscripciones_push')
            .select('id, suscripcion')
            .eq('user_id', userId);

          if (existingError) {
            console.error('Push: no se pudo verificar suscripciones existentes', existingError);
            setStatusMessage('No se pudo validar tu suscripción actual. Revisa tu conexión.');
            return;
          }

          const existingMatch = (existingRows || []).find((row) => {
            const savedEndpoint = row?.suscripcion?.endpoint;
            return typeof savedEndpoint === 'string' && savedEndpoint === subscriptionEndpoint;
          });

          if (existingMatch?.id) {
            const { error } = await supabase
              .from('suscripciones_push')
              .update({
                suscripcion: subscriptionJson,
              })
              .eq('id', existingMatch.id);
            saveError = error;
          } else {
            const { error } = await supabase
              .from('suscripciones_push')
              .insert([
                {
                  user_id: userId,
                  suscripcion: subscriptionJson,
                },
              ]);
            saveError = error;
          }
        }
      }

      if (saveError) {
        console.error('Push: no se pudo guardar la suscripción en Supabase', saveError);
        const saveMessage = String(saveError?.message || '').toLowerCase();
        if (saveMessage.includes('permission') || saveMessage.includes('row-level') || saveMessage.includes('rls')) {
          setStatusMessage('La suscripción fue creada, pero tu sesión no tiene permiso para guardarla.');
        } else if (saveMessage.includes('network') || saveMessage.includes('fetch') || saveMessage.includes('failed')) {
          setStatusMessage('No se pudo guardar por un problema de red. Intenta nuevamente.');
        } else {
          setStatusMessage('La suscripción no se pudo guardar.');
        }
        return;
      }

      setIsSubscribed(true);
      setStatusMessage('Las notificaciones quedaron activadas en este dispositivo.');
    } catch (error) {
      console.error('Push: error activando notificaciones', error);
      const errorMessage = String(error?.message || '').toLowerCase();
      if (errorMessage.includes('permission') || permissionState === 'denied') {
        setStatusMessage('El navegador bloqueó las notificaciones. Revisa los permisos del sitio.');
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('failed')) {
        setStatusMessage('Hubo un problema de red activando las notificaciones.');
      } else {
        setStatusMessage('Ocurrió un error activando las notificaciones.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isReady) {
    return (
      <div
        className={`inline-flex items-center rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-content-muted ${className}`}
      >
        Preparando notificaciones...
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div
        className={`inline-flex items-center rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-content-muted ${className}`}
      >
        Este navegador no soporta notificaciones push.
      </div>
    );
  }

  const showIOSInstallHint = isIOSDevice && !isStandaloneApp;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {showIOSInstallHint ? (
        <div className="rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="text-sm font-semibold text-content">Instala la app para activar notificaciones</p>
          <p className="mt-1 text-xs text-content-muted">
            En iPhone, las notificaciones solo funcionan cuando abres Redil como app instalada desde la pantalla de inicio.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={isLoading || permissionState === 'denied' || !userId}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 ${
            compact ? 'h-11 text-sm' : 'h-12 text-sm'
          } font-bold transition-all ${
            isSubscribed
              ? 'border-brand/40 bg-brand/10 text-brand dark:border-brand/60 dark:bg-brand/20 dark:text-white'
              : 'border-action/50 bg-action text-white hover:bg-action/90 shadow-[0_14px_30px_rgba(0,0,0,0.14)]'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
          >
            <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
            <path d="M9 17a3 3 0 0 0 6 0" />
          </svg>
          <span>{buttonLabel}</span>
        </button>
      )}

      {statusMessage && (
        <p className="text-xs text-content-muted" role="status" aria-live="polite">
          {statusMessage}
        </p>
      )}

      {errorState === 'bloqueado_ios' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-content">🛡️ Notificaciones Bloqueadas</h3>
            <p className="mt-2 text-sm text-content-muted">
              Parece que las notificaciones están desactivadas en los ajustes de tu iPhone. Para recibirlas, sigue estos pasos:
            </p>
            <ol className="mt-4 space-y-2 text-sm text-content">
              <li>1. Sal al menú de tu iPhone y ve a Ajustes.</li>
              <li>2. Busca la sección de Notificaciones.</li>
              <li>3. Busca la App Redil Worship en la lista.</li>
              <li>4. Activa el interruptor de Permitir notificaciones.</li>
            </ol>
            <button
              type="button"
              onClick={() => setErrorState('')}
              className="mt-5 w-full rounded-xl bg-action px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-action/90"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
