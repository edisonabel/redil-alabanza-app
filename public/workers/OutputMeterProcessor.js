// Silent analysis branch after the master gain. Never adds audio to the output.
class OutputMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.peak = 0; this.held = 0; this.frames = 0;
    this.port.onmessage = event => { if (event.data?.type === 'reset') { this.peak = 0; this.held = 0; this.frames = 0; } };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    for (const channel of outputs[0] || []) channel.fill(0);
    for (const channel of input) for (let i = 0; i < channel.length; i++) this.peak = Math.max(this.peak, Math.abs(channel[i]));
    const count = input[0]?.length || 128; this.frames += count;
    if (this.frames >= sampleRate / 20) {
      this.held = Math.max(this.held, this.peak);
      this.port.postMessage({ peak: this.peak, held: this.held, audioTime: (currentFrame + count) / sampleRate });
      this.peak = 0; this.frames = 0;
    }
    return true;
  }
}
registerProcessor('ld-output-meter', OutputMeterProcessor);
