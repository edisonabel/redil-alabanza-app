const fs = require('fs');
const file = 'src/pages/programacion.astro';
let content = fs.readFileSync(file, 'utf8');

// Fix 1: the HTML button - it uses text-white making the Tarjeta text invisible
// Original: bg-white text-white ... border border-transparent
// Target: bg-white text-orange-500 ... border border-orange-400
content = content.replace(
    `class="px-5 py-2.5 bg-white text-white text-sm font-bold rounded-xl shadow-sm transition-colors border border-transparent"`,
    `class="px-5 py-2.5 bg-white text-orange-500 text-sm font-bold rounded-xl shadow-sm transition-colors border border-orange-400"`
);

// Fix 2: the active state array in JS has '' empty strings and text-white
content = content.replace(
    `const activeClassBg = ['bg-white', '', 'text-white', '', 'shadow-sm'];`,
    `const activeClassBg = ['bg-white', 'text-orange-500', 'border-orange-400', 'shadow-sm'];`
);

// Fix 3: the inactive state array has '' empty strings
content = content.replace(
    `const inactiveClassBg = ['bg-white', '', 'text-neutral-600', '', 'hover:bg-neutral-50', ':bg-neutral-100'];`,
    `const inactiveClassBg = ['bg-white', 'text-neutral-600', 'border-neutral-300', 'hover:bg-neutral-50'];`
);

fs.writeFileSync(file, content);
console.log('Fixed view toggle buttons in programacion.astro');
