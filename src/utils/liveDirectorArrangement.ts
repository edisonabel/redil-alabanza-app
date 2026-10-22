import type { LiveDirectorSectionVisual } from './liveDirectorSongSession';
export type ArrangementEntry = { id: string; sectionId: string };
export const MAX_ARRANGEMENT_SECTIONS = 80;
export function originalArrangement(sections: LiveDirectorSectionVisual[]): ArrangementEntry[] {
  return sections.map(section => ({ id: section.id, sectionId: section.id }));
}
export function resolveArrangement(sections: LiveDirectorSectionVisual[], entries: ArrangementEntry[]): LiveDirectorSectionVisual[] {
  const byId = new Map(sections.map(section => [section.id, section]));
  const seen = new Set<string>();
  if (!entries.length || entries.length > MAX_ARRANGEMENT_SECTIONS) throw new Error('El arreglo debe tener entre 1 y 80 secciones.');
  return entries.map(entry => {
    const source = byId.get(entry.sectionId);
    if (!source || seen.has(entry.id)) throw new Error('El arreglo contiene una sección no disponible.');
    seen.add(entry.id);
    return { ...source, id: entry.id };
  });
}
export function arrangementDuration(sections: LiveDirectorSectionVisual[]) {
  return sections.reduce((total, section) => total + section.endTime - section.startTime, 0);
}

export function arrangementTimeline(sections: LiveDirectorSectionVisual[]) {
  let cursor = 0;
  return sections.map(section => {
    const entry = { ...section, startTime: cursor, endTime: cursor + section.endTime - section.startTime };
    cursor = entry.endTime; return entry;
  });
}
export function arrangementElapsed(sections: LiveDirectorSectionVisual[], index: number, sourceTime: number) {
  let elapsed = 0;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (i === index) return elapsed + Math.max(0, Math.min(section.endTime - section.startTime, sourceTime - section.startTime));
    elapsed += section.endTime - section.startTime;
  }
  return elapsed;
}
export function arrangementSourceAt(sections: LiveDirectorSectionVisual[], time: number) {
  let elapsed = 0;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i], duration = section.endTime - section.startTime;
    if (time < elapsed + duration || i === sections.length - 1) return { id: section.id, time: Math.min(section.endTime - .001, section.startTime + Math.max(0, time - elapsed)) };
    elapsed += duration;
  }
  return null;
}
