export type SectionIdentityInput = { name?: string };

export type MarkerIdentityInput = {
  sectionName?: string;
  sectionIndex?: number;
  sectionOccurrence?: number;
  sectionKey?: string;
};

export const normalizeSectionIdentity = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const resolveSectionMarkersByIdentity = <T extends MarkerIdentityInput>(
  sections: SectionIdentityInput[] = [],
  markers: T[] = [],
): Array<T | undefined> => {
  const safeSections = Array.isArray(sections) ? sections : [];
  const safeMarkers = Array.isArray(markers) ? markers : [];
  const sectionOccurrences = new Map<string, number>();
  const unusedMarkerIndexes = new Set(safeMarkers.map((_, index) => index));

  return safeSections.map((section, sectionIndex) => {
    const normalizedName = normalizeSectionIdentity(section?.name);
    const occurrence = (sectionOccurrences.get(normalizedName) || 0) + 1;
    sectionOccurrences.set(normalizedName, occurrence);
    const sectionKey = `${normalizedName || `seccion-${sectionIndex + 1}`}__${occurrence}`;
    const findUnusedMarkerIndex = (predicate: (marker: T, index: number) => boolean) => (
      safeMarkers.findIndex((marker, markerIndex) => (
        unusedMarkerIndexes.has(markerIndex) && predicate(marker, markerIndex)
      ))
    );

    let markerIndex = findUnusedMarkerIndex((marker) => (
      String(marker?.sectionKey || '').trim().toLowerCase() === sectionKey
    ));
    if (markerIndex < 0) {
      markerIndex = findUnusedMarkerIndex((marker) => Number(marker?.sectionIndex) === sectionIndex);
    }
    if (markerIndex < 0) {
      markerIndex = findUnusedMarkerIndex((marker) => (
        normalizeSectionIdentity(marker?.sectionName || '') === normalizedName
        && Number(marker?.sectionOccurrence) === occurrence
      ));
    }
    if (markerIndex < 0) {
      markerIndex = findUnusedMarkerIndex((marker) => (
        normalizeSectionIdentity(marker?.sectionName || '') === normalizedName
      ));
    }
    if (markerIndex < 0 && unusedMarkerIndexes.has(sectionIndex)) {
      markerIndex = sectionIndex;
    }
    if (markerIndex < 0) return undefined;

    unusedMarkerIndexes.delete(markerIndex);
    return safeMarkers[markerIndex];
  });
};
