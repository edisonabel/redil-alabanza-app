import { isGuideRoutingTrack } from './liveDirectorTrackRouting';

export const MIX_GROUPS = [
  { id: 'rhythm', label: 'Ritmo' },
  { id: 'harmony', label: 'Armonía' },
  { id: 'vocals', label: 'Voces' },
  { id: 'other', label: 'Otros' },
  { id: 'cues', label: 'Click y guía' },
] as const;
export type MixGroupId = typeof MIX_GROUPS[number]['id'];
export function inferMixGroup(track: { id: string; name: string; sourceFileName?: string }): MixGroupId {
  if (isGuideRoutingTrack(track)) return 'cues';
  const name = `${track.name} ${track.sourceFileName || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(bgv\d*|vocals?|voces?|choir|coro|coros|voz)\b/.test(name)) return 'vocals';
  if (/\b(drums?|bateria|perc\w*|bass|bajo|kick|snare|loops?|shaker|tambourine)\b/.test(name)) return 'rhythm';
  if (/\b(keys?\d*|piano|synth\w*|pads?|strings?|guit\w*|eg\d*|ag\d*|acoustic|electric|organ|brass)\b/.test(name)) return 'harmony';
  return 'other';
}
