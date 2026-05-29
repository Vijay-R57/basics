const { Client } = require('pg');

async function seedOffices() {
  const password = "Vijay@2005050";
  const encodedPassword = encodeURIComponent(password);
  const connectionString = `postgresql://postgres:${encodedPassword}@db.hbfwlvxeywibqmsywqgm.supabase.co:5432/postgres`;
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database for office seeding...');

    const offices = [
      { name: 'Softgel Healthcare Private Limited', city: 'Chennai', country: 'India' },
      { name: 'Solara Active Pharma Sciences Limited', city: 'Chennai', country: 'India' },
      { name: 'Strides Pharma', city: 'Chennai', country: 'India' }
    ];

    for (const office of offices) {
      console.log(`Checking office: ${office.name}...`);
      const res = await client.query(
        'SELECT id FROM public.offices WHERE name = $1 AND city = $2',
        [office.name, office.city]
      );

      if (res.rows.length === 0) {
        console.log(`Inserting office: ${office.name}...`);
        await client.query(
          'INSERT INTO public.offices (name, city, country) VALUES ($1, $2, $3)',
          [office.name, office.city, office.country]
        );
      } else {
        console.log(`Office already exists: ${office.name}`);
      }
    }

    console.log('✅ OFFICES SEEDED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Office seeding failed:', err.message);
  } finally {
    await client.end();
  }
}

seedOffices();
