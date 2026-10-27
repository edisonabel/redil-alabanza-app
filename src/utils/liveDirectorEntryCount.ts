export type EntryCountPlan = { beats: number; beatSeconds: number; entrySeconds: number | null; recorded: boolean };
export function entryCountPlan(bpm: number, meter?: { numerator: number; denominator: number } | null, unoSeconds?: number | null): EntryCountPlan | null {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) return null;
  const beats = meter?.numerator ?? 4, denominator = meter?.denominator ?? 4;
  if (!Number.isInteger(beats) || beats < 1 || beats > 16 || ![1,2,4,8,16].includes(denominator)) return null;
  const beatSeconds = 60 / bpm * 4 / denominator;
  const entrySeconds = typeof unoSeconds === 'number' && Number.isFinite(unoSeconds) && unoSeconds >= beats * beatSeconds - .02 ? unoSeconds : null;
  return { beats, beatSeconds, entrySeconds, recorded: entrySeconds !== null };
}
export function entryCountAt(plan: EntryCountPlan, time: number): number | 'ENTRA' | null {
  if (plan.entrySeconds === null || !Number.isFinite(time)) return null;
  const start = plan.entrySeconds - plan.beats * plan.beatSeconds;
  if (time < start - .00001 || time >= plan.entrySeconds + Math.min(.45, plan.beatSeconds * .7)) return null;
  if (time >= plan.entrySeconds - .00001) return 'ENTRA';
  return Math.min(plan.beats, Math.floor(Math.max(0, time - start) / plan.beatSeconds + .00001) + 1);
}
export function queueNumberFromKey(key: string): number | null {
  return /^[0-9]$/.test(key) ? key === '0' ? 10 : Number(key) : null;
}
export const queueNumberShortcut = (number: number): string | undefined => number >= 1 && number <= 9 ? String(number) : number === 10 ? '0' : undefined;
