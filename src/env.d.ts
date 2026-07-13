/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: any | null;
    perfil: any | null;
    accessToken: string | null;
  }
}

interface Window {
  [key: `__REDIL_${string}`]: any;
  appStateRoles: any[];
  appStateTeamMembers: any[];
  tbState: { assignments: any[] };
  renderPlantillasGlobally: () => void;
  openModalEquipoDetalles: (equipoId: string) => void;
  openTbPicker: (rolId: string | null, rolName: string | null) => void | Promise<void>;
  webkitAudioContext?: typeof AudioContext;
}
