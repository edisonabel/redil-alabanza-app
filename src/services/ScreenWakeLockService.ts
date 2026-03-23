type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

class ScreenWakeLockService {
  private sentinel: WakeLockSentinelLike | null = null;
  private installComplete = false;
  private acquirePromise: Promise<boolean> | null = null;
  private activeRequesters = new Set<string>();

  install() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (this.installComplete) return;

    this.installComplete = true;
    document.addEventListener('visibilitychange', this.handleVisibilityChange, { passive: true });
    window.addEventListener('pageshow', this.handlePageShow, { passive: true });
    window.addEventListener('focus', this.handlePageShow, { passive: true });
  }

  setRequested(id: string, shouldHold: boolean) {
    this.install();
    if (!id) return;

    if (shouldHold) {
      this.activeRequesters.add(id);
      void this.acquire();
      return;
    }

    this.activeRequesters.delete(id);
    if (this.activeRequesters.size === 0) {
      void this.release();
    }
  }

  private supportsWakeLock() {
    return Boolean((navigator as NavigatorWithWakeLock).wakeLock?.request);
  }

  private async acquire() {
    this.install();

    if (!this.supportsWakeLock()) return false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    if (this.activeRequesters.size === 0) return false;
    if (this.sentinel && !this.sentinel.released) return true;
    if (this.acquirePromise) return this.acquirePromise;

    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) return false;

    this.acquirePromise = (async () => {
      try {
        const sentinel = await wakeLock.request('screen');
        this.sentinel = sentinel;

        sentinel.addEventListener?.('release', () => {
          if (this.sentinel === sentinel) {
            this.sentinel = null;
          }

          if (this.activeRequesters.size > 0 && document.visibilityState === 'visible') {
            void this.acquire();
          }
        });

        return true;
      } catch (error) {
        console.warn('[ScreenWakeLockService] No se pudo adquirir screen wake lock.', error);
        return false;
      } finally {
        this.acquirePromise = null;
      }
    })();

    return this.acquirePromise;
  }

  async release() {
    const sentinel = this.sentinel;
    this.sentinel = null;

    if (!sentinel || sentinel.released) return;

    try {
      await sentinel.release();
    } catch (error) {
      console.warn('[ScreenWakeLockService] No se pudo liberar screen wake lock.', error);
    }
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void this.acquire();
      return;
    }

    if (this.sentinel && !this.sentinel.released) {
      void this.release();
    }
  };

  private handlePageShow = () => {
    void this.acquire();
  };
}

export const screenWakeLockService = new ScreenWakeLockService();
