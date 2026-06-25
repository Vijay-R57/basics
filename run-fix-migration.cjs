// Apply the fix migration using Supabase REST API with service role key
// This uses pg_dump/sql endpoint available on the Supabase management API

const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_PROJECT_ID = 'hbfwlvxeywibqmsywqgm';

// Read the SQL migration file
const sqlFile = path.join(__dirname, 'supabase', 'migrations', '20260615120000_fix_trigger_and_rls_for_history.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

console.log('SQL to apply:');
console.log('='.repeat(60));
console.log(sql.substring(0, 200) + '...');
console.log('='.repeat(60));
console.log('\nTo apply this migration to your Supabase project:');
console.log('1. Go to: https://supabase.com/dashboard/project/' + SUPABASE_PROJECT_ID + '/sql/new');
console.log('2. Paste the contents of:');
console.log('   supabase/migrations/20260615120000_fix_trigger_and_rls_for_history.sql');
console.log('3. Click "Run" to execute the migration');
console.log('\nThis fixes:');
console.log('  - BEFORE INSERT trigger no longer raises exception for unknown employees');
console.log('  - Explicit RLS policies for anon + authenticated reads on analysis_logs');
