import { readFile, writeFile } from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Patch target not found: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Patch target is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const viewPath = 'src/components/react/LiveDirectorView.tsx';
let view = await readFile(viewPath, 'utf8');

view = replaceOnce(
  view,
`import {
  isGuideRoutingTrack,
  resolveTrackOutputRoute,
  toggleGuideTrackOutputRoute,
  type TrackOutputRoute,
} from '../../utils/liveDirectorTrackRouting';`,
`import {
  isGuideRoutingTrack,
  nextLiveDirectorOutputLayout,
  resolveTrackOutputRoute,
  resolveTrackOutputRouteForLayout,
  toggleGuideTrackOutputRoute,
  type LiveDirectorOutputLayout,
  type TrackOutputRoute,
} from '../../utils/liveDirectorTrackRouting';`,
  'routing imports',
);

view = replaceOnce(
  view,
`const STEM_PRIORITY_RULES: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 0, pattern: /\\b(click|metronom[oe]?)\\b/i },`,
`const STEM_PRIORITY_RULES: Array<{ rank: number; pattern: RegExp }> = [
  { rank: 0, pattern: /\\b(click|clic|clcik|tempo|metro|metronom[oe]?)\\b/i },`,
  'click/metro priority',
);

view = replaceOnce(
  view,
`function isCongregationCueTrack(track: { name?: string; label?: string; id?: string }): boolean {
  return stemPriorityRank(track) <= 1;
}
`,
`function isCongregationCueTrack(track: { name?: string; label?: string; id?: string }): boolean {
  return stemPriorityRank(track) <= 1;
}

function mixerRoleRank(track: { name?: string; label?: string; id?: string }): number {
  const priority = stemPriorityRank(track);
  if (priority === 0) return 0;
  if (priority === 1) return 1;
  return 2;
}
`,
  'mixer role ordering helper',
);

view = replaceOnce(
  view,
`const buildTrackOutputRouteMap = (
  tracks: Array<Pick<TrackData, 'id' | 'name' | 'outputRoute'>>,
): Record<string, TrackOutputRoute> => (
  tracks.reduce<Record<string, TrackOutputRoute>>((routes, track) => {
    routes[track.id] = resolveTrackOutputRoute(track);
    return routes;
  }, {})
);`,
`const buildTrackOutputRouteMap = (
  tracks: Array<Pick<TrackData, 'id' | 'name' | 'sourceFileName' | 'outputRoute'>>,
  layout: LiveDirectorOutputLayout = 'guide-left',
): Record<string, TrackOutputRoute> => (
  tracks.reduce<Record<string, TrackOutputRoute>>((routes, track) => {
    routes[track.id] = resolveTrackOutputRouteForLayout(track, layout);
    return routes;
  }, {})
);`,
  'canonical route map',
);

view = replaceOnce(
  view,
`  const [mutedTrackIds, setMutedTrackIds] = useState<Set<string>>(new Set());
  const [trackOutputRoutes, setTrackOutputRoutes] = useState<Record<string, TrackOutputRoute>>({});
  const [soloTrackIds, setSoloTrackIds] = useState<Set<string>>(() => new Set());`,
`  const [mutedTrackIds, setMutedTrackIds] = useState<Set<string>>(new Set());
  const [outputLayout, setOutputLayout] = useState<LiveDirectorOutputLayout>('guide-left');
  const [trackOutputRoutes, setTrackOutputRoutes] = useState<Record<string, TrackOutputRoute>>({});
  const [soloTrackIds, setSoloTrackIds] = useState<Set<string>>(() => new Set());`,
  'output layout state',
);

view = replaceOnce(
  view,
`  const trackRouteSeedSignature = useMemo(
    () => sessionTracks
      .map((track) => \`${'${track.id}:${track.name}:${resolveTrackOutputRoute(track)}'}\`)
      .join('|'),
    [sessionTracks],
  );

  const seededTrackOutputRoutes = useMemo(
    () => buildTrackOutputRouteMap(sessionTracks),
    [trackRouteSeedSignature],
  );`,
`  const trackRouteSeedSignature = useMemo(
    () => sessionTracks
      .map((track) => \`${'${track.id}:${track.name}:${track.sourceFileName || ""}'}\`)
      .join('|'),
    [sessionTracks],
  );

  const seededTrackOutputRoutes = useMemo(
    () => buildTrackOutputRouteMap(sessionTracks, outputLayout),
    [outputLayout, trackRouteSeedSignature],
  );`,
  'route seeding',
);

view = replaceOnce(
  view,
`  const transportIdentity = \`${'${String(activeQueueSongId || songId || "").trim()}:${isManualTempoMode ? "tempo" : "stems"}'}\`;
  useEffect(() => {
    autoPadStartedForTransportRef.current = '';
    stopEngineRef.current();
  }, [transportIdentity]);`,
`  const transportIdentity = \`${'${String(activeQueueSongId || songId || "").trim()}:${isManualTempoMode ? "tempo" : "stems"}'}\`;
  useEffect(() => {
    autoPadStartedForTransportRef.current = '';
    setOutputLayout('guide-left');
    stopEngineRef.current();
  }, [transportIdentity]);`,
  'default output layout per song',
);

view = replaceOnce(
  view,
`      const showRouteFlip = !isManualClickTrack && isGuideRoutingTrack(track);`,
`      const showRouteFlip = false;`,
  'hide per-track route buttons',
);

view = replaceOnce(
  view,
`    if (resolvedPadUrl || isPadActive) {`,
`    resolvedMixerTracks.sort((a, b) => mixerRoleRank(a) - mixerRoleRank(b));

    if (resolvedPadUrl || isPadActive) {`,
  'mixer visual ordering',
);

const globalHandlerAnchor = `  const handleInternalPadVolumeChange = useCallback((nextVolume: number) => {`;
const globalHandler = `  const handleCycleOutputLayout = useCallback(() => {
    if (!hasTrackSession) {
      return;
    }

    const nextLayout = nextLiveDirectorOutputLayout(outputLayout);
    const sourceTracks = hasProvidedTracks ? sessionTracks : manualSession?.tracks || [];
    const nextRoutes = buildTrackOutputRouteMap(sourceTracks, nextLayout);
    const activeIds = new Set(activeTracks.map((track) => track.id));

    setOutputLayout(nextLayout);
    setTrackOutputRoutes(nextRoutes);

    sourceTracks.forEach((track) => {
      if (activeIds.has(track.id)) {
        setTrackOutputRoute(track.id, nextRoutes[track.id]);
      }
    });

    if (!manualSession) {
      return;
    }

    const nextTracks = manualSession.tracks.map((track) => ({
      ...track,
      outputRoute: nextRoutes[track.id] ?? resolveTrackOutputRouteForLayout(track, nextLayout),
    }));

    setManualSession((previous) => (
      previous ? { ...previous, tracks: nextTracks } : previous
    ));

    if (hasPersistedSongContext && !usesEventMixPersistence) {
      queueSilentSessionSave(buildSessionSavePayload({
        mode: manualSession.mode,
        tracks: nextTracks,
        unmatchedFiles: manualSession.unmatchedFiles || [],
        sectionOffsetSeconds: Number(manualSession.sectionOffsetSeconds) || 0,
      }));
    }
  }, [
    activeTracks,
    buildSessionSavePayload,
    hasPersistedSongContext,
    hasProvidedTracks,
    hasTrackSession,
    manualSession,
    outputLayout,
    queueSilentSessionSave,
    sessionTracks,
    setTrackOutputRoute,
    usesEventMixPersistence,
  ]);

  const outputLayoutLabel = outputLayout === 'guide-right'
    ? 'STEMS L · CLICK+GUÍA R'
    : 'CLICK+GUÍA L · STEMS R';

`;
view = replaceOnce(view, globalHandlerAnchor, globalHandler + globalHandlerAnchor, 'global output-layout handler');

view = replaceOnce(
  view,
`              <div className={\`mt-4 grid gap-2 ${'${useWideTrackLoadModal ? \'grid-cols-[1fr_1fr_auto] items-stretch\' : \'grid-cols-2\'}'}\`}>`,
`              <div className={\`mt-4 grid gap-2 ${'${useWideTrackLoadModal ? \'grid-cols-[1fr_1fr_1.35fr_auto] items-stretch\' : \'grid-cols-2\'}'}\`}>`,
  'stem settings grid columns',
);

const safeCard = `                <div className="rounded-[1rem] border border-white/8 bg-black/24 px-3 py-2.5">
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/36">Seguro</p>
                  <p className="mt-0.5 text-[1.15rem] font-semibold leading-none text-white/88">
                    {sessionActiveTrackLimit >= sessionTracks.length ? 'Todos' : sessionActiveTrackLimit}
                  </p>
                </div>`;
const routingCard = `${safeCard}
                <button
                  type="button"
                  onClick={handleCycleOutputLayout}
                  disabled={!hasTrackSession}
                  className={\`ui-pressable-soft rounded-[1rem] border border-cyan-300/18 bg-cyan-300/[0.07] px-3 py-2.5 text-left text-cyan-50 transition-all hover:border-cyan-300/30 hover:bg-cyan-300/[0.11] disabled:cursor-not-allowed disabled:opacity-40 ${'${useWideTrackLoadModal ? \'\' : \'col-span-2\'}'}\`}
                  aria-label={\`Cambiar distribución de salida. Actual: ${'${outputLayoutLabel}'}\`}
                  title="Toca para invertir Click/Guía y stems entre L/R"
                >
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-cyan-100/52">Salida L/R</p>
                  <p className="mt-0.5 text-[0.78rem] font-semibold leading-tight text-cyan-50">
                    {outputLayoutLabel}
                  </p>
                </button>`;
view = replaceOnce(view, safeCard, routingCard, 'single global routing button');

await writeFile(viewPath, view, 'utf8');

const testPath = 'scripts/test-live-director-hard-output-routing.mjs';
let test = await readFile(testPath, 'utf8');
test = replaceOnce(
  test,
`import {
  isGuideRoutingTrack,
  resolveTrackOutputRoute,
} from '../src/utils/liveDirectorTrackRouting.ts';`,
`import {
  isGuideRoutingTrack,
  nextLiveDirectorOutputLayout,
  resolveTrackOutputRoute,
  resolveTrackOutputRouteForLayout,
} from '../src/utils/liveDirectorTrackRouting.ts';`,
  'routing test imports',
);

const normalTrackAssertion = `assert.equal(
  resolveTrackOutputRoute({ name: 'Batería', sourceFileName: 'Drums.m4a' }),
  'stereo',
  'Una pista musical normal debe conservar stereo',
);`;
const layoutAssertions = `${normalTrackAssertion}

assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Click' }, 'guide-left'),
  'left',
  'El layout por defecto debe enviar Click/Metro a L',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Guía' }, 'guide-left'),
  'left',
  'El layout por defecto debe enviar la guía a L',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Batería' }, 'guide-left'),
  'right',
  'El layout por defecto debe enviar instrumentos a R',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Click' }, 'guide-right'),
  'right',
  'El layout invertido debe enviar Click/Metro a R',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Guía' }, 'guide-right'),
  'right',
  'El layout invertido debe enviar la guía a R',
);
assert.equal(
  resolveTrackOutputRouteForLayout({ name: 'Batería' }, 'guide-right'),
  'left',
  'El layout invertido debe enviar instrumentos a L',
);
assert.equal(nextLiveDirectorOutputLayout('guide-left'), 'guide-right');
assert.equal(nextLiveDirectorOutputLayout('guide-right'), 'guide-left');`;
test = replaceOnce(test, normalTrackAssertion, layoutAssertions, 'global output layout tests');
await writeFile(testPath, test, 'utf8');

console.log('Live Director output-layout patch applied.');
