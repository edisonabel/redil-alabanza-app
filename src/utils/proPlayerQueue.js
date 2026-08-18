export const PRO_PLAYER_REPEAT_MODES = Object.freeze({
  OFF: 'off',
  ALL: 'all',
  ONE: 'one',
});

/** @typedef {'off' | 'all' | 'one'} ProPlayerRepeatMode */

/**
 * @param {string} value
 * @returns {ProPlayerRepeatMode}
 */
export const normalizeProPlayerRepeatMode = (value = '') => (
  value === PRO_PLAYER_REPEAT_MODES.ALL || value === PRO_PLAYER_REPEAT_MODES.ONE
    ? value
    : PRO_PLAYER_REPEAT_MODES.OFF
);

/**
 * @param {ProPlayerRepeatMode | string} currentMode
 * @param {boolean} hasPlaylist
 */
export const getNextProPlayerRepeatMode = (currentMode = '', hasPlaylist = false) => {
  const mode = normalizeProPlayerRepeatMode(currentMode);

  if (!hasPlaylist) {
    return mode === PRO_PLAYER_REPEAT_MODES.ONE
      ? PRO_PLAYER_REPEAT_MODES.OFF
      : PRO_PLAYER_REPEAT_MODES.ONE;
  }

  if (mode === PRO_PLAYER_REPEAT_MODES.OFF) return PRO_PLAYER_REPEAT_MODES.ALL;
  if (mode === PRO_PLAYER_REPEAT_MODES.ALL) return PRO_PLAYER_REPEAT_MODES.ONE;
  return PRO_PLAYER_REPEAT_MODES.OFF;
};

/**
 * @param {{
 *   currentIndex?: number;
 *   length?: number;
 *   direction?: 'previous' | 'next';
 *   repeatMode?: ProPlayerRepeatMode;
 * }} options
 */
export const resolveProPlayerQueueIndex = ({
  currentIndex = -1,
  length = 0,
  direction = 'next',
  repeatMode = PRO_PLAYER_REPEAT_MODES.OFF,
} = {}) => {
  const safeLength = Math.max(0, Number.isInteger(length) ? length : 0);
  const safeIndex = Number.isInteger(currentIndex) ? currentIndex : -1;
  if (safeLength === 0 || safeIndex < 0 || safeIndex >= safeLength) return null;

  const delta = direction === 'previous' ? -1 : 1;
  const candidate = safeIndex + delta;
  if (candidate >= 0 && candidate < safeLength) return candidate;

  return normalizeProPlayerRepeatMode(repeatMode) === PRO_PLAYER_REPEAT_MODES.ALL
    ? (direction === 'previous' ? safeLength - 1 : 0)
    : null;
};

/**
 * @param {{
 *   active?: boolean;
 *   currentIndex?: number;
 *   length?: number;
 *   repeatMode?: ProPlayerRepeatMode;
 * }} options
 */
export const getProPlayerQueueAvailability = ({
  active = false,
  currentIndex = -1,
  length = 0,
  repeatMode = PRO_PLAYER_REPEAT_MODES.OFF,
} = {}) => {
  const hasPlaylist = Boolean(active) && Number.isInteger(length) && length > 1;
  if (!hasPlaylist) return { hasPlaylist: false, canPrevious: false, canNext: false };

  return {
    hasPlaylist: true,
    canPrevious: resolveProPlayerQueueIndex({
      currentIndex,
      length,
      direction: 'previous',
      repeatMode,
    }) !== null,
    canNext: resolveProPlayerQueueIndex({
      currentIndex,
      length,
      direction: 'next',
      repeatMode,
    }) !== null,
  };
};
