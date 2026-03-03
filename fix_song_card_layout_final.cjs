const fs = require('fs');
const file = 'src/pages/programacion.astro';
let raw = fs.readFileSync(file, 'utf8');

// The block to replace is lines 1716-1731 (the inner `items.forEach` loop)
// I will just use a regex/string replace to swap out the iteration body

const oldStart = `
  if (items && items.length > 0) {
  items.forEach((item, idx) => {
  const c = item.canciones || {};
`;

// Looking at the file, the exact text is:
const oldBlock = `  if (items && items.length > 0) {
  items.forEach((item, idx) => {
  const c = item.canciones || {};
  html += '<div class="flex items-start gap-3 p-3 rounded-xl bg-white border border-neutral-200/60 hover:border-neutral-300 transition-colors min-w-0 overflow-hidden">';
  html += ' <span class="w-8 h-8 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center font-bold shrink-0">' + (idx + 1) + '</span>';
  html += ' <div class="flex-1 min-w-0 flex flex-col gap-1.5">';
  html += ' <p class="font-bold text-sm tracking-tight text-neutral-900 truncate w-full">' + (c.titulo || 'Sin título') + '</p>';
  html += ' <div class="flex flex-wrap items-center gap-1.5 w-full">';
  if (c.tonalidad) html += '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600 text-[11px] font-bold tracking-wide"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>Key: ' + c.tonalidad + '</span>';
  if (c.bpm) html += '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600 text-[11px] font-bold tracking-wide"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>' + c.bpm + ' BPM</span>';
  html += ' </div>';
  html += ' </div>';
  html += ' <div class="flex flex-wrap items-center gap-1.5 w-full mt-1">';
  if (c.link_youtube) html += '<a href="' + c.link_youtube + '" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors font-bold text-[11px] tracking-wide" title="YouTube"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="mr-1.5"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon fill="white" stroke="none" points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>YouTube</a>';
  if (c.link_acordes) html += '<a href="' + c.link_acordes + '" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center px-3 py-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors font-bold text-[11px] tracking-wide" title="Acordes">Acordes</a>';
  if (c.link_letras) html += '<a href="' + c.link_letras + '" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors font-bold text-[11px] tracking-wide" title="Letras">Letras</a>';
  if (c.link_voces) html += '<a href="' + c.link_voces + '" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors font-bold text-[11px] tracking-wide" title="Voces">Voces</a>';
  html += ' </div>';
  html += '</div>';
  });`;

// Replace it with the exact design pattern requested
const newBlock = `  if (items && items.length > 0) {
  items.forEach((item, idx) => {
  const c = item.canciones || {};
  html += '<article class="relative bg-white border border-neutral-200 rounded-2xl shadow-sm flex flex-col mb-4 overflow-hidden">';
  html += '  <div class="p-5 flex gap-4">';
  html += '    <div class="w-10 h-10 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center font-bold shrink-0 text-xl">' + (idx + 1) + '</div>';
  html += '    <div class="flex-1 min-w-0 flex flex-col pt-1">';
  html += '      <h3 class="text-xl font-bold tracking-tight text-neutral-900 mb-1 truncate">' + (c.titulo || 'Sin Título') + '</h3>';
  html += '      <p class="text-sm font-medium text-neutral-500 mb-4 truncate">Redil Sur</p>';
  html += '      <div class="flex flex-wrap gap-2 text-xs">';
  if (c.tonalidad) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 tracking-wide font-bold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" class="mr-1.5 text-neutral-500" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>Key: ' + c.tonalidad + '</span>';
  if (c.bpm) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 tracking-wide font-bold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" class="mr-1.5 text-neutral-500" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>' + c.bpm + ' BPM</span>';
  html += '      </div>';
  html += '    </div>';
  html += '  </div>';
  html += '  <div class="px-5 pb-5">';
  html += '    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-1">';
  if (c.link_youtube) html += '      <a href="' + c.link_youtube + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-[#ff0000]/10 text-[#ff0000] hover:bg-[#ff0000]/20 font-bold text-sm tracking-wide transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="mr-2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon fill="white" stroke="none" points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>YouTube</a>';
  if (c.link_acordes) html += '      <a href="' + c.link_acordes + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-green-500/10 text-green-500 hover:bg-green-500/20 font-bold text-sm tracking-wide transition-colors">Acordes</a>';
  if (c.link_voces) html += '      <a href="' + c.link_voces + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 font-bold text-sm tracking-wide transition-colors">Voces</a>';
  if (c.link_letras) html += '      <a href="' + c.link_letras + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 font-bold text-sm tracking-wide transition-colors">Letras</a>';
  html += '    </div>';
  html += '  </div>';
  html += '</article>';
  });`;

if (raw.includes(oldBlock)) {
    raw = raw.replace(oldBlock, newBlock);
    fs.writeFileSync(file, raw);
    console.log('Replaced song card html with the repertorio layout exactly.');
} else {
    // Let's do a fallback replacement using lines if the exact string match fails
    const lines = raw.split('\\n');
    let startIdx = lines.findIndex(l => l.includes('if (items && items.length > 0) {'));
    let endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('});'));

    if (startIdx !== -1 && endIdx !== -1) {
        lines.splice(startIdx, endIdx - startIdx + 1, ...newBlock.split('\\n'));
        fs.writeFileSync(file, lines.join('\\n'));
        console.log('Replaced using fallback line index splice.');
    } else {
        console.log('Error: Could not find block to replace.');
    }
}
