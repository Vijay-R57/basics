const { Client } = require('pg');

async function seed() {
  const password = "Vijay@2005050";
  const encodedPassword = encodeURIComponent(password);
  const connectionString = `postgresql://postgres:${encodedPassword}@db.hbfwlvxeywibqmsywqgm.supabase.co:5432/postgres`;
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database for seeding...');

    // 1. Ensure pgcrypto is enabled
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

    // 2. Define users to seed
    const users = [
      {
        email: 'arc100@arcolab.com',
        password: 'ARCOLAB100',
        metadata: {
          first_name: 'Shankar',
          last_name: 'R',
          role: 'worker',
          employee_code: 'ARC100'
        }
      },
      {
        email: 'arc101@arcolab.com',
        password: 'ARCOLAB101',
        metadata: {
          first_name: 'Naveen',
          last_name: 'SV',
          role: 'supervisor',
          employee_code: 'ARC101'
        }
      },
      {
        email: 'arc102@arcolab.com',
        password: 'ARCOLAB102',
        metadata: {
          first_name: 'Guest',
          last_name: 'User',
          role: 'worker',
          employee_code: 'ARC102'
        }
      }
    ];

    for (const u of users) {
      console.log(`Checking user: ${u.email}...`);
      const res = await client.query('SELECT id FROM auth.users WHERE email = $1', [u.email]);
      
      if (res.rows.length === 0) {
        console.log(`Inserting user: ${u.email}...`);
        
        // Supabase Auth stores password hash using crypt(password, salt) where salt uses bcrypt (bf)
        const insertQuery = `
          INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            is_super_admin
          ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            gen_random_uuid(),
            'authenticated',
            'authenticated',
            $1,
            crypt($2, gen_salt('bf', 10)),
            now(),
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            $3::jsonb,
            now(),
            now(),
            false
          ) RETURNING id;
        `;
        
        const insertRes = await client.query(insertQuery, [u.email, u.password, JSON.stringify(u.metadata)]);
        const newUserId = insertRes.rows[0].id;
        console.log(`User ${u.email} seeded with ID: ${newUserId}`);
      } else {
        const userId = res.rows[0].id;
        console.log(`User ${u.email} already exists with ID: ${userId}. Updating metadata...`);
        await client.query(`
          UPDATE auth.users 
          SET raw_user_meta_data = $1::jsonb, updated_at = now()
          WHERE id = $2
        `, [JSON.stringify(u.metadata), userId]);
        
        // Let's also sync standard columns to public.profiles manually if the trigger didn't catch older rows
        await client.query(`
          INSERT INTO public.profiles (id, email, first_name, last_name, role, employee_code)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            email = excluded.email,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            role = excluded.role,
            employee_code = excluded.employee_code;
        `, [
          userId, 
          u.email, 
          u.metadata.first_name, 
          u.metadata.last_name, 
          u.metadata.role, 
          u.metadata.employee_code
        ]);
      }
    }
    console.log('✅ OPERATIONAL ACCOUNTS SEEDED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
  } finally {
    await client.end();
  }
}

seed();
