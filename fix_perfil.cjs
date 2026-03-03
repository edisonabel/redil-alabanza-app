const fs = require('fs');
const file = 'src/pages/perfil.astro';
let content = fs.readFileSync(file, 'utf8');

// Fix both classList.remove calls with empty string ''
content = content.replace(
    "classList.remove('bg-neutral-200', '', 'animate-pulse', 'h-7', 'min-w-[120px]', 'flex', 'items-center', 'justify-center')",
    "classList.remove('bg-neutral-200', 'animate-pulse', 'h-7', 'min-w-[120px]', 'flex', 'items-center', 'justify-center')"
);
content = content.replace(
    "classList.remove('bg-neutral-200', '', 'animate-pulse', 'h-5', 'min-w-[160px]', 'flex', 'items-center', 'justify-center')",
    "classList.remove('bg-neutral-200', 'animate-pulse', 'h-5', 'min-w-[160px]', 'flex', 'items-center', 'justify-center')"
);

fs.writeFileSync(file, content);
console.log('Fixed empty string tokens in classList.remove in', file);
