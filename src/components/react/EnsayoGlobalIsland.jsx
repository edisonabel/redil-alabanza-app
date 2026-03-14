import React, { useCallback, useEffect, useState } from 'react';
import ModoEnsayoCompacto from './ModoEnsayoCompacto.jsx';

// ── ChordPro parser ──────────────────────────────────────────────────────────
// Identical logic to AdminRepertorio so sections are compatible.

const SECTION_LABEL_RE = /^\s*\[([^\]]+)\]\s*(.*)$/;
const PURE_SECTION_HEADER_RE = /^\[([^\[\]]+)\]$/;
const CHORD_BODY_PATTERN =
  '[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?(?:\\/[A-G](?:#|b)?(?:[a-z0-9+#°ø()\\-]*)?)?';
const CHORD_TOKEN_RE = new RegExp(
  `^\\(?\\s*(\\[${CHORD_BODY_PATTERN}\\]\\s*)+\\)?\\s*$`,
  'i',
);
const CHORD_SYMBOL_RE = new RegExp(`^${CHORD_BODY_PATTERN}$`, 'i');
const LEADING_CHORD_SECTION_RE = new RegExp(`^\\[(${CHORD_BODY_PATTERN})\\|`, 'i');
const BROKEN_INLINE_CHORD_RE = new RegExp(
  `\\[(${CHORD_BODY_PATTERN})\\s*\\|\\s*`,
  'gi',
);

const normalizeSectionName = (rawValue = '') => {
  const cleaned = String(rawValue).trim();
  if (!cleaned) return 'Seccion';
  const normalized = cleaned.toLowerCase();
  if (normalized === 'soc' || normalized === 'start_of_chorus') return 'Coro';
  if (normalized === 'sov' || normalized === 'start_of_verse') return 'Verso';
  if (normalized === 'sob' || normalized === 'start_of_bridge') return 'Puente';
  if (normalized === 'soi' || normalized === 'start_of_intro') return 'Intro';
  if (
    normalized === 'interlude' ||
    normalized === 'interludio' ||
    normalized === 'instrumental' ||
    normalized === 'start_of_interlude'
  )
    return 'Interludio';
  if (normalized === 'sot' || normalized === 'start_of_tag') return 'Tag';
  if (
    ['eoc', 'eov', 'eob', 'eoi', 'eot'].includes(normalized) ||
    normalized.startsWith('end_of_')
  )
    return '';
  return cleaned;
};

const isLikelySectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) return false;
  if (CHORD_SYMBOL_RE.test(cleaned)) return false;
  const normalized = cleaned.toLowerCase();
  if (
    [
      'intro', 'interlude', 'interludio', 'instrumental',
      'coro', 'chorus', 'pre coro', 'pre-coro',
      'verse', 'verso', 'puente', 'bridge',
      'tag', 'outro', 'final',
    ].some((label) => normalized.startsWith(label))
  )
    return true;
  return /\d/.test(cleaned);
};

const parseSectionHeader = (rawHeader = '') => {
  const cleaned = String(rawHeader || '').trim();
  if (!cleaned) return { name: 'Seccion', note: '' };
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
      if (
        LEADING_CHORD_SECTION_RE.test(fixedLine) ||
        BROKEN_INLINE_CHORD_RE.test(fixedLine)
      ) {
        fixedLine = fixedLine.replace(LEADING_CHORD_SECTION_RE, '[$1]');
        fixedLine = fixedLine.replace(BROKEN_INLINE_CHORD_RE, '[$1]');
        fixedLine = fixedLine.replace(/(?:\s*\|\s*)+\]+\s*$/, '');
      }
      BROKEN_INLINE_CHORD_RE.lastIndex = 0;
      return fixedLine;
    })
    .join('\n');
};

const parseChordProSections = (rawChordpro = '') => {
  const content = repararChordProCorrupto(
    String(rawChordpro || ''),
  )
    .replace(/\r\n/g, '\n')
    .trim();

  if (!content) return [];

  const sections = [];
  let currentSection = { name: 'Letra', note: '', lines: [] };

  const pushCurrentSection = () => {
    const sectionName = String(currentSection.name || '').trim();
    const shouldKeep =
      sectionName && sectionName.toLowerCase() !== 'letra';
    if (
      currentSection.lines.length === 0 &&
      !currentSection.note &&
      !shouldKeep
    )
      return;
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
      currentSection = { name: nextSection.name, note: nextSection.note, lines: [] };
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
      currentSection = { name: nextSection.name, note: nextSection.note, lines: [] };
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
        if (!currentSection.note && directiveValue) currentSection.note = directiveValue;
        else if (directiveValue) currentSection.lines.push(directiveValue);
        continue;
      }
      if (directiveName) {
        pushCurrentSection();
        const nextSection = parseSectionHeader(directiveValue || directiveName);
        currentSection = { name: nextSection.name, note: nextSection.note, lines: [] };
      }
      continue;
    }

    currentSection.lines.push(line);
  }

  pushCurrentSection();
  return sections;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EnsayoGlobalIsland() {
  const [activeSong, setActiveSong] = useState(null);

  useEffect(() => {
    const handleOpen = (event) => {
      const raw = event?.detail?.song;
      if (!raw) return;

      // Parse chordpro to sections when not already present
      const sections =
        Array.isArray(raw.sections) && raw.sections.length > 0
          ? raw.sections
          : parseChordProSections(raw.chordpro || '');

      setActiveSong({ ...raw, sections });
    };

    window.addEventListener('open-ensayo-compacto', handleOpen);
    return () => window.removeEventListener('open-ensayo-compacto', handleOpen);
  }, []);

  const handleGoBack = useCallback(() => setActiveSong(null), []);

  if (!activeSong) return null;

  return (
    <div className="fixed inset-0 z-50">
      <ModoEnsayoCompacto
        song={activeSong}
        contextTitle="Repertorio"
        onGoBack={handleGoBack}
      />
    </div>
  );
}
