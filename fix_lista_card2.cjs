const fs = require('fs');
const file = 'src/pages/programacion.astro';
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Line 683 (0-indexed: 682): h4 with miRolBadge in title - remove badge from title
lines[682] = lines[682].replace(
    '${currentTema || currentTitle}${miRolBadge}',
    '${currentTema || currentTitle}'
);
// Also fix the h4 class to remove flex-wrap (no longer needed here)
lines[682] = lines[682].replace(
    'class="font-bold text-neutral-900 text-lg flex items-center flex-wrap"',
    'class="font-bold text-neutral-900 text-lg"'
);

// Line 691 (0-indexed: 690): The bottom section - add miRolBadge next to dirListStr, remove pencil
lines[690] = lines[690].replace(
    'class="flex items-center gap-4 border-t md:border-t-0 md:border-l border-neutral-200 pt-3 md:pt-0 md:pl-5"',
    'class="flex items-center gap-2 flex-wrap border-t md:border-t-0 md:border-l border-neutral-200 pt-2 md:pt-0 md:pl-4"'
);

// Line 692 (0-indexed: 691): after dirListStr, add miRolBadge
lines[691] = lines[691].replace(
    '  ${dirListStr}',
    '  ${dirListStr}\r\n  ${miRolBadge}'
);

// Lines 693-696: Remove the pencil button from the bottom section (it will be inline-top)
// We need to check: the pencil block is lines 693-696 (0-indexed 692-695)
// Instead we'll just check what those lines are
console.log('Line 693:', JSON.stringify(lines[692]));
console.log('Line 694:', JSON.stringify(lines[693]));
console.log('Line 695:', JSON.stringify(lines[694]));
console.log('Line 696:', JSON.stringify(lines[695]));
console.log('Line 697:', JSON.stringify(lines[696]));

// The pencil button is part of lines 693-697 as a template literal
// Let's reconstruct those lines to remove the old pencil from bottom 
// and add a smaller pencil to the h4 title wrapper instead

// Add pencil to h4 wrapper (line 682-688 range)
// Let's add the pencil AFTER the h4, before the time paragraph
const adminPencilInline = '  \${perfil?.is_admin ? `<button class="btn-gestionar-modal ml-auto shrink-0 p-1.5 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors" data-evento="\${domEventoId}" data-fecha="\${targetDate.toISOString()}" data-titulo="\${currentTitle}" data-tema="\${currentTema}" data-estado="\${currentEstado}" data-hora-fin="\${instancia?.hora_fin || \'\'}" title="Gestionar Evento"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>` : \'\'}';

// Wrap h4 and pencil in a flex row
lines[682] = '  \u003cdiv class="flex items-start justify-between gap-2"\u003e\r\n' +
    '   \u003ch4 class="font-bold text-neutral-900 text-lg leading-tight flex-1"\u003e${currentTema || currentTitle}\u003c/h4\u003e\r\n' +
    adminPencilInline + '\r\n' +
    '  \u003c/div\u003e';

// Remove the pencil button from the bottom dirListStr section (lines 693-696)
// Replace lines 692-695 (the is_admin pencil button block) with empty
if (lines[692].includes('${perfil?.is_admin ?')) {
    lines[692] = '';
    if (lines[693].includes('btn-gestionar-modal')) lines[693] = '';
    if (lines[694].includes('svg')) lines[694] = '';
    if (lines[695].includes(": ''")) lines[695] = '  \u003c/div\u003e';
    if (lines[696] && lines[696].trim() === '\u003c/div\u003e') lines[696] = '';
}

fs.writeFileSync(file, lines.join('\n'));
console.log('\u2713 Done patching programacion.astro list card layout');
