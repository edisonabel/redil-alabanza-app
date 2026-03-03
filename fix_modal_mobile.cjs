const fs = require('fs');
const file = 'src/pages/programacion.astro';
let content = fs.readFileSync(file, 'utf8');

// FIX 1: The datetime-local input causing x-overflow (add overflow-hidden and ensure it's constrained)
// Also make the date/time grid stack on mobile always
content = content.replace(
    '<div class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5">',
    '<div class="md:col-span-2 grid grid-cols-1 gap-4">'
);

// FIX 1b: The datetime-local input — add min-w-0 to prevent overflow
content = content.replace(
    '<input type="datetime-local" id="ev-fecha" required class="w-full bg-neutral-100 border border-neutral-300 rounded-xl px-4 py-3 text-sm text-neutral-900 focus:outline-none focus:border-teal-500 transition-colors">',
    '<input type="datetime-local" id="ev-fecha" required class="w-full min-w-0 max-w-full bg-neutral-100 border border-neutral-300 rounded-xl px-3 py-3 text-sm text-neutral-900 focus:outline-none focus:border-teal-500 transition-colors" style="box-sizing:border-box;">'
);

// FIX 2: The action buttons DIV — move it OUT from before the roster section, to after the roster section
// Strategy: remove buttons from current position, and add them after the modal-roster-section div (before </form>)

const buttonsHtml = `
  <div class="mt-6 flex gap-3 pt-4 border-t border-neutral-200 sticky bottom-0 bg-white pb-2">
  <button type="button" id="btn-cancel-modal" class="flex-1 py-3.5 px-4 bg-neutral-100 hover:bg-neutral-200 :bg-neutral-700 border border-neutral-300 text-sm text-neutral-900 rounded-xl font-bold transition-colors">Cancelar</button>
  <button type="submit" id="btn-submit-modal" class="flex-1 py-3.5 px-4 bg-teal-500 hover:bg-teal-400 text-white text-sm rounded-xl font-bold transition-colors flex justify-center items-center gap-2">
  <span>Guardar Evento</span>
  <div id="btn-spinner" class="hidden w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
  </button>
  </div>`;

// Remove existing buttons block
const oldButtons = `  <div class="mt-6 flex gap-3 pt-4 border-t border-neutral-200 sticky bottom-0 bg-white pb-2">
  <button type="button" id="btn-cancel-modal" class="flex-1 py-3.5 px-4 bg-neutral-100 hover:bg-neutral-200 :bg-neutral-700 border border-neutral-300 text-sm text-neutral-900 rounded-xl font-bold transition-colors">Cancelar</button>
  <button type="submit" id="btn-submit-modal" class="flex-1 py-3.5 px-4 bg-teal-500 hover:bg-teal-400 text-white text-sm rounded-xl font-bold transition-colors flex justify-center items-center gap-2">
  <span>Guardar Evento</span>
  <div id="btn-spinner" class="hidden w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
  </button>
  </div>
  </form>
  </div>
  </div>
  </div>`;

const newButtons = `  </div>
  </div>
  </div>
${buttonsHtml}
  </form>
  </div>
  </div>
  </div>`;

if (content.includes(oldButtons)) {
    content = content.replace(oldButtons, newButtons);
    console.log('Buttons moved successfully');
} else {
    console.log('WARNING: Buttons block not found exactly, skipping move');
}

// FIX 3: Add overflow-hidden to modal inner container to prevent any x-scroll leakage
content = content.replace(
    'class="bg-white border border-neutral-300 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col transform"',
    'class="bg-white border border-neutral-300 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden shadow-2xl flex flex-col transform"'
);

// FIX 4: The inner form content area — add overflow-x-hidden to prevent cascading x overflow
content = content.replace(
    '<div class="p-6 bg-white flex-1">',
    '<div class="p-6 bg-white flex-1 overflow-x-hidden">'
);

fs.writeFileSync(file, content);
console.log('All mobile modal fixes applied to programacion.astro');
