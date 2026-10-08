/**
 * KISAN QUEUE / UZHAVARSETHU
 * Phase 3 Database Migration: Master Platform Architecture
 * 
 * Safe, idempotent migration that adds:
 * 1. booking_requests (Decoupled booking request lifecycle)
 * 2. taluks & localities (Authoritative local geographic master with lat/long)
 * 3. slots.held_count (Two-phase concurrency-safe slot allocation)
 * 
 * ZERO DATA LOSS: Does not drop any existing tables, preserves all 3,200+ DPCs and demo records.
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Authoritative Tamil Nadu Taluks by District mapping
const TN_TALUK_MAP = {
  'Ariyalur': ['Ariyalur', 'Sendurai', 'Udayarpalayam', 'Andimadam'],
  'Thanjavur': ['Thanjavur', 'Kumbakonam', 'Papanasam', 'Pattukkottai', 'Orathanadu', 'Thiruvaiyaru', 'Budalur', 'Peravurani', 'Thiruvidaimarudur'],
  'Thiruvarur': ['Thiruvarur', 'Mannargudi', 'Nannilam', 'Thiruthuraipoondi', 'Valangaiman', 'Kudavasal', 'Needamangalam', 'Koothanallur'],
  'Cuddalore': ['Cuddalore', 'Panruti', 'Chidambaram', 'Vriddhachalam', 'Titakudi', 'Kurinjipadi', 'Bhuvanagiri', 'Srimushnam', 'Veppur'],
  'Madurai': ['Madurai North', 'Madurai South', 'Melur', 'Vadipatti', 'Thirumangalam', 'Usilampatti', 'Peraiyur', 'Madurai West', 'Thiruparankundram'],
  'Chengalpattu': ['Chengalpattu', 'Madurantakam', 'Cheyyur', 'Tambaram', 'Pallavaram', 'Tiruporur', 'Vandalur'],
  'Thiruchirappalli': ['Tiruchirappalli West', 'Tiruchirappalli East', 'Srirangam', 'Lalgudi', 'Manachanallur', 'Musiri', 'Thuraiyur', 'Manapparai'],
  'Vellore': ['Vellore', 'Katpadi', 'Gudiyatham', 'Anaicut', 'K.V.Kuppam', 'Pernambut'],
  'Nagapattinam': ['Nagapattinam', 'Kilvelur', 'Vedaranyam', 'Thirukkuvalai'],
  'Mayiladuthurai': ['Mayiladuthurai', 'Sirkazhi', 'Tharangambadi', 'Kuthalam'],
  'Pudukkottai': ['Pudukkottai', 'Alangudi', 'Aranthangi', 'Gandarvakottai', 'Iluppur', 'Kulathur', 'Thirumayam'],
  'Erode': ['Erode', 'Perundurai', 'Bhavani', 'Gobichettipalayam', 'Sathyamangalam', 'Anthiyur', 'Modakkurichi'],
  'Salem': ['Salem', 'Attur', 'Mettur', 'Omalur', 'Sankari', 'Edappadi', 'Gangavalli'],
  'Dindigul': ['Dindigul East', 'Dindigul West', 'Palani', 'Oddanchatram', 'Nilakottai', 'Natham'],
  'Tiruppur': ['Tiruppur North', 'Tiruppur South', 'Avinashi', 'Dharapuram', 'Kangeyam', 'Udumalaipettai'],
  'Coimbatore': ['Coimbatore North', 'Coimbatore South', 'Pollachi', 'Mettupalayam', 'Sulur', 'Annur']
};

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('--- STARTING PHASE 3 DATABASE MIGRATIONS ---');
    await client.query('BEGIN');

    // 1. Create booking_requests table
    console.log('Creating booking_requests table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS booking_requests (
        request_id VARCHAR(64) PRIMARY KEY,
        request_reference VARCHAR(64) UNIQUE NOT NULL,
        farmer_id VARCHAR(64) NOT NULL REFERENCES farmers(farmer_id) ON DELETE CASCADE,
        phone_number VARCHAR(32) NOT NULL,
        district VARCHAR(100) NOT NULL,
        locality_id VARCHAR(64),
        locality_name VARCHAR(255),
        crop VARCHAR(100) NOT NULL DEFAULT 'Paddy (Common)',
        quantity_quintals NUMERIC NOT NULL DEFAULT 10,
        status VARCHAR(64) NOT NULL DEFAULT 'REQUESTED',
        source VARCHAR(32) NOT NULL DEFAULT 'WEB', -- 'WEB', 'IVR', 'CSC'
        selected_centre_id VARCHAR(64) REFERENCES centres(centre_id) ON DELETE SET NULL,
        selected_slot_id VARCHAR(64) REFERENCES slots(slot_id) ON DELETE SET NULL,
        final_booking_id VARCHAR(64) REFERENCES bookings(booking_id) ON DELETE SET NULL,
        optimization_reason JSONB,
        slot_hold_expires_at TIMESTAMP,
        assigned_at TIMESTAMP,
        sms_status VARCHAR(32) DEFAULT 'PENDING',
        idempotency_key VARCHAR(128),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_booking_requests_farmer_id ON booking_requests(farmer_id);
      CREATE INDEX IF NOT EXISTS idx_booking_requests_district ON booking_requests(district);
      CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);
      CREATE INDEX IF NOT EXISTS idx_booking_requests_reference ON booking_requests(request_reference);
      CREATE INDEX IF NOT EXISTS idx_booking_requests_idempotency ON booking_requests(idempotency_key);
    `);
    console.log('✔ booking_requests table created with indexes.');

    // 2. Add held_count to slots table
    console.log('Ensuring slots.held_count column exists...');
    await client.query(`
      ALTER TABLE slots 
      ADD COLUMN IF NOT EXISTS held_count INTEGER DEFAULT 0;
    `);
    console.log('✔ slots.held_count ensured.');

    // 3. Create taluks table
    console.log('Creating taluks table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS taluks (
        taluk_id VARCHAR(64) PRIMARY KEY,
        district VARCHAR(100) NOT NULL,
        taluk_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_district_taluk UNIQUE (district, taluk_name)
      );
      CREATE INDEX IF NOT EXISTS idx_taluks_district ON taluks(district);
    `);
    console.log('✔ taluks table created.');

    // 4. Create localities table
    console.log('Creating localities master table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS localities (
        locality_id VARCHAR(64) PRIMARY KEY,
        district VARCHAR(100) NOT NULL,
        taluk_id VARCHAR(64) REFERENCES taluks(taluk_id) ON DELETE SET NULL,
        taluk_name VARCHAR(100),
        locality_name VARCHAR(255) NOT NULL,
        type VARCHAR(32) DEFAULT 'VILLAGE', -- 'VILLAGE', 'TOWN'
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        status VARCHAR(32) DEFAULT 'ACTIVE',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_district_locality UNIQUE (district, locality_name)
      );

      CREATE INDEX IF NOT EXISTS idx_localities_district ON localities(district);
      CREATE INDEX IF NOT EXISTS idx_localities_taluk ON localities(taluk_name);
      CREATE INDEX IF NOT EXISTS idx_localities_name ON localities(locality_name);
      CREATE INDEX IF NOT EXISTS idx_localities_coords ON localities(latitude, longitude);
    `);
    console.log('✔ localities table created with indexes.');

    // 5. Seed authoritative Taluks
    console.log('Seeding authoritative taluks for Tamil Nadu...');
    for (const [dist, talukList] of Object.entries(TN_TALUK_MAP)) {
      let tIdx = 0;
      for (const tName of talukList) {
        tIdx++;
        const safeName = tName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const tId = `TLK_${dist.toUpperCase().slice(0, 4)}_${safeName}_${tIdx}`;
        await client.query(`
          INSERT INTO taluks (taluk_id, district, taluk_name)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [tId, dist, tName]);
      }
    }
    console.log('✔ Authoritative taluks seeded.');

    // 6. Seed Localities from centres and farmers data with coordinates
    console.log('Seeding localities from existing centres and farmer villages...');
    
    // A. Localities from centres (with high accuracy coordinates)
    const centreVillages = await client.query(`
      SELECT district, village_town, 
             AVG(latitude) as lat, AVG(longitude) as lon
      FROM centres
      WHERE district IS NOT NULL 
        AND village_town IS NOT NULL 
        AND TRIM(village_town) != ''
      GROUP BY district, village_town
    `);

    let locCount = 0;
    for (const row of centreVillages.rows) {
      const dist = row.district.trim();
      const vName = row.village_town.trim();
      if (!dist || !vName) continue;

      // Assign nearest or default taluk for district
      const districtTaluks = TN_TALUK_MAP[dist] || [dist];
      const talukName = districtTaluks[0];
      const safeTName = talukName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const tId = `TLK_${dist.toUpperCase().slice(0, 4)}_${safeTName}_1`;
      const locId = `LOC_${dist.toUpperCase().slice(0, 4)}_${locCount}`;

      // Ensure taluk row exists for foreign key
      await client.query(`
        INSERT INTO taluks (taluk_id, district, taluk_name)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [tId, dist, talukName]);

      await client.query(`
        INSERT INTO localities (locality_id, district, taluk_id, taluk_name, locality_name, type, latitude, longitude, status)
        VALUES ($1, $2, $3, $4, $5, 'VILLAGE', $6, $7, 'ACTIVE')
        ON CONFLICT (district, locality_name) DO UPDATE 
        SET latitude = COALESCE(EXCLUDED.latitude, localities.latitude),
            longitude = COALESCE(EXCLUDED.longitude, localities.longitude)
      `, [locId, dist, tId, talukName, vName, row.lat ? parseFloat(row.lat) : null, row.lon ? parseFloat(row.lon) : null]);
      locCount++;
    }

    // B. Localities from farmers
    const farmerVillages = await client.query(`
      SELECT DISTINCT district, village
      FROM farmers
      WHERE district IS NOT NULL 
        AND village IS NOT NULL 
        AND TRIM(village) != ''
    `);

    for (const row of farmerVillages.rows) {
      const dist = row.district.trim();
      const vName = row.village.trim();
      if (!dist || !vName) continue;

      const districtTaluks = TN_TALUK_MAP[dist] || [dist];
      const talukName = districtTaluks[0];
      const safeTName = talukName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const tId = `TLK_${dist.toUpperCase().slice(0, 4)}_${safeTName}_1`;
      const locId = `LOC_${dist.toUpperCase().slice(0, 4)}_${locCount}`;

      // Ensure taluk row exists for foreign key
      await client.query(`
        INSERT INTO taluks (taluk_id, district, taluk_name)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [tId, dist, talukName]);

      await client.query(`
        INSERT INTO localities (locality_id, district, taluk_id, taluk_name, locality_name, type, status)
        VALUES ($1, $2, $3, $4, $5, 'VILLAGE', 'ACTIVE')
        ON CONFLICT (district, locality_name) DO NOTHING
      `, [locId, dist, tId, talukName, vName]);
      locCount++;
    }

    // Ensure specific Vellore locality for test farmers (Vandranthangal) has coordinates
    await client.query(`
      UPDATE localities
      SET latitude = 12.9654, longitude = 79.1325
      WHERE district = 'Vellore' AND locality_name ILIKE '%Vandranthangal%'
    `);

    await client.query('COMMIT');
    console.log(`✔ Localities master seeded successfully (${locCount} candidate entries).`);
    console.log('--- PHASE 3 MIGRATIONS COMPLETE ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => {
  console.error(e);
  process.exit(1);
});
