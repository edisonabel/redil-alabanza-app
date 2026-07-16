const AAC_FRAME_SIZE = 1024;
const AAC_SAMPLE_RATES = [
  96_000,
  88_200,
  64_000,
  48_000,
  44_100,
  32_000,
  24_000,
  22_050,
  16_000,
  12_000,
  11_025,
  8_000,
  7_350,
] as const;

type AdtsTrackDefinition = {
  codec: string;
  sampleRate: number;
  channelCount: number;
};

export type AdtsDemuxAppendResult = {
  chunks: EncodedAudioChunk[];
  decoderConfig?: AudioDecoderConfig;
};

/**
 * Incremental ADTS parser for raw AAC streams.
 *
 * Some encoders and object stores leave padding or a partial final ADTS frame
 * at EOF. Once at least one complete frame has been emitted, that tail is safe
 * to discard: it cannot produce a decodable access unit and must not invalidate
 * the otherwise playable stream.
 */
export class AacAdtsDemuxer {
  private readonly trackDefinition: AdtsTrackDefinition;
  private pendingBytes = new Uint8Array(0);
  private emittedDecoderConfig = false;
  private emittedFrameCount = 0;
  private nextTimestampUs = 0;

  constructor(trackDefinition: AdtsTrackDefinition) {
    this.trackDefinition = trackDefinition;
  }

  append(bytes: Uint8Array, endOfStream: boolean, _fileStart: number): AdtsDemuxAppendResult {
    const mergedBytes =
      this.pendingBytes.length > 0
        ? this.concatBytes(this.pendingBytes, bytes)
        : bytes;
    const chunks: EncodedAudioChunk[] = [];
    let decoderConfig: AudioDecoderConfig | undefined;
    let cursor = 0;

    while (cursor + 7 <= mergedBytes.length) {
      if (!this.isSyncWord(mergedBytes, cursor)) {
        cursor += 1;
        continue;
      }

      const protectionAbsent = mergedBytes[cursor + 1] & 0x01;
      const headerLength = protectionAbsent ? 7 : 9;
      const frameLength =
        ((mergedBytes[cursor + 3] & 0x03) << 11) |
        (mergedBytes[cursor + 4] << 3) |
        ((mergedBytes[cursor + 5] & 0xe0) >> 5);

      if (frameLength <= headerLength) {
        cursor += 1;
        continue;
      }

      if (cursor + frameLength > mergedBytes.length) {
        break;
      }

      const samplingFrequencyIndex = (mergedBytes[cursor + 2] & 0x3c) >> 2;
      const frameSampleRate =
        AAC_SAMPLE_RATES[samplingFrequencyIndex] || this.trackDefinition.sampleRate;
      const rawDataBlockCount = (mergedBytes[cursor + 6] & 0x03) + 1;
      const durationUs = Math.round(
        ((AAC_FRAME_SIZE * rawDataBlockCount) / frameSampleRate) * 1_000_000,
      );

      if (!this.emittedDecoderConfig) {
        decoderConfig = this.buildDecoderConfigFromHeader(mergedBytes, cursor);
        this.emittedDecoderConfig = true;
      }

      const accessUnit = mergedBytes.slice(cursor + headerLength, cursor + frameLength);
      chunks.push(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: this.nextTimestampUs,
          duration: durationUs,
          data: accessUnit,
        }),
      );

      this.nextTimestampUs += durationUs;
      this.emittedFrameCount += 1;
      cursor += frameLength;
    }

    this.pendingBytes = cursor < mergedBytes.length ? mergedBytes.slice(cursor) : new Uint8Array(0);

    if (endOfStream) {
      this.finishPendingBytes();
    }

    return { chunks, decoderConfig };
  }

  flush(): AdtsDemuxAppendResult {
    this.finishPendingBytes();
    return { chunks: [] };
  }

  seek(timeInSeconds: number): { nextFileStart: number; seekTimeInSeconds: number } | null {
    if (timeInSeconds > 0.001) {
      return null;
    }

    this.reset();
    return {
      nextFileStart: 0,
      seekTimeInSeconds: 0,
    };
  }

  reset(): void {
    this.pendingBytes = new Uint8Array(0);
    this.emittedDecoderConfig = false;
    this.emittedFrameCount = 0;
    this.nextTimestampUs = 0;
  }

  private finishPendingBytes(): void {
    if (this.pendingBytes.length === 0) {
      return;
    }

    const trailingByteCount = this.pendingBytes.length;
    this.pendingBytes = new Uint8Array(0);

    if (this.emittedFrameCount === 0) {
      throw new Error(
        `No complete ADTS AAC frame was found before end of stream (${trailingByteCount} trailing byte${trailingByteCount === 1 ? '' : 's'}).`,
      );
    }
  }

  private isSyncWord(bytes: Uint8Array, offset: number): boolean {
    return bytes[offset] === 0xff && (bytes[offset + 1] & 0xf6) === 0xf0;
  }

  private buildDecoderConfigFromHeader(bytes: Uint8Array, offset: number): AudioDecoderConfig {
    const audioObjectType = ((bytes[offset + 2] & 0xc0) >> 6) + 1;
    const samplingFrequencyIndex = (bytes[offset + 2] & 0x3c) >> 2;
    const channelConfiguration =
      ((bytes[offset + 2] & 0x01) << 2) | ((bytes[offset + 3] & 0xc0) >> 6);
    const audioSpecificConfig = new Uint8Array(2);
    const sampleRate = AAC_SAMPLE_RATES[samplingFrequencyIndex] || this.trackDefinition.sampleRate;
    const numberOfChannels = channelConfiguration || this.trackDefinition.channelCount;

    audioSpecificConfig[0] = (audioObjectType << 3) | (samplingFrequencyIndex >> 1);
    audioSpecificConfig[1] = ((samplingFrequencyIndex & 0x01) << 7) | (channelConfiguration << 3);

    return {
      codec: this.trackDefinition.codec,
      sampleRate,
      numberOfChannels,
      description: audioSpecificConfig.buffer,
    };
  }

  private concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
    const merged = new Uint8Array(left.length + right.length);

    merged.set(left, 0);
    merged.set(right, left.length);
    return merged;
  }
}
