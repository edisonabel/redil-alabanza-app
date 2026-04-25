const coverArtCache = new Map<string, string | null>();

export const extractCoverArtFromMp3 = async (mp3Url: string): Promise<string | null> => {
  if (!mp3Url) {
    return null;
  }

  if (coverArtCache.has(mp3Url)) {
    return coverArtCache.get(mp3Url) || null;
  }

  try {
    const response = await fetch(mp3Url, {
      headers: { Range: 'bytes=0-524287' },
      mode: 'cors',
    });

    if (!response.ok) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);

    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const majorVersion = view.getUint8(3);
    const tagSize =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);

    const tagEnd = Math.min(10 + tagSize, buffer.byteLength);
    let offset = 10;
    const flags = view.getUint8(5);

    if (flags & 0x40 && offset + 4 < tagEnd) {
      offset += view.getUint32(offset);
    }

    while (offset + 10 < tagEnd) {
      const frameId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
      );

      const frameSize =
        majorVersion >= 4
          ? ((view.getUint8(offset + 4) & 0x7f) << 21) |
          ((view.getUint8(offset + 5) & 0x7f) << 14) |
          ((view.getUint8(offset + 6) & 0x7f) << 7) |
          (view.getUint8(offset + 7) & 0x7f)
          : view.getUint32(offset + 4);

      if (frameSize <= 0 || frameSize > tagEnd - offset) {
        break;
      }

      if (frameId === 'APIC') {
        const frameData = new Uint8Array(buffer, offset + 10, frameSize);
        const encoding = frameData[0];
        let position = 1;
        let mimeType = '';

        while (position < frameData.length && frameData[position] !== 0) {
          mimeType += String.fromCharCode(frameData[position]);
          position += 1;
        }

        position += 1;
        position += 1;

        if (encoding === 0 || encoding === 3) {
          while (position < frameData.length && frameData[position] !== 0) {
            position += 1;
          }
          position += 1;
        } else {
          while (
            position + 1 < frameData.length &&
            !(frameData[position] === 0 && frameData[position + 1] === 0)
          ) {
            position += 2;
          }
          position += 2;
        }

        const imageData = frameData.slice(position);
        if (imageData.length < 100) {
          break;
        }

        const blob = new Blob([imageData], { type: mimeType || 'image/jpeg' });
        const blobUrl = URL.createObjectURL(blob);
        coverArtCache.set(mp3Url, blobUrl);
        return blobUrl;
      }

      offset += 10 + frameSize;
    }

    coverArtCache.set(mp3Url, null);
    return null;
  } catch (error) {
    console.warn('[mp3CoverArt] Could not extract cover art.', error);
    coverArtCache.set(mp3Url, null);
    return null;
  }
};
