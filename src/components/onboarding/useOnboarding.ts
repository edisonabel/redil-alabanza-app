import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import type { OnboardingPageKey } from './onboardingSteps';

declare global {
  interface Window {
    openOnboarding?: () => void;
    resetOnboarding?: () => void;
    __REDIL_OPEN_ONBOARDING_PENDING__?: boolean;
  }
}

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
};

export function useOnboarding({ buildDriver, storageKey, page, getSteps }: UseOnboardingOptions): UseOnboardingReturn {
  const [isReady, setIsReady] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const driverRef = useRef<Driver | null>(null);

  const markSeen = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, 'true');
  }, [storageKey]);

  const openWelcome = useCallback(() => {
    setIsWelcomeOpen(true);
  }, []);

  const closeWelcome = useCallback(() => {
    setIsWelcomeOpen(false);
  }, []);

  const dismissWelcome = useCallback(() => {
    markSeen();
    setIsWelcomeOpen(false);
  }, [markSeen]);

  const resetOnboarding = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(storageKey);
    setIsWelcomeOpen(true);
  }, [storageKey]);

  const startTour = useCallback(() => {
    if (typeof window === 'undefined') return;

    const steps = getSteps(page);
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
  }, [buildDriver, getSteps, markSeen, page]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const seen = window.localStorage.getItem(storageKey) === 'true';
    setIsReady(true);
    setIsWelcomeOpen(!seen);

    const openHandler = () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      setIsWelcomeOpen(true);
      window.__REDIL_OPEN_ONBOARDING_PENDING__ = false;
    };

    window.openOnboarding = openHandler;
    window.resetOnboarding = () => {
      window.localStorage.removeItem(storageKey);
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
  }, [storageKey]);

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
