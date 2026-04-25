const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

async function applyMigration() {
    if (!dbUrl) {
        console.error('No DATABASE_URL or SUPABASE_DB_URL found in .env');
        process.exitCode = 1;
        return;
    }

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
