const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function run() {
    const connectionString = process.env.DATABASE_URL || process.env.PUBLIC_SUPABASE_URL.replace('https://', 'postgres://postgres:').replace('.supabase.co', '.supabase.co:5432/postgres');
    // Need the direct PG connection string.
    // The user's .env usually has DATABASE_URL for Postgres connections.
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error("No DATABASE_URL found in .env");
        process.exit(1);
    }

    const client = new Client({ connectionString: dbUrl });

    try {
        await client.connect();
        console.log('Connected to DB');
        const sql = fs.readFileSync('migrations/009_rls_moderadores_asignaciones.sql', 'utf8');
        await client.query(sql);
        console.log('Migration 009 applied successfully.');
    } catch (e) {
        console.error('Error applying migration:', e);
    } finally {
        await client.end();
    }
}

run();
