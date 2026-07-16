const AAC_SAMPLE_RATE_INDEXES = new Map<number, number>([
  [96_000, 0],
  [88_200, 1],
  [64_000, 2],
  [48_000, 3],
  [44_100, 4],
  [32_000, 5],
  [24_000, 6],
  [22_050, 7],
  [16_000, 8],
  [12_000, 9],
  [11_025, 10],
  [8_000, 11],
  [7_350, 12],
]);

export type AudioDecoderVariant = {
  label: string;
  config: AudioDecoderConfig;
  wrapAdts: boolean;
};

const toUint8View = (source: AllowSharedBufferSource): Uint8Array =>
  ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);

const copyBufferSource = (source?: AllowSharedBufferSource): ArrayBuffer | undefined => {
  if (!source) {
    return undefined;
  }

  const view = toUint8View(source);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
};

const getAacAudioSpecificConfig = (sampleRate: number, channelCount: number): ArrayBuffer => {
  const sampleRateKey = Math.round(Number(sampleRate) || 48_000);
  const sampleRateIndex = AAC_SAMPLE_RATE_INDEXES.get(sampleRateKey) ?? 3;
  const audioObjectType = 2;
  const safeChannelCount = Math.max(1, Math.min(7, Math.round(Number(channelCount) || 1)));
  const config = new Uint8Array(2);

  config[0] = (audioObjectType << 3) | ((sampleRateIndex & 0x0e) >> 1);
  config[1] = ((sampleRateIndex & 0x01) << 7) | (safeChannelCount << 3);
  return config.buffer;
};

const descriptionsMatch = (
  left?: AllowSharedBufferSource,
  right?: AllowSharedBufferSource,
): boolean => {
  if (!left && !right) return true;
  if (!left || !right) return false;

  const leftView = toUint8View(left);
  const rightView = toUint8View(right);

  if (leftView.byteLength !== rightView.byteLength) return false;

  for (let index = 0; index < leftView.byteLength; index += 1) {
    if (leftView[index] !== rightView[index]) return false;
  }
  return true;
};

const cloneDecoderConfig = (
  config: AudioDecoderConfig,
  description?: AllowSharedBufferSource,
  channelCount = config.numberOfChannels,
): AudioDecoderConfig => {
  const copiedDescription = copyBufferSource(description);
  return {
    codec: config.codec,
    sampleRate: config.sampleRate,
    numberOfChannels: Math.max(1, Math.min(7, Math.round(Number(channelCount) || 1))),
    ...(copiedDescription ? { description: copiedDescription } : {}),
  };
};

export const buildAudioDecoderVariants = (
  config: AudioDecoderConfig,
): AudioDecoderVariant[] => {
  const variants: AudioDecoderVariant[] = [];
  const addVariant = (
    label: string,
    description?: AllowSharedBufferSource,
    options?: { wrapAdts?: boolean; channelCount?: number },
  ) => {
    const wrapAdts = options?.wrapAdts === true;
    const numberOfChannels = Math.max(
      1,
      Math.min(7, Math.round(Number(options?.channelCount ?? config.numberOfChannels) || 1)),
    );
    if (
      variants.some(
        (variant) =>
          variant.wrapAdts === wrapAdts &&
          variant.config.numberOfChannels === numberOfChannels &&
          descriptionsMatch(variant.config.description, description),
      )
    ) {
      return;
    }
    variants.push({
      label,
      config: cloneDecoderConfig(config, description, numberOfChannels),
      wrapAdts,
    });
  };

  const originalDescription = copyBufferSource(config.description);
  const generatedDescription = getAacAudioSpecificConfig(
    config.sampleRate,
    config.numberOfChannels,
  );
  const monoDescription = getAacAudioSpecificConfig(config.sampleRate, 1);

  if (/^mp4a\.40\.2$/i.test(String(config.codec || ''))) {
    addVariant('generated-aac-lc-description', generatedDescription);
    addVariant(
      originalDescription ? 'original-description' : 'no-description',
      originalDescription,
    );
    addVariant('adts-no-description', undefined, { wrapAdts: true });
    if (Math.round(Number(config.numberOfChannels) || 1) > 1) {
      addVariant('force-mono-description', monoDescription, { channelCount: 1 });
      addVariant('force-mono-adts', undefined, { wrapAdts: true, channelCount: 1 });
    }
  } else {
    addVariant(
      originalDescription ? 'original-description' : 'no-description',
      originalDescription,
    );
  }

  return variants;
};

const copyEncodedChunkData = (chunk: EncodedAudioChunk): Uint8Array => {
  const copy = new Uint8Array(chunk.byteLength);
  chunk.copyTo(copy);
  return copy;
};

const wrapAacAccessUnitWithAdts = (
  payload: Uint8Array,
  sampleRate: number,
  channelCount: number,
): Uint8Array => {
  const sampleRateKey = Math.round(Number(sampleRate) || 48_000);
  const sampleRateIndex = AAC_SAMPLE_RATE_INDEXES.get(sampleRateKey) ?? 3;
  const safeChannelCount = Math.max(1, Math.min(7, Math.round(Number(channelCount) || 1)));
  const profile = 1;
  const frameLength = payload.byteLength + 7;
  const output = new Uint8Array(frameLength);

  output[0] = 0xff;
  output[1] = 0xf1;
  output[2] =
    ((profile & 0x03) << 6) |
    ((sampleRateIndex & 0x0f) << 2) |
    ((safeChannelCount >> 2) & 0x01);
  output[3] = ((safeChannelCount & 0x03) << 6) | ((frameLength >> 11) & 0x03);
  output[4] = (frameLength >> 3) & 0xff;
  output[5] = ((frameLength & 0x07) << 5) | 0x1f;
  output[6] = 0xfc;
  output.set(payload, 7);
  return output;
};

export const createChunkForDecoderVariant = (
  chunk: EncodedAudioChunk,
  variant?: AudioDecoderVariant,
): EncodedAudioChunk => {
  if (!variant?.wrapAdts) {
    return chunk;
  }

  return new EncodedAudioChunk({
    type: chunk.type,
    timestamp: chunk.timestamp,
    duration: chunk.duration ?? undefined,
    data: wrapAacAccessUnitWithAdts(
      copyEncodedChunkData(chunk),
      variant.config.sampleRate,
      variant.config.numberOfChannels,
    ),
  });
};

export const containsLavcMarker = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 4) return false;

  for (let index = 0; index <= bytes.byteLength - 4; index += 1) {
    if (
      bytes[index] === 0x4c &&
      bytes[index + 1] === 0x61 &&
      bytes[index + 2] === 0x76 &&
      bytes[index + 3] === 0x63
    ) {
      return true;
    }
  }
  return false;
};

export const probeAudioDecoderVariant = async (
  config: AudioDecoderConfig,
  chunks: EncodedAudioChunk[],
): Promise<AudioDecoderVariant> => {
  if (chunks.length === 0) {
    throw new Error('Cannot probe an audio decoder without encoded AAC samples.');
  }

  const variants = buildAudioDecoderVariants(config);
  let lastError: unknown = null;

  for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
    const variant = variants[variantIndex];
    let decoder: AudioDecoder | null = null;
    let decoderError: DOMException | null = null;
    let outputCount = 0;

    try {
      const support = await AudioDecoder.isConfigSupported(variant.config);
      if (!support.supported) {
        continue;
      }

      decoder = new AudioDecoder({
        output: (audioData) => {
          outputCount += 1;
          audioData.close();
        },
        error: (error) => {
          decoderError = error;
        },
      });
      decoder.configure(variant.config);

      const probeChunkCount = Math.min(4, chunks.length);
      for (let chunkIndex = 0; chunkIndex < probeChunkCount; chunkIndex += 1) {
        decoder.decode(createChunkForDecoderVariant(chunks[chunkIndex], variant));
      }
      await decoder.flush();

      if (decoderError) {
        throw decoderError;
      }
      if (outputCount === 0) {
        throw new Error(`Decoder variant "${variant.label}" produced no PCM output.`);
      }
      return variant;
    } catch (error) {
      lastError = error;
    } finally {
      if (decoder && decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch {
          // The failed WebKit decoder can already be closing itself.
        }
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || 'unknown');
  throw new Error(`No AAC decoder variant produced PCM (${detail}).`);
};
