import { parseChordProSemantic } from './parseChordProSemantic';
import { resolveSongSheetSemanticBlocks } from './resolveSongSheetSemanticBlocks';
import type { ArrangementEntry } from './liveDirectorArrangement';

type SectionMarker = {
  id?: string;
  sectionName?: string;
  name?: string;
  sectionIndex?: number;
};

const normalizeLabel = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function serializeLine(line: { lyrics?: string; chords?: Array<{ position?: number; chord?: string }> }) {
  const lyrics = String(line?.lyrics || '');
  const chords = (Array.isArray(line?.chords) ? line.chords : [])
    .map((item) => ({
      position: Math.max(0, Math.min(lyrics.length, Math.trunc(Number(item?.position) || 0))),
      chord: String(item?.chord || '').trim(),
    }))
    .filter((item) => item.chord)
    .sort((left, right) => left.position - right.position);
  if (!chords.length) return lyrics;

  const chordsAtPosition = new Map<number, string[]>();
  chords.forEach(({ position, chord }) => {
    const group = chordsAtPosition.get(position) || [];
    group.push(chord);
    chordsAtPosition.set(position, group);
  });

  let output = '';
  for (let position = 0; position <= lyrics.length; position += 1) {
    for (const chord of chordsAtPosition.get(position) || []) output += `[${chord}]`;
    if (position < lyrics.length) output += lyrics[position];
  }
  return output;
}

/** Reorders and repeats the event's sections in an export without changing the song record. */
export function applyChordProEventArrangement(
  chordProText: string,
  rawMarkers: SectionMarker[] = [],
  entries: ArrangementEntry[] | null | undefined,
) {
  const source = String(chordProText || '');
  if (!source.trim() || !Array.isArray(entries) || entries.length === 0) return source;

  const nodes = parseChordProSemantic(source);
  const blocks = resolveSongSheetSemanticBlocks(nodes, { mode: 'complete' });
  const markers = Array.isArray(rawMarkers) ? rawMarkers : [];
  if (blocks.length === 0 || markers.length === 0) return source;

  const markerById = new Map<string, SectionMarker>();
  markers.forEach((marker, index) => {
    const name = String(marker?.sectionName || marker?.name || `Section ${index + 1}`);
    const fallbackId = `${normalizeLabel(name).replace(/\s+/g, '-') || 'song'}-${index + 1}`;
    markerById.set(String(marker?.id || fallbackId), marker);
  });
  const sectionBlocks = blocks.filter((block) => block.semanticNodeType === 'section' || block.semanticNodeType === 'reference');
  const sectionsByLabel = new Map<string, number[]>();
  sectionBlocks.forEach((block, index) => {
    const key = normalizeLabel(block.fullTitle);
    const candidates = sectionsByLabel.get(key) || [];
    candidates.push(index);
    sectionsByLabel.set(key, candidates);
  });
  const usedByLabel = new Map<string, number>();

  const arrangedBlocks = entries.map((entry) => {
    const marker = markerById.get(String(entry?.sectionId || ''));
    if (!marker) return null;
    const sectionIndex = Number(marker.sectionIndex);
    let blockIndex = Number.isInteger(sectionIndex) ? sectionIndex : -1;
    const markerLabel = normalizeLabel(marker.sectionName || marker.name);

    if (blockIndex < 0 || blockIndex >= sectionBlocks.length) {
      const matches = sectionsByLabel.get(markerLabel) || [];
      const occurrence = usedByLabel.get(markerLabel) || 0;
      blockIndex = matches[occurrence] ?? matches[0] ?? -1;
      usedByLabel.set(markerLabel, occurrence + 1);
    }

    const block = sectionBlocks[blockIndex];
    if (!block) return null;
    return { entry, block };
  });

  // If a marker cannot be mapped confidently, keep the source order to avoid a misleading chart.
  if (arrangedBlocks.some((item) => item == null)) return source;

  const validArrangedBlocks = arrangedBlocks.filter((item): item is NonNullable<typeof item> => item !== null);
  return validArrangedBlocks.map(({ block }) => {
    const title = String(block.fullTitle || 'Sección').trim();
    const lines = (block.lines || []).map(serializeLine);
    return [`[${title}]`, ...lines].join('\n');
  }).join('\n\n');
}
