type CapacityLevel = 'info' | 'warn' | 'error';

type CapacityEntry = {
  sequence: number;
  at: string;
  elapsedMs: number;
  type: string;
  level: CapacityLevel;
  payload: unknown;
};

type CapacityRuntimeState = {
  sessionId: string;
  startedAt: string;
  startedAtMs: number;
  sequence: number;
  entries: CapacityEntry[];
  pending: CapacityEntry[];
  criticalCount: number;
  maxEventLoopLagMs: number;
  lastEventLoopLagMs: number;
  remoteStatus: 'idle' | 'sending' | 'sent' | 'error';
  lastRemoteAt: string;
  updateTimer: number | null;
  persistTimer: number | null;
  flushTimer: number | null;
  runtimeTimer: number | null;
  eventLoopTimer: number | null;
  expectedEventLoopAt: number;
  installed: boolean;
  metadata: Record<string, unknown>;
};

type CapacityWindow = Window & typeof globalThis & {
  __REDIL_CAPACITY_STATE__?: CapacityRuntimeState;
  __REDIL_CAPACITY_DIAGNOSTICS__?: {
    sessionId: string;
    exportData: () => string;
    copy: () => Promise<boolean>;
    download: () => void;
    flush: () => Promise<void>;
    clear: () => void;
    getSummary: () => CapacitySummary;
  };
};

export type CapacitySummary = {
  enabled: boolean;
  sessionId: string;
  elapsedSeconds: number;
  entryCount: number;
  criticalCount: number;
  lastEventLoopLagMs: number;
  maxEventLoopLagMs: number;
  remoteStatus: string;
  lastRemoteAt: string;
};

const CAPACITY_QUERY_KEY = 'capacityDebug';
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);
const STORAGE_CURRENT_KEY = 'redil:live-capacity:current-v1';
const STORAGE_PREVIOUS_KEY = 'redil:live-capacity:previous-v1';
const MAX_ENTRIES = 1800;
const MAX_PENDING_ENTRIES = 240;
const MAX_REMOTE_BATCH = 36;
const REMOTE_FLUSH_INTERVAL_MS = 15_000;
const PERSIST_INTERVAL_MS = 5_000;
const RUNTIME_SAMPLE_INTERVAL_MS = 10_000;
const EVENT_LOOP_SAMPLE_INTERVAL_MS = 1_000;

const getCapacityWindow = (): CapacityWindow | null => (
  typeof window === 'undefined' ? null : window as CapacityWindow
);

const isTruthyDebugValue = (value: string | null) => {
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '' || !DISABLED_VALUES.has(normalized);
};

export const isLiveCapacityDiagnosticsEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has(CAPACITY_QUERY_KEY) && isTruthyDebugValue(params.get(CAPACITY_QUERY_KEY));
  } catch {
    return false;
  }
};

const truncateString = (value: string, maxLength = 700) => (
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
);

const sanitizeValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value === null || typeof value === 'undefined') return value ?? null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: truncateString(value.stack || '', 1400),
    };
  }
  if (depth >= 4) return '[max-depth]';
  if (typeof value !== 'object') return truncateString(String(value));
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, 48).map((entry) => sanitizeValue(entry, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, entry]) => {
    output[truncateString(key, 120)] = sanitizeValue(entry, depth + 1, seen);
  });
  return output;
};

const readBrowserSnapshot = () => {
  if (typeof window === 'undefined') return {};
  const navigatorWithHints = navigator as Navigator & {
    deviceMemory?: number;
    standalone?: boolean;
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  };
  const performanceWithMemory = window.performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  };
  const connection = navigatorWithHints.connection;

  return {
    href: window.location.href,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigatorWithHints.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      navigatorWithHints.standalone === true,
    crossOriginIsolated: window.crossOriginIsolated === true,
    visibilityState: document.visibilityState,
    online: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    connection: connection ? {
      effectiveType: connection.effectiveType || null,
      downlink: connection.downlink ?? null,
      rtt: connection.rtt ?? null,
      saveData: connection.saveData ?? null,
    } : null,
    heap: performanceWithMemory.memory ? {
      usedBytes: performanceWithMemory.memory.usedJSHeapSize ?? null,
      totalBytes: performanceWithMemory.memory.totalJSHeapSize ?? null,
      limitBytes: performanceWithMemory.memory.jsHeapSizeLimit ?? null,
    } : null,
  };
};

const createSessionId = () => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CAP-${timestamp}-${random}`;
};

const getSummaryFromState = (state: CapacityRuntimeState): CapacitySummary => ({
  enabled: true,
  sessionId: state.sessionId,
  elapsedSeconds: Math.max(0, Math.round((Date.now() - state.startedAtMs) / 1000)),
  entryCount: state.entries.length,
  criticalCount: state.criticalCount,
  lastEventLoopLagMs: Math.round(state.lastEventLoopLagMs),
  maxEventLoopLagMs: Math.round(state.maxEventLoopLagMs),
  remoteStatus: state.remoteStatus,
  lastRemoteAt: state.lastRemoteAt,
});

const readPreviousStoredSession = (): unknown => {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREVIOUS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const exportState = (state: CapacityRuntimeState, includePrevious = false) => JSON.stringify({
  version: 1,
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  exportedAt: new Date().toISOString(),
  metadata: state.metadata,
  summary: getSummaryFromState(state),
  entries: state.entries,
  ...(includePrevious ? { previousSession: readPreviousStoredSession() } : {}),
}, null, 2);

const persistStateNow = (state: CapacityRuntimeState) => {
  try {
    window.localStorage.setItem(STORAGE_CURRENT_KEY, exportState(state));
  } catch {
    // Persistence is best effort; remote batches and manual export still work.
  }
};

const schedulePersist = (state: CapacityRuntimeState) => {
  if (state.persistTimer !== null) return;
  state.persistTimer = window.setTimeout(() => {
    state.persistTimer = null;
    persistStateNow(state);
  }, PERSIST_INTERVAL_MS);
};

const notifyPanel = (state: CapacityRuntimeState) => {
  if (state.updateTimer !== null) return;
  state.updateTimer = window.setTimeout(() => {
    state.updateTimer = null;
    window.dispatchEvent(new CustomEvent('live-capacity-diagnostics:update', {
      detail: getSummaryFromState(state),
    }));
  }, 500);
};

const isCriticalEntry = (type: string, level: CapacityLevel, payload: unknown) => {
  if (level === 'error') return true;
  const haystack = `${type} ${JSON.stringify(payload)}`;
  return /underflow|underrun|decoder-overload|worker-error|suspend|stale|interrupted|main-thread-stall|audio-loss|signal[-_]lost|CLICK_NEVER_SIGNALED|GUIDE_NO_READ|RECENT_UNDERFLOW/i.test(haystack);
};

const buildRemotePayload = (state: CapacityRuntimeState, entries: CapacityEntry[]) => ({
  version: 1,
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  sentAt: new Date().toISOString(),
  metadata: state.metadata,
  summary: getSummaryFromState(state),
  entries,
});

const flushWithBeacon = (state: CapacityRuntimeState) => {
  if (!navigator.sendBeacon || state.pending.length === 0) return false;
  const entries = state.pending.slice(0, MAX_REMOTE_BATCH);
  const body = JSON.stringify(buildRemotePayload(state, entries));
  return navigator.sendBeacon(
    '/api/live-capacity-diagnostics',
    new Blob([body], { type: 'application/json' }),
  );
};

export const flushLiveCapacityDiagnostics = async () => {
  const browserWindow = getCapacityWindow();
  const state = browserWindow?.__REDIL_CAPACITY_STATE__;
  if (!state || state.pending.length === 0 || state.remoteStatus === 'sending') return;

  const entries = state.pending.slice(0, MAX_REMOTE_BATCH);
  state.remoteStatus = 'sending';
  notifyPanel(state);

  try {
    const response = await fetch('/api/live-capacity-diagnostics', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(buildRemotePayload(state, entries)),
    });
    if (!response.ok) throw new Error(`diagnostic-upload-${response.status}`);
    state.pending.splice(0, entries.length);
    state.remoteStatus = 'sent';
    state.lastRemoteAt = new Date().toISOString();
  } catch {
    state.remoteStatus = 'error';
  }

  schedulePersist(state);
  notifyPanel(state);
};

const recordIntoState = (
  state: CapacityRuntimeState,
  type: string,
  payload: unknown,
  level: CapacityLevel,
) => {
  state.sequence += 1;
  const entry: CapacityEntry = {
    sequence: state.sequence,
    at: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - state.startedAtMs),
    type: truncateString(type, 160),
    level,
    payload: sanitizeValue(payload),
  };

  state.entries.push(entry);
  if (state.entries.length > MAX_ENTRIES) state.entries.splice(0, state.entries.length - MAX_ENTRIES);
  state.pending.push(entry);
  if (state.pending.length > MAX_PENDING_ENTRIES) {
    state.pending.splice(0, state.pending.length - MAX_PENDING_ENTRIES);
  }
  const critical = isCriticalEntry(entry.type, level, entry.payload);
  if (critical) state.criticalCount += 1;

  schedulePersist(state);
  notifyPanel(state);
  if (critical) {
    void flushLiveCapacityDiagnostics();
  }
};

const installRuntimeObservers = (state: CapacityRuntimeState) => {
  if (state.installed) return;
  state.installed = true;

  const recordLifecycle = (type: string, payload: unknown = {}) => {
    recordIntoState(state, type, payload, 'info');
  };

  window.addEventListener('error', (event) => {
    recordIntoState(state, 'window-error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    }, 'error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    recordIntoState(state, 'unhandled-rejection', { reason: event.reason }, 'error');
  });
  window.addEventListener('online', () => recordLifecycle('network-online'));
  window.addEventListener('offline', () => recordLifecycle('network-offline'));
  window.addEventListener('pageshow', (event) => recordLifecycle('page-show', { persisted: event.persisted }));
  window.addEventListener('pagehide', (event) => {
    recordLifecycle('page-hide', { persisted: event.persisted });
    persistStateNow(state);
    flushWithBeacon(state);
  });
  document.addEventListener('visibilitychange', () => {
    recordLifecycle('visibility-change', { visibilityState: document.visibilityState });
  });

  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.duration < 50) return;
        recordIntoState(state, 'long-task', {
          durationMs: Math.round(entry.duration),
          startTimeMs: Math.round(entry.startTime),
        }, entry.duration >= 250 ? 'warn' : 'info');
      });
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long Tasks API is not available in every Safari version.
  }

  state.expectedEventLoopAt = performance.now() + EVENT_LOOP_SAMPLE_INTERVAL_MS;
  state.eventLoopTimer = window.setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - state.expectedEventLoopAt);
    state.lastEventLoopLagMs = lag;
    state.maxEventLoopLagMs = Math.max(state.maxEventLoopLagMs, lag);
    state.expectedEventLoopAt = now + EVENT_LOOP_SAMPLE_INTERVAL_MS;
    if (lag >= 250) {
      recordIntoState(state, 'main-thread-stall', { lagMs: Math.round(lag) }, 'warn');
    }
  }, EVENT_LOOP_SAMPLE_INTERVAL_MS);

  state.runtimeTimer = window.setInterval(() => {
    recordIntoState(state, 'runtime-sample', {
      browser: readBrowserSnapshot(),
      resourceCount: performance.getEntriesByType('resource').length,
      eventLoopLagMs: Math.round(state.lastEventLoopLagMs),
      maxEventLoopLagMs: Math.round(state.maxEventLoopLagMs),
    }, 'info');
  }, RUNTIME_SAMPLE_INTERVAL_MS);

  state.flushTimer = window.setInterval(() => {
    void flushLiveCapacityDiagnostics();
  }, REMOTE_FLUSH_INTERVAL_MS);
};

const installPublicApi = (browserWindow: CapacityWindow, state: CapacityRuntimeState) => {
  browserWindow.__REDIL_CAPACITY_DIAGNOSTICS__ = {
    sessionId: state.sessionId,
    exportData: () => exportState(state, true),
    copy: async () => {
      try {
        await navigator.clipboard.writeText(exportState(state, true));
        return true;
      } catch {
        return false;
      }
    },
    download: () => {
      const blob = new Blob([exportState(state, true)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${state.sessionId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    flush: flushLiveCapacityDiagnostics,
    clear: () => {
      state.entries = [];
      state.pending = [];
      state.criticalCount = 0;
      state.maxEventLoopLagMs = 0;
      try {
        window.localStorage.removeItem(STORAGE_CURRENT_KEY);
        window.localStorage.removeItem(STORAGE_PREVIOUS_KEY);
      } catch {
        // no-op
      }
      notifyPanel(state);
    },
    getSummary: () => getSummaryFromState(state),
  };
};

export const ensureLiveCapacityDiagnostics = (metadata: Record<string, unknown> = {}) => {
  const browserWindow = getCapacityWindow();
  if (!browserWindow || !isLiveCapacityDiagnosticsEnabled()) return null;
  if (browserWindow.__REDIL_CAPACITY_STATE__) {
    const sanitizedMetadata = sanitizeValue(metadata);
    if (sanitizedMetadata && typeof sanitizedMetadata === 'object' && !Array.isArray(sanitizedMetadata)) {
      Object.assign(
        browserWindow.__REDIL_CAPACITY_STATE__.metadata,
        sanitizedMetadata as Record<string, unknown>,
      );
    }
    return browserWindow.__REDIL_CAPACITY_STATE__;
  }

  try {
    const previous = window.localStorage.getItem(STORAGE_CURRENT_KEY);
    if (previous) window.localStorage.setItem(STORAGE_PREVIOUS_KEY, previous);
  } catch {
    // no-op
  }

  const now = new Date();
  const state: CapacityRuntimeState = {
    sessionId: createSessionId(),
    startedAt: now.toISOString(),
    startedAtMs: now.getTime(),
    sequence: 0,
    entries: [],
    pending: [],
    criticalCount: 0,
    maxEventLoopLagMs: 0,
    lastEventLoopLagMs: 0,
    remoteStatus: 'idle',
    lastRemoteAt: '',
    updateTimer: null,
    persistTimer: null,
    flushTimer: null,
    runtimeTimer: null,
    eventLoopTimer: null,
    expectedEventLoopAt: 0,
    installed: false,
    metadata: {
      ...readBrowserSnapshot(),
      ...(sanitizeValue(metadata) as Record<string, unknown>),
    },
  };

  browserWindow.__REDIL_CAPACITY_STATE__ = state;
  installPublicApi(browserWindow, state);
  installRuntimeObservers(state);
  recordIntoState(state, 'capacity-session-start', { metadata: state.metadata }, 'info');
  return state;
};

export const recordLiveCapacityDiagnostic = (
  type: string,
  payload: unknown = {},
  level: CapacityLevel = 'info',
) => {
  const state = ensureLiveCapacityDiagnostics();
  if (!state) return;
  recordIntoState(state, type, payload, level);
};

export const recordLiveCapacitySnapshot = (payload: unknown) => {
  recordLiveCapacityDiagnostic('engine-capacity-snapshot', payload, 'info');
};

export const readLiveCapacitySummary = (): CapacitySummary => {
  const browserWindow = getCapacityWindow();
  const state = browserWindow?.__REDIL_CAPACITY_STATE__;
  if (!state) {
    return {
      enabled: false,
      sessionId: '',
      elapsedSeconds: 0,
      entryCount: 0,
      criticalCount: 0,
      lastEventLoopLagMs: 0,
      maxEventLoopLagMs: 0,
      remoteStatus: 'idle',
      lastRemoteAt: '',
    };
  }
  return getSummaryFromState(state);
};

export const copyLiveCapacityDiagnostics = async () => {
  const browserWindow = getCapacityWindow();
  return browserWindow?.__REDIL_CAPACITY_DIAGNOSTICS__?.copy() ?? false;
};

export const downloadLiveCapacityDiagnostics = () => {
  const browserWindow = getCapacityWindow();
  browserWindow?.__REDIL_CAPACITY_DIAGNOSTICS__?.download();
};
