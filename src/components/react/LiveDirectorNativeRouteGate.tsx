import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export function LiveDirectorNativeRouteGate() {
  useEffect(() => {
    if (
      !Capacitor.isNativePlatform() ||
      Capacitor.getPlatform() !== 'ios' ||
      !Capacitor.isPluginAvailable('NativeLiveDirectorEngine')
    ) {
      return;
    }

    const nextUrl = new URL(window.location.href);
    if (nextUrl.pathname.endsWith('/herramientas/live-director-ios')) {
      return;
    }

    nextUrl.pathname = '/herramientas/live-director-ios';
    window.location.replace(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, []);

  return null;
}

export default LiveDirectorNativeRouteGate;
