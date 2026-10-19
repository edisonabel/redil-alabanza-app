type StemCategoryDefinition = {
  label: string;
  trackId: string;
  trackName: string;
  volume: number;
  aliases: string[];
};

// One catalog for conversion, exported file names and Live Director channels.
export const STEM_CATEGORIES = {
  click: { label: 'Click / Metrónomo', trackId: 'click', trackName: 'Click', volume: 0.34, aliases: ['click', 'clic', 'clcik', 'metro', 'metronomo', 'metronome', 'tempo', 'bpm', 'clicktrack', 'cue click'] },
  guide: { label: 'Guía / Talkback', trackId: 'guide', trackName: 'Guide', volume: 0.72, aliases: ['guide', 'guia', 'guias', 'voz guia', 'guia vocal', 'vocal guide', 'vox guide', 'talkback', 'guidetrack', 'guidevox'] },
  cues: { label: 'Cues / Conteo', trackId: 'cues', trackName: 'Cues', volume: 0.62, aliases: ['cues', 'cue', 'count in', 'countin', 'conteo', 'cuetrack'] },
  drums: { label: 'Batería', trackId: 'drums', trackName: 'Drums', volume: 0.83, aliases: ['drums', 'drum', 'bateria', 'baterias', 'kit'] },
  bass: { label: 'Bajo', trackId: 'bass', trackName: 'Bass', volume: 0.76, aliases: ['bass', 'bajo'] },
  synthBass: { label: 'Bajo synth / Sub', trackId: 'synth-bass', trackName: 'Synth Bass', volume: 0.7, aliases: ['synth bass', 'synthbass', 'sub bass', '808 bass'] },
  piano: { label: 'Piano', trackId: 'piano', trackName: 'Piano', volume: 0.72, aliases: ['piano', 'grand', 'upright'] },
  keys: { label: 'Teclados / Piano eléctrico', trackId: 'keys', trackName: 'Keys', volume: 0.74, aliases: ['keys', 'key', 'teclas', 'tecla', 'teclado', 'rhodes', 'wurli', 'wurlitzer', 'ep', 'electric piano'] },
  organ: { label: 'Órgano', trackId: 'organ', trackName: 'Organ', volume: 0.68, aliases: ['organ', 'organo', 'hammond'] },
  synth: { label: 'Sintetizador', trackId: 'synth', trackName: 'Synth', volume: 0.68, aliases: ['synth', 'synthesizer', 'sintetizador', 'lead synth'] },
  acoustic: { label: 'Guitarra acústica', trackId: 'acoustic-gtr', trackName: 'Acoustic Gtr', volume: 0.69, aliases: ['acoustic', 'acustica', 'acoustic gtr', 'acoustic guitar', 'guitarra acustica', 'gtr ac', 'ag', 'ga', 'gac'] },
  electric: { label: 'Guitarra eléctrica', trackId: 'electric-gtr', trackName: 'Electric Gtr', volume: 0.63, aliases: ['electric', 'electrica', 'elec', 'electric gtr', 'electric guitar', 'guitarra electrica', 'gtr elec', 'lead gtr', 'rhythm gtr', 'egtr', 'gtr', 'guitar', 'guitarra', 'lead', 'dist', 'ge', 'eg', ...Array.from({ length: 6 }, (_, i) => [`ge${i + 1}`, `eg${i + 1}`, `g${i + 1}`]).flat(), 'g1a', 'g1b'] },
  banjo: { label: 'Banjo', trackId: 'banjo', trackName: 'Banjo', volume: 0.69, aliases: ['banjo'] },
  mandolin: { label: 'Mandolina', trackId: 'mandolin', trackName: 'Mandolina', volume: 0.69, aliases: ['mandolin', 'mandolina'] },
  ukulele: { label: 'Ukelele', trackId: 'ukulele', trackName: 'Ukelele', volume: 0.69, aliases: ['ukulele', 'ukelele', 'uke'] },
  violin: { label: 'Violín', trackId: 'violin', trackName: 'Violín', volume: 0.66, aliases: ['violin', 'violins', 'violines', 'fiddle'] },
  strings: { label: 'Cuerdas / Cello / Viola', trackId: 'strings', trackName: 'Strings', volume: 0.66, aliases: ['strings', 'string', 'cuerdas', 'cello', 'violonchelo', 'viola', 'orchestral strings'] },
  brass: { label: 'Metales / Trompetas', trackId: 'brass', trackName: 'Metales', volume: 0.68, aliases: ['brass', 'metales', 'trumpet', 'trumpets', 'trompeta', 'trompetas', 'trombon', 'trombones', 'trombone', 'horn', 'horns', 'tuba'] },
  woodwinds: { label: 'Vientos / Saxo / Flauta', trackId: 'woodwinds', trackName: 'Vientos', volume: 0.68, aliases: ['woodwinds', 'vientos', 'sax', 'saxo', 'saxophone', 'saxofon', 'flute', 'flauta', 'clarinet', 'clarinete', 'oboe'] },
  percussion: { label: 'Percusión extra', trackId: 'percussion', trackName: 'Percussion', volume: 0.72, aliases: ['percussion', 'percusion', 'perc', 'percs', 'shaker', 'tamb', 'tambourine', 'pandereta', 'conga', 'congas', 'bongo', 'bongos', 'timbales', 'cajon', 'loop', 'loops'] },
  cymbals: { label: 'Platillos / Cymbals', trackId: 'cymbals', trackName: 'Platillos', volume: 0.66, aliases: ['cymbals', 'cymbal', 'platillos', 'platillo', 'crash', 'ride', 'splash', 'hihat', 'hi hat', 'overheads'] },
  vocals: { label: 'Voces / Coros de apoyo', trackId: 'background-vocals', trackName: 'Background Vocals', volume: 0.78, aliases: ['background vocals', 'background vocal', 'backing vocals', 'vocals bg', 'bgv', 'bv', 'voz', 'voces', 'vocal', 'vocals'] },
  choir: { label: 'Coro / Choir', trackId: 'choir', trackName: 'Choir', volume: 0.76, aliases: ['choir', 'coro', 'coros', 'coro completo'] },
  pads: { label: 'Pads / Ambiente', trackId: 'pad', trackName: 'Pad', volume: 0.66, aliases: ['pad', 'pads', 'ambient', 'ambiente', 'atmos', 'colchon', 'colchones'] },
  sequence: { label: 'Secuencia / Mezcla completa', trackId: 'sequence', trackName: 'Sequence', volume: 0.84, aliases: ['sequence', 'secuencia', 'playback', 'stereo', 'mix', 'full mix', 'main mix', 'lr'] },
  misc: { label: 'Extras / FX', trackId: 'fx', trackName: 'FX', volume: 0.68, aliases: ['fx', 'sfx', 'effects', 'efectos', 'riser', 'risers', 'impact'] },
  unknown: { label: 'Por clasificar', trackId: 'unknown', trackName: 'Stem', volume: 0.72, aliases: [] },
} satisfies Record<string, StemCategoryDefinition>;

export type StemCategory = keyof typeof STEM_CATEGORIES;
export const STEM_CATEGORY_ORDER = Object.keys(STEM_CATEGORIES) as StemCategory[];
export const CONTROL_STEM_CATEGORIES = new Set<StemCategory>(['click', 'guide', 'cues']);
export const categoryOptions = [
  { value: 'unknown' as StemCategory, label: 'Elegir categoría' },
  ...STEM_CATEGORY_ORDER.filter((key) => key !== 'unknown').map((key) => ({ value: key, label: STEM_CATEGORIES[key].label })),
];

const normalizeName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();

export function readExportedStemCategory(name: string): StemCategory | null {
  const tag = (/^\d+-([a-z-]+)--/i.exec(name)?.[1]
    || /^\d+-([a-z-]+)\.[^.]+$/i.exec(name)?.[1])?.toLowerCase();
  return tag ? STEM_CATEGORY_ORDER.find((key) => STEM_CATEGORIES[key].trackId === tag) || null : null;
}

export function categorizeStemName(name: string): StemCategory {
  const exported = readExportedStemCategory(name);
  if (exported) return exported;
  const normalized = normalizeName(name.replace(/\.[^.]+$/, ''));
  let category: StemCategory = 'unknown';
  let bestScore = 0;
  for (const key of STEM_CATEGORY_ORDER) {
    for (const alias of STEM_CATEGORIES[key].aliases) {
      const match = normalizeName(alias);
      if (!(` ${normalized} `).includes(` ${match} `)) continue;
      const score = match.length + (normalized === match ? 1000 : 0);
      if (score > bestScore) { bestScore = score; category = key; }
    }
  }
  return category;
}

export function buildClassifiedStemFileName(name: string, index: number, category: StemCategory = 'unknown') {
  const base = name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 82) || 'stem';
  const prefix = String(index + 1).padStart(2, '0');
  return category === 'unknown' ? `${prefix}-${base}.m4a`
    : `${prefix}-${STEM_CATEGORIES[category].trackId}.m4a`;
}

// Older uploaders treated exported category tags as part of a custom name.
// Repair only those generated labels; preserve IDs, URLs and deliberate names.
export function cleanExportedStemLabels<T extends { id: string; name: string; sourceFileName?: string }>(tracks: T[]): T[] {
  const counts = new Map<string, number>();
  return tracks.map((track) => {
    const category = readExportedStemCategory(track.sourceFileName || '');
    if (!category || category === 'unknown') return track;
    const label = STEM_CATEGORIES[category].trackName;
    const count = (counts.get(category) || 0) + 1;
    counts.set(category, count);
    if (!track.id.startsWith('custom-') || !/^\d+[ -]/.test(track.name)) return track;
    return { ...track, name: count === 1 ? label : `${label} ${count}` };
  });
}
