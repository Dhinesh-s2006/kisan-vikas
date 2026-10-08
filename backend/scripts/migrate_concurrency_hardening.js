const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATION] Starting concurrency and slot capacity hardening migration...');
    await client.query('BEGIN');

    // 1. Verify no existing slots violate booked_count <= max_farmers
    const overbooked = await client.query('SELECT slot_id, max_farmers, booked_count FROM slots WHERE booked_count > max_farmers');
    if (overbooked.rows.length > 0) {
      console.warn(`[MIGRATION] Warning: ${overbooked.rows.length} slots exceed max_farmers. Normalizing...`);
      for (const row of overbooked.rows) {
        console.log(`  Fixing slot ${row.slot_id}: booked_count was ${row.booked_count}, max was ${row.max_farmers}`);
        await client.query('UPDATE slots SET booked_count = max_farmers WHERE slot_id = $1', [row.slot_id]);
      }
    }

    // 2. Add CHECK constraint on slots table (chk_slot_capacity)
    const constraintCheck = await client.query(`
      SELECT conname FROM pg_constraint WHERE conname = 'chk_slot_capacity' AND conrelid = 'slots'::regclass
    `);
    if (constraintCheck.rows.length === 0) {
      console.log('[MIGRATION] Adding constraint chk_slot_capacity on slots (booked_count <= max_farmers)...');
      await client.query(`
        ALTER TABLE slots
        ADD CONSTRAINT chk_slot_capacity CHECK (booked_count <= max_farmers)
      `);
      console.log('[MIGRATION] Constraint chk_slot_capacity added successfully.');
    } else {
      console.log('[MIGRATION] Constraint chk_slot_capacity already exists.');
    }

    // 3. Add idempotency_key column to bookings table
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'idempotency_key'
    `);
    if (colCheck.rows.length === 0) {
      console.log('[MIGRATION] Adding column idempotency_key to bookings table...');
      await client.query(`
        ALTER TABLE bookings
        ADD COLUMN idempotency_key VARCHAR(120) NULL
      `);
      console.log('[MIGRATION] Column idempotency_key added successfully.');
    } else {
      console.log('[MIGRATION] Column idempotency_key already exists in bookings.');
    }

    // 4. Create UNIQUE index on idempotency_key
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key
      ON bookings (idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    console.log('[MIGRATION] Unique index idx_bookings_idempotency_key verified.');

    await client.query('COMMIT');
    console.log('[MIGRATION] Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[MIGRATION] Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
