import 'dotenv/config';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing PUBLIC_SUPABASE_URL/SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY');
}

fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/eventos`, {
  headers: {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
  }
}).then(r => r.json()).then(d => {
    console.log('--- RAW EVENTOS TABLE ---');
    console.log(d);
}).catch(console.error);
