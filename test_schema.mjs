import 'dotenv/config';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing PUBLIC_SUPABASE_URL/SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY');
}

fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/mi_agenda?limit=1`, {
  headers: {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
  }
}).then(r => r.json()).then(d => {
  if (d.length > 0) {
    console.log('--- COLUMNS IN MI_AGENDA VIEW ---');
    console.log(Object.keys(d[0]).join('\n'));
  } else {
    console.log('View is empty.');
  }
}).catch(console.error);
