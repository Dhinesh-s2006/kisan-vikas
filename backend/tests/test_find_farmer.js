const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue' });

async function find() {
  const res = await pool.query(`
    SELECT f.farmer_id, f.name, f.phone, f.district
    FROM farmers f
    WHERE f.district = 'Ariyalur'
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.farmer_id = f.farmer_id
          AND b.status IN ('Confirmed', 'Pending', 'In-Progress')
      )
    ORDER BY f.farmer_id
    LIMIT 5;
  `);
  console.table(res.rows);
  await pool.end();
}

find().catch(console.error);
