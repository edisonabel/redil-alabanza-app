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
  lastLifecycleBeaconAtMs: number;
  remoteStatus: 'idle' | 'sending' | 'sent' | 'error';
  lastRemoteAt: string;
  updateTimer: number | null;
  persistTimer: number | null;
  flushTimer: number | null;
  drainTimer: number | null;
  criticalFlushTimer: number | null;
  urgentFlushRequested: boolean;
  heartbeatTimer: number | null;
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

export type LiveCapacityDeviceProfile = {
  browser: {
    name: string;
    version: string;
  };
  os: {
    name: string;
    version: string;
  };
  device: {
    model: string;
    formFactor: string;
    modelSource: 'client-hints' | 'user-agent' | 'generic';
  };
  clientHints: {
    architecture: string;
    bitness: string;
    mobile: boolean | null;
    platform: string;
    platformVersion: string;
  } | null;
};

const CAPACITY_QUERY_KEY = 'capacityDebug';
const CAPACITY_COOKIE_KEY = 'redil_capacity_debug';
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);
const SESSION_ID_PATTERN = /^CAP-[A-Z0-9-]{8,40}$/;
const STORAGE_CURRENT_KEY = 'redil:live-capacity:current-v1';
const STORAGE_PREVIOUS_KEY = 'redil:live-capacity:previous-v1';
const STORAGE_RECOVERY_OUTBOX_KEY = 'redil:live-capacity:recovery-outbox-v1';
const MAX_ENTRIES = 1800;
const MAX_PERSISTED_ENTRIES = 90;
const MAX_REMOTE_BATCH = 64;
const MAX_REMOTE_BODY_BYTES = 48 * 1024;
const REMOTE_FLUSH_INTERVAL_MS = 15_000;
const REMOTE_DRAIN_DELAY_MS = 300;
const CRITICAL_FLUSH_DEBOUNCE_MS = 500;
const REMOTE_REQUEST_TIMEOUT_MS = 6_000;
const LIFECYCLE_BEACON_GUARD_MS = 1_500;
const PERSIST_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
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
    if (params.has(CAPACITY_QUERY_KEY)) {
      const enabled = isTruthyDebugValue(params.get(CAPACITY_QUERY_KEY));
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = enabled
        ? `${CAPACITY_COOKIE_KEY}=1; Path=/; Max-Age=86400; SameSite=Lax${secure}`
        : `${CAPACITY_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      return enabled;
    }
    return document.cookie
      .split(';')
      .some((cookie) => cookie.trim() === `${CAPACITY_COOKIE_KEY}=1`);
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

const normalizeVersion = (value = '') => String(value || '').replace(/_/g, '.').trim();

export const parseLiveCapacityUserAgent = (
  rawUserAgent = '',
  rawPlatform = '',
): LiveCapacityDeviceProfile => {
  const userAgent = String(rawUserAgent || '');
  const platform = String(rawPlatform || '');

  const browserPatterns: Array<[string, RegExp]> = [
    ['Microsoft Edge', /(?:EdgiOS|EdgA|Edg)\/([\d.]+)/i],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/i],
    ['Firefox', /(?:FxiOS|Firefox)\/([\d.]+)/i],
    ['Chrome', /(?:CriOS|Chrome)\/([\d.]+)/i],
    ['Safari', /Version\/([\d.]+).+Safari\//i],
  ];
  const browserMatch = browserPatterns
    .map(([name, pattern]) => ({ name, match: userAgent.match(pattern) }))
    .find((entry) => entry.match);

  let osName = platform || 'Desconocido';
  let osVersion = '';
  const iosMatch = userAgent.match(/(?:CPU(?: iPhone)? OS|iPhone OS)\s([\d_]+)/i);
  const androidMatch = userAgent.match(/Android\s([\d.]+)/i);
  const windowsMatch = userAgent.match(/Windows NT\s([\d.]+)/i);
  const macMatch = userAgent.match(/Mac OS X\s([\d_]+)/i);

  if (iosMatch) {
    osName = 'iOS';
    osVersion = normalizeVersion(iosMatch[1]);
  } else if (androidMatch) {
    osName = 'Android';
    osVersion = normalizeVersion(androidMatch[1]);
  } else if (windowsMatch) {
    osName = 'Windows';
    osVersion = normalizeVersion(windowsMatch[1]);
  } else if (macMatch) {
    osName = 'macOS';
    osVersion = normalizeVersion(macMatch[1]);
  }

  let formFactor = 'Desktop';
  let model = '';
  let modelSource: LiveCapacityDeviceProfile['device']['modelSource'] = 'generic';

  if (/iPad/i.test(userAgent)) {
    formFactor = 'Tablet';
    model = 'iPad';
  } else if (/iPhone|iPod/i.test(userAgent)) {
    formFactor = 'Mobile';
    model = /iPod/i.test(userAgent) ? 'iPod touch' : 'iPhone';
  } else if (/Android/i.test(userAgent)) {
    formFactor = /Mobile/i.test(userAgent) ? 'Mobile' : 'Tablet';
    const androidModelMatch = userAgent.match(
      /Android\s[^;)]+;\s*(?:[a-z]{2}(?:-[A-Z]{2})?;\s*)?([^;)]+?)(?:\s+Build[/;]|\))/i,
    );
    const candidate = String(androidModelMatch?.[1] || '').trim();
    if (candidate && !/^(?:K|wv)$/i.test(candidate)) {
      model = candidate;
      modelSource = 'user-agent';
    } else {
      model = formFactor === 'Tablet' ? 'Android tablet' : 'Android';
    }
  } else {
    model = osName === 'macOS' ? 'Mac' : osName === 'Windows' ? 'PC' : 'Desktop';
  }

  return {
    browser: {
      name: browserMatch?.name || 'Desconocido',
      version: normalizeVersion(browserMatch?.match?.[1] || ''),
    },
    os: {
      name: osName || 'Desconocido',
      version: osVersion,
    },
    device: {
      model,
      formFactor,
      modelSource,
    },
    clientHints: null,
  };
};

export const readLiveCapacityDeviceProfile = async (): Promise<LiveCapacityDeviceProfile> => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return parseLiveCapacityUserAgent();
  }

  const fallback = parseLiveCapacityUserAgent(navigator.userAgent, navigator.platform);
  const navigatorWithHints = navigator as Navigator & {
    userAgentData?: {
      brands?: Array<{ brand?: string; version?: string }>;
      mobile?: boolean;
      platform?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
    };
  };
  const userAgentData = navigatorWithHints.userAgentData;

  if (
    navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1
    && fallback.os.name === 'macOS'
  ) {
    fallback.os.name = 'iPadOS';
    fallback.device.model = 'iPad';
    fallback.device.formFactor = 'Tablet';
  }

  if (!userAgentData?.getHighEntropyValues) return fallback;

  try {
    const highEntropy = await userAgentData.getHighEntropyValues([
      'architecture',
      'bitness',
      'formFactors',
      'fullVersionList',
      'model',
      'platformVersion',
    ]);
    const fullVersionList = Array.isArray(highEntropy.fullVersionList)
      ? highEntropy.fullVersionList as Array<{ brand?: string; version?: string }>
      : userAgentData.brands || [];
    const preferredBrand = fullVersionList.find((item) => (
      item?.brand
      && !/not.a.brand|chromium/i.test(item.brand)
    )) || fullVersionList.find((item) => item?.brand);
    const hintedModel = String(highEntropy.model || '').trim();
    const hintedFormFactors = Array.isArray(highEntropy.formFactors)
      ? highEntropy.formFactors.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const hintedPlatform = String(userAgentData.platform || '').trim();
    const hintedPlatformVersion = String(highEntropy.platformVersion || '').trim();

    return {
      browser: {
        name: String(preferredBrand?.brand || fallback.browser.name).trim(),
        version: normalizeVersion(preferredBrand?.version || fallback.browser.version),
      },
      os: {
        name: hintedPlatform || fallback.os.name,
        version: hintedPlatformVersion || fallback.os.version,
      },
      device: {
        model: hintedModel || fallback.device.model,
        formFactor: hintedFormFactors[0]
          || (userAgentData.mobile === true ? 'Mobile' : fallback.device.formFactor),
        modelSource: hintedModel ? 'client-hints' : fallback.device.modelSource,
      },
      clientHints: {
        architecture: String(highEntropy.architecture || '').trim(),
        bitness: String(highEntropy.bitness || '').trim(),
        mobile: typeof userAgentData.mobile === 'boolean' ? userAgentData.mobile : null,
        platform: hintedPlatform,
        platformVersion: hintedPlatformVersion,
      },
    };
  } catch {
    return fallback;
  }
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
  const deviceProfile = parseLiveCapacityUserAgent(
    navigator.userAgent,
    navigator.platform,
  );

  return {
    href: window.location.href,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigatorWithHints.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    browser: deviceProfile.browser,
    os: deviceProfile.os,
    device: deviceProfile.device,
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

type StoredCapacitySession = {
  version?: number;
  sessionId?: string;
  startedAt?: string;
  exportedAt?: string;
  metadata?: Record<string, unknown>;
  summary?: unknown;
  entries?: CapacityEntry[];
  pending?: CapacityEntry[];
  recoveryClassification?: 'probable-abrupt-termination' | 'previous-session-tail';
  terminationDetectedAt?: string;
  terminationReported?: boolean;
};

type RecoveryClassification = NonNullable<StoredCapacitySession['recoveryClassification']>;

type RecoveryTermination = {
  classification: 'probable-abrupt-termination';
  evidence: 'missing-page-hide-or-session-end';
  detectedAt: string;
  recoveredBySessionId: string;
  lastPersistedSequence: number;
  lastPersistedAt: string | null;
};

type DiagnosticAcknowledgement = {
  ok?: boolean;
  sessionId?: string;
  batchId?: string | null;
  acceptedThrough?: number | null;
};

const getEntrySequence = (entry: Pick<CapacityEntry, 'sequence'>) => (
  Number.isFinite(Number(entry.sequence)) ? Math.max(0, Math.trunc(Number(entry.sequence))) : 0
);

const getLastStoredEntry = (previous: StoredCapacitySession) => {
  const candidates = [
    ...(Array.isArray(previous.entries) ? previous.entries : []),
    ...(Array.isArray(previous.pending) ? previous.pending : []),
  ];
  return candidates.reduce<CapacityEntry | null>((latest, entry) => (
    !latest || getEntrySequence(entry) >= getEntrySequence(latest) ? entry : latest
  ), null);
};

export const classifyStoredCapacitySessionForRecovery = (
  entries: Array<Pick<CapacityEntry, 'sequence' | 'type'>>,
): RecoveryClassification => {
  let lastOpenSequence = 0;
  let lastCloseSequence = 0;

  entries.forEach((entry) => {
    const sequence = getEntrySequence(entry);
    if (entry.type === 'capacity-session-start' || entry.type === 'page-show') {
      lastOpenSequence = Math.max(lastOpenSequence, sequence);
    }
    if (entry.type === 'capacity-session-end' || entry.type === 'page-hide') {
      lastCloseSequence = Math.max(lastCloseSequence, sequence);
    }
  });

  return lastCloseSequence > lastOpenSequence
    ? 'previous-session-tail'
    : 'probable-abrupt-termination';
};

const getStoredRecoveryEntries = (previous: StoredCapacitySession) => (
  Array.isArray(previous.pending)
    ? previous.pending
    : (Array.isArray(previous.entries) ? previous.entries : [])
);

const createAbruptTerminationEntry = (
  previous: StoredCapacitySession,
  detectedAt: string,
): CapacityEntry => {
  const lastEntry = getLastStoredEntry(previous);
  return {
    sequence: (lastEntry ? getEntrySequence(lastEntry) : 0) + 1,
    at: detectedAt,
    elapsedMs: lastEntry?.elapsedMs || 0,
    type: 'capacity-session-probable-termination',
    level: 'warn',
    payload: {
      classification: 'probable-abrupt-termination',
      evidence: 'missing-page-hide-or-session-end',
      lastPersistedSequence: lastEntry ? getEntrySequence(lastEntry) : 0,
      lastPersistedAt: lastEntry?.at || previous.exportedAt || null,
    },
  };
};

const readCurrentStoredSession = (): StoredCapacitySession | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_CURRENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCapacitySession;
    if (
      !parsed ||
      typeof parsed.sessionId !== 'string' ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const exportState = (
  state: CapacityRuntimeState,
  includePrevious = false,
  entries: CapacityEntry[] = state.entries,
) => JSON.stringify({
  version: 1,
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  exportedAt: new Date().toISOString(),
  metadata: state.metadata,
  summary: getSummaryFromState(state),
  entries,
  pending: state.pending,
  ...(includePrevious ? { previousSession: readPreviousStoredSession() } : {}),
}, null, 2);

const persistStateNow = (state: CapacityRuntimeState) => {
  try {
    window.localStorage.setItem(
      STORAGE_CURRENT_KEY,
      exportState(state, false, state.entries.slice(-MAX_PERSISTED_ENTRIES)),
    );
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

export const isLiveCapacityEntryUrgent = (
  type: string,
  level: CapacityLevel,
  payload: unknown,
) => {
  // Flight-recorder snapshots intentionally retain recent/historical flags for
  // diagnosis. They are context, not a new failure transition, so they must not
  // trigger another immediate POST every time the snapshot is sampled.
  if (type === 'engine-capacity-snapshot') return false;
  if (level === 'error') return true;

  const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (payloadRecord.criticalTransition === true) return true;

  const transitionText = [
    type,
    payloadRecord.event,
    payloadRecord.eventType,
    payloadRecord.type,
    payloadRecord.phase,
    payloadRecord.reason,
    payloadRecord.code,
    payloadRecord.transition,
    payloadRecord.status,
  ].filter((value) => typeof value === 'string').join(' ').replace(/_/g, '-');

  return /underflow|underrun|decoder-overload|worker-error|suspend|stale|interrupted|main-thread-stall|audio-loss|signal[-_]lost|click-never-signaled|guide-no-read/i.test(transitionText);
};

const isCriticalEntry = isLiveCapacityEntryUrgent;

type RemoteFlushReason =
  | 'interval'
  | 'critical'
  | 'drain'
  | 'hidden'
  | 'pagehide'
  | 'online'
  | 'manual'
  | 'previous-session-tail';

const buildRemotePayload = (
  state: CapacityRuntimeState,
  entries: CapacityEntry[],
  reason: RemoteFlushReason,
) => ({
  version: 1,
  sessionId: state.sessionId,
  startedAt: state.startedAt,
  sentAt: new Date().toISOString(),
  reason,
  batchId: entries.length > 0
    ? `${state.sessionId}:${entries[0].sequence}-${entries[entries.length - 1].sequence}`
    : `${state.sessionId}:empty`,
  firstSequence: entries[0]?.sequence ?? null,
  lastSequence: entries[entries.length - 1]?.sequence ?? null,
  metadata: state.metadata,
  summary: getSummaryFromState(state),
  entries,
});

const measureUtf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

const compactEntryForTransport = (entry: CapacityEntry): CapacityEntry => ({
  ...entry,
  payload: {
    transportTruncated: true,
    preview: truncateString(JSON.stringify(entry.payload) || String(entry.payload), 4_000),
  },
});

const buildRemoteBatch = (
  state: CapacityRuntimeState,
  reason: RemoteFlushReason,
  preferRecent = false,
) => {
  const candidates = preferRecent
    ? state.pending.slice(-MAX_REMOTE_BATCH).reverse()
    : state.pending.slice(0, MAX_REMOTE_BATCH);
  const entries: CapacityEntry[] = [];
  let body = '';

  for (const entry of candidates) {
    const nextEntries = preferRecent ? [entry, ...entries] : [...entries, entry];
    const nextBody = JSON.stringify(buildRemotePayload(state, nextEntries, reason));
    if (measureUtf8Bytes(nextBody) > MAX_REMOTE_BODY_BYTES) {
      if (entries.length === 0) {
        const compactEntry = compactEntryForTransport(entry);
        entries.push(compactEntry);
        body = JSON.stringify(buildRemotePayload(state, entries, reason));
      }
      break;
    }
    if (preferRecent) {
      entries.unshift(entry);
    } else {
      entries.push(entry);
    }
    body = nextBody;
  }

  return {
    entries,
    body,
    batchId: entries.length > 0
      ? `${state.sessionId}:${entries[0].sequence}-${entries[entries.length - 1].sequence}`
      : '',
  };
};

const buildRecoveredRemoteBatch = (
  previous: StoredCapacitySession,
  recoveredBySessionId: string,
) => {
  const sessionId = String(previous.sessionId || '');
  const candidates = Array.isArray(previous.entries)
    ? previous.entries.slice(0, MAX_REMOTE_BATCH)
    : [];
  const entries: CapacityEntry[] = [];
  let body = '';
  let batchId = '';
  const lastStoredEntry = getLastStoredEntry(previous);
  const termination: RecoveryTermination | null = (
    previous.recoveryClassification === 'probable-abrupt-termination' &&
    previous.terminationReported !== true
  ) ? {
      classification: 'probable-abrupt-termination',
      evidence: 'missing-page-hide-or-session-end',
      detectedAt: previous.terminationDetectedAt || new Date().toISOString(),
      recoveredBySessionId,
      lastPersistedSequence: lastStoredEntry ? getEntrySequence(lastStoredEntry) : 0,
      lastPersistedAt: lastStoredEntry?.at || previous.exportedAt || null,
    } : null;

  const createPayload = (payloadEntries: CapacityEntry[]) => {
    const firstSequence = payloadEntries[0]?.sequence ?? 0;
    const lastSequence = payloadEntries[payloadEntries.length - 1]?.sequence ?? 0;
    return {
      version: previous.version || 1,
      sessionId,
      startedAt: previous.startedAt || null,
      sentAt: new Date().toISOString(),
      reason: 'previous-session-tail',
      batchId: `${sessionId}:recovered:${firstSequence}-${lastSequence}`,
      firstSequence: firstSequence || null,
      lastSequence: lastSequence || null,
      metadata: {
        ...(previous.metadata || {}),
        previousSessionTail: true,
        recoveredBySessionId,
        recoveryClassification: previous.recoveryClassification || 'previous-session-tail',
      },
      summary: previous.summary || null,
      termination,
      entries: payloadEntries,
    };
  };

  for (const entry of candidates) {
    const nextEntries = [...entries, entry];
    const nextPayload = createPayload(nextEntries);
    const nextBody = JSON.stringify(nextPayload);
    if (measureUtf8Bytes(nextBody) > MAX_REMOTE_BODY_BYTES) {
      if (entries.length === 0) {
        const compactEntry = compactEntryForTransport(entry);
        entries.push(compactEntry);
        const compactPayload = createPayload(entries);
        batchId = compactPayload.batchId;
        body = JSON.stringify(compactPayload);
      }
      break;
    }
    entries.push(entry);
    batchId = nextPayload.batchId;
    body = nextBody;
  }

  return {
    entries,
    body,
    batchId,
    reportsTermination: termination !== null,
  };
};

const readRecoveryOutbox = (): StoredCapacitySession[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_RECOVERY_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((session): session is StoredCapacitySession => (
      session &&
      SESSION_ID_PATTERN.test(String(session.sessionId || '')) &&
      Array.isArray(session.entries) &&
      session.entries.length > 0
    ));
  } catch {
    return [];
  }
};

const writeRecoveryOutbox = (sessions: StoredCapacitySession[]) => {
  try {
    if (sessions.length === 0) {
      window.localStorage.removeItem(STORAGE_RECOVERY_OUTBOX_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_RECOVERY_OUTBOX_KEY, JSON.stringify(sessions));
  } catch {
    // Recovery is best effort when the device has exhausted storage.
  }
};

const queueStoredSessionForRecovery = (
  previous: StoredCapacitySession | null,
) => {
  const outbox = readRecoveryOutbox();
  const previousSessionId = String(previous?.sessionId || '');
  if (previous && SESSION_ID_PATTERN.test(previousSessionId)) {
    const lifecycleEntries = Array.isArray(previous.entries) ? previous.entries : [];
    const recoveryClassification = previous.recoveryClassification
      || classifyStoredCapacitySessionForRecovery(lifecycleEntries);
    const terminationDetectedAt = previous.terminationDetectedAt || new Date().toISOString();
    const rawRecoveryEntries = getStoredRecoveryEntries(previous);
    const recoveryEntries = [...rawRecoveryEntries];

    if (
      recoveryClassification === 'probable-abrupt-termination' &&
      !recoveryEntries.some((entry) => entry.type === 'capacity-session-probable-termination')
    ) {
      recoveryEntries.push(createAbruptTerminationEntry(previous, terminationDetectedAt));
    }

    if (recoveryEntries.length > 0) {
      const existingIndex = outbox.findIndex((session) => session.sessionId === previousSessionId);
      if (existingIndex >= 0) {
        const existing = outbox[existingIndex];
        const entriesBySequence = new Map<number, CapacityEntry>();
        [...(existing.entries || []), ...recoveryEntries].forEach((entry) => {
          entriesBySequence.set(getEntrySequence(entry), entry);
        });
        outbox[existingIndex] = {
          ...existing,
          ...previous,
          pending: undefined,
          entries: [...entriesBySequence.values()]
            .sort((left, right) => getEntrySequence(left) - getEntrySequence(right)),
          recoveryClassification,
          terminationDetectedAt,
          terminationReported: existing.terminationReported === true,
        };
      } else {
        outbox.push({
          ...previous,
          pending: undefined,
          entries: recoveryEntries,
          recoveryClassification,
          terminationDetectedAt,
          terminationReported: previous.terminationReported === true,
        });
      }
    }
  }
  writeRecoveryOutbox(outbox);
  return outbox;
};

const postDiagnosticBody = async (body: string, keepalive = false) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REMOTE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch('/api/live-capacity-diagnostics', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

const uploadRecoveryOutbox = async (
  sessions: StoredCapacitySession[],
  recoveredBySessionId: string,
) => {
  const sessionIds = sessions
    .map((session) => String(session.sessionId || ''))
    .filter((sessionId) => sessionId && sessionId !== recoveredBySessionId);

  for (const previousSessionId of sessionIds) {
    while (true) {
      const outbox = readRecoveryOutbox();
      const currentIndex = outbox.findIndex(
        (session) => session.sessionId === previousSessionId,
      );
      if (currentIndex < 0) break;

      const previous = outbox[currentIndex];
      const {
        entries,
        body,
        batchId,
        reportsTermination,
      } = buildRecoveredRemoteBatch(previous, recoveredBySessionId);
      if (entries.length === 0 || !body || !batchId) break;

      try {
        const response = await postDiagnosticBody(body);
        if (!response.ok) break;
        const acknowledgement = await response.json() as DiagnosticAcknowledgement;
        if (
          acknowledgement.ok !== true ||
          acknowledgement.sessionId !== previousSessionId ||
          acknowledgement.batchId !== batchId ||
          acknowledgement.acceptedThrough !== entries[entries.length - 1]?.sequence
        ) {
          break;
        }

        const acknowledgedSequences = new Set(entries.map((entry) => entry.sequence));
        const latestOutbox = readRecoveryOutbox();
        const latestIndex = latestOutbox.findIndex(
          (session) => session.sessionId === previousSessionId,
        );
        if (latestIndex < 0) break;
        const latestSession = latestOutbox[latestIndex];
        const remainingEntries = (latestSession.entries || [])
          .filter((entry) => !acknowledgedSequences.has(entry.sequence));

        if (remainingEntries.length === 0) {
          latestOutbox.splice(latestIndex, 1);
        } else {
          latestOutbox[latestIndex] = {
            ...latestSession,
            entries: remainingEntries,
            terminationReported: latestSession.terminationReported === true
              || reportsTermination,
          };
        }
        writeRecoveryOutbox(latestOutbox);
      } catch {
        break;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, REMOTE_DRAIN_DELAY_MS);
      });
    }
  }
};

const flushWithBeacon = (
  state: CapacityRuntimeState,
  reason: Extract<RemoteFlushReason, 'hidden' | 'pagehide'>,
) => {
  if (!navigator.sendBeacon || state.pending.length === 0) return false;
  const now = Date.now();
  if (
    reason === 'pagehide' &&
    now - state.lastLifecycleBeaconAtMs < LIFECYCLE_BEACON_GUARD_MS
  ) {
    const latestEntry = state.pending[state.pending.length - 1];
    if (!latestEntry) return true;
    const lifecycleBody = JSON.stringify(buildRemotePayload(state, [latestEntry], reason));
    const lifecycleQueued = navigator.sendBeacon(
      '/api/live-capacity-diagnostics',
      new Blob([lifecycleBody], { type: 'application/json' }),
    );
    if (lifecycleQueued) state.lastLifecycleBeaconAtMs = now;
    return lifecycleQueued;
  }
  const { entries, body } = buildRemoteBatch(state, reason, true);
  if (entries.length === 0 || !body) return false;
  const queued = navigator.sendBeacon(
    '/api/live-capacity-diagnostics',
    new Blob([body], { type: 'application/json' }),
  );
  if (queued) state.lastLifecycleBeaconAtMs = now;
  return queued;
};

const scheduleRemoteDrain = (state: CapacityRuntimeState) => {
  if (state.drainTimer !== null || state.pending.length === 0) return;
  state.drainTimer = window.setTimeout(() => {
    state.drainTimer = null;
    void flushLiveCapacityDiagnostics('drain');
  }, REMOTE_DRAIN_DELAY_MS);
};

const scheduleCriticalFlush = (state: CapacityRuntimeState) => {
  state.urgentFlushRequested = true;
  if (state.criticalFlushTimer !== null) return;

  const attemptFlush = () => {
    state.criticalFlushTimer = null;
    if (state.pending.length === 0) {
      state.urgentFlushRequested = false;
      return;
    }
    if (state.remoteStatus === 'sending') {
      state.criticalFlushTimer = window.setTimeout(
        attemptFlush,
        CRITICAL_FLUSH_DEBOUNCE_MS,
      );
      return;
    }

    state.urgentFlushRequested = false;
    void flushLiveCapacityDiagnostics('critical');
  };

  state.criticalFlushTimer = window.setTimeout(
    attemptFlush,
    CRITICAL_FLUSH_DEBOUNCE_MS,
  );
};

export const flushLiveCapacityDiagnostics = async (
  reason: RemoteFlushReason = 'manual',
) => {
  const browserWindow = getCapacityWindow();
  const state = browserWindow?.__REDIL_CAPACITY_STATE__;
  if (!state || state.pending.length === 0) return;
  if (state.remoteStatus === 'sending') {
    if (reason === 'critical') scheduleCriticalFlush(state);
    return;
  }

  const {
    entries,
    body,
    batchId,
  } = buildRemoteBatch(state, reason, reason === 'critical');
  if (entries.length === 0 || !body || !batchId) return;
  state.remoteStatus = 'sending';
  notifyPanel(state);

  try {
    const keepalive = reason === 'critical' || reason === 'hidden' || reason === 'pagehide';
    const response = await postDiagnosticBody(body, keepalive);
    if (!response.ok) throw new Error(`diagnostic-upload-${response.status}`);
    const acknowledgement = await response.json() as DiagnosticAcknowledgement;
    if (
      acknowledgement.ok !== true ||
      acknowledgement.sessionId !== state.sessionId ||
      acknowledgement.batchId !== batchId ||
      acknowledgement.acceptedThrough !== entries[entries.length - 1]?.sequence
    ) {
      throw new Error('diagnostic-upload-invalid-ack');
    }
    const acknowledgedSequences = new Set(entries.map((entry) => entry.sequence));
    state.pending = state.pending.filter((entry) => !acknowledgedSequences.has(entry.sequence));
    state.remoteStatus = 'sent';
    state.lastRemoteAt = new Date().toISOString();
    persistStateNow(state);
    scheduleRemoteDrain(state);
  } catch {
    state.remoteStatus = 'error';
    schedulePersist(state);
  }

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
  const critical = isCriticalEntry(entry.type, level, entry.payload);
  if (critical) state.criticalCount += 1;

  schedulePersist(state);
  notifyPanel(state);
  if (critical) {
    scheduleCriticalFlush(state);
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
  window.addEventListener('online', () => {
    recordLifecycle('network-online');
    void flushLiveCapacityDiagnostics('online');
  });
  window.addEventListener('offline', () => recordLifecycle('network-offline'));
  window.addEventListener('pageshow', (event) => recordLifecycle('page-show', { persisted: event.persisted }));
  window.addEventListener('pagehide', (event) => {
    recordLifecycle('page-hide', { persisted: event.persisted });
    persistStateNow(state);
    if (!flushWithBeacon(state, 'pagehide')) {
      void flushLiveCapacityDiagnostics('pagehide');
    }
  });
  document.addEventListener('visibilitychange', () => {
    recordLifecycle('visibility-change', { visibilityState: document.visibilityState });
    if (document.visibilityState === 'hidden') {
      persistStateNow(state);
      if (!flushWithBeacon(state, 'hidden')) {
        void flushLiveCapacityDiagnostics('hidden');
      }
    }
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

  state.heartbeatTimer = window.setInterval(() => {
    recordIntoState(state, 'capacity-heartbeat', {
      visibilityState: document.visibilityState,
      online: navigator.onLine,
      eventLoopLagMs: Math.round(state.lastEventLoopLagMs),
      maxEventLoopLagMs: Math.round(state.maxEventLoopLagMs),
    }, 'info');
  }, HEARTBEAT_INTERVAL_MS);

  state.flushTimer = window.setInterval(() => {
    void flushLiveCapacityDiagnostics('interval');
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
      state.urgentFlushRequested = false;
      if (state.criticalFlushTimer !== null) {
        window.clearTimeout(state.criticalFlushTimer);
        state.criticalFlushTimer = null;
      }
      state.criticalCount = 0;
      state.maxEventLoopLagMs = 0;
      try {
        window.localStorage.removeItem(STORAGE_CURRENT_KEY);
        window.localStorage.removeItem(STORAGE_PREVIOUS_KEY);
        window.localStorage.removeItem(STORAGE_RECOVERY_OUTBOX_KEY);
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

  const previousStoredSession = readCurrentStoredSession();
  const recoveryOutbox = queueStoredSessionForRecovery(previousStoredSession);
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
    lastLifecycleBeaconAtMs: 0,
    remoteStatus: 'idle',
    lastRemoteAt: '',
    updateTimer: null,
    persistTimer: null,
    flushTimer: null,
    drainTimer: null,
    criticalFlushTimer: null,
    urgentFlushRequested: false,
    heartbeatTimer: null,
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
  persistStateNow(state);
  void uploadRecoveryOutbox(recoveryOutbox, state.sessionId);
  return state;
};

export const enrichLiveCapacityDiagnostics = async (
  metadata: Record<string, unknown> = {},
) => {
  const state = ensureLiveCapacityDiagnostics();
  if (!state) return null;

  const deviceProfile = await readLiveCapacityDeviceProfile();
  const sanitizedMetadata = sanitizeValue({
    ...metadata,
    browser: deviceProfile.browser,
    os: deviceProfile.os,
    device: deviceProfile.device,
    clientHints: deviceProfile.clientHints,
  });

  if (sanitizedMetadata && typeof sanitizedMetadata === 'object' && !Array.isArray(sanitizedMetadata)) {
    Object.assign(state.metadata, sanitizedMetadata as Record<string, unknown>);
  }

  recordIntoState(state, 'capacity-metadata-enriched', {
    tester: state.metadata.tester || null,
    browser: state.metadata.browser || null,
    os: state.metadata.os || null,
    device: state.metadata.device || null,
  }, 'info');
  persistStateNow(state);
  return state.metadata;
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
