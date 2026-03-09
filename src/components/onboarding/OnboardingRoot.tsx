import React, { useCallback } from 'react';
import 'driver.js/dist/driver.css';
import './onboarding.css';
import type { DriveStep, Driver } from 'driver.js';
import { driver } from 'driver.js';
import WelcomeOnboardingModal from './WelcomeOnboardingModal';
import { useOnboarding } from './useOnboarding';
import { getOnboardingConfig, getOnboardingSteps, type OnboardingPageKey } from './onboardingSteps';

type OnboardingRootProps = {
  page?: OnboardingPageKey;
};

export default function OnboardingRoot({ page = 'home' }: OnboardingRootProps) {
  const config = getOnboardingConfig(page);

  const buildDriver = useCallback((steps: DriveStep[]): Driver => {
    return driver({
      animate: true,
      smoothScroll: true,
      allowClose: true,
      allowKeyboardControl: true,
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Atrás',
      doneBtnText: 'Comenzar',
      stagePadding: 10,
      stageRadius: 24,
      overlayColor: 'rgba(5, 10, 20, 0.58)',
      popoverOffset: 16,
      popoverClass: 'redil-onboarding-popover',
      steps,
      onHighlightStarted: (element) => {
        if (!(element instanceof HTMLElement)) return;

        window.requestAnimationFrame(() => {
          element.scrollIntoView({
            behavior: 'smooth',
            block: window.innerWidth < 768 ? 'center' : 'nearest',
            inline: 'nearest',
          });
        });
      },
      onPopoverRender: (popover, { driver: tourDriver }) => {
        const existingSkip = popover.footer?.querySelector<HTMLButtonElement>('[data-redil-onboarding-skip]');
        if (existingSkip) return;

        const skipButton = document.createElement('button');
        skipButton.type = 'button';
        skipButton.className = 'redil-onboarding-skip';
        skipButton.dataset.redilOnboardingSkip = 'true';
        skipButton.textContent = 'Saltar';
        skipButton.addEventListener('click', () => {
          tourDriver.destroy();
        });

        popover.footer?.prepend(skipButton);
      },
    });
  }, []);

  const { isReady, isWelcomeOpen, dismissWelcome, startTour } = useOnboarding({
    buildDriver,
    storageKey: config.storageKey,
    page,
    getSteps: getOnboardingSteps,
  });

  if (!isReady) return null;

  return (
    <WelcomeOnboardingModal
      open={isWelcomeOpen}
      title={config.modalTitle}
      body={config.modalBody}
      secondary={config.modalSecondary}
      onClose={dismissWelcome}
      onExplore={dismissWelcome}
      onStart={startTour}
    />
  );
}
