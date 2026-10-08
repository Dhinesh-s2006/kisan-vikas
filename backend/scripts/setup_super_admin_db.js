const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { hashPassword } = require('../auth');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initAdminDb() {
  try {
    console.log('Ensuring Super Admin database schema...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id SERIAL PRIMARY KEY,
        admin_id VARCHAR(50) NOT NULL,
        admin_username VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id VARCHAR(100),
        status VARCHAR(20) DEFAULT 'SUCCESS',
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs(action);

      CREATE TABLE IF NOT EXISTS website_content (
        id SERIAL PRIMARY KEY,
        content_key VARCHAR(100) UNIQUE NOT NULL,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        priority INTEGER DEFAULT 0,
        updated_by VARCHAR(100),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        description TEXT,
        updated_by VARCHAR(100),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE farmers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `);

    // Ensure default SUPER_ADMIN user exists
    const existing = await pool.query("SELECT * FROM users WHERE role = 'SUPER_ADMIN' OR username = 'superadmin'");
    if (existing.rows.length === 0) {
      const defaultPassword = process.env.INITIAL_DEMO_PASSWORD || 'kisan@123';
      const passHash = hashPassword(defaultPassword);
      await pool.query(`
        INSERT INTO users (user_id, username, password_hash, role, full_name, district, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        'USR_SUPER_ADMIN_01',
        'superadmin',
        passHash,
        'SUPER_ADMIN',
        'Chief Administrator (State Nodal HQ)',
        'State HQ (Chennai)',
        true
      ]);
      console.log('✓ Default Super Admin account created: username: superadmin');
    } else {
      console.log('✓ Super Admin account exists:', existing.rows[0].username);
    }

    // Seed default website_content if empty
    const contentCount = await pool.query('SELECT COUNT(*) FROM website_content');
    if (parseInt(contentCount.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO website_content (content_key, title, category, content, priority, is_active, updated_by)
        VALUES 
        ('samba_season_2026', 'Samba Paddy Procurement 2026 Active', 'ANNOUNCEMENT', 'Direct Procurement Centres across all 38 districts of Tamil Nadu are open for Samba paddy arrivals. Minimum Support Price: Rs. 2,375 / quintal.', 1, true, 'superadmin'),
        ('moisture_standard_notice', 'Paddy Moisture Specification Guideline', 'NOTICE', 'Farmers are advised to dry paddy to below 17% moisture content to qualify for Common Grade MSP and avoid grading deductions.', 2, true, 'superadmin'),
        ('farmer_support_hotline', 'Statewide Agricultural Support Line', 'SUPPORT', 'Toll-free Kisan Vikas grievance & assistance line: 1800-425-4444 (Operational Monday to Saturday, 8:00 AM to 6:00 PM).', 3, true, 'superadmin')
      `);
      console.log('✓ Seeded default website_content.');
    }

    // Seed default system_settings if empty
    const settingsCount = await pool.query('SELECT COUNT(*) FROM system_settings');
    if (parseInt(settingsCount.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO system_settings (setting_key, setting_value, category, description, updated_by)
        VALUES 
        ('platform_name', 'Kisan Vikas', 'GENERAL', 'Official public application name displayed across all portals', 'superadmin'),
        ('support_helpline', '1800-425-4444', 'SUPPORT', 'Statewide toll-free telephone support line', 'superadmin'),
        ('booking_lookahead_days', '7', 'CAPACITY', 'Maximum days ahead farmers can reserve procurement slots', 'superadmin'),
        ('max_daily_procurement_quintals', '100', 'CAPACITY', 'Default daily procurement quota per farmer in quintals', 'superadmin'),
        ('announcement_banner_enabled', 'true', 'ANNOUNCEMENT', 'Master switch to display urgent broadcast banners on portals', 'superadmin'),
        ('moisture_rejection_threshold', '20.0', 'CAPACITY', 'Moisture percentage above which grain cannot be procured without drying', 'superadmin')
      `);
      console.log('✓ Seeded default system_settings.');
    }

    console.log('Super Admin database tables successfully verified!');
  } catch (err) {
    console.error('Super Admin DB initialization error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initAdminDb();
