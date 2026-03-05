import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.PUBLIC_SUPABASE_ANON_KEY);

async function testQuery() {
    const { data, error } = await supabase.from('eventos').select('*, playlists(id, playlist_canciones(orden, canciones(id, titulo, tonalidad)))').limit(1);
    console.log("Error:", error);
    console.dir(data, { depth: null });
}

testQuery();
