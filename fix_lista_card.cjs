const fs = require('fs');
const file = 'src/pages/programacion.astro';
let content = fs.readFileSync(file, 'utf8');

// FIX 1: Move miRolBadge from h4 title to the dirListStr row (next to "Dirige: Andrés")
// And move the pencil EDIT button next to the title area (top right of the card)

// Step 1: Remove miRolBadge from the title h4
const oldTitle = '  <h4 class="font-bold text-neutral-900 text-lg flex items-center flex-wrap">${currentTema || currentTitle}${miRolBadge}</h4>';
const newTitle = '  <h4 class="font-bold text-neutral-900 text-lg leading-tight">${currentTema || currentTitle}</h4>';

content = content.replace(oldTitle, newTitle);

// Step 2: Add the pencil button to the title header row (right side of h4)
// We'll make it a flex row so pencil appears next to title
const oldTitleWrapper = `  <div class="min-w-0">
  <h4 class="font-bold text-neutral-900 text-lg leading-tight">\${currentTema || currentTitle}</h4>
  <p class="text-xs text-neutral-500 flex items-center gap-2 mt-1">`;

const newTitleWrapper = `  <div class="min-w-0 flex-1">
  <div class="flex items-start justify-between gap-2">
  <h4 class="font-bold text-neutral-900 text-lg leading-tight flex-1">\${currentTema || currentTitle}</h4>
  \${perfil?.is_admin ? \`<button class="btn-gestionar-modal shrink-0 p-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900 rounded-lg transition-colors border border-neutral-200" data-evento="\${domEventoId}" data-fecha="\${targetDate.toISOString()}" data-titulo="\${currentTitle}" data-tema="\${currentTema}" data-estado="\${currentEstado}" data-hora-fin="\${instancia?.hora_fin || ''}" title="Gestionar Evento">
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
  </button>\` : ''}
  </div>
  <p class="text-xs text-neutral-500 flex items-center gap-2 mt-1">`;

content = content.replace(oldTitleWrapper, newTitleWrapper);

// Step 3: Update dirListStr row to also show the miRolBadge next to it
// After dirListStr we add miRolBadge
const oldDirRow = `  <div class="flex items-center gap-4 border-t md:border-t-0 md:border-l border-neutral-200 pt-3 md:pt-0 md:pl-5">
  \${dirListStr}
  \${perfil?.is_admin ? \`
  <button class="btn-gestionar-modal ml-auto md:ml-2 p-2.5 bg-neutral-100 hover:bg-neutral-200 :bg-neutral-700 text-neutral-600 rounded-lg transition-colors border border-transparent shadow-sm" data-evento="\${domEventoId}" data-fecha="\${targetDate.toISOString()}" data-titulo="\${currentTitle}" data-tema="\${currentTema}" data-estado="\${currentEstado}" data-hora-fin="\${instancia?.hora_fin || ''}" title="Gestionar Evento">
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
  </button>\` : ''}
  </div>`;

const newDirRow = `  <div class="flex items-center gap-2 flex-wrap border-t md:border-t-0 md:border-l border-neutral-200 pt-3 md:pt-0 md:pl-5 min-w-0">
  \${dirListStr}
  \${miRolBadge}
  </div>`;

content = content.replace(oldDirRow, newDirRow);

fs.writeFileSync(file, content);
console.log('Applied list card layout fixes to programacion.astro');

// Verify replacements happened
const finalContent = fs.readFileSync(file, 'utf8');
if (finalContent.includes('btn-gestionar-modal shrink-0')) {
    console.log('✓ Pencil button moved to title area');
}
if (!finalContent.includes('${currentTema || currentTitle}${miRolBadge}')) {
    console.log('✓ miRolBadge removed from h4 title');
}
if (finalContent.includes('${dirListStr}\n  ${miRolBadge}')) {
    console.log('✓ miRolBadge added next to dirListStr');
}
