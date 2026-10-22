export function samplePeakDb(peak: number): number { return peak > 0 ? 20 * Math.log10(peak) : -Infinity; }
// Fixed attenuation learns louder observed peaks; never boosts or raises a level.
export function nextPeakAttenuation(db: number, musicPeak: number, master: number, targetDb = -6): number {
  if (![db, musicPeak, master, targetDb].every(Number.isFinite) || musicPeak <= 0 || master <= 0 || master > 1) return db;
  const excess = samplePeakDb(musicPeak * master) - targetDb;
  if (excess <= .15) return db;
  return Math.max(-24, Math.min(db, Math.floor((db - excess) * 10) / 10));
}
