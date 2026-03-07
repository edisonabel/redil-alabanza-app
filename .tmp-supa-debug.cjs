const fs = require('fs');

const envPath = 'C:/Users/edici/OneDrive/Documentos/ALABANZA/.env';
const txt = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

const url = (env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
const key = env.PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  console.log('Missing Supabase env vars');
  process.exit(1);
}

(async () => {
  const mod = await import('@supabase/supabase-js');
  const supabase = mod.createClient(url, key);
  const { data, error } = await supabase
    .from('canciones')
    .select('*')
    .ilike('titulo', '%Contempla%')
    .limit(5);

  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }

  const row = (data && data[0]) || null;
  console.log('=== DIRECT SUPABASE DEBUG ===');
  console.log('match count:', (data && data.length) || 0);
  console.log('titulo:', row && row.titulo);
  console.log('voces:', row && row.voces);
  console.log('link_voces:', row && row.link_voces);
  console.log('keys:', row ? Object.keys(row) : 'NOT FOUND');
})();
