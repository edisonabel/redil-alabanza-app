const fs = require('fs');
const file = 'src/pages/programacion.astro';
const raw = fs.readFileSync(file, 'utf8');
const lines = raw.split('\n');

const newLines = `  if (items && items.length > 0) {
  items.forEach((item, idx) => {
  const c = item.canciones || {};
  html += '<article class="relative bg-white border border-neutral-200 rounded-2xl shadow-sm flex flex-col mb-4 overflow-hidden">';
  html += '  <div class="p-5 flex gap-4">';
  html += '    <div class="w-10 h-10 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center font-bold shrink-0 text-xl">' + (idx + 1) + '</div>';
  html += '    <div class="flex-1 min-w-0 flex flex-col pt-1">';
  html += '      <h3 class="text-xl font-bold tracking-tight text-neutral-900 mb-1 truncate">' + (c.titulo || 'Sin Título') + '</h3>';
  html += '      <p class="text-sm font-medium text-neutral-500 mb-4 truncate">' + (c.cantante || 'Redil Sur') + '</p>';
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
  if (c.link_secuencias) html += '      <a href="' + c.link_secuencias + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-pink-500/10 text-pink-500 hover:bg-pink-500/20 font-bold text-sm tracking-wide transition-colors">Secuencias</a>';
  html += '    </div>';
  html += '  </div>';
  html += '</article>';
  });`;

// Replace lines 1714 to 1734 
// Which correspond to indices 1713 to 1733
lines.splice(1713, 21, ...newLines.split('\n'));
fs.writeFileSync(file, lines.join('\n'));
console.log('Replaced song card block with final layout script.');
