const fs = require('fs');
const file = 'src/pages/programacion.astro';
const raw = fs.readFileSync(file, 'utf8');
const lines = raw.split('\n');

// Lines 1717-1731 (0-indexed: 1716-1730) are the song card HTML generation
// FIX: Restructure each song card to be column-based so badges wrap properly
// Line 1717 (idx 1716): outer card div - change from flex-row to flex-col
lines[1716] = lines[1716].replace(
    '"flex items-center gap-4 p-4 rounded-xl bg-white border border-neutral-200/60 hover:border-neutral-300 :border-neutral-600 transition-colors"',
    '"flex items-start gap-3 p-3 rounded-xl bg-white border border-neutral-200/60 hover:border-neutral-300 transition-colors min-w-0 overflow-hidden"'
);

// Line 1719 (idx 1718): inner content div - change to flex-col so title is top, badges below
lines[1718] = lines[1718].replace(
    '"flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2"',
    '"flex-1 min-w-0 flex flex-col gap-1.5"'
);

// Line 1720 (idx 1719): title - remove min-w-[150px] that causes overflow
lines[1719] = lines[1719].replace(
    '"font-bold text-base md:text-lg tracking-tight text-neutral-900 truncate min-w-[150px]"',
    '"font-bold text-sm tracking-tight text-neutral-900 truncate w-full"'
);

// Line 1721 (idx 1720): badges container - already flex-wrap, just ensure it doesn't overflow
lines[1720] = lines[1720].replace(
    '"flex flex-wrap items-center gap-2"',
    '"flex flex-wrap items-center gap-1.5 w-full"'
);

// Line 1726 (idx 1725): links (YouTube/Acordes/Voces/Letras) container - should also wrap
lines[1725] = lines[1725].replace(
    '"flex items-center gap-2 shrink-0 flex-wrap justify-end"',
    '"flex flex-wrap items-center gap-1.5 w-full mt-1"'
);

fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed song card layout in detalle modal - badges now wrap properly');
