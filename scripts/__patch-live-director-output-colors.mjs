import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/components/react/LiveDirectorView.tsx';
let source = await readFile(path, 'utf8');

const before = `                  className={\`ui-pressable-soft rounded-[1rem] border border-cyan-300/18 bg-cyan-300/[0.07] px-3 py-2.5 text-left text-cyan-50 transition-all hover:border-cyan-300/30 hover:bg-cyan-300/[0.11] disabled:cursor-not-allowed disabled:opacity-40 \${useWideTrackLoadModal ? '' : 'col-span-2'}\`}
                  aria-label={\`Cambiar distribución de salida. Actual: \${outputLayoutLabel}\`}
                  title="Toca para invertir Click/Guía y stems entre L/R"
                >
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-cyan-100/52">Salida L/R</p>
                  <p className="mt-0.5 text-[0.78rem] font-semibold leading-tight text-cyan-50">`;

const after = `                  className={\`ui-pressable-soft rounded-[1rem] px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 \${
                    outputLayout === 'guide-right'
                      ? 'border border-orange-300/40 bg-orange-400/[0.14] text-orange-50 hover:border-orange-300/60 hover:bg-orange-400/[0.20]'
                      : 'border border-blue-300/40 bg-blue-400/[0.14] text-blue-50 hover:border-blue-300/60 hover:bg-blue-400/[0.20]'
                  } \${useWideTrackLoadModal ? '' : 'col-span-2'}\`}
                  aria-label={\`Cambiar distribución de salida. Actual: \${outputLayoutLabel}\`}
                  title="Toca para invertir Click/Guía y stems entre L/R"
                >
                  <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/55">Salida L/R</p>
                  <p className="mt-0.5 text-[0.78rem] font-semibold leading-tight text-white">`;

if (!source.includes(before)) {
  throw new Error('Output selector UI target not found.');
}

source = source.replace(before, after);
await writeFile(path, source, 'utf8');
console.log('Live Director output selector now uses blue/orange state colors.');
