import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkQueries() {
    console.log("1. Test Roles");
    const { data: r, error: er } = await supabase.from('roles').select('*');
    console.log(er ? er : `Roles: ${r?.length}`);

    console.log("2. Test Perfiles");
    const { data: p, error: ep } = await supabase.from('perfiles').select('*');
    console.log(ep ? ep : `Perfiles: ${p?.length}`);

    console.log("3. Test Perfil_Roles");
    const { data: pr, error: epr } = await supabase.from('perfil_roles').select('*');
    console.log(epr ? epr : `Pivot: ${pr?.length}`);
}

checkQueries();
