/**
 * Lightweight 32-bit float WAV encoder.
 *
 * Used as the bridge format between the Rubber Band pitch shift output (a
 * Web Audio `AudioBuffer`) and FFmpeg, which needs a self-describing audio
 * container as input. We encode as 32-bit IEEE float (WAVE format 3) to
 * preserve every bit of the pitch-shifted result without an extra
 * quantisation step before FFmpeg re-encodes to AAC.
 *
 * The output is a single contiguous `Uint8Array` ready to be passed to
 * `ffmpeg.writeFile(...)`.
 */

const RIFF_HEADER_SIZE = 44;

const writeAscii = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
};

export const encodeAudioBufferToFloat32Wav = (audioBuffer: AudioBuffer): Uint8Array => {
  const numChannels = audioBuffer.numberOfChannels;
  const numFrames = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 32;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(RIFF_HEADER_SIZE + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  // fmt sub-chunk (WAVE_FORMAT_IEEE_FLOAT = 3)
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM/float fmt size
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels into the data section. We grab each channel once
  // (getChannelData is cheap but not free) and write frame by frame.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c += 1) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  let offset = RIFF_HEADER_SIZE;
  for (let frame = 0; frame < numFrames; frame += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      view.setFloat32(offset, channelData[channel][frame], true);
      offset += 4;
    }
  }

  return new Uint8Array(buffer);
};
