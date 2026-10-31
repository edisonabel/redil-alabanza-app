export type GuideCuePlan = { id: string; boundary: number; name: string; countIn?: boolean };
// «Coro2» se lee como «Coro 2»: el número pegado no cambia la sección.
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();
const aliases: Record<string, string> = {
  chorus: 'coro', verse: 'verso', bridge: 'puente', 'pre chorus': 'pre coro', 'post chorus': 'post coro',
  interlude: 'interludio', ending: 'ending', final: 'ending', outro: 'outro', estribillo: 'refrain',
  exhortacion: 'exhortation', precoro: 'pre coro', postcoro: 'post coro', tag: 'repetir', repetir: 'repetir', 'ultima vez': 'last time', sostener: 'hold', breakdown: 'baja intensidad',
  // Spanish names of the instruction voices (Guide Cues).
  'sube intensidad': 'build', pausa: 'break', corte: 'break', 'entra bateria': 'drums in', 'toda la banda': 'all in',
  'sube tono': 'key change up', 'baja tono': 'key change down', suave: 'softly', 'a capela': 'a capella',
  'final grande': 'big ending', teclado: 'keys', bajo: 'bass', bateria: 'drums', guitarra: 'guitar',
};
export function resolveGuideCue(name: string, available: ReadonlySet<string>): string | null {
  let normalized = normalize(name);
  for (const [from, to] of Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)) {
    if (normalized === from || normalized.startsWith(from + ' ')) { normalized = to + normalized.slice(from.length); break; }
  }
  const key = normalized.replaceAll(' ', '-');
  // «Coro Final» es un coro: dice «Coro» (no hay voz para el apellido).
  const base = key.replace(/-\d+$/, '').replace(/-final$/, '');
  // Todos los coros dicen «Coro», sin número.
  if (base === 'coro' && available.has(base)) return base;
  if (available.has(key)) return key;
  return available.has(base) ? base : null;
}

/** A spoken instruction from the RPP (Sube intensidad, Hits…): a point in song time, never a section. */
export type GuideInstructionCue = { id: string; name: string; startSec: number };

/** Same anticipation as a section name: the voice plus a breath, at least four beats. */
export function guideVoiceLead(voiceSeconds: number, bpm: number): number {
  return Math.max(voiceSeconds + .15, 4 * 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120));
}

/** The first instruction still ahead of `time`; cues are sorted by startSec. */
export function nextGuideInstruction(cues: ReadonlyArray<GuideInstructionCue>, time: number): GuideInstructionCue | null {
  return cues.find(cue => cue.startSec >= time - .05) ?? null;
}

/** Only an explicit destination outside the next occurrence needs a spoken count. */
export function shouldCountGuideJump(sections:ReadonlyArray<{id:string}>,sourceId:string,targetId:string):boolean {
  const source=sections.findIndex(section=>section.id===sourceId);
  return source>=0 && sections[source+1]?.id!==targetId;
}
