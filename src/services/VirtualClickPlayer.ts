import type { GuideAudioGraph } from './DynamicGuidePlayer';

// Click digital para canciones sin pista Click: cada pulso se agenda en el reloj del audio a partir del tiempo
// del motor (contexto − inicio), así cae exacto aunque el temporizador de la página se atrase. El primer pulso
// de cada compás va acentuado.
const LOOKAHEAD_SECONDS = .25, BLIP_SECONDS = .035;
export type VirtualClickGrid = { bpm: number; originSeconds: number; numerator: number };

function blip(context: BaseAudioContext, hertz: number, peak: number) {
  const length = Math.round(context.sampleRate * BLIP_SECONDS), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.sin(2 * Math.PI * hertz * i / context.sampleRate) * peak * Math.exp(-i / (length / 5));
  return buffer;
}

export class VirtualClickPlayer {
  private gain: GainNode; private left: GainNode; private right: GainNode; private merger: ChannelMergerNode;
  private accent: AudioBuffer; private beat: AudioBuffer;
  private scheduled = new Map<number, AudioBufferSourceNode>();
  private anchor: number | null = null;
  private lastReading: { time: number; wall: number } | null = null;
  private drift = 0;
  constructor(private graph: Pick<GuideAudioGraph, 'context' | 'destination' | 'readState'>) {
    const { context } = graph;
    this.gain = context.createGain(); this.left = context.createGain(); this.right = context.createGain();
    this.merger = context.createChannelMerger(2);
    this.gain.connect(this.left).connect(this.merger, 0, 0); this.gain.connect(this.right).connect(this.merger, 0, 1);
    this.merger.connect(graph.destination);
    this.accent = blip(context, 1760, .9); this.beat = blip(context, 1175, .7);
  }
  private syncMix() {
    const { context } = this.graph, state = this.graph.readState();
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(2, state.gain)), context.currentTime, .005);
    this.left.gain.value = state.route === 'right' ? 0 : 1;
    this.right.gain.value = state.route === 'left' ? 0 : 1;
  }
  stop() {
    for (const source of this.scheduled.values()) { try { source.stop(); } catch { /* ya terminó */ } source.disconnect(); }
    this.scheduled.clear(); this.anchor = null; this.lastReading = null; this.drift = 0;
  }
  /** `time`: segundo de la canción ahora mismo. Sin tocar o sin grilla, calla. */
  update(time: number, playing: boolean, grid: VirtualClickGrid | null) {
    this.syncMix();
    if (!playing || !grid || !(grid.bpm > 0) || !Number.isFinite(time)) { this.stop(); return; }
    // Al arrancar o saltar, la primera lectura del tiempo puede venir corrida: se agenda solo cuando dos
    // lecturas seguidas avanzan al paso del reloj real.
    const wall = performance.now() / 1000, previous = this.lastReading;
    this.lastReading = { time, wall };
    if (!previous || Math.abs((time - previous.time) - (wall - previous.wall)) > .015) return;
    // La referencia del reloj queda fija mientras la canción avanza pareja (la lectura del tiempo llega por
    // bloques de audio y movería cada pulso unos milisegundos). Un salto (otra sección, una repetición) la
    // renueva al instante; una diferencia chica solo si se mantiene varias lecturas (no por una lectura suelta).
    const measured = this.graph.context.currentTime - time;
    const deviation = this.anchor === null ? 0 : Math.abs(measured - this.anchor);
    this.drift = deviation > .02 ? this.drift + 1 : 0;
    if (deviation > .25 || this.drift >= 4) { this.stop(); this.lastReading = { time, wall }; }
    if (this.anchor === null) this.anchor = measured;
    const anchor = this.anchor;
    const spacing = 60 / grid.bpm, numerator = Math.max(1, Math.round(grid.numerator) || 4);
    const first = Math.ceil((time - grid.originSeconds) / spacing - 1e-6), last = Math.floor((time + LOOKAHEAD_SECONDS - grid.originSeconds) / spacing);
    for (let index = first; index <= last; index += 1) {
      const beatTime = grid.originSeconds + index * spacing;
      if (beatTime < 0 || this.scheduled.has(index)) continue;
      const source = this.graph.context.createBufferSource();
      source.buffer = ((index % numerator) + numerator) % numerator === 0 ? this.accent : this.beat;
      source.connect(this.gain);
      source.onended = () => { source.disconnect(); if (this.scheduled.get(index) === source) this.scheduled.delete(index); };
      source.start(anchor + beatTime);
      this.scheduled.set(index, source);
    }
  }
  dispose() { this.stop(); this.merger.disconnect(); this.gain.disconnect(); }
}
