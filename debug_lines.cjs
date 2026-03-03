const fs = require('fs');
const file = 'src/pages/programacion.astro';
const raw = fs.readFileSync(file, 'utf8');
const lines = raw.split('\n');

// Find the section we need (around line 695 range)
for (let i = 690; i < 705; i++) {
    console.log(`Line ${i + 1}: ${JSON.stringify(lines[i])}`);
}
