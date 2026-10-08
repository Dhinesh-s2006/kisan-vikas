const { Pool } = require('../node_modules/pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('../node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });

const SALT = 'kisan_queue_salt_2026';

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME
});

function hashPassword(password) {
  return crypto.pbkdf2Sync(password, SALT, 1000, 64, 'sha512').toString('hex');
}

function generateDemoPassword(district) {
  const hash = crypto.createHmac('sha256', SALT).update(district).digest('hex');
  return `Kisan@${hash.slice(0, 6).toUpperCase()}#26`;
}

async function runProvisioning() {
  const client = await pool.connect();
  try {
    console.log('====================================================');
    console.log('🚀 STARTING PHASE 4: DISTRICT OFFICER PROVISIONING');
    console.log('====================================================\n');

    await client.query('BEGIN');

    // 1. Ensure partial unique index on active district officers
    console.log('1. Ensuring partial unique index on users (district) for active DISTRICT_OFFICER...');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_district_officer 
      ON users (LOWER(TRIM(district))) 
      WHERE role = 'DISTRICT_OFFICER' AND is_active = TRUE;
    `);
    console.log('✓ Partial unique index idx_users_active_district_officer verified.\n');

    // 2. Fetch canonical list of non-retired districts
    console.log('2. Querying canonical non-retired districts from centres table...');
    const districtsRes = await client.query(`
      SELECT 
        TRIM(district) as district,
        LOWER(TRIM(district)) as normalized_district,
        COUNT(*) as centre_count
      FROM centres
      WHERE operational_status != 'Retired' AND district IS NOT NULL AND TRIM(district) != ''
      GROUP BY TRIM(district), LOWER(TRIM(district))
      ORDER BY TRIM(district) ASC
    `);
    const canonicalDistricts = districtsRes.rows;
    console.log(`✓ Found ${canonicalDistricts.length} canonical non-retired districts.\n`);

    // 3. Inspect existing District Officers
    console.log('3. Inspecting existing DISTRICT_OFFICER accounts in users table...');
    const existingOfficersRes = await client.query(`
      SELECT user_id, username, role, district, is_active
      FROM users
      WHERE role = 'DISTRICT_OFFICER'
    `);
    const existingOfficers = existingOfficersRes.rows;
    console.log(`✓ Found ${existingOfficers.length} existing District Officer account(s):`);
    existingOfficers.forEach(o => {
      console.log(`  - ${o.username} (District: ${o.district}, Active: ${o.is_active})`);
    });

    // Map existing active officers by normalized district
    const activeOfficersByDistrict = new Map();
    existingOfficers.forEach(o => {
      if (o.is_active && o.district) {
        activeOfficersByDistrict.set(o.district.trim().toLowerCase(), o);
      }
    });

    // 4. Provision missing District Officers
    console.log('\n4. Provisioning District Officers for missing districts...');
    const allCredentials = [];
    let createdCount = 0;
    let retainedCount = 0;

    for (const d of canonicalDistricts) {
      const normalized = d.normalized_district;
      const rawDistrict = d.district;

      const isOriginalDemo = ['officer_thanjavur', 'officer_madurai', 'officer_trichy', 'officer_ariyalur'].includes(activeOfficersByDistrict.get(normalized)?.username);
      const expectedPassword = isOriginalDemo ? (process.env.INITIAL_DEMO_PASSWORD || generateDemoPassword(rawDistrict)) : generateDemoPassword(rawDistrict);

      if (activeOfficersByDistrict.has(normalized)) {
        // Retain existing officer
        const existing = activeOfficersByDistrict.get(normalized);
        console.log(`  [RETAINED] ${rawDistrict.padEnd(20)} → ${existing.username}`);
        retainedCount++;
        allCredentials.push({
          username: existing.username,
          temporary_password: expectedPassword,
          district: rawDistrict,
          note: isOriginalDemo ? 'PRE_EXISTING_DEMO_ACCOUNT' : 'PROVISIONED_PHASE_4'
        });
      } else {
        // Create new officer account
        const slug = normalized.replace(/[^a-z0-9]/g, '_');
        const username = `district_officer_${slug}`;
        const userId = `USR_DO_${slug.toUpperCase()}`;
        const tempPassword = generateDemoPassword(rawDistrict);
        const passHash = hashPassword(tempPassword);
        const fullName = `District Officer (${rawDistrict})`;

        await client.query(`
          INSERT INTO users (
            user_id, username, password_hash, role, district, centre_id, full_name, is_active, created_at
          ) VALUES ($1, $2, $3, 'DISTRICT_OFFICER', $4, NULL, $5, TRUE, NOW())
          ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            district = EXCLUDED.district,
            role = 'DISTRICT_OFFICER',
            is_active = TRUE
        `, [userId, username, passHash, rawDistrict, fullName]);

        console.log(`  [CREATED]  ${rawDistrict.padEnd(20)} → ${username}`);
        createdCount++;
        allCredentials.push({
          username,
          temporary_password: tempPassword,
          district: rawDistrict,
          note: 'PROVISIONED_PHASE_4'
        });
      }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Transaction committed successfully.`);
    console.log(`  - New accounts created: ${createdCount}`);
    console.log(`  - Existing accounts retained: ${retainedCount}`);
    console.log(`  - Total active District Officers: ${createdCount + retainedCount} / ${canonicalDistricts.length}`);

    // 5. Write credentials CSV report
    const docsDir = path.join(__dirname, '../../docs/generated');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const csvPath = path.join(docsDir, 'demo_district_officer_credentials.csv');
    const csvContent = [
      'username,temporary_password,district,note',
      ...allCredentials.map(c => `${c.username},${c.temporary_password},"${c.district}",${c.note}`)
    ].join('\n');

    fs.writeFileSync(csvPath, csvContent, 'utf8');
    console.log(`\n✓ Exported ${allCredentials.length} District Officer credentials to:`);
    console.log(`  ${csvPath}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during District Officer provisioning:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runProvisioning();
