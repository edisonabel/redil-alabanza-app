const { Client } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || process.env.PUBLIC_SUPABASE_URL.replace('https://', 'postgres://postgres:').replace('.supabase.co', '.supabase.co:5432/postgres');

async function fixPolicies() {
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        console.log('🔗 Connected to DB');

        // We drop and recreate just to be safe, handling both tables.
        const sql = `
      DO $$ BEGIN
        -- roles
        BEGIN
            DROP POLICY IF EXISTS "Todos los usuarios pueden ver roles" ON public.roles;
        EXCEPTION WHEN OTHERS THEN END;
        
        -- perfil_roles
        BEGIN
            DROP POLICY IF EXISTS "Todos los usuarios pueden ver perfil_roles" ON public.perfil_roles;
        EXCEPTION WHEN OTHERS THEN END;
      END $$;

      ALTER TABLE IF EXISTS public.roles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Todos los usuarios pueden ver roles" ON public.roles FOR SELECT TO authenticated USING (true);

      ALTER TABLE IF EXISTS public.perfil_roles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Todos los usuarios pueden ver perfil_roles" ON public.perfil_roles FOR SELECT TO authenticated USING (true);
    `;

        await client.query(sql);
        console.log('✅ RLS Policies fixed successfully!');
    } catch (error) {
        console.error('❌ Error fixing policies:', error);
    } finally {
        await client.end();
    }
}

fixPolicies();
