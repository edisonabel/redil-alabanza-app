const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

async function applyMigration() {
  if (!dbUrl) {
    console.error('No DATABASE_URL or SUPABASE_DB_URL found in .env');
    process.exit(1);
  }

  console.log('Connecting to Supabase Postgres...');

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to DB.');

    const sqlPath = path.join(__dirname, 'migrations', '015_playlist_voice_assignments.sql');
    const sqlScript = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying migration 015...');
    await client.query(sqlScript);
    console.log('Migration 015 applied successfully.');
  } catch (error) {
    console.error('Error applying migration 015:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
    console.log('Connection closed.');
  }
}

applyMigration();
