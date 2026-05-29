const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const password = "Vijay@2005050";
  const encodedPassword = encodeURIComponent(password);
  const connectionString = `postgresql://postgres:${encodedPassword}@db.hbfwlvxeywibqmsywqgm.supabase.co:5432/postgres`;
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to Supabase PostgreSQL database...');
    await client.connect();
    console.log('Connected!');

    const migrationFile = path.join(__dirname, 'supabase', 'migrations', '20260521210500_production_database_architecture.sql');
    console.log(`Reading migration SQL file: ${migrationFile}`);
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('Applying migration transaction to the database. This may take a few seconds...');
    await client.query(sql);
    
    console.log('✅ DATABASE ARCHITECTURE HAS BEEN SUCCESSFULLY UPGRADED TO PRODUCTION STATE!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
