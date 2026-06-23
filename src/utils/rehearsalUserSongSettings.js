export const REHEARSAL_USER_SONG_SETTINGS_TABLE = 'ensayo_cancion_ajustes_usuario';
export const REHEARSAL_PERSONAL_SETTINGS_TOAST_MS = 5500;

const STORAGE_PREFIX = 'redil:ensayo-song-settings:v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clampNumber = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

export const isUuidLike = (value = '') => UUID_RE.test(String(value || '').trim());

export const sanitizeRehearsalSongSettings = (value = {}) => ({
  transposeSteps: clampNumber(value?.transposeSteps ?? value?.transpose_steps ?? 0, -6, 6),
  capoFret: clampNumber(value?.capoFret ?? value?.capo_fret ?? 0, 0, 7),
});

export const hasPersonalRehearsalSongSettings = (value = {}) => {
  const settings = sanitizeRehearsalSongSettings(value);
  return settings.transposeSteps !== 0 || settings.capoFret !== 0;
};

const formatToneLabel = (tone = '') => String(tone || '').trim().replace(/#/g, '♯');

export const formatRehearsalSongSettingsSummary = (
  value = {},
  {
    targetTone = '',
    includeNeutral = false,
  } = {},
) => {
  const settings = sanitizeRehearsalSongSettings(value);
  const parts = [];
  const cleanTargetTone = formatToneLabel(targetTone);

  if (settings.transposeSteps !== 0) {
    parts.push(
      cleanTargetTone && cleanTargetTone !== '-'
        ? `Tono ${cleanTargetTone}`
        : `Tono ${settings.transposeSteps > 0 ? '+' : ''}${settings.transposeSteps}`,
    );
  } else if (includeNeutral) {
    parts.push('Tono original');
  }

  if (settings.capoFret > 0) {
    parts.push(`Capo traste ${settings.capoFret}`);
  } else if (includeNeutral) {
    parts.push('Sin capo');
  }

  return parts.join(' · ');
};

export const buildRehearsalSongSettingsStorageKey = ({
  userId = '',
  eventId = '',
  playlistId = '',
  songId = '',
} = {}) => {
  const safeUserId = String(userId || 'anon').trim() || 'anon';
  const safeEventId = String(eventId || 'no-event').trim() || 'no-event';
  const safePlaylistId = String(playlistId || 'no-playlist').trim() || 'no-playlist';
  const safeSongId = String(songId || 'no-song').trim() || 'no-song';

  return [
    STORAGE_PREFIX,
    encodeURIComponent(safeUserId),
    encodeURIComponent(safeEventId),
    encodeURIComponent(safePlaylistId),
    encodeURIComponent(safeSongId),
  ].join(':');
};

const canUseLocalStorage = () => (
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined'
);

export const loadLocalRehearsalSongSettings = (context = {}) => {
  if (!canUseLocalStorage()) return sanitizeRehearsalSongSettings();

  try {
    const raw = window.localStorage.getItem(buildRehearsalSongSettingsStorageKey(context));
    if (!raw) return sanitizeRehearsalSongSettings();
    return sanitizeRehearsalSongSettings(JSON.parse(raw));
  } catch {
    return sanitizeRehearsalSongSettings();
  }
};

export const saveLocalRehearsalSongSettings = (context = {}, settings = {}) => {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(
      buildRehearsalSongSettingsStorageKey(context),
      JSON.stringify({
        ...sanitizeRehearsalSongSettings(settings),
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Local persistence is a convenience fallback.
  }
};

const canUseRemoteSettings = ({ userId = '', eventId = '', songId = '' } = {}) => (
  isUuidLike(userId) && isUuidLike(eventId) && isUuidLike(songId)
);

const mapRemoteRowToSettings = (row = null) => sanitizeRehearsalSongSettings({
  transposeSteps: row?.transpose_steps,
  capoFret: row?.capo_fret,
});

export async function loadRehearsalSongSettings(supabaseClient, context = {}) {
  const localSettings = loadLocalRehearsalSongSettings(context);
  if (!supabaseClient || !canUseRemoteSettings(context)) return localSettings;

  try {
    const { data, error } = await supabaseClient
      .from(REHEARSAL_USER_SONG_SETTINGS_TABLE)
      .select('transpose_steps, capo_fret')
      .eq('perfil_id', context.userId)
      .eq('evento_id', context.eventId)
      .eq('cancion_id', context.songId)
      .maybeSingle();

    if (error || !data) return localSettings;

    const remoteSettings = mapRemoteRowToSettings(data);
    saveLocalRehearsalSongSettings(context, remoteSettings);
    return remoteSettings;
  } catch {
    return localSettings;
  }
}

export async function saveRehearsalSongSettings(supabaseClient, context = {}, settings = {}) {
  const safeSettings = sanitizeRehearsalSongSettings(settings);
  saveLocalRehearsalSongSettings(context, safeSettings);

  if (!supabaseClient || !canUseRemoteSettings(context)) return safeSettings;

  try {
    await supabaseClient
      .from(REHEARSAL_USER_SONG_SETTINGS_TABLE)
      .upsert(
        {
          perfil_id: context.userId,
          evento_id: context.eventId,
          playlist_id: isUuidLike(context.playlistId) ? context.playlistId : null,
          cancion_id: context.songId,
          transpose_steps: safeSettings.transposeSteps,
          capo_fret: safeSettings.capoFret,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'perfil_id,evento_id,cancion_id' },
      );
  } catch {
    // Keep the local copy even if the remote migration is not applied yet.
  }

  return safeSettings;
}

export async function loadRehearsalSongSettingsMap(supabaseClient, context = {}, songIds = []) {
  const ids = Array.from(new Set(
    (Array.isArray(songIds) ? songIds : [])
      .map((songId) => String(songId || '').trim())
      .filter(Boolean),
  ));

  const localMap = ids.reduce((acc, songId) => {
    acc[songId] = loadLocalRehearsalSongSettings({ ...context, songId });
    return acc;
  }, {});

  if (
    !supabaseClient ||
    !isUuidLike(context.userId) ||
    !isUuidLike(context.eventId) ||
    ids.length === 0 ||
    ids.some((songId) => !isUuidLike(songId))
  ) {
    return localMap;
  }

  try {
    const { data, error } = await supabaseClient
      .from(REHEARSAL_USER_SONG_SETTINGS_TABLE)
      .select('cancion_id, transpose_steps, capo_fret')
      .eq('perfil_id', context.userId)
      .eq('evento_id', context.eventId)
      .in('cancion_id', ids);

    if (error || !Array.isArray(data)) return localMap;

    const remoteMap = { ...localMap };
    data.forEach((row) => {
      const songId = String(row?.cancion_id || '').trim();
      if (!songId) return;
      const settings = mapRemoteRowToSettings(row);
      remoteMap[songId] = settings;
      saveLocalRehearsalSongSettings({ ...context, songId }, settings);
    });

    return remoteMap;
  } catch {
    return localMap;
  }
}
