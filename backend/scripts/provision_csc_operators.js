// backend/scripts/provision_csc_operators.js
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
    console.log('🚀 STARTING PHASE 5: CSC OPERATOR PROVISIONING');
    console.log('====================================================\n');

    await client.query('BEGIN');

    // 1. Fetch canonical list of non-retired districts
    console.log('1. Querying canonical non-retired districts from centres table...');
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

    // 2. Inspect existing CSC_OPERATOR accounts
    console.log('2. Inspecting existing CSC_OPERATOR accounts in users table...');
    const existingOperatorsRes = await client.query(`
      SELECT user_id, username, role, district, is_active
      FROM users
      WHERE role = 'CSC_OPERATOR'
    `);
    const existingOperators = existingOperatorsRes.rows;
    console.log(`✓ Found ${existingOperators.length} existing CSC Operator account(s):`);
    existingOperators.forEach(o => {
      console.log(`  - ${o.username} (District: ${o.district}, Active: ${o.is_active})`);
    });

    // Map existing active operators by normalized district
    const activeOperatorsByDistrict = new Map();
    existingOperators.forEach(o => {
      if (o.is_active && o.district) {
        if (!activeOperatorsByDistrict.has(o.district.trim().toLowerCase())) {
          activeOperatorsByDistrict.set(o.district.trim().toLowerCase(), o);
        }
      }
    });

    // 3. Provision CSC Operators for missing districts
    console.log('\n3. Provisioning CSC Operators for districts...');
    const allCredentials = [];
    let createdCount = 0;
    let retainedCount = 0;

    for (const d of canonicalDistricts) {
      const normalized = d.normalized_district;
      const rawDistrict = d.district;

      if (activeOperatorsByDistrict.has(normalized)) {
        // Retain existing operator (e.g. csc_operator for Madurai)
        const existing = activeOperatorsByDistrict.get(normalized);
        const isOriginalDemo = existing.username === 'csc_operator';
        const expectedPassword = isOriginalDemo ? (process.env.INITIAL_DEMO_PASSWORD || generateDemoPassword(rawDistrict)) : generateDemoPassword(rawDistrict);

        console.log(`  [RETAINED] ${rawDistrict.padEnd(20)} → ${existing.username}`);
        retainedCount++;
        allCredentials.push({
          username: existing.username,
          temporary_password: expectedPassword,
          district: rawDistrict,
          note: isOriginalDemo ? 'PRE_EXISTING_DEMO_ACCOUNT' : 'PROVISIONED_PHASE_5'
        });
      } else {
        // Create new CSC operator account
        const slug = normalized.replace(/[^a-z0-9]/g, '_');
        const username = `csc_${slug}`;
        const userId = `USR_CSC_${slug.toUpperCase()}`;
        const tempPassword = generateDemoPassword(rawDistrict);
        const passHash = hashPassword(tempPassword);
        const fullName = `Assisted Service Kiosk Operator (${rawDistrict})`;

        await client.query(`
          INSERT INTO users (
            user_id, username, password_hash, role, district, centre_id, full_name, is_active, created_at
          ) VALUES ($1, $2, $3, 'CSC_OPERATOR', $4, NULL, $5, TRUE, NOW())
          ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            district = EXCLUDED.district,
            role = 'CSC_OPERATOR',
            is_active = TRUE
        `, [userId, username, passHash, rawDistrict, fullName]);

        console.log(`  [CREATED]  ${rawDistrict.padEnd(20)} → ${username}`);
        createdCount++;
        allCredentials.push({
          username,
          temporary_password: tempPassword,
          district: rawDistrict,
          note: 'PROVISIONED_PHASE_5'
        });
      }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Transaction committed successfully.`);
    console.log(`  - New accounts created: ${createdCount}`);
    console.log(`  - Existing accounts retained: ${retainedCount}`);
    console.log(`  - Total active CSC Operators: ${createdCount + retainedCount} / ${canonicalDistricts.length}`);

    // 4. Write credentials CSV report
    const docsDir = path.join(__dirname, '../../docs/generated');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const csvPath = path.join(docsDir, 'demo_csc_operator_credentials.csv');
    const csvContent = [
      'username,temporary_password,district,note',
      ...allCredentials.map(c => `${c.username},${c.temporary_password},"${c.district}",${c.note}`)
    ].join('\n');

    fs.writeFileSync(csvPath, csvContent, 'utf8');
    console.log(`\n✓ Exported ${allCredentials.length} CSC Operator credentials to:`);
    console.log(`  ${csvPath}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during CSC Operator provisioning:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runProvisioning();
