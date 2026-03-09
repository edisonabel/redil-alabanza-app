import type { DriveStep } from 'driver.js';

type OnboardingStep = Pick<DriveStep, 'element' | 'popover'>;
export type OnboardingPageKey = 'home' | 'repertorio' | 'programacion';

type OnboardingConfig = {
  storageKey: string;
  modalTitle: string;
  modalBody: string;
  modalSecondary: string;
  steps: OnboardingStep[];
};

const homeSteps: OnboardingStep[] = [
  {
    element: '[data-tour="assignments"]',
    popover: {
      title: 'Tus próximas asignaciones',
      description:
        'Aquí ves los servicios en los que participas, con fecha, hora, repertorio y tu rol dentro del equipo.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="setlist"]',
    popover: {
      title: 'Consulta el repertorio',
      description:
        'Desde aquí puedes ver canciones, revisar setlists y entrar rápidamente al contenido que necesitas preparar.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="environment"]',
    popover: {
      title: 'Herramientas para prepararte',
      description:
        'Accede al repertorio oficial, la caja de afinación y los ejercicios de calentamiento vocal desde un solo lugar.',
      side: 'left',
      align: 'start',
    },
  },
  {
    element: '[data-tour="shortcuts"]',
    popover: {
      title: 'Gestiona tu participación',
      description:
        'Usa estos accesos para reportar ausencias, revisar notificaciones y cambiar entre modo claro u oscuro.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: '[data-tour="extras"]',
    popover: {
      title: 'Mantente al día',
      description:
        'También verás eventos especiales, cumpleaños del mes y opciones para instalar la app en tu dispositivo.',
      side: 'top',
      align: 'center',
    },
  },
];

const repertorioSteps: OnboardingStep[] = [
  {
    element: '[data-tour="repertorio-search"]',
    popover: {
      title: 'Busca y filtra rápido',
      description:
        'Aquí puedes buscar la canción o el artista, y filtrar por voz, categoría o tema sin salir del repertorio.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="repertorio-card"]',
    popover: {
      title: 'Lee la tarjeta de la canción',
      description:
        'Cada tarjeta te muestra la canción, el artista, el BPM y la key o tono para que identifiques rápido lo que vas a preparar.',
      side: 'right',
      align: 'start',
    },
  },
  {
    element: '[data-tour="repertorio-audio"]',
    popover: {
      title: 'Escucha la canción',
      description:
        'Desde aquí puedes reproducir la canción directamente y practicar sin tener que abrir otra página.',
      side: 'bottom',
      align: 'center',
    },
  },
  {
    element: '[data-tour="repertorio-resources"]',
    popover: {
      title: 'Abre los recursos clave',
      description:
        'Aquí puedes escuchar voces, abrir acordes y revisar los apoyos de la canción. Próximamente también verás secuencias.',
      side: 'top',
      align: 'center',
    },
  },
];

const programacionSteps: OnboardingStep[] = [
  {
    element: '[data-tour="programacion-header"]',
    popover: {
      title: 'Tu programación del mes',
      description:
        'Aquí puedes ver los servicios programados y moverte entre las vistas para revisar la agenda de la forma que te resulte más cómoda.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="programacion-card"]',
    popover: {
      title: 'Lee cada evento rápido',
      description:
        'Cada tarjeta te muestra la fecha, la hora, el tipo de servicio y, si aplica, si será un servicio acústico.',
      side: 'right',
      align: 'start',
    },
  },
  {
    element: '[data-tour="programacion-roster"]',
    popover: {
      title: 'Revisa el equipo asignado',
      description:
        'Aquí ves quién está en Dirección, Letras, Banda y Voces para prepararte con claridad antes del servicio.',
      side: 'left',
      align: 'center',
    },
  },
  {
    element: '[data-tour="programacion-actions"]',
    popover: {
      title: 'Abre el detalle o gestiona',
      description:
        'Desde aquí puedes ver más información del evento y, si tienes permiso, entrar a gestionarlo rápidamente.',
      side: 'top',
      align: 'center',
    },
  },
];

const onboardingConfigs: Record<OnboardingPageKey, OnboardingConfig> = {
  home: {
    storageKey: 'redil_onboarding_seen',
    modalTitle: 'Bienvenido a Redil Worship',
    modalBody:
      'Aquí puedes ver tus asignaciones, consultar repertorio, practicar tu voz y prepararte mejor para cada servicio.',
    modalSecondary: 'Te mostraremos un recorrido rápido para ubicarte en menos de un minuto.',
    steps: homeSteps,
  },
  repertorio: {
    storageKey: 'redil_onboarding_seen_repertorio',
    modalTitle: 'Explora el repertorio',
    modalBody:
      'Aquí puedes buscar canciones o artistas, filtrar por voz, categoría o tema y ubicarte rápido dentro del catálogo.',
    modalSecondary:
      'Te mostraremos cómo leer la tarjeta, escuchar la canción y abrir recursos clave en menos de un minuto.',
    steps: repertorioSteps,
  },
  programacion: {
    storageKey: 'redil_onboarding_seen_programacion',
    modalTitle: 'Explora la programación',
    modalBody:
      'Aquí puedes revisar tus servicios, entender la tarjeta del evento y ubicar rápidamente al equipo asignado.',
    modalSecondary:
      'Te mostraremos lo esencial para moverte por esta vista en menos de un minuto.',
    steps: programacionSteps,
  },
};

export function getOnboardingConfig(page: OnboardingPageKey): OnboardingConfig {
  return onboardingConfigs[page] || onboardingConfigs.home;
}

export function getOnboardingSteps(page: OnboardingPageKey): DriveStep[] {
  if (typeof document === 'undefined') return [];

  return onboardingConfigs[page].steps.filter((step) => document.querySelector(step.element));
}
