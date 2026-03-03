const fs = require('fs');
const file = 'src/pages/programacion.astro';
const raw = fs.readFileSync(file, 'utf8');
const lines = raw.split('\n');

// Line 695 (0-indexed: 694) is the ${dirListStr} line — we need to also add ${miRolBadge} after it
// Line 694: "  ${dirListStr}\r"
// Line 695-698: empty
// Line 699: "   </div>"

// Add miRolBadge after dirListStr
lines[694] = lines[694].replace('${dirListStr}', '${dirListStr}\r\n  ${miRolBadge}');

// Clean up blank lines 695-697
lines[695] = '';
lines[696] = '';
lines[697] = '';
lines[698] = '  </div>';

fs.writeFileSync(file, lines.join('\n'));
console.log('Done - miRolBadge added next to dirListStr');
