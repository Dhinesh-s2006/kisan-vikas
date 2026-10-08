const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue' });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Migrating schema for Demo Isolation and Expiry Hardening...');

    // 1. Add demo tracking columns to operational tables
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_bookings_demo ON bookings(is_demo, demo_session_id);

      ALTER TABLE farmers ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE farmers ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_farmers_demo ON farmers(is_demo, demo_session_id);

      ALTER TABLE procurement_acceptances ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE procurement_acceptances ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);

      ALTER TABLE procurement_receipts ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE procurement_receipts ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);

      ALTER TABLE procurement_weighments ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE procurement_weighments ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);

      ALTER TABLE procurement_quality ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE procurement_quality ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);

      ALTER TABLE procurement_payments ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);

      ALTER TABLE status_history ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE status_history ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_status_history_demo ON status_history(is_demo, demo_session_id);
    `);

    // 2. Create demo_sessions registry
    await client.query(`
      CREATE TABLE IF NOT EXISTS demo_sessions (
        session_id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        scenario VARCHAR(100) NOT NULL,
        centre_id VARCHAR(50) NOT NULL REFERENCES centres(centre_id),
        slot_id VARCHAR(100),
        slot_date DATE,
        status VARCHAR(30) DEFAULT 'ACTIVE',
        farmer_count INTEGER DEFAULT 0,
        created_by VARCHAR(100),
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        metadata JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_demo_sessions_centre ON demo_sessions(centre_id);
      CREATE INDEX IF NOT EXISTS idx_demo_sessions_status ON demo_sessions(status);
    `);

    // 3. Ensure slots table has proper indexing
    await client.query(`
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_expired BOOLEAN DEFAULT FALSE;
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'AVAILABLE';
      CREATE INDEX IF NOT EXISTS idx_slots_expiry_lookup ON slots(date, end_time, is_expired);
    `);

    await client.query('COMMIT');
    console.log('✅ Schema migration for Demo Isolation and Expiry Hardening successful.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
