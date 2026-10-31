import { resolveGuideCue } from './liveDirectorGuideCues';
import { REAPER_INSTRUCTION_PREFIX } from './reaperPreparation.js';

// Names offered by the REAPER helper. The voices come from the guide manifest;
// this file only decides order and the Spanish marker label, and every label is
// checked against resolveGuideCue so a marker always reaches its voice.
// Sections define the song's structure; instructions are one-off spoken cues.
export type GuideCueKind = 'section' | 'instruction';
export type GuideManifestAsset = { key: string; label: string; kind?: GuideCueKind | 'count' };
export type GuideSectionType = { key: string; label: string; numbered: boolean; kind: GuideCueKind };

const ORDER: Record<GuideCueKind, string[]> = {
  section: ['intro', 'verso', 'pre-coro', 'coro', 'post-coro', 'puente', 'interludio', 'instrumental', 'solo', 'rap', 'vamp',
    'baja-intensidad', 'refrain', 'exhortation', 'repetir', 'outro', 'ending'],
  instruction: ['build', 'break', 'hits', 'drums-in', 'all-in', 'key-change-up', 'key-change-down', 'softly', 'a-capella',
    'swell', 'big-ending', 'hold', 'last-time', 'keys', 'bass', 'drums', 'guitar'],
};
const LABELS: Record<string, string> = {
  'pre-coro': 'Pre-coro', 'post-coro': 'Post-coro', 'baja-intensidad': 'Baja intensidad', refrain: 'Estribillo',
  exhortation: 'Exhortación', ending: 'Final', build: 'Sube intensidad', break: 'Pausa', 'drums-in': 'Entra batería',
  'all-in': 'Toda la banda', 'key-change-up': 'Sube tono', 'key-change-down': 'Baja tono', softly: 'Suave', 'a-capella': 'A capella',
  hits: 'Hits', swell: 'Swell', 'big-ending': 'Final grande', hold: 'Sostener', 'last-time': 'Última vez', keys: 'Teclado', bass: 'Bajo', drums: 'Batería', guitar: 'Guitarra',
};

/** Instruction buttons for the live controls: same order and wording as the REAPER helper. */
export const GUIDE_INSTRUCTION_OPTIONS = ORDER.instruction.map(key => ({ key, label: LABELS[key] || key }));

export function buildGuideSectionCatalog(manifest: ReadonlyArray<GuideManifestAsset>): GuideSectionType[] {
  const keys = new Set(manifest.map(asset => asset.key));
  // Count-in digits and numbered voices (coro-2) are variants, not menu entries.
  const bases = manifest.filter(asset => asset.kind !== 'count' && !/^\d+$/.test(asset.key)
    && !(/-\d+$/.test(asset.key) && keys.has(asset.key.replace(/-\d+$/, ''))));
  const kindOf = (asset: GuideManifestAsset): GuideCueKind => asset.kind === 'instruction' ? 'instruction' : 'section';
  // Voices added to the manifest later go to the end of their group automatically.
  const rank = (asset: GuideManifestAsset) => {
    const index = ORDER[kindOf(asset)].indexOf(asset.key);
    return (kindOf(asset) === 'instruction' ? 1000 : 0) + (index >= 0 ? index : 500);
  };
  const types = [...bases].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'es')).map(asset => {
    const type: GuideSectionType = {
      key: asset.key, label: LABELS[asset.key] || asset.label, numbered: keys.has(`${asset.key}-1`), kind: kindOf(asset),
    };
    if (resolveGuideCue(type.label, keys) !== type.key) throw new Error(`“${type.label}” no llega a la voz ${type.key}.`);
    return type;
  });
  // Tag: la voz en español de la biblioteca es «Repetir (Tag)»; en el menú va con el nombre que usa la banda.
  const repeat = types.findIndex(type => type.key === 'repetir');
  if (repeat >= 0 && resolveGuideCue('Tag', keys) === 'repetir') types.splice(repeat, 0, { key: 'repetir', label: 'Tag', numbered: true, kind: 'section' });
  return types;
}

export const REAPER_CATALOG_BEGIN = '-- BEGIN ALABANZA_SECCIONES';
export const REAPER_CATALOG_END = '-- END ALABANZA_SECCIONES';
const luaString = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
export function renderReaperSectionCatalogLua(catalog: ReadonlyArray<GuideSectionType>): string {
  const table = (name: string, kind: GuideCueKind) => [`local ${name} = {`,
    ...catalog.filter(type => type.kind === kind)
      .map(type => `  {label=${luaString(type.label)}, cue=${luaString(type.key)}, numbered=${type.numbered}},`),
    '}'];
  return [
    `${REAPER_CATALOG_BEGIN}: generado desde public/audio/guide-es/manifest.json con`,
    '-- `npm run reaper:sections`. No editar a mano; test:reaper-sections detecta desajustes.',
    ...table('SECTION_TYPES', 'section'),
    ...table('INSTRUCTION_TYPES', 'instruction'),
    `local INSTRUCTION_PREFIX = ${luaString(REAPER_INSTRUCTION_PREFIX)}`,
    REAPER_CATALOG_END,
  ].join('\n');
}

/** Replaces the generated block inside the helper source; throws if the markers are missing. */
export function replaceReaperSectionCatalog(source: string, block: string): string {
  const start = source.indexOf(REAPER_CATALOG_BEGIN), end = source.indexOf(REAPER_CATALOG_END);
  if (start < 0 || end < start) throw new Error('El asistente no contiene el bloque ALABANZA_SECCIONES.');
  return source.slice(0, start) + block + source.slice(end + REAPER_CATALOG_END.length);
}
