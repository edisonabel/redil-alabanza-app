const fs = require('fs');
const file = 'src/pages/programacion.astro';
let raw = fs.readFileSync(file, 'utf8');

// Looking at the provided picture "Al tu rostro ver":
// - The number badge (3) is colored teal
// - Title is "Al tu rostro ver"
// - Singer is "Redil Sur"
// - There is a row with Key: A and 65 BPM badges next to each other
// - Below is the row with YouTube, Acordes, Voces

// In the code, I see:
// if (c.tonalidad) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 tracking-wide font-bold">...Key: ' + c.tonalidad + '</span>';
// if (c.bpm) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 tracking-wide font-bold">...</span>';

// The problem is that the song `c` might not have `tonalidad` set if it wasn't fetched, 
// OR the badge is there but the user wants Key and BPM to be stacked horizontally under the singer.
// Let's modify the html builder to explicitly handle Key and BPM exactly like the screenshot.
// And also fix the red hex color for YouTube to match the screenshot (red-500).

const oldLineYouTube = `if (c.link_youtube) html += '      <a href="' + c.link_youtube + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-[#ff0000]/10 text-[#ff0000] hover:bg-[#ff0000]/20 font-bold text-sm tracking-wide transition-colors">`;
const newLineYouTube = `if (c.link_youtube) html += '      <a href="' + c.link_youtube + '" target="_blank" class="flex items-center justify-center py-2.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 font-bold text-sm tracking-wide transition-colors">`;

raw = raw.replace(oldLineYouTube, newLineYouTube);

const oldKeyLine = `if (c.tonalidad) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 tracking-wide font-bold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" class="mr-1.5 text-neutral-500" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>Key: ' + c.tonalidad + '</span>';`;
const newKeyLine = `if (c.tonalidad && c.tonalidad !== '-') html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 font-bold tracking-wide"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 text-neutral-500"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>Key: ' + c.tonalidad + '</span>';`;

raw = raw.replace(oldKeyLine, newKeyLine);

const oldBpmLine = `if (c.bpm) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 tracking-wide font-bold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" class="mr-1.5 text-neutral-500" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>' + c.bpm + ' BPM</span>';`;
const newBpmLine = `if (c.bpm && c.bpm > 0) html += '        <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-300 text-neutral-700 font-bold tracking-wide"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 text-neutral-500"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>' + c.bpm + ' BPM</span>';`;

raw = raw.replace(oldBpmLine, newBpmLine);

// One thing to consider: The Key badge wasn't rendering for the user because the Key in Supabase might be literally "-" or simply empty string. The original condition `if (c.tonalidad)` would render `Key: -` if it was `-`. Now I've added `&& c.tonalidad !== '-'`.
// The user screenshot shows "Key: A". So we know `c.tonalidad` exists.

// Let's also check if "tonalidad" is correctly fetched in the supabase query.
// Line 1686: .select('orden, canciones(titulo, tonalidad, bpm, link_youtube, link_acordes, link_letras, link_voces, link_secuencias)')
// Yes, it's fetched.

fs.writeFileSync(file, raw);
console.log('Fixed Key and BPM badge conditions and YouTube badge color.');
