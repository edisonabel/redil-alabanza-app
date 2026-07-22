import {
  isLiveCapacityDiagnosticsEnabled,
  recordLiveCapacityDiagnostic,
} from './liveCapacityDiagnostics.ts';

type NavigatorWithMemoryAndStandalone = Navigator & {
  deviceMemory?: number;
  standalone?: boolean;
  userAgentData?: {
    brands?: Array<{ brand?: string; version?: string }>;
    platform?: string;
  };
};

type PerformanceMemoryLike = {
  usedJSHeapSize?: number;
  jsHeapSizeLimit?: number;
};

type PerformanceWithMemory = Performance & {
  memory?: PerformanceMemoryLike;
};

type WindowWithWebkitAudio = Window & typeof globalThis & {
  chrome?: unknown;
  webkitAudioContext?: typeof AudioContext;
};

type LiveBrowserIdentity = {
  brands?: Array<{ brand?: string }>;
  hasChromeRuntime?: boolean;
  userAgent?: string;
  vendor?: string;
};

type DiagnosticMethod = 'info' | 'warn' | 'error';
type DiagnosticPayload = Record<string, unknown>;

const DEBUG_QUERY_KEYS = ['debug', 'debugLive', 'liveDebug', 'lddebug'];
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);
const CHROMIUM_USER_AGENT_PATTERN = /Chrome|Chromium|CriOS|Edg|OPR/i;
const CHROMIUM_BRAND_PATTERN = /Chromium|Google Chrome|Microsoft Edge|Opera|Brave/i;

export const detectLiveChromeFamily = ({
  brands = [],
  hasChromeRuntime = false,
  userAgent = '',
  vendor = '',
}: LiveBrowserIdentity) => {
  const brandNames = brands.map((entry) => entry.brand || '').join(' ');
  return CHROMIUM_USER_AGENT_PATTERN.test(userAgent) ||
    CHROMIUM_BRAND_PATTERN.test(brandNames) ||
    /Google Inc\.?/i.test(vendor) ||
    hasChromeRuntime;
};

const isTruthyDebugValue = (value: string | null) => {
  if (value === null) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === '' || !DISABLED_VALUES.has(normalizedValue);
};

export const isLiveDiagnosticsEnabled = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (DEBUG_QUERY_KEYS.some((key) => params.has(key) && isTruthyDebugValue(params.get(key)))) {
      return true;
    }
  } catch {
    // Ignore URL parsing issues and keep diagnostics opt-in.
  }

  return false;
};

const writeLiveDiagnostic = (
  method: DiagnosticMethod,
  eventName: string,
  payload?: DiagnosticPayload,
) => {
  const consoleEnabled = isLiveDiagnosticsEnabled();
  const capacityEnabled = isLiveCapacityDiagnosticsEnabled();
  if (!consoleEnabled && !capacityEnabled) {
    return;
  }

  const normalizedPayload = payload || {};
  if (consoleEnabled) {
    console[method](`[LiveDiagnostics] ${eventName}`, normalizedPayload);
  }
  if (capacityEnabled) {
    recordLiveCapacityDiagnostic(`live:${eventName}`, normalizedPayload, method);
  }
};

export const logLiveDiagnostic = (eventName: string, payload?: DiagnosticPayload) => {
  writeLiveDiagnostic('info', eventName, payload);
};

export const warnLiveDiagnostic = (eventName: string, payload?: DiagnosticPayload) => {
  writeLiveDiagnostic('warn', eventName, payload);
};

export const errorLiveDiagnostic = (eventName: string, payload?: DiagnosticPayload) => {
  writeLiveDiagnostic('error', eventName, payload);
};

export const readLiveBrowserCapabilities = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  const browserWindow = window as WindowWithWebkitAudio;
  const navigatorWithMemory = navigator as NavigatorWithMemoryAndStandalone;
  const performanceWithMemory = window.performance as PerformanceWithMemory;
  const userAgent = navigator.userAgent || '';
  const userAgentBrands = navigatorWithMemory.userAgentData?.brands || [];
  const vendor = navigator.vendor || '';
  const hasChromeRuntime = typeof browserWindow.chrome !== 'undefined';
  const isTouchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
  const isChromeFamily = detectLiveChromeFamily({
    brands: userAgentBrands,
    hasChromeRuntime,
    userAgent,
    vendor,
  });
  const isWebKit = /AppleWebKit/i.test(userAgent) && !isChromeFamily;

  return {
    userAgent,
    userAgentBrands,
    vendor,
    hasChromeRuntime,
    platform: navigatorWithMemory.userAgentData?.platform || null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    isIOS: /iPhone|iPad|iPod/i.test(userAgent) || isTouchMac,
    isAndroid: /Android/i.test(userAgent),
    isSafari: /Safari/i.test(userAgent) && !isChromeFamily,
    isWebKit,
    isChromeFamily,
    standaloneDisplay:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      navigatorWithMemory.standalone === true,
    audioContext: typeof browserWindow.AudioContext === 'function',
    webkitAudioContext: typeof browserWindow.webkitAudioContext === 'function',
    audioWorkletNode: typeof AudioWorkletNode === 'function',
    audioDecoder: typeof AudioDecoder === 'function',
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    crossOriginIsolated: window.crossOriginIsolated === true,
    deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
    browserHeapUsedBytes: performanceWithMemory.memory?.usedJSHeapSize ?? null,
    browserHeapLimitBytes: performanceWithMemory.memory?.jsHeapSizeLimit ?? null,
  };
};

export const formatDiagnosticBytes = (bytes: number | null | undefined) => {
  if (!Number.isFinite(bytes) || !bytes) {
    return null;
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};
