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
    this.scheduled.clear(); this.anchor = null;
  }
  /** `time`: segundo de la canción ahora mismo. Sin tocar o sin grilla, calla. */
  update(time: number, playing: boolean, grid: VirtualClickGrid | null) {
    this.syncMix();
    if (!playing || !grid || !(grid.bpm > 0) || !Number.isFinite(time)) { this.stop(); return; }
    const now = this.graph.context.currentTime, anchor = now - time;
    // Un salto o una repetición mueve el reloj de la canción: lo agendado ya no sirve.
    if (this.anchor !== null && Math.abs(anchor - this.anchor) > .02) this.stop();
    this.anchor = anchor;
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
