import type { ChordProLineSegment } from '../utils/chordProLineUtils';
import type { ConfidenceSectionKind } from '../utils/sectionVisuals';

export interface DisplayCue {
  id: string;
  type: 'lyrics' | 'instrumental' | 'empty';
  sectionIndex: number;
  sectionKind: ConfidenceSectionKind;
  sectionLabel: string;
  sectionShortLabel: string;
  sectionColor: [number, number, number];
  cueIndex: number;
  totalCuesInSection: number;
  lines: ChordProLineSegment[][];
  rawLines: string[];
  estimatedStartSec: number | null;
  estimatedEndSec: number | null;
}

export interface DisplaySection {
  index: number;
  kind: ConfidenceSectionKind;
  label: string;
  shortLabel: string;
  color: [number, number, number];
  startCueIndex: number;
  cueCount: number;
  startSec: number | null;
  endSec: number | null;
}

export interface DisplayTrack {
  songId: string;
  title: string;
  artist: string;
  key: string;
  bpm: number | null;
  cues: DisplayCue[];
  sections: DisplaySection[];
  totalDurationSec: number | null;
}

export interface DisplayTimeline {
  eventId: string;
  eventTitle: string;
  tracks: DisplayTrack[];
  totalCues: number;
}

export interface SyncPayload {
  songId: string;
  sectionIndex: number;
  currentTime: number;
  isPlaying?: boolean;
}

export interface MonitorSettings {
  showChords: boolean;
  showNextCue: boolean;
  showCountdown: boolean;
  showSectionMap: boolean;
  showSongInfo: boolean;
  fontSize: 'compact' | 'standard' | 'large';
}

export interface ConfidenceMonitorState {
  isConnected: boolean;
  connectionStatus: 'connected' | 'stale' | 'disconnected';
  lastHeartbeatAt: number;
  timeline: DisplayTimeline;
  activeTrackIndex: number;
  activeSectionIndex: number;
  activeCueIndex: number;
  activeCue: DisplayCue | null;
  nextCue: DisplayCue | null;
  nextSectionLabel: string | null;
  interpolatedTime: number;
  sectionTimeRemaining: number | null;
  settings: MonitorSettings;
}
