const fs = require('fs');

function fixFiles() {
    ['src/pages/herramientas/capo.astro', 'src/pages/herramientas/chordpro.astro', 'src/pages/herramientas/metronomo.astro'].forEach(file => {
        if (!fs.existsSync(file)) return;
        let raw = fs.readFileSync(file, 'utf8');
        let cnt = raw;

        // Specific Text Fixes
        cnt = cnt.replace(/text-white/g, 'text-neutral-900');
        cnt = cnt.replace(/text-neutral-400/g, 'text-neutral-600');
        cnt = cnt.replace(/text-neutral-300/g, 'text-neutral-700');
        cnt = cnt.replace(/text-neutral-200/g, 'text-neutral-800');

        // Restore text-white on primary colored buttons (blue, purple, emerald, teal, red, green)
        cnt = cnt.replace(/bg-[a-z]+-\d00(.*?)text-neutral-900/g, 'bg-$1$2text-white');
        // Let's manually fix some buttons
        cnt = cnt.replace(/bg-blue-600 hover:bg-blue-500 text-neutral-900/g, 'bg-blue-600 hover:bg-blue-500 text-white');
        cnt = cnt.replace(/bg-purple-600 hover:bg-purple-500 text-neutral-900/g, 'bg-purple-600 hover:bg-purple-500 text-white');
        cnt = cnt.replace(/bg-teal-500 hover:bg-teal-400 text-neutral-900/g, 'bg-teal-500 hover:bg-teal-400 text-white');
        cnt = cnt.replace(/bg-red-500(.*?)text-neutral-900/g, 'bg-red-500$1text-white');
        cnt = cnt.replace(/bg-green-600(.*?)text-neutral-900/g, 'bg-green-600$1text-white');
        // Fix back button SVG fill (stage mode atril close)
        cnt = cnt.replace(/hover:text-neutral-900 p-2/g, 'hover:text-white p-2'); // red button

        // Backgrounds
        cnt = cnt.replace(/bg-neutral-900/g, 'bg-white');
        cnt = cnt.replace(/bg-neutral-950/g, 'bg-white');
        cnt = cnt.replace(/bg-neutral-800/g, 'bg-neutral-50');
        cnt = cnt.replace(/bg-neutral-700/g, 'bg-neutral-100');

        // Borders
        cnt = cnt.replace(/border-neutral-800/g, 'border-neutral-200');
        cnt = cnt.replace(/border-neutral-700/g, 'border-neutral-200');

        // Fix JS logic replacements (especially in capo and chordpro)
        // In capo: 
        cnt = cnt.replace(/bg-neutral-800\/80 text-neutral-400/g, 'bg-neutral-100 text-neutral-600');
        cnt = cnt.replace(/text-white text-lg font-bold rounded-xl/g, 'text-neutral-900 text-lg font-bold rounded-xl');

        // Capo Card Styles
        cnt = cnt.replace(/bg-white text-neutral-600 border-neutral-700/g, 'bg-neutral-50 text-neutral-600 border-neutral-200');
        cnt = cnt.replace(/bg-white\/50 opacity-80/g, 'bg-neutral-50/80 opacity-80');

        // Atrial Mode in ChordPro - Needs to stay Dark!
        // We will just let it be light, or fix its specific IDs. 
        // Actually Atrial mode should probably be dark for stage.
        // Let's restore the atrial mode classes.
        cnt = cnt.replace(/id="stage-mode-container" class="hidden fixed inset-0 bg-black text-neutral-900/g, 'id="stage-mode-container" class="hidden fixed inset-0 bg-black text-white');
        cnt = cnt.replace(/<div class="text-neutral-900 mb-2">\$\{linea\}<\/div>/g, '<div class="text-white mb-2">${linea}</div>');
        cnt = cnt.replace(/<div class="text-neutral-900 whitespace-pre">/g, '<div class="text-white whitespace-pre">');

        // Fix chordpro Textareas
        cnt = cnt.replace(/bg-white border border-neutral-200 rounded-xl text-neutral-800/g, 'bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-900');

        // Fix "Volver a Herramientas" explicitly
        cnt = cnt.replace(/hover:text-neutral-900 transition-colors/g, 'hover:text-neutral-900 transition-colors'); // was white
        cnt = cnt.replace(/text-neutral-400 hover:text-white transition-colors/g, 'text-neutral-600 hover:text-neutral-900 transition-colors');

        fs.writeFileSync(file, cnt);
        console.log('Fixed', file);
    });
}
fixFiles();
