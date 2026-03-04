const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Lee la URL directa que funciona (la usaste antes) o usa las vars del entorno
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "postgres://postgres:S41ntp4ul2026++@db.xxtlmykmdntozgczdtnw.supabase.co:5432/postgres";

async function applyMigration() {
    console.log('🔗 Conectando a Supabase...');
    const client = new Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Conectado a la BD.');

        const sqlPath = path.join(__dirname, 'migrations', '010_rls_roles_perfil.sql');
        const sqlScript = fs.readFileSync(sqlPath, 'utf8');

        console.log('⚡ Ejecutando migración 010...');
        await client.query(sqlScript);

        console.log('🎉 Migración de Políticas RLS para perfiles_roles aplicada con éxito!');
    } catch (error) {
        console.error('❌ Error aplicando la migración:', error);
    } finally {
        await client.end();
        console.log('🔌 Conexión cerrada.');
    }
}

applyMigration();
