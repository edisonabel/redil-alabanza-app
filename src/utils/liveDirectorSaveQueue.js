/** One request per song; edits replace queued snapshots instead of building a backlog. */
export function createLiveDirectorSaveQueue({ save, signature, delayMs = 800 }) {
  const slots = new Map();
  const slotFor = key => {
    if (!slots.has(key)) slots.set(key, { pending: null, active: null, timer: null, confirmed: '' });
    return slots.get(key);
  };
  const run = async key => {
    const slot = slotFor(key);
    clearTimeout(slot.timer); slot.timer = null;
    if (slot.active || !slot.pending) return;
    const job = slot.pending; slot.pending = null; slot.active = job;
    try {
      const result = await save(key, job.value);
      slot.confirmed = job.signature;
      job.waiters.forEach(({ resolve }) => resolve(result));
    } catch (error) {
      job.waiters.forEach(({ reject }) => reject(error));
    } finally {
      slot.active = null;
      if (slot.pending) void run(key);
    }
  };
  return {
    enqueue(key, value, immediate = false) {
      const slot = slotFor(key), nextSignature = signature(value);
      // A repeated recovery/flush shares the existing request.
      if (!slot.pending && slot.active?.signature === nextSignature) {
        return new Promise((resolve, reject) => slot.active.waiters.push({ resolve, reject }));
      }
      if (!slot.active && !slot.pending && slot.confirmed === nextSignature) return Promise.resolve(value);
      const promise = new Promise((resolve, reject) => {
        const waiters = slot.pending?.waiters ?? [];
        waiters.push({ resolve, reject });
        slot.pending = { value, signature: nextSignature, waiters };
      });
      clearTimeout(slot.timer);
      slot.timer = setTimeout(() => void run(key), immediate ? 0 : delayMs);
      return promise;
    },
    flush(key) { if (key) void run(key); else slots.forEach((_, id) => void run(id)); },
    isPending(key) { const slot = slots.get(key); return Boolean(slot?.pending || slot?.active); },
  };
}
