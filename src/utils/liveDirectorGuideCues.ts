export type GuideCuePlan = { id: string; boundary: number; name: string };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const aliases: Record<string, string> = {
  chorus: 'coro', verse: 'verso', bridge: 'puente', 'pre chorus': 'pre coro', 'post chorus': 'post coro',
  interlude: 'interludio', ending: 'ending', final: 'ending', outro: 'outro', estribillo: 'refrain',
  exhortacion: 'exhortation', precoro: 'pre coro', postcoro: 'post coro', tag: 'repetir', repetir: 'repetir', 'ultima vez': 'last time', sostener: 'hold', breakdown: 'baja intensidad',
};
export function resolveGuideCue(name: string, available: ReadonlySet<string>): string | null {
  let normalized = normalize(name);
  for (const [from, to] of Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)) {
    if (normalized === from || normalized.startsWith(from + ' ')) { normalized = to + normalized.slice(from.length); break; }
  }
  const key = normalized.replaceAll(' ', '-');
  if (available.has(key)) return key;
  const base = key.replace(/-\d+$/, '');
  return available.has(base) ? base : null;
}
