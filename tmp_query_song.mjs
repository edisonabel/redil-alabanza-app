import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const envText = fs.readFileSync('C:/Users/edici/OneDrive/Documentos/ALABANZA/.env','utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(Boolean).filter(line=>!line.startsWith('#')).map(line=>{const i=line.indexOf('='); return [line.slice(0,i), line.slice(i+1)];}));
const url=(env.PUBLIC_SUPABASE_URL||env.SUPABASE_URL||'').replace(/\/$/,'');
const key=env.PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY||'';
const supabase=createClient(url,key);
const { data, error } = await supabase
  .from('canciones')
  .select('id, titulo, cantante, chordpro')
  .ilike('titulo','%A Dios el Padre%')
  .limit(3);
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(JSON.stringify((data||[]).map(row=>({
  id: row.id,
  titulo: row.titulo,
  cantante: row.cantante,
  chordproPreview: String(row.chordpro||'').slice(0,260)
})), null, 2));
