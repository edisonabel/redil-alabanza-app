import { readFile, writeFile } from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Patch target not found: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
};

// ---------------------------------------------------------------------------
// Repertorio: create a persisted custom playlist and share a compact URL.
// ---------------------------------------------------------------------------
const repertorioPath = 'src/pages/repertorio.astro';
let repertorio = await readFile(repertorioPath, 'utf8');

repertorio = replaceOnce(
  repertorio,
  "import { safeHtml } from '../lib/client/html-safety.js';",
  "import { safeHtml } from '../lib/client/html-safety.js';\nimport { buildCustomSetlistPath } from '../utils/customSetlistShare';",
  'repertorio custom share import',
);

repertorio = replaceOnce(
  repertorio,
` if (btnCopySetlist) {
 addListener(btnCopySetlist, 'click', () => {
 const base64Str = btoa(encodeURIComponent(JSON.stringify(setlist)));
 const url = window.location.origin + window.location.pathname + '?setlist=' + encodeURIComponent(base64Str);
 navigator.clipboard.writeText(url).then(() => {
 alert('\\u00A1Setlist copiado y abierto en una nueva pesta\\u00F1a!');
 window.open(url, '_blank');
 });
 });
 }`,
` if (btnCopySetlist) {
 addListener(btnCopySetlist, 'click', async () => {
 const copyButton = btnCopySetlist as HTMLButtonElement;
 if (copyButton.disabled || setlist.length === 0) return;

 const originalLabel = copyButton.textContent || 'Copiar Enlace';
 copyButton.disabled = true;
 copyButton.textContent = 'Creando...';
 let createdPlaylistId = '';

 try {
  const selectedSongIds = setlist
   .map((songTitle) => {
    const matchingCard = Array.from(cards).find((card) => {
     const addButton = card.querySelector<HTMLElement>('.btn-add-setlist');
     return String(addButton?.getAttribute('data-cancion') || '').trim() === String(songTitle || '').trim();
    });
    const addButton = matchingCard?.querySelector<HTMLElement>('.btn-add-setlist');
    return String(addButton?.getAttribute('data-id') || matchingCard?.getAttribute('data-id') || '').trim();
   })
   .filter(Boolean);

  if (selectedSongIds.length !== setlist.length) {
   throw new Error('No fue posible resolver todas las canciones seleccionadas.');
  }

  const { data: playlistRow, error: playlistError } = await supabase
   .from('playlists')
   .insert({ evento_id: null })
   .select('id')
   .single();

  if (playlistError || !playlistRow?.id) {
   throw playlistError || new Error('No fue posible crear la setlist personalizada.');
  }

  createdPlaylistId = String(playlistRow.id);
  const playlistItems = selectedSongIds.map((cancionId, orden) => ({
   playlist_id: createdPlaylistId,
   cancion_id: cancionId,
   orden,
  }));

  const { error: itemsError } = await supabase
   .from('playlist_canciones')
   .insert(playlistItems);

  if (itemsError) throw itemsError;

  const customPath = buildCustomSetlistPath(createdPlaylistId);
  if (!customPath) throw new Error('No fue posible generar el enlace corto.');

  const url = new URL(customPath, window.location.origin).toString();
  let copied = false;
  try {
   if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    copied = true;
   }
  } catch (clipboardError) {
   console.warn('No se pudo copiar automáticamente el enlace de la setlist:', clipboardError);
  }

  if (!copied) {
   window.prompt('Copia el enlace de tu setlist personalizada:', url);
  }

  alert(copied
   ? '\\u00A1Setlist personalizada creada y enlace copiado!'
   : '\\u00A1Setlist personalizada creada!');
  window.open(url, '_blank', 'noopener,noreferrer');
 } catch (error) {
  if (createdPlaylistId) {
   await supabase.from('playlists').delete().eq('id', createdPlaylistId);
  }
  console.error('Error creando setlist personalizada:', error);
  alert('No se pudo crear la setlist personalizada. Intenta de nuevo.');
 } finally {
  copyButton.disabled = false;
  copyButton.textContent = originalLabel;
 }
 });
 }`,
  'repertorio custom setlist creation',
);

await writeFile(repertorioPath, repertorio, 'utf8');

// ---------------------------------------------------------------------------
// Ensayo route: recognize compact custom-playlist IDs and load them directly.
// ---------------------------------------------------------------------------
const ensayoPath = 'src/pages/ensayo/[id].astro';
let ensayo = await readFile(ensayoPath, 'utf8');

ensayo = replaceOnce(
  ensayo,
  "import { pickPreferredVoicePayload } from '../../utils/voicePayload.js';",
  "import { pickPreferredVoicePayload } from '../../utils/voicePayload.js';\nimport { parseCustomSetlistRouteId } from '../../utils/customSetlistShare';",
  'ensayo custom share import',
);

ensayo = replaceOnce(
  ensayo,
`const routeId = String(id || 'demo').trim();
const routeIsDemo = routeId === 'demo';
const routeIsUuid = isUuidLike(routeId);`,
`const routeId = String(id || 'demo').trim();
const routeIsDemo = routeId === 'demo';
const customPlaylistId = parseCustomSetlistRouteId(routeId);
const isCustomSetlist = Boolean(customPlaylistId);
const routeIsUuid = isUuidLike(routeId);`,
  'ensayo custom route detection',
);

ensayo = replaceOnce(
  ensayo,
  'if (!routeIsDemo) {',
  'if (!routeIsDemo && !isCustomSetlist) {',
  'skip event lookup for custom setlist',
);

const customLoader = `

if (isCustomSetlist && customPlaylistId) {
  const { data: customPlaylist, error: customPlaylistError } = await supabaseSSR
    .from('playlists')
    .select('id')
    .eq('id', customPlaylistId)
    .is('evento_id', null)
    .maybeSingle();

  if (customPlaylistError) {
    console.error('Ensayo custom playlist query error:', customPlaylistError);
  }

  if (customPlaylist?.id) {
    playlistDbId = String(customPlaylist.id);
    canEditSetlist = true;

    const { data: customItems, error: customItemsError } = await supabaseSSR
      .from('playlist_canciones')
      .select('orden, cancion_id, canciones(id, titulo, cantante, tonalidad, bpm, categoria, voz, mp3, voces, link_voces, link_secuencias, chordpro, section_markers, voice_track_anchors, multitrack_session)')
      .eq('playlist_id', customPlaylist.id)
      .order('orden', { ascending: true });

    if (customItemsError) {
      console.error('Ensayo custom playlist_canciones query error:', customItemsError);
    } else {
      const seenSongs = new Set<string>();
      playlistSongs = await Promise.all((customItems || [])
        .filter((item: any) => {
          const songId = item?.cancion_id || item?.canciones?.id;
          const songKey = String(songId || '');
          if (!songKey || seenSongs.has(songKey)) return false;
          seenSongs.add(songKey);
          return true;
        })
        .map((item: any, index: number) => buildSongFromRow(item.canciones, index)));
    }
  }
}
`;

ensayo = replaceOnce(
  ensayo,
`}

const rehearsalSongs =`,
`}${customLoader}
const rehearsalSongs =`,
  'custom playlist loader',
);

ensayo = replaceOnce(
  ensayo,
`const rehearsalSongs =
  playlistSongs.length > 0
    ? playlistSongs
    : routeIsDemo
      ? [MOCK_CANCION_ENSAYO]
      : [
          createFallbackSong({
            songId: \`fallback-\${routeId}\`,
            title: getEventThemeAndPreacher(eventData || {}, 'Setlist pendiente').theme || 'Setlist pendiente',
            message: eventData?.id
              ? 'Este servicio todav\\u00eda no tiene canciones listas para el modo ensayo.'
              : 'No encontramos el evento solicitado o a\\u00fan no tiene repertorio cargado.',
          }),
        ];`,
`const rehearsalSongs =
  playlistSongs.length > 0
    ? playlistSongs
    : routeIsDemo
      ? [MOCK_CANCION_ENSAYO]
      : isCustomSetlist
        ? [
            createFallbackSong({
              songId: \`fallback-custom-\${routeId}\`,
              title: 'Setlist personalizada',
              message: 'No encontramos canciones disponibles para esta setlist personalizada.',
            }),
          ]
        : [
            createFallbackSong({
              songId: \`fallback-\${routeId}\`,
              title: getEventThemeAndPreacher(eventData || {}, 'Setlist pendiente').theme || 'Setlist pendiente',
              message: eventData?.id
                ? 'Este servicio todav\\u00eda no tiene canciones listas para el modo ensayo.'
                : 'No encontramos el evento solicitado o a\\u00fan no tiene repertorio cargado.',
            }),
          ];`,
  'custom playlist fallback',
);

ensayo = replaceOnce(
  ensayo,
`const initialSongId = Astro.url.searchParams.get('song') || null;
const monitorUrl = new URL(\`/monitor/\${routeId}\`, Astro.url).toString();
const { theme: contextTheme, preacher: contextPreacher } = getEventThemeAndPreacher(eventData || {}, 'Modo Ensayo');
const contextTitle = contextTheme || 'Modo Ensayo';
const pageTitle = \`\${buildEventHeadline(eventData || {}, 'Modo Ensayo')} | Modo Ensayo\`;
const pageDescription = eventData?.id
  ? \`Vista de ensayo para \${buildEventHeadline(eventData || {}, contextTitle)}.\`
  : 'Vista de ensayo enfocada para leer acordes y letras en vivo.';`,
`const initialSongId = Astro.url.searchParams.get('song') || null;
const monitorUrl = isCustomSetlist ? '' : new URL(\`/monitor/\${routeId}\`, Astro.url).toString();
const customShareUrl = isCustomSetlist ? new URL(Astro.url.pathname, Astro.url).toString() : '';
const { theme: contextTheme, preacher: contextPreacher } = getEventThemeAndPreacher(eventData || {}, 'Modo Ensayo');
const contextTitle = isCustomSetlist ? 'Setlist personalizada' : (contextTheme || 'Modo Ensayo');
const pageTitle = isCustomSetlist
  ? 'Setlist personalizada | Modo Ensayo'
  : \`\${buildEventHeadline(eventData || {}, 'Modo Ensayo')} | Modo Ensayo\`;
const pageDescription = isCustomSetlist
  ? 'Setlist personalizada con las herramientas completas del modo ensayo.'
  : eventData?.id
    ? \`Vista de ensayo para \${buildEventHeadline(eventData || {}, contextTitle)}.\`
    : 'Vista de ensayo enfocada para leer acordes y letras en vivo.';`,
  'custom playlist presentation',
);

ensayo = replaceOnce(
  ensayo,
`      initialSongVoiceAssignments={initialSongVoiceAssignments}
    />`,
`      initialSongVoiceAssignments={initialSongVoiceAssignments}
      isCustomSetlist={isCustomSetlist}
      shareUrl={customShareUrl}
    />`,
  'pass custom playlist UI props',
);

await writeFile(ensayoPath, ensayo, 'utf8');

// ---------------------------------------------------------------------------
// EnsayoHub: same rehearsal UI, custom title + share button only.
// ---------------------------------------------------------------------------
const hubPath = 'src/components/react/EnsayoHub.jsx';
let hub = await readFile(hubPath, 'utf8');

hub = replaceOnce(
  hub,
  "import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock3, ExternalLink, GripVertical, ListMusic, Loader2, Mic2, Play, Plus, Printer, RadioReceiver, X, Zap } from 'lucide-react';",
  "import { ArrowLeft, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock3, ExternalLink, GripVertical, ListMusic, Loader2, Mic2, Play, Plus, Printer, RadioReceiver, Share2, X, Zap } from 'lucide-react';",
  'EnsayoHub share icon import',
);

hub = replaceOnce(
  hub,
`  rosterMembers = [],
  initialSongVoiceAssignments = {},
}) {`,
`  rosterMembers = [],
  initialSongVoiceAssignments = {},
  isCustomSetlist = false,
  shareUrl = '',
}) {`,
  'EnsayoHub custom props',
);

hub = replaceOnce(
  hub,
`  const [prayerText, setPrayerText] = useState('');
  const [prayerTitle, setPrayerTitle] = useState('Oración de Confesión');`,
`  const [prayerText, setPrayerText] = useState('');
  const [prayerTitle, setPrayerTitle] = useState('Oración de Confesión');
  const [shareCopied, setShareCopied] = useState(false);`,
  'EnsayoHub share state',
);

hub = replaceOnce(
  hub,
`  const handleListBack = useCallback(() => {
    window.location.href = '/';
  }, []);`,
`  const handleShareCustomSetlist = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const url = String(shareUrl || window.location.href).trim();
    if (!url) return;

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
    } catch {
      window.prompt('Copia el enlace de tu setlist personalizada:', url);
    }
  }, [shareUrl]);

  const handleListBack = useCallback(() => {
    window.location.href = isCustomSetlist ? '/repertorio' : '/';
  }, [isCustomSetlist]);`,
  'EnsayoHub custom share handler',
);

hub = replaceOnce(
  hub,
`              <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                    Setlist de Ensayo
                  </p>
                  <h1 className="mt-2 text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 md:text-4xl">
                    {displayContextTitle}
                  </h1>`,
`              <div className="min-w-0">
                  {!isCustomSetlist && (
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-500 dark:text-zinc-400">
                      Setlist de Ensayo
                    </p>
                  )}
                  <h1 className={\`${'${isCustomSetlist ? "" : "mt-2 "}'}text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 md:text-4xl\`}>
                    {displayContextTitle}
                  </h1>`,
  'EnsayoHub custom header title',
);

hub = replaceOnce(
  hub,
`                  </div>
                </div>

              </div>
            </div>
        </div>
        </header>`,
`                  </div>
                </div>

              </div>

              {isCustomSetlist && (
                <button
                  type="button"
                  onClick={handleShareCustomSetlist}
                  className="ui-pressable-soft col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-700 shadow-sm transition-colors hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15 md:col-span-1 md:col-start-3 md:row-start-1"
                  aria-label="Compartir setlist personalizada"
                >
                  <Share2 className="h-4 w-4" />
                  {shareCopied ? 'Copiado' : 'Compartir'}
                </button>
              )}
            </div>
        </div>
        </header>`,
  'EnsayoHub custom share button',
);

await writeFile(hubPath, hub, 'utf8');

console.log('Custom setlist rehearsal patch applied.');
