import type { DriveStep } from 'driver.js';

type OnboardingStep = Pick<DriveStep, 'element' | 'popover'>;
export type OnboardingPageKey = 'home' | 'repertorio' | 'programacion' | 'perfil';

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
    element: '[data-tour="programacion-view-mode"]',
    popover: {
      title: 'Cambia la forma de ver los servicios',
      description:
        'Aquí eliges si prefieres revisar la programación en modo tarjeta o en modo lista. En escritorio también puedes abrir la vista calendario.',
      side: 'bottom',
      align: 'center',
    },
  },
  {
    element: '[data-tour="programacion-event-info"]',
    popover: {
      title: 'Lee la información clave del evento',
      description:
        'Aquí ves la fecha, el horario, el tema de predicación y si el servicio será acústico, para ubicarte rápido antes de revisar el equipo.',
      side: 'bottom',
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

const perfilSteps: OnboardingStep[] = [
  {
    element: '[data-tour="perfil-photo"]',
    popover: {
      title: 'Cuida tu foto de perfil',
      description:
        'Desde aquí puedes cambiar tu foto. Usa un retrato cercano para que tu equipo te identifique rápido en cada asignación.',
      side: 'right',
      align: 'center',
    },
  },
  {
    element: '[data-tour="perfil-birthday"]',
    popover: {
      title: 'Tu cumpleaños sí importa',
      description:
        'Registra tu fecha de nacimiento correctamente. La usamos para recordarte en la app y mantener tu perfil completo.',
      side: 'left',
      align: 'center',
    },
  },
  {
    element: '[data-tour="perfil-availability"]',
    popover: {
      title: 'Bloquea fechas con tiempo',
      description:
        'Aquí puedes registrar ausencias o días no disponibles para evitar que te asignen cuando no podrás servir.',
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
  perfil: {
    storageKey: 'redil_onboarding_seen_perfil',
    modalTitle: 'Configura bien tu perfil',
    modalBody:
      'Aquí puedes actualizar tu foto, completar tu fecha de nacimiento y bloquear fechas para que el equipo tenga tu disponibilidad clara.',
    modalSecondary:
      'Te mostraremos lo esencial para dejar tu perfil listo en menos de un minuto.',
    steps: perfilSteps,
  },
};

export function getOnboardingConfig(page: OnboardingPageKey): OnboardingConfig {
  return onboardingConfigs[page] || onboardingConfigs.home;
}

export function getOnboardingSteps(page: OnboardingPageKey): DriveStep[] {
  if (typeof document === 'undefined') return [];

  return onboardingConfigs[page].steps.filter((step) => document.querySelector(step.element));
}
