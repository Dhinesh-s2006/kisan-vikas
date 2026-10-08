require('dotenv').config({ path: 'c:/Users/DHINESH.S/Desktop/kisan-queue/backend/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function prepare() {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  console.log('Preparing slots for date:', tomorrow);

  // Set Anaicut (TN_DPC_3475) in Vellore to Active
  await pool.query(
    "UPDATE centres SET operational_status = 'Active', active_counters = 3, staff_availability = 5 WHERE centre_id = 'TN_DPC_3475'"
  );
  console.log('Updated TN_DPC_3475 to Active');

  const times = [
    { start: '09:00:00', end: '10:00:00' },
    { start: '10:00:00', end: '11:00:00' },
    { start: '11:00:00', end: '12:00:00' },
    { start: '13:00:00', end: '14:00:00' },
    { start: '14:00:00', end: '15:00:00' },
    { start: '15:00:00', end: '16:00:00' }
  ];

  for (const t of times) {
    const slotId = `TN_DPC_3475_${tomorrow.replace(/-/g, '')}_${t.start.replace(/:/g, '').slice(0, 4)}`;
    await pool.query(`
      INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count)
      VALUES ($1, 'TN_DPC_3475', $2, $3, $4, 20, 0, 0)
      ON CONFLICT (slot_id) DO UPDATE SET max_farmers = 20, booked_count = 0, held_count = 0
    `, [slotId, tomorrow, t.start, t.end]);
  }
  console.log('Created standard slots for TN_DPC_3475 on', tomorrow);

  // Verify
  const slots = await pool.query('SELECT * FROM slots WHERE centre_id = $1 AND date = $2', ['TN_DPC_3475', tomorrow]);
  console.log('Verified slots count:', slots.rows.length);

  await pool.end();
}
prepare();
