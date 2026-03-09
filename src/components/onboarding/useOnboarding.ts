import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import type { OnboardingPageKey } from './onboardingSteps';
import { supabase } from '../../lib/supabase';

declare global {
  interface Window {
    openOnboarding?: () => void;
    resetOnboarding?: () => void;
    __REDIL_OPEN_ONBOARDING_PENDING__?: boolean;
  }
}

const ACTIVE_ONBOARDING_PAGES_KEY = 'redil_onboarding_active_pages';
const ALL_ONBOARDING_PAGES: OnboardingPageKey[] = ['home', 'repertorio', 'programacion', 'perfil'];
const ONBOARDING_STORAGE_KEYS: Record<OnboardingPageKey, string> = {
  home: 'redil_onboarding_seen',
  repertorio: 'redil_onboarding_seen_repertorio',
  programacion: 'redil_onboarding_seen_programacion',
  perfil: 'redil_onboarding_seen_perfil',
};

const readActivePages = (): OnboardingPageKey[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.sessionStorage.getItem(ACTIVE_ONBOARDING_PAGES_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((page): page is OnboardingPageKey => ALL_ONBOARDING_PAGES.includes(page as OnboardingPageKey));
  } catch {
    return [];
  }
};

const writeActivePages = (pages: OnboardingPageKey[]) => {
  if (typeof window === 'undefined') return;

  if (pages.length === 0) {
    window.sessionStorage.removeItem(ACTIVE_ONBOARDING_PAGES_KEY);
    return;
  }

  window.sessionStorage.setItem(ACTIVE_ONBOARDING_PAGES_KEY, JSON.stringify(pages));
};

const activateAllOnboardingPages = () => {
  if (typeof window === 'undefined') return;
  writeActivePages(ALL_ONBOARDING_PAGES);
};

const clearAllOnboardingSeenKeys = () => {
  if (typeof window === 'undefined') return;
  Object.values(ONBOARDING_STORAGE_KEYS).forEach((key) => {
    window.localStorage.removeItem(key);
  });
};

type UseOnboardingReturn = {
  isReady: boolean;
  isWelcomeOpen: boolean;
  openWelcome: () => void;
  closeWelcome: () => void;
  dismissWelcome: () => void;
  startTour: () => void;
  resetOnboarding: () => void;
};

type UseOnboardingOptions = {
  buildDriver: (steps: DriveStep[]) => Driver;
  storageKey: string;
  page: OnboardingPageKey;
  getSteps: (page: OnboardingPageKey) => DriveStep[];
  userId?: string | null;
  onboardingCompleted?: boolean;
};

export function useOnboarding({
  buildDriver,
  storageKey,
  page,
  getSteps,
  userId = null,
  onboardingCompleted = false,
}: UseOnboardingOptions): UseOnboardingReturn {
  const [isReady, setIsReady] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  const onboardingPersistedRef = useRef(Boolean(onboardingCompleted));

  useEffect(() => {
    onboardingPersistedRef.current = Boolean(onboardingCompleted);
  }, [onboardingCompleted]);

  const persistOnboardingCompletion = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!userId || onboardingPersistedRef.current) return;

    try {
      const { error } = await supabase
        .from('perfiles')
        .update({ tour_completado: true })
        .eq('id', userId);

      if (error) {
        console.error('Onboarding: no se pudo persistir tour_completado', error);
        return;
      }

      onboardingPersistedRef.current = true;
    } catch (error) {
      console.error('Onboarding: fallo inesperado persistiendo el tour', error);
    }
  }, [userId]);

  const markSeen = useCallback(() => {
    if (typeof window === 'undefined') return;
    const activePages = readActivePages();
    const nextPages = activePages.filter((activePage) => activePage !== page);
    writeActivePages(nextPages);
    window.localStorage.setItem(storageKey, 'true');
  }, [page, storageKey]);

  const openWelcome = useCallback(() => {
    setIsWelcomeOpen(true);
  }, []);

  const closeWelcome = useCallback(() => {
    setIsWelcomeOpen(false);
  }, []);

  const dismissWelcome = useCallback(() => {
    void persistOnboardingCompletion();
    markSeen();
    setIsWelcomeOpen(false);
  }, [markSeen, persistOnboardingCompletion]);

  const resetOnboarding = useCallback(() => {
    if (typeof window === 'undefined') return;
    clearAllOnboardingSeenKeys();
    onboardingPersistedRef.current = false;
    setIsWelcomeOpen(true);
  }, []);

  const startTour = useCallback(() => {
    if (typeof window === 'undefined') return;

    const steps = getSteps(page);
    void persistOnboardingCompletion();
    markSeen();
    setIsWelcomeOpen(false);

    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }

    if (steps.length === 0) return;

    const nextDriver = buildDriver(steps);
    driverRef.current = nextDriver;
    window.requestAnimationFrame(() => nextDriver.drive());
  }, [buildDriver, getSteps, markSeen, page, persistOnboardingCompletion]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const activePages = readActivePages();
    let shouldOpenForThisPage = activePages.includes(page);

    if (!shouldOpenForThisPage && page === 'home' && !onboardingCompleted) {
      activateAllOnboardingPages();
      shouldOpenForThisPage = true;
    }

    setIsReady(true);
    setIsWelcomeOpen(shouldOpenForThisPage);

    const openHandler = () => {
      activateAllOnboardingPages();
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      setIsWelcomeOpen(true);
      window.__REDIL_OPEN_ONBOARDING_PENDING__ = false;
    };

    window.openOnboarding = openHandler;
    window.resetOnboarding = () => {
      clearAllOnboardingSeenKeys();
      onboardingPersistedRef.current = false;
      activateAllOnboardingPages();
      openHandler();
    };

    window.addEventListener('redil:open-onboarding', openHandler as EventListener);

    if (window.__REDIL_OPEN_ONBOARDING_PENDING__) {
      openHandler();
    }

    return () => {
      if (window.openOnboarding) delete window.openOnboarding;
      if (window.resetOnboarding) delete window.resetOnboarding;
      window.removeEventListener('redil:open-onboarding', openHandler as EventListener);
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, [onboardingCompleted, page]);

  useEffect(() => {
    if (!isWelcomeOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isWelcomeOpen]);

  return useMemo(
    () => ({
      isReady,
      isWelcomeOpen,
      openWelcome,
      closeWelcome,
      dismissWelcome,
      startTour,
      resetOnboarding,
    }),
    [closeWelcome, dismissWelcome, isReady, isWelcomeOpen, openWelcome, resetOnboarding, startTour],
  );
}
