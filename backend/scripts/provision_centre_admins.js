const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const backendDir = path.join(__dirname, '..');
const { Pool } = require(path.join(backendDir, 'node_modules/pg'));
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });
const { hashPassword } = require(path.join(backendDir, 'auth.js'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Generate a strong, secure deterministic demo password per centre
function generateDemoPassword(centreId) {
  const rand = crypto.createHmac('sha256', 'kisan_queue_salt_2026').update(centreId).digest('hex').substring(0, 6).toUpperCase();
  return `Kisan@${rand}#26`;
}

async function runProvisioning() {
  const client = await pool.connect();
  try {
    console.log('====================================================');
    console.log('PHASE 3: SCALABLE CENTRE ADMIN PROVISIONING');
    console.log('====================================================\n');

    await client.query('BEGIN');

    // 1. Schema Migration: Ensure is_active column exists
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    console.log('✓ Ensured column users.is_active exists (default: TRUE).');

    // 2. Schema Migration: Ensure partial unique index exists:
    // Exactly one ACTIVE Centre Admin per centre_id
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_centre_admin 
      ON users (centre_id) 
      WHERE role = 'CENTRE_ADMIN' AND is_active = TRUE;
    `);
    console.log('✓ Ensured unique partial index idx_users_active_centre_admin exists.');

    // 3. Inspect existing Centre Admin accounts
    const existingAdminsRes = await client.query(`
      SELECT user_id, username, centre_id, district, is_active
      FROM users
      WHERE role = 'CENTRE_ADMIN';
    `);
    const existingAdmins = existingAdminsRes.rows;
    console.log(`✓ Found ${existingAdmins.length} existing Centre Admin records in users table.`);

    // Map centres that already have an active Centre Admin
    const activeCentreAdminMap = new Map(); // centre_id -> user
    let duplicateAdminsDeactivated = 0;

    for (const admin of existingAdmins) {
      if (admin.is_active && admin.centre_id) {
        if (!activeCentreAdminMap.has(admin.centre_id)) {
          activeCentreAdminMap.set(admin.centre_id, admin);
        } else {
          // Deactivate duplicate active admin for the same centre
          console.warn(`⚠️ Duplicate active admin found for ${admin.centre_id}: ${admin.username}. Deactivating...`);
          await client.query(`
            UPDATE users SET is_active = FALSE WHERE user_id = $1;
          `, [admin.user_id]);
          duplicateAdminsDeactivated++;
        }
      }
    }

    // 4. Retrieve all non-retired procurement centres
    const centresRes = await client.query(`
      SELECT centre_id, centre_name, village_town, district, operational_status
      FROM centres
      WHERE operational_status IS NULL OR operational_status != 'Retired'
      ORDER BY centre_id ASC;
    `);
    const nonRetiredCentres = centresRes.rows;
    console.log(`✓ Total non-retired centres requiring exactly 1 Active Centre Admin: ${nonRetiredCentres.length}`);

    // 5. Prepare batch insert/sync for admins
    const adminsToUpsert = [];
    const csvRecords = [];

    for (const c of nonRetiredCentres) {
      const existing = activeCentreAdminMap.get(c.centre_id);
      const isLegacyDemo = existing && ['admin_madurai', 'admin_thanjavur', 'admin_trichy', 'admin_erode', 'admin_salem'].includes(existing.username);

      if (isLegacyDemo) {
        csvRecords.push({
          username: existing.username,
          temporary_password: process.env.INITIAL_DEMO_PASSWORD || generateDemoPassword(c.centre_id),
          centre_id: c.centre_id,
          centre_name: c.centre_name,
          district: c.district,
          is_new: false
        });
      } else {
        const username = existing ? existing.username : `dpc_admin_${c.centre_id}`;
        const userId = existing ? existing.user_id : `USR_ADMIN_${c.centre_id}`;
        const tempPassword = generateDemoPassword(c.centre_id);
        const passHash = hashPassword(tempPassword);
        const fullName = `Centre Admin - ${c.centre_name}`;

        adminsToUpsert.push({
          userId,
          username,
          passHash,
          centreId: c.centre_id,
          district: c.district,
          fullName
        });

        csvRecords.push({
          username,
          temporary_password: tempPassword,
          centre_id: c.centre_id,
          centre_name: c.centre_name,
          district: c.district,
          is_new: !existing
        });
      }
    }

    console.log(`✓ Preparing ${adminsToUpsert.length} Centre Admin accounts for sync.`);

    // 6. Batch upsert Centre Admins in chunks of 500
    const BATCH_SIZE = 500;
    let insertedCount = 0;

    for (let i = 0; i < adminsToUpsert.length; i += BATCH_SIZE) {
      const chunk = adminsToUpsert.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let pIdx = 1;

      for (const u of chunk) {
        placeholders.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, 'CENTRE_ADMIN', $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, TRUE)`);
        values.push(u.userId, u.username, u.passHash, u.centreId, u.district, u.fullName);
        pIdx += 6;
      }

      const query = `
        INSERT INTO users (user_id, username, password_hash, role, centre_id, district, full_name, is_active)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (username) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          centre_id = EXCLUDED.centre_id,
          district = EXCLUDED.district,
          full_name = EXCLUDED.full_name,
          is_active = TRUE;
      `;

      await client.query(query, values);
      insertedCount += chunk.length;
      process.stdout.write(`\r... Synced ${insertedCount} / ${adminsToUpsert.length} Centre Admins`);
    }
    console.log('\n✓ Batch upsert complete.');

    // 7. Post-Provisioning Validation Checks (Pre-Commit Invariants)
    console.log('\nRunning strict pre-commit validation checks...');

    // Check 1: Non-retired centres missing an active Centre Admin
    const missingRes = await client.query(`
      SELECT count(*) as count
      FROM centres c
      WHERE (c.operational_status IS NULL OR c.operational_status != 'Retired')
      AND NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.role = 'CENTRE_ADMIN' 
          AND u.centre_id = c.centre_id
          AND u.is_active = TRUE
      );
    `);
    const missingCount = parseInt(missingRes.rows[0].count);
    if (missingCount !== 0) {
      throw new Error(`Invariant failed: ${missingCount} non-retired centres are still missing an active Centre Admin!`);
    }
    console.log('✓ Validation 1: Zero non-retired centres missing an active Centre Admin.');

    // Check 2: Centres with > 1 active Centre Admin
    const dupRes = await client.query(`
      SELECT centre_id, count(*) as cnt
      FROM users
      WHERE role = 'CENTRE_ADMIN' AND is_active = TRUE
      GROUP BY centre_id
      HAVING count(*) > 1;
    `);
    if (dupRes.rows.length > 0) {
      throw new Error(`Invariant failed: ${dupRes.rows.length} centres have multiple active Centre Admins!`);
    }
    console.log('✓ Validation 2: Zero centres have multiple active Centre Admins.');

    // Check 3: Retired centres have 0 active Centre Admins
    const retiredAdminRes = await client.query(`
      SELECT count(*) as count
      FROM centres c
      JOIN users u ON u.centre_id = c.centre_id AND u.role = 'CENTRE_ADMIN' AND u.is_active = TRUE
      WHERE c.operational_status = 'Retired';
    `);
    const retiredAdminCount = parseInt(retiredAdminRes.rows[0].count);
    if (retiredAdminCount !== 0) {
      throw new Error(`Invariant failed: ${retiredAdminCount} retired centres have active Centre Admins!`);
    }
    console.log('✓ Validation 3: Zero retired centres have active Centre Admins.');

    // Check 4: Total active Centre Admins matches total non-retired centres
    const totalActiveAdminsRes = await client.query(`
      SELECT count(*) as count
      FROM users
      WHERE role = 'CENTRE_ADMIN' AND is_active = TRUE;
    `);
    const totalActiveAdmins = parseInt(totalActiveAdminsRes.rows[0].count);
    if (totalActiveAdmins !== nonRetiredCentres.length) {
      throw new Error(`Invariant failed: Total active Centre Admins (${totalActiveAdmins}) does not match non-retired centres count (${nonRetiredCentres.length})!`);
    }
    console.log(`✓ Validation 4: Total active Centre Admins (${totalActiveAdmins}) exactly equals non-retired centres (${nonRetiredCentres.length}).`);

    // Check 5: District alignment check
    const districtMismatchRes = await client.query(`
      SELECT count(*) as count
      FROM users u
      JOIN centres c ON u.centre_id = c.centre_id
      WHERE u.role = 'CENTRE_ADMIN' AND u.is_active = TRUE
      AND LOWER(TRIM(COALESCE(u.district, ''))) != LOWER(TRIM(COALESCE(c.district, '')));
    `);
    const districtMismatchCount = parseInt(districtMismatchRes.rows[0].count);
    if (districtMismatchCount !== 0) {
      throw new Error(`Invariant failed: ${districtMismatchCount} Centre Admins have mismatched districts!`);
    }
    console.log('✓ Validation 5: Zero district mismatches between Centre Admins and assigned centres.');

    // Commit Transaction
    await client.query('COMMIT');
    console.log('\n🎉 TRANSACTION COMMITTED SUCCESSFULLY!');

    // 8. Generate Local Demo Credentials CSV
    const docsDir = path.join(__dirname, '../../docs/generated');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const csvPath = path.join(docsDir, 'demo_centre_admin_credentials.csv');

    const csvLines = [
      'username,temporary_password,centre_id,centre_name,district'
    ];
    for (const r of csvRecords) {
      const escapedName = `"${(r.centre_name || '').replace(/"/g, '""')}"`;
      const escapedDistrict = `"${(r.district || '').replace(/"/g, '""')}"`;
      csvLines.push(`${r.username},${r.temporary_password},${r.centre_id},${escapedName},${escapedDistrict}`);
    }

    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
    console.log(`\n✓ Exported ${csvRecords.length} demo credentials to ${csvPath}`);

    // 9. Final Summary Table
    console.log('\n====================================================');
    console.log('PROVISIONING SUMMARY:');
    console.log('====================================================');
    console.log(`Total non-retired centres: ${nonRetiredCentres.length}`);
    console.log(`Existing active Centre Admins: ${activeCentreAdminMap.size}`);
    console.log(`New Centre Admins created / synced: ${adminsToUpsert.length}`);
    console.log(`Duplicate admins deactivated: ${duplicateAdminsDeactivated}`);
    console.log(`Centres still missing admins: 0`);
    console.log(`Invalid centre assignments: 0`);
    console.log(`Total Active Centre Admins in database: ${totalActiveAdmins}`);
    console.log('====================================================\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ PROVISIONING FAILED & ROLLED BACK:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runProvisioning();
