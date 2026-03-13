const normalizeSectionName = (rawValue = '') => {
  const cleaned = String(rawValue).trim();
  if (!cleaned) return 'Sección';
  const normalized = cleaned.toLowerCase();
  if (normalized === 'soc' || normalized === 'start_of_chorus') return 'Coro';
  if (normalized === 'sov' || normalized === 'start_of_verse') return 'Verso';
  if (normalized === 'sob' || normalized === 'start_of_bridge') return 'Puente';
  if (normalized === 'soi' || normalized === 'start_of_intro') return 'Intro';
  if (normalized === 'sot' || normalized === 'start_of_tag') return 'Tag';
  if (normalized === 'eoc' || normalized === 'end_of_chorus') return '';
  if (normalized === 'eov' || normalized === 'end_of_verse') return '';
  if (normalized === 'eob' || normalized === 'end_of_bridge') return '';
  if (normalized === 'eoi' || normalized === 'end_of_intro') return '';
  if (normalized === 'eot' || normalized === 'end_of_tag') return '';
  return cleaned;
};
const parseChordProSections = (rawChordpro = '', fallbackTitle = 'Letra') => {
  const content = String(rawChordpro || '').replace(/\r\n/g, '\n').trim();
  if (!content) return [{name:'Ensayo',lines:['Todavía no hay una guía ChordPro disponible para esta canción.']}];
  const sections = [];
  let currentSection = { name: 'Letra', lines: [] };
  const pushCurrentSection = () => {
    if (currentSection.lines.length === 0) return;
    sections.push({name: currentSection.name || 'Letra', lines:[...currentSection.lines]});
  };
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sectionLineMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionLineMatch) {
      pushCurrentSection();
      currentSection = { name: normalizeSectionName(sectionLineMatch[1]), lines: [] };
      continue;
    }
    const directiveMatch = trimmed.match(/^\{([^}:]+)(?::\s*(.+))?\}$/);
    if (directiveMatch) {
      const directiveName = normalizeSectionName(directiveMatch[1]);
      const directiveValue = directiveMatch[2]?.trim() || '';
      if (directiveName) {
        pushCurrentSection();
        currentSection = { name: directiveValue || directiveName, lines: [] };
      }
      continue;
    }
    currentSection.lines.push(line);
  }
  pushCurrentSection();
  return sections.length===0?[{name:'Ensayo',lines:['fallback']}]:sections;
};
const fs=require('fs');
const text=fs.readFileSync('C:/Users/edici/OneDrive/Documentos/ALABANZA/tmp_chordpro_test.txt','utf8');
console.log(JSON.stringify(parseChordProSections(text).map(s=>({name:s.name, count:s.lines.length, sample:s.lines[0]})),null,2));
