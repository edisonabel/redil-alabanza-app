import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Mic2, Save, UserRound, Volume2 } from 'lucide-react';

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

const normalizeFold = (value = '') => (
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
  const trackNameAsignado = String(asignacion?.trackName || '').trim();

  if (!trackNameAsignado) {
    return tracksOriginales;
  }

  const indiceAsignado = tracksOriginales.findIndex((track) => {
    const nombreTrack = String(getTrackName(track) || '').trim();
    return nombreTrack === trackNameAsignado;
  });

  if (indiceAsignado === -1) {
    return tracksOriginales;
  }

  const trackAsignado = tracksOriginales[indiceAsignado];
  const restoTracks = tracksOriginales.filter((_, index) => index !== indiceAsignado);

  return [
    {
      ...trackAsignado,
      esAsignada: true,
    },
    ...restoTracks.map((track) => ({
      ...track,
      esAsignada: false,
    })),
  ];
}

export function TrackButton({
  track,
  title,
  subtitle = '',
  onClick,
  isActive = false,
  assignedLabel = 'TU VOZ',
  assignmentLabel = '',
}) {
  const esAsignada = track?.esAsignada === true;

  const baseClasses = [
    'group relative w-full overflow-hidden rounded-[1.6rem] border px-4 py-3 text-left transition-all duration-200 transform-gpu',
    'focus:outline-none focus:ring-2 focus:ring-cyan-400/70 focus:ring-offset-0',
  ].join(' ');

  const stateClasses = esAsignada
    ? [
        'border-cyan-400/80 bg-[#121722] text-white opacity-100 scale-[1.02]',
        'shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_0_18px_rgba(34,211,238,0.18),0_0_42px_rgba(59,130,246,0.14)]',
        'hover:border-cyan-300 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.65),0_0_24px_rgba(34,211,238,0.24),0_0_56px_rgba(59,130,246,0.18)]',
      ].join(' ')
    : [
        'border-white/8 bg-[#1E1F24] text-zinc-300 opacity-70',
        'hover:bg-[#252730] hover:opacity-100 hover:border-white/12',
      ].join(' ');

  const activeClasses = isActive
    ? 'ring-1 ring-emerald-400/45 border-emerald-300/35'
    : '';

  const overlayClass =
    esAsignada && isActive
      ? 'bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_36%)] opacity-100'
      : esAsignada
        ? 'bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_42%)] opacity-100'
        : isActive
          ? 'bg-[radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_36%)] opacity-100'
          : 'opacity-0';

  const leftBarClass =
    esAsignada && isActive
      ? 'bg-gradient-to-b from-cyan-300 via-cyan-400 to-emerald-400 shadow-[0_0_16px_rgba(34,211,238,0.85)]'
      : esAsignada
        ? 'bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.85)]'
        : isActive
          ? 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.75)]'
          : 'bg-white/10';

  const iconClasses = esAsignada
    ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.22)]'
    : isActive
      ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-300'
      : 'border-white/10 bg-white/5 text-zinc-500 group-hover:text-zinc-300';

  return (
    <button
      type="button"
      onClick={onClick}
      className={[baseClasses, stateClasses, activeClasses].join(' ')}
    >
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${overlayClass}`} />

      <span
        className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-full transition-all duration-200 ${leftBarClass}`}
      />

      <div className="absolute right-3 top-3 flex flex-wrap items-center justify-end gap-2">
        {esAsignada && (
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-black tracking-[0.18em] text-cyan-300">
            <Mic2 className="h-3 w-3" />
            {assignedLabel}
          </span>
        )}

        {!esAsignada && assignmentLabel && (
          <span className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] font-black tracking-[0.08em] text-zinc-300">
            <UserRound className="h-3 w-3 shrink-0" />
            <span className="truncate">{assignmentLabel}</span>
          </span>
        )}

        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-black tracking-[0.18em] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
            SONANDO
          </span>
        )}
      </div>

      <div className="relative flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all duration-200 ${iconClasses}`}
        >
          {esAsignada ? <Mic2 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1 pr-24">
          <p
            className={[
              'truncate text-sm transition-colors',
              esAsignada
                ? 'font-extrabold text-white'
                : 'font-semibold text-zinc-200 group-hover:text-white',
            ].join(' ')}
          >
            {title}
          </p>

          {subtitle && (
            <p
              className={[
                'mt-1 truncate text-xs',
                esAsignada
                  ? 'text-cyan-100/80'
                  : 'text-zinc-400 group-hover:text-zinc-300',
              ].join(' ')}
            >
              {subtitle}
            </p>
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
  isSavingAssignments = false,
  saveFeedback = null,
  onBack,
  onTrackPlay,
  onSaveAssignment,
  onClearAssignment,
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
      Object.entries(songAssignments).filter(([memberId]) => memberIdSet.has(String(memberId || '').trim()))
    )
  ), [memberIdSet, songAssignments]);
  const currentAssignment = String(validSongAssignments?.[viewerMemberId]?.trackName || '').trim();

  const memberNameById = useMemo(() => {
    const entries = safeMembers.map((member) => [
      String(member?.id || ''),
      String(member?.name || member?.nombre || member?.email || 'Integrante').trim() || 'Integrante',
    ]);
    return new Map(entries.filter(([memberId]) => memberId));
  }, [safeMembers]);

  const trackAssignmentsByName = useMemo(() => {
    const assignmentsMap = new Map();

    Object.entries(validSongAssignments).forEach(([memberId, assignment]) => {
      const safeTrackName = String(assignment?.trackName || '').trim();
      if (!safeTrackName) return;

      const existing = assignmentsMap.get(safeTrackName) || [];
      existing.push({
        id: String(memberId || ''),
        name: memberNameById.get(String(memberId || '')) || 'Integrante',
        isCurrentUser: String(memberId || '') === viewerMemberId,
      });
      assignmentsMap.set(safeTrackName, existing);
    });

    return assignmentsMap;
  }, [validSongAssignments, memberNameById, viewerMemberId]);

  const tracksOrdenados = useMemo(() => (
    priorizarVozAsignada(
      safeTracks,
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

  const [activeTrackId, setActiveTrackId] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(() => (
    String(viewerMemberId || safeMembers[0]?.id || '')
  ));
  const [selectedTrackName, setSelectedTrackName] = useState(() => (
    currentAssignment || availableTrackNames[0] || ''
  ));
  const [hasManualMemberSelection, setHasManualMemberSelection] = useState(false);
  const [showAssignmentPanel, setShowAssignmentPanel] = useState(false);
  const canManageAssignments = canEdit && safeMembers.length > 0 && availableTrackNames.length > 0;

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

  const selectedTrackAssignmentOwnerId = useMemo(() => {
    return Object.keys(validSongAssignments).find((memberId) => (
      String(validSongAssignments?.[memberId]?.trackName || '').trim() === String(selectedTrackName || '').trim()
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
    validSongAssignments?.[selectedMemberId]?.trackName || ''
  ).trim();

  const handleTrackClick = (track) => {
    setActiveTrackId(track.__viewId);
    onTrackPlay?.(track);
  };

  const handleSaveAssignment = async () => {
    if (!songId || !selectedMemberId || !selectedTrackName) return;
    await onSaveAssignment?.({
      songId,
      targetUserId: String(selectedMemberId),
      trackName: String(selectedTrackName).trim(),
    });
    setHasManualMemberSelection(false);
  };

  const handleClearAssignment = async () => {
    if (!songId || !selectedMemberId) return;
    await onClearAssignment?.({
      songId,
      targetUserId: String(selectedMemberId),
    });
    setHasManualMemberSelection(false);
  };

  const selectedMemberLabel = safeMembers.find((member) => String(member?.id || '') === String(selectedMemberId || ''));
  const priorityDescription = currentAssignment
    ? 'Tu voz estara resaltada y aparecera de primera. Las voces asignadas a tus companeros quedaran debajo con su nombre.'
    : viewerMemberId
      ? 'Cuando el director te asigne una voz, aparecera aqui resaltada y de primera. Abajo veras tambien las voces de tus companeros.'
      : 'Aqui ves la asignacion vocal del equipo. Las voces asignadas se muestran con el nombre del integrante correspondiente.';

  if (!song) return null;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0b0d12] text-white">
      <header className="shrink-0 border-b border-white/8 bg-black/70 backdrop-blur-xl">
        <div
          className="mx-auto flex max-w-4xl items-start gap-4 px-4 pb-4 sm:px-5"
          style={{ paddingTop: 'max(calc(env(safe-area-inset-top) + 0.45rem), 1rem)' }}
        >
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Volver a lista de ensayo"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300/80">
              {contextTitle}
            </p>
            <h1 className="mt-2 truncate text-2xl font-black tracking-tight text-white">
              {currentSong?.title || 'Cancion'}
            </h1>
            <p className="mt-1 truncate text-sm font-medium text-zinc-400">
              {currentSong?.artist || 'Selecciona tu pista vocal'}
            </p>
          </div>

          {canManageAssignments && (
            <button
              type="button"
              onClick={() => setShowAssignmentPanel((prev) => !prev)}
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-3.5 text-sm font-black transition-all ${
                showAssignmentPanel
                  ? 'border-cyan-400/45 bg-cyan-400/14 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.14)]'
                  : 'border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08] hover:text-white'
              }`}
              aria-expanded={showAssignmentPanel}
              aria-label={showAssignmentPanel ? 'Ocultar panel de asignacion' : 'Mostrar panel de asignacion'}
            >
              <Mic2 className="h-4 w-4" />
              <span>Asignar</span>
              {showAssignmentPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </header>

      {canManageAssignments && showAssignmentPanel && (
        <section className="shrink-0 border-b border-white/8 bg-[#0d1118]/94 backdrop-blur-xl">
          <div className="mx-auto max-w-4xl px-4 py-4 sm:px-5">
            <div className="rounded-[1.75rem] border border-white/10 bg-[#12161f] px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                      Asignacion por cancion
                    </p>
                    <h3 className="mt-2 text-lg font-black text-white">
                      Director: asigna una voz especifica
                    </h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      La sugerencia automatica busca coincidencias entre el nombre del track y el rol vocal del integrante, pero solo se confirma cuando guardas.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAssignmentPanel(false)}
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    Ocultar
                  </button>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <label className="flex min-w-0 flex-col gap-2">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">
                      Integrante
                    </span>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <select
                        value={selectedMemberId}
                        onChange={(event) => {
                          setSelectedMemberId(event.target.value);
                          setHasManualMemberSelection(true);
                        }}
                        className="h-12 w-full appearance-none rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-4 text-sm font-semibold text-white outline-none transition-colors focus:border-cyan-400/55"
                      >
                        {safeMembers.map((member) => (
                          <option key={member.id} value={member.id} className="bg-[#12161f] text-white">
                            {member.name}{member.roleLabel ? ` - ${member.roleLabel}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>

                  <label className="flex min-w-0 flex-col gap-2">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">
                      Voz asignada
                    </span>
                    <select
                      value={selectedTrackName}
                      onChange={(event) => {
                        setSelectedTrackName(event.target.value);
                        setHasManualMemberSelection(false);
                      }}
                      className="h-12 w-full appearance-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white outline-none transition-colors focus:border-cyan-400/55"
                    >
                      {availableTrackNames.map((trackName) => (
                        <option key={trackName} value={trackName} className="bg-[#12161f] text-white">
                          {trackName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={handleSaveAssignment}
                      disabled={isSavingAssignments || !selectedMemberId || !selectedTrackName}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.22)] transition-all hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {isSavingAssignments ? 'Guardando...' : 'Guardar'}
                    </button>

                    {selectedMemberAssignment && (
                      <button
                        type="button"
                        onClick={handleClearAssignment}
                        disabled={isSavingAssignments}
                        className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-white/8 bg-black/20 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                    Estado actual
                  </p>
                  <p className="mt-1 text-sm text-zinc-200">
                    {selectedMemberLabel?.name || 'Integrante'}: {selectedMemberAssignment || 'sin voz asignada'}
                  </p>
                  {smartSuggestedMemberId && !selectedTrackAssignmentOwnerId && (
                    <p className="mt-1 text-xs text-cyan-300/80">
                      Sugerencia automatica: {safeMembers.find((member) => String(member?.id || '') === smartSuggestedMemberId)?.name || 'Integrante'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <main
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-5"
        style={{ paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 1rem), 1rem)' }}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <section className="overflow-hidden rounded-[2rem] border border-cyan-400/14 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_45%),linear-gradient(180deg,_rgba(18,23,34,0.96),_rgba(14,18,27,0.96))] px-5 py-5 shadow-[0_24px_80px_rgba(2,6,23,0.46)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                  Prioridad vocal
                </p>
                <h2 className="mt-2 text-lg font-black text-white">
                  {currentAssignment || 'Aun sin voz asignada'}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {priorityDescription}
                </p>
              </div>

              <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Vista activa
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-200">
                  {tracksParaVista.length} pistas vocales listas
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            {tracksParaVista.length > 0 ? (
              tracksParaVista.map((track, index) => {
                const assignedMembers = Array.isArray(track?.assignedMembers) ? track.assignedMembers : [];
                const assignedOthers = assignedMembers.filter((member) => member && member.isCurrentUser !== true);
                const assignedOthersText = formatAssignedMembersText(assignedOthers);
                const subtitle = track?.esAsignada
                  ? 'Tu voz asignada para este ensayo'
                  : assignedOthersText
                    ? `Asignada a ${assignedOthersText}`
                    : 'Disponible para practica libre';

                const assignmentLabel = !track?.esAsignada && assignedOthers.length > 0
                  ? assignedOthersText
                  : '';

                return (
                  <TrackButton
                    key={track.__viewId}
                    track={track}
                    title={getTrackDisplayName(track) || `Voz ${index + 1}`}
                    subtitle={subtitle}
                    assignmentLabel={assignmentLabel}
                    isActive={activeTrackId === track.__viewId}
                    onClick={() => handleTrackClick(track)}
                  />
                );
              })
            ) : (
              <div className="rounded-[1.6rem] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center">
                <p className="text-sm font-semibold text-zinc-300">
                  Esta cancion no tiene pistas vocales estructuradas para la vista personal.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
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
                ? 'border-red-400/25 bg-red-500/12 text-red-200'
                : 'border-emerald-400/25 bg-emerald-500/12 text-emerald-100'
            }`}
          >
            {saveFeedback.message}
          </div>
        </div>
      )}
    </div>
  );
}
