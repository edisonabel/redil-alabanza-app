// Shared decorative envelope for the section lane and arrangement editor.
// This is the existing visual pattern, not a PCM peak measurement.
export const SECTION_WAVE_BAR_WIDTH_PX = 6;
export const SECTION_WAVE_BAR_GAP_PX = 4;
export function buildSectionWavePath(seed: number, count: number) {
  const stride = SECTION_WAVE_BAR_WIDTH_PX + SECTION_WAVE_BAR_GAP_PX;
  return {
    path: Array.from({ length: count }, (_, index) => {
      const height = 18 + Math.abs(Math.sin((index + 1) * (seed + 1) * 0.58)) * 72;
      return `M${(index * stride + SECTION_WAVE_BAR_WIDTH_PX / 2).toFixed(1)} 96V${Math.max(4, 96 - height).toFixed(1)}`;
    }).join(' '),
    viewBoxWidth: Math.max(SECTION_WAVE_BAR_WIDTH_PX, count * stride - SECTION_WAVE_BAR_GAP_PX),
  };
}
