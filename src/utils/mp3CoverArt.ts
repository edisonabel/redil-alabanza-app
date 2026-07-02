const coverArtCache = new Map<string, string | null>();

export const extractCoverArtFromMp3 = async (mp3Url: string): Promise<string | null> => {
  if (!mp3Url) {
    return null;
  }

  if (coverArtCache.has(mp3Url)) {
    return coverArtCache.get(mp3Url) || null;
  }

  try {
    const coverArtUrl = `/api/mp3-cover-art?v=2&src=${encodeURIComponent(mp3Url)}`;
    const response = await fetch(coverArtUrl, {
      cache: 'force-cache',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const blob = await response.blob();
    if (blob.size < 100) {
      coverArtCache.set(mp3Url, null);
      return null;
    }

    const blobUrl = URL.createObjectURL(blob);
    coverArtCache.set(mp3Url, blobUrl);
    return blobUrl;
  } catch (error) {
    console.warn('[mp3CoverArt] Could not extract cover art.', error);
    coverArtCache.set(mp3Url, null);
    return null;
  }
};
