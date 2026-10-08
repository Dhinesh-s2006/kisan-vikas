const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue' });

async function check() {
  const res = await pool.query(`
    SELECT f.farmer_id, f.name, f.phone, b.booking_id, b.status, b.booking_date
    FROM farmers f
    LEFT JOIN bookings b ON f.farmer_id = b.farmer_id
    WHERE f.farmer_id = 'F969805' OR f.phone = '9000000016'
    ORDER BY b.created_at DESC
  `);
  console.table(res.rows);
  await pool.end();
}

check().catch(console.error);
