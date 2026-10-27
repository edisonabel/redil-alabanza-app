import { isGuideRoutingTrack } from './liveDirectorTrackRouting';
import { categorizeStemName, type StemCategory } from './stemCategories';

export const MIX_GROUPS = [
  { id: 'keys', label: 'Teclas / Pads', shortLabel: 'KEY', color: '#73c7fa' },
  { id: 'acoustic', label: 'Guit. acústica', shortLabel: 'AG', color: '#79d5ac' },
  { id: 'electric', label: 'Guit. eléctrica', shortLabel: 'EG', color: '#f5cf79' },
  { id: 'bass', label: 'Bajos', shortLabel: 'BSS', color: '#ee91b4' },
  { id: 'vocals', label: 'Voces', shortLabel: 'VOZ', color: '#c89dff' },
  { id: 'rhythm', label: 'Ritmo', shortLabel: 'RIT', color: '#fbad63' },
  { id: 'other', label: 'Otros', shortLabel: 'OTR', color: '#98a6b8' },
  { id: 'cues', label: 'Click y guía', shortLabel: 'GUÍA', color: '#f5d76b' },
] as const;
export type MixGroupId = typeof MIX_GROUPS[number]['id'];
const CATEGORY_GROUPS: Partial<Record<StemCategory, MixGroupId>> = {
  click: 'cues', guide: 'cues', cues: 'cues',
  piano: 'keys', keys: 'keys', organ: 'keys', pads: 'keys', synth: 'keys',
  acoustic: 'acoustic', electric: 'electric', bass: 'bass', synthBass: 'bass',
  vocals: 'vocals', choir: 'vocals', drums: 'rhythm', percussion: 'rhythm', cymbals: 'rhythm',
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ');

export function inferMixGroup(track: { id: string; name: string; sourceFileName?: string }): MixGroupId {
  if (isGuideRoutingTrack(track)) return 'cues';
  // Prefer the stem's own label over generic IDs and the source filename.
  // Bass drum is percussion; electric/synth bass must never become guitar/keys.
  for (const value of [track.name, track.id, track.sourceFileName || '']) {
    const name = normalize(value);
    if (/\b(drums?|baterias?|bombos?|kicks?|snares?|tarolas?|redoblantes?|caja|toms?|hi hat|overheads?|claps?|rimshots?)\b/.test(name)) return 'rhythm';
    if (/\b(bass|basses|bajos?|contrabajos?|subbass|synthbass)\b/.test(name)) return 'bass';
    if (/\b(pianos?|organs?|organos?|teclados?|teclas?|keyboards?|keys?|pads?|synths?|sintetizadores?|hammond|rhodes|wurli|wurlitzer)\b/.test(name)) return 'keys';
    if (/\b(acoustics?|acustic[ao]s?)\b/.test(name)) return 'acoustic';
    if (/\b(electricas?|guitarras? electricas?)\b/.test(name)) return 'electric';
    if (/\b(vox|voices?)\b/.test(name)) return 'vocals';
    const group = CATEGORY_GROUPS[categorizeStemName(value)];
    if (group) return group;
  }
  return 'other';
}
