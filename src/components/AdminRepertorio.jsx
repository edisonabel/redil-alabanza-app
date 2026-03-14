import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, UploadCloud, Loader2, Plus, PencilLine, X, Save, Pause, Play } from 'lucide-react';

const { useRef } = React;

const SECTION_LABEL_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const PURE_SECTION_HEADER_RE = /^\[([^\[\]]+)\]$/;
const CHORD_BODY_PATTERN = '[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?)?';
const CHORD_TOKEN_RE = new RegExp(`^\\(?\\s*(\\[${CHORD_BODY_PATTERN}\\]\\s*)+\\)?\\s*$`, 'i');
const CHORD_SYMBOL_RE = new RegExp(`^${CHORD_BODY_PATTERN}$`, 'i');
const LEADING_CHORD_SECTION_RE = new RegExp(`^\\[(${CHORD_BODY_PATTERN})\\|`, 'i');
const BROKEN_INLINE_CHORD_RE = new RegExp(`\\[(${CHORD_BODY_PATTERN})\\s*\\|\\s*`, 'gi');
const EDITOR_MODAL_MAX_HEIGHT = 'min(90vh, calc(100dvh - 9.5rem - env(safe-area-inset-bottom)))';

const normalizeSectionName = (rawValue = '') => {
  const cleaned = String(rawValue).trim();
  if (!cleaned) return 'Seccion';

  const normalized = cleaned.toLowerCase();
  if (normalized === 'soc' || normalized === 'start_of_chorus') return 'Coro';
  if (normalized === 'sov' || normalized === 'start_of_verse') return 'Verso';
  if (normalized === 'sob' || normalized === 'start_of_bridge') return 'Puente';
  if (normalized === 'soi' || normalized === 'start_of_intro') return 'Intro';
  if (normalized === 'interlude' || normalized === 'interludio' || normalized === 'instrumental' || normalized === 'instrumental 1' || normalized === 'instrumental 2' || normalized === 'solo instrumental' || normalized === 'start_of_interlude') return 'Interludio';
  if (normalized === 'sot' || normalized === 'start_of_tag') return 'Tag';
  if (normalized === 'eoc' || normalized === 'end_of_chorus') return '';
  if (normalized === 'eov' || normalized === 'end_of_verse') return '';
  if (normalized === 'eob' || normalized === 'end_of_bridge') return '';
  if (normalized === 'eoi' || normalized === 'end_of_intro') return '';
  if (normalized === 'eot' || normalized === 'end_of_tag') return '';

  return cleaned;
};

const isLikelySectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) return false;

  if (CHORD_SYMBOL_RE.test(cleaned)) return false;

  const normalized = cleaned.toLowerCase();
  if ([
    'intro',
    'interlude',
    'interludio',
    'instrumental',
    'solo instrumental',
    'coro',
    'chorus',
    'pre coro',
    'pre-coro',
    'verse',
    'verso',
    'puente',
    'bridge',
    'tag',
    'outro',
    'final',
  ].some((label) => normalized.startsWith(label))) {
    return true;
  }

  return /\d/.test(cleaned);
};

const isRemoteChordProTextUrl = (value = '') => (
  /^https?:\/\//i.test(String(value || '').trim()) &&
  /\.(txt|pro|cho|chordpro)(\?.*)?$/i.test(String(value || '').trim())
);

const parseSectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) {
    return { name: 'Seccion', note: '' };
  }

  const [rawName, ...rawNoteParts] = cleaned.split('|');
  return {
    name: normalizeSectionName(rawName.trim()) || 'Seccion',
    note: rawNoteParts.join('|').trim(),
  };
};

const repararChordProCorrupto = (rawValue = '') => {
  if (!rawValue || typeof rawValue !== 'string') return '';

  return String(rawValue)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      let fixedLine = line;

      if (LEADING_CHORD_SECTION_RE.test(fixedLine) || BROKEN_INLINE_CHORD_RE.test(fixedLine)) {
        fixedLine = fixedLine.replace(LEADING_CHORD_SECTION_RE, '[$1]');
        fixedLine = fixedLine.replace(BROKEN_INLINE_CHORD_RE, '[$1]');
        fixedLine = fixedLine.replace(/(?:\s*\|\s*)+\]+\s*$/, '');
      }

      BROKEN_INLINE_CHORD_RE.lastIndex = 0;
      return fixedLine;
    })
    .join('\n');
};

const normalizarChordPro = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'string') return '';

  return repararChordProCorrupto(rawValue)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const trimmedLine = line.trimEnd();
      const sectionMatch = trimmedLine.match(SECTION_LABEL_RE);

      if (!sectionMatch) return [trimmedLine];

      const [, sectionName = '', rest = ''] = sectionMatch;
      if (!isLikelySectionHeader(sectionName)) {
        return [trimmedLine];
      }

      const parsedSection = parseSectionHeader(sectionName);
      const normalizedSection = parsedSection.note
        ? `[${parsedSection.name}|${parsedSection.note}]`
        : `[${parsedSection.name}]`;
      const normalizedRest = rest.trim();

      if (!normalizedRest) return [normalizedSection];

      if (CHORD_TOKEN_RE.test(normalizedRest)) {
        return [normalizedSection, normalizedRest.replace(/\s{2,}/g, ' ').trim()];
      }

      return [`[${parsedSection.name}|${parsedSection.note ? `${parsedSection.note} | ${normalizedRest}` : normalizedRest}]`];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const parseChordProSections = (rawChordpro = '') => {
  const content = String(rawChordpro || '').replace(/\r\n/g, '\n').trim();
  if (!content) return [];

  const sections = [];
  let currentSection = { name: 'Letra', note: '', lines: [] };

  const pushCurrentSection = () => {
    const sectionName = String(currentSection.name || '').trim();
    const shouldKeepEmptyNamedSection = sectionName && sectionName.toLowerCase() !== 'letra';
    if (currentSection.lines.length === 0 && !currentSection.note && !shouldKeepEmptyNamedSection) return;
    sections.push({
      name: sectionName || 'Letra',
      note: currentSection.note || '',
      lines: [...currentSection.lines],
    });
  };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;

    const inlineSectionMatch = trimmed.match(SECTION_LABEL_RE);
    if (inlineSectionMatch && isLikelySectionHeader(inlineSectionMatch[1])) {
      pushCurrentSection();
      const nextSection = parseSectionHeader(inlineSectionMatch[1]);
      const inlineRest = String(inlineSectionMatch[2] || '').trim();

      currentSection = {
        name: nextSection.name,
        note: nextSection.note,
        lines: [],
      };

      if (inlineRest) {
        if (CHORD_TOKEN_RE.test(inlineRest)) {
          currentSection.lines.push(inlineRest.replace(/\s{2,}/g, ' ').trim());
        } else {
          currentSection.note = currentSection.note
            ? `${currentSection.note} | ${inlineRest}`
            : inlineRest;
        }
      }
      continue;
    }

    const sectionLineMatch = trimmed.match(PURE_SECTION_HEADER_RE);
    if (sectionLineMatch && isLikelySectionHeader(sectionLineMatch[1])) {
      pushCurrentSection();
      const nextSection = parseSectionHeader(sectionLineMatch[1]);
      currentSection = {
        name: nextSection.name,
        note: nextSection.note,
        lines: [],
      };
      continue;
    }

    const directiveMatch = trimmed.match(/^\{([^}:]+)(?::\s*(.+))?\}$/);
    if (directiveMatch) {
      const rawDirectiveName = String(directiveMatch[1] || '').trim();
      const directiveKey = rawDirectiveName.toLowerCase();
      const directiveName = normalizeSectionName(rawDirectiveName);
      const directiveValue = directiveMatch[2]?.trim() || '';

      if (['title', 'artist', 'subtitle', 'key', 'tempo', 'bpm', 'capo'].includes(directiveKey)) {
        continue;
      }

      if (directiveKey === 'comment' || directiveKey === 'c') {
        if (!currentSection.note && directiveValue) {
          currentSection.note = directiveValue;
        } else if (directiveValue) {
          currentSection.lines.push(directiveValue);
        }
        continue;
      }

      if (directiveName) {
        pushCurrentSection();
        const nextSection = parseSectionHeader(directiveValue || directiveName);
        currentSection = {
          name: nextSection.name,
          note: nextSection.note,
          lines: [],
        };
      }
      continue;
    }

    currentSection.lines.push(line);
  }

  pushCurrentSection();
  return sections;
};

const formatMarkerTime = (value) => {
  const totalSeconds = Math.floor(Math.max(0, Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const parseMarkerTime = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.max(0, Math.round(Number(value)));
  }

  const parts = value.split(':').map((part) => part.trim());
  if (parts.length === 2 && parts.every((part) => /^\d+$/.test(part))) {
    return Math.max(0, Number(parts[0]) * 60 + Number(parts[1]));
  }

  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return Math.max(0, Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]));
  }

  return null;
};

const normalizeSectionMarkers = (sections = [], rawMarkers = []) => {
  const markerGroups = (Array.isArray(rawMarkers) ? rawMarkers : [])
    .filter(Boolean)
    .reduce((acc, marker, index) => {
      const key = String(marker?.sectionName || marker?.name || '').trim().toLowerCase() || `marker-${index}`;
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(marker);
      return acc;
    }, new Map());

  const markerOccurrences = new Map();

  return sections.map((section, index) => {
    const sectionName = String(section?.name || `Seccion ${index + 1}`).trim();
    const normalizedSectionName = sectionName.toLowerCase();
    const nextOccurrence = markerOccurrences.get(normalizedSectionName) || 0;
    const groupedMarkers = markerGroups.get(normalizedSectionName) || [];
    const existingMarker = groupedMarkers[nextOccurrence] || (Array.isArray(rawMarkers) ? rawMarkers[index] : {}) || {};
    markerOccurrences.set(normalizedSectionName, nextOccurrence + 1);
    const startSec = Number(existingMarker?.startSec);
    const sectionOccurrence = nextOccurrence + 1;
    const slugBase = normalizedSectionName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `seccion-${index + 1}`;

    return {
      id: `${slugBase}-${sectionOccurrence}`,
      sectionName,
      sectionIndex: index,
      sectionOccurrence,
      sectionKey: `${slugBase}__${sectionOccurrence}`,
      startSec: Number.isFinite(startSec) ? Math.max(0, Math.round(startSec)) : null,
      note: String(existingMarker?.note || section?.note || '').trim(),
    };
  });
};

const areTimesClose = (left, right, precision = 0.25) => (
  Math.abs((Number(left) || 0) - (Number(right) || 0)) < precision
);

const EditableCell = ({ cancionId, campoBd, valorInicial, onSave, isSaving, anchoClases = "min-w-[8rem]", customInputClasses = "" }) => {
  const [valor, setValor] = useState(valorInicial || '');

  const defaultInputClasses = "w-full min-h-[44px] px-3 py-2 bg-transparent border border-transparent focus:border-brand focus:ring-1 focus:ring-brand hover:border-border transition-colors outline-none text-sm text-content truncate";
  const inputClasses = customInputClasses || defaultInputClasses;

  useEffect(() => {
    setValor(valorInicial || '');
  }, [valorInicial]);

  const handleBlur = () => {
    if (valor !== (valorInicial || '')) {
      onSave(cancionId, campoBd, valor);
    }
  };

  return (
    <div className={`relative flex items-center w-full ${anchoClases}`}>
      <input
        type="text"
        className={inputClasses}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={handleBlur}
        title={valor}
      />
      {isSaving && (
        <div className="absolute right-2 text-brand bg-surface rounded-full p-0.5 z-10">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
    </div>
  );
};

export default function AdminRepertorio() {
  const [canciones, setCanciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorTexto, setErrorTexto] = useState(null);

  // Estados
  const [uploading, setUploading] = useState({});
  const [savingCell, setSavingCell] = useState({});
  const [editorChordproAbierto, setEditorChordproAbierto] = useState(false);
  const [editorChordproCancion, setEditorChordproCancion] = useState(null);
  const [editorChordproValor, setEditorChordproValor] = useState('');
  const [editorSectionMarkers, setEditorSectionMarkers] = useState([]);
  const [editorChordproCargando, setEditorChordproCargando] = useState(false);
  const [editorChordproAviso, setEditorChordproAviso] = useState('');
  const [guardandoChordpro, setGuardandoChordpro] = useState(false);
  const [sectionMarkersDisponibles, setSectionMarkersDisponibles] = useState(true);
  const [editorAudioCurrentTime, setEditorAudioCurrentTime] = useState(0);
  const [editorAudioDuration, setEditorAudioDuration] = useState(0);
  const [editorAudioPlaying, setEditorAudioPlaying] = useState(false);
  const editorAudioCurrentTimeRef = useRef(0);
  const editorAudioDurationRef = useRef(0);
  const editorAudioFrameRef = useRef(null);

  const [sessionUser, setSessionUser] = useState(null);

  const resumenEditorChordpro = useMemo(() => {
    const lineas = editorChordproValor
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const seccionesParseadas = parseChordProSections(editorChordproValor);
    const secciones = seccionesParseadas.length;
    const seccionesConNota = seccionesParseadas.filter((section) => section.note).length;
    const ejemploMetadata = seccionesParseadas
      .filter((section) => section.note)
      .slice(0, 3)
      .map((section) => `${section.name}: ${section.note}`);

    return {
      lineas: lineas.length,
      secciones,
      seccionesConNota,
      ejemploMetadata,
    };
  }, [editorChordproValor]);

  const seccionesEditorChordpro = useMemo(() => parseChordProSections(editorChordproValor), [editorChordproValor]);

  const cancionesPendientesChordpro = useMemo(() => (
    canciones.filter((cancion) => {
      const estado = String(cancion?.estado || '').trim().toLowerCase();
      const chordpro = String(cancion?.chordpro || '').trim();
      return estado !== 'archivada' && chordpro === '';
    })
  ), [canciones]);

  useEffect(() => {
    if (!editorChordproAbierto) return;
    setEditorSectionMarkers((prev) => normalizeSectionMarkers(seccionesEditorChordpro, prev));
  }, [editorChordproAbierto, seccionesEditorChordpro]);

  useEffect(() => {
    if (!editorChordproAbierto) return undefined;
    const audio = document.getElementById('admin-chordpro-audio');
    if (!audio) return undefined;

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      editorAudioDurationRef.current = duration;
      setEditorAudioDuration((prev) => (areTimesClose(prev, duration, 0.1) ? prev : duration));
    };

    const syncCurrentTime = () => {
      editorAudioFrameRef.current = null;
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      editorAudioCurrentTimeRef.current = currentTime;
      setEditorAudioCurrentTime((prev) => (
        areTimesClose(prev, currentTime, 0.18) && Math.floor(prev) === Math.floor(currentTime)
          ? prev
          : currentTime
      ));
    };

    const handleTimeUpdate = () => {
      if (editorAudioFrameRef.current != null) return;
      editorAudioFrameRef.current = window.requestAnimationFrame(syncCurrentTime);
    };

    const handlePlay = () => setEditorAudioPlaying(true);
    const handlePause = () => setEditorAudioPlaying(false);
    const handleEnded = () => {
      setEditorAudioPlaying(false);
      setEditorAudioCurrentTime(0);
      editorAudioCurrentTimeRef.current = 0;
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      if (editorAudioFrameRef.current != null) {
        window.cancelAnimationFrame(editorAudioFrameRef.current);
        editorAudioFrameRef.current = null;
      }
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [editorChordproAbierto, editorChordproCancion?.mp3]);

  useEffect(() => {
    verificarSesion();
  }, []);

  const verificarSesion = async () => {
    try {
      setLoading(true);
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        setSessionUser(null);
        setLoading(false);
        return;
      }
      
      setSessionUser(session.user);
      await cargarCanciones();
    } catch (err) {
      console.error('Error al verificar sesion:', err);
      setSessionUser(null);
      setLoading(false);
    }
  };

  const cargarCanciones = async () => {
    try {
      const queryWithMarkers = await supabase
        .from('canciones')
        // eslint-disable-next-line max-len
        .select('id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, link_voces, link_secuencias, chordpro, section_markers')
        .order('titulo', { ascending: true });

      let data = queryWithMarkers.data;
      let error = queryWithMarkers.error;

      if (error) {
        const fallbackQuery = await supabase
          .from('canciones')
          // eslint-disable-next-line max-len
          .select('id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, link_voces, link_secuencias, chordpro')
          .order('titulo', { ascending: true });

        data = fallbackQuery.data;
        error = fallbackQuery.error;
        setSectionMarkersDisponibles(false);
      } else {
        setSectionMarkersDisponibles(true);
      }

      if (error) throw error;
      setCanciones(data || []);
    } catch (error) {
      console.error('Error al cargar:', error);
      setErrorTexto('Ocurrio un error al cargar el repertorio. Verifique sus permisos (RLS).');
    } finally {
      setLoading(false);
    }
  };

  const agregarCancion = async () => {
    try {
      setLoading(true);
      const nuevaCancion = {
        titulo: 'Nueva Cancion',
        estado: 'Activa',
      };
      const { data, error } = await supabase
        .from('canciones')
        .insert([nuevaCancion])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setCanciones(prev => [data, ...prev]);
      }
    } catch (err) {
      console.error('Error al agregar:', err);
      alert('Error al anadir la cancion.');
    } finally {
      setLoading(false);
    }
  };

  const guardarMetadata = async (cancionId, campoBd, nuevoValor) => {
    const keyContext = `${cancionId}_${campoBd}`;
    setSavingCell(prev => ({ ...prev, [keyContext]: true }));

    try {
      const updateData = { [campoBd]: nuevoValor === '' ? null : nuevoValor };
      const { error } = await supabase
        .from('canciones')
        .update(updateData)
        .eq('id', cancionId);

      if (error) throw error;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, [campoBd]: nuevoValor };
        }
        return c;
      }));
    } catch (err) {
      console.error('Error al guardar:', err);
      alert(`Error al guardar ${campoBd}`);
      // Revertir a DB value (reload) - opcional
    } finally {
      setSavingCell(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const manejarSubida = async (event, cancionId, campoBd) => {
    const file = event.target.files[0];
    if (!file) return;

    const keyContext = `${cancionId}_${campoBd}`;
    setUploading(prev => ({ ...prev, [keyContext]: true }));

    try {
      const response = await fetch('/api/get-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      });

      if (!response.ok) throw new Error('No estas autorizado o hubo un error en el servidor.');

      const { presignedUrl, publicUrl } = await response.json();

      const uploadResponse = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      if (!uploadResponse.ok) throw new Error('Fallo al subir el archivo a R2.');

      const updateData = { [campoBd]: publicUrl };
      const { error: updateError } = await supabase
        .from('canciones')
        .update(updateData)
        .eq('id', cancionId);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, [campoBd]: publicUrl };
        }
        return c;
      }));
    } catch (err) {
      console.error('Error subida:', err);
      alert(`Error multimedia: ${err.message}`);
    } finally {
      event.target.value = '';
      setUploading(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const manejarSubidaChordpro = async (event, cancionId) => {
    const file = event.target.files[0];
    if (!file) return;

    const keyContext = `${cancionId}_chordpro`;
    setUploading(prev => ({ ...prev, [keyContext]: true }));

    try {
      const contenidoRaw = await file.text();
      const contenidoNormalizado = normalizarChordPro(contenidoRaw);

      if (!contenidoNormalizado) {
        throw new Error('El archivo est\u00e1 vac\u00edo o no contiene texto v\u00e1lido.');
      }

      const { error: updateError } = await supabase
        .from('canciones')
        .update({ chordpro: contenidoNormalizado })
        .eq('id', cancionId);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, chordpro: contenidoNormalizado };
        }
        return c;
      }));
    } catch (err) {
      console.error('Error subiendo ChordPro:', err);
      alert(`Error ChordPro: ${err.message}`);
    } finally {
      event.target.value = '';
      setUploading(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const abrirEditorChordpro = async (cancion) => {
    const rawChordpro = String(cancion?.chordpro || '').trim();
    let chordproParaEditor = rawChordpro;
    let aviso = '';

    setEditorChordproCancion(cancion);
    setEditorChordproValor('');
    setEditorSectionMarkers([]);
    setEditorChordproAbierto(true);
    setEditorChordproCargando(true);
    setEditorChordproAviso('');

    if (isRemoteChordProTextUrl(rawChordpro)) {
      try {
        const response = await fetch(rawChordpro);
        if (response.ok) {
          const remoteText = (await response.text()).trim();
          if (remoteText) {
            chordproParaEditor = remoteText;
            aviso = 'Se cargo el contenido del TXT remoto para editarlo aqui.';
          } else {
            aviso = 'El TXT remoto esta vacio. Se mostro la URL original como respaldo.';
          }
        } else {
          aviso = 'No se pudo leer el TXT remoto. Se mostro la URL original como respaldo.';
        }
      } catch (_error) {
        aviso = 'Fallo la lectura del TXT remoto. Se mostro la URL original como respaldo.';
      }
    }

    const chordproReparado = repararChordProCorrupto(chordproParaEditor);
    if (chordproReparado && chordproReparado !== chordproParaEditor) {
      chordproParaEditor = chordproReparado;
      aviso = aviso
        ? `${aviso} Se corrigieron patrones ChordPro dañados para que puedas editar sin basura visual.`
        : 'Se corrigieron patrones ChordPro dañados para que puedas editar sin basura visual.';
    }

    const secciones = parseChordProSections(chordproParaEditor);
    setEditorChordproValor(chordproParaEditor);
    setEditorSectionMarkers(normalizeSectionMarkers(secciones, cancion?.section_markers || []));
    setEditorAudioCurrentTime(0);
    setEditorAudioDuration(0);
    setEditorAudioPlaying(false);
    editorAudioCurrentTimeRef.current = 0;
    editorAudioDurationRef.current = 0;
    setEditorChordproAviso(aviso);
    setEditorChordproCargando(false);
  };

  const cerrarEditorChordpro = () => {
    if (guardandoChordpro) return;
    setEditorChordproAbierto(false);
    setEditorChordproCancion(null);
    setEditorChordproValor('');
    setEditorSectionMarkers([]);
    setEditorChordproCargando(false);
    setEditorChordproAviso('');
    setEditorAudioCurrentTime(0);
    setEditorAudioDuration(0);
    setEditorAudioPlaying(false);
    editorAudioCurrentTimeRef.current = 0;
    editorAudioDurationRef.current = 0;
  };

  const guardarChordproDesdeEditor = async () => {
    if (!editorChordproCancion?.id) return;

    setGuardandoChordpro(true);

    try {
      const contenidoNormalizado = normalizarChordPro(editorChordproValor);
      const markersNormalizados = normalizeSectionMarkers(parseChordProSections(contenidoNormalizado), editorSectionMarkers);
      const updatePayload = { chordpro: contenidoNormalizado || null };

      if (sectionMarkersDisponibles) {
        updatePayload.section_markers = markersNormalizados;
      }

      const { error: updateError } = await supabase
        .from('canciones')
        .update(updatePayload)
        .eq('id', editorChordproCancion.id);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map((c) => {
        if (c.id === editorChordproCancion.id) {
          return {
            ...c,
            chordpro: contenidoNormalizado,
            section_markers: sectionMarkersDisponibles ? markersNormalizados : c.section_markers,
          };
        }
        return c;
      }));

      cerrarEditorChordpro();
    } catch (err) {
      console.error('Error guardando ChordPro:', err);
      alert(`Error ChordPro: ${err.message}`);
    } finally {
      setGuardandoChordpro(false);
    }
  };

  const renderizarCeldaArchivo = (cancion, campoBd) => {
    const valor = cancion[campoBd];
    const keyContext = `${cancion.id}_${campoBd}`;
    const estaCargando = uploading[keyContext];
    const esChordPro = campoBd === 'chordpro';

    if (estaCargando) {
      return (
        <div className="flex justify-center items-center h-full text-brand min-w-[8rem]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      );
    }

    if (valor && valor.trim() !== '' && !esChordPro) {
      return (
        <div className="flex justify-center items-center h-full text-green-500 min-w-[8rem]" title={valor}>
          <CheckCircle className="w-5 h-5" />
        </div>
      );
    }

    if (esChordPro) {
        return (
          <div className="inline-flex w-full min-w-[17rem] flex-nowrap items-center justify-center gap-2 py-1 px-2">
            <label
              className={`cursor-pointer group inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface text-action transition-all shadow-sm whitespace-nowrap ${valor && valor.trim() !== '' ? 'bg-brand/10 border-brand/30 text-brand' : ''}`}
              title={valor ? 'ChordPro cargado. Puedes reemplazarlo.' : undefined}
            >
              <UploadCloud className="w-4 h-4" />
              <span className="text-xs font-semibold text-content group-hover:text-action transition-colors">
                {valor && valor.trim() !== '' ? 'Reemplazar TXT' : 'Subir TXT'}
            </span>
            <input
              type="file"
              hidden
              accept=".txt,.pro,.cho,.chordpro,text/plain"
              onChange={(e) => manejarSubidaChordpro(e, cancion.id)}
            />
          </label>

            <button
              type="button"
              onClick={() => abrirEditorChordpro(cancion)}
              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all shadow-sm text-xs font-semibold whitespace-nowrap ${valor && valor.trim() !== '' ? 'border-brand/30 bg-brand/10 text-brand hover:bg-brand/15' : 'border-border bg-surface text-content hover:bg-background'}`}
            >
              <PencilLine className="w-3.5 h-3.5" />
              {valor && valor.trim() !== '' ? 'Editar' : 'Pegar'}
            </button>
          </div>
      );
    }

    return (
      <div className="flex justify-center items-center h-full min-w-[8rem]">
        <label
          className="cursor-pointer group flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-surface text-action transition-all shadow-sm"
        >
          <UploadCloud className="w-4 h-4" />
          <span className="text-xs font-semibold text-content group-hover:text-action transition-colors">
            Subir
          </span>
          <input
            type="file"
            hidden
            onChange={(e) => manejarSubida(e, cancion.id, campoBd)}
          />
        </label>
      </div>
    );
  };

  const toggleEditorAudioPlayback = async () => {
    const audio = document.getElementById('admin-chordpro-audio');
    if (!audio || !editorChordproCancion?.mp3) return;

    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (_error) {
      setEditorAudioPlaying(false);
    }
  };

  const handleEditorAudioSeek = (nextValue) => {
    const audio = document.getElementById('admin-chordpro-audio');
    const nextTime = Math.max(0, Number(nextValue) || 0);
    setEditorAudioCurrentTime(nextTime);
    editorAudioCurrentTimeRef.current = nextTime;
    if (audio) {
      audio.currentTime = nextTime;
    }
  };

  const capturarMarkerActual = (markerIndex) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => (
      itemIndex === markerIndex
        ? { ...item, startSec: Math.round(editorAudioCurrentTimeRef.current) }
        : item
    )));
  };

  const actualizarEditorSectionMarker = (markerIndex, patch) => {
    setEditorSectionMarkers((prev) => prev.map((item, itemIndex) => (
      itemIndex === markerIndex ? { ...item, ...patch } : item
    )));
  };

  const editorAudioProgress = editorAudioDuration > 0
    ? Math.min(100, Math.max(0, (editorAudioCurrentTime / editorAudioDuration) * 100))
    : 0;

  if (!loading && !sessionUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6 text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
        <h2 className="text-2xl font-bold text-content mb-3">Acceso Restringido</h2>
        <p className="text-content-muted max-w-md mb-8">
          Debe iniciar sesion para gestionar el repertorio. Las politicas de seguridad (RLS) bloquean el acceso anonimo a esta seccion.
        </p>
        <a 
          href="/login" 
          className="inline-flex items-center justify-center px-6 py-3 bg-action hover:bg-action/90 text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          Ir a Iniciar Sesion
        </a>
      </div>
    );
  }

  return (
    <div className="antialiased w-full h-full flex flex-col">
      <div className="mb-3 flex flex-col gap-3 px-3 md:px-5 xl:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <p className="min-w-0 text-sm leading-relaxed text-content-muted">
            Vista compacta para cargar datos rapido. Las notas por seccion y los tiempos del ensayo viven dentro de <span className="font-semibold text-content">Editar / Sincronizar</span>.
          </p>
          <button
            onClick={agregarCancion}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-xl bg-brand px-5 py-2.5 font-bold text-white shadow transition-colors hover:bg-brand/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Anadir Cancion
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
          <span className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3 py-2 font-semibold ${
            cancionesPendientesChordpro.length > 0
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-600'
              : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'
          }`}>
            <span className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-white/70 px-2 py-1 text-[11px] font-black">
              {cancionesPendientesChordpro.length}
            </span>
            Pendientes sin ChordPro
          </span>

          <span className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-surface px-3 py-2 text-content-muted">
            Nota por seccion: <code className="ml-2 text-[12px] font-semibold text-brand">[Intro|Pad y Piano]</code>
          </span>

          <span className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-surface px-3 py-2 text-content-muted">
            Tiempos: <span className="ml-2 font-semibold text-content">Editar / Sincronizar - panel derecho</span>
          </span>

          {!sectionMarkersDisponibles && (
            <span className="inline-flex min-h-[40px] items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-600">
              Falta la migracion para guardar <code className="mx-1 text-[12px] font-semibold">section_markers</code>
            </span>
          )}
        </div>
      </div>

      <div className="hidden mb-6 flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 max-w-7xl mx-auto w-full">
        <div>
          <p className="text-content-muted leading-relaxed max-w-2xl text-sm">
            Gestor tipo Excel. Edita los metadatos directamente en las celdas y sube los archivos de forma instantanea.
          </p>
        </div>
        <button
          onClick={agregarCancion}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold hover:bg-brand/90 transition-colors shadow disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Anadir Cancion
        </button>
      </div>

      <div className="hidden mb-6 grid gap-4 px-4 max-w-7xl mx-auto w-full lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.95fr)]">
        <section className="rounded-3xl border border-border bg-surface px-5 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-content-muted">Metadata por seccion</p>
              <h2 className="mt-1 text-lg font-bold text-content">Formato listo para modo ensayo</h2>
            </div>
            <span className="inline-flex items-center rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
              Parser compartido
            </span>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-content-muted md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background/70 p-3">
              <p className="font-semibold text-content">Seccion con nota</p>
              <code className="mt-2 block whitespace-pre-wrap text-[12px] text-brand">[Intro|Pad y Piano]</code>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-3">
              <p className="font-semibold text-content">Atajo desde texto</p>
              <code className="mt-2 block whitespace-pre-wrap text-[12px] text-brand">[Intro] Pad y Piano</code>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 p-3">
              <p className="font-semibold text-content">Comentario de seccion</p>
              <code className="mt-2 block whitespace-pre-wrap text-[12px] text-brand">{`{comment: Bombo + Pad}`}</code>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-content-muted">
            Al guardar, el admin normaliza encabezados inline para que ensayo lea la nota de cada seccion sin romper el flujo actual.
          </p>
        </section>

        <section className="rounded-3xl border border-border bg-surface px-5 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-content-muted">Detector</p>
              <h2 className="mt-1 text-lg font-bold text-content">Canciones activas sin ChordPro</h2>
            </div>
            <span className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-full px-3 py-1 text-sm font-black ${cancionesPendientesChordpro.length > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500'}`}>
              {cancionesPendientesChordpro.length}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-content-muted">
            Esto te muestra que canciones siguen activas en repertorio pero todavia no tienen guia para el modo ensayo.
          </p>
          <div className="mt-4 max-h-56 space-y-2 overflow-auto pr-1">
            {cancionesPendientesChordpro.length > 0 ? cancionesPendientesChordpro.map((cancion) => (
              <div key={`faltante-${cancion.id}`} className="rounded-2xl border border-border bg-background/70 px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-content">{cancion.titulo || 'Sin titulo'}</p>
                <p className="truncate text-xs text-content-muted">
                  {cancion.cantante || 'Sin cantante'} · {cancion.tonalidad || '-'} · {cancion.bpm || '-'} BPM
                </p>
              </div>
            )) : (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm font-medium text-emerald-500">
                No hay activas pendientes: todas las canciones activas ya tienen ChordPro cargado.
              </div>
            )}
          </div>
        </section>
      </div>

      {errorTexto && (
        <div className="mx-3 mb-4 rounded-xl border border-red-500/20 bg-red-50/10 p-4 font-medium text-red-500 md:mx-5 xl:mx-6">
          {errorTexto}
        </div>
      )}

      {loading && canciones.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 text-brand animate-spin" />
          <span className="text-content-muted font-medium tracking-wide">Cargando base de datos...</span>
        </div>
      ) : (
        <div className="w-full overflow-hidden border-y border-border bg-surface shadow-sm">
          <div className="admin-table-scroll h-[calc(90dvh-12.8rem-env(safe-area-inset-bottom))] min-h-[32rem] overflow-x-scroll overflow-y-auto bg-background md:h-[calc(90dvh-12.8rem-env(safe-area-inset-bottom))]">
            <table className="w-max text-left border-collapse bg-surface relative">
              <thead className="sticky top-0 z-20 bg-background border-b border-border shadow-sm">
                <tr className="text-xs uppercase tracking-wider text-content-muted font-bold divide-x divide-border">
                  {/* Fijas */}
                  <th className="sticky left-0 z-30 bg-background top-0 px-0 py-0 border-r border-border text-center overflow-hidden min-w-[14rem] max-w-[14rem]">
                    <div className="px-4 py-4 w-full h-full text-left truncate">Titulo / Cantante</div>
                  </th>
                  {/* Metadata */}
                  <th className="px-4 py-4 min-w-[6rem]">Tonalidad</th>
                  <th className="px-4 py-4 min-w-[5rem]">BPM</th>
                  <th className="px-4 py-4 min-w-[8rem]">Categoria</th>
                  <th className="px-4 py-4 min-w-[8rem]">Voz</th>
                  <th className="px-4 py-4 min-w-[8rem]">Tema</th>
                  <th className="px-4 py-4 min-w-[8rem]">Estado</th>
                  <th className="px-4 py-4 min-w-[10rem]">Youtube (URL)</th>
                  {/* Archivos R2 */}
                  <th className="px-4 py-4 text-center min-w-[8rem]">MP3</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Acordes</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Letras</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Voces</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Secuencias</th>
                  <th className="px-4 py-4 text-center min-w-[17rem]">ChordPro</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border">
                {canciones.map((cancion) => (
                  <tr key={cancion.id} className="hover:bg-background/40 transition-colors group divide-x divide-border">
                    {/* Fijas */}
                    <td className="sticky left-0 z-10 bg-surface group-hover:bg-background/80 border-r border-border align-top min-w-[14rem] max-w-[14rem]">
                      <div className="flex flex-col justify-center gap-0.5 py-1.5 px-3">
                        <EditableCell
                          cancionId={cancion.id}
                          campoBd="titulo"
                          valorInicial={cancion.titulo}
                          onSave={guardarMetadata}
                          isSaving={savingCell[`${cancion.id}_titulo`]}
                          anchoClases="w-full"
                          customInputClasses="text-[13px] font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-none p-0 m-0 leading-none focus:ring-0 w-full h-auto shadow-none truncate"
                        />
                        <div className="w-full">
                          <EditableCell
                            cancionId={cancion.id}
                            campoBd="cantante"
                            valorInicial={cancion.cantante}
                            onSave={guardarMetadata}
                            isSaving={savingCell[`${cancion.id}_cantante`]}
                            anchoClases="w-full"
                            customInputClasses="text-[11px] text-gray-500 dark:text-gray-400 bg-transparent border-none p-0 m-0 leading-none focus:ring-0 w-full h-auto shadow-none truncate"
                          />
                        </div>
                      </div>
                    </td>
                    
                    {/* Metadata */}
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="tonalidad" valorInicial={cancion.tonalidad} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_tonalidad`]} anchoClases="min-w-[6rem] max-w-[6rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="bpm" valorInicial={cancion.bpm} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_bpm`]} anchoClases="min-w-[5rem] max-w-[5rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="categoria" valorInicial={cancion.categoria} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_categoria`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="voz" valorInicial={cancion.voz || cancion.voz_principal} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_voz`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="tema" valorInicial={cancion.tema} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_tema`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="estado" valorInicial={cancion.estado} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_estado`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="link_youtube" valorInicial={cancion.link_youtube} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_link_youtube`]} anchoClases="min-w-[10rem] max-w-[10rem]" />
                    </td>

                    {/* Archivos R2 */}
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'mp3')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_acordes')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_letras')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_voces')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_secuencias')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'chordpro')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canciones.length === 0 && !loading && (
            <div className="p-12 text-center text-content-muted font-medium bg-surface">
              Aun no hay canciones creadas. Haz clic en "Anadir Cancion" para comenzar.
            </div>
          )}
        </div>
      )}

      {editorChordproAbierto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-slate-950/70 p-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:p-4 md:pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
          <div
            className="my-2 flex h-full w-full max-w-[min(92vw,96rem)] flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl md:my-4"
            style={{ maxHeight: EDITOR_MODAL_MAX_HEIGHT }}
          >
            <div className="shrink-0 flex items-center justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-bold text-content">
                    Editar ChordPro
                  </h2>
                  <button
                    type="button"
                    onClick={() => document.getElementById('admin-markers-panel')?.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="inline-flex min-h-[32px] items-center rounded-full border border-brand/20 bg-brand/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand transition-colors hover:bg-brand/15"
                  >
                    Markers · {resumenEditorChordpro.secciones}
                  </button>
                </div>
                <p className="truncate text-sm text-content-muted">
                  {editorChordproCancion?.titulo || 'Sin titulo'}
                </p>
              </div>

              <button
                type="button"
                onClick={cerrarEditorChordpro}
                disabled={guardandoChordpro}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-content-muted hover:text-content hover:bg-surface transition-colors disabled:opacity-60"
                aria-label="Cerrar editor de ChordPro"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(editorChordproAviso || !sectionMarkersDisponibles) && (
              <div className="shrink-0 space-y-3 border-b border-border bg-surface px-6 py-4">
                {editorChordproAviso && (
                  <p className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-600 dark:text-sky-300">
                    {editorChordproAviso}
                  </p>
                )}
                {!sectionMarkersDisponibles && (
                  <p className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-500">
                    La base actual todavia no expone <code>section_markers</code>. Puedes preparar los tiempos aqui, pero debes aplicar la migracion nueva para que se guarden en Supabase.
                  </p>
                )}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden p-4 md:p-6">
              <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(18rem,1fr)_minmax(18rem,1fr)] gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.95fr)] lg:grid-rows-1">
              {editorChordproCargando ? (
                <div className="flex min-h-0 h-full overflow-hidden rounded-2xl border border-border bg-background">
                  <div className="flex h-full w-full items-center justify-center px-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-content-muted">
                    <Loader2 className="h-5 w-5 animate-spin text-brand" />
                    Cargando contenido ChordPro...
                  </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 h-full overflow-hidden rounded-2xl border border-border bg-background">
                  <textarea
                    value={editorChordproValor}
                    onChange={(e) => setEditorChordproValor(e.target.value)}
                    placeholder="[Verso 1]\n[C]Texto con acordes..."
                    spellCheck={false}
                    className="editor-column-scroll h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-4 text-sm leading-7 text-content font-mono outline-none focus:border-transparent focus:ring-0"
                  />
                </div>
              )}
              <section id="admin-markers-panel" className="flex min-h-0 h-full flex-col overflow-hidden rounded-2xl border border-border bg-background/70 p-4">
                <audio
                  id="admin-chordpro-audio"
                  src={editorChordproCancion?.mp3 || ''}
                  preload="metadata"
                  className="hidden"
                />
                <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 pb-4 pt-1 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-content">Markers de ensayo</h3>
                    </div>
                  </div>

                  {editorSectionMarkers.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {editorSectionMarkers.map((marker, index) => (
                        <button
                          key={`jump-${marker.id || `${marker.sectionName}-${index}`}`}
                          type="button"
                          onClick={() => {
                            const element = document.getElementById(`marker-card-${index}`);
                            if (element) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                          }}
                          className="inline-flex min-h-[32px] items-center rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-content-muted transition-colors hover:border-brand/30 hover:text-content"
                        >
                          {marker.sectionName}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 rounded-2xl border border-border bg-surface px-3 py-3">
                    {editorChordproCancion?.mp3 ? (
                      <>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={toggleEditorAudioPlayback}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-action text-white transition-colors hover:bg-action/90"
                            aria-label={editorAudioPlaying ? 'Pausar audio' : 'Reproducir audio'}
                          >
                            {editorAudioPlaying ? <Pause className="w-4 h-4" /> : <Play className="ml-0.5 w-4 h-4" />}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-content-muted">
                              <span>{formatMarkerTime(editorAudioCurrentTime)}</span>
                              <span>{formatMarkerTime(editorAudioDuration)}</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max={Math.max(editorAudioDuration, 1)}
                              step="0.1"
                              value={Math.min(editorAudioCurrentTime, Math.max(editorAudioDuration, 1))}
                              onChange={(e) => handleEditorAudioSeek(e.target.value)}
                              className="admin-marker-range w-full"
                              style={{ '--range-progress': `${editorAudioProgress}%` }}
                              aria-label="Posicion del audio de ensayo"
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-content-muted">
                        Esta cancion aun no tiene MP3 cargado. Puedes dejar los tiempos manualmente en formato <code>mm:ss</code>.
                      </p>
                    )}
                  </div>
                </div>

                <div className="editor-column-scroll mt-4 min-h-0 flex-1 space-y-3 overflow-y-scroll pr-2">
                  {editorSectionMarkers.length > 0 ? editorSectionMarkers.map((marker, index) => (
                    <div id={`marker-card-${index}`} key={marker.id || `${marker.sectionName}-${index}`} className="rounded-2xl border border-border bg-surface px-3 py-3 scroll-mt-52">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-content">{marker.sectionName}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => capturarMarkerActual(index)}
                          disabled={!editorChordproCancion?.mp3}
                          title={editorChordproCancion?.mp3 ? 'Usar tiempo actual' : 'No hay MP3 para capturar tiempo'}
                          className="rounded-full border border-brand/20 bg-brand/10 px-2 py-1 text-[11px] font-bold text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-content-muted"
                        >
                          {marker.startSec == null ? '--:--' : formatMarkerTime(marker.startSec)}
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-[4.9rem_minmax(0,1fr)_auto_auto] gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={marker.startSec == null ? '' : formatMarkerTime(marker.startSec)}
                          onChange={(e) => {
                            const nextValue = parseMarkerTime(e.target.value);
                            actualizarEditorSectionMarker(index, { startSec: nextValue });
                          }}
                          placeholder="00:00"
                          className="min-h-[44px] rounded-xl border border-border bg-background px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                        <input
                          type="text"
                          value={marker.note || ''}
                          onChange={(e) => {
                            actualizarEditorSectionMarker(index, { note: e.target.value });
                          }}
                          placeholder="Nota de seccion"
                          className="min-h-[44px] rounded-xl border border-border bg-background px-3 text-sm text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            actualizarEditorSectionMarker(index, { startSec: null });
                          }}
                          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-surface px-3 text-xs font-bold text-content-muted hover:bg-background hover:text-content transition-colors"
                        >
                          Limpiar
                        </button>
                        <button
                          type="button"
                          onClick={() => capturarMarkerActual(index)}
                          disabled={!editorChordproCancion?.mp3}
                          className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-brand/25 bg-brand/10 px-3 text-xs font-bold text-brand transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-background disabled:text-content-muted"
                        >
                          <span className="sm:hidden">Marcar</span>
                          <span className="hidden sm:inline">Marcar ahora</span>
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-sm text-content-muted">
                      Aun no hay secciones parseadas. Agrega encabezados como <code>[Verso 1]</code> o <code>[Coro]</code> para preparar markers.
                    </div>
                  )}
                </div>
              </section>
              </div>
            </div>

            <div className="shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 px-6 py-5 border-t border-border bg-background/70">
              <button
                type="button"
                onClick={cerrarEditorChordpro}
                disabled={guardandoChordpro}
                className="inline-flex items-center justify-center rounded-2xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-content hover:bg-background transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={guardarChordproDesdeEditor}
                disabled={guardandoChordpro}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-action px-5 py-3 text-sm font-semibold text-white hover:bg-action/90 transition-colors disabled:opacity-60"
              >
                {guardandoChordpro ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar ChordPro
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .admin-table-scroll {
          scrollbar-gutter: stable both-edges;
          scrollbar-width: auto;
          scrollbar-color: rgba(24, 191, 175, 0.8) rgba(15, 23, 42, 0.08);
        }

        .admin-table-scroll::-webkit-scrollbar {
          height: 14px;
          width: 14px;
        }

        .admin-table-scroll::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.14);
        }

        .admin-table-scroll::-webkit-scrollbar-thumb {
          background: rgba(24, 191, 175, 0.85);
          border-radius: 999px;
          border: 3px solid rgba(255, 255, 255, 0.72);
        }

        .editor-column-scroll {
          overscroll-behavior: contain;
          scrollbar-gutter: stable both-edges;
          scrollbar-width: auto;
          scrollbar-color: rgba(15, 23, 42, 0.68) rgba(15, 23, 42, 0.10);
        }

        .editor-column-scroll::-webkit-scrollbar {
          width: 16px;
        }

        .editor-column-scroll::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.18);
          border-radius: 999px;
        }

        .editor-column-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(31, 41, 55, 0.92) 0%, rgba(71, 85, 105, 0.92) 100%);
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.18);
          min-height: 48px;
        }

        .editor-column-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(51, 65, 85, 0.96) 100%);
        }

        .admin-marker-range {
          --range-progress: 0%;
          appearance: none;
          -webkit-appearance: none;
          height: 22px;
          cursor: pointer;
          background: transparent;
        }

        .admin-marker-range:focus {
          outline: none;
        }

        .admin-marker-range::-webkit-slider-runnable-track {
          height: 5px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            rgba(24, 191, 175, 1) 0%,
            rgba(24, 191, 175, 1) var(--range-progress),
            rgba(148, 163, 184, 0.26) var(--range-progress),
            rgba(148, 163, 184, 0.26) 100%
          );
        }

        .admin-marker-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 4px;
          height: 22px;
          margin-top: -8.5px;
          border: none;
          border-radius: 999px;
          background: rgba(45, 212, 191, 1);
          box-shadow:
            0 0 0 2px rgba(9, 9, 11, 0.96),
            0 0 0 5px rgba(45, 212, 191, 0.16);
        }

        .admin-marker-range::-moz-range-track {
          height: 5px;
          border: none;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.26);
        }

        .admin-marker-range::-moz-range-progress {
          height: 5px;
          border-radius: 999px;
          background: rgba(24, 191, 175, 1);
        }

        .admin-marker-range::-moz-range-thumb {
          width: 4px;
          height: 22px;
          border: none;
          border-radius: 999px;
          background: rgba(45, 212, 191, 1);
          box-shadow:
            0 0 0 2px rgba(9, 9, 11, 0.96),
            0 0 0 5px rgba(45, 212, 191, 0.16);
        }
      `}</style>
    </div>
  );
}


