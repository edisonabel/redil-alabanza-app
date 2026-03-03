const fs = require('fs');
const file = 'src/layouts/Layout.astro';
let content = fs.readFileSync(file, 'utf8');
// Add px-4 to the main wrapper
content = content.replace(
    'class="w-full max-w-6xl mx-auto pb-24"',
    'class="w-full max-w-6xl mx-auto pb-24 px-4"'
);
fs.writeFileSync(file, content);
console.log('Added px-4 to Layout.astro main wrapper');
