import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, MapPin, Mic2, Save, Settings2, Volume2 } from 'lucide-react';

const TRACK_ANCHORS_KEY = '__trackAnchors';

const getTrackDisplayName = (track = {}) => (
  String(
    track?.label ||
    track?.name ||
    track?.track_name ||
    track?.title ||
    ''
  ).trim()
);

const getTrackStableId = (track = {}, index = 0) => (
  String(track?.id || track?.url || track?.href || `${getTrackDisplayName(track) || 'track'}-${index}`)
);

const cleanVoiceTrackLabel = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  return raw
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\b(?:primera|segunda|tercera|cuarta|quinta|sexta|septima|séptima|octava)\s+en\s+el\s+acorde\b/gi, ' ')
    .replace(/\b(mp3|wav|m4a|aac|flac|ogg)\b/gi, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const getVoiceTrackDisplayParts = (track = {}, index = 0) => {
  const fallback = `Voz ${index + 1}`;
  const cleaned = normalizeCanonicalVoiceLabel(cleanVoiceTrackLabel(getTrackDisplayName(track)) || fallback);

  return {
    title: cleaned,
    detail: '',
  };
};

const normalizeFold = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
);

const CANONICAL_VOICE_ORDER = ['Voz guía', 'Tercera voz', 'Quinta voz', 'Todas las voces', 'Pista'];

const normalizeCanonicalVoiceLabel = (value = '') => {
  const normalized = normalizeFold(value);
  if (normalized.includes('guia') || normalized.includes('principal') || normalized.includes('lead')) return 'Voz guía';
  if (normalized.includes('tercera') || /\b3(?:ra|ro)?\b/.test(normalized)) return 'Tercera voz';
  if (normalized.includes('quinta') || /\b5(?:ta|to)?\b/.test(normalized)) return 'Quinta voz';
  if (normalized.includes('todas') || normalized.includes('tres voces') || normalized.includes('full')) return 'Todas las voces';
  if (normalized.includes('pista') || normalized.includes('instrumental') || normalized.includes('track')) return 'Pista';
  return 'Pista';
};

const getCanonicalVoiceOrder = (track = {}) => {
  const label = normalizeCanonicalVoiceLabel(getTrackDisplayName(track));
  const order = CANONICAL_VOICE_ORDER.indexOf(label);
  return order === -1 ? CANONICAL_VOICE_ORDER.length : order;
};

const sortTracksByCanonicalVoiceOrder = (tracks = []) => (
  (Array.isArray(tracks) ? tracks : [])
    .map((track, index) => ({ track, index }))
    .sort((left, right) => getCanonicalVoiceOrder(left.track) - getCanonicalVoiceOrder(right.track) || left.index - right.index)
    .map(({ track }) => ({
      ...track,
      label: normalizeCanonicalVoiceLabel(getTrackDisplayName(track)),
    }))
);

const VOICE_ROLE_MATCHERS = [
  { key: 'soprano', tokens: ['soprano'] },
  { key: 'tenor', tokens: ['tenor'] },
  { key: 'alto', tokens: ['alto', 'contralto'] },
  { key: 'bajo', tokens: ['bajo', 'baritono', 'bass'] },
  { key: 'guia', tokens: ['guia', 'lead', 'principal'] },
];

const inferVoiceRoleKey = (value = '') => {
  const normalized = normalizeFold(value);
  const match = VOICE_ROLE_MATCHERS.find((item) => (
    item.tokens.some((token) => normalized.includes(token))
  ));
  return match?.key || '';
};

const memberMatchesVoiceRole = (member = {}, roleKey = '') => {
  if (!roleKey) return false;
  const matcher = VOICE_ROLE_MATCHERS.find((item) => item.key === roleKey);
  if (!matcher) return false;

  const haystack = [
    member?.roleLabel,
    ...(Array.isArray(member?.roleCodes) ? member.roleCodes : []),
    member?.name,
  ]
    .map((value) => normalizeFold(value))
    .filter(Boolean)
    .join(' ');

  return matcher.tokens.some((token) => haystack.includes(token));
};

const formatAssignedMembersText = (members = []) => {
  if (!Array.isArray(members) || members.length === 0) return '';
  if (members.length === 1) return members[0]?.name || 'Integrante';
  if (members.length === 2) return `${members[0]?.name || 'Integrante'} y ${members[1]?.name || 'Integrante'}`;
  return `${members[0]?.name || 'Integrante'} y ${members.length - 1} mas`;
};

const getFirstName = (value = '') => (
  String(value || 'Integrante').trim().split(/\s+/)[0] || 'Integrante'
);

function MemberAvatar({ member = {}, size = 'md', className = '' }) {
  const name = String(member?.name || member?.nombre || 'Integrante').trim() || 'Integrante';
  const avatarUrl = String(member?.avatarUrl || member?.avatar_url || '').trim();
  const sizeClass = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        className={`${sizeClass} shrink-0 rounded-full border border-slate-200 object-cover dark:border-white/12 ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} grid shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-100 font-black text-slate-700 dark:border-white/12 dark:bg-white/[0.08] dark:text-zinc-200 ${className}`}
    >
      {name.charAt(0).toLocaleUpperCase('es')}
    </span>
  );
}

const VOICE_COLOR_THEMES = [
  { key: 'guia', tokens: ['guia', 'principal', 'lead'], accent: '#2563EB' },
  { key: 'segunda', tokens: ['segunda'], accent: '#DC2626' },
  { key: 'tercera', tokens: ['tercera'], accent: '#16A34A' },
  { key: 'quinta', tokens: ['quinta'], accent: '#CA8A04' },
  { key: 'octava', tokens: ['octava'], accent: '#EA580C' },
  { key: 'todas', tokens: ['todas', 'tres voces'], accent: '#9333EA' },
  { key: 'pista', tokens: ['pista', 'instru'], accent: '#0891B2' },
];

const hexToRgba = (hex = '#64748B', alpha = 1) => {
  const safeHex = String(hex || '').replace('#', '').trim();
  const normalized = safeHex.length === 3
    ? safeHex.split('').map((char) => char + char).join('')
    : safeHex;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(100,116,139,${alpha})`;
  }

  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
};

const getVoiceColorTheme = (value = '') => {
  const normalized = normalizeFold(value);
  const theme = VOICE_COLOR_THEMES.find((item) => (
    item.tokens.some((token) => normalized.includes(token))
  ));

  const accent = theme?.accent || '#64748B';

  return {
    accent,
    soft: hexToRgba(accent, 0.1),
    softStrong: hexToRgba(accent, 0.16),
    border: hexToRgba(accent, 0.22),
    borderStrong: hexToRgba(accent, 0.48),
    glow: hexToRgba(accent, 0.14),
    glowStrong: hexToRgba(accent, 0.24),
    text: hexToRgba(accent, theme?.key === 'guia' ? 0.98 : 0.92),
  };
};

const formatAnchorTime = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const min = Math.floor(safeSeconds / 60);
  const sec = safeSeconds % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const formatPreRollLabel = (seconds = 0) => {
  const value = Number(seconds) || 0;
  if (value <= 0) return 'En la seccion';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}s antes`;
};

const getSectionStartSec = (marker = {}) => {
  const value = Number(marker?.startSec ?? marker?.start_sec ?? marker?.time ?? marker?.seconds);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const buildVoiceAnchorSectionOptions = (song = {}) => {
  const markers = Array.isArray(song?.sectionMarkers) ? song.sectionMarkers : [];
  return markers
    .map((marker, index) => {
      const startSec = getSectionStartSec(marker);
      if (startSec == null) return null;

      const label = String(
        marker?.sectionName ||
        marker?.name ||
        marker?.label ||
        marker?.title ||
        `Seccion ${index + 1}`
      ).trim() || `Seccion ${index + 1}`;

      return {
        id: String(marker?.id || `${label}-${startSec}-${index}`),
        label,
        startSec,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startSec - b.startSec);
};

export function priorizarVozAsignada(
  tracksOriginales = [],
  songId = '',
  userId = '',
  asignaciones = {},
  getTrackName = getTrackDisplayName
) {
  if (!Array.isArray(tracksOriginales) || tracksOriginales.length === 0) {
    return [];
  }

  const asignacion = asignaciones?.[songId]?.[userId];
  const trackNameAsignado = normalizeCanonicalVoiceLabel(asignacion?.trackName || '');

  return tracksOriginales.map((track) => {
    const nombreTrack = String(getTrackName(track) || '').trim();
    return {
      ...track,
      esAsignada: Boolean(trackNameAsignado && nombreTrack === trackNameAsignado),
    };
  });
}

export function TrackButton({
  track,
  title,
  subtitle = '',
  onClick,
  isActive = false,
  assignedLabel = 'TU VOZ',
  assignedMembers = [],
}) {
  const esAsignada = track?.esAsignada === true;
  const safeAssignedMembers = Array.isArray(assignedMembers) ? assignedMembers.filter(Boolean) : [];
  const colorTheme = getVoiceColorTheme(title);
  const toneVars = {
    '--voice-accent': colorTheme.accent,
    '--voice-soft': colorTheme.soft,
    '--voice-soft-strong': colorTheme.softStrong,
    '--voice-border': colorTheme.border,
    '--voice-border-strong': colorTheme.borderStrong,
    '--voice-glow': colorTheme.glow,
    '--voice-glow-strong': colorTheme.glowStrong,
    '--voice-text': colorTheme.text,
  };

  const baseClasses = [
    'group relative w-full overflow-hidden rounded-[1.6rem] border px-4 py-3 text-left transition-all duration-200 transform-gpu',
    'focus:outline-none focus:ring-2 focus:ring-cyan-400/70 focus:ring-offset-0',
  ].join(' ');

  const stateClasses = esAsignada
    ? [
        'border-[color:var(--voice-accent)] bg-[linear-gradient(180deg,var(--voice-soft-strong),rgba(255,255,255,0.99))] text-slate-950 opacity-100 scale-[1.02] dark:bg-[linear-gradient(180deg,var(--voice-soft-strong),rgba(18,23,34,0.98))] dark:text-white',
        '[box-shadow:inset_0_0_0_1px_rgba(15,23,42,0.04),0_0_0_1px_var(--voice-border-strong),0_0_22px_var(--voice-glow-strong)] dark:[box-shadow:inset_0_0_0_1px_rgba(255,255,255,0.1),0_0_0_1px_var(--voice-border-strong),0_0_22px_var(--voice-glow-strong),0_0_52px_var(--voice-glow)]',
        'hover:border-[color:var(--voice-accent)] hover:[box-shadow:inset_0_0_0_1px_rgba(255,255,255,0.14),0_0_0_1px_var(--voice-accent),0_0_28px_var(--voice-glow-strong),0_0_64px_var(--voice-glow)]',
      ].join(' ')
    : [
        'border-[color:var(--voice-border)] bg-[linear-gradient(180deg,var(--voice-soft),rgba(255,255,255,0.98))] text-slate-700 opacity-100 dark:bg-[linear-gradient(180deg,var(--voice-soft),rgba(30,31,36,0.96))] dark:text-zinc-300 dark:opacity-78',
        'hover:border-[color:var(--voice-border-strong)] hover:bg-[linear-gradient(180deg,var(--voice-soft-strong),rgba(248,250,252,0.98))] dark:hover:bg-[linear-gradient(180deg,var(--voice-soft-strong),rgba(37,39,48,0.96))] dark:hover:opacity-100',
      ].join(' ');

  const activeClasses = isActive
    ? (esAsignada ? 'ring-1 ring-white/10' : 'ring-1 ring-emerald-400/45 border-emerald-300/35')
    : '';

  const overlayClass =
    esAsignada && isActive
      ? 'bg-[radial-gradient(circle_at_top_left,var(--voice-glow-strong),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_34%)] opacity-100'
      : esAsignada
        ? 'bg-[radial-gradient(circle_at_top_left,var(--voice-glow),transparent_42%)] opacity-100'
        : isActive
          ? 'bg-[radial-gradient(circle_at_top_left,var(--voice-glow),transparent_50%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_36%)] opacity-100'
          : 'bg-[radial-gradient(circle_at_top_left,var(--voice-glow),transparent_54%)] opacity-100';

  const leftBarClass =
    esAsignada && isActive
      ? 'bg-[linear-gradient(180deg,var(--voice-accent),#34d399)] [box-shadow:0_0_16px_var(--voice-glow-strong)]'
      : esAsignada
        ? 'bg-[color:var(--voice-accent)] [box-shadow:0_0_14px_var(--voice-glow-strong)]'
        : isActive
          ? 'bg-[linear-gradient(180deg,var(--voice-accent),#34d399)] [box-shadow:0_0_12px_var(--voice-glow)]'
          : 'bg-[color:var(--voice-border)]';

  const iconClasses = esAsignada
    ? 'border-[color:var(--voice-border-strong)] bg-[color:var(--voice-soft-strong)] text-[color:var(--voice-accent)] [box-shadow:0_0_18px_var(--voice-glow)]'
    : isActive
      ? 'border-[color:var(--voice-border)] bg-[color:var(--voice-soft)] text-[color:var(--voice-accent)]'
      : 'border-[color:var(--voice-border)] bg-[color:var(--voice-soft)] text-[color:var(--voice-accent)] group-hover:border-[color:var(--voice-border-strong)]';

  return (
    <button
      type="button"
      onClick={onClick}
      className={[baseClasses, stateClasses, activeClasses].join(' ')}
      style={toneVars}
    >
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${overlayClass}`} />

      <span
        className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-full transition-all duration-200 ${leftBarClass}`}
      />

      <div className="relative flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all duration-200 ${iconClasses}`}
        >
          {esAsignada ? <Mic2 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={[
                'truncate text-sm transition-colors',
                esAsignada
                  ? 'font-extrabold text-slate-950 dark:text-white'
                  : 'font-semibold text-slate-800 group-hover:text-slate-950 dark:text-zinc-200 dark:group-hover:text-white',
              ].join(' ')}
          >
            {title}
          </p>

          {subtitle && (
            <p
              className={[
                'mt-1 truncate text-xs',
                esAsignada
                  ? 'text-[color:var(--voice-text)]'
                  : 'text-slate-500 group-hover:text-slate-700 dark:text-zinc-400 dark:group-hover:text-zinc-200',
              ].join(' ')}
            >
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
          {safeAssignedMembers.length > 0 && (
            <div
              className="flex min-w-0 items-center justify-end gap-2"
              aria-label={`Asignada a ${formatAssignedMembersText(safeAssignedMembers)}`}
            >
              <div className="flex shrink-0 -space-x-2">
                {safeAssignedMembers.slice(0, 3).map((member) => (
                  <MemberAvatar
                    key={member.id}
                    member={member}
                    size="sm"
                    className="ring-2 ring-white dark:ring-[#151922]"
                  />
                ))}
              </div>
              <span className="block max-w-20 truncate text-[11px] font-bold text-slate-700 dark:text-zinc-200 sm:max-w-28 sm:text-xs">
                {safeAssignedMembers.map((member) => getFirstName(member.name)).join(' · ')}
              </span>
            </div>
          )}

          {esAsignada && (
            <span className="hidden rounded-full border border-[color:var(--voice-border-strong)] bg-[color:var(--voice-soft-strong)] px-2 py-1 text-[9px] font-black tracking-[0.14em] text-[color:var(--voice-accent)] sm:inline-flex">
              {assignedLabel}
            </span>
          )}

          {isActive && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[9px] font-black tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
              SONANDO
            </span>
          )}
        </div>
      </div>

      {isActive && (
        <div className="pointer-events-none absolute inset-x-3 bottom-0.5 h-px bg-gradient-to-r from-transparent via-emerald-400/90 to-transparent" />
      )}
    </button>
  );
}

export default function EnsayoPersonalView({
  song,
  contextTitle = 'Vista Personal',
  userId = '',
  tracksOriginales = [],
  songVoiceAssignments = {},
  memberOptions = [],
  canEdit = false,
  canAssignVoices = canEdit,
  canEditVoiceStarts = canEdit,
  isSavingAssignments = false,
  saveFeedback = null,
  onBack,
  onTrackPlay,
  onSaveAssignment,
  onClearAssignment,
  onSaveTrackAnchor,
}) {
  const currentSong = song || {};
  const songId = String(currentSong?.id || '');
  const safeTracks = Array.isArray(tracksOriginales) ? tracksOriginales.filter(Boolean) : [];
  const safeMembers = Array.isArray(memberOptions) ? memberOptions.filter(Boolean) : [];
  const songAssignments = useMemo(() => (
    songVoiceAssignments?.[songId] && typeof songVoiceAssignments[songId] === 'object'
      ? songVoiceAssignments[songId]
      : {}
  ), [songVoiceAssignments, songId]);
  const memberIdSet = useMemo(() => (
    new Set(
      safeMembers
        .map((member) => String(member?.id || '').trim())
        .filter(Boolean)
    )
  ), [safeMembers]);
  const viewerMemberId = useMemo(() => {
    const safeUserId = String(userId || '').trim();
    return safeUserId && memberIdSet.has(safeUserId) ? safeUserId : '';
  }, [memberIdSet, userId]);
  const validSongAssignments = useMemo(() => (
    Object.fromEntries(
      Object.entries(songAssignments)
        .filter(([memberId]) => memberIdSet.has(String(memberId || '').trim()))
        .map(([memberId, assignment]) => ([
          memberId,
          {
            ...(assignment || {}),
            trackName: String(assignment?.trackName || '').trim()
              ? normalizeCanonicalVoiceLabel(assignment.trackName)
              : '',
          },
        ]))
    )
  ), [memberIdSet, songAssignments]);
  const currentAssignmentValue = String(validSongAssignments?.[viewerMemberId]?.trackName || '').trim();
  const currentAssignment = currentAssignmentValue
    ? normalizeCanonicalVoiceLabel(currentAssignmentValue)
    : '';
  const voiceTrackAnchors = useMemo(() => (
    songAssignments?.[TRACK_ANCHORS_KEY] && typeof songAssignments[TRACK_ANCHORS_KEY] === 'object'
      ? songAssignments[TRACK_ANCHORS_KEY]
      : {}
  ), [songAssignments]);

  const memberById = useMemo(() => {
    const entries = safeMembers.map((member) => [
      String(member?.id || ''),
      {
        ...member,
        name: String(member?.name || member?.nombre || member?.email || 'Integrante').trim() || 'Integrante',
        avatarUrl: String(member?.avatarUrl || member?.avatar_url || '').trim(),
      },
    ]);
    return new Map(entries.filter(([memberId]) => memberId));
  }, [safeMembers]);

  const trackAssignmentsByName = useMemo(() => {
    const assignmentsMap = new Map();

    Object.entries(validSongAssignments).forEach(([memberId, assignment]) => {
      const safeTrackName = normalizeCanonicalVoiceLabel(assignment?.trackName || '');
      if (!safeTrackName) return;

      const existing = assignmentsMap.get(safeTrackName) || [];
      const member = memberById.get(String(memberId || '')) || {};
      existing.push({
        id: String(memberId || ''),
        name: member?.name || 'Integrante',
        avatarUrl: member?.avatarUrl || '',
        isCurrentUser: String(memberId || '') === viewerMemberId,
      });
      assignmentsMap.set(safeTrackName, existing);
    });

    return assignmentsMap;
  }, [validSongAssignments, memberById, viewerMemberId]);

  const tracksOrdenados = useMemo(() => (
    priorizarVozAsignada(
      sortTracksByCanonicalVoiceOrder(safeTracks),
      songId,
      viewerMemberId,
      { [songId]: validSongAssignments },
      getTrackDisplayName
    )
  ), [safeTracks, songId, viewerMemberId, validSongAssignments]);

  const tracksParaVista = useMemo(() => (
    tracksOrdenados.map((track, index) => ({
      ...track,
      esAsignada: track?.esAsignada === true,
      assignedMembers: trackAssignmentsByName.get(getTrackDisplayName(track)) || [],
      __viewId: getTrackStableId(track, index),
    }))
  ), [tracksOrdenados, trackAssignmentsByName]);

  const availableTrackNames = useMemo(() => (
    Array.from(
      new Set(
        safeTracks
          .map((track) => getTrackDisplayName(track))
          .filter(Boolean)
      )
    )
  ), [safeTracks]);
  const anchorSectionOptions = useMemo(() => (
    buildVoiceAnchorSectionOptions(currentSong)
  ), [currentSong]);

  const [activeTrackId, setActiveTrackId] = useState(null);
  const [assignmentPanelMode, setAssignmentPanelMode] = useState('voices');
  const [selectedMemberId, setSelectedMemberId] = useState(() => (
    String(viewerMemberId || safeMembers[0]?.id || '')
  ));
  const [selectedTrackName, setSelectedTrackName] = useState(() => (
    currentAssignment || availableTrackNames[0] || ''
  ));
  const [selectedAnchorTrackName, setSelectedAnchorTrackName] = useState(() => (
    currentAssignment || availableTrackNames[0] || ''
  ));
  const [selectedAnchorSectionId, setSelectedAnchorSectionId] = useState('');
  const [anchorPreRollSec, setAnchorPreRollSec] = useState(0);
  const [hasManualMemberSelection, setHasManualMemberSelection] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [showAssignmentPanel, setShowAssignmentPanel] = useState(false);
  const pickersRef = useRef(null);
  const canManageVoiceAssignments = Boolean(canAssignVoices) && safeMembers.length > 0 && availableTrackNames.length > 0;
  const canManageVoiceStarts = Boolean(canEditVoiceStarts) && availableTrackNames.length > 0;
  const canManageAssignments = canManageVoiceAssignments || canManageVoiceStarts;
  const assignmentModes = useMemo(() => ([
    canManageVoiceAssignments ? ['voices', 'Asignar voces'] : null,
    canManageVoiceStarts ? ['starts', 'Comienzos'] : null,
  ].filter(Boolean)), [canManageVoiceAssignments, canManageVoiceStarts]);
  const selectedTrackAnchor = voiceTrackAnchors?.[selectedAnchorTrackName] || null;
  const selectedVoiceTheme = useMemo(() => getVoiceColorTheme(selectedTrackName), [selectedTrackName]);
  const selectedTrackAssignedMembers = useMemo(() => (
    trackAssignmentsByName.get(normalizeCanonicalVoiceLabel(selectedTrackName)) || []
  ), [selectedTrackName, trackAssignmentsByName]);

  useEffect(() => {
    const fallbackMemberId = String(viewerMemberId || safeMembers[0]?.id || '');
    if (!fallbackMemberId) return;
    if (!selectedMemberId || !memberIdSet.has(String(selectedMemberId || '').trim())) {
      setSelectedMemberId(fallbackMemberId);
    }
  }, [memberIdSet, selectedMemberId, safeMembers, viewerMemberId]);

  useEffect(() => {
    setSelectedTrackName((prev) => {
      if (prev && availableTrackNames.includes(prev)) return prev;
      return currentAssignment || availableTrackNames[0] || '';
    });
  }, [availableTrackNames, currentAssignment]);

  useEffect(() => {
    setSelectedAnchorTrackName((prev) => {
      if (prev && availableTrackNames.includes(prev)) return prev;
      return currentAssignment || availableTrackNames[0] || '';
    });
  }, [availableTrackNames, currentAssignment]);

  useEffect(() => {
    if (!anchorSectionOptions.length) {
      setSelectedAnchorSectionId('');
      setAnchorPreRollSec(0);
      return;
    }

    const savedSectionId = String(selectedTrackAnchor?.sectionId || '');
    const savedSection = savedSectionId
      ? anchorSectionOptions.find((section) => String(section.id) === savedSectionId)
      : null;
    const nextSection = savedSection || anchorSectionOptions[0];
    setSelectedAnchorSectionId(String(nextSection?.id || ''));

    const savedPreRoll = Number(selectedTrackAnchor?.preRollSec);
    if (Number.isFinite(savedPreRoll)) {
      setAnchorPreRollSec(Math.max(0, Math.min(12, savedPreRoll)));
      return;
    }

    const savedStart = Number(selectedTrackAnchor?.startSec);
    const sectionStart = Number(selectedTrackAnchor?.sectionStartSec ?? nextSection?.startSec);
    const inferredPreRoll = Number.isFinite(savedStart) && Number.isFinite(sectionStart)
      ? Math.max(0, sectionStart - savedStart)
      : 0;
    setAnchorPreRollSec(Math.max(0, Math.min(12, inferredPreRoll)));
  }, [anchorSectionOptions, selectedTrackAnchor]);

  useEffect(() => {
    if (!activeTrackId) return;
    if (!tracksParaVista.some((track) => track.__viewId === activeTrackId)) {
      setActiveTrackId(null);
    }
  }, [activeTrackId, tracksParaVista]);

  useEffect(() => {
    if (!canManageAssignments && showAssignmentPanel) {
      setShowAssignmentPanel(false);
    }
  }, [canManageAssignments, showAssignmentPanel]);

  useEffect(() => {
    if (!memberPickerOpen && !voicePickerOpen) return undefined;

    const closePickers = (event) => {
      if (event?.type === 'keydown' && event.key !== 'Escape') return;
      if (event?.type === 'pointerdown' && pickersRef.current?.contains(event.target)) return;
      setMemberPickerOpen(false);
      setVoicePickerOpen(false);
    };

    document.addEventListener('pointerdown', closePickers);
    document.addEventListener('keydown', closePickers);
    return () => {
      document.removeEventListener('pointerdown', closePickers);
      document.removeEventListener('keydown', closePickers);
    };
  }, [memberPickerOpen, voicePickerOpen]);

  useEffect(() => {
    if (assignmentModes.some(([mode]) => mode === assignmentPanelMode)) {
      return;
    }

    setAssignmentPanelMode(assignmentModes[0]?.[0] || 'voices');
  }, [assignmentModes, assignmentPanelMode]);

  useEffect(() => {
    setMemberPickerOpen(false);
    setVoicePickerOpen(false);
  }, [assignmentPanelMode, showAssignmentPanel]);

  const selectedTrackAssignmentOwnerId = useMemo(() => {
    return Object.keys(validSongAssignments).find((memberId) => (
      normalizeCanonicalVoiceLabel(validSongAssignments?.[memberId]?.trackName || '') === normalizeCanonicalVoiceLabel(selectedTrackName || '')
    )) || '';
  }, [selectedTrackName, validSongAssignments]);

  const smartSuggestedMemberId = useMemo(() => {
    if (selectedTrackAssignmentOwnerId) return String(selectedTrackAssignmentOwnerId);
    const inferredRoleKey = inferVoiceRoleKey(selectedTrackName);
    if (!inferredRoleKey) return '';
    const match = safeMembers.find((member) => memberMatchesVoiceRole(member, inferredRoleKey));
    return String(match?.id || '');
  }, [selectedTrackAssignmentOwnerId, selectedTrackName, safeMembers]);

  useEffect(() => {
    if (hasManualMemberSelection) return;
    if (smartSuggestedMemberId && String(selectedMemberId || '') !== String(smartSuggestedMemberId)) {
      setSelectedMemberId(String(smartSuggestedMemberId));
      return;
    }
    const fallbackMemberId = String(viewerMemberId || safeMembers[0]?.id || '');
    if (fallbackMemberId && (!selectedMemberId || !memberIdSet.has(String(selectedMemberId || '').trim()))) {
      setSelectedMemberId(fallbackMemberId);
    }
  }, [hasManualMemberSelection, memberIdSet, selectedMemberId, smartSuggestedMemberId, safeMembers, viewerMemberId]);

  const selectedMemberAssignment = String(
    normalizeCanonicalVoiceLabel(validSongAssignments?.[selectedMemberId]?.trackName || '')
  ).trim();
  const selectedAnchorSection = anchorSectionOptions.find((section) => (
    String(section.id) === String(selectedAnchorSectionId)
  )) || anchorSectionOptions[0] || null;

  const handleTrackClick = (track, trackDisplayParts) => {
    const title = trackDisplayParts?.title || getTrackDisplayName(track) || 'Voz';
    setActiveTrackId(track.__viewId);
    onTrackPlay?.({
      ...track,
      __displayTitle: title,
      __voiceColor: getVoiceColorTheme(title).accent,
    });
  };

  const handleSaveAssignment = async () => {
    if (!canManageVoiceAssignments) return;
    if (!songId || !selectedMemberId || !selectedTrackName) return;
    await onSaveAssignment?.({
      songId,
      targetUserId: String(selectedMemberId),
      trackName: String(selectedTrackName).trim(),
    });
  };

  const handleClearAssignment = async () => {
    if (!canManageVoiceAssignments) return;
    if (!songId || !selectedMemberId) return;
    await onClearAssignment?.({
      songId,
      targetUserId: String(selectedMemberId),
    });
  };

  const updateAnchorPreRoll = (delta) => {
    setAnchorPreRollSec((current) => {
      const next = Math.round((Number(current || 0) + delta) * 2) / 2;
      return Math.max(0, Math.min(12, next));
    });
  };

  const handleSaveTrackAnchor = async () => {
    if (!canManageVoiceStarts) return;
    if (!songId || !selectedAnchorTrackName || !selectedAnchorSection) return;
    const safePreRollSec = Math.max(0, Math.min(12, Number(anchorPreRollSec) || 0));
    const sectionStartSec = Number(selectedAnchorSection.startSec) || 0;

    await onSaveTrackAnchor?.({
      songId,
      trackName: String(selectedAnchorTrackName).trim(),
      anchor: {
        sectionId: selectedAnchorSection.id,
        sectionLabel: selectedAnchorSection.label,
        sectionStartSec,
        preRollSec: safePreRollSec,
        startSec: Math.max(0, sectionStartSec - safePreRollSec),
      },
    });
  };

  const selectedMemberLabel = safeMembers.find((member) => String(member?.id || '') === String(selectedMemberId || ''));
  const priorityTitle = currentAssignment
    ? cleanVoiceTrackLabel(currentAssignment)
    : 'Sin voz asignada';
  const priorityMeta = currentAssignment
    ? 'Tu pista aparece primero'
    : `${tracksParaVista.length} pistas vocales`;

  if (!song) return null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50 text-slate-950 dark:bg-[#0b0d12] dark:text-white">
      <header className="shrink-0 border-b border-slate-200 bg-white/88 backdrop-blur-xl dark:border-white/8 dark:bg-black/70">
        <div
          className="mx-auto flex max-w-4xl items-start gap-4 px-4 pb-4 sm:px-5"
          style={{ paddingTop: 'max(calc(env(safe-area-inset-top) + 0.45rem), 1rem)' }}
        >
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:shadow-none dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Volver a lista de ensayo"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              {contextTitle}
            </p>
            <h1 className="mt-2 truncate text-2xl font-black tracking-tight text-slate-950 dark:text-white">
              {currentSong?.title || 'Cancion'}
            </h1>
            <p className="mt-1 truncate text-sm font-medium text-slate-500 dark:text-zinc-400">
              {currentSong?.artist || 'Selecciona tu pista vocal'}
            </p>
          </div>

          {canManageAssignments && (
            <button
              type="button"
              onClick={() => setShowAssignmentPanel((prev) => !prev)}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-sm font-black transition-all ${
                showAssignmentPanel
                  ? 'border-cyan-500/45 bg-cyan-500/12 text-cyan-700 shadow-[0_0_20px_rgba(6,182,212,0.12)] dark:border-cyan-400/45 dark:bg-cyan-400/14 dark:text-cyan-200'
                  : 'border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:shadow-none dark:hover:bg-white/[0.08] dark:hover:text-white'
              }`}
              aria-expanded={showAssignmentPanel}
              aria-label={showAssignmentPanel ? 'Ocultar ajustes vocales' : 'Mostrar ajustes vocales'}
            >
              <Settings2 className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      {canManageAssignments && showAssignmentPanel && (
        <section className="relative z-[200] shrink-0 border-b border-slate-200 bg-slate-100/94 backdrop-blur-xl dark:border-white/8 dark:bg-[#0d1118]/94">
          <div className="mx-auto max-w-4xl px-4 py-4 sm:px-5">
            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#12161f] dark:shadow-[0_18px_60px_rgba(0,0,0,0.28)] sm:p-5">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 dark:text-zinc-500">
                    Ajustes vocales
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAssignmentPanel(false)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                  >
                    Cerrar
                  </button>
                </div>

                {assignmentModes.length > 1 && (
                  <div
                    role="tablist"
                    aria-label="Ajustes vocales"
                    className="flex gap-5 border-b border-slate-200 dark:border-white/8"
                  >
                    {assignmentModes.map(([mode, label]) => {
                      const isSelected = assignmentPanelMode === mode;
                      const ModeIcon = mode === 'voices' ? Mic2 : MapPin;

                      return (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          onClick={() => setAssignmentPanelMode(mode)}
                          className={`relative inline-flex min-h-11 items-center gap-2 px-0.5 text-xs font-black uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
                            isSelected ? 'text-cyan-700 dark:text-cyan-200' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200'
                          }`}
                        >
                          <ModeIcon className="h-3.5 w-3.5" />
                          {label}
                          <span
                            aria-hidden="true"
                            className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full transition-colors ${isSelected ? 'bg-cyan-500 dark:bg-cyan-300' : 'bg-transparent'}`}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}

                {assignmentPanelMode === 'voices' && canManageVoiceAssignments ? (
                  <>
                    <div
                      className="rounded-2xl border px-4 py-3"
                      style={{
                        borderColor: selectedVoiceTheme.border,
                        backgroundColor: selectedVoiceTheme.soft,
                      }}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: selectedVoiceTheme.accent }}
                          />
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">Estado</p>
                            <p className="truncate text-sm font-black text-slate-950 dark:text-zinc-100">
                              {cleanVoiceTrackLabel(selectedTrackName) || 'Selecciona una voz'}
                            </p>
                          </div>
                        </div>

                        {selectedTrackAssignedMembers.length > 0 ? (
                          <div className="flex min-w-0 items-center justify-end gap-2" aria-label={`Asignada a ${formatAssignedMembersText(selectedTrackAssignedMembers)}`}>
                            <div className="flex shrink-0 -space-x-2">
                              {selectedTrackAssignedMembers.slice(0, 3).map((member) => (
                                <MemberAvatar key={member.id} member={member} size="sm" className="ring-2 ring-white dark:ring-[#12161f]" />
                              ))}
                            </div>
                            <span className="max-w-36 truncate text-xs font-bold text-slate-700 dark:text-zinc-200">
                              {selectedTrackAssignedMembers.map((member) => getFirstName(member.name)).join(' · ')}
                            </span>
                          </div>
                        ) : (
                          <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-zinc-500">Sin asignar</span>
                        )}
                      </div>
                    </div>

                    <div ref={pickersRef} className="grid gap-3 sm:grid-cols-2">
                      <div className="relative flex min-w-0 flex-col gap-2">
                        <span id="voice-member-picker-label" className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">
                          Integrante
                        </span>
                        <button
                          type="button"
                          aria-labelledby="voice-member-picker-label"
                          aria-haspopup="listbox"
                          aria-expanded={memberPickerOpen}
                          onClick={() => {
                            setMemberPickerOpen((current) => !current);
                            setVoicePickerOpen(false);
                          }}
                          className="flex h-12 w-full items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] dark:focus-visible:ring-cyan-400/70"
                        >
                          <MemberAvatar member={selectedMemberLabel} />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-950 dark:text-white">
                            {getFirstName(selectedMemberLabel?.name)}
                          </span>
                          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-zinc-500 ${memberPickerOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {memberPickerOpen && (
                          <div
                            role="listbox"
                            aria-labelledby="voice-member-picker-label"
                            className="absolute left-0 right-0 top-full z-[210] mt-2 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_60px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#171b24] dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
                          >
                            {safeMembers.map((member) => {
                              const isSelected = String(member.id) === String(selectedMemberId);
                              return (
                                <button
                                  key={member.id}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  onClick={() => {
                                    setSelectedMemberId(String(member.id));
                                    setHasManualMemberSelection(true);
                                    setMemberPickerOpen(false);
                                  }}
                                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
                                    isSelected ? 'bg-cyan-500/10 dark:bg-cyan-400/12' : 'hover:bg-slate-100 dark:hover:bg-white/[0.06]'
                                  }`}
                                >
                                  <MemberAvatar member={member} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-bold text-slate-950 dark:text-zinc-100">{getFirstName(member.name)}</span>
                                    {member.roleLabel && <span className="block truncate text-[11px] font-medium text-slate-500 dark:text-zinc-500">{member.roleLabel}</span>}
                                  </span>
                                  {isSelected && <Check className="h-4 w-4 shrink-0 text-cyan-300" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="relative flex min-w-0 flex-col gap-2">
                        <span id="voice-track-picker-label" className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">
                          Voz
                        </span>
                        <button
                          type="button"
                          aria-labelledby="voice-track-picker-label"
                          aria-haspopup="listbox"
                          aria-expanded={voicePickerOpen}
                          onClick={() => {
                            setVoicePickerOpen((current) => !current);
                            setMemberPickerOpen(false);
                          }}
                          className="flex h-12 w-full items-center gap-3 rounded-2xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                          style={{
                            borderColor: selectedVoiceTheme.borderStrong,
                            backgroundColor: selectedVoiceTheme.soft,
                          }}
                        >
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: selectedVoiceTheme.accent }} />
                          <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-950 dark:text-white">
                            {cleanVoiceTrackLabel(selectedTrackName)}
                          </span>
                          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-zinc-400 ${voicePickerOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {voicePickerOpen && (
                          <div
                            role="listbox"
                            aria-labelledby="voice-track-picker-label"
                            className="absolute left-0 right-0 top-full z-[210] mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_60px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#171b24] dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
                          >
                            {availableTrackNames.map((trackName) => {
                              const trackTheme = getVoiceColorTheme(trackName);
                              const isSelected = normalizeCanonicalVoiceLabel(trackName) === normalizeCanonicalVoiceLabel(selectedTrackName);
                              return (
                                <button
                                  key={trackName}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  onClick={() => {
                                    setSelectedTrackName(trackName);
                                    setVoicePickerOpen(false);
                                  }}
                                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:hover:bg-white/[0.06] dark:focus-visible:ring-cyan-400/70"
                                  style={isSelected ? { backgroundColor: trackTheme.soft } : undefined}
                                >
                                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: trackTheme.accent }} />
                                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-950 dark:text-zinc-100">
                                    {getVoiceTrackDisplayParts({ label: trackName }).title}
                                  </span>
                                  {isSelected && <Check className="h-4 w-4 shrink-0" style={{ color: trackTheme.accent }} />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <button
                        type="button"
                        onClick={handleSaveAssignment}
                        disabled={isSavingAssignments || !selectedMemberId || !selectedTrackName}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.22)] transition-all hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        {isSavingAssignments ? 'Guardando...' : 'Guardar voz'}
                      </button>

                      {selectedMemberAssignment && (
                        <button
                          type="button"
                          onClick={handleClearAssignment}
                          disabled={isSavingAssignments}
                          className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </>
                ) : canManageVoiceStarts ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/8 dark:bg-black/20">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">
                        Estado
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-zinc-200">
                        {selectedTrackAnchor?.sectionLabel
                          ? `${getVoiceTrackDisplayParts({ label: selectedAnchorTrackName }).title} · ${selectedTrackAnchor.sectionLabel} · ${formatPreRollLabel(selectedTrackAnchor.preRollSec)}`
                          : `${getVoiceTrackDisplayParts({ label: selectedAnchorTrackName }).title || 'Pista'} · sin comienzo`}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                      <label className="flex min-w-0 flex-col gap-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">
                          Pista
                        </span>
                        <select
                          value={selectedAnchorTrackName}
                          onChange={(event) => setSelectedAnchorTrackName(event.target.value)}
                          className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-cyan-500/55 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:focus:border-cyan-400/55"
                        >
                          {availableTrackNames.map((trackName) => (
                            <option key={trackName} value={trackName} className="bg-white text-slate-950 dark:bg-[#12161f] dark:text-white">
                              {getVoiceTrackDisplayParts({ label: trackName }).title}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="flex min-w-0 flex-col gap-2">
                        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-zinc-500">
                          Ajuste
                        </span>
                        <div className="grid h-12 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]">
                          <button
                            type="button"
                            onClick={() => updateAnchorPreRoll(-0.5)}
                            className="text-lg font-black text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            aria-label="Reducir segundos antes"
                          >
                            -
                          </button>
                          <div className="grid place-items-center border-x border-slate-200 px-2 text-center text-sm font-black text-slate-950 dark:border-white/8 dark:text-white">
                            {formatPreRollLabel(anchorPreRollSec)}
                          </div>
                          <button
                            type="button"
                            onClick={() => updateAnchorPreRoll(0.5)}
                            className="text-lg font-black text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            aria-label="Aumentar segundos antes"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    {anchorSectionOptions.length > 0 ? (
                      <>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {anchorSectionOptions.map((section) => {
                            const isSelected = String(selectedAnchorSection?.id || '') === String(section.id);

                            return (
                              <button
                                key={section.id}
                                type="button"
                                onClick={() => setSelectedAnchorSectionId(String(section.id))}
                                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-black uppercase tracking-[0.1em] transition-all ${
                                  isSelected
                                    ? 'border-cyan-500/45 bg-cyan-500/10 text-cyan-800 shadow-[0_0_18px_rgba(6,182,212,0.1)] dark:border-cyan-300/50 dark:bg-cyan-300/14 dark:text-cyan-100'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-500/28 hover:bg-cyan-500/8 hover:text-cyan-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:border-cyan-300/28 dark:hover:bg-cyan-300/10 dark:hover:text-cyan-100'
                                }`}
                              >
                                <span>{section.label}</span>
                                <span className="text-[10px] font-black tracking-normal text-slate-500 dark:text-white/45">
                                  {formatAnchorTime(Math.max(0, section.startSec - anchorPreRollSec))}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <input
                          type="range"
                          min="0"
                          max="12"
                          step="0.5"
                          value={anchorPreRollSec}
                          onChange={(event) => setAnchorPreRollSec(Number(event.target.value))}
                          className="w-full accent-cyan-400"
                          aria-label="Segundos antes de la seccion"
                        />

                        <button
                          type="button"
                          onClick={handleSaveTrackAnchor}
                          disabled={isSavingAssignments || !selectedAnchorTrackName || !selectedAnchorSection}
                          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.22)] transition-all hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <MapPin className="h-4 w-4" />
                          {isSavingAssignments ? 'Guardando...' : 'Guardar comienzo'}
                        </button>
                      </>
                    ) : (
                      <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500 dark:border-white/8 dark:bg-black/20 dark:text-zinc-400">
                        Sin secciones con tiempo.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      <main
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-5"
        style={{
          paddingBottom: activeTrackId
            ? 'max(calc(env(safe-area-inset-bottom) + 8rem), 8rem)'
            : 'max(calc(env(safe-area-inset-bottom) + 1rem), 1rem)',
        }}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <section className="overflow-hidden rounded-[1.6rem] border border-cyan-500/18 bg-white px-4 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] dark:border-cyan-400/14 dark:bg-[linear-gradient(180deg,_rgba(18,23,34,0.96),_rgba(14,18,27,0.96))] dark:shadow-[0_20px_70px_rgba(2,6,23,0.36)] sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
                  Voz asignada
                </p>
                <h2 className="mt-1 truncate text-lg font-black text-slate-950 dark:text-white">
                  {priorityTitle}
                </h2>
              </div>

              <div className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                {priorityMeta}
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            {tracksParaVista.length > 0 ? (
              tracksParaVista.map((track, index) => {
                const assignedMembers = Array.isArray(track?.assignedMembers) ? track.assignedMembers : [];
                const assignedOthers = assignedMembers.filter((member) => member && member.isCurrentUser !== true);
                const assignedOthersText = formatAssignedMembersText(assignedOthers);
                const trackDisplayParts = getVoiceTrackDisplayParts(track, index);
                const subtitle = track?.esAsignada
                  ? 'Tu voz asignada para este ensayo'
                  : assignedOthersText
                    ? `Asignada a ${assignedOthersText}`
                    : trackDisplayParts.detail;

                return (
                  <TrackButton
                    key={track.__viewId}
                    track={track}
                    title={trackDisplayParts.title || `Voz ${index + 1}`}
                    subtitle={subtitle}
                    assignedMembers={assignedMembers}
                    isActive={activeTrackId === track.__viewId}
                    onClick={() => handleTrackClick(track, trackDisplayParts)}
                  />
                );
              })
            ) : (
              <div className="rounded-[1.6rem] border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-white/10 dark:bg-white/[0.03]">
                <p className="text-sm font-semibold text-slate-700 dark:text-zinc-300">
                  Esta cancion no tiene pistas vocales estructuradas para la vista personal.
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
                  Si aun usa formato legacy, sigue disponible desde el acceso normal de voces.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {saveFeedback?.message && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[220] -translate-x-1/2 px-4">
          <div
            className={`rounded-full border px-4 py-2 text-sm font-semibold shadow-2xl backdrop-blur-xl ${
              saveFeedback.type === 'error'
                ? 'border-red-400/35 bg-red-50/95 text-red-700 dark:border-red-400/25 dark:bg-red-500/12 dark:text-red-200'
                : 'border-emerald-400/35 bg-emerald-50/95 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-100'
            }`}
          >
            {saveFeedback.message}
          </div>
        </div>
      )}
    </div>
  );
}
