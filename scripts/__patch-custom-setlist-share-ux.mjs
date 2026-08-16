import fs from 'node:fs';

const replaceExact = (source, search, replacement, label) => {
  const count = source.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return source.replace(search, replacement);
};

const hubPath = 'src/components/react/EnsayoHub.jsx';
let hub = fs.readFileSync(hubPath, 'utf8');
hub = replaceExact(
  hub,
  'className="ui-pressable-soft col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-700 shadow-sm transition-colors hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15 md:col-span-1 md:col-start-3 md:row-start-1"',
  'className="ui-pressable-soft mt-4 inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-black text-blue-700 shadow-sm transition-colors hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15"',
  'full-width share button',
);
fs.writeFileSync(hubPath, hub);

const repertorioPath = 'src/pages/repertorio.astro';
let repertorio = fs.readFileSync(repertorioPath, 'utf8');
const oldNavigation = [
  "  alert(copied",
  "   ? '\\u00A1Setlist personalizada creada y enlace copiado!'",
  "   : '\\u00A1Setlist personalizada creada!');",
  "  window.open(url, '_blank', 'noopener,noreferrer');",
].join('\n');
const newNavigation = [
  "  const feedbackMount = document.getElementById('ensayo-global-mount');",
  "  if (feedbackMount) {",
  "   feedbackMount.innerHTML = '<div class=\"custom-setlist-navigation-feedback\" role=\"status\" aria-live=\"polite\"><span class=\"custom-setlist-navigation-spinner\" aria-hidden=\"true\"></span><strong>Abriendo modo ensayo...</strong></div>';",
  "  }",
  "",
  "  await new Promise<void>((resolve) => {",
  "   requestAnimationFrame(() => requestAnimationFrame(() => resolve()));",
  "  });",
  "  window.location.assign(url);",
].join('\n');
repertorio = replaceExact(
  repertorio,
  oldNavigation,
  newNavigation,
  'same-tab rehearsal navigation',
);

const oldStyleAnchor = `<style is:global>\n /* Content visibility optimizations for long list scroll performance */`;
const newStyleAnchor = `<style is:global>\n .custom-setlist-navigation-feedback {\n   position: fixed;\n   inset: 0;\n   z-index: 120;\n   display: flex;\n   flex-direction: column;\n   align-items: center;\n   justify-content: center;\n   gap: 0.9rem;\n   padding: 1.5rem;\n   color: white;\n   background: rgb(9 9 11 / 0.82);\n   backdrop-filter: blur(12px);\n   -webkit-backdrop-filter: blur(12px);\n   text-align: center;\n }\n\n .custom-setlist-navigation-feedback strong {\n   font-size: 0.95rem;\n   font-weight: 800;\n   letter-spacing: -0.01em;\n }\n\n .custom-setlist-navigation-spinner {\n   width: 2.4rem;\n   height: 2.4rem;\n   border: 3px solid rgb(255 255 255 / 0.24);\n   border-top-color: white;\n   border-radius: 9999px;\n   animation: custom-setlist-navigation-spin 720ms linear infinite;\n }\n\n @keyframes custom-setlist-navigation-spin {\n   to { transform: rotate(360deg); }\n }\n\n @media (prefers-reduced-motion: reduce) {\n   .custom-setlist-navigation-spinner { animation: none; }\n }\n\n /* Content visibility optimizations for long list scroll performance */`;
repertorio = replaceExact(
  repertorio,
  oldStyleAnchor,
  newStyleAnchor,
  'setlist navigation feedback styles',
);
fs.writeFileSync(repertorioPath, repertorio);

console.log('Custom setlist share UX patch applied.');
