const fs = require('fs');

function fix(file) {
    if (!fs.existsSync(file)) return;
    let raw = fs.readFileSync(file, 'utf8');
    let cnt = raw;

    // Fix index.astro backgrounds missing from previous run
    if (file.includes('index.astro')) {
        cnt = cnt.replace(/\bbg-neutral-950\/50\b/g, 'bg-white/50');
        cnt = cnt.replace(/\bbg-neutral-950\b/g, 'bg-white');
        cnt = cnt.replace(/\bbg-neutral-900\/50\b/g, 'bg-white/50');
        cnt = cnt.replace(/\bbg-neutral-900\b/g, 'bg-white');
        cnt = cnt.replace(/\bbg-neutral-800\/80\b/g, 'bg-neutral-100/80');
        cnt = cnt.replace(/\bbg-neutral-800\/50\b/g, 'bg-neutral-100/50');
        cnt = cnt.replace(/\bbg-neutral-800\b/g, 'bg-neutral-100');
        cnt = cnt.replace(/\bborder-neutral-800\b/g, 'border-neutral-200');
        cnt = cnt.replace(/\bborder-neutral-700\b/g, 'border-neutral-300');
    }

    // 1. Logo
    cnt = cnt.replace(/src="\/LOGO REDIL\.png"/g, 'src="/LOGO REDIL LIGHT.png"');

    // 2. Titles & Headers
    // Herramientas Title
    cnt = cnt.replace(/text-white mb-4 flex flex-col items-center/g, 'text-neutral-900 mb-4 flex flex-col items-center');
    // Herramientas Cards
    cnt = cnt.replace(/text-xl font-bold text-white mb-2/g, 'text-xl font-bold text-neutral-900 mb-2');
    // Repertorio/Index Title
    cnt = cnt.replace(/text-white leading-tight/g, 'text-neutral-900 leading-tight');

    // 3. Inputs & Selects (The white text on white bg issue)
    cnt = cnt.replace(/text-white rounded-xl /g, 'text-neutral-900 rounded-xl ');
    cnt = cnt.replace(/placeholder:text-neutral-600/g, 'placeholder:text-neutral-400');

    // Labels (make them slightly darker to stand out)
    cnt = cnt.replace(/text-neutral-400 mb-2/g, 'text-neutral-600 mb-2');
    cnt = cnt.replace(/text-neutral-400 mb-1/g, 'text-neutral-600 mb-1');
    cnt = cnt.replace(/text-neutral-500 mb-2/g, 'text-neutral-700 mb-2');
    cnt = cnt.replace(/text-neutral-500 mb-1/g, 'text-neutral-700 mb-1');

    // Resultados de Canciones
    cnt = cnt.replace(/<h2 class="text-neutral-400 font-medium/g, '<h2 class="text-neutral-600 font-medium');
    cnt = cnt.replace(/<h2 class="text-neutral-500 font-medium/g, '<h2 class="text-neutral-700 font-medium');

    // 4. View Toggles (Grid \/ List) in HTML
    cnt = cnt.replace(/bg-neutral-100 text-white shadow-sm/g, 'bg-white text-neutral-900 shadow-sm border border-neutral-200');
    cnt = cnt.replace(/bg-neutral-800 text-white shadow-sm/g, 'bg-white text-neutral-900 shadow-sm border border-neutral-200');
    cnt = cnt.replace(/text-neutral-400 hover:text-white/g, 'text-neutral-400 hover:text-neutral-900');
    cnt = cnt.replace(/text-neutral-500 hover:text-white/g, 'text-neutral-400 hover:text-neutral-900');

    // View Toggles in JS
    cnt = cnt.replace(/classList\.add\('bg-neutral-800', 'text-white'/g, "classList.add('bg-white', 'text-neutral-900', 'border', 'border-neutral-200'");
    cnt = cnt.replace(/classList\.remove\('bg-neutral-800', 'text-white'/g, "classList.remove('bg-white', 'text-neutral-900', 'border', 'border-neutral-200'");
    cnt = cnt.replace(/hover:text-white/g, 'hover:text-neutral-900');

    // Bottom Panel Setlist
    cnt = cnt.replace(/bg-neutral-800 border border-neutral-700 text-white p-4/g, 'bg-white border border-neutral-200 text-neutral-900 p-4');
    cnt = cnt.replace(/bg-neutral-700 hover:bg-neutral-600/g, 'bg-neutral-200 text-neutral-800 hover:bg-neutral-300');

    if (cnt !== raw) {
        fs.writeFileSync(file, cnt);
        console.log('Fixed styles in:', file);
    }
}

['src/pages/index.astro', 'src/pages/repertorio.astro', 'src/pages/herramientas.astro'].forEach(fix);
