import {
  NativeVoiceFollower,
  isNativeVoiceFollowerAvailable,
  type NativeVoiceFollowerError,
  type NativeVoiceFollowerStartResult,
  type NativeVoiceTranscript,
} from './NativeVoiceFollowerPlugin';

type VoiceEventName = 'transcript' | 'voiceError';
type VoiceListener = (payload: any) => void;
type ListenerHandle = { remove: () => Promise<void> };

const listeners: Record<VoiceEventName, Set<VoiceListener>> = {
  transcript: new Set(),
  voiceError: new Set(),
};

let recognition: any = null;
let browserListening = false;
let browserLocale = 'es-CO';

const getBrowserRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: new () => any;
    webkitSpeechRecognition?: new () => any;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
};

const emit = (eventName: VoiceEventName, payload: NativeVoiceTranscript | NativeVoiceFollowerError) => {
  listeners[eventName].forEach((listener) => listener(payload));
};

const browserErrorMessage = (code = '') => {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permite el acceso al micrófono en la configuración del navegador.';
    case 'audio-capture':
      return 'No se encontró un micrófono disponible.';
    case 'network':
      return 'El reconocimiento del navegador necesita conexión en este dispositivo.';
    case 'language-not-supported':
      return 'El navegador no admite reconocimiento de voz en español.';
    default:
      return 'El reconocimiento de voz del navegador se detuvo.';
  }
};

const startBrowserRecognition = (locales: string[] = []): Promise<NativeVoiceFollowerStartResult> => {
  const Recognition = getBrowserRecognitionConstructor();
  if (!Recognition) {
    return Promise.reject(new Error('Este navegador no ofrece reconocimiento de voz. Prueba Chrome o Safari actualizado.'));
  }

  browserLocale = locales.find(Boolean) || 'es-CO';
  browserListening = true;
  recognition = new Recognition();
  recognition.lang = browserLocale;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onresult = (event: any) => {
    const textParts: string[] = [];
    const segments: NativeVoiceTranscript['segments'] = [];
    let isFinal = true;

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const primary = result?.[0];
      if (!primary?.transcript) continue;
      textParts.push(primary.transcript);
      isFinal = isFinal && Boolean(result.isFinal);
      segments.push({
        text: String(primary.transcript).trim(),
        alternatives: Array.from(result)
          .map((alternative: any) => String(alternative?.transcript || '').trim())
          .filter(Boolean),
        confidence: Number(primary.confidence) || 0,
        timestamp: 0,
        duration: 0,
      });
    }

    const text = textParts.join(' ').trim();
    if (text) emit('transcript', { text, isFinal, locale: browserLocale, segments });
  };

  recognition.onerror = (event: any) => {
    const code = String(event?.error || 'recognition-error');
    if (code === 'no-speech' || code === 'aborted') return;
    browserListening = false;
    emit('voiceError', { code, message: browserErrorMessage(code) });
  };

  recognition.onend = () => {
    if (!browserListening || !recognition) return;
    try {
      recognition.start();
    } catch {
      browserListening = false;
    }
  };

  try {
    recognition.start();
  } catch (error) {
    browserListening = false;
    recognition = null;
    return Promise.reject(error);
  }

  return Promise.resolve({ listening: true, locale: browserLocale, onDevice: false });
};

const stopBrowserRecognition = async () => {
  browserListening = false;
  const activeRecognition = recognition;
  recognition = null;
  if (activeRecognition) {
    activeRecognition.onend = null;
    try {
      activeRecognition.stop();
    } catch {
      // It may already have stopped after a period of silence.
    }
  }
  return { listening: false };
};

export const isBrowserVoiceFollowerAvailable = () => Boolean(getBrowserRecognitionConstructor());

export const isVoiceFollowerAvailable = () => (
  isNativeVoiceFollowerAvailable() || isBrowserVoiceFollowerAvailable()
);

export const VoiceFollower = {
  start(options: { locales?: string[]; contextualStrings?: string[] }) {
    if (isNativeVoiceFollowerAvailable()) return NativeVoiceFollower.start(options);
    return startBrowserRecognition(options?.locales);
  },

  stop() {
    if (isNativeVoiceFollowerAvailable()) return NativeVoiceFollower.stop();
    return stopBrowserRecognition();
  },

  async addListener(eventName: VoiceEventName, listener: VoiceListener): Promise<ListenerHandle> {
    if (isNativeVoiceFollowerAvailable()) {
      if (eventName === 'transcript') {
        return NativeVoiceFollower.addListener('transcript', listener);
      }
      return NativeVoiceFollower.addListener('voiceError', listener);
    }

    listeners[eventName].add(listener);
    return {
      remove: async () => {
        listeners[eventName].delete(listener);
      },
    };
  },
};
