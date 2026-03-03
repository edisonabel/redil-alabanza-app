const fs = require('fs');
const file = 'src/pages/programacion.astro';
let raw = fs.readFileSync(file, 'utf8');

// 1. Remove the completely unwanted 'Cerrar Sesión' button
const oldLogoutBtn = ` <button id="btn-logout" class="px-5 py-2.5 bg-neutral-200 hover:bg-neutral-300 :bg-neutral-700 text-sm font-bold text-neutral-900 rounded-xl transition-all border border-neutral-300 w-fit">
 Cerrar Sesión
 </button>`;
raw = raw.replace(oldLogoutBtn, '');

// Also ensure the Javascript side for btn-logout doesn't break if element is missing.
// It is safely guarded by `if (btnLogout)` in most cases, but let's check.

// 2. We already applied the mobile form inputs fixes previously, 
// let's just make sure there are no other `w-80` or `md:col-span-2` issues in the form.
// Upon checking the previous chunk replacements, they applied correctly but `md:col-span-2` 
// was replaced by `w-full`.
raw = raw.replace(/md:col-span-2/g, 'w-full');

fs.writeFileSync(file, raw);
console.log('Removed logout button as requested.');
