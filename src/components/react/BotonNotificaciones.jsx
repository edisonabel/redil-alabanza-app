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
        const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
        const subscription = registration ? await registration.pushManager.getSubscription() : null;

        if (!active) return;

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

    const publicVapidKey = import.meta.env.PUBLIC_VAPID_KEY;
    if (!publicVapidKey) {
      console.error('Push: falta PUBLIC_VAPID_KEY en el entorno del frontend');
      setStatusMessage('Falta configurar la llave pública de notificaciones.');
      return;
    }

    setIsLoading(true);
    setStatusMessage('');

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);

      if (permission !== 'granted') {
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

      const { error: saveError } = await supabase
        .from('suscripciones_push')
        .insert([
          {
            user_id: userId,
            suscripcion: JSON.parse(JSON.stringify(subscription)),
          },
        ]);

      if (saveError) {
        console.error('Push: no se pudo guardar la suscripción en Supabase', saveError);
        setStatusMessage('La suscripción no se pudo guardar.');
        return;
      }

      setIsSubscribed(true);
      setStatusMessage('Las notificaciones quedaron activadas en este dispositivo.');
    } catch (error) {
      console.error('Push: error activando notificaciones', error);
      setStatusMessage('Ocurrió un error activando las notificaciones.');
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

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
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

      {statusMessage && (
        <p className="text-xs text-content-muted" role="status" aria-live="polite">
          {statusMessage}
        </p>
      )}
    </div>
  );
}
