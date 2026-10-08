const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(password) {
  const salt = 'kisan_queue_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

async function setup() {
  const client = await pool.connect();
  try {
    console.log('Starting Phase A Database Role Model setup...');
    await client.query('BEGIN');

    // 1. Create users table for authentication & RBAC
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL, -- 'FARMER', 'CENTRE_ADMIN', 'DISTRICT_OFFICER', 'CSC_OPERATOR'
        farmer_id VARCHAR(50),
        centre_id VARCHAR(50),
        district VARCHAR(100),
        full_name VARCHAR(150),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ users table ensured.');

    // 2. Add operational & counter columns to centres if not present
    await client.query(`
      ALTER TABLE centres ADD COLUMN IF NOT EXISTS active_counters INTEGER DEFAULT 2;
      ALTER TABLE centres ADD COLUMN IF NOT EXISTS staff_availability INTEGER DEFAULT 5;
      ALTER TABLE centres ADD COLUMN IF NOT EXISTS processing_rate_min INTEGER DEFAULT 12;
    `);
    console.log('✓ centres operational counter columns ensured.');

    // 3. Seed accounts for Centre Admins, District Officers, CSC, and Sample Farmer
    const initialDemoPassword = process.env.INITIAL_DEMO_PASSWORD || process.env.DEFAULT_DEMO_PASSWORD;
    if (!initialDemoPassword) {
      throw new Error('INITIAL_DEMO_PASSWORD environment variable must be set to run setup-roles.js.');
    }
    const defaultPasswordHash = hashPassword(initialDemoPassword);

    const seedUsers = [
      // CENTRE ADMINS (each assigned to exactly one centre)
      {
        user_id: 'USR_ADMIN_TN_DPC_0859',
        username: 'admin_madurai',
        role: 'CENTRE_ADMIN',
        centre_id: 'TN_DPC_0859',
        district: 'Madurai',
        full_name: 'K. Saravanan (Centre Admin Madurai)'
      },
      {
        user_id: 'USR_ADMIN_TN_DPC_1894',
        username: 'admin_thanjavur',
        role: 'CENTRE_ADMIN',
        centre_id: 'TN_DPC_1894',
        district: 'Thanjavur',
        full_name: 'R. Kumar (Centre Admin Thanjavur)'
      },
      {
        user_id: 'USR_ADMIN_TN_DPC_2520',
        username: 'admin_trichy',
        role: 'CENTRE_ADMIN',
        centre_id: 'TN_DPC_2520',
        district: 'Thiruchirappalli',
        full_name: 'S. Prakash (Centre Admin Trichy)'
      },
      {
        user_id: 'USR_ADMIN_TN_DPC_0589',
        username: 'admin_erode',
        role: 'CENTRE_ADMIN',
        centre_id: 'TN_DPC_0589',
        district: 'Erode',
        full_name: 'M. Rajendran (Centre Admin Erode)'
      },
      {
        user_id: 'USR_ADMIN_TN_DPC_1750',
        username: 'admin_salem',
        role: 'CENTRE_ADMIN',
        centre_id: 'TN_DPC_1750',
        district: 'Salem',
        full_name: 'P. Aravind (Centre Admin Salem)'
      },

      // DISTRICT OFFICERS (each assigned to exactly one district)
      {
        user_id: 'USR_DO_THANJAVUR',
        username: 'officer_thanjavur',
        role: 'DISTRICT_OFFICER',
        centre_id: null,
        district: 'Thanjavur',
        full_name: 'Thiru M. Balasubramanian (District Officer Thanjavur)'
      },
      {
        user_id: 'USR_DO_MADURAI',
        username: 'officer_madurai',
        role: 'DISTRICT_OFFICER',
        centre_id: null,
        district: 'Madurai',
        full_name: 'Dr. Jayanthi Raman (District Officer Madurai)'
      },
      {
        user_id: 'USR_DO_TRICHY',
        username: 'officer_trichy',
        role: 'DISTRICT_OFFICER',
        centre_id: null,
        district: 'Thiruchirappalli',
        full_name: 'Thiru S. Murugesan (District Officer Trichy)'
      },
      {
        user_id: 'USR_DO_ARIYALUR',
        username: 'officer_ariyalur',
        role: 'DISTRICT_OFFICER',
        centre_id: null,
        district: 'Ariyalur',
        full_name: 'Tmt. R. Revathi (District Officer Ariyalur)'
      },

      // CSC OPERATOR
      {
        user_id: 'USR_CSC_001',
        username: 'csc_operator',
        role: 'CSC_OPERATOR',
        centre_id: null,
        district: 'Madurai',
        full_name: 'Madurai Urban CSC Kiosk Operator'
      },

      // SAMPLE FARMER
      {
        user_id: 'USR_FARMER_001',
        username: 'farmer_ravi',
        role: 'FARMER',
        farmer_id: 'F0001',
        centre_id: null,
        district: 'Thanjavur',
        full_name: 'Ravi Kumar'
      }
    ];

    for (const u of seedUsers) {
      await client.query(`
        INSERT INTO users (user_id, username, password_hash, role, farmer_id, centre_id, district, full_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (username) DO UPDATE SET
          role = EXCLUDED.role,
          centre_id = EXCLUDED.centre_id,
          district = EXCLUDED.district,
          full_name = EXCLUDED.full_name,
          farmer_id = EXCLUDED.farmer_id;
      `, [
        u.user_id,
        u.username,
        defaultPasswordHash,
        u.role,
        u.farmer_id || null,
        u.centre_id || null,
        u.district || null,
        u.full_name
      ]);
    }
    console.log(`✓ Seeded/updated ${seedUsers.length} role-based user accounts.`);

    await client.query('COMMIT');
    console.log('✓ Phase A Database setup completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Setup failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
