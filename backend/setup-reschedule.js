const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setupReschedule() {
  console.log('--- Setting up Phase C: Rescheduling & Audit Infrastructure ---');

  try {
    // 1. Add reschedule_count to bookings if missing
    await pool.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;
    `);
    console.log('✓ Verified reschedule_count column in bookings table.');

    // 2. Create reschedule_events audit table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reschedule_events (
        id SERIAL PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL REFERENCES bookings(booking_id),
        old_slot_id VARCHAR(100),
        new_slot_id VARCHAR(100),
        old_centre_id VARCHAR(50) REFERENCES centres(centre_id),
        new_centre_id VARCHAR(50) REFERENCES centres(centre_id),
        reason TEXT,
        recommended_by VARCHAR(100) DEFAULT 'SMART_SCHEDULER_HEURISTIC',
        accepted_by VARCHAR(50),
        action VARCHAR(20) DEFAULT 'ACCEPTED',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ Created reschedule_events audit table.');

    // 3. Create index for fast lookups by booking_id
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reschedule_booking_id 
      ON reschedule_events(booking_id);
    `);
    console.log('✓ Created index on reschedule_events(booking_id).');

    console.log('--- Phase C Database Setup Completed Successfully ---');
  } catch (err) {
    console.error('Setup error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupReschedule();
