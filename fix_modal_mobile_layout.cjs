const fs = require('fs');
const file = 'src/pages/programacion.astro';
let raw = fs.readFileSync(file, 'utf8');

// 1. Overall Modal Body grid
// Line 81: <div class="grid grid-cols-1 md:grid-cols-2 gap-5"> => Ensure it's 1 column strictly in mobile
raw = raw.replace(
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-5">',
    '<div class="grid grid-cols-1 gap-5 w-full">'
);

// 2. Titles and generic inputs.
// In the current layout, many use `md:col-span-2` which is fine long as parent is cols-1 on mobile.
// Título del Evento
raw = raw.replace(
    '<div class="md:col-span-2">\n        <label class="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2">Título del Evento <span class="text-red-500">*</span></label>',
    '<div class="w-full">\n        <label class="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2">Título del Evento <span class="text-red-500">*</span></label>'
);

// Fecha y hora / Hora fin row
// Currently: <div class="md:col-span-2 grid grid-cols-1 gap-4">
// Make it explicit for mobile-first: grid-cols-1 sm:grid-cols-2
raw = raw.replace(
    '<div class="md:col-span-2 grid grid-cols-1 gap-4">',
    '<div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">'
);

// 3. Asignaciones de Equipo section
// The current title row is:
// <h3 class="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-4 flex items-center justify-between">
//   Asignaciones de Equipo
//   <div class="flex items-center gap-2">
//     <button type="button" id="btn-cargar-equipo" ...>...</button>
//     <button type="button" id="btn-armar-playlist" ...>...</button>
//   </div>
// </h3>
// We need to break this into: Title on its own line, buttons in a grid below.

const oldAsignacionesBlock = `        <h3 class="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-4 flex items-center justify-between">
          Asignaciones de Equipo
          <div class="flex items-center gap-2">
            <button type="button" id="btn-cargar-equipo" class="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-200 :bg-blue-900/60 transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m19 11-4-4v8"/><path d="m11 15 4 4"/></svg> Cargar Equipo
            </button>

             <button type="button" id="btn-armar-playlist" class="relative overflow-hidden group items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white font-bold text-sm shadow-md shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50 hover:-translate-y-0.5 transition-all duration-300 hidden">
              <div class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
              <span class="relative z-10 flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="shrink-0" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>Armar Playlist</span>
            </button>
            <span class="text-[10px] font-normal text-neutral-500 bg-neutral-100 px-2 py-1 rounded hidden sm:inline-block">Clic editar</span>
          </div>
        </h3>`;

const newAsignacionesBlock = `        <h3 class="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-3 w-full">
          Asignaciones de Equipo
          <span class="text-[10px] font-normal text-neutral-500 bg-neutral-100 px-2 py-1 rounded inline-block ml-2">Clic editar</span>
        </h3>
        <div class="grid grid-cols-2 gap-3 w-full mb-4">
          <button type="button" id="btn-cargar-equipo" class="w-full justify-center px-3 py-2.5 bg-blue-100 text-blue-700 rounded-lg text-[11px] sm:text-xs font-bold hover:bg-blue-200 transition-colors flex items-center gap-1.5 leading-tight">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" class="shrink-0" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m19 11-4-4v8"/><path d="m11 15 4 4"/></svg> <span>Cargar Equipo</span>
          </button>
          <button type="button" id="btn-armar-playlist" class="w-full justify-center relative overflow-hidden group items-center gap-1.5 px-3 py-2.5 rounded-lg bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white font-bold text-[11px] sm:text-xs shadow-md shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50 hover:-translate-y-0.5 transition-all duration-300 hidden">
            <div class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
            <span class="relative z-10 flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="shrink-0" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>Armar Playlist</span>
          </button>
        </div>`;

// Apply replacement considering exact spacing might differ slightly
if (raw.includes('Asignaciones de Equipo') && raw.includes('btn-cargar-equipo')) {
    // Let's do a more robust line-based replacement
    const lines = raw.split('\\n');
    const startIdx = lines.findIndex(l => l.includes('<h3 class="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-4 flex items-center justify-between">'));
    const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('</h3>'));

    if (startIdx !== -1 && endIdx !== -1) {
        lines.splice(startIdx, endIdx - startIdx + 1, ...newAsignacionesBlock.split('\\n'));
        raw = lines.join('\\n');
    }
}

// 4. Check for fixed widths in the inputs
raw = raw.replace(/w-\[300px\]/g, 'w-full');
raw = raw.replace(/w-80/g, 'w-full');
// ensure select doesn't have max-w
raw = raw.replace(/max-w-xs/g, '');

// Also Tema de predicacion should use w-full wrapper
raw = raw.replace(
    '<div class="md:col-span-2">\n        <label class="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2">Tema de Predicación <span class="text-neutral-500 font-normal lowercase">(opcional)</span></label>',
    '<div class="w-full">\n        <label class="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2">Tema de Predicación <span class="text-neutral-500 font-normal lowercase">(opcional)</span></label>'
);

fs.writeFileSync(file, raw);
console.log('Mobile layout fixes applied to Gestionar Evento modal script ran successfully.');
