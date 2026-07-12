import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeVoiceSegment = {
  text: string;
  alternatives: string[];
  confidence: number;
  timestamp: number;
  duration: number;
};

export type NativeVoiceTranscript = {
  text: string;
  isFinal: boolean;
  locale: string;
  segments: NativeVoiceSegment[];
};

export type NativeVoiceFollowerStartResult = {
  listening: boolean;
  locale: string;
  onDevice: boolean;
};

export type NativeVoiceFollowerError = {
  code: string;
  message: string;
};

export interface NativeVoiceFollowerPlugin {
  getAvailability(options?: { locales?: string[] }): Promise<{
    available: boolean;
    locale?: string;
    reason?: string;
  }>;
  start(options: {
    locales?: string[];
    contextualStrings?: string[];
  }): Promise<NativeVoiceFollowerStartResult>;
  stop(): Promise<{ listening: boolean }>;
  addListener(
    eventName: 'transcript',
    listenerFunc: (result: NativeVoiceTranscript) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'voiceError',
    listenerFunc: (error: NativeVoiceFollowerError) => void,
  ): Promise<PluginListenerHandle>;
}

export const NativeVoiceFollower = registerPlugin<NativeVoiceFollowerPlugin>(
  'NativeVoiceFollower',
);

export const isNativeVoiceFollowerAvailable = () => (
  typeof window !== 'undefined' &&
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('NativeVoiceFollower')
);
