const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Pool, types } = require('pg');
// Canonical Date Rule: PostgreSQL DATE (OID 1082) represents a calendar date (YYYY-MM-DD), NOT a timestamp.
// Return DATE as raw string (YYYY-MM-DD) to prevent timezone drift, UTC conversion, and off-by-one shifts.
types.setTypeParser(1082, (val) => val);
const {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyTokenString,
  authenticateToken,
  optionalAuthenticate,
  requireRole,
  enforceCentreAdminIsolation,
  enforceDistrictOfficerIsolation,
  enforceFarmerIsolation
} = require('./auth');
const {
  initPredictivePlanningDb,
  createPredictivePlanningRouter
} = require('./predictivePlanning');
const { createVoiceAgentRouter } = require('./voiceAgentRoutes');
const { createOfficerAiRouter } = require('./officerAiRoutes');
const { createBookingRequestRouter } = require('./bookingRequestRoutes');
const { createLocalityRouter } = require('./localityRoutes');
const { createIVRRouter } = require('./ivrRoutes');
const {
  NOTIFICATION_TYPES,
  PRIORITIES,
  createFarmerNotification,
  getFarmerNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead
} = require('./notificationService');
const {
  isSlotExpired,
  isSlotBookable,
  isBookingGenuinelyActive
} = require('./services/booking/slotValidation');
const {
  ensureCentreSlots,
  getCentreSlotsWithAvailability,
  expirePastSlots
} = require('./services/booking/slotService');
const {
  getKolkataNow,
  normalizeDateStr,
  getValidBookingDates,
  isPastDate,
  BOOKING_LOOKAHEAD_DAYS
} = require('./services/common/timeService');
const { defaultDistanceService } = require('./services/distance/distanceService');
const { defaultCongestionService } = require('./services/congestion/congestionService');
const { defaultWeatherService } = require('./services/weather/weatherService');
const { CentreService } = require('./services/centre/centreService');
const { CentreRecommendationService } = require('./services/centre/centreRecommendationService');
const { validateStatusTransition } = require('./services/booking/statusTransitionService');


const app = express();

// Base allowed origins for production and local development
const DEFAULT_ALLOWED_ORIGINS = [
  'https://kisan-queue-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3001',
  'http://localhost:3000',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5174'
];

// Parse origins from environment variables (ALLOWED_ORIGINS, CORS_ALLOWED_ORIGINS, FRONTEND_URL, ADMIN_FRONTEND_URL)
const parseOrigins = (raw) => {
  if (!raw) return [];
  return raw
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(o => o && o !== '*'); // Disallow wildcard origin to protect credentialed auth
};

const envOrigins = [
  ...parseOrigins(process.env.ALLOWED_ORIGINS),
  ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
  ...parseOrigins(process.env.FRONTEND_URL),
  ...parseOrigins(process.env.ADMIN_FRONTEND_URL)
];

const allowedOriginsSet = new Set([
  ...DEFAULT_ALLOWED_ORIGINS.map(o => o.replace(/\/+$/, '')),
  ...envOrigins
]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (e.g. mobile apps, curl, server-to-server tests)
    if (!origin) {
      return callback(null, true);
    }
    const cleanOrigin = origin.replace(/\/+$/, '');
    if (allowedOriginsSet.has(cleanOrigin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Authorization'],
  optionsSuccessStatus: 200 // Ensure successful HTTP 200 response on OPTIONS preflight
};

// Register CORS middleware before any API routes
app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'invalid_json', message: 'Malformed JSON payload.' });
  }
  next(err);
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use('/api', createPredictivePlanningRouter(pool));
app.use('/api/voice-agent', createVoiceAgentRouter({ pool }));
app.use('/api/officer-ai', createOfficerAiRouter({ pool }));
app.use('/api/booking-requests', createBookingRequestRouter({ pool }));
app.use('/api/localities', createLocalityRouter({ pool }));
app.use('/api/ivr', createIVRRouter({ pool }));
const { createSuperAdminRouter } = require('./superAdminRoutes');
app.use('/api/super-admin', createSuperAdminRouter({ pool }));

// Verify and ensure backward-compatible columns exist
async function initDb() {
  try {
    await pool.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_source VARCHAR(50) DEFAULT 'SELF_SERVICE';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS operator_id VARCHAR(50) DEFAULT NULL;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS token VARCHAR(50) DEFAULT NULL;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE centres ADD COLUMN IF NOT EXISTS active_counters INTEGER DEFAULT 2;
      ALTER TABLE centres ADD COLUMN IF NOT EXISTS staff_availability INTEGER DEFAULT 5;
      ALTER TABLE centres ADD COLUMN IF NOT EXISTS processing_rate_min INTEGER DEFAULT 12;
      ALTER TABLE farmers ADD COLUMN IF NOT EXISTS block TEXT;
      ALTER TABLE farmers ADD COLUMN IF NOT EXISTS panchayat TEXT;
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        farmer_id VARCHAR(50),
        centre_id VARCHAR(50),
        district VARCHAR(100),
        full_name VARCHAR(150),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pacing_events (
        id SERIAL PRIMARY KEY,
        centre_id VARCHAR(50) REFERENCES centres(centre_id),
        pacing_status VARCHAR(30) NOT NULL,
        recommended_action VARCHAR(30) NOT NULL,
        delay_minutes INTEGER DEFAULT 0,
        planned_rate_min NUMERIC,
        observed_rate_min NUMERIC,
        active_queue_count INTEGER,
        reason TEXT,
        affected_count INTEGER DEFAULT 0,
        applied_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pacing_status VARCHAR(30) DEFAULT 'NORMAL';
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recommended_delay_minutes INTEGER DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pacing_acknowledged_at TIMESTAMP;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pacing_acknowledged_by VARCHAR(50);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS disruption_count INTEGER DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS last_disrupted_at TIMESTAMP;
      ALTER TABLE reschedule_events ADD COLUMN IF NOT EXISTS disruption_source VARCHAR(50) DEFAULT 'SYSTEM';
      ALTER TABLE reschedule_events ADD COLUMN IF NOT EXISTS is_system_disruption BOOLEAN DEFAULT TRUE;

      -- Phase 7.3: Digital Procurement Record tables
      CREATE TABLE IF NOT EXISTS procurement_quality (
        quality_id VARCHAR(50) PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        quality_status VARCHAR(30) NOT NULL DEFAULT 'ASSESSED',
        grade VARCHAR(50) NOT NULL,
        moisture_percentage NUMERIC(5, 2),
        foreign_matter_percentage NUMERIC(5, 2),
        damaged_grain_percentage NUMERIC(5, 2),
        remarks TEXT,
        assessed_by VARCHAR(100) NOT NULL,
        assessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        source VARCHAR(50) DEFAULT 'CENTRE_ADMIN_MANUAL',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_quality_booking UNIQUE (booking_id)
      );

      CREATE TABLE IF NOT EXISTS procurement_weighments (
        weighment_id VARCHAR(50) PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        gross_weight_kg NUMERIC(10, 2) NOT NULL,
        tare_weight_kg NUMERIC(10, 2) NOT NULL,
        net_weight_kg NUMERIC(10, 2) NOT NULL,
        weighing_method VARCHAR(50) DEFAULT 'ELECTRONIC_WEIGHBRIDGE',
        weighment_reference VARCHAR(100),
        recorded_by VARCHAR(100) NOT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        source VARCHAR(50) DEFAULT 'CENTRE_ADMIN_MANUAL',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_weighment_booking UNIQUE (booking_id),
        CONSTRAINT chk_weighment_positive CHECK (gross_weight_kg >= 0 AND tare_weight_kg >= 0 AND net_weight_kg >= 0),
        CONSTRAINT chk_weighment_gross_gte_tare CHECK (gross_weight_kg >= tare_weight_kg)
      );

      CREATE TABLE IF NOT EXISTS procurement_acceptances (
        acceptance_id VARCHAR(50) PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        acceptance_status VARCHAR(30) NOT NULL DEFAULT 'ACCEPTED',
        accepted_quantity_quintals NUMERIC(10, 2) NOT NULL,
        rejected_quantity_quintals NUMERIC(10, 2) DEFAULT 0,
        reason TEXT,
        procurement_reference VARCHAR(100) NOT NULL,
        accepted_by VARCHAR(100) NOT NULL,
        accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_acceptance_booking UNIQUE (booking_id)
      );

      CREATE TABLE IF NOT EXISTS procurement_receipts (
        receipt_id VARCHAR(50) PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        receipt_number VARCHAR(100) UNIQUE NOT NULL,
        farmer_id VARCHAR(50) NOT NULL,
        centre_id VARCHAR(50) NOT NULL,
        crop VARCHAR(100) NOT NULL,
        accepted_quantity_quintals NUMERIC(10, 2) NOT NULL,
        net_weight_kg NUMERIC(10, 2) NOT NULL,
        grade VARCHAR(50),
        procurement_date DATE NOT NULL,
        recorded_by VARCHAR(100) NOT NULL,
        receipt_status VARCHAR(30) DEFAULT 'ISSUED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_receipt_booking UNIQUE (booking_id)
      );

      CREATE TABLE IF NOT EXISTS procurement_payments (
        payment_id VARCHAR(50) PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        payable_quantity_quintals NUMERIC(10, 2) NOT NULL,
        applicable_rate_inr NUMERIC(10, 2) NOT NULL,
        rate_source VARCHAR(50) DEFAULT 'DEMO_RATE',
        gross_payable_inr NUMERIC(12, 2) NOT NULL,
        deductions_inr NUMERIC(10, 2) DEFAULT 0,
        net_payable_inr NUMERIC(12, 2) NOT NULL,
        payment_status VARCHAR(30) NOT NULL DEFAULT 'PAYMENT_PENDING',
        payment_method VARCHAR(50) DEFAULT 'DBT_SIMULATED',
        transaction_reference VARCHAR(100),
        initiated_at TIMESTAMP,
        completed_at TIMESTAMP,
        failure_reason TEXT,
        is_demo_payment BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_payment_booking UNIQUE (booking_id)
      );

      CREATE TABLE IF NOT EXISTS procurement_audit_logs (
        audit_id SERIAL PRIMARY KEY,
        booking_id VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        previous_value JSONB,
        new_value JSONB,
        reason TEXT,
        performed_by VARCHAR(100) NOT NULL,
        performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_proc_quality_booking ON procurement_quality(booking_id);
      CREATE INDEX IF NOT EXISTS idx_proc_weigh_booking ON procurement_weighments(booking_id);
      CREATE INDEX IF NOT EXISTS idx_proc_acc_booking ON procurement_acceptances(booking_id);
      CREATE INDEX IF NOT EXISTS idx_proc_rcpt_booking ON procurement_receipts(booking_id);
      CREATE INDEX IF NOT EXISTS idx_proc_pay_booking ON procurement_payments(booking_id);
      CREATE INDEX IF NOT EXISTS idx_proc_audit_booking ON procurement_audit_logs(booking_id);

      -- Farmer In-App Notifications table
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id BIGSERIAL PRIMARY KEY,
        farmer_id VARCHAR(50) NOT NULL,
        notification_type VARCHAR(80) NOT NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        priority VARCHAR(30) NOT NULL DEFAULT 'INFO',
        action_required BOOLEAN NOT NULL DEFAULT FALSE,
        action_url TEXT,
        related_booking_id VARCHAR(50),
        related_grievance_id VARCHAR(50),
        related_centre_id VARCHAR(50),
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_farmer_read ON notifications(farmer_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_farmer_created ON notifications(farmer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_farmer_action ON notifications(farmer_id, action_required) WHERE is_read = FALSE;

      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_read BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_read_at TIMESTAMP NULL;
      CREATE INDEX IF NOT EXISTS idx_notifications_centre_admin ON notifications(related_centre_id, admin_read);

      -- District Officer: Procurement Centre Status Audit History
      CREATE TABLE IF NOT EXISTS centre_status_history (
        id SERIAL PRIMARY KEY,
        centre_id VARCHAR(50) NOT NULL REFERENCES centres(centre_id),
        previous_status VARCHAR(50),
        new_status VARCHAR(50) NOT NULL,
        changed_by VARCHAR(100) NOT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reason TEXT NOT NULL,
        notes TEXT,
        opening_date DATE
      );
      CREATE INDEX IF NOT EXISTS idx_centre_status_history_centre ON centre_status_history(centre_id, changed_at DESC);

      -- Super Admin Portal tables
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
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_expired BOOLEAN DEFAULT FALSE;
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'AVAILABLE';
      CREATE INDEX IF NOT EXISTS idx_slots_expiry_lookup ON slots(date, end_time, is_expired);

      -- Super Admin Demonstration Isolation
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS demo_session_id VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_bookings_demo ON bookings(is_demo, demo_session_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key ON bookings(idempotency_key) WHERE idempotency_key IS NOT NULL;

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

    `);

    // Ensure default Super Admin account exists
    const saCheck = await pool.query("SELECT user_id FROM users WHERE role = 'SUPER_ADMIN' OR username = 'superadmin'");
    if (saCheck.rows.length === 0) {
      const defaultPassword = process.env.INITIAL_DEMO_PASSWORD || 'kisan@123';
      const passHash = hashPassword(defaultPassword);
      await pool.query(`
        INSERT INTO users (user_id, username, password_hash, role, full_name, district, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, ['USR_SUPER_ADMIN_01', 'superadmin', passHash, 'SUPER_ADMIN', 'Chief Administrator (State Nodal HQ)', 'State HQ (Chennai)', true]);
      console.log('✓ Default Super Admin account verified: username: superadmin');
    }

    console.log('Database schema verified & updated for RBAC, operational counters, procurement records, notifications, and Super Admin portal.');
    await initPredictivePlanningDb(pool);

    // Initial run of Slot Expiry Engine (Asia/Kolkata)
    try {
      const initExp = await expirePastSlots(pool);
      if (initExp.expiredCount > 0) {
        console.log(`[SlotExpiryEngine] Initialized: ${initExp.expiredCount} past slots marked expired for ${initExp.todayStr}.`);
      }
    } catch (eExp) {
      console.warn('[SlotExpiryEngine] Initial slot expiry warning:', eExp.message);
    }
  } catch (err) {
    console.error('Database schema update warning:', err.message);
  }
}
initDb();

// Periodic Slot Expiry Engine (every 5 minutes in Asia/Kolkata)
const SLOT_EXPIRY_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  expirePastSlots(pool).catch(err => console.error('[SlotExpiryEngine] Periodic run error:', err.message));
}, SLOT_EXPIRY_INTERVAL_MS);

// =====================================================
// PRODUCTION OBSERVABILITY & HEALTH CHECKS
// =====================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'kisan-vikas-backend',
    version: '2.5.0',
    timestamp: new Date().toISOString(),
    timezone: 'Asia/Kolkata',
    uptime_seconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    node_version: process.version
  });
});

app.get('/api/health/readiness', async (req, res) => {
  try {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - dbStart;

    res.json({
      ready: true,
      database: {
        status: 'CONNECTED',
        latency_ms: dbLatencyMs,
        pool_total_count: pool.totalCount,
        pool_idle_count: pool.idleCount,
        pool_waiting_count: pool.waitingCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      ready: false,
      database: {
        status: 'DISCONNECTED',
        error: err.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// =====================================================
// AUTHENTICATION & ROLE-BASED ACCESS
// =====================================================

// POST /api/auth/farmer-login — Dedicated authenticated login for farmers using Phone or Farmer ID
app.post('/api/auth/farmer-login', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier || !String(identifier).trim()) {
      return res.status(400).json({
        error: 'missing_identifier',
        message: 'Farmer ID or registered mobile number is required.'
      });
    }

    const raw = String(identifier).trim();
    let farmer = null;

    // 1. Direct Farmer ID lookup (e.g., F932193, F0001, etc.)
    const isFarmerIdPattern = /^F\d+$/i.test(raw);
    if (isFarmerIdPattern) {
      const fRes = await pool.query('SELECT * FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [raw]);
      if (fRes.rows.length === 1) {
        farmer = fRes.rows[0];
      }
    }

    // 2. Phone number normalization (+91, spaces, dashes, leading 0)
    if (!farmer) {
      const digits = raw.replace(/\D/g, '');
      const normalizedPhone = (digits.length >= 10) ? digits.slice(-10) : digits;

      if (normalizedPhone.length === 10) {
        const pRes = await pool.query(
          "SELECT * FROM farmers WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 OR phone = $1",
          [normalizedPhone]
        );

        if (pRes.rows.length === 1) {
          farmer = pRes.rows[0];
        } else if (pRes.rows.length > 1) {
          return res.status(409).json({
            error: 'ambiguous_mobile_number',
            ambiguous: true,
            message: 'Multiple farmer accounts are registered under this mobile number. Please log in using your unique Farmer ID (e.g. F932193) to continue.',
            accountsCount: pRes.rows.length
          });
        }
      }

      // 3. Fallback: try raw match on farmer_id if not already tested
      if (!farmer && !isFarmerIdPattern) {
        const fFallback = await pool.query('SELECT * FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [raw]);
        if (fFallback.rows.length === 1) {
          farmer = fFallback.rows[0];
        }
      }
    }

    if (!farmer) {
      return res.status(404).json({
        error: 'farmer_not_found',
        message: 'No registered farmer found with this mobile number or Farmer ID. Please verify your details or register as a new farmer.'
      });
    }

    // Issue cryptographic JWT session token
    const tokenPayload = {
      userId: 'USR_' + farmer.farmer_id.trim(),
      username: farmer.farmer_id.trim(),
      role: 'FARMER',
      farmerId: farmer.farmer_id.trim(),
      district: farmer.district,
      fullName: farmer.name ? farmer.name.trim() : farmer.farmer_id.trim()
    };
    const token = generateToken(tokenPayload);

    return res.json({
      success: true,
      token,
      farmer,
      user: tokenPayload,
      message: `Welcome back, ${farmer.name || farmer.farmer_id.trim()}!`
    });
  } catch (err) {
    console.error('Farmer login error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to authenticate farmer.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_credentials', message: 'Username and password are required.' });
    }

    const r = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR farmer_id = $1',
      [username.trim()]
    );

    if (r.rows.length === 0) {
      // Check if farmer exists in farmers table (normalize phone if applicable)
      const rawUser = username.trim();
      const digits = rawUser.replace(/\D/g, '');
      const normalizedPhone = (digits.length >= 10) ? digits.slice(-10) : digits;

      let fCheck = await pool.query('SELECT * FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [rawUser]);
      if (fCheck.rows.length === 0 && normalizedPhone.length === 10) {
        fCheck = await pool.query("SELECT * FROM farmers WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 OR phone = $1", [normalizedPhone]);
      }

      if (fCheck.rows.length === 1) {
        const farmer = fCheck.rows[0];
        const tokenPayload = {
          userId: 'USR_' + farmer.farmer_id.trim(),
          username: farmer.farmer_id.trim(),
          role: 'FARMER',
          farmerId: farmer.farmer_id.trim(),
          district: farmer.district,
          fullName: farmer.name || farmer.farmer_id.trim()
        };
        const token = generateToken(tokenPayload);
        return res.json({
          success: true,
          token,
          user: tokenPayload
        });
      } else if (fCheck.rows.length > 1) {
        return res.status(409).json({
          error: 'ambiguous_mobile_number',
          ambiguous: true,
          message: 'Multiple accounts are associated with this mobile number. Please log in using your Farmer ID.'
        });
      }
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    }

    const user = r.rows[0];

    // Inactive/deactivated user check
    if (user.is_active === false) {
      return res.status(403).json({
        error: 'account_deactivated',
        message: 'This account has been deactivated. Please contact your administrator.'
      });
    }

    const match = verifyPassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    }

    const tokenPayload = {
      userId: user.user_id,
      username: user.username,
      role: user.role,
      centreId: user.centre_id,
      district: user.district,
      farmerId: user.farmer_id,
      fullName: user.full_name
    };

    const token = generateToken(tokenPayload);

    res.json({
      success: true,
      token,
      user: tokenPayload
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'server_error', message: 'Login failed.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// =====================================================
// FARMER NOTIFICATION CENTER APIS
// =====================================================

function getAuthenticatedFarmerId(req) {
  if (!req.user) return null;
  if (req.user.farmerId) return req.user.farmerId;
  if (req.user.farmer_id) return req.user.farmer_id;
  if (req.user.role === 'FARMER' && req.user.username) return req.user.username;
  return null;
}

// 1. GET /api/notifications — Returns authenticated farmer's notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const farmerId = getAuthenticatedFarmerId(req);
    if (!farmerId) {
      return res.status(403).json({
        error: 'farmer_required',
        message: 'Notification center is only accessible to authenticated farmer accounts.'
      });
    }

    const unreadOnly = req.query.unread === 'true' || req.query.unread_only === 'true';
    const actionRequiredOnly = req.query.action_required_only === 'true' || req.query.action_required === 'true';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const [notifications, unreadCount] = await Promise.all([
      getFarmerNotifications(pool, farmerId, { unreadOnly, actionRequiredOnly, limit }),
      getUnreadCount(pool, farmerId)
    ]);

    res.json({
      success: true,
      notifications,
      unread_count: unreadCount,
      farmer_id: farmerId
    });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch notifications.' });
  }
});

// 2. GET /api/notifications/unread-count — Returns unread count
app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
  try {
    const farmerId = getAuthenticatedFarmerId(req);
    if (!farmerId) {
      return res.status(403).json({
        error: 'farmer_required',
        message: 'Notification center is only accessible to authenticated farmer accounts.'
      });
    }

    const count = await getUnreadCount(pool, farmerId);
    res.json({
      success: true,
      unread_count: count
    });
  } catch (err) {
    console.error('Fetch unread count error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch unread count.' });
  }
});

// 3. PATCH /api/notifications/:id/read — Marks one notification as read
app.patch('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const farmerId = getAuthenticatedFarmerId(req);
    if (!farmerId) {
      return res.status(403).json({
        error: 'farmer_required',
        message: 'Notification center is only accessible to authenticated farmer accounts.'
      });
    }

    const notificationId = req.params.id;
    const result = await markNotificationAsRead(pool, notificationId, farmerId);

    if (!result.found) {
      return res.status(404).json({
        error: 'notification_not_found',
        message: 'Notification not found.'
      });
    }

    if (!result.allowed) {
      return res.status(403).json({
        error: 'forbidden_notification_access',
        message: 'Forbidden: You cannot access or modify notifications belonging to another farmer.'
      });
    }

    const newUnreadCount = await getUnreadCount(pool, farmerId);

    res.json({
      success: true,
      message: 'Notification marked as read.',
      notification_id: notificationId,
      unread_count: newUnreadCount
    });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to mark notification as read.' });
  }
});

// 4. PATCH /api/notifications/read-all — Marks all notifications for current farmer as read
app.patch('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    const farmerId = getAuthenticatedFarmerId(req);
    if (!farmerId) {
      return res.status(403).json({
        error: 'farmer_required',
        message: 'Notification center is only accessible to authenticated farmer accounts.'
      });
    }

    const updatedCount = await markAllNotificationsAsRead(pool, farmerId);

    res.json({
      success: true,
      message: 'All notifications marked as read.',
      updated_count: updatedCount,
      unread_count: 0
    });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to mark all notifications as read.' });
  }
});

// =====================================================
// DISTRICTS LISTING
// =====================================================
app.get('/api/districts', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT district, COUNT(*) as centre_count 
      FROM centres 
      WHERE district IS NOT NULL AND TRIM(district) != ''
      GROUP BY district 
      ORDER BY district ASC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('Districts fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch districts.' });
  }
});

// =====================================================
// DATA-DRIVEN LOCATIONS: DISTRICTS & VILLAGES (Issues 8 & 9)
// =====================================================
app.get('/api/locations/districts', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT district, COUNT(*) as centre_count,
             COUNT(DISTINCT village_town) as village_count
      FROM centres 
      WHERE district IS NOT NULL AND TRIM(district) != ''
      GROUP BY district 
      ORDER BY district ASC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('Locations districts fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch districts.' });
  }
});

app.get('/api/locations/districts/:district/villages', async (req, res) => {
  try {
    const { district } = req.params;
    if (!district || !district.trim()) {
      return res.status(400).json({ error: 'missing_district', message: 'District parameter is required.' });
    }
    const cleanDist = district.trim();
    const r = await pool.query(`
      SELECT DISTINCT village
      FROM (
        SELECT village_town AS village
        FROM centres
        WHERE LOWER(TRIM(district)) = LOWER(TRIM($1))
          AND village_town IS NOT NULL AND TRIM(village_town) != ''
        UNION
        SELECT locality_name AS village
        FROM localities
        WHERE LOWER(TRIM(district)) = LOWER(TRIM($1))
          AND locality_name IS NOT NULL AND TRIM(locality_name) != ''
      ) sub
      ORDER BY village ASC
    `, [cleanDist]);
    const villageList = r.rows.map(row => row.village);
    res.json({
      district: cleanDist,
      villages: villageList
    });
  } catch (err) {
    console.error('Locations villages fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch villages.' });
  }
});

// GET /api/locations/districts/:district/blocks
app.get('/api/locations/districts/:district/blocks', async (req, res) => {
  try {
    const { district } = req.params;
    if (!district || !district.trim()) {
      return res.status(400).json({ error: 'missing_district', message: 'District parameter is required.' });
    }
    const cleanDist = district.trim();
    const r = await pool.query(`
      SELECT DISTINCT block
      FROM (
        SELECT taluk_name AS block
        FROM taluks
        WHERE LOWER(TRIM(district)) = LOWER(TRIM($1))
          AND taluk_name IS NOT NULL AND TRIM(taluk_name) != ''
        UNION
        SELECT taluk_name AS block
        FROM localities
        WHERE LOWER(TRIM(district)) = LOWER(TRIM($1))
          AND taluk_name IS NOT NULL AND TRIM(taluk_name) != ''
      ) sub
      ORDER BY block ASC
    `, [cleanDist]);

    const blockList = r.rows.map(row => row.block);
    res.json({
      district: cleanDist,
      blocks: blockList
    });
  } catch (err) {
    console.error('Locations blocks fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch blocks.' });
  }
});

// GET /api/locations/blocks/:block/panchayats
app.get('/api/locations/blocks/:block/panchayats', async (req, res) => {
  try {
    const { block } = req.params;
    const { district } = req.query;
    if (!block || !block.trim()) {
      return res.status(400).json({ error: 'missing_block', message: 'Block parameter is required.' });
    }
    const cleanBlock = block.trim();
    const cleanDist = district ? district.trim() : null;

    let query = `
      SELECT DISTINCT locality_name AS panchayat
      FROM localities
      WHERE LOWER(TRIM(taluk_name)) = LOWER(TRIM($1))
        AND locality_name IS NOT NULL AND TRIM(locality_name) != ''
    `;
    const params = [cleanBlock];
    if (cleanDist) {
      query += ` AND LOWER(TRIM(district)) = LOWER(TRIM($2))`;
      params.push(cleanDist);
    }
    query += ` ORDER BY panchayat ASC`;

    let r = await pool.query(query, params);

    // If no direct taluk_name match in localities, fallback to localities in district
    if (r.rows.length === 0 && cleanDist) {
      const fallback = await pool.query(`
        SELECT DISTINCT locality_name AS panchayat
        FROM localities
        WHERE LOWER(TRIM(district)) = LOWER(TRIM($1))
          AND locality_name IS NOT NULL AND TRIM(locality_name) != ''
        ORDER BY panchayat ASC
        LIMIT 50
      `, [cleanDist]);
      r = fallback;
    }

    const panchayatList = r.rows.map(row => row.panchayat);
    res.json({
      block: cleanBlock,
      district: cleanDist,
      panchayats: panchayatList
    });
  } catch (err) {
    console.error('Locations panchayats fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch panchayats.' });
  }
});

// =====================================================
// SMART PROCUREMENT CENTRE RECOMMENDATION
// Enforces:
// 1. Verified registered district containment
// 2. Operational centres only (excluding Closed and Retired)
// 3. Real road distance calculation via defaultDistanceService
// 4. Slot availability check on requested delivery date
// 5. Explanatory recommendation badge, road distance label & reason
// =====================================================
app.get('/api/centres/recommend', optionalAuthenticate, async (req, res) => {
  try {
    const { district, date, farmer_id, crop, quantity_quintals } = req.query;
    const authFarmerId = (req.user && req.user.role === 'FARMER' && req.user.farmerId)
      ? req.user.farmerId
      : (farmer_id ? farmer_id.trim() : null);

    const recommendationService = new CentreRecommendationService({ pool });
    const result = await recommendationService.getRecommendations({
      district,
      date,
      farmerId: authFarmerId,
      crop,
      quantityQuintals: quantity_quintals ? Number(quantity_quintals) : 10
    });

    res.json(result);
  } catch (err) {
    if (err.code === 'INVALID_DISTRICT_CENTRE') {
      return res.status(400).json({
        error: 'mismatched_district',
        code: 'INVALID_DISTRICT_CENTRE',
        message: err.message
      });
    }
    if (err.code === 'MISSING_DISTRICT') {
      return res.status(400).json({
        error: 'missing_district',
        message: err.message
      });
    }
    if (err.code === 'NO_OPERATIONAL_CENTRES') {
      return res.status(404).json({
        error: 'no_operational_centres',
        message: err.message
      });
    }
    console.error('Centre recommendation error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to calculate centre recommendations.' });
  }
});

// =====================================================
// CENTRES LISTING WITH DISTRICT FILTER & SCOPING
// =====================================================
app.get('/api/centres', optionalAuthenticate, async (req, res) => {
  try {
    const { district, search } = req.query;

    // 1. Strict Centre Admin isolation: returns only assigned centre
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      const r = await pool.query("SELECT * FROM centres WHERE centre_id = $1 AND operational_status != 'Retired'", [req.user.centreId]);
      return res.json(r.rows);
    }

    // 2. Strict District Officer isolation
    let targetDistrict = null;
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      if (district && district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: As a District Officer for ${req.user.district}, you cannot access centres in ${district}.`
        });
      }
      targetDistrict = req.user.district.trim();
    } else if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      // 3. Strict CSC Operator isolation
      if (district && district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: As a CSC Operator in ${req.user.district}, you can only access centres in your assigned district.`
        });
      }
      targetDistrict = req.user.district.trim();
    } else if (district && district.trim()) {
      // 4. Public / Farmer query with requested district
      targetDistrict = district.trim();
    }

    let query = "SELECT * FROM centres WHERE operational_status != 'Retired'";
    const params = [];

    if (targetDistrict) {
      params.push(targetDistrict);
      query += ` AND LOWER(TRIM(district)) = LOWER(TRIM($${params.length}))`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND (centre_name ILIKE $${params.length} OR village_town ILIKE $${params.length} OR centre_id ILIKE $${params.length})`;
    }

    query += ' ORDER BY centre_name ASC';

    // If no district selected, limit to avoid payload explosion
    if (!targetDistrict) {
      query += ' LIMIT 100';
    }

    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (err) {
    console.error('Centres fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch centres.' });
  }
});

// =====================================================
// PHASE 7.2: CANONICAL FAIRNESS ENGINE INTEGRATION
// =====================================================
const {
  FAIRNESS_CONFIG,
  calculateBatchFarmerFairness: canonicalBatchFairness,
  calculateFarmerFairness: canonicalFarmerFairness
} = require('./services/fairness/fairnessEngine');

async function calculateBatchFarmerFairness(farmerIds) {
  return canonicalBatchFairness(farmerIds, pool);
}

async function calculateFarmerFairness(farmerId) {
  return canonicalFarmerFairness(farmerId, pool);
}

// =====================================================
// CENTRE ADMIN: MY ASSIGNED CENTRE
// =====================================================
app.get('/api/admin/my-centre', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const centreId = req.user.centreId;
    if (!centreId) {
      return res.status(400).json({ error: 'no_assigned_centre', message: 'No centre assigned to this admin account.' });
    }

    const centreRes = await pool.query('SELECT * FROM centres WHERE centre_id = $1', [centreId]);
    if (centreRes.rows.length === 0) {
      return res.status(404).json({ error: 'centre_not_found', message: 'Assigned centre not found.' });
    }

    const centre = centreRes.rows[0];

    // Current active queue: exclude expired, cancelled, completed, and un-arrived past appointments
    // Grounded in Asia/Kolkata timezone and isolated from demonstration sessions
    const queueRes = await pool.query(
      `SELECT b.*, f.name, f.phone, f.village,
              s.start_time, s.end_time,
              CONCAT(s.start_time, ' - ', s.end_time) AS slot_time,
              TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date_str
       FROM bookings b 
       JOIN farmers f ON b.farmer_id = f.farmer_id 
       LEFT JOIN slots s ON b.slot_id = s.slot_id
       WHERE b.centre_id = $1 
         AND (b.is_demo = FALSE OR b.is_demo IS NULL)
         AND b.status NOT IN ('Payment Completed', 'No-Show', 'Expired', 'Cancelled')
         AND (
           b.status IN ('Checked-In', 'Grading', 'Weighing')
           OR b.booking_date > (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
           OR (b.booking_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AND (s.end_time IS NULL OR s.end_time > (TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS'))::time))
         )
       ORDER BY b.booking_date ASC, s.start_time ASC, b.queue_position_at_booking ASC, b.created_at ASC`,
      [centreId]
    );

    const activeCounters = Math.max(1, centre.active_counters || 2);
    const totalBooked = queueRes.rows.length;

    const pacing = await calculateCentrePacing(centre.centre_id);
    const liveMetrics = await defaultCongestionService.getCentreLiveMetrics(pool, centreId);

    // Procurement statistics for centre (authoritative from committed records, strictly distinguishing declared vs procured)
    const procStatsRes = await pool.query(`
      SELECT
        COALESCE(
          SUM(pa.accepted_quantity_quintals) FILTER (WHERE pa.accepted_at::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE),
          SUM(b.procured_quantity_quintals) FILTER (WHERE b.booking_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AND b.status IN ('Procured', 'Payment Pending', 'Payment Completed')),
          0
        )::numeric AS procured_today_quintals,
        COALESCE(
          SUM(pa.accepted_quantity_quintals),
          SUM(b.procured_quantity_quintals) FILTER (WHERE b.status IN ('Procured', 'Payment Pending', 'Payment Completed')),
          0
        )::numeric AS cumulative_procured_quintals,
        COALESCE(SUM(b.quantity_quintals) FILTER (WHERE b.booking_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE), 0)::numeric AS requested_quantity_today_quintals,
        COUNT(b.booking_id) FILTER (WHERE b.status IN ('Procured', 'Payment Pending', 'Payment Completed') AND b.procured_quantity_quintals IS NULL)::int AS legacy_missing_procurement_count,
        COUNT(DISTINCT pa.acceptance_id)::int AS completed_procurement_count
      FROM bookings b
      LEFT JOIN procurement_acceptances pa ON b.booking_id = pa.booking_id AND (pa.is_demo = FALSE OR pa.is_demo IS NULL)
      WHERE b.centre_id = $1 AND (b.is_demo = FALSE OR b.is_demo IS NULL)
    `, [centreId]);
    const procStats = procStatsRes.rows[0] || {};
    const procuredTodayQ = Number(procStats.procured_today_quintals || 0);
    const cumulativeProcuredQ = Number(procStats.cumulative_procured_quintals || 0);
    const requestedTodayQ = Number(procStats.requested_quantity_today_quintals || 0);
    const legacyMissingCount = Number(procStats.legacy_missing_procurement_count || 0);
    const completedProcurementCount = Number(procStats.completed_procurement_count || 0);

    const physicalQueue = liveMetrics ? liveMetrics.physical_queue_length : 0;
    const estWait = liveMetrics ? liveMetrics.estimated_wait_minutes : 0;
    const theoreticalThroughput = liveMetrics ? liveMetrics.theoretical_throughput_per_hr : Math.round(activeCounters * (60 / (centre.processing_rate_min || 12)));
    const actualThroughputToday = liveMetrics ? liveMetrics.actual_throughput_today : 0;
    const capacityUtilization = liveMetrics ? liveMetrics.capacity_utilization_percent : Math.round((physicalQueue / (centre.daily_capacity_slots || 40)) * 100);

    // Phase 7.2 Batch Fairness Evaluation
    const farmerIds = [...new Set(queueRes.rows.map(r => r.farmer_id))];
    const fairnessMap = await calculateBatchFarmerFairness(farmerIds);

    let highProtectionCount = 0;
    let moderateProtectionCount = 0;
    let lowProtectionCount = 0;

    const annotatedQueue = queueRes.rows.map(b => {
      const fInfo = fairnessMap[b.farmer_id] || {
        fairness_score: 0,
        protection_level: 'LOW',
        status: 'STANDARD',
        message: 'Standard fairness queue tracking active.'
      };

      if (fInfo.protection_level === 'HIGH') highProtectionCount++;
      else if (fInfo.protection_level === 'MODERATE') moderateProtectionCount++;
      else lowProtectionCount++;

      return {
        ...b,
        fairness_score: fInfo.fairness_score,
        protection_level: fInfo.protection_level,
        fairness_status: fInfo.status,
        fairness_message: fInfo.message
      };
    });

    // Phase 7.2 Fairness Sorting integration (Highest First with queue position tie-breaker)
    const requestedSort = req.query.sort || 'default';
    if (requestedSort === 'fairness_desc') {
      const protRank = { 'HIGH': 3, 'MODERATE': 2, 'LOW': 1 };
      annotatedQueue.sort((a, b) => {
        const pDiff = (protRank[b.protection_level] || 1) - (protRank[a.protection_level] || 1);
        if (pDiff !== 0) return pDiff;
        const sDiff = (b.fairness_score || 0) - (a.fairness_score || 0);
        if (sDiff !== 0) return sDiff;
        const qDiff = (a.queue_position_at_booking || 0) - (b.queue_position_at_booking || 0);
        if (qDiff !== 0) return qDiff;
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      });
    } else if (requestedSort === 'score_desc') {
      annotatedQueue.sort((a, b) => {
        const sDiff = (b.fairness_score || 0) - (a.fairness_score || 0);
        if (sDiff !== 0) return sDiff;
        const qDiff = (a.queue_position_at_booking || 0) - (b.queue_position_at_booking || 0);
        if (qDiff !== 0) return qDiff;
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      });
    }

    const fairnessSummary = {
      high_protection_count: highProtectionCount,
      moderate_protection_count: moderateProtectionCount,
      low_protection_count: lowProtectionCount,
      total_evaluated_farmers: farmerIds.length,
      _notice: 'Fairness scores are heuristic decision-support metrics and do not represent socioeconomic classification.'
    };

    res.json({
      success: true,
      centre,
      stats: {
        farmers_in_queue: physicalQueue,
        active_queue_today: physicalQueue,
        physical_queue_length: physicalQueue,
        upcoming_reservations_today: liveMetrics ? liveMetrics.upcoming_reservations_today : 0,
        total_pending_all_dates: totalBooked,
        estimated_wait_minutes: estWait,
        theoretical_throughput_per_hr: theoreticalThroughput,
        actual_throughput_today: actualThroughputToday,
        hourly_throughput: theoreticalThroughput,
        congestion_level: liveMetrics ? liveMetrics.congestion_level : 'LOW',
        utilization_percent: capacityUtilization,
        daily_capacity: centre.daily_capacity_slots,
        active_counters: activeCounters,
        staff_availability: centre.staff_availability || 5,
        processing_rate_min: centre.processing_rate_min || 12,
        procured_today_quintals: procuredTodayQ,
        procured_today_mt: Number((procuredTodayQ / 10).toFixed(2)),
        cumulative_procured_quintals: cumulativeProcuredQ,
        cumulative_procured_mt: Number((cumulativeProcuredQ / 10).toFixed(2)),
        requested_quantity_today_quintals: requestedTodayQ,
        legacy_missing_procurement_count: legacyMissingCount,
        completed_procurement_count: completedProcurementCount,
        storage_capacity_mt: Number(centre.storage_capacity_mt || 250),
        current_stock_mt: Number(centre.current_stock_mt || 0),
        _notice: 'Authoritative live metrics computed by CongestionService grounded in PostgreSQL'
      },
      live_metrics: liveMetrics,
      pacing,
      fairness_summary: fairnessSummary,
      queue: annotatedQueue
    });
  } catch (err) {
    console.error('My centre error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load assigned centre data.' });
  }
});

// =====================================================
// CENTRE ADMIN NOTIFICATIONS (STRICTLY CENTRE SCOPED)
// =====================================================
app.get('/api/admin/my-centre/notifications', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const centreId = req.user.centreId;
    if (!centreId) {
      return res.status(400).json({ error: 'no_assigned_centre', message: 'No centre assigned to this admin account.' });
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const result = await pool.query(`
      SELECT n.*, n.admin_read AS is_read
      FROM notifications n
      WHERE n.related_centre_id = $1
         OR n.related_booking_id IN (SELECT booking_id FROM bookings WHERE centre_id = $1)
         OR n.related_grievance_id IN (SELECT grievance_id FROM grievances WHERE centre_id = $1)
      ORDER BY n.created_at DESC
      LIMIT $2
    `, [centreId, limit]);

    const unreadRes = await pool.query(`
      SELECT COUNT(*) AS count
      FROM notifications n
      WHERE (n.related_centre_id = $1
         OR n.related_booking_id IN (SELECT booking_id FROM bookings WHERE centre_id = $1)
         OR n.related_grievance_id IN (SELECT grievance_id FROM grievances WHERE centre_id = $1))
        AND n.admin_read = FALSE
    `, [centreId]);

    const notifications = result.rows.map(r => ({
      ...r,
      id: r.notification_id,
      type: r.notification_type,
      link: r.action_url
    }));

    res.json({
      success: true,
      notifications,
      unread_count: parseInt(unreadRes.rows[0].count, 10),
      centre_id: centreId
    });
  } catch (err) {
    console.error('Fetch centre notifications error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to fetch centre notifications.' });
  }
});

app.get('/api/admin/my-centre/notifications/unread-count', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const centreId = req.user.centreId;
    if (!centreId) return res.status(400).json({ error: 'no_assigned_centre' });

    const unreadRes = await pool.query(`
      SELECT COUNT(*) AS count
      FROM notifications n
      WHERE (n.related_centre_id = $1
         OR n.related_booking_id IN (SELECT booking_id FROM bookings WHERE centre_id = $1)
         OR n.related_grievance_id IN (SELECT grievance_id FROM grievances WHERE centre_id = $1))
        AND n.admin_read = FALSE
    `, [centreId]);

    res.json({
      success: true,
      unread_count: parseInt(unreadRes.rows[0].count, 10),
      centre_id: centreId
    });
  } catch (err) {
    console.error('Centre unread count error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.patch('/api/admin/my-centre/notifications/:id/read', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const centreId = req.user.centreId;
    const notifId = req.params.id;
    const result = await pool.query(`
      UPDATE notifications
      SET admin_read = TRUE, admin_read_at = NOW()
      WHERE notification_id = $1
        AND (related_centre_id = $2
          OR related_booking_id IN (SELECT booking_id FROM bookings WHERE centre_id = $2)
          OR related_grievance_id IN (SELECT grievance_id FROM grievances WHERE centre_id = $2))
      RETURNING notification_id
    `, [notifId, centreId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'notification_not_found',
        message: 'Notification not found or does not belong to your centre.'
      });
    }

    res.json({ success: true, notification_id: notifId });
  } catch (err) {
    console.error('Mark centre notification read error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.patch('/api/admin/my-centre/notifications/read-all', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const centreId = req.user.centreId;
    await pool.query(`
      UPDATE notifications
      SET admin_read = TRUE, admin_read_at = NOW()
      WHERE (related_centre_id = $1
          OR related_booking_id IN (SELECT booking_id FROM bookings WHERE centre_id = $1)
          OR related_grievance_id IN (SELECT grievance_id FROM grievances WHERE centre_id = $1))
        AND admin_read = FALSE
    `, [centreId]);

    res.json({ success: true });
  } catch (err) {
    console.error('Mark all centre notifications read error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// =====================================================
// MISSED APPOINTMENTS MANAGEMENT (CENTRE ADMIN)
// =====================================================
app.get('/api/admin/missed-appointments', authenticateToken, requireRole('CENTRE_ADMIN', 'SUPER_ADMIN', 'DISTRICT_OFFICER'), async (req, res) => {
  try {
    const centreId = req.user.role === 'CENTRE_ADMIN' ? req.user.centreId : (req.query.centre_id || req.user.centreId);
    if (!centreId && req.user.role === 'CENTRE_ADMIN') {
      return res.status(400).json({ error: 'no_assigned_centre', message: 'No centre assigned to this admin account.' });
    }

    const { date, status, search } = req.query;
    const { todayStr, currentTimeStr } = getKolkataNow();

    let query = `
      SELECT b.booking_id, b.farmer_id, b.centre_id, b.slot_id, b.booking_date, b.status,
             b.quantity_quintals, b.crop, b.token, b.queue_position_at_booking, b.reschedule_count,
             b.created_at,
             f.name AS farmer_name, f.phone, f.village,
             c.centre_name, c.district,
             s.start_time, s.end_time,
             CONCAT(s.start_time, ' - ', s.end_time) AS slot_time,
             TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date_str
      FROM bookings b
      JOIN farmers f ON b.farmer_id = f.farmer_id
      JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE (
        b.status IN ('No-Show', 'Expired')
        OR (
          b.status IN ('Booked', 'Confirmed', 'On The Way')
          AND (b.booking_date < $1 OR (b.booking_date = $1 AND (s.end_time IS NULL OR s.end_time <= $2)))
        )
      )
    `;
    const params = [todayStr, currentTimeStr];

    if (centreId) {
      params.push(centreId);
      query += ` AND b.centre_id = $${params.length}`;
    }

    if (date) {
      params.push(normalizeDateStr(date));
      query += ` AND b.booking_date = $${params.length}`;
    }

    if (status && status !== 'ALL') {
      if (status === 'No-Show') {
        query += ` AND b.status = 'No-Show'`;
      } else if (status === 'Elapsed' || status === 'Expired') {
        query += ` AND (b.status = 'Expired' OR (b.status IN ('Booked', 'Confirmed', 'On The Way') AND (b.booking_date < $1 OR (b.booking_date = $1 AND (s.end_time IS NULL OR s.end_time <= $2)))))`;
      }
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(f.name) LIKE $${params.length} OR f.phone LIKE $${params.length} OR LOWER(b.token) LIKE $${params.length} OR LOWER(b.booking_id) LIKE $${params.length})`;
    }

    query += ` ORDER BY b.booking_date DESC, s.start_time DESC, b.created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);

    const records = result.rows.map(r => {
      const isExplicitNoShow = r.status === 'No-Show';
      const missedClassification = isExplicitNoShow ? 'No-Show' : 'Elapsed (Unarrived)';
      const recordedReason = isExplicitNoShow
        ? 'Marked No-Show after grace period elapsed'
        : 'Scheduled window elapsed without physical gate check-in';

      return {
        ...r,
        missed_status: missedClassification,
        recorded_reason: recordedReason,
        arrival_status: 'NOT_ARRIVED',
        eligible_for_restore: true
      };
    });

    res.json({
      success: true,
      total_count: records.length,
      missed_appointments: records
    });
  } catch (err) {
    console.error('Missed appointments error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load missed appointments.' });
  }
});

app.post('/api/admin/missed-appointments/:id/restore-slot', authenticateToken, requireRole('CENTRE_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { target_date, target_slot_id, reason } = req.body;
  const bookingId = req.params.id;

  if (!target_date || !target_slot_id) {
    return res.status(400).json({ error: 'missing_fields', message: 'target_date and target_slot_id are required to restore slot.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bRes = await client.query('SELECT * FROM bookings WHERE booking_id = $1 FOR UPDATE', [bookingId]);
    if (bRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }
    const booking = bRes.rows[0];

    if (req.user.role === 'CENTRE_ADMIN') {
      const adminCentre = req.user.centreId || req.user.centre_id;
      if (adminCentre && booking.centre_id !== adminCentre) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'centre_access_denied', message: 'Forbidden: Booking does not belong to your centre.' });
      }
    }

    const { todayStr } = getKolkataNow();
    const cleanTargetDate = normalizeDateStr(target_date);
    if (!cleanTargetDate || cleanTargetDate < todayStr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'past_target_date', message: `Target date ${cleanTargetDate} cannot be in the past.` });
    }

    await ensureCentreSlots(client, booking.centre_id, cleanTargetDate, 1);

    const slotRes = await client.query('SELECT * FROM slots WHERE slot_id = $1 FOR UPDATE', [target_slot_id]);
    if (slotRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'slot_not_found', message: 'Selected target slot does not exist.' });
    }
    const targetSlot = slotRes.rows[0];

    if (targetSlot.centre_id !== booking.centre_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'centre_mismatch', message: 'Target slot belongs to a different centre.' });
    }

    const exp = isSlotExpired(targetSlot.date, targetSlot.end_time);
    if (exp.expired || targetSlot.is_expired || targetSlot.status === 'EXPIRED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'slot_expired', message: 'Selected target slot has expired.' });
    }

    if (targetSlot.booked_count >= targetSlot.max_farmers) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'slot_full', message: 'Selected target slot is at full capacity.' });
    }

    if (booking.slot_id) {
      await client.query(
        'UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE slot_id = $1 AND is_expired = FALSE',
        [booking.slot_id]
      );
    }

    await client.query(
      'UPDATE slots SET booked_count = booked_count + 1 WHERE slot_id = $1',
      [target_slot_id]
    );

    const adminUser = req.user.username || 'CENTRE_ADMIN';
    const restoreReason = reason || 'Admin restored capacity for missed farmer visit';

    await client.query(`
      UPDATE bookings
      SET slot_id = $1,
          booking_date = $2,
          status = 'Confirmed',
          reschedule_count = COALESCE(reschedule_count, 0) + 1
      WHERE booking_id = $3
    `, [target_slot_id, cleanTargetDate, bookingId]);

    await client.query(`
      INSERT INTO status_history (booking_id, centre_id, status)
      VALUES ($1, $2, 'Confirmed')
    `, [bookingId, booking.centre_id]);

    await client.query(`
      INSERT INTO reschedule_events
        (booking_id, old_slot_id, new_slot_id, old_centre_id, new_centre_id, reason, recommended_by, accepted_by, action, is_system_disruption)
      VALUES ($1, $2, $3, $4, $4, $5, 'CENTRE_ADMIN_MISSED_RESTORE', $6, 'RESTORED', FALSE)
    `, [
      bookingId,
      booking.slot_id,
      target_slot_id,
      booking.centre_id,
      restoreReason,
      adminUser
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      booking_id: bookingId,
      restored_slot_id: target_slot_id,
      restored_date: cleanTargetDate,
      new_status: 'Confirmed',
      message: `Farmer appointment restored to ${cleanTargetDate} (${targetSlot.start_time.slice(0, 5)} - ${targetSlot.end_time.slice(0, 5)}).`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Restore missed appointment error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to restore missed appointment.' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/missed-appointments/:id/release-capacity', authenticateToken, requireRole('CENTRE_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { reason } = req.body;
  const bookingId = req.params.id;

  try {
    const bRes = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }
    const booking = bRes.rows[0];

    if (booking.slot_id) {
      await pool.query(
        'UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE slot_id = $1 AND is_expired = FALSE',
        [booking.slot_id]
      );
    }

    if (booking.status !== 'No-Show') {
      await pool.query("UPDATE bookings SET status = 'No-Show' WHERE booking_id = $1", [bookingId]);
      await pool.query("INSERT INTO status_history (booking_id, centre_id, status) VALUES ($1, $2, 'No-Show')", [bookingId, booking.centre_id]);
    }

    res.json({
      success: true,
      booking_id: bookingId,
      status: 'No-Show',
      message: 'Capacity reviewed and confirmed released for other farmers.'
    });
  } catch (err) {
    console.error('Release capacity error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to release capacity.' });
  }
});

// =====================================================
// SLOTS FOR A CENTRE ON A DATE
// Automatically creates slots for new DPCs if needed
// =====================================================
app.get('/api/centres/:id/slots', optionalAuthenticate, async (req, res) => {
  try {
    const centreId = req.params.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        error: 'missing_date',
        error_code: 'MISSING_DATE',
        message: 'Date is required.',
        slots: []
      });
    }

    // CSC Operator district isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      const cCheck = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
      if (cCheck.rows.length === 0 || (cCheck.rows[0].district || '').trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          error_code: 'CSC_DISTRICT_ACCESS_DENIED',
          message: `Forbidden: Centre ${centreId} is outside your assigned CSC district (${req.user.district}).`,
          slots: []
        });
      }
    }

    let authenticatedFarmerId = null;
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      authenticatedFarmerId = req.user.farmerId;
    } else if (req.user && req.user.role === 'CSC_OPERATOR' && req.query.farmer_id) {
      authenticatedFarmerId = req.query.farmer_id.trim();
    } else if (req.query.farmer_id) {
      authenticatedFarmerId = req.query.farmer_id.trim();
    }

    const slotsResult = await getCentreSlotsWithAvailability(pool, centreId, date, authenticatedFarmerId);

    // If centre is closed, not found, or has 0 slots configured, send structured notice
    if (slotsResult.error_code && (!Array.isArray(slotsResult) || slotsResult.length === 0)) {
      return res.json({
        centre_id: centreId,
        operational_status: slotsResult.operational_status || 'Open',
        error_code: slotsResult.error_code,
        message: slotsResult.message || `Procurement centre ${centreId} slot notice: ${slotsResult.error_code}.`,
        slots: []
      });
    }

    return res.json(slotsResult);

  } catch (err) {
    console.error('Slots error:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load or create slots.',
      slots: []
    });
  }
});

// Farmer directory and search with district scoping
app.get('/api/farmers', optionalAuthenticate, async (req, res) => {
  try {
    const { search, district } = req.query;

    let targetDistrict = null;
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      if (district && district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: As a District Officer for ${req.user.district}, you cannot access farmers in ${district}.`
        });
      }
      targetDistrict = req.user.district.trim();
    } else if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      if (district && district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: As a CSC Operator in ${req.user.district}, you can only access farmers in your assigned district.`
        });
      }
      targetDistrict = req.user.district.trim();
    } else if (district && district.trim()) {
      targetDistrict = district.trim();
    }

    let query = 'SELECT * FROM farmers WHERE 1=1';
    const params = [];

    if (targetDistrict) {
      params.push(targetDistrict);
      query += ` AND LOWER(TRIM(district)) = LOWER(TRIM($${params.length}))`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND (farmer_id ILIKE $${params.length} OR name ILIKE $${params.length} OR phone ILIKE $${params.length} OR village ILIKE $${params.length})`;
    }

    query += ' ORDER BY name ASC LIMIT 50';
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (err) {
    console.error('Farmer search error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to search farmers.' });
  }
});

// Single farmer lookup with role isolation
app.get('/api/farmers/:id', optionalAuthenticate, async (req, res) => {
  try {
    const raw = String(req.params.id || '').trim();
    let r = await pool.query('SELECT * FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [raw]);

    if (r.rows.length === 0) {
      const digits = raw.replace(/\D/g, '');
      const normalizedPhone = (digits.length >= 10) ? digits.slice(-10) : digits;
      if (normalizedPhone.length === 10) {
        const pRes = await pool.query(
          "SELECT * FROM farmers WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1 OR phone = $1",
          [normalizedPhone]
        );
        if (pRes.rows.length === 1) {
          r = pRes;
        } else if (pRes.rows.length > 1) {
          return res.status(409).json({
            error: 'ambiguous_mobile_number',
            ambiguous: true,
            message: 'Multiple accounts are associated with this mobile number. Please specify your Farmer ID.'
          });
        }
      }
    }

    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'farmer_not_found', message: 'Farmer not found.' });
    }

    const farmer = r.rows[0];

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      if (farmer.district && farmer.district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Farmer ${req.params.id} belongs to ${farmer.district}, outside your assigned district (${req.user.district}).`
        });
      }
    }

    // CSC Operator isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      if (farmer.district && farmer.district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Farmer ${req.params.id} belongs to ${farmer.district}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (farmer.farmer_id !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only view your own farmer profile.'
        });
      }
    }

    // Issue cryptographic token for farmer session
    const tokenPayload = {
      userId: 'USR_' + farmer.farmer_id.trim(),
      username: farmer.farmer_id.trim(),
      role: 'FARMER',
      farmerId: farmer.farmer_id.trim(),
      district: farmer.district,
      fullName: farmer.name ? farmer.name.trim() : farmer.farmer_id.trim()
    };
    const token = generateToken(tokenPayload);

    res.json({
      ...farmer,
      token,
      user: tokenPayload
    });
  } catch (err) {
    console.error('Farmer lookup error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load farmer details.' });
  }
});

// Update farmer personal profile details
app.put('/api/farmers/:id', optionalAuthenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, village, district, block, panchayat } = req.body;

    const result = await pool.query(
      `UPDATE farmers SET 
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        village = COALESCE($3, village),
        district = COALESCE($4, district),
        block = COALESCE($5, block),
        panchayat = COALESCE($6, panchayat)
       WHERE farmer_id = $7 RETURNING *`,
      [name || null, phone || null, village || null, district || null, block || null, panchayat || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'farmer_not_found', message: 'Farmer not found.' });
    }

    res.json({ success: true, farmer: result.rows[0] });
  } catch (err) {
    console.error('Update farmer error:', err);
    res.status(500).json({ error: 'server_error', message: 'Failed to update farmer profile.' });
  }
});

// Active booking check for a farmer (Issue 7)
app.get('/api/farmers/:farmerId/active-booking', optionalAuthenticate, async (req, res) => {
  try {
    const { farmerId } = req.params;

    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (farmerId !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: `Forbidden: You are logged in as farmer ${req.user.farmerId} and cannot inspect bookings for ${farmerId}.`
        });
      }
    }

    const candidateRes = await pool.query(`
      SELECT b.booking_id, b.farmer_id, b.slot_id, b.centre_id, b.booking_date,
             TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date_str,
             b.status, b.crop, b.quantity_quintals, b.token, b.queue_position_at_booking,
             c.centre_name, c.district AS centre_district, c.village_town AS centre_village,
             s.start_time, s.end_time
      FROM bookings b
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.farmer_id = $1
        AND b.status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'Cancelled')
      ORDER BY b.booking_date DESC, b.created_at DESC
      LIMIT 10
    `, [farmerId]);

    let activeBooking = null;
    let mostRecentExpired = null;

    for (const b of candidateRes.rows) {
      const evaluation = isBookingGenuinelyActive(b);
      if (evaluation.active) {
        activeBooking = b;
        break;
      } else if (evaluation.expired && !mostRecentExpired) {
        if (b.status !== 'Expired' && b.status !== 'Missed Visit' && b.status !== 'No-Show') {
          pool.query("UPDATE bookings SET status = 'Expired' WHERE booking_id = $1", [b.booking_id]).catch(() => {});
        }
        mostRecentExpired = b;
      }
    }

    if (!activeBooking) {
      return res.json({
        has_active_booking: false,
        active_booking: null,
        has_expired_booking: !!mostRecentExpired,
        expired_booking: mostRecentExpired ? {
          booking_id: mostRecentExpired.booking_id,
          farmer_id: mostRecentExpired.farmer_id,
          centre_id: mostRecentExpired.centre_id,
          centre_name: mostRecentExpired.centre_name,
          booking_date: mostRecentExpired.booking_date_str,
          slot_id: mostRecentExpired.slot_id,
          slot_time: mostRecentExpired.start_time ? `${mostRecentExpired.start_time.slice(0, 5)} - ${mostRecentExpired.end_time.slice(0, 5)}` : 'Scheduled',
          status: 'Expired',
          can_book_new: true
        } : null
      });
    }

    const b = activeBooking;
    res.json({
      has_active_booking: true,
      has_expired_booking: false,
      expired_booking: null,
      active_booking: {
        booking_id: b.booking_id,
        farmer_id: b.farmer_id,
        centre_id: b.centre_id,
        centre_name: b.centre_name,
        centre_district: b.centre_district,
        centre_village: b.centre_village,
        booking_date: b.booking_date_str,
        slot_id: b.slot_id,
        slot_time: b.start_time ? `${b.start_time.slice(0, 5)} - ${b.end_time.slice(0, 5)}` : 'Scheduled',
        status: b.status,
        crop: b.crop,
        quantity_quintals: b.quantity_quintals,
        token: b.token || ('Q' + String(b.queue_position_at_booking || 1).padStart(3, '0'))
      }
    });
  } catch (err) {
    console.error('Active booking lookup error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to check active booking.' });
  }
});

// Register farmer with role isolation, district/village consistency & language validation (Issues 8, 9, 10, 11)
app.post('/api/farmers/register', optionalAuthenticate, async (req, res) => {
  try {
    const { farmer_id, name, phone, village, district, block, panchayat, land_holding_acres,
            primary_crop, preferred_language, smartphone_access } = req.body;

    if (!farmer_id || !name) {
      return res.status(400).json({ error: 'missing_fields', message: 'Farmer ID and name are required.' });
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      if (district && district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: As a District Officer for ${req.user.district}, you cannot register farmers in ${district}.`
        });
      }
    }

    // CSC Operator isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      if (district && district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: As a CSC Operator in ${req.user.district}, you can only register farmers in your assigned district.`
        });
      }
    }

    const assignedDistrict = (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district)
      ? req.user.district
      : (district ? district.trim() : null);

    // 1. Data-Driven District Validation (Issue 8 & 9)
    if (assignedDistrict) {
      const dCheck = await pool.query(
        'SELECT 1 FROM centres WHERE LOWER(TRIM(district)) = LOWER(TRIM($1)) LIMIT 1',
        [assignedDistrict]
      );
      if (dCheck.rows.length === 0) {
        return res.status(400).json({
          error: 'invalid_district',
          message: `Validation failed: District '${assignedDistrict}' is not recognized in Tamil Nadu procurement records.`
        });
      }
    }

    // 2. Data-Driven Village/Locality Validation (Rule 4: check localities master table first, then centres)
    if (assignedDistrict && village && village.trim()) {
      const locCheck = await pool.query(
        `SELECT 1 FROM localities 
         WHERE LOWER(TRIM(district)) = LOWER(TRIM($1)) 
           AND (
             LOWER(TRIM(locality_name)) = LOWER(TRIM($2))
             OR LOWER(TRIM(locality_name)) LIKE LOWER(TRIM($2)) || '%'
             OR LOWER(TRIM($2)) LIKE LOWER(TRIM(locality_name)) || '%'
           )
         LIMIT 1`,
        [assignedDistrict, village.trim()]
      );

      if (locCheck.rows.length === 0) {
        const vCheck = await pool.query(
          `SELECT 1 FROM centres 
           WHERE LOWER(TRIM(district)) = LOWER(TRIM($1)) 
             AND (
               LOWER(TRIM(village_town)) = LOWER(TRIM($2))
               OR LOWER(TRIM(village_town)) LIKE LOWER(TRIM($2)) || '%'
               OR LOWER(TRIM($2)) LIKE LOWER(TRIM(village_town)) || '%'
             )
           LIMIT 1`,
          [assignedDistrict, village.trim()]
        );
        if (vCheck.rows.length === 0 && !block && !panchayat) {
          return res.status(400).json({
            error: 'mismatched_district_village',
            message: `Validation failed: Village '${village}' does not belong to district '${assignedDistrict}' in Tamil Nadu procurement records or master localities.`
          });
        }
      }
    }

    // 3. Language Validation (Issue 10: exactly Tamil, English, Hindi)
    const validLanguages = ['Tamil', 'English', 'Hindi'];
    let langNormalized = 'Tamil';
    if (preferred_language && preferred_language.trim()) {
      const matched = validLanguages.find(l => l.toLowerCase() === preferred_language.trim().toLowerCase());
      if (!matched) {
        return res.status(400).json({
          error: 'invalid_language',
          message: 'Validation failed: Preferred language must be one of: Tamil, English, Hindi.'
        });
      }
      langNormalized = matched;
    }

    await pool.query(
      `INSERT INTO farmers (farmer_id, name, phone, village, district, block, panchayat, land_holding_acres,
       primary_crop, preferred_language, smartphone_access)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (farmer_id) DO UPDATE SET
         name=$2, phone=$3, village=$4, district=$5, block=$6, panchayat=$7,
         land_holding_acres=$8, primary_crop=$9, preferred_language=$10, smartphone_access=$11`,
      [farmer_id.trim(), name.trim(), phone ? phone.trim() : null, village ? village.trim() : null,
       assignedDistrict, block ? block.trim() : null, panchayat ? panchayat.trim() : null,
       land_holding_acres ? parseFloat(land_holding_acres) : null,
       primary_crop || 'Paddy (Common)', langNormalized, smartphone_access || 'Yes']
    );

    // Issue cryptographic JWT token for newly registered farmer session
    const tokenPayload = {
      userId: 'USR_' + farmer_id.trim(),
      username: farmer_id.trim(),
      role: 'FARMER',
      farmerId: farmer_id.trim(),
      district: assignedDistrict,
      fullName: name.trim()
    };
    const token = generateToken(tokenPayload);

    res.json({
      success: true,
      farmer_id: farmer_id.trim(),
      token,
      user: tokenPayload,
      message: `Farmer ${farmer_id.trim()} registered successfully.`
    });
  } catch (err) {
    console.error('Farmer registration error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to register farmer.' });
  }
});

// CSC Assisted Bookings listing with strict authentication and district scoping
app.get('/api/csc/bookings', authenticateToken, requireRole('CSC_OPERATOR', 'DISTRICT_OFFICER'), async (req, res) => {
  try {
    const { operator_id, date, district } = req.query;
    const assignedDistrict = req.user.district;

    if (!assignedDistrict) {
      return res.status(403).json({ error: 'no_district_assigned', message: 'No district assigned to this user.' });
    }

    // Validate requested district parameter against user's assigned district
    if (district && district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      if (req.user.role === 'CSC_OPERATOR') {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: As a CSC Operator in ${assignedDistrict}, you cannot access bookings in ${district}.`
        });
      } else {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: As a District Officer for ${assignedDistrict}, you cannot access bookings in ${district}.`
        });
      }
    }

    let query = `
      SELECT b.*, 
             COALESCE(b.token, 'Q' || LPAD(COALESCE(b.queue_position_at_booking, 1)::text, 3, '0')) AS token,
             f.name AS farmer_name, f.phone, f.village, c.centre_name, c.district AS centre_district,
             s.start_time, s.end_time
      FROM bookings b
      LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.booking_source = 'CSC_ASSISTED'
        AND LOWER(TRIM(c.district)) = LOWER(TRIM($1))
    `;
    const params = [assignedDistrict.trim()];

    if (operator_id) {
      params.push(operator_id);
      query += ` AND b.operator_id = $${params.length}`;
    }
    if (date) {
      params.push(date);
      query += ` AND b.booking_date = $${params.length}`;
    }
    query += ` ORDER BY b.created_at DESC, b.booking_id DESC LIMIT 50`;
    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (err) {
    console.error('CSC bookings error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load CSC assisted bookings.' });
  }
});

// Create booking (auto queue position + concurrency row lock + CSC metadata + District-Centre validation)
app.post('/api/bookings', optionalAuthenticate, async (req, res) => {
  const { booking_id, farmer_id, slot_id, centre_id, district, booking_date, crop,
          quantity_quintals, msp_rate_inr, booking_source, operator_id } = req.body;

  const cleanFarmerId = String(farmer_id || '').trim();

  // Farmer isolation: a logged-in farmer can only book for themselves
  if (req.user && req.user.role === 'FARMER' && req.user.farmerId && req.user.farmerId !== cleanFarmerId) {
    return res.status(403).json({
      error: 'farmer_access_denied',
      message: `Forbidden: You are logged in as farmer ${req.user.farmerId} and cannot book for ${farmer_id}.`
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 0. Concurrency serialization for farmer
    if (cleanFarmerId) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['farmer_booking_' + cleanFarmerId]);
    }

    // 1. Verify farmer exists in registered records
    if (!cleanFarmerId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'missing_farmer_id', message: 'farmer_id is required.' });
    }
    const farmerCheck = await client.query('SELECT farmer_id, name, district, phone FROM farmers WHERE farmer_id = $1', [cleanFarmerId]);
    if (farmerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'farmer_not_found',
        error_code: 'FARMER_NOT_FOUND',
        message: `Validation failed: Farmer ID '${farmer_id}' not found in registered records.`
      });
    }
    const farmerRecord = farmerCheck.rows[0];

    // 2. Strict Past-Date Rejection (Asia/Kolkata timezone)
    const { todayStr } = getKolkataNow();
    const cleanBookingDate = normalizeDateStr(booking_date);
    if (!cleanBookingDate) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'missing_booking_date',
        message: 'Validation failed: booking_date is required.'
      });
    }
    if (cleanBookingDate < todayStr) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'past_date',
        code: 'PAST_DATE',
        message: `Validation failed: Cannot book procurement slots for past date (${cleanBookingDate}). Today is ${todayStr}.`
      });
    }

    // 2b. Idempotency check: return existing booking if same idempotency key provided
    let resolvedIdempotencyKey = (
      req.body.idempotency_key ||
      req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      ''
    ).trim() || null;

    if (resolvedIdempotencyKey) {
      const idemRes = await client.query(
        `SELECT b.booking_id, b.centre_id, b.slot_id, b.booking_date, b.status,
                b.queue_position_at_booking, b.estimated_wait_minutes, b.token,
                b.booking_source, b.operator_id, c.centre_name, s.start_time, s.end_time
         FROM bookings b
         LEFT JOIN centres c ON b.centre_id = c.centre_id
         LEFT JOIN slots s ON b.slot_id = s.slot_id
         WHERE b.idempotency_key = $1
         LIMIT 1`,
        [resolvedIdempotencyKey]
      );
      if (idemRes.rows.length > 0) {
        const existing = idemRes.rows[0];
        const evalExisting = isBookingGenuinelyActive(existing);
        if (evalExisting.active) {
          await client.query('ROLLBACK');
          return res.status(200).json({
            success: true,
            idempotent_replay: true,
            booking_id: existing.booking_id,
            queue_position: existing.queue_position_at_booking,
            estimated_wait_minutes: existing.estimated_wait_minutes,
            token: existing.token,
            booking_source: existing.booking_source,
            operator_id: existing.operator_id,
            centre_name: existing.centre_name,
            booking_date: existing.booking_date ? normalizeDateStr(existing.booking_date) : null
          });
        }
        // If the matched booking is terminal (Payment Completed, Cancelled, Expired, Missed Visit),
        // it cannot be replayed as an active booking. Re-key to prevent unique index constraint violation.
        resolvedIdempotencyKey = `${resolvedIdempotencyKey}_${Date.now()}`;
      }
    }

    // 3. Single Active Booking Rule check with canonical isBookingGenuinelyActive
    const candidateBookings = await client.query(`
      SELECT b.booking_id, b.centre_id, b.slot_id, b.booking_date, b.status,
             c.centre_name, s.start_time, s.end_time
      FROM bookings b
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.farmer_id = $1
        AND b.status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'Cancelled')
      ORDER BY b.booking_date DESC, b.created_at DESC
      LIMIT 10
    `, [cleanFarmerId]);

    let active = null;
    for (const b of candidateBookings.rows) {
      const evaluation = isBookingGenuinelyActive(b);
      if (evaluation.active) {
        active = b;
        break;
      } else if (evaluation.expired) {
        if (b.status !== 'Expired' && b.status !== 'Missed Visit' && b.status !== 'No-Show') {
          await client.query("UPDATE bookings SET status = 'Expired' WHERE booking_id = $1", [b.booking_id]);
        }
      }
    }

    if (active) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'farmer_has_active_booking',
        code: 'farmer_has_active_booking',
        message: 'You already have an active procurement booking. Only one active booking is permitted per farmer.',
        active_booking: {
          booking_id: active.booking_id,
          centre_id: active.centre_id,
          centre_name: active.centre_name,
          booking_date: active.booking_date ? normalizeDateStr(active.booking_date) : null,
          slot_id: active.slot_id,
          slot_time: active.start_time ? `${active.start_time.slice(0, 5)} - ${active.end_time.slice(0, 5)}` : null,
          status: active.status
        }
      });
    }

    // 3. Verify centre exists and retrieve district + active counters + operational status
    const centreCheck = await client.query(
      'SELECT centre_id, district, daily_capacity_slots, operational_status, COALESCE(active_counters, 2) AS active_counters FROM centres WHERE centre_id=$1',
      [centre_id]
    );

    if (centreCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'centre_not_found',
        message: 'Selected procurement centre not found.'
      });
    }

    const centreData = centreCheck.rows[0];

    // Closed or Retired centres cannot accept new bookings
    if (centreData.operational_status === 'Closed' || centreData.operational_status === 'Retired') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'centre_closed',
        code: 'CENTRE_CLOSED',
        message: `Validation failed: Procurement centre ${centre_id} is currently ${centreData.operational_status} and cannot accept bookings.`
      });
    }

    // 4. Strict Farmer Registered District -> Centre District Validation (Rule 5)
    if (farmerRecord.district && centreData.district) {
      if (farmerRecord.district.trim().toLowerCase() !== centreData.district.trim().toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'mismatched_district_centre',
          code: 'INVALID_DISTRICT_CENTRE',
          message: `Validation failed: Farmer is registered in '${farmerRecord.district}', but centre '${centre_id}' is located in '${centreData.district}'. Cross-district procurement bookings are strictly prohibited.`
        });
      }
    }

    // CSC Operator district validation
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      if (centreData.district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: As a CSC Operator in ${req.user.district}, you can only book centres in your assigned district.`
        });
      }

      if (farmerRecord.district && farmerRecord.district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Farmer ${farmer_id} is registered in ${farmerRecord.district}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    // 5. Strict District query/body parameter relationship enforcement
    if (district && district.trim().toLowerCase() !== centreData.district.trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'mismatched_district_centre',
        code: 'INVALID_DISTRICT_CENTRE',
        message: `Validation failed: Centre ${centre_id} belongs to district ${centreData.district}, not ${district}.`
      });
    }

    // 6. Concurrency protection: Lock slot row for update
    const slotCheck = await client.query(
      'SELECT * FROM slots WHERE slot_id=$1 FOR UPDATE',
      [slot_id]
    );

    if (slotCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'slot_not_found',
        message: 'Selected slot does not exist.'
      });
    }

    const slot = slotCheck.rows[0];

    // 7. Strict Centre -> Slot relationship enforcement
    if (slot.centre_id !== centre_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'mismatched_centre_slot',
        message: `Validation failed: Slot ${slot_id} belongs to centre ${slot.centre_id}, not ${centre_id}.`
      });
    }

    // 8. Strict Slot Date -> Requested Date enforcement
    const slotDateStr = normalizeDateStr(slot.date);
    if (slotDateStr !== cleanBookingDate) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'mismatched_date_slot',
        message: `Validation failed: Slot date (${slotDateStr}) does not match requested booking date (${cleanBookingDate}).`
      });
    }

    // 9. Expired Slot Validation (Asia/Kolkata timezone)
    const slotExp = isSlotExpired(slot.date, slot.end_time);
    if (slotExp.expired || slot.is_expired || slot.status === 'EXPIRED') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'slot_expired',
        code: 'SLOT_EXPIRED',
        reason: slotExp.reason || 'This slot has concluded.',
        message: 'Validation failed: This slot has already expired. Please select an upcoming slot.'
      });
    }

    if (slot.booked_count >= slot.max_farmers) {
      const { todayStr, currentTimeStr } = getKolkataNow();
      // find next available slot at same centre, same day, later time
      const alt = await client.query(
        `SELECT * FROM slots WHERE centre_id=$1 AND date=$2 AND booked_count < max_farmers
         AND is_expired = FALSE AND (status IS NULL OR status = 'AVAILABLE')
         AND start_time > $3 AND (date > $4 OR (date = $4 AND end_time > $5))
         ORDER BY start_time LIMIT 1`,
        [centre_id, booking_date, slot.start_time, todayStr, currentTimeStr]
      );
      if (alt.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'slot_full',
          message: 'This slot is full. Nearest available slot suggested.',
          suggested_slot: alt.rows[0]
        });
      }
      // no slots left today at this centre — suggest a nearby centre same day
      const altCentre = await client.query(
        `SELECT s.* FROM slots s WHERE s.date=$1 AND s.centre_id != $2
         AND s.booked_count < s.max_farmers
         AND s.is_expired = FALSE AND (s.status IS NULL OR s.status = 'AVAILABLE')
         AND (s.date > $3 OR (s.date = $3 AND s.end_time > $4))
         ORDER BY s.start_time LIMIT 1`,
        [booking_date, centre_id, todayStr, currentTimeStr]
      );
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'centre_full',
        message: 'No slots left today at this centre. Nearby centre suggested.',
        suggested_slot: altCentre.rows[0] || null
      });
    }

    // Deterministic centre daily queue position & token (Issue 2)
    const posRes = await client.query(`
      SELECT COALESCE(MAX(queue_position_at_booking), 0) AS max_pos
      FROM bookings
      WHERE centre_id = $1 AND booking_date = $2
    `, [centre_id, booking_date]);
    const queuePos = parseInt(posRes.rows[0].max_pos) + 1;

    // Moving-average processing time
    const avgRes = await client.query(`
      SELECT booking_id,
        MAX(CASE WHEN status='Checked-In' THEN changed_at END) AS checkin_time,
        MAX(CASE WHEN status='Procured' THEN changed_at END) AS procured_time
      FROM status_history WHERE centre_id=$1
      GROUP BY booking_id
      HAVING MAX(CASE WHEN status='Procured' THEN changed_at END) IS NOT NULL
      ORDER BY procured_time DESC LIMIT 10
    `, [centre_id]);

    let avgMinutes;
    if (avgRes.rows.length > 0) {
      const durations = avgRes.rows.map(row => (new Date(row.procured_time) - new Date(row.checkin_time)) / 60000);
      avgMinutes = durations.reduce((a, b) => a + b, 0) / durations.length;
    } else {
      avgMinutes = 480 / (centreData.daily_capacity_slots || 40); // cold-start fallback
    }

    // Corrected Predictive Waiting Time formula (Item 7):
    // estimatedWait = (farmersAhead * avgMinutes) / activeCounters (protected against 0)
    const activeCounters = Math.max(1, Number(centreData.active_counters || 2));
    const estWait = Math.max(1, Math.round((queuePos * avgMinutes) / activeCounters));

    const resolvedSource = booking_source || (req.user?.role === 'CSC_OPERATOR' ? 'CSC_ASSISTED' : 'SELF_SERVICE');
    const resolvedOperator = operator_id || (req.user?.role === 'CSC_OPERATOR' ? req.user.username : null);
    const token = req.body.token || ('Q' + String(queuePos).padStart(3, '0'));
    const finalBookingId = booking_id || ('B' + Math.floor(100000 + Math.random() * 900000));

    // Atomic slot capacity guard: increment booked_count only if strictly under max_farmers
    const slotUpdateRes = await client.query(
      'UPDATE slots SET booked_count = booked_count + 1 WHERE slot_id = $1 AND booked_count < max_farmers RETURNING *',
      [slot_id]
    );
    if (slotUpdateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'slot_full',
        code: 'SLOT_FULL',
        message: 'This slot reached maximum capacity just now. Please select an alternate slot.'
      });
    }

    await client.query(
      `INSERT INTO bookings (booking_id, farmer_id, slot_id, centre_id, booking_date,
       crop, quantity_quintals, status, msp_rate_inr, payment_status,
       queue_position_at_booking, estimated_wait_minutes, sms_notifications_sent,
       booking_source, operator_id, token, idempotency_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Confirmed',$8,'Not Applicable',$9,$10,1,$11,$12,$13,$14,NOW())`,
      [finalBookingId, farmer_id, slot_id, centre_id, cleanBookingDate, crop,
       quantity_quintals, msp_rate_inr, queuePos, estWait,
       resolvedSource, resolvedOperator, token, resolvedIdempotencyKey]
    );

    await client.query('COMMIT');

    // Trigger In-App Notification: BOOKING_CONFIRMED
    createFarmerNotification(pool, {
      farmerId: farmer_id,
      type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed',
      message: `Your procurement slot at ${centreData.centre_name || centre_id} is confirmed for ${booking_date}. Queue position: ${queuePos} (${token}).`,
      priority: PRIORITIES.INFO,
      actionRequired: false,
      actionUrl: `/farmer/pass/${finalBookingId}`,
      bookingId: finalBookingId,
      centreId: centre_id
    });

    res.json({
      success: true,
      booking_id: finalBookingId,
      queue_position: queuePos,
      estimated_wait_minutes: estWait,
      token,
      booking_source: resolvedSource,
      operator_id: resolvedOperator,
      active_counters: activeCounters
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Booking error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to complete booking.' });
  } finally {
    client.release();
  }
});


// Farmer's bookings/status (with strict authentication & RBAC scoping)
app.get('/api/bookings/:farmerId', authenticateToken, async (req, res) => {
  const { farmerId } = req.params;

  // Farmer isolation: only own farmer ID
  if (req.user.role === 'FARMER') {
    const userFarmerId = req.user.farmerId || req.user.farmer_id;
    if (farmerId !== userFarmerId) {
      return res.status(403).json({
        error: 'farmer_access_denied',
        message: `Forbidden: You are logged in as farmer ${userFarmerId} and cannot view bookings for ${farmerId}.`
      });
    }
  }

  // CSC Operator isolation: only permitted district
  if (req.user.role === 'CSC_OPERATOR') {
    const f = await pool.query('SELECT district FROM farmers WHERE farmer_id = $1', [farmerId]);
    if (f.rows.length === 0) {
      return res.status(404).json({ error: 'farmer_not_found', message: 'Farmer not found.' });
    }
    if (f.rows[0].district && req.user.district && f.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'csc_district_access_denied',
        message: `Forbidden: Farmer ${farmerId} belongs to ${f.rows[0].district}, outside your assigned CSC district (${req.user.district}).`
      });
    }
  }

  // District Officer isolation: only permitted district
  if (req.user.role === 'DISTRICT_OFFICER') {
    const f = await pool.query('SELECT district FROM farmers WHERE farmer_id = $1', [farmerId]);
    if (f.rows.length === 0) {
      return res.status(404).json({ error: 'farmer_not_found', message: 'Farmer not found.' });
    }
    if (f.rows[0].district && req.user.district && f.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: Farmer ${farmerId} belongs to ${f.rows[0].district}, outside your assigned district (${req.user.district}).`
      });
    }
  }

  // Centre Admin isolation: only bookings under assigned centre
  if (req.user.role === 'CENTRE_ADMIN') {
    const adminCentre = req.user.centreId || req.user.centre_id;
    if (adminCentre) {
      const r = await pool.query('SELECT * FROM bookings WHERE farmer_id=$1 AND centre_id=$2 ORDER BY booking_date DESC', [farmerId, adminCentre]);
      return res.json(r.rows);
    }
  }

  const r = await pool.query('SELECT * FROM bookings WHERE farmer_id=$1 ORDER BY booking_date DESC', [farmerId]);
  res.json(r.rows);
});

// Admin: live queue for a centre (with Centre Admin, District Officer, and CSC Operator isolation)
app.get('/api/centres/:id/queue', optionalAuthenticate, async (req, res) => {
  // Centre Admin isolation check
  if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
    if (req.params.id !== req.user.centreId) {
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: You are authorized to manage only your assigned centre (${req.user.centreId}).`
      });
    }
  }

  // District Officer isolation check
  if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
    const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [req.params.id]);
    if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: Centre ${req.params.id} does not belong to your assigned district (${req.user.district}).`
      });
    }
  }

  // CSC Operator isolation check
  if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
    const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [req.params.id]);
    if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'csc_district_access_denied',
        message: `Forbidden: Centre ${req.params.id} does not belong to your assigned CSC district (${req.user.district}).`
      });
    }
  }

  const r = await pool.query(
    `SELECT b.*, f.name, f.phone, f.village,
            s.start_time, s.end_time,
            CONCAT(s.start_time, ' - ', s.end_time) AS slot_time,
            TO_CHAR(b.booking_date, 'YYYY-MM-DD') AS booking_date_str
     FROM bookings b
     JOIN farmers f ON b.farmer_id = f.farmer_id
     LEFT JOIN slots s ON b.slot_id = s.slot_id
     WHERE b.centre_id = $1
       AND (b.is_demo = FALSE OR b.is_demo IS NULL)
       AND b.status NOT IN ('Payment Completed', 'No-Show', 'Expired', 'Cancelled', 'Missed Visit', 'Rescheduled')
       AND (
         b.status IN ('Checked-In', 'Grading', 'Weighing')
         OR b.booking_date > (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
         OR (b.booking_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AND (s.end_time IS NULL OR s.end_time > (TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS'))::time))
       )
     ORDER BY b.booking_date ASC, s.start_time ASC, b.queue_position_at_booking ASC, b.created_at ASC`,
    [req.params.id]
  );
  res.json(r.rows);
});

// Advance booking status (also fakes a notification with Centre Admin isolation)
const STATUS_FLOW = [
  'Booked',
  'Confirmed',
  'On The Way',
  'Checked-In',
  'Grading',
  'Weighing',
  'Procured',
  'Payment Pending',
  'Payment Completed'
];

app.patch('/api/bookings/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;

  if (!status || !STATUS_FLOW.includes(status)) {
    return res.status(400).json({
      error: 'invalid_status',
      message: `Invalid booking status. Allowed statuses are: ${STATUS_FLOW.join(', ')}`
    });
  }

  // Role authorization: CENTRE_ADMIN or DISTRICT_OFFICER
  if (req.user.role === 'FARMER' || req.user.role === 'CSC_OPERATOR') {
    return res.status(403).json({
      error: 'forbidden_role',
      message: 'Forbidden: You are not authorized to advance booking status.'
    });
  }
  if (req.user.role !== 'CENTRE_ADMIN' && req.user.role !== 'DISTRICT_OFFICER') {
    return res.status(403).json({
      error: 'forbidden_role',
      message: `Forbidden: Role ${req.user.role} is not authorized to advance booking status.`
    });
  }

  const bookingRes = await pool.query(
    'SELECT b.centre_id, b.status, c.district FROM bookings b JOIN centres c ON b.centre_id = c.centre_id WHERE b.booking_id=$1',
    [req.params.id]
  );

  if (bookingRes.rows.length === 0) {
    return res.status(404).json({
      error: 'booking_not_found',
      message: 'Booking not found.'
    });
  }

  const { centre_id: centreId, district: centreDistrict, status: currentStatus } = bookingRes.rows[0];

  // Rule 19: Validate allowed status transitions
  const transitionCheck = validateStatusTransition(currentStatus || 'Booked', status);
  if (!transitionCheck.valid) {
    return res.status(400).json({
      error: 'invalid_status_transition',
      code: 'INVALID_STATUS_TRANSITION',
      message: transitionCheck.error,
      current_status: currentStatus,
      target_status: status,
      allowed_transitions: transitionCheck.allowed || []
    });
  }

  // Centre Admin isolation check: must match assigned centre
  if (req.user.role === 'CENTRE_ADMIN') {
    const adminCentre = req.user.centreId || req.user.centre_id;
    if (adminCentre && centreId !== adminCentre) {
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: Booking ${req.params.id} belongs to centre ${centreId}, but you are assigned to ${adminCentre}.`
      });
    }
  }

  // District Officer isolation check: must match assigned district
  if (req.user.role === 'DISTRICT_OFFICER') {
    if (!centreDistrict || centreDistrict.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: Booking ${req.params.id} is at centre in ${centreDistrict || 'another district'}, outside your assigned district (${req.user.district}).`
      });
    }
  }

  // Phase 1A: Strictly reject physical check-in if the appointment slot has expired
  if (status === 'Checked-In') {
    const { todayStr, currentTimeStr } = getKolkataNow();
    const slotCheckRes = await pool.query(
      `SELECT b.booking_date, s.end_time, s.is_expired
       FROM bookings b
       LEFT JOIN slots s ON b.slot_id = s.slot_id
       WHERE b.booking_id = $1`,
      [req.params.id]
    );
    if (slotCheckRes.rows.length > 0) {
      const bSlot = slotCheckRes.rows[0];
      const bDateStr = bSlot.booking_date ? normalizeDateStr(bSlot.booking_date) : '';
      const isPast = bDateStr < todayStr || (bDateStr === todayStr && bSlot.end_time && bSlot.end_time <= currentTimeStr);
      if (isPast || bSlot.is_expired) {
        return res.status(400).json({
          error: 'slot_expired',
          code: 'SLOT_EXPIRED',
          message: 'The appointment slot has expired. Physical check-in cannot be accepted for past or expired slots. Please reschedule via Missed Visits.'
        });
      }
    }
  }

  let updateSql = `
    UPDATE bookings
    SET status = $1,
        sms_notifications_sent = sms_notifications_sent + 1
  `;
  const updateParams = [status, req.params.id];

  if (status === 'Procured' || status === 'Payment Pending' || status === 'Payment Completed') {
    let procQty = null;
    if (req.body.procured_quantity_quintals != null && !isNaN(Number(req.body.procured_quantity_quintals))) {
      procQty = Number(req.body.procured_quantity_quintals);
    } else if (req.body.net_weight_kg != null && !isNaN(Number(req.body.net_weight_kg))) {
      procQty = Number(req.body.net_weight_kg) / 100;
    } else if (req.body.quantity_quintals != null && !isNaN(Number(req.body.quantity_quintals))) {
      procQty = Number(req.body.quantity_quintals);
    } else {
      // Check if weighment record exists
      const wRes = await pool.query('SELECT net_weight_kg FROM procurement_weighments WHERE booking_id = $1 ORDER BY recorded_at DESC LIMIT 1', [req.params.id]);
      if (wRes.rows.length > 0 && Number(wRes.rows[0].net_weight_kg) > 0) {
        procQty = Number(wRes.rows[0].net_weight_kg) / 100;
      } else {
        const bkRes = await pool.query('SELECT quantity_quintals, msp_rate_inr FROM bookings WHERE booking_id = $1', [req.params.id]);
        procQty = bkRes.rows.length > 0 ? Number(bkRes.rows[0].quantity_quintals || 0) : 0;
      }
    }

    const mspRate = Number(req.body.msp_rate_inr || 2320);
    const paymentAmount = Math.round(procQty * mspRate);

    updateSql += `,
      procured_quantity_quintals = COALESCE(procured_quantity_quintals, $3),
      msp_rate_inr = COALESCE(msp_rate_inr, $4),
      payment_amount_inr = COALESCE(payment_amount_inr, $5)
    `;
    updateParams.push(procQty, mspRate, paymentAmount);
  }

  updateSql += ` WHERE booking_id = $2 RETURNING *`;
  const updatedBookingRes = await pool.query(updateSql, updateParams);
  const updatedBooking = updatedBookingRes.rows[0];

  await pool.query(
    `INSERT INTO status_history
     (booking_id, centre_id, status)
     VALUES ($1,$2,$3)`,
    [req.params.id, centreId, status]
  );

  res.json({
    success: true,
    booking_id: req.params.id,
    new_status: status,
    procured_quantity_quintals: updatedBooking ? updatedBooking.procured_quantity_quintals : null
  });
});


// Mark a booking as No-Show (with Centre Admin & DO isolation and 60-min grace period)
app.post('/api/bookings/:id/no-show', optionalAuthenticate, async (req, res) => {
  try {
    // Role authorization: FARMER and CSC_OPERATOR cannot mark no-shows
    if (req.user && (req.user.role === 'FARMER' || req.user.role === 'CSC_OPERATOR')) {
      return res.status(403).json({
        error: 'forbidden_role',
        message: 'Forbidden: You are not authorized to mark bookings as no-show.'
      });
    }

    const b = await pool.query(
      'SELECT * FROM bookings WHERE booking_id=$1',
      [req.params.id]
    );

    if (b.rows.length === 0) {
      return res.status(404).json({
        error: 'booking_not_found',
        message: 'Booking not found.'
      });
    }

    const booking = b.rows[0];

    // Centre Admin isolation check: must match assigned centre
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (booking.centre_id !== req.user.centreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: Booking ${booking.booking_id} belongs to centre ${booking.centre_id}, but you are assigned to ${req.user.centreId}.`
        });
      }
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const cCheck = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [booking.centre_id]);
      if (cCheck.rows.length === 0 || cCheck.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Centre ${booking.centre_id} belongs to ${cCheck.rows[0]?.district || 'another district'}, not your assigned district (${req.user.district}).`
        });
      }
    }

    // Prevent marking completed or already cancelled/noshow bookings
    if (['Procured', 'Payment Pending', 'Payment Completed', 'Cancelled', 'No-Show'].includes(booking.status)) {
      return res.status(400).json({
        error: 'invalid_status',
        code: 'INVALID_STATUS',
        message: `Booking in status '${booking.status}' cannot be marked as No-Show.`
      });
    }

    // Grace period enforcement (60 minutes past slot end time in Asia/Kolkata)
    const { todayStr, currentTimeStr } = getKolkataNow();
    const sRes = await pool.query('SELECT date, end_time FROM slots WHERE slot_id = $1', [booking.slot_id]);
    if (sRes.rows.length > 0) {
      const slotDate = normalizeDateStr(sRes.rows[0].date);
      const slotEndTime = sRes.rows[0].end_time; // HH:MM:SS
      if (slotDate > todayStr) {
        return res.status(400).json({
          error: 'grace_period_active',
          code: 'GRACE_PERIOD_ACTIVE',
          message: `Cannot mark farmer as No-Show for a future appointment date (${slotDate}).`
        });
      } else if (slotDate === todayStr && slotEndTime) {
        const [endH, endM] = slotEndTime.split(':').map(Number);
        const [currH, currM] = currentTimeStr.split(':').map(Number);
        const slotEndMinutes = endH * 60 + endM;
        const currentMinutes = currH * 60 + currM;
        const graceEndMinutes = slotEndMinutes + 60; // 60-minute grace period
        if (currentMinutes < graceEndMinutes) {
          const graceEndH = String(Math.floor(graceEndMinutes / 60)).padStart(2, '0');
          const graceEndM = String(graceEndMinutes % 60).padStart(2, '0');
          return res.status(400).json({
            error: 'grace_period_active',
            code: 'GRACE_PERIOD_ACTIVE',
            message: `Cannot mark farmer as No-Show. The 60-minute grace period after slot end time (${slotEndTime.slice(0, 5)}) is active until ${graceEndH}:${graceEndM}.`
          });
        }
      }
    }

    // Mark booking as No-Show
    await pool.query(
      `UPDATE bookings
       SET status='No-Show'
       WHERE booking_id=$1`,
      [req.params.id]
    );

    // Free the slot count only if slot is not expired
    await pool.query(
      `UPDATE slots
       SET booked_count = GREATEST(booked_count - 1, 0)
       WHERE slot_id=$1 AND is_expired = FALSE`,
      [booking.slot_id]
    );

    // Record status change
    await pool.query(
      `INSERT INTO status_history
       (booking_id, centre_id, status)
       VALUES ($1,$2,'No-Show')`,
      [booking.booking_id, booking.centre_id]
    );

    res.json({
      success: true,
      booking_id: booking.booking_id,
      new_status: 'No-Show',
      message: `Slot freed up for ${booking.slot_id}.`
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to mark booking as No-Show.'
    });
  }
});

// =====================================================
// PHASE B: "I'M ON MY WAY" (TRANSIT NOTIFICATION)
// =====================================================
app.post('/api/bookings/:id/on-my-way', optionalAuthenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const bookingRes = await pool.query(
      'SELECT * FROM bookings WHERE booking_id = $1',
      [bookingId]
    );

    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }

    const booking = bookingRes.rows[0];

    // Farmer isolation check: logged-in farmer can only trigger for themselves
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (booking.farmer_id !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only update transit status for your own booking.'
        });
      }
    }

    // Only allow transition from Booked or Confirmed
    if (booking.status !== 'Booked' && booking.status !== 'Confirmed') {
      return res.status(400).json({
        error: 'invalid_status_transition',
        message: `Cannot transition from current status '${booking.status}' to 'On The Way'.`
      });
    }

    await pool.query(
      `UPDATE bookings SET status = 'On The Way', sms_notifications_sent = sms_notifications_sent + 1 WHERE booking_id = $1`,
      [bookingId]
    );

    await pool.query(
      `INSERT INTO status_history (booking_id, centre_id, status) VALUES ($1, $2, 'On The Way')`,
      [bookingId, booking.centre_id]
    );

    res.json({
      success: true,
      booking_id: bookingId,
      status: 'On The Way',
      message: 'Status updated to On The Way. The procurement centre has been notified of your transit.'
    });
  } catch (err) {
    console.error('On-my-way error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to update status to On The Way.' });
  }
});

// =====================================================
// PHASE B: DIGITAL PROCUREMENT PASS
// =====================================================
app.get('/api/bookings/pass/:id', optionalAuthenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const r = await pool.query(`
      SELECT 
        b.*,
        f.name AS farmer_name, f.phone AS farmer_phone, f.village AS farmer_village, f.district AS farmer_district,
        c.centre_name, c.district AS centre_district, c.village_town AS centre_village,
        COALESCE(c.active_counters, 2) AS active_counters, c.daily_capacity_slots,
        s.date AS slot_date, s.start_time, s.end_time
      FROM bookings b
      JOIN farmers f ON b.farmer_id = f.farmer_id
      JOIN centres c ON b.centre_id = c.centre_id
      JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.booking_id = $1
    `, [bookingId]);

    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Digital pass not found.' });
    }

    const pass = r.rows[0];

    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (pass.farmer_id !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only view your own digital pass.'
        });
      }
    }

    // Centre Admin isolation check
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (pass.centre_id !== req.user.centreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: Booking ${bookingId} belongs to centre ${pass.centre_id}, but you are assigned to ${req.user.centreId}.`
        });
      }
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const cDist = pass.centre_district;
      if (cDist && cDist.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Booking ${bookingId} belongs to ${cDist}, outside your assigned district (${req.user.district}).`
        });
      }
    }

    // CSC Operator isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      const cDist = pass.centre_district || pass.farmer_district;
      if (cDist && cDist.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Digital pass for booking ${bookingId} belongs to ${cDist}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    // Status history
    const historyRes = await pool.query(
      'SELECT * FROM status_history WHERE booking_id = $1 ORDER BY changed_at ASC',
      [bookingId]
    );

    // Live queue ahead count from authoritative CongestionService
    const liveMetrics = await defaultCongestionService.getCentreLiveMetrics(pool, pass.centre_id, bookingId);
    const farmersAhead = liveMetrics ? liveMetrics.farmers_ahead : 0;

    // Cryptographic verification hash for QR code
    const crypto = require('crypto');
    const bDate = normalizeDateStr(pass.booking_date);
    const qrPayload = JSON.stringify({
      booking_id: pass.booking_id,
      farmer_id: pass.farmer_id,
      token: pass.token || ('Q' + String(pass.queue_position_at_booking).padStart(3, '0')),
      centre_id: pass.centre_id,
      date: bDate,
      crop: pass.crop
    });
    const verificationHash = crypto.createHmac('sha256', process.env.JWT_SECRET || 'kisan_queue_jwt_secret_key_2026')
      .update(qrPayload)
      .digest('hex')
      .slice(0, 16);

    // Phase 7.1 Consistency: Authoritative Centre Pacing & Date Safety
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isHistoricalOrCompleted = (bDate < todayStr) ||
      ['Procured', 'Payment Pending', 'Payment Completed', 'No-Show', 'Cancelled'].includes(pass.status);

    let pacingState = null;
    if (!isHistoricalOrCompleted) {
      if (bDate === todayStr) {
        pacingState = await calculateCentrePacing(pass.centre_id);
      } else {
        // Upcoming date: check if centre is PAUSED or has active condition on that date
        const currentLive = await calculateCentrePacing(pass.centre_id);
        if (currentLive && currentLive.pacing_status === 'PAUSED') {
          pacingState = currentLive;
        } else {
          pacingState = await calculateCentrePacing(pass.centre_id, bDate);
        }
      }
    }

    // Authoritative rule: if centre is NORMAL or booking is historical, no active delay advisory
    const isCentreElevated = !isHistoricalOrCompleted && pacingState && pacingState.pacing_status !== 'NORMAL';

    const pacingStatus = isCentreElevated ? pacingState.pacing_status : 'NORMAL';
    const recommendedDelay = isCentreElevated ? (pacingState.recommended_delay_minutes || 0) : 0;
    const recommendedAction = isCentreElevated ? pacingState.recommended_action : 'CONTINUE';
    const reason = isHistoricalOrCompleted
      ? 'Past booking — no active advisory'
      : (isCentreElevated ? pacingState.reason : (pacingState?.reason || 'Operating On Schedule'));

    const liveWait = (pacingState && pacingState.metrics && pacingState.metrics.estimated_wait_minutes != null)
      ? pacingState.metrics.estimated_wait_minutes
      : (pass.estimated_wait_minutes || 1);

    const pacingObj = {
      pacing_status: pacingStatus,
      recommended_action: recommendedAction,
      recommended_delay_minutes: recommendedDelay,
      reason,
      is_active_advisory: isCentreElevated,
      pacing_acknowledged: !!pass.pacing_acknowledged_at,
      pacing_acknowledged_at: pass.pacing_acknowledged_at,
      pacing_acknowledged_by: pass.pacing_acknowledged_by,
      // Retain historical booking snapshot for audit/history
      historical_snapshot: {
        pacing_status: pass.pacing_status || 'NORMAL',
        recommended_delay_minutes: pass.recommended_delay_minutes || 0
      }
    };

    // Phase 7.2 Farmer Fairness Protection status
    const farmerFairness = await calculateFarmerFairness(pass.farmer_id);
    const fairnessObj = {
      fairness_score: farmerFairness.fairness_score,
      protection_level: farmerFairness.protection_level,
      status: farmerFairness.status,
      message: farmerFairness.message,
      metrics: farmerFairness.metrics,
      _notice: 'Fairness protection is active based on prior system-caused disruptions.'
    };

    res.json({
      success: true,
      pass: {
        ...pass,
        farmers_ahead: farmersAhead,
        physical_queue_length: liveMetrics ? liveMetrics.physical_queue_length : 0,
        congestion_level: liveMetrics ? liveMetrics.congestion_level : 'LOW',
        live_metrics: liveMetrics,
        verification_hash: verificationHash,
        qr_payload: {
          booking_id: pass.booking_id,
          token: pass.token || ('Q' + String(pass.queue_position_at_booking).padStart(3, '0')),
          hash: verificationHash
        },
        live_estimated_wait_minutes: (liveMetrics && liveMetrics.estimated_wait_minutes != null) ? liveMetrics.estimated_wait_minutes : liveWait,
        estimated_wait_minutes: (liveMetrics && liveMetrics.estimated_wait_minutes != null) ? liveMetrics.estimated_wait_minutes : liveWait,
        display_wait: (liveMetrics && liveMetrics.display_wait) ? liveMetrics.display_wait : (liveWait > 0 ? `~${liveWait} min` : '< 5 min'),
        pacing: pacingObj,
        fairness: fairnessObj,
        history: historyRes.rows
      },
      live_metrics: liveMetrics,
      pacing: pacingObj,
      fairness: fairnessObj
    });
  } catch (err) {
    console.error('Digital pass error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to retrieve digital pass.' });
  }
});

// =====================================================
// PHASE B: VERIFY PASS (GATE / KIOSK / ADMIN SCAN)
// =====================================================
app.post('/api/bookings/pass/verify', optionalAuthenticate, async (req, res) => {
  try {
    const { booking_id, hash } = req.body;
    if (!booking_id) {
      return res.status(400).json({ error: 'missing_booking_id', message: 'Booking ID is required.' });
    }

    const r = await pool.query(`
      SELECT b.*, f.name AS farmer_name, c.centre_name, s.start_time, s.end_time
      FROM bookings b
      JOIN farmers f ON b.farmer_id = f.farmer_id
      JOIN centres c ON b.centre_id = c.centre_id
      JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.booking_id = $1
    `, [booking_id]);

    if (r.rows.length === 0) {
      return res.status(404).json({ verified: false, error: 'booking_not_found', message: 'Booking record not found.' });
    }

    const booking = r.rows[0];

    // Cryptographic QR hash validation
    if (hash) {
      const crypto = require('crypto');
      const bDate = normalizeDateStr(booking.booking_date);
      const qrPayload = JSON.stringify({
        booking_id: booking.booking_id,
        farmer_id: booking.farmer_id,
        token: booking.token || ('Q' + String(booking.queue_position_at_booking).padStart(3, '0')),
        centre_id: booking.centre_id,
        date: bDate,
        crop: booking.crop
      });
      const expectedHash = crypto.createHmac('sha256', process.env.JWT_SECRET || 'kisan_queue_jwt_secret_key_2026')
        .update(qrPayload)
        .digest('hex')
        .slice(0, 16);

      if (hash !== expectedHash) {
        return res.status(400).json({
          verified: false,
          error: 'invalid_hash',
          message: 'Cryptographic QR verification hash mismatch. Tampered or counterfeit digital pass.'
        });
      }
    }

    // Centre Admin isolation check: must match assigned centre
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (booking.centre_id !== req.user.centreId) {
        return res.status(403).json({
          verified: false,
          error: 'centre_access_denied',
          message: `This pass is for centre ${booking.centre_id}, not your assigned centre (${req.user.centreId}).`
        });
      }
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const cCheck = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [booking.centre_id]);
      if (cCheck.rows.length === 0 || cCheck.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          verified: false,
          error: 'district_access_denied',
          message: `Forbidden: Pass for booking ${booking.booking_id} belongs to centre in ${cCheck.rows[0]?.district || 'another district'}, not your assigned district (${req.user.district}).`
        });
      }
    }

    // CSC Operator isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      const cCheck = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [booking.centre_id]);
      if (cCheck.rows.length === 0 || cCheck.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          verified: false,
          error: 'csc_district_access_denied',
          message: `Forbidden: Pass for booking ${booking.booking_id} belongs to ${cCheck.rows[0]?.district || 'another district'}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    res.json({
      verified: true,
      booking: {
        booking_id: booking.booking_id,
        token: booking.token,
        farmer_name: booking.farmer_name,
        farmer_id: booking.farmer_id,
        centre_name: booking.centre_name,
        centre_id: booking.centre_id,
        crop: booking.crop,
        quantity_quintals: booking.quantity_quintals,
        slot_time: `${booking.start_time} - ${booking.end_time}`,
        status: booking.status,
        queue_position: booking.queue_position_at_booking
      }
    });
  } catch (err) {
    console.error('Verify pass error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to verify pass.' });
  }
});

// =====================================================
// PHASE C: GEODESIC & WEATHER ADVISORY HELPERS
// =====================================================
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const p1 = Number(lat1);
  const l1 = Number(lon1);
  const p2 = Number(lat2);
  const l2 = Number(lon2);
  if (isNaN(p1) || isNaN(l1) || isNaN(p2) || isNaN(l2)) return null;
  const R = 6371; // Earth radius in km
  const dLat = (p2 - p1) * Math.PI / 180;
  const dLon = (l2 - l1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1 * Math.PI / 180) * Math.cos(p2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

const DISTRICT_COORDINATES = {
  'thanjavur': { lat: 10.7870, lon: 79.1378 },
  'madurai': { lat: 9.9252, lon: 78.1198 },
  'tiruchirappalli': { lat: 10.7905, lon: 78.7047 },
  'trichy': { lat: 10.7905, lon: 78.7047 },
  'ariyalur': { lat: 11.1401, lon: 79.0786 },
  'erode': { lat: 11.3410, lon: 77.7172 },
  'salem': { lat: 11.6643, lon: 78.1460 },
  'thiruvarur': { lat: 10.7725, lon: 79.6365 },
  'nagapattinam': { lat: 10.7672, lon: 79.8449 },
  'cuddalore': { lat: 11.7480, lon: 79.7714 },
  'pudukkottai': { lat: 10.3797, lon: 78.8208 }
};

async function fetchWeatherAdvisory(district, lat, lon) {
  let targetLat = lat;
  let targetLon = lon;

  if ((!targetLat || !targetLon) && district) {
    const dLower = district.trim().toLowerCase();
    const coords = DISTRICT_COORDINATES[dLower];
    if (coords) {
      targetLat = coords.lat;
      targetLon = coords.lon;
    } else {
      targetLat = 10.8;
      targetLon = 78.7;
    }
  }

  if (!targetLat || !targetLon) {
    return {
      available: false,
      advisory: 'Weather advisory service is offline. Procurement proceeds normally.',
      is_synthetic: true
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500); // 2.5s strict timeout

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLon}&current=temperature_2m,precipitation,weather_code&hourly=precipitation_probability`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`Weather API error HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const currentPrecip = data.current?.precipitation || 0;
    const currentTemp = data.current?.temperature_2m;
    const precipProb = data.hourly?.precipitation_probability?.[0] || 0;

    let condition = 'Clear / Favorable';
    let advisoryText = 'Favorable weather conditions reported. Unloading and moisture inspection proceeding normally.';
    let isRain = false;

    if (currentPrecip > 1.0 || precipProb > 60) {
      condition = 'Rain / Moisture Risk';
      advisoryText = 'Inclement weather (rainfall / high humidity) forecasted today. Please ensure grain is protected with moisture-proof tarpaulins during transit.';
      isRain = true;
    } else if (precipProb > 30) {
      condition = 'Partly Cloudy / Minor Precipitation Risk';
      advisoryText = 'Moderate cloud cover reported with minor chance of scattered rain. Keep transport tarpaulins on standby.';
    }

    return {
      available: true,
      condition,
      temperature_c: currentTemp,
      precipitation_mm: currentPrecip,
      rain_probability_percent: precipProb,
      advisory: advisoryText,
      is_inclement: isRain,
      _notice: 'DEMO/SYNTHETIC advisory feed derived from open meteorology telemetry'
    };
  } catch (err) {
    // Fail-safe fallback — never break calling code
    return {
      available: false,
      advisory: 'Live weather advisory temporarily unreachable. Procurement continues normally without weather constraint.',
      is_synthetic: true,
      _notice: 'DEMO/SYNTHETIC weather advisory service fallback'
    };
  }
}

// =====================================================
// PHASE C: WEATHER ADVISORY API (FAIL-SAFE CANONICAL SERVICE)
// =====================================================
app.get('/api/weather/advisory', async (req, res) => {
  try {
    const { district, lat, lon } = req.query;
    const advisory = await defaultWeatherService.getWeatherAdvisory(district, lat, lon);
    res.json({ success: true, ...advisory });
  } catch (err) {
    console.error('Weather advisory error:', err);
    // Strict fail-safe guarantee
    res.json({
      success: true,
      available: false,
      advisory: 'Weather advisory service unavailable. Procurements proceed normally.',
      is_synthetic: true
    });
  }
});

// =====================================================
// PHASE C: CONGESTION DETECTION & RESCHEDULE SUGGESTIONS
// =====================================================
app.get('/api/bookings/:id/reschedule-suggestions', optionalAuthenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;

    // Fetch booking, centre and slot data
    const bookingRes = await pool.query(`
      SELECT b.*, 
             c.centre_name, c.district, c.village_town, c.latitude, c.longitude,
             c.daily_capacity_slots, COALESCE(c.active_counters, 2) AS active_counters,
             s.date AS slot_date, s.start_time, s.end_time, s.booked_count, s.max_farmers
      FROM bookings b
      JOIN centres c ON b.centre_id = c.centre_id
      JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.booking_id = $1
    `, [bookingId]);

    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }

    const booking = bookingRes.rows[0];

    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (booking.farmer_id !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only view reschedule suggestions for your own booking.'
        });
      }
    }

    // 1. Calculate current centre congestion on booking_date
    const totalBookedRes = await pool.query(
      `SELECT count(*) FROM bookings 
       WHERE centre_id = $1 AND booking_date = $2 
       AND status NOT IN ('No-Show', 'Cancelled')`,
      [booking.centre_id, booking.booking_date]
    );
    const bookedToday = parseInt(totalBookedRes.rows[0].count) || 1;
    const dailyCapacity = Math.max(1, booking.daily_capacity_slots || 40);
    const utilizationPercent = Math.round((bookedToday / dailyCapacity) * 100);

    const activeCounters = Math.max(1, Number(booking.active_counters || 2));
    const currentWaitMin = Math.max(1, Math.round(((booking.queue_position_at_booking || 1) * 12) / activeCounters));

    // Congestion threshold: utilization >= 75% or wait >= 45 min or slot is full
    const isCongested = utilizationPercent >= 75 || currentWaitMin >= 45 || (booking.booked_count >= booking.max_farmers);

    let congestionReason = null;
    if (isCongested) {
      if (booking.booked_count >= booking.max_farmers) {
        congestionReason = `Allocated time slot is at maximum capacity (${booking.booked_count}/${booking.max_farmers} farmers booked).`;
      } else if (utilizationPercent >= 75) {
        congestionReason = `Centre capacity utilization is heavy (${utilizationPercent}% booked with ${bookedToday}/${dailyCapacity} daily slots).`;
      } else {
        congestionReason = `Estimated processing wait time is extended (~${currentWaitMin} minutes) due to high queue density.`;
      }
    }

    // 2. Farmer Fairness Policy Check (Phase 7.2 Multi-Disruption Protection)
    const rescheduleCount = Number(booking.reschedule_count || 0);
    const farmerFairness = await calculateFarmerFairness(booking.farmer_id);
    const fairnessStatus = farmerFairness.status;
    const fairnessMessage = farmerFairness.message;

    // Detect if current booking's slot has expired in Asia/Kolkata
    const { todayStr, currentTimeStr } = getKolkataNow();
    const origSlotDate = normalizeDateStr(booking.slot_date || booking.booking_date);
    const origExp = isSlotExpired(origSlotDate, booking.end_time);
    const isOriginalExpired = origExp.expired || (origSlotDate < todayStr);

    const suggestions = [];

    // 3. Alternative Slots at Same Centre (today and upcoming lookahead dates)
    await ensureCentreSlots(pool, booking.centre_id, todayStr, 7);

    const sameCentreSlots = await pool.query(`
      SELECT slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count
      FROM slots
      WHERE centre_id = $1
        AND slot_id != $2
        AND (date > $3 OR (date = $3 AND end_time > $4))
        AND booked_count < max_farmers
      ORDER BY date ASC, start_time ASC
      LIMIT 4
    `, [booking.centre_id, booking.slot_id, todayStr, currentTimeStr]);

    for (const altSlot of sameCentreSlots.rows) {
      const altSlotDate = normalizeDateStr(altSlot.date);
      const exp = isSlotExpired(altSlotDate, altSlot.end_time);
      if (exp.expired) continue;

      const isSlotToday = altSlotDate === todayStr;
      let altWait = Math.max(1, Math.round(((altSlot.booked_count + 1) * 12) / activeCounters));
      if (isSlotToday) {
        const liveCentre = await defaultCongestionService.getCentreLiveMetrics(pool, booking.centre_id);
        if (liveCentre && liveCentre.estimated_wait_minutes != null) {
          altWait = Math.max(1, liveCentre.estimated_wait_minutes);
        }
      }

      const waitSavings = currentWaitMin - altWait;
      const availableSeats = altSlot.max_farmers - altSlot.booked_count;
      const dateLabel = altSlotDate === todayStr ? 'Today' : altSlotDate;

      const explanation = isOriginalExpired
        ? `Valid upcoming slot on ${dateLabel} (${altSlot.start_time.slice(0, 5)} - ${altSlot.end_time.slice(0, 5)}) at ${booking.centre_name} with ${availableSeats} spaces available and estimated wait ~${altWait} min.`
        : (waitSavings > 0
          ? `Alternative slot on ${dateLabel} (${altSlot.start_time.slice(0, 5)} - ${altSlot.end_time.slice(0, 5)}) has an estimated wait of ~${altWait} min (${waitSavings} min faster than your current ~${currentWaitMin} min wait) with ${availableSeats} spaces available.`
          : `Alternative slot on ${dateLabel} (${altSlot.start_time.slice(0, 5)} - ${altSlot.end_time.slice(0, 5)}) with ${availableSeats} spaces available and estimated wait ~${altWait} min.`);

      suggestions.push({
        type: 'SAME_CENTRE_SLOT',
        centre_id: booking.centre_id,
        centre_name: booking.centre_name,
        district: booking.district,
        slot_id: altSlot.slot_id,
        date: altSlotDate,
        date_label: dateLabel,
        start_time: altSlot.start_time,
        end_time: altSlot.end_time,
        estimated_wait_minutes: altWait,
        available_capacity: availableSeats,
        distance_km: 0,
        distance_provider: 'SAME_CENTRE',
        is_road_distance: true,
        explanation,
        why_recommended: [
          isOriginalExpired ? 'Original appointment expired; upcoming operational slot' : 'Same centre earlier/alternative availability',
          `${availableSeats} slots available with verified open capacity`,
          `Estimated processing wait: ~${altWait} min`
        ]
      });
    }

    // 4. Alternative Centre within the SAME District (Strict District Boundary Enforcement & Road Distance)
    const altCentresRes = await pool.query(`
      SELECT centre_id, centre_name, village_town, district, latitude, longitude,
             daily_capacity_slots, COALESCE(active_counters, 2) AS active_counters
      FROM centres
      WHERE district = $1 AND centre_id != $2 
      AND operational_status = 'Open'
      LIMIT 5
    `, [booking.district, booking.centre_id]);

    for (const altC of altCentresRes.rows) {
      await ensureCentreSlots(pool, altC.centre_id, todayStr, 7);

      const altSlotRes = await pool.query(`
        SELECT slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count
        FROM slots 
        WHERE centre_id = $1
          AND (date > $2 OR (date = $2 AND end_time > $3))
          AND booked_count < max_farmers
        ORDER BY date ASC, start_time ASC
        LIMIT 1
      `, [altC.centre_id, todayStr, currentTimeStr]);

      const altSlot = altSlotRes.rows[0];

      if (altSlot && altSlot.booked_count < altSlot.max_farmers) {
        const altSlotDate = normalizeDateStr(altSlot.date);
        const exp = isSlotExpired(altSlotDate, altSlot.end_time);
        if (exp.expired) continue;

        const altCounters = Math.max(1, Number(altC.active_counters || 2));
        let altWait = Math.max(1, Math.round(((altSlot.booked_count + 1) * 12) / altCounters));
        if (altSlotDate === todayStr) {
          const altLive = await defaultCongestionService.getCentreLiveMetrics(pool, altC.centre_id);
          if (altLive && altLive.estimated_wait_minutes != null) {
            altWait = Math.max(1, altLive.estimated_wait_minutes);
          }
        }

        let distKm = null;
        let distProvider = 'OSRM_ROAD_NETWORK';
        let isEstimatedDist = false;
        try {
          const roadDist = await defaultDistanceService.getRoadDistance(
            { latitude: booking.latitude, longitude: booking.longitude },
            { latitude: altC.latitude, longitude: altC.longitude }
          );
          distKm = roadDist?.distance_km ?? null;
          distProvider = roadDist?.provider || 'OSRM_ROAD_NETWORK';
          isEstimatedDist = roadDist?.is_estimated ?? false;
        } catch (_) {
          distKm = calculateHaversineKm(booking.latitude, booking.longitude, altC.latitude, altC.longitude);
          distProvider = 'CALIBRATED_ROAD_FACTOR_FALLBACK';
          isEstimatedDist = true;
        }
        const distStr = distKm != null ? `${distKm} km road distance` : 'in your district';
        const dateLabel = altSlotDate === todayStr ? 'Today' : altSlotDate;
        const availableSeats = altSlot.max_farmers - altSlot.booked_count;

        const explanation = `Alternative centre recommended at ${altC.centre_name} (${distStr}) in ${altC.district}. Operating with ${altCounters} active counters, ${availableSeats} slots available on ${dateLabel} (${altSlot.start_time.slice(0, 5)} - ${altSlot.end_time.slice(0, 5)}), and estimated wait ~${altWait} min (vs. ~${currentWaitMin} min at ${booking.centre_name}).`;

        suggestions.push({
          type: 'ALTERNATIVE_CENTRE',
          centre_id: altC.centre_id,
          centre_name: altC.centre_name,
          village_town: altC.village_town,
          district: altC.district,
          slot_id: altSlot.slot_id,
          date: altSlotDate,
          date_label: dateLabel,
          start_time: altSlot.start_time,
          end_time: altSlot.end_time,
          estimated_wait_minutes: altWait,
          distance_km: distKm,
          distance_provider: distProvider,
          is_road_distance: true,
          is_estimated_distance: isEstimatedDist,
          available_capacity: availableSeats,
          explanation,
          why_recommended: [
            `Located within eligible district (${altC.district})`,
            distKm != null ? `${distKm} km verified road routing (${distProvider})` : 'Direct road routing verified',
            `${availableSeats} slots available with estimated wait ~${altWait} min`
          ]
        });
      }

      if (suggestions.length >= 5) break;
    }

    // 5. Fail-safe Weather Advisory using canonical WeatherService
    const weather = await defaultWeatherService.getWeatherAdvisory(booking.district, booking.latitude, booking.longitude);

    res.json({
      success: true,
      booking_id: booking.booking_id,
      is_congested: isCongested,
      congestion_reason: congestionReason,
      is_original_expired: isOriginalExpired,
      original_slot_status: isOriginalExpired ? 'EXPIRED' : 'ACTIVE',
      status_explanation: isOriginalExpired
        ? 'Your original appointment has expired. You can choose any valid upcoming operational slot below to rebook without penalty.'
        : 'Your original slot remains 100% active. Rebooking to an alternative is entirely optional.',
      current_slot: {
        centre_id: booking.centre_id,
        centre_name: booking.centre_name,
        district: booking.district,
        slot_id: booking.slot_id,
        date: booking.booking_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        queue_position: booking.queue_position_at_booking,
        estimated_wait_minutes: currentWaitMin,
        capacity_utilization_percent: utilizationPercent
      },
      reschedule_count: rescheduleCount,
      fairness: {
        status: fairnessStatus,
        message: fairnessMessage,
        protection_level: farmerFairness.protection_level,
        fairness_score: farmerFairness.fairness_score,
        disruption_count: farmerFairness.metrics.disruption_count,
        reschedule_count: farmerFairness.metrics.reschedule_count,
        recent_bonus: farmerFairness.metrics.recent_bonus,
        last_disrupted_at: farmerFairness.metrics.last_disrupted_at,
        _notice: 'Fairness scores are heuristic decision-support metrics and do not represent socioeconomic classification.'
      },
      suggestions,
      same_centre_alternatives: suggestions.filter(s => s.type === 'SAME_CENTRE_SLOT'),
      nearby_centre_alternatives: suggestions.filter(s => s.type === 'ALTERNATIVE_CENTRE'),
      weather_advisory: weather,
      _notice: 'Congestion thresholds & recommendations are algorithmic heuristics (DEMO/SYNTHETIC) to assist farmers and are not official administrative orders.'
    });

  } catch (err) {
    console.error('Reschedule suggestions error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to calculate reschedule recommendations.' });
  }
});

// =====================================================
// PHASE C: RESCHEDULING DECISION (FARMER ACCEPT / REJECT)
// =====================================================
app.post('/api/bookings/:id/reschedule', optionalAuthenticate, async (req, res) => {
  const { decision, new_slot_id, new_centre_id, reason } = req.body;
  const bookingId = req.params.id;

  if (!decision || (decision !== 'ACCEPT' && decision !== 'REJECT')) {
    return res.status(400).json({
      error: 'invalid_decision',
      message: "Decision must be either 'ACCEPT' or 'REJECT'."
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch and lock current booking
    const bCheck = await client.query('SELECT * FROM bookings WHERE booking_id = $1 FOR UPDATE', [bookingId]);
    if (bCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }

    const booking = bCheck.rows[0];

    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (booking.farmer_id !== req.user.farmerId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only decide rescheduling for your own booking.'
        });
      }
    }

    const actor = req.user ? (req.user.farmerId || req.user.username) : booking.farmer_id;

    // -------------------------------------------------
    // CASE A: FARMER REJECTS (KEEPS ORIGINAL BOOKING)
    // -------------------------------------------------
    if (decision === 'REJECT') {
      await client.query(`
        INSERT INTO reschedule_events
          (booking_id, old_slot_id, new_slot_id, old_centre_id, new_centre_id, reason, recommended_by, accepted_by, action)
        VALUES ($1, $2, $2, $3, $3, $4, 'SMART_SCHEDULER_HEURISTIC', $5, 'REJECTED')
      `, [
        bookingId,
        booking.slot_id,
        booking.centre_id,
        reason || 'Farmer explicitly declined alternative slot and chose to keep original appointment',
        actor
      ]);

      await client.query('COMMIT');

      return res.json({
        success: true,
        action: 'REJECTED',
        booking_id: bookingId,
        message: 'Original booking retained. No changes were made to your schedule.',
        current_slot: booking.slot_id,
        current_centre: booking.centre_id
      });
    }

    // -------------------------------------------------
    // CASE B: FARMER ACCEPTS ALTERNATIVE SLOT
    // -------------------------------------------------
    if (!new_slot_id || !new_centre_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'missing_parameters',
        message: 'Both new_slot_id and new_centre_id are required when accepting a reschedule.'
      });
    }

    // Strict District Hierarchy: Retrieve original centre district
    const origCentreRes = await client.query('SELECT district, centre_name FROM centres WHERE centre_id = $1', [booking.centre_id]);
    const origCentre = origCentreRes.rows[0];

    // Retrieve target centre
    const targetCentreRes = await client.query(
      'SELECT centre_id, centre_name, district, COALESCE(active_counters, 2) AS active_counters FROM centres WHERE centre_id = $1',
      [new_centre_id]
    );

    if (targetCentreRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'centre_not_found', message: 'Target centre does not exist.' });
    }

    const targetCentre = targetCentreRes.rows[0];

    // Check District boundary match
    if (origCentre.district.trim().toLowerCase() !== targetCentre.district.trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'district_mismatch',
        message: `Cross-district rescheduling blocked: Cannot reschedule from ${origCentre.district} to ${targetCentre.district}.`
      });
    }

    // Strict Centre-Slot Hierarchy: Verify new slot belongs to target centre
    const newSlotRes = await client.query('SELECT * FROM slots WHERE slot_id = $1 FOR UPDATE', [new_slot_id]);
    if (newSlotRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'slot_not_found', message: 'Selected target slot does not exist.' });
    }

    const newSlot = newSlotRes.rows[0];
    if (newSlot.centre_id !== new_centre_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'centre_slot_mismatch',
        message: `Validation failed: Target slot ${new_slot_id} belongs to centre ${newSlot.centre_id}, not ${new_centre_id}.`
      });
    }

    // Expired Slot Validation for Rescheduling (Asia/Kolkata timezone)
    const newSlotExp = isSlotExpired(newSlot.date, newSlot.end_time);
    if (newSlotExp.expired || newSlot.is_expired || newSlot.status === 'EXPIRED') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'slot_expired',
        code: 'SLOT_EXPIRED',
        reason: newSlotExp.reason || 'This slot has concluded.',
        message: 'Cannot reschedule to a past or expired slot. Please select a valid upcoming slot.'
      });
    }

    // Capacity verification
    if (newSlot.booked_count >= newSlot.max_farmers) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'slot_full',
        message: 'The selected alternative slot has filled up. Please choose another alternative.'
      });
    }

    // Free the old slot
    await client.query('UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE slot_id = $1', [booking.slot_id]);

    // Claim the new slot atomically
    const claimRes = await client.query(
      'UPDATE slots SET booked_count = booked_count + 1 WHERE slot_id = $1 AND booked_count < max_farmers RETURNING *',
      [new_slot_id]
    );
    if (claimRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'slot_full',
        message: 'The selected alternative slot has filled up. Please choose another alternative.'
      });
    }

    // Calculate new queue position & wait time
    const countRes = await client.query(
      "SELECT count(*) FROM bookings WHERE slot_id = $1 AND status != 'Payment Completed'",
      [new_slot_id]
    );
    const newQueuePos = parseInt(countRes.rows[0].count) + 1;
    const targetCounters = Math.max(1, Number(targetCentre.active_counters || 2));
    const newWaitMin = Math.max(1, Math.round((newQueuePos * 12) / targetCounters));

    const disruptionSource = req.body.disruption_source || (req.user && req.user.role === 'FARMER' ? 'VOLUNTARY_FARMER' : 'SYSTEM');
    const isSystemDisruption = req.body.is_system_disruption !== undefined 
      ? Boolean(req.body.is_system_disruption) 
      : (disruptionSource !== 'VOLUNTARY_FARMER');

    const cleanNewBookingDate = normalizeDateStr(newSlot.date);

    // Update booking record
    await client.query(`
      UPDATE bookings SET
        centre_id = $1,
        slot_id = $2,
        booking_date = $7,
        queue_position_at_booking = $3,
        estimated_wait_minutes = $4,
        reschedule_count = COALESCE(reschedule_count, 0) + 1,
        disruption_count = disruption_count + (CASE WHEN $6::boolean THEN 1 ELSE 0 END),
        last_disrupted_at = (CASE WHEN $6::boolean THEN NOW() ELSE last_disrupted_at END)
      WHERE booking_id = $5
    `, [new_centre_id, new_slot_id, newQueuePos, newWaitMin, bookingId, isSystemDisruption, cleanNewBookingDate]);

    // Insert into reschedule_events audit table
    await client.query(`
      INSERT INTO reschedule_events
        (booking_id, old_slot_id, new_slot_id, old_centre_id, new_centre_id, reason, recommended_by, accepted_by, action, disruption_source, is_system_disruption)
      VALUES ($1, $2, $3, $4, $5, $6, 'SMART_SCHEDULER_HEURISTIC', $7, 'ACCEPTED', $8, $9)
    `, [
      bookingId,
      booking.slot_id,
      new_slot_id,
      booking.centre_id,
      new_centre_id,
      reason || 'Farmer accepted smart reschedule alternative to reduce queue wait time',
      actor,
      disruptionSource,
      isSystemDisruption
    ]);

    // Append to status history
    await client.query(`
      INSERT INTO status_history (booking_id, centre_id, status)
      VALUES ($1, $2, 'Rescheduled')
    `, [bookingId, new_centre_id]);

    await client.query('COMMIT');

    // Trigger In-App Notification: BOOKING_RESCHEDULED
    createFarmerNotification(pool, {
      farmerId: booking.farmer_id,
      type: NOTIFICATION_TYPES.BOOKING_RESCHEDULED,
      title: 'Booking Updated',
      message: `Your procurement slot for Booking #${bookingId} has been rescheduled to ${newSlot.date ? normalizeDateStr(newSlot.date) : 'new date'} (${newSlot.start_time} - ${newSlot.end_time}) at ${targetCentre.centre_name || new_centre_id}.`,
      priority: PRIORITIES.INFO,
      actionRequired: false,
      actionUrl: `/farmer/pass/${bookingId}`,
      bookingId: bookingId,
      centreId: new_centre_id
    });

    res.json({
      success: true,
      action: 'ACCEPTED',
      booking_id: bookingId,
      message: 'Booking successfully rescheduled.',
      updated_booking: {
        booking_id: bookingId,
        centre_id: new_centre_id,
        centre_name: targetCentre.centre_name,
        district: targetCentre.district,
        slot_id: new_slot_id,
        slot_time: `${newSlot.start_time} - ${newSlot.end_time}`,
        queue_position: newQueuePos,
        estimated_wait_minutes: newWaitMin,
        reschedule_count: (booking.reschedule_count || 0) + 1
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reschedule error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to execute reschedule.' });
  } finally {
    client.release();
  }
});

// =====================================================
// PHASE C: RESCHEDULE AUDIT HISTORY
// =====================================================
app.get('/api/bookings/:id/reschedule-history', optionalAuthenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;

    // Verify booking exists
    const b = await pool.query('SELECT farmer_id FROM bookings WHERE booking_id = $1', [bookingId]);
    if (b.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }

    // Farmer isolation
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (b.rows[0].farmer_id !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only view reschedule history for your own booking.'
        });
      }
    }

    const historyRes = await pool.query(`
      SELECT r.*, 
             c_old.centre_name AS old_centre_name, 
             c_new.centre_name AS new_centre_name
      FROM reschedule_events r
      LEFT JOIN centres c_old ON r.old_centre_id = c_old.centre_id
      LEFT JOIN centres c_new ON r.new_centre_id = c_new.centre_id
      WHERE r.booking_id = $1
      ORDER BY r.created_at DESC
    `, [bookingId]);

    res.json({
      success: true,
      booking_id: bookingId,
      total_events: historyRes.rows.length,
      events: historyRes.rows
    });
  } catch (err) {
    console.error('Reschedule history error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load reschedule history.' });
  }
});

// Moving average processing time per centre (minutes between Checked-In -> Procured)
app.get('/api/centres/:id/avg-processing-time', async (req, res) => {
  const r = await pool.query(`
    SELECT booking_id,
      MAX(CASE WHEN status='Checked-In' THEN changed_at END) AS checkin_time,
      MAX(CASE WHEN status='Procured' THEN changed_at END) AS procured_time
    FROM status_history
    WHERE centre_id=$1
    GROUP BY booking_id
    HAVING MAX(CASE WHEN status='Procured' THEN changed_at END) IS NOT NULL
    ORDER BY procured_time DESC
    LIMIT 10
  `, [req.params.id]);

  if (r.rows.length === 0) {
    // cold start fallback: capacity-based estimate (480 working min / daily capacity)
    const c = await pool.query('SELECT daily_capacity_slots FROM centres WHERE centre_id=$1', [req.params.id]);
    const fallback = Math.round(480 / c.rows[0].daily_capacity_slots);
    return res.json({ avg_minutes_per_farmer: fallback, source: 'capacity_fallback', sample_size: 0 });
  }

  const durations = r.rows.map(row => (new Date(row.procured_time) - new Date(row.checkin_time)) / 60000);
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;

  res.json({ avg_minutes_per_farmer: Math.round(avg), source: 'moving_average', sample_size: durations.length });
});

// =====================================================
// PHASE 7.1: ADAPTIVE & FAIR SCHEDULING — DYNAMIC PACING ENGINE
// =====================================================

async function calculateCentrePacing(centreId, targetDate = null) {
  const cRes = await pool.query(`
    SELECT centre_id, centre_name, village_town, district, daily_capacity_slots,
           COALESCE(active_counters, 2) AS active_counters,
           COALESCE(staff_availability, 5) AS staff_availability,
           COALESCE(processing_rate_min, 12) AS processing_rate_min,
           operational_status, data_source
    FROM centres
    WHERE centre_id = $1
  `, [centreId]);

  if (cRes.rows.length === 0) return null;
  const centre = cRes.rows[0];

  // 1. Check if centre is Paused / Closed / Retired
  if (centre.operational_status !== 'Open') {
    return {
      centre_id: centre.centre_id,
      centre_name: centre.centre_name,
      district: centre.district,
      operational_status: centre.operational_status,
      pacing_status: 'PAUSED',
      recommended_action: 'RESCHEDULE',
      recommended_delay_minutes: 0,
      observed_processing_rate_min: Number(centre.processing_rate_min),
      planned_processing_rate_min: Number(centre.processing_rate_min),
      active_queue_count: 0,
      reason: `Centre is currently ${centre.operational_status}. Direct arrivals are halted; voluntary rescheduling or holding is recommended.`,
      metrics: {
        active_queue_count: 0,
        completed_today_count: 0,
        upcoming_bookings_count: 0,
        planned_rate_min: Number(centre.processing_rate_min),
        observed_rate_min: Number(centre.processing_rate_min),
        observed_rate_source: 'centre_paused',
        effective_rate_min: Number(centre.processing_rate_min),
        active_counters: Number(centre.active_counters),
        hourly_capacity_farmers: 0,
        estimated_wait_minutes: 0,
        daily_capacity_slots: Number(centre.daily_capacity_slots || 40),
        _is_synthetic_operational_data: true,
        _data_label: 'Observed rates are CALCULATED/ESTIMATED from status_history and not official live telemetry'
      },
      affected_bookings: []
    };
  }

  const plannedRate = Number(centre.processing_rate_min || 12);
  const activeCounters = Math.max(1, Number(centre.active_counters || 2));
  const dailyCapacity = Math.max(1, Number(centre.daily_capacity_slots || 40));

  // 2. Query moving average observed rate from status_history
  const histRes = await pool.query(`
    SELECT booking_id,
      MAX(CASE WHEN status='Checked-In' THEN changed_at END) AS checkin_time,
      MAX(CASE WHEN status='Procured' THEN changed_at END) AS procured_time
    FROM status_history
    WHERE centre_id = $1
    GROUP BY booking_id
    HAVING MAX(CASE WHEN status='Procured' THEN changed_at END) IS NOT NULL
       AND MAX(CASE WHEN status='Checked-In' THEN changed_at END) IS NOT NULL
    ORDER BY procured_time DESC
    LIMIT 10
  `, [centreId]);

  let observedRate = plannedRate;
  let observedSource = 'planned_baseline';
  let sampleSize = 0;

  if (histRes.rows.length > 0) {
    const validDurations = histRes.rows
      .map(r => (new Date(r.procured_time) - new Date(r.checkin_time)) / 60000)
      .filter(d => d > 0 && d <= 480);
    if (validDurations.length > 0) {
      observedRate = Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length);
      observedSource = 'status_history_moving_average';
      sampleSize = validDurations.length;
    }
  }

  const effectiveRate = Math.max(plannedRate, observedRate);

  // 3. Query active queue, completed, and upcoming bookings today
  const queueRes = await pool.query(`
    SELECT
      COUNT(booking_id) FILTER (WHERE status IN ('Checked-In', 'Grading', 'Weighing', 'On The Way')) AS active_queue,
      COUNT(booking_id) FILTER (WHERE status IN ('Procured', 'Payment Pending', 'Payment Completed')) AS completed_today,
      COUNT(booking_id) FILTER (WHERE status IN ('Booked', 'Confirmed')) AS upcoming_bookings
    FROM bookings
    WHERE centre_id = $1 AND booking_date = ${targetDate ? '$2' : 'CURRENT_DATE'}
  `, targetDate ? [centreId, targetDate] : [centreId]);

  const activeQueueCount = parseInt(queueRes.rows[0]?.active_queue) || 0;
  const completedTodayCount = parseInt(queueRes.rows[0]?.completed_today) || 0;
  const upcomingBookingsCount = parseInt(queueRes.rows[0]?.upcoming_bookings) || 0;

  const estimatedWaitMinutes = Math.max(1, Math.round(((activeQueueCount + 1) * effectiveRate) / activeCounters));
  const hourlyCapacity = Math.round((60 / effectiveRate) * activeCounters);

  // 4. Deterministic Pacing Classification
  let pacingStatus = 'NORMAL';
  let recommendedAction = 'CONTINUE';
  let recommendedDelayMinutes = 0;
  let reason = '';

  if (estimatedWaitMinutes >= 60 || activeQueueCount >= Math.max(4, Math.round(1.5 * hourlyCapacity)) || (sampleSize >= 2 && observedRate >= 2.0 * plannedRate && activeQueueCount >= 4)) {
    pacingStatus = 'CRITICAL';
    recommendedAction = 'RESCHEDULE';
    recommendedDelayMinutes = 60;
    reason = `Critical queue backlog: Active queue (${activeQueueCount} farmers) exceeds hourly processing capacity (${hourlyCapacity}/hr). Estimated wait is ~${estimatedWaitMinutes} minutes. Voluntary rescheduling or extended +60 min delay recommended.`;
  } else if (estimatedWaitMinutes >= 30 || (sampleSize >= 2 && observedRate >= 1.25 * plannedRate) || (activeQueueCount >= hourlyCapacity && activeQueueCount > 0)) {
    pacingStatus = 'SLOW';
    recommendedAction = 'DELAY';
    recommendedDelayMinutes = 30;
    reason = `Throughput velocity slowdown: Estimated queue wait is ~${estimatedWaitMinutes} minutes (observed turnaround ~${observedRate} min/farmer vs planned ${plannedRate} min/farmer). Recommended arrival stagger of +30 minutes for upcoming bookings.`;
  } else {
    pacingStatus = 'NORMAL';
    recommendedAction = 'CONTINUE';
    recommendedDelayMinutes = 0;
    reason = `Normal operations: Centre operating within expected throughput parameters (~${observedRate} min/farmer vs planned ${plannedRate} min/farmer). Estimated wait is ~${estimatedWaitMinutes} minutes.`;
  }

  // 5. Query upcoming bookings to return affected arrivals
  const upcomingRes = await pool.query(`
    SELECT b.booking_id, b.farmer_id, b.slot_id, b.status, b.queue_position_at_booking,
           b.estimated_wait_minutes, b.pacing_status, b.recommended_delay_minutes,
           b.pacing_acknowledged_at, f.name AS farmer_name, f.phone AS farmer_phone
    FROM bookings b
    JOIN farmers f ON b.farmer_id = f.farmer_id
    WHERE b.centre_id = $1 AND b.booking_date = ${targetDate ? '$2' : 'CURRENT_DATE'}
      AND b.status IN ('Booked', 'Confirmed')
    ORDER BY b.queue_position_at_booking ASC
  `, targetDate ? [centreId, targetDate] : [centreId]);

  const affectedBookings = upcomingRes.rows.map(b => ({
    booking_id: b.booking_id,
    farmer_id: b.farmer_id,
    farmer_name: b.farmer_name,
    farmer_phone: b.farmer_phone,
    slot_id: b.slot_id,
    status: b.status,
    queue_position: b.queue_position_at_booking,
    original_estimated_wait: b.estimated_wait_minutes,
    pacing_status: b.pacing_status || 'NORMAL',
    recommended_delay_minutes: recommendedDelayMinutes,
    pacing_acknowledged: !!b.pacing_acknowledged_at
  }));

  return {
    centre_id: centre.centre_id,
    centre_name: centre.centre_name,
    district: centre.district,
    operational_status: centre.operational_status,
    pacing_status: pacingStatus,
    recommended_action: recommendedAction,
    recommended_delay_minutes: recommendedDelayMinutes,
    observed_processing_rate_min: observedRate,
    planned_processing_rate_min: plannedRate,
    active_queue_count: activeQueueCount,
    reason,
    metrics: {
      active_queue_count: activeQueueCount,
      completed_today_count: completedTodayCount,
      upcoming_bookings_count: upcomingBookingsCount,
      planned_rate_min: plannedRate,
      observed_rate_min: observedRate,
      observed_rate_source: observedSource,
      effective_rate_min: effectiveRate,
      active_counters: activeCounters,
      hourly_capacity_farmers: hourlyCapacity,
      estimated_wait_minutes: estimatedWaitMinutes,
      daily_capacity_slots: dailyCapacity,
      _is_synthetic_operational_data: true,
      _data_label: 'Observed rates are CALCULATED/ESTIMATED from status_history and not official live telemetry'
    },
    affected_bookings: affectedBookings
  };
}

// 1. GET /api/centres/:id/pacing
app.get('/api/centres/:id/pacing', optionalAuthenticate, async (req, res) => {
  try {
    const centreId = req.params.id;
    const date = req.query.date;

    // Centre Admin isolation check
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (centreId !== req.user.centreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: You are authorized to manage only your assigned centre (${req.user.centreId}).`
        });
      }
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
      if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Centre ${centreId} does not belong to your assigned district (${req.user.district}).`
        });
      }
    }

    // CSC Operator isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
      if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Centre ${centreId} does not belong to your assigned CSC district (${req.user.district}).`
        });
      }
    }

    const pacingData = await calculateCentrePacing(centreId, date);
    if (!pacingData) {
      return res.status(404).json({ error: 'centre_not_found', message: 'Procurement centre not found.' });
    }

    res.json({ success: true, ...pacingData, pacing: pacingData });
  } catch (err) {
    console.error('Centre pacing error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to calculate centre pacing.' });
  }
});

// 2. POST /api/centres/:id/pacing/apply
app.post('/api/centres/:id/pacing/apply', authenticateToken, requireRole('CENTRE_ADMIN', 'DISTRICT_OFFICER'), async (req, res) => {
  try {
    const centreId = req.params.id;

    // Centre Admin isolation check
    if (req.user.role === 'CENTRE_ADMIN') {
      const userCentreId = req.user.centre_id || req.user.centreId;
      if (centreId !== userCentreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: You are authorized to manage only your assigned centre (${userCentreId}).`
        });
      }
    }

    // District Officer isolation check
    if (req.user.role === 'DISTRICT_OFFICER') {
      const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
      if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Centre ${centreId} does not belong to your assigned district (${req.user.district}).`
        });
      }
    }

    const targetDate = req.query.date || req.body?.date || null;
    const pacingData = await calculateCentrePacing(centreId, targetDate);
    if (!pacingData) {
      return res.status(404).json({ error: 'centre_not_found', message: 'Procurement centre not found.' });
    }

    const actor = req.user.username || req.user.role;

    // Insert pacing event audit log
    const auditRes = await pool.query(`
      INSERT INTO pacing_events
        (centre_id, pacing_status, recommended_action, delay_minutes, planned_rate_min,
         observed_rate_min, active_queue_count, reason, affected_count, applied_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, created_at
    `, [
      centreId,
      pacingData.pacing_status,
      pacingData.recommended_action,
      pacingData.recommended_delay_minutes,
      pacingData.metrics.planned_rate_min,
      pacingData.metrics.observed_rate_min,
      pacingData.metrics.active_queue_count,
      pacingData.reason,
      pacingData.affected_bookings.length,
      actor
    ]);

    // Update advisory snapshot on target date or today's upcoming bookings
    if (pacingData.affected_bookings.length > 0) {
      const delayMin = pacingData.recommended_delay_minutes || 0;
      const isDisruption = delayMin > 0;
      if (targetDate) {
        await pool.query(`
          UPDATE bookings
          SET pacing_status = $1,
              recommended_delay_minutes = $2,
              disruption_count = disruption_count + (CASE WHEN $5::boolean THEN 1 ELSE 0 END),
              last_disrupted_at = (CASE WHEN $5::boolean THEN NOW() ELSE last_disrupted_at END)
          WHERE centre_id = $3 AND booking_date = $4 AND status IN ('Booked', 'Confirmed')
        `, [pacingData.pacing_status, delayMin, centreId, targetDate, isDisruption]);
      } else {
        await pool.query(`
          UPDATE bookings
          SET pacing_status = $1,
              recommended_delay_minutes = $2,
              disruption_count = disruption_count + (CASE WHEN $4::boolean THEN 1 ELSE 0 END),
              last_disrupted_at = (CASE WHEN $4::boolean THEN NOW() ELSE last_disrupted_at END)
          WHERE centre_id = $3 AND booking_date = CURRENT_DATE AND status IN ('Booked', 'Confirmed')
        `, [pacingData.pacing_status, delayMin, centreId, isDisruption]);
      }

      // Notify affected farmers asynchronously
      for (const b of pacingData.affected_bookings) {
        if (b.farmer_id) {
          createFarmerNotification(pool, {
            farmerId: b.farmer_id,
            type: NOTIFICATION_TYPES.PACING_ADVISORY,
            title: 'Pacing Advisory',
            message: `Processing at your procurement centre is currently slower than expected. Recommended arrival: ${b.adjusted_recommended_arrival || (delayMin + ' mins later')}.`,
            priority: PRIORITIES.WARNING,
            actionRequired: false,
            actionUrl: `/farmer/pass/${b.booking_id}`,
            bookingId: b.booking_id,
            centreId
          });
        }
      }
    }

    res.json({
      success: true,
      pacing_event_id: auditRes.rows[0].id,
      pacing_status: pacingData.pacing_status,
      recommended_action: pacingData.recommended_action,
      recommended_delay_minutes: pacingData.recommended_delay_minutes,
      affected_count: pacingData.affected_bookings.length,
      reason: pacingData.reason,
      applied_at: auditRes.rows[0].created_at,
      message: `Adaptive pacing recommendation (${pacingData.pacing_status} - ${pacingData.recommended_action}) broadcast for centre ${centreId}.`
    });
  } catch (err) {
    console.error('Apply pacing error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to apply pacing recommendation.' });
  }
});

// 3. POST /api/bookings/:id/acknowledge-pacing
app.post('/api/bookings/:id/acknowledge-pacing', optionalAuthenticate, async (req, res) => {
  try {
    const bookingId = req.params.id;

    const bRes = await pool.query(`
      SELECT b.*, c.district FROM bookings b
      JOIN centres c ON b.centre_id = c.centre_id
      WHERE b.booking_id = $1
    `, [bookingId]);

    if (bRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }

    const booking = bRes.rows[0];

    // Farmer IDOR check
    const claimFarmerId = req.user?.farmer_id || req.user?.farmerId || req.body?.farmer_id;
    if (claimFarmerId && claimFarmerId !== booking.farmer_id) {
      return res.status(403).json({
        error: 'farmer_access_denied',
        message: 'Forbidden: You can only acknowledge pacing for your own booking.'
      });
    }

    // CSC Operator district boundary check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      if (booking.district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Booking belongs to district ${booking.district}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    const actor = req.user ? (req.user.username || req.user.farmerId || req.user.userId) : (req.body?.farmer_id || req.body?.acknowledged_by || booking.farmer_id);

    await pool.query(`
      UPDATE bookings
      SET pacing_acknowledged_at = NOW(), pacing_acknowledged_by = $1
      WHERE booking_id = $2
    `, [actor, bookingId]);

    res.json({
      success: true,
      booking_id: bookingId,
      pacing_acknowledged_at: new Date().toISOString(),
      message: 'Pacing arrival recommendation acknowledged. Your appointment remains confirmed.'
    });
  } catch (err) {
    console.error('Acknowledge pacing error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to acknowledge pacing recommendation.' });
  }
});

// 4. GET /api/district-officer/pacing
app.get('/api/district-officer/pacing', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const assignedDistrict = req.user.district;

    // Reject cross-district parameter tampering
    if (req.query.district && req.query.district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: You are authorized for district ${assignedDistrict} only.`
      });
    }

    const centresRes = await pool.query(`
      SELECT centre_id, centre_name, village_town, district, operational_status,
             daily_capacity_slots, COALESCE(active_counters, 2) AS active_counters,
             COALESCE(processing_rate_min, 12) AS processing_rate_min
      FROM centres
      WHERE district ILIKE $1 AND operational_status != 'Retired'
      ORDER BY centre_name ASC
    `, [assignedDistrict.trim()]);

    const centres = centresRes.rows;

    let normalCount = 0;
    let slowCount = 0;
    let criticalCount = 0;
    let pausedCount = 0;
    let totalAffectedFarmers = 0;

    const centrePacingSummaries = [];

    for (const c of centres) {
      const p = await calculateCentrePacing(c.centre_id);
      if (p) {
        if (p.pacing_status === 'NORMAL') normalCount++;
        else if (p.pacing_status === 'SLOW') slowCount++;
        else if (p.pacing_status === 'CRITICAL') criticalCount++;
        else if (p.pacing_status === 'PAUSED') pausedCount++;

        totalAffectedFarmers += p.affected_bookings.length;

        centrePacingSummaries.push({
          centre_id: c.centre_id,
          centre_name: c.centre_name,
          village_town: c.village_town,
          operational_status: c.operational_status,
          pacing_status: p.pacing_status,
          recommended_action: p.recommended_action,
          recommended_delay_minutes: p.recommended_delay_minutes,
          active_queue_count: p.metrics.active_queue_count,
          estimated_wait_minutes: p.metrics.estimated_wait_minutes,
          affected_farmer_count: p.affected_bookings.length,
          reason: p.reason
        });
      }
    }

    const pacingSummary = {
      total_centres: centres.length,
      normal: normalCount,
      slow: slowCount,
      critical: criticalCount,
      paused: pausedCount,
      normal_centres: normalCount,
      slow_centres: slowCount,
      critical_centres: criticalCount,
      paused_centres: pausedCount,
      total_affected_farmers: totalAffectedFarmers,
      _is_synthetic_operational_data: true,
      _notice: 'District pacing metrics derived from calculated queue velocity'
    };

    res.json({
      success: true,
      district: assignedDistrict,
      summary: pacingSummary,
      pacing_summary: pacingSummary,
      centres: centrePacingSummaries
    });
  } catch (err) {
    console.error('District pacing error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load district pacing overview.' });
  }
});

// =====================================================
// PHASE 7.2: FAIRNESS & ANTI-REPEATED-DISRUPTION APIS
// =====================================================

// 1. GET /api/farmers/:farmerId/fairness
// Transparent, non-competitive fairness breakdown for a farmer
app.get('/api/farmers/:farmerId/fairness', optionalAuthenticate, async (req, res) => {
  try {
    const { farmerId } = req.params;

    // RBAC & IDOR checks
    if (req.user) {
      if (req.user.role === 'FARMER' && req.user.farmerId) {
        if (req.user.farmerId !== farmerId) {
          return res.status(403).json({
            error: 'farmer_access_denied',
            message: `Forbidden: You are logged in as farmer ${req.user.farmerId} and cannot view fairness data for ${farmerId}.`
          });
        }
      }

      if (req.user.role === 'CSC_OPERATOR' && req.user.district) {
        const f = await pool.query('SELECT district FROM farmers WHERE farmer_id = $1', [farmerId]);
        if (f.rows.length > 0 && f.rows[0].district && f.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
          return res.status(403).json({
            error: 'csc_district_access_denied',
            message: `Forbidden: Farmer ${farmerId} belongs to ${f.rows[0].district}, outside your assigned CSC district (${req.user.district}).`
          });
        }
      }

      if (req.user.role === 'CENTRE_ADMIN') {
        const userCentreId = req.user.centre_id || req.user.centreId;
        const b = await pool.query('SELECT 1 FROM bookings WHERE farmer_id = $1 AND centre_id = $2 LIMIT 1', [farmerId, userCentreId]);
        if (b.rows.length === 0) {
          return res.status(403).json({
            error: 'centre_access_denied',
            message: `Forbidden: Farmer ${farmerId} has no active bookings at your assigned centre (${userCentreId}).`
          });
        }
      }
    }

    const fairness = await calculateFarmerFairness(farmerId);

    // Fetch disruption & reschedule event history for this farmer
    const historyRes = await pool.query(`
      SELECT re.id, re.booking_id, re.action, re.reason, re.disruption_source, 
             re.is_system_disruption, re.created_at,
             c_old.centre_name AS old_centre_name,
             c_new.centre_name AS new_centre_name
      FROM reschedule_events re
      JOIN bookings b ON re.booking_id = b.booking_id
      LEFT JOIN centres c_old ON re.old_centre_id = c_old.centre_id
      LEFT JOIN centres c_new ON re.new_centre_id = c_new.centre_id
      WHERE b.farmer_id = $1
      ORDER BY re.created_at DESC
      LIMIT 10
    `, [farmerId]);

    res.json({
      success: true,
      farmer_id: farmerId,
      fairness_score: fairness.fairness_score,
      protection_level: fairness.protection_level,
      status: fairness.status,
      message: fairness.message,
      metrics: fairness.metrics,
      history: historyRes.rows,
      config: FAIRNESS_CONFIG,
      _notice: 'Farmer fairness scores are heuristic decision-support metrics designed to prevent repeated system disruption, not an official socioeconomic classification.'
    });
  } catch (err) {
    console.error('Farmer fairness error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to calculate farmer fairness details.' });
  }
});

// 2. GET /api/centres/:id/fairness
// Centre Admin candidate ranking and explainable anti-disruption recommendations
app.get('/api/centres/:id/fairness', optionalAuthenticate, async (req, res) => {
  try {
    const centreId = req.params.id;

    // RBAC & IDOR checks
    if (req.user) {
      if (req.user.role === 'CENTRE_ADMIN') {
        const userCentreId = req.user.centre_id || req.user.centreId;
        if (centreId !== userCentreId) {
          return res.status(403).json({
            error: 'centre_access_denied',
            message: `Forbidden: You are authorized to manage only your assigned centre (${userCentreId}).`
          });
        }
      }

      if (req.user.role === 'DISTRICT_OFFICER') {
        const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
        if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
          return res.status(403).json({
            error: 'district_access_denied',
            message: `Forbidden: Centre ${centreId} does not belong to your assigned district (${req.user.district}).`
          });
        }
      }
    }

    const cRes = await pool.query('SELECT centre_id, centre_name, district, operational_status FROM centres WHERE centre_id = $1', [centreId]);
    if (cRes.rows.length === 0) {
      return res.status(404).json({ error: 'centre_not_found', message: 'Centre not found.' });
    }
    const centre = cRes.rows[0];

    const targetDate = req.query.date || null;
    let queueQuery = `
      SELECT b.booking_id, b.farmer_id, b.token, b.queue_position_at_booking, b.booking_date,
             b.status, b.reschedule_count, b.disruption_count, b.last_disrupted_at,
             f.name AS farmer_name, f.phone, s.start_time, s.end_time
      FROM bookings b
      JOIN farmers f ON b.farmer_id = f.farmer_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.centre_id = $1 AND b.status NOT IN ('Payment Completed', 'No-Show', 'Cancelled')
    `;
    const params = [centreId];
    if (targetDate) {
      queueQuery += ` AND b.booking_date = $2`;
      params.push(targetDate);
    }
    queueQuery += ` ORDER BY b.booking_date ASC, s.start_time ASC, b.queue_position_at_booking ASC`;

    const queueRes = await pool.query(queueQuery, params);
    const farmerIds = [...new Set(queueRes.rows.map(r => r.farmer_id))];
    const fairnessMap = await calculateBatchFarmerFairness(farmerIds);

    let highCount = 0;
    let moderateCount = 0;
    let lowCount = 0;

    const candidates = queueRes.rows.map(row => {
      const f = fairnessMap[row.farmer_id] || {
        fairness_score: 0,
        protection_level: 'LOW',
        status: 'STANDARD',
        message: 'Standard queue tracking.'
      };

      if (f.protection_level === 'HIGH') highCount++;
      else if (f.protection_level === 'MODERATE') moderateCount++;
      else lowCount++;

      return {
        booking_id: row.booking_id,
        farmer_id: row.farmer_id,
        farmer_name: row.farmer_name,
        phone: row.phone,
        token: row.token,
        booking_date: row.booking_date,
        slot_time: row.start_time ? `${row.start_time} - ${row.end_time}` : null,
        queue_position: row.queue_position_at_booking,
        status: row.status,
        fairness_score: f.fairness_score,
        protection_level: f.protection_level,
        status_label: f.status,
        recommendation: f.protection_level === 'HIGH' 
          ? 'PROTECT: Prioritize preserving appointment due to high disruption history'
          : f.protection_level === 'MODERATE'
          ? 'CAUTION: Prior disruptions recorded; consider alternatives first'
          : 'FEASIBLE CANDIDATE: Standard candidate if schedule adjustments required'
      };
    });

    // Sort candidates for rescheduling/pacing consideration: lowest fairness score first
    const rankedCandidates = [...candidates].sort((a, b) => a.fairness_score - b.fairness_score);

    res.json({
      success: true,
      centre,
      summary: {
        total_farmers_evaluated: candidates.length,
        high_protection_count: highCount,
        moderate_protection_count: moderateCount,
        low_protection_count: lowCount
      },
      candidates: rankedCandidates,
      operational_guidance: {
        rule: 'When operational adjustments (stagger, delay, reschedule) are necessary, select candidates with LOW protection levels to avoid compounding disruptions for previously affected farmers.',
        override_clause: 'In emergencies or if centre status is Paused/Closed, operational necessity overrides fairness protections to ensure safety and system integrity.'
      },
      _notice: 'Fairness scores are heuristic decision-support metrics and do not represent socioeconomic classification.'
    });
  } catch (err) {
    console.error('Centre fairness error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load centre fairness analysis.' });
  }
});

// 3. GET /api/district-officer/fairness
// District-wide fairness summary, repeat disruption oversight, and centre hotspots
app.get('/api/district-officer/fairness', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const assignedDistrict = req.user.district;
    if (!assignedDistrict) {
      return res.status(400).json({ error: 'no_assigned_district', message: 'No district assigned to this officer account.' });
    }

    // Explicit query param district check
    if (req.query.district && req.query.district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: You are authorized to access only ${assignedDistrict}, not ${req.query.district}.`
      });
    }

    // Get all centres in officer's district
    const cRes = await pool.query(`
      SELECT centre_id, centre_name, village_town, operational_status
      FROM centres
      WHERE LOWER(TRIM(district)) = LOWER(TRIM($1))
      ORDER BY centre_name ASC
    `, [assignedDistrict]);

    const centres = cRes.rows;
    const centreIds = centres.map(c => c.centre_id);

    if (centreIds.length === 0) {
      return res.json({
        success: true,
        district: assignedDistrict,
        summary: {
          total_centres: 0,
          total_active_bookings: 0,
          total_evaluated_farmers: 0,
          high_protection_farmers: 0,
          moderate_protection_farmers: 0,
          low_protection_farmers: 0,
          total_reschedules: 0,
          total_disruptions: 0
        },
        hotspots: [],
        repeat_disruption_cases: []
      });
    }

    // Get all active bookings in district
    const bRes = await pool.query(`
      SELECT b.booking_id, b.farmer_id, b.centre_id, b.reschedule_count, b.disruption_count,
             b.status, f.name AS farmer_name, f.phone
      FROM bookings b
      JOIN farmers f ON b.farmer_id = f.farmer_id
      WHERE b.centre_id = ANY($1::text[])
    `, [centreIds]);

    const farmerIds = [...new Set(bRes.rows.map(r => r.farmer_id))];
    const fairnessMap = await calculateBatchFarmerFairness(farmerIds);

    let highProtectionCount = 0;
    let moderateProtectionCount = 0;
    let lowProtectionCount = 0;

    const centreStats = {};
    centres.forEach(c => {
      centreStats[c.centre_id] = {
        centre_id: c.centre_id,
        centre_name: c.centre_name,
        village_town: c.village_town,
        operational_status: c.operational_status,
        total_bookings: 0,
        reschedule_events_count: 0,
        pacing_disruptions_count: 0,
        high_protection_farmers_count: 0,
        moderate_protection_farmers_count: 0
      };
    });

    const evaluatedFarmers = new Set();
    const repeatCases = [];

    bRes.rows.forEach(b => {
      if (centreStats[b.centre_id]) {
        centreStats[b.centre_id].total_bookings++;
        centreStats[b.centre_id].reschedule_events_count += Number(b.reschedule_count || 0);
        centreStats[b.centre_id].pacing_disruptions_count += Number(b.disruption_count || 0);
      }

      if (!evaluatedFarmers.has(b.farmer_id)) {
        evaluatedFarmers.add(b.farmer_id);
        const fInfo = fairnessMap[b.farmer_id];
        if (fInfo) {
          if (fInfo.protection_level === 'HIGH') {
            highProtectionCount++;
            if (centreStats[b.centre_id]) centreStats[b.centre_id].high_protection_farmers_count++;
            repeatCases.push({
              farmer_id: b.farmer_id,
              farmer_name: b.farmer_name,
              phone: b.phone,
              centre_id: b.centre_id,
              fairness_score: fInfo.fairness_score,
              protection_level: fInfo.protection_level,
              reschedule_count: fInfo.metrics.reschedule_count,
              disruption_count: fInfo.metrics.disruption_count
            });
          } else if (fInfo.protection_level === 'MODERATE') {
            moderateProtectionCount++;
            if (centreStats[b.centre_id]) centreStats[b.centre_id].moderate_protection_farmers_count++;
          } else {
            lowProtectionCount++;
          }
        }
      }
    });

    // Disruption hotspots: sorted by (reschedule_events_count + pacing_disruptions_count) DESC
    const hotspots = Object.values(centreStats)
      .sort((a, b) => (b.reschedule_events_count + b.pacing_disruptions_count) - (a.reschedule_events_count + a.pacing_disruptions_count));

    const totalReschedules = Object.values(centreStats).reduce((acc, c) => acc + c.reschedule_events_count, 0);
    const totalDisruptions = Object.values(centreStats).reduce((acc, c) => acc + c.pacing_disruptions_count, 0);

    res.json({
      success: true,
      district: assignedDistrict,
      summary: {
        total_centres: centres.length,
        total_active_bookings: bRes.rows.length,
        total_evaluated_farmers: evaluatedFarmers.size,
        high_protection_farmers: highProtectionCount,
        moderate_protection_farmers: moderateProtectionCount,
        low_protection_farmers: lowProtectionCount,
        total_reschedules: totalReschedules,
        total_disruptions: totalDisruptions
      },
      hotspots,
      repeat_disruption_cases: repeatCases.sort((a, b) => b.fairness_score - a.fairness_score),
      _notice: 'District fairness and anti-disruption metrics are based on calculated system events, not socioeconomic profiles.'
    });
  } catch (err) {
    console.error('District fairness error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load district fairness summary.' });
  }
});


// =====================================================
// GRIEVANCE / COMPLAINT SYSTEM WITH SLA ESCALATION
// =====================================================

// SLA time limits in hours
const SLA_HOURS = {
  'Payment Delay': 48,
  'PAYMENT_DISPUTE': 48,
  'Payment Dispute': 48,
  'Grading Dispute': 24,
  'QUALITY_DISPUTE': 24,
  'Quality Dispute': 24,
  'WEIGHT_DISPUTE': 24,
  'Weight Dispute': 24,
  'PROCUREMENT_DISPUTE': 48,
  'Procurement Dispute': 48,
  'Staff Conduct': 72,
  'Other': 72
};


// 1. Farmer raises a grievance
app.post('/api/grievances', optionalAuthenticate, async (req, res) => {
  try {
    const {
      farmer_id,
      booking_id,
      centre_id,
      issue_type,
      description
    } = req.body;

    // Basic validation
    if (!farmer_id || !centre_id || !issue_type || !description) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'Farmer ID, centre ID, issue type and description are required.'
      });
    }

    // Farmer isolation check: logged-in farmer can only raise for themselves
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId && req.user.farmerId !== farmer_id) {
      return res.status(403).json({
        error: 'farmer_access_denied',
        message: `Forbidden: You are logged in as farmer ${req.user.farmerId} and cannot raise grievances for ${farmer_id}.`
      });
    }

    // Check farmer exists
    const farmer = await pool.query(
      'SELECT farmer_id, district FROM farmers WHERE farmer_id=$1',
      [farmer_id]
    );

    if (farmer.rows.length === 0) {
      return res.status(404).json({
        error: 'farmer_not_found',
        message: 'Farmer not found.'
      });
    }

    // CSC Operator district isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      if (farmer.rows[0].district && farmer.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Farmer ${farmer_id} belongs to ${farmer.rows[0].district}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    // Check centre exists
    const centre = await pool.query(
      'SELECT centre_id, district FROM centres WHERE centre_id=$1',
      [centre_id]
    );

    if (centre.rows.length === 0) {
      return res.status(404).json({
        error: 'centre_not_found',
        message: 'Centre not found.'
      });
    }

    // Generate grievance ID
    const grievance_id =
      'G' + Date.now().toString().slice(-8);

    // Get SLA duration
    const slaHours = SLA_HOURS[issue_type] || 72;

    // Insert grievance
    await pool.query(
      `INSERT INTO grievances
       (
         grievance_id,
         booking_id,
         farmer_id,
         centre_id,
         issue_type,
         description,
         status,
         sla_deadline
       )
       VALUES
       (
         $1,$2,$3,$4,$5,$6,'Open',
         NOW() + ($7 * INTERVAL '1 hour')
       )`,
      [
        grievance_id,
        booking_id || null,
        farmer_id,
        centre_id,
        issue_type,
        description,
        slaHours
      ]
    );

    // Trigger In-App Notification: GRIEVANCE_SUBMITTED
    createFarmerNotification(pool, {
      farmerId: farmer_id,
      type: NOTIFICATION_TYPES.GRIEVANCE_SUBMITTED,
      title: 'Grievance Submitted',
      message: `Your grievance #${grievance_id} (${issue_type}) has been registered. Expected resolution within ${slaHours} hours.`,
      priority: PRIORITIES.INFO,
      actionRequired: false,
      actionUrl: '/farmer/grievance',
      grievanceId: grievance_id,
      centreId: centre_id
    });

    res.json({
      success: true,
      grievance_id,
      status: 'Open',
      sla_hours: slaHours,
      message: `Grievance raised successfully. It must be resolved within ${slaHours} hours.`
    });

  } catch (err) {
    console.error('Create grievance error:', err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to create grievance.'
    });
  }
});


// 2. Farmer views their grievances
app.get('/api/grievances/:farmerId', optionalAuthenticate, async (req, res) => {
  try {
    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (req.params.farmerId !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only view your own grievances.'
        });
      }
    }

    // CSC Operator isolation check
    if (req.user && req.user.role === 'CSC_OPERATOR' && req.user.district) {
      const f = await pool.query('SELECT district FROM farmers WHERE farmer_id = $1', [req.params.farmerId]);
      if (f.rows.length > 0 && f.rows[0].district && f.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Farmer ${req.params.farmerId} belongs to ${f.rows[0].district}, outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    const r = await pool.query(
      `SELECT
         *,
         CASE
           WHEN status = 'VERIFIED_RESOLVED'
             THEN 'Resolved'

           WHEN status = 'AWAITING_FARMER_CONFIRMATION'
             THEN 'Awaiting Confirmation'

           WHEN status = 'REOPENED'
             THEN 'Reopened'

           WHEN status = 'Resolved'
             THEN 'Resolved'

           WHEN NOW() > sla_deadline
             THEN 'Escalated'

           WHEN sla_deadline - NOW() < INTERVAL '6 hours'
             THEN 'Due Soon'

           ELSE 'On Track'
         END AS sla_status

       FROM grievances

       WHERE farmer_id=$1

       ORDER BY created_at DESC`,
      [req.params.farmerId]
    );

    res.json(r.rows);

  } catch (err) {

    console.error('Get farmer grievances error:', err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load grievances.'
    });
  }
});


// 3. Admin views grievances for a centre
app.get('/api/centres/:id/grievances', optionalAuthenticate, async (req, res) => {
  try {
    const centreId = req.params.id;

    // Centre Admin isolation check: must match assigned centre
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (centreId !== req.user.centreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: You are authorized to view grievances only for your assigned centre (${req.user.centreId}).`
        });
      }
    }

    // District Officer isolation check: centre must belong to assigned district
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
      if (c.rows.length === 0 || c.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Centre ${centreId} does not belong to your assigned district (${req.user.district}).`
        });
      }
    }

    const r = await pool.query(
      `SELECT
         g.*,
         f.name AS farmer_name,
         f.phone,

         CASE
           WHEN g.status = 'Resolved'
             THEN 'Resolved'

           WHEN NOW() > g.sla_deadline
             THEN 'Escalated'

           WHEN g.sla_deadline - NOW() < INTERVAL '6 hours'
             THEN 'Due Soon'

           ELSE 'On Track'
         END AS sla_status,

         EXTRACT(
           EPOCH FROM
           (g.sla_deadline - NOW())
         ) / 3600 AS hours_remaining

       FROM grievances g

       JOIN farmers f
         ON g.farmer_id = f.farmer_id

       WHERE g.centre_id=$1

       ORDER BY
         CASE
           WHEN g.status != 'Resolved'
            AND NOW() > g.sla_deadline
           THEN 0
           ELSE 1
         END,

         g.sla_deadline ASC`,
      [req.params.id]
    );

    res.json(r.rows);

  } catch (err) {

    console.error('Get centre grievances error:', err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load grievances.'
    });
  }
});


// 4. Admin marks grievance as In Progress / Escalated
app.patch('/api/grievances/:id/status', optionalAuthenticate, async (req, res) => {
  try {

    const { status } = req.body;

    const allowedStatuses = [
      'Open',
      'In Progress',
      'Escalated'
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: 'invalid_status',
        message: 'Invalid grievance status.'
      });
    }

    const gCheck = await pool.query('SELECT centre_id FROM grievances WHERE grievance_id = $1', [req.params.id]);
    if (gCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'grievance_not_found',
        message: 'Grievance not found.'
      });
    }

    // Centre Admin isolation check: must match assigned centre
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (gCheck.rows[0].centre_id !== req.user.centreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: Grievance ${req.params.id} belongs to centre ${gCheck.rows[0].centre_id}, but you are assigned to ${req.user.centreId}.`
        });
      }
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const cCheck = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [gCheck.rows[0].centre_id]);
      if (cCheck.rows.length === 0 || cCheck.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Grievance belongs to centre in ${cCheck.rows[0]?.district || 'another district'}, not your assigned district (${req.user.district}).`
        });
      }
    }

    const result = await pool.query(
      `UPDATE grievances
       SET status=$1
       WHERE grievance_id=$2
       RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows[0]?.farmer_id) {
      createFarmerNotification(pool, {
        farmerId: result.rows[0].farmer_id,
        type: NOTIFICATION_TYPES.GRIEVANCE_UPDATED,
        title: 'Grievance Updated',
        message: `Your grievance #${req.params.id} has been marked as "${status}".`,
        priority: PRIORITIES.INFO,
        actionRequired: false,
        actionUrl: '/farmer/grievance',
        grievanceId: req.params.id
      });
    }

    res.json({
      success: true,
      grievance: result.rows[0]
    });

  } catch (err) {

    console.error('Update grievance status error:', err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to update grievance status.'
    });
  }
});


// 5. Admin resolves grievance
app.patch('/api/grievances/:id/resolve', optionalAuthenticate, async (req, res) => {
  try {
    const { resolution_notes } = req.body;
    const grievanceId = req.params.id;

    // Get current grievance
    const current = await pool.query(
      `SELECT grievance_id, centre_id, status
       FROM grievances
       WHERE grievance_id=$1`,
      [grievanceId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'grievance_not_found',
        message: 'Grievance not found.'
      });
    }

    // Centre Admin isolation check: must match assigned centre
    if (req.user && req.user.role === 'CENTRE_ADMIN' && req.user.centreId) {
      if (current.rows[0].centre_id !== req.user.centreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: Grievance ${grievanceId} belongs to centre ${current.rows[0].centre_id}, but you are assigned to ${req.user.centreId}.`
        });
      }
    }

    // District Officer isolation check
    if (req.user && req.user.role === 'DISTRICT_OFFICER' && req.user.district) {
      const cCheck = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [current.rows[0].centre_id]);
      if (cCheck.rows.length === 0 || cCheck.rows[0].district.trim().toLowerCase() !== req.user.district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Grievance belongs to centre in ${cCheck.rows[0]?.district || 'another district'}, not your assigned district (${req.user.district}).`
        });
      }
    }

    const previousStatus = current.rows[0].status;

    // Admin claims that the grievance is resolved.
    // Farmer must confirm before it becomes finally resolved.
    const result = await pool.query(
      `UPDATE grievances
       SET
         status='AWAITING_FARMER_CONFIRMATION',
         admin_resolved_at=NOW(),
         resolution_notes=$1
       WHERE grievance_id=$2
       RETURNING *`,
      [
        resolution_notes || 'Resolution submitted by centre staff',
        grievanceId
      ]
    );

    // Save audit history
    await pool.query(
      `INSERT INTO grievance_history
       (
         grievance_id,
         action,
         performed_by,
         previous_status,
         new_status,
         comment
       )
       VALUES
       (
         $1,
         'ADMIN_CLAIMED_RESOLUTION',
         'ADMIN',
         $2,
         'AWAITING_FARMER_CONFIRMATION',
         $3
       )`,
      [
        grievanceId,
        previousStatus,
        resolution_notes || 'Resolution submitted by centre staff'
      ]
    );

    if (result.rows[0]?.farmer_id) {
      createFarmerNotification(pool, {
        farmerId: result.rows[0].farmer_id,
        type: NOTIFICATION_TYPES.GRIEVANCE_CONFIRMATION,
        title: 'Action Required',
        message: `Your grievance #${grievanceId} awaits your confirmation. Officer resolution: "${resolution_notes || 'It is solved'}".`,
        priority: PRIORITIES.ACTION_REQUIRED,
        actionRequired: true,
        actionUrl: '/farmer/grievance',
        grievanceId: grievanceId,
        centreId: current.rows[0]?.centre_id
      });
    }

    res.json({
      success: true,
      message: 'Resolution submitted. Waiting for farmer confirmation.',
      grievance: result.rows[0]
    });

  } catch (err) {
    console.error('Resolve grievance error:', err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to submit grievance resolution.'
    });
  }
});


// 6. Farmer confirms or rejects admin resolution
app.patch('/api/grievances/:id/confirm', optionalAuthenticate, async (req, res) => {
  try {
    const { confirmation, feedback } = req.body;
    const grievanceId = req.params.id;

    // Only YES or NO is accepted
    if (!['YES', 'NO'].includes(confirmation)) {
      return res.status(400).json({
        error: 'invalid_confirmation',
        message: 'Confirmation must be YES or NO.'
      });
    }

    // Get grievance
    const current = await pool.query(
      `SELECT grievance_id, farmer_id, status
       FROM grievances
       WHERE grievance_id=$1`,
      [grievanceId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'grievance_not_found',
        message: 'Grievance not found.'
      });
    }

    const grievance = current.rows[0];

    // Role security check: Only farmers can confirm/reopen resolution
    if (req.user && req.user.role && req.user.role !== 'FARMER') {
      return res.status(403).json({
        error: 'forbidden_role',
        message: 'Forbidden: Only the farmer can confirm or reject grievance resolution.'
      });
    }

    // Farmer isolation check
    if (req.user && req.user.role === 'FARMER' && req.user.farmerId) {
      if (grievance.farmer_id !== req.user.farmerId) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only confirm resolution for your own grievance.'
        });
      }
    }

    // Farmer can respond only after admin claims resolution
    if (grievance.status !== 'AWAITING_FARMER_CONFIRMATION') {
      return res.status(400).json({
        error: 'not_awaiting_confirmation',
        message: 'This grievance is not waiting for farmer confirmation.'
      });
    }

    const newStatus =
      confirmation === 'YES'
        ? 'VERIFIED_RESOLVED'
        : 'REOPENED';

    // Update grievance
    const result = await pool.query(
  `UPDATE grievances
   SET
     status = $1::varchar(20),
     farmer_confirmation = $2::varchar(10),
     farmer_feedback = $3::text,
     farmer_confirmed_at = NOW(),
     resolved_at = CASE
       WHEN $2::varchar(10) = 'YES'
         THEN NOW()
       ELSE NULL
     END
   WHERE grievance_id = $4::varchar(20)
   RETURNING *`,
  [
    newStatus,
    confirmation,
    feedback || null,
    grievanceId
  ]
);

    // Save audit history
    await pool.query(
      `INSERT INTO grievance_history
       (
         grievance_id,
         action,
         performed_by,
         previous_status,
         new_status,
         comment
       )
       VALUES
       (
         $1,
         $2,
         'FARMER',
         $3,
         $4,
         $5
       )`,
      [
        grievanceId,
        confirmation === 'YES'
          ? 'FARMER_CONFIRMED_RESOLUTION'
          : 'FARMER_REJECTED_RESOLUTION',
        grievance.status,
        newStatus,
        feedback || null
      ]
    );

    if (confirmation === 'NO') {
      createFarmerNotification(pool, {
        farmerId: grievance.farmer_id,
        type: NOTIFICATION_TYPES.GRIEVANCE_REOPENED,
        title: 'Grievance Reopened',
        message: `Your grievance #${grievanceId} has been reopened with your feedback: "${feedback || 'Reopened by farmer'}".`,
        priority: PRIORITIES.WARNING,
        actionRequired: false,
        actionUrl: '/farmer/grievance',
        grievanceId: grievanceId
      });
    }

    res.json({
      success: true,
      message:
        confirmation === 'YES'
          ? 'Grievance has been verified as resolved.'
          : 'Grievance has been reopened for further action.',
      grievance: result.rows[0]
    });

  } catch (err) {
    console.error('Farmer confirmation error:', err);

    res.status(500).json({
      error: 'server_error',
      message: 'Unable to process farmer confirmation.'
    });
  }
});


// ============================================
// DISTRICT OFFICER - GRIEVANCE DASHBOARD
// ============================================

app.get('/api/district/grievances', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    let targetDistrict = req.user.district ? req.user.district.trim() : null;
    if (req.query.district && req.query.district.trim().toLowerCase() !== targetDistrict?.toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: As a District Officer for ${req.user.district}, you cannot access grievances for ${req.query.district}.`
      });
    }

    const whereClause = targetDistrict ? 'JOIN centres c ON g.centre_id = c.centre_id WHERE c.district ILIKE $1' : '';
    const params = targetDistrict ? [targetDistrict.trim()] : [];

    // Overall grievance statistics
    const summary = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE g.status IN ('Open', 'OPEN', 'SUBMITTED')) AS open,
        COUNT(*) FILTER (WHERE g.status IN ('In Progress', 'IN_PROGRESS')) AS in_progress,
        COUNT(*) FILTER (WHERE g.status = 'AWAITING_FARMER_CONFIRMATION') AS awaiting_confirmation,
        COUNT(*) FILTER (WHERE g.status = 'VERIFIED_RESOLVED') AS verified_resolved,
        COUNT(*) FILTER (WHERE g.status = 'REOPENED') AS reopened,
        COUNT(*) FILTER (WHERE NOW() > g.sla_deadline AND g.status NOT IN ('VERIFIED_RESOLVED')) AS sla_breached
      FROM grievances g
      ${whereClause}
    `, params);

    // Centre-wise accountability
    const centreStats = await pool.query(`
      SELECT
        g.centre_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE g.status = 'VERIFIED_RESOLVED') AS verified_resolved,
        COUNT(*) FILTER (WHERE g.status = 'AWAITING_FARMER_CONFIRMATION') AS awaiting_confirmation,
        COUNT(*) FILTER (WHERE g.status = 'REOPENED') AS reopened,
        COUNT(*) FILTER (WHERE g.status IN ('Open', 'OPEN', 'SUBMITTED')) AS open,
        COUNT(*) FILTER (WHERE NOW() > g.sla_deadline AND g.status NOT IN ('VERIFIED_RESOLVED')) AS sla_breached
      FROM grievances g
      ${whereClause}
      GROUP BY g.centre_id
      ORDER BY reopened DESC, sla_breached DESC, total DESC
    `, params);

    // Recent grievances
    const recent = await pool.query(`
      SELECT
        g.grievance_id,
        g.farmer_id,
        g.centre_id,
        g.issue_type,
        g.status,
        g.created_at,
        g.sla_deadline,
        g.resolved_at,
        g.farmer_confirmation
      FROM grievances g
      ${whereClause}
      ORDER BY g.created_at DESC
      LIMIT 20
    `, params);

    res.json({
      success: true,
      district: targetDistrict || 'All',
      summary: summary.rows[0],
      centreStats: centreStats.rows,
      recent: recent.rows
    });
  } catch (err) {
    console.error('District grievance dashboard error:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load district grievance dashboard.'
    });
  }
});


// ==========================================
// DISTRICT OFFICER - CENTRE GRIEVANCE DETAILS
// ==========================================

app.get('/api/district/grievances/centre/:centreId', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const { centreId } = req.params;

    // Strict District Officer isolation: centre must belong to officer's district
    const c = await pool.query('SELECT district FROM centres WHERE centre_id = $1', [centreId]);
    if (c.rows.length === 0 || c.rows[0].district.toLowerCase() !== req.user.district.toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: Centre ${centreId} does not belong to your assigned district (${req.user.district}).`
      });
    }

    const result = await pool.query(
      `
      SELECT
        grievance_id,
        farmer_id,
        centre_id,
        issue_type,
        description,
        status,
        created_at,
        sla_deadline,
        resolved_at,
        resolution_notes,
        farmer_confirmation,
        farmer_feedback,
        farmer_confirmed_at,

        CASE
          WHEN status = 'VERIFIED_RESOLVED'
            THEN 'Verified Resolved'
          WHEN status = 'AWAITING_FARMER_CONFIRMATION'
            THEN 'Awaiting Farmer'
          WHEN status = 'REOPENED'
            THEN 'Reopened'
          WHEN NOW() > sla_deadline
            THEN 'SLA Breached'
          ELSE 'On Track'
        END AS accountability_status
      FROM grievances
      WHERE centre_id = $1
      ORDER BY created_at DESC
      `,
      [centreId]
    );

    res.json({
      success: true,
      centre_id: centreId,
      grievances: result.rows
    });

  } catch (err) {
    console.error('Get centre grievances error:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load centre grievances.'
    });
  }
});


// Get all officers
app.get('/api/officers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.officer_id,
        o.name,
        o.role,
        o.centre_id,
        c.centre_name,
        o.district,
        o.phone,
        o.email,
        o.is_active
      FROM officers o
      LEFT JOIN centres c
        ON o.centre_id = c.centre_id
      WHERE o.is_active = TRUE
      ORDER BY o.role, o.officer_id
    `);

    res.json({
      success: true,
      officers: result.rows
    });

  } catch (err) {
    console.error('Get officers error:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load officers.'
    });
  }
});


app.get('/api/officers/centre/:centreId', async (req, res) => {
  try {
    const { centreId } = req.params;

    const result = await pool.query(`
      SELECT
        o.officer_id,
        o.name,
        o.role,
        o.centre_id,
        c.centre_name,
        o.district,
        o.phone,
        o.email
      FROM officers o
      JOIN centres c
        ON o.centre_id = c.centre_id
      WHERE o.centre_id = $1
        AND o.role = 'DPC_OFFICER'
        AND o.is_active = TRUE
    `, [centreId]);

    res.json({
      success: true,
      centre_id: centreId,
      officers: result.rows
    });

  } catch (err) {
    console.error('Get centre officer error:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load centre officer.'
    });
  }
});


// District Officer - Centre Accountability (with strict District isolation)
app.get('/api/district/accountability', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    let targetDistrict = req.user.district ? req.user.district.trim() : null;
    if (req.query.district && req.query.district.trim().toLowerCase() !== targetDistrict?.toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: As a District Officer for ${req.user.district}, you cannot access accountability data for ${req.query.district}.`
      });
    }

    let query = `
      SELECT
        c.centre_id,
        c.centre_name,
        c.village_town,
        c.district,
        c.daily_capacity_slots,
        COALESCE(c.active_counters, 2) AS active_counters,
        o.officer_id,
        o.name AS officer_name,
        COUNT(g.grievance_id) AS total_grievances,
        COUNT(*) FILTER (WHERE g.status IN ('OPEN', 'SUBMITTED', 'Open')) AS open,
        COUNT(*) FILTER (WHERE g.status IN ('IN_PROGRESS', 'In Progress')) AS in_progress,
        COUNT(*) FILTER (WHERE g.status = 'AWAITING_FARMER_CONFIRMATION') AS awaiting_confirmation,
        COUNT(*) FILTER (WHERE g.status = 'VERIFIED_RESOLVED') AS verified_resolved,
        COUNT(*) FILTER (WHERE g.status = 'REOPENED') AS reopened,
        COUNT(*) FILTER (WHERE g.sla_deadline IS NOT NULL AND NOW() > g.sla_deadline AND g.status != 'VERIFIED_RESOLVED') AS sla_breached
      FROM centres c
      LEFT JOIN officers o ON o.centre_id = c.centre_id AND o.role = 'DPC_OFFICER' AND o.is_active = TRUE
      LEFT JOIN grievances g ON g.centre_id = c.centre_id
    `;

    const params = [];
    if (targetDistrict && targetDistrict.trim()) {
      params.push(targetDistrict.trim());
      query += ` WHERE c.district ILIKE $${params.length}`;
    }

    query += `
      GROUP BY c.centre_id, c.centre_name, c.village_town, c.district, c.daily_capacity_slots, c.active_counters, o.officer_id, o.name
      ORDER BY c.centre_id
    `;

    // If unauthenticated or no district specified, limit to 50
    if (!targetDistrict) {
      query += ' LIMIT 50';
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      district: targetDistrict || 'All (Limited)',
      centres: result.rows
    });

  } catch (err) {
    console.error('District accountability error:', err);
    res.status(500).json({
      error: 'server_error',
      message: 'Unable to load district accountability data.'
    });
  }
});

// =====================================================
// PHASE D: DISTRICT GIS COMMAND DASHBOARD & MAP API
// =====================================================
app.get('/api/district-officer/map', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    // 1. Strict District Authorization from Authenticated Token
    const assignedDistrict = req.user.district;
    if (!assignedDistrict) {
      return res.status(400).json({
        error: 'no_assigned_district',
        message: 'No district assigned to this District Officer account.'
      });
    }

    // 2. Strict Security: Reject if client attempts to query another district
    const requestedDistrict = req.query.districtId || req.query.district;
    if (requestedDistrict && requestedDistrict.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: You are assigned to district '${assignedDistrict}' and cannot view GIS data for '${requestedDistrict}'.`
      });
    }

    // 3. Query all procurement centres belonging to assigned district
    const centresResult = await pool.query(`
      SELECT 
        c.centre_id,
        c.centre_name,
        c.village_town,
        c.district,
        c.state,
        c.latitude,
        c.longitude,
        c.operational_status,
        c.daily_capacity_slots,
        COALESCE(c.active_counters, 2) AS active_counters,
        c.staff_availability,
        c.processing_rate_min,
        c.storage_capacity_mt,
        c.current_stock_mt,
        c.expected_arrivals_mt,
        c.predicted_stock_mt,
        c.predicted_overload_mt,
        c.risk_level,
        COUNT(b.booking_id) FILTER (WHERE b.status NOT IN ('Payment Completed', 'No-Show', 'Cancelled')) AS current_queue,
        COUNT(b.booking_id) AS total_today_bookings,
        COUNT(b.booking_id) FILTER (WHERE b.status IN ('Procured', 'Payment Completed')) AS completed_procurements,
        COUNT(b.booking_id) FILTER (WHERE b.status = 'No-Show') AS no_shows
      FROM centres c
      LEFT JOIN bookings b ON b.centre_id = c.centre_id AND b.booking_date = CURRENT_DATE
      WHERE c.district ILIKE $1
      GROUP BY c.centre_id
      ORDER BY c.centre_name ASC
    `, [assignedDistrict.trim()]);

    const centres = centresResult.rows;

    // District centroid fallback coordinates if some centres lack GPS
    const dLower = assignedDistrict.trim().toLowerCase();
    const centroid = DISTRICT_COORDINATES[dLower] || { lat: 10.8, lon: 79.1 };

    let totalQueue = 0;
    let totalWait = 0;
    let highCongestion = 0;
    let mediumCongestion = 0;
    let lowCongestion = 0;
    let openCentres = 0;
    let closedCentres = 0;

    const processedCentres = centres.map((c, index) => {
      const q = parseInt(c.current_queue) || 0;
      totalQueue += q;

      const dailyCapacity = Math.max(1, c.daily_capacity_slots || 40);
      const activeCounters = Math.max(1, Number(c.active_counters || 2));
      const processingRate = Number(c.processing_rate_min || 12);
      const utilization = Math.round((q / dailyCapacity) * 100);
      const estWait = Math.max(1, Math.round(((q + 1) * processingRate) / activeCounters));
      totalWait += estWait;

      const isOpen = (c.operational_status !== 'Closed');
      if (isOpen) openCentres++; else closedCentres++;

      // Congestion heuristic based on Phase C
      let congestionLevel = 'LOW';
      if (utilization >= 75 || estWait >= 45 || (c.risk_level && c.risk_level.toUpperCase() === 'HIGH')) {
        congestionLevel = 'HIGH';
        highCongestion++;
      } else if (utilization >= 40 || estWait >= 25 || (c.risk_level && c.risk_level.toUpperCase() === 'MEDIUM')) {
        congestionLevel = 'MEDIUM';
        mediumCongestion++;
      } else {
        lowCongestion++;
      }

      // Check GPS Coordinates
      const hasRealCoords = (c.latitude != null && c.longitude != null && !isNaN(Number(c.latitude)) && !isNaN(Number(c.longitude)));
      let lat = hasRealCoords ? Number(c.latitude) : null;
      let lng = hasRealCoords ? Number(c.longitude) : null;
      let isDemoCoords = false;

      // For centres without coordinates, generate a small deterministic offset near district centroid for GIS demo visibility
      if (!hasRealCoords) {
        isDemoCoords = true;
        lat = centroid.lat + (0.015 * Math.sin(index + 1));
        lng = centroid.lon + (0.015 * Math.cos(index + 1));
      }

      return {
        centre_id: c.centre_id,
        centre_name: c.centre_name,
        village_town: c.village_town,
        district: c.district,
        state: c.state || 'Tamil Nadu',
        latitude: lat,
        longitude: lng,
        has_real_coordinates: hasRealCoords,
        is_demo_coordinate: isDemoCoords,
        operational_status: c.operational_status || 'Open',
        current_queue: q,
        today_bookings: parseInt(c.total_today_bookings) || 0,
        completed_procurements: parseInt(c.completed_procurements) || 0,
        no_shows: parseInt(c.no_shows) || 0,
        daily_capacity: dailyCapacity,
        active_counters: activeCounters,
        utilization_percent: utilization,
        estimated_wait_minutes: estWait,
        congestion_level: congestionLevel,
        storage_capacity_mt: c.storage_capacity_mt != null ? Number(c.storage_capacity_mt) : null,
        current_stock_mt: c.current_stock_mt != null ? Number(c.current_stock_mt) : null,
        expected_arrivals_mt: c.expected_arrivals_mt != null ? Number(c.expected_arrivals_mt) : null,
        predicted_stock_mt: c.predicted_stock_mt != null ? Number(c.predicted_stock_mt) : null,
        predicted_overload_mt: c.predicted_overload_mt != null ? Number(c.predicted_overload_mt) : null,
        risk_level: c.risk_level || 'LOW',
        last_updated: new Date().toISOString(),
        _notice: isDemoCoords ? 'DEMO/SYNTHETIC COORDINATES' : undefined
      };
    });

    const avgWaitMin = centres.length > 0 ? Math.round(totalWait / centres.length) : 0;

    res.json({
      success: true,
      district: assignedDistrict,
      centroid: centroid,
      summary: {
        total_centres: centres.length,
        open_centres: openCentres,
        closed_centres: closedCentres,
        high_congestion: highCongestion,
        medium_congestion: mediumCongestion,
        low_congestion: lowCongestion,
        total_current_queue: totalQueue,
        avg_estimated_wait_minutes: avgWaitMin
      },
      centres: processedCentres,
      _notice: 'Congestion classifications and wait time forecasts are heuristic indicators (DEMO/SYNTHETIC).'
    });

  } catch (err) {
    console.error('District officer map error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load district GIS map data.' });
  }
});

// =====================================================
// PHASE D: SINGLE CENTRE DETAIL FOR DISTRICT OFFICER
// =====================================================
app.get('/api/district-officer/centres/:centreId', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const centreId = req.params.centreId;
    const assignedDistrict = req.user.district;

    const centreRes = await pool.query('SELECT * FROM centres WHERE centre_id = $1', [centreId]);
    if (centreRes.rows.length === 0) {
      return res.status(404).json({ error: 'centre_not_found', message: 'Procurement centre not found.' });
    }

    const centre = centreRes.rows[0];

    // Strict Security: Reject if centre belongs to another district
    if (centre.district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: Centre ${centreId} belongs to ${centre.district}, but you are assigned to ${assignedDistrict}.`
      });
    }

    // Live Queue
    const queueRes = await pool.query(`
      SELECT b.*, f.name AS farmer_name, f.phone AS farmer_phone
      FROM bookings b
      JOIN farmers f ON b.farmer_id = f.farmer_id
      WHERE b.centre_id = $1 AND b.status NOT IN ('Payment Completed', 'No-Show')
      ORDER BY b.booking_date, b.queue_position_at_booking
    `, [centreId]);

    // Grievances count
    const gRes = await pool.query(
      "SELECT count(*) as total, count(*) FILTER (WHERE status != 'VERIFIED_RESOLVED') as unresolved FROM grievances WHERE centre_id = $1",
      [centreId]
    );

    res.json({
      success: true,
      centre,
      queue: queueRes.rows,
      grievance_stats: {
        total: parseInt(gRes.rows[0].total) || 0,
        unresolved: parseInt(gRes.rows[0].unresolved) || 0
      }
    });

  } catch (err) {
    console.error('District centre details error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to retrieve centre details.' });
  }
});

// =====================================================
// DISTRICT OFFICER: CENTRES MANAGEMENT & SEARCH
// =====================================================
app.get('/api/district-officer/centres', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const assignedDistrict = req.user.district;
    if (!assignedDistrict) {
      return res.status(400).json({ error: 'no_district', message: 'No district assigned to this officer.' });
    }

    const requestedDistrict = req.query.district;
    if (requestedDistrict && requestedDistrict.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: You are assigned to district '${assignedDistrict}' and cannot query centres in '${requestedDistrict}'.`
      });
    }

    const { status, search, filter } = req.query;

    const centresResult = await pool.query(`
      SELECT 
        c.centre_id,
        c.centre_name,
        c.village_town,
        c.district,
        c.state,
        c.operational_status,
        c.daily_capacity_slots,
        COALESCE(c.active_counters, 2) AS active_counters,
        c.staff_availability,
        COALESCE(c.processing_rate_min, 12) AS processing_rate_min,
        COALESCE(c.storage_capacity_mt, 250) AS storage_capacity_mt,
        COALESCE(c.current_stock_mt, 0) AS current_stock_mt,
        c.expected_arrivals_mt,
        c.predicted_stock_mt,
        c.predicted_overload_mt,
        c.risk_level,
        c.opening_date,
        c.closing_date,
        c.latitude,
        c.longitude,
        COUNT(b.booking_id) FILTER (WHERE b.status NOT IN ('Payment Completed', 'No-Show', 'Cancelled')) AS current_queue,
        COUNT(b.booking_id) AS total_today_bookings,
        COUNT(b.booking_id) FILTER (WHERE b.status IN ('Procured', 'Payment Completed')) AS completed_procurements,
        COUNT(b.booking_id) FILTER (WHERE b.status = 'No-Show') AS no_shows
      FROM centres c
      LEFT JOIN bookings b ON b.centre_id = c.centre_id AND b.booking_date = CURRENT_DATE
      WHERE c.district ILIKE $1
      GROUP BY c.centre_id
      ORDER BY c.centre_name ASC
    `, [assignedDistrict.trim()]);

    let rows = centresResult.rows.map(c => {
      const q = parseInt(c.current_queue) || 0;
      const dailyCap = Math.max(1, c.daily_capacity_slots || 40);
      const activeCounters = Math.max(1, Number(c.active_counters || 2));
      const procRate = Number(c.processing_rate_min || 12);
      const estWait = Math.max(1, Math.round(((q + 1) * procRate) / activeCounters));
      const storageCap = Number(c.storage_capacity_mt || 250);
      const currentStock = Number(c.current_stock_mt || 0);
      const storageUsedPct = storageCap > 0 ? Math.min(100, Math.round((currentStock / storageCap) * 100)) : 0;
      const isPaused = (c.operational_status || '').toLowerCase() === 'paused';
      const isClosed = (c.operational_status || '').toLowerCase() === 'closed';
      const isOpen = !isClosed && !isPaused;

      const needsAttention = isPaused || (q >= dailyCap * 0.75) || (estWait >= 45) || ((c.risk_level || '').toUpperCase() === 'HIGH') || (storageUsedPct >= 85);

      return {
        centre_id: c.centre_id,
        centre_name: c.centre_name,
        village_town: c.village_town,
        district: c.district,
        state: c.state || 'Tamil Nadu',
        operational_status: c.operational_status || 'Open',
        status_category: isClosed ? 'Closed' : (isPaused ? 'Paused' : 'Open'),
        waiting_farmers: isClosed ? null : q,
        estimated_wait_minutes: isClosed ? null : estWait,
        processing_speed_min: isClosed ? null : procRate,
        processing_speed_label: isClosed ? null : `${procRate} min/farmer`,
        storage_capacity_mt: storageCap,
        current_stock_mt: currentStock,
        storage_used_pct: isClosed ? null : storageUsedPct,
        active_counters: isClosed ? null : activeCounters,
        daily_capacity: isClosed ? null : dailyCap,
        needs_attention: isPaused || (!isClosed && needsAttention),
        risk_level: c.risk_level || 'LOW',
        opening_date: c.opening_date,
        closing_date: c.closing_date,
        latitude: c.latitude,
        longitude: c.longitude
      };
    });

    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(r => r.centre_name.toLowerCase().includes(s) || r.centre_id.toLowerCase().includes(s) || (r.village_town && r.village_town.toLowerCase().includes(s)));
    }

    if (filter === 'attention') {
      rows = rows.filter(r => r.needs_attention);
    } else if (status && status !== 'ALL') {
      rows = rows.filter(r => r.status_category.toLowerCase() === status.toLowerCase());
    }

    res.json({
      success: true,
      district: assignedDistrict,
      total_centres: rows.length,
      centres: rows
    });
  } catch (err) {
    console.error('District officer centres list error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load district centres.' });
  }
});

// =====================================================
// DISTRICT OFFICER: OPEN / UPDATE CENTRE STATUS & AUDIT
// =====================================================
const handleDistrictCentreStatusChange = async (req, res) => {
  try {
    const centreId = req.params.centreId;
    const assignedDistrict = req.user.district;

    if (!assignedDistrict) {
      return res.status(403).json({ error: 'no_assigned_district', message: 'District Officer has no assigned district.' });
    }

    const cCheck = await pool.query('SELECT * FROM centres WHERE centre_id = $1', [centreId]);
    if (cCheck.rows.length === 0) {
      return res.status(404).json({ error: 'centre_not_found', message: `Centre ${centreId} not found.` });
    }

    const centre = cCheck.rows[0];

    // BACKEND RBAC ENFORCEMENT: Centre must belong to officer's district
    if (!centre.district || centre.district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: Centre ${centreId} is located in '${centre.district}', but your jurisdiction is '${assignedDistrict}'. You cannot alter centres outside your assigned district.`
      });
    }

    const newStatus = (req.body.status || 'Open').trim();
    const allowed = ['Open', 'Closed', 'Paused'];
    const matchedStatus = allowed.find(s => s.toLowerCase() === newStatus.toLowerCase());
    if (!matchedStatus) {
      return res.status(400).json({
        error: 'invalid_status',
        message: `Invalid centre status: '${newStatus}'. Allowed: ${allowed.join(', ')}`
      });
    }

    const reason = (req.body.reason || (matchedStatus === 'Open' ? 'Mandatory seasonal procurement opening by District Officer' : 'Operational adjustment')).trim();
    if (!reason) {
      return res.status(400).json({ error: 'missing_reason', message: 'A valid reason for changing centre status is required.' });
    }

    const notes = req.body.notes || req.body.note || null;
    const openingDate = req.body.opening_date || new Date().toISOString().slice(0, 10);
    const previousStatus = centre.operational_status || 'Unknown';

    // 1. Update centre operational_status and opening_date (and clear past closing_date)
    const isOpening = matchedStatus === 'Open';
    const updateRes = isOpening
      ? await pool.query(`
          UPDATE centres
          SET operational_status = $1,
              opening_date = COALESCE($2::date, CURRENT_DATE),
              closing_date = NULL
          WHERE centre_id = $3
          RETURNING *
        `, [matchedStatus, openingDate, centreId])
      : await pool.query(`
          UPDATE centres
          SET operational_status = $1
          WHERE centre_id = $2
          RETURNING *
        `, [matchedStatus, centreId]);

    const updatedCentre = updateRes.rows[0];

    // 2. If opening centre, automatically activate and ensure slots for the 7-day booking window
    let activatedSlotsCount = 0;
    if (isOpening) {
      const { todayStr } = getKolkataNow();
      const createdSlots = await ensureCentreSlots(pool, centreId, todayStr, 7);
      activatedSlotsCount = createdSlots.length;
      console.log(`[CENTRE SLOTS ACTIVATED] Generated/ensured ${activatedSlotsCount} upcoming slots across 7-day window for newly opened centre ${centreId}.`);
    }

    // 3. Record in centre_status_history audit table
    await pool.query(`
      INSERT INTO centre_status_history (centre_id, previous_status, new_status, changed_by, changed_at, reason, notes, opening_date)
      VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7::date)
    `, [centreId, previousStatus, matchedStatus, req.user.username, reason, notes, openingDate]);

    console.log(`[CENTRE STATUS AUDIT] Centre ${centreId} (${updatedCentre.centre_name}) status changed ${previousStatus} -> ${matchedStatus} by ${req.user.username} in district ${assignedDistrict}. Reason: ${reason}`);

    res.json({
      success: true,
      message: matchedStatus === 'Open'
        ? `Centre opened successfully. ${activatedSlotsCount > 0 ? `${activatedSlotsCount} procurement slots activated.` : 'Procurement slots are active and ready for farmer bookings.'}`
        : `Centre status updated to ${matchedStatus} successfully.`,
      centre: updatedCentre,
      slots_activated: activatedSlotsCount,
      audit: {
        centre_id: centreId,
        previous_status: previousStatus,
        new_status: matchedStatus,
        changed_by: req.user.username,
        reason,
        notes,
        opening_date: openingDate,
        changed_at: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Centre status update error:', err);
    res.status(500).json({ error: 'server_error', message: err.message || 'Unable to update centre status.' });
  }
};

app.post('/api/district-officer/centres/:centreId/open', authenticateToken, requireRole('DISTRICT_OFFICER'), handleDistrictCentreStatusChange);
app.patch('/api/district-officer/centres/:centreId/status', authenticateToken, requireRole('DISTRICT_OFFICER'), handleDistrictCentreStatusChange);
app.post('/api/district-officer/centres/:centreId/status', authenticateToken, requireRole('DISTRICT_OFFICER'), handleDistrictCentreStatusChange);

// GET /api/district-officer/centres/:centreId/audit
app.get('/api/district-officer/centres/:centreId/audit', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const centreId = req.params.centreId;
    const assignedDistrict = req.user.district;

    const cCheck = await pool.query('SELECT district, centre_name FROM centres WHERE centre_id = $1', [centreId]);
    if (cCheck.rows.length === 0) {
      return res.status(404).json({ error: 'centre_not_found', message: 'Centre not found.' });
    }
    if (cCheck.rows[0].district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: Cannot view audit for centres outside your district.' });
    }

    const historyRes = await pool.query(`
      SELECT * FROM centre_status_history
      WHERE centre_id = $1
      ORDER BY changed_at DESC
      LIMIT 50
    `, [centreId]);

    res.json({
      success: true,
      centre_id: centreId,
      centre_name: cCheck.rows[0].centre_name,
      history: historyRes.rows
    });
  } catch (err) {
    console.error('Centre audit fetch error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to retrieve status audit.' });
  }
});

// =====================================================
// DISTRICT OFFICER: LIVE QUEUE & ACTIONS
// =====================================================
app.get('/api/district-officer/queue', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const assignedDistrict = req.user.district;
    if (!assignedDistrict) {
      return res.status(400).json({ error: 'no_district', message: 'No district assigned to this officer.' });
    }

    const { search, status, centre_id, date, page = 1, pageSize = 20 } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(pageSize) || 20));
    const offset = Math.max(0, (parseInt(page) || 1) - 1) * limit;

    let query = `
      SELECT 
        b.booking_id,
        b.token,
        b.queue_position_at_booking,
        b.booking_date,
        b.crop,
        b.quantity_quintals,
        b.status,
        b.grading_result,
        b.procured_quantity_quintals,
        b.msp_rate_inr,
        b.payment_amount_inr,
        b.payment_status,
        b.estimated_wait_minutes,
        b.reschedule_count,
        b.disruption_count,
        b.pacing_status,
        b.recommended_delay_minutes,
        b.created_at,
        c.centre_id,
        c.centre_name,
        c.district,
        f.farmer_id,
        f.name AS farmer_name,
        f.phone AS farmer_phone,
        s.start_time,
        s.end_time
      FROM bookings b
      JOIN centres c ON b.centre_id = c.centre_id
      JOIN farmers f ON b.farmer_id = f.farmer_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE c.district ILIKE $1
    `;
    const params = [assignedDistrict.trim()];

    if (status && status !== 'ALL') {
      params.push(status);
      query += ` AND b.status = $${params.length}`;
    }

    if (centre_id && centre_id !== 'ALL') {
      params.push(centre_id);
      query += ` AND b.centre_id = $${params.length}`;
    }

    if (date && date.trim()) {
      params.push(date.trim());
      query += ` AND b.booking_date = $${params.length}::date`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND (f.name ILIKE $${params.length} OR b.token ILIKE $${params.length} OR b.booking_id ILIKE $${params.length} OR c.centre_name ILIKE $${params.length})`;
    }

    const countRes = await pool.query(`SELECT COUNT(*) FROM (${query}) AS q`, params);
    const totalCount = parseInt(countRes.rows[0].count) || 0;

    query += ` ORDER BY b.booking_date DESC, b.queue_position_at_booking ASC, b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const itemsRes = await pool.query(query, params);

    const items = itemsRes.rows.map(b => {
      const resched = Number(b.reschedule_count || 0);
      const disrupt = Number(b.disruption_count || 0);
      let protection = 'Standard';
      if (resched >= 2 || disrupt >= 2) {
        protection = 'High Protection';
      } else if (resched === 1 || disrupt === 1) {
        protection = 'Protected';
      }

      return {
        booking_id: b.booking_id,
        token: b.token || `#${b.queue_position_at_booking || b.booking_id.slice(-4)}`,
        queue_position: b.queue_position_at_booking || 1,
        farmer_id: b.farmer_id,
        farmer_name: b.farmer_name,
        farmer_phone: b.farmer_phone,
        centre_id: b.centre_id,
        centre_name: b.centre_name,
        district: b.district,
        booking_date: b.booking_date ? normalizeDateStr(b.booking_date) : '',
        slot_time: b.start_time && b.end_time ? `${b.start_time.slice(0, 5)} - ${b.end_time.slice(0, 5)}` : '09:00 - 10:00',
        crop: b.crop || 'Paddy (Grade A)',
        quantity_quintals: Number(b.quantity_quintals || 0),
        status: b.status,
        grading_result: b.grading_result,
        procured_quantity: Number(b.procured_quantity_quintals || 0),
        msp_rate: Number(b.msp_rate_inr || 2320),
        payment_amount: Number(b.payment_amount_inr || 0),
        payment_status: b.payment_status || 'PENDING',
        estimated_wait_minutes: Number(b.estimated_wait_minutes || 0),
        protection,
        reschedule_count: resched,
        disruption_count: disrupt,
        pacing_status: b.pacing_status || 'NORMAL',
        recommended_delay_minutes: Number(b.recommended_delay_minutes || 0),
        created_at: b.created_at
      };
    });

    res.json({
      success: true,
      district: assignedDistrict,
      total: totalCount,
      page: parseInt(page) || 1,
      pageSize: limit,
      totalPages: Math.ceil(totalCount / limit),
      items
    });

  } catch (err) {
    console.error('District officer queue error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to retrieve district queue.' });
  }
});

// =====================================================
// PHASE 7.3: DIGITAL PROCUREMENT RECORD & END-TO-END PROCUREMENT TRANSPARENCY
// =====================================================

// Helper to generate non-guessable digital procurement receipt number
function generateReceiptNumber() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `PROC-2026-${rand}`;
}

// 1. GET /api/bookings/:id/procurement-record
app.get('/api/bookings/:id/procurement-record', authenticateToken, async (req, res) => {
  try {
    const bookingId = req.params.id;

    // Fetch booking with farmer, centre, and slot details
    const bRes = await pool.query(`
      SELECT 
        b.*,
        f.name AS farmer_name,
        f.phone AS farmer_phone,
        f.village AS farmer_village,
        f.district AS farmer_district,
        c.centre_name,
        c.village_town AS centre_village,
        c.district AS centre_district,
        s.date AS slot_date,
        s.start_time AS slot_start_time,
        s.end_time AS slot_end_time
      FROM bookings b
      LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.booking_id = $1
    `, [bookingId]);

    if (bRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }

    const booking = bRes.rows[0];

    // Role & IDOR Authorization
    if (req.user.role === 'FARMER') {
      if (req.user.farmerId && req.user.farmerId !== booking.farmer_id) {
        return res.status(403).json({
          error: 'farmer_access_denied',
          message: 'Forbidden: You can only access your own procurement records.'
        });
      }
    } else if (req.user.role === 'CENTRE_ADMIN') {
      if (req.user.centreId && req.user.centreId !== booking.centre_id) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: Booking belongs to centre ${booking.centre_id}, not your assigned centre (${req.user.centreId}).`
        });
      }
    } else if (req.user.role === 'DISTRICT_OFFICER') {
      if (req.user.district && booking.centre_district && req.user.district.trim().toLowerCase() !== booking.centre_district.trim().toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: Centre belongs to ${booking.centre_district}, outside your assigned district (${req.user.district}).`
        });
      }
    } else if (req.user.role === 'CSC_OPERATOR') {
      const uDist = (req.user.district || '').trim().toLowerCase();
      const fDist = (booking.farmer_district || '').trim().toLowerCase();
      const cDist = (booking.centre_district || '').trim().toLowerCase();
      if (uDist && uDist !== fDist && uDist !== cDist) {
        return res.status(403).json({
          error: 'csc_district_access_denied',
          message: `Forbidden: Record is outside your assigned CSC district (${req.user.district}).`
        });
      }
    }

    // Query all procurement sub-records
    const [qRes, wRes, aRes, rRes, pRes, hRes, gRes, auditRes] = await Promise.all([
      pool.query('SELECT * FROM procurement_quality WHERE booking_id = $1', [bookingId]),
      pool.query('SELECT * FROM procurement_weighments WHERE booking_id = $1', [bookingId]),
      pool.query('SELECT * FROM procurement_acceptances WHERE booking_id = $1', [bookingId]),
      pool.query('SELECT * FROM procurement_receipts WHERE booking_id = $1', [bookingId]),
      pool.query('SELECT * FROM procurement_payments WHERE booking_id = $1', [bookingId]),
      pool.query('SELECT * FROM status_history WHERE booking_id = $1 ORDER BY changed_at ASC', [bookingId]),
      pool.query('SELECT * FROM grievances WHERE booking_id = $1 ORDER BY created_at DESC', [bookingId]),
      pool.query('SELECT * FROM procurement_audit_logs WHERE booking_id = $1 ORDER BY performed_at DESC', [bookingId])
    ]);

    const quality = qRes.rows[0] || null;
    const weighment = wRes.rows[0] || null;
    const acceptance = aRes.rows[0] || null;
    const receipt = rRes.rows[0] || null;
    const payment = pRes.rows[0] || null;
    const history = hRes.rows;
    const grievances = gRes.rows;
    const auditLogs = auditRes.rows;

    // Build chronological, auditable 10-stage timeline
    const findHistoryTime = (st) => {
      const item = history.find(h => h.status === st);
      return item ? item.changed_at : null;
    };

    const timeline = [
      {
        stage: 1,
        key: 'SLOT_CONFIRMED',
        label: 'Slot Confirmed',
        status: booking.status ? 'COMPLETED' : 'PENDING',
        timestamp: booking.created_at || findHistoryTime('Confirmed') || findHistoryTime('Booked'),
        details: `Token #${booking.queue_position_at_booking} (${booking.token || 'Allocated'}) for ${booking.crop}`
      },
      {
        stage: 2,
        key: 'ON_THE_WAY',
        label: "I'm On My Way",
        status: (findHistoryTime('On The Way') || ['On The Way','Checked-In','Grading','Weighing','Procured','Payment Pending','Payment Completed'].includes(booking.status)) ? 'COMPLETED' : 'PENDING',
        timestamp: findHistoryTime('On The Way'),
        details: 'Transit notified to procurement centre gate'
      },
      {
        stage: 3,
        key: 'ARRIVED_AT_CENTRE',
        label: 'Arrived at Centre',
        status: (findHistoryTime('Checked-In') || ['Checked-In','Grading','Weighing','Procured','Payment Pending','Payment Completed'].includes(booking.status)) ? 'COMPLETED' : 'PENDING',
        timestamp: findHistoryTime('Checked-In'),
        details: 'Physical check-in verified at procurement centre'
      },
      {
        stage: 4,
        key: 'TOKEN_CALLED',
        label: 'Token Called',
        status: (['Grading','Weighing','Procured','Payment Pending','Payment Completed'].includes(booking.status)) ? 'COMPLETED' : 'PENDING',
        timestamp: findHistoryTime('Grading') || findHistoryTime('Checked-In'),
        details: `Called to unloading bay (Active Counter / Lane)`
      },
      {
        stage: 5,
        key: 'QUALITY_INSPECTION',
        label: 'Quality Inspection',
        status: quality ? 'COMPLETED' : (['Grading','Weighing','Procured','Payment Pending','Payment Completed'].includes(booking.status) ? 'IN_PROGRESS' : 'PENDING'),
        timestamp: quality ? quality.assessed_at : findHistoryTime('Grading'),
        details: quality ? `Grade: ${quality.grade}${quality.moisture_percentage ? ` • Moisture: ${quality.moisture_percentage}%` : ''}` : 'Moisture & grain analysis pending'
      },
      {
        stage: 6,
        key: 'WEIGHMENT',
        label: 'Gross & Tare Weighment',
        status: weighment ? 'COMPLETED' : (['Weighing','Procured','Payment Pending','Payment Completed'].includes(booking.status) ? 'IN_PROGRESS' : 'PENDING'),
        timestamp: weighment ? weighment.recorded_at : findHistoryTime('Weighing'),
        details: weighment ? `Gross: ${weighment.gross_weight_kg} kg • Tare: ${weighment.tare_weight_kg} kg • Net: ${weighment.net_weight_kg} kg` : 'Tare & net quantity recorded'
      },
      {
        stage: 7,
        key: 'PROCUREMENT_ACCEPTED',
        label: 'Procurement Accepted',
        status: acceptance ? 'COMPLETED' : (['Procured','Payment Pending','Payment Completed'].includes(booking.status) ? 'COMPLETED' : 'PENDING'),
        timestamp: acceptance ? acceptance.accepted_at : findHistoryTime('Procured'),
        details: acceptance ? `Accepted: ${acceptance.accepted_quantity_quintals} quintals (${acceptance.acceptance_status})` : 'Procurement decision pending'
      },
      {
        stage: 8,
        key: 'RECEIPT_GENERATED',
        label: 'Digital Receipt Generated',
        status: receipt ? 'COMPLETED' : 'PENDING',
        timestamp: receipt ? receipt.created_at : null,
        details: receipt ? `Receipt #${receipt.receipt_number}` : 'Receipt voucher generation upon acceptance'
      },
      {
        stage: 9,
        key: 'PAYMENT_PROCESSING',
        label: 'Payment Processing',
        status: payment ? (['PROCESSING','COMPLETED'].includes(payment.payment_status) ? 'COMPLETED' : 'IN_PROGRESS') : (['Payment Pending','Payment Completed'].includes(booking.status) ? 'IN_PROGRESS' : 'PENDING'),
        timestamp: payment ? payment.initiated_at : findHistoryTime('Payment Pending'),
        details: payment ? `Gross ₹${payment.gross_payable_inr} • Net ₹${payment.net_payable_inr} (${payment.payment_status})` : 'Awaiting procurement acceptance'
      },
      {
        stage: 10,
        key: 'PAYMENT_COMPLETED',
        label: 'Payment Completed',
        status: (payment?.payment_status === 'COMPLETED' || booking.status === 'Payment Completed') ? 'COMPLETED' : 'PENDING',
        timestamp: payment ? payment.completed_at : findHistoryTime('Payment Completed'),
        details: (payment?.payment_status === 'COMPLETED' || booking.status === 'Payment Completed') 
          ? `Settled via ${payment?.payment_method || 'DBT'} • Ref: ${payment?.transaction_reference || 'SIM_TXN_' + booking.booking_id}` 
          : 'Direct benefit transfer pending completion'
      }
    ];

    const formattedQuality = quality ? {
      ...quality,
      moisture_pct: quality.moisture_percentage,
      foreign_matter_pct: quality.foreign_matter_percentage
    } : null;

    const totalPayout = payment ? payment.net_payable_inr : (booking.payment_amount_inr || 0);
    const receiptHash = receipt ? crypto.createHash('sha256').update(`${receipt.receipt_number}-${bookingId}-${receipt.accepted_quantity_quintals}-${totalPayout}`).digest('hex') : null;

    const formattedReceipt = receipt ? {
      ...receipt,
      total_amount_inr: totalPayout,
      applicable_rate_inr: payment ? payment.applicable_rate_inr : (booking.msp_rate_inr || 2300),
      receipt_hash: receiptHash
    } : null;

    const recordPayload = {
      booking: {
        booking_id: booking.booking_id,
        token: booking.token,
        queue_position: booking.queue_position_at_booking,
        status: booking.status,
        crop: booking.crop,
        declared_quantity_quintals: booking.quantity_quintals,
        procured_quantity_quintals: booking.procured_quantity_quintals,
        booking_date: booking.booking_date,
        slot_time: booking.slot_start_time ? `${booking.slot_start_time} - ${booking.slot_end_time}` : 'Scheduled Slot',
        created_at: booking.created_at
      },
      farmer: {
        farmer_id: booking.farmer_id,
        name: booking.farmer_name,
        phone: booking.farmer_phone,
        village: booking.farmer_village,
        district: booking.farmer_district
      },
      centre: {
        centre_id: booking.centre_id,
        name: booking.centre_name,
        village: booking.centre_village,
        district: booking.centre_district
      },
      quality_assessment: formattedQuality,
      quality: formattedQuality,
      weighment: weighment,
      procurement_acceptance: acceptance,
      acceptance: acceptance,
      receipt: formattedReceipt,
      payment: payment,
      timeline: timeline,
      grievances: grievances,
      disputes: grievances,
      audit_logs: auditLogs,
      _notice: 'Procurement metrics and DBT transfers are operational and simulated demo models where official live telemetric feeds are not integrated.'
    };

    res.json({
      success: true,
      procurement_record: recordPayload,
      record: recordPayload
    });

  } catch (err) {
    console.error('Get procurement record error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load procurement record.' });
  }
});


// 2. POST /api/bookings/:id/quality
app.post('/api/bookings/:id/quality', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const bookingId = req.params.id;
    const {
      grade,
      moisture_percentage,
      foreign_matter_percentage,
      damaged_grain_percentage,
      remarks,
      quality_status = 'ASSESSED'
    } = req.body;

    if (!grade || typeof grade !== 'string') {
      return res.status(400).json({ error: 'missing_grade', message: 'Quality assessment grade is required.' });
    }

    // Verify booking and centre isolation
    const bRes = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }
    const booking = bRes.rows[0];

    if (req.user.centreId && req.user.centreId !== booking.centre_id) {
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: Booking belongs to centre ${booking.centre_id}, not your assigned centre (${req.user.centreId}).`
      });
    }

    if (['No-Show'].includes(booking.status)) {
      return res.status(400).json({ error: 'invalid_status', message: 'Cannot assess quality for No-Show booking.' });
    }

    const mVal = moisture_percentage !== undefined && moisture_percentage !== '' ? parseFloat(moisture_percentage) : null;
    const fVal = foreign_matter_percentage !== undefined && foreign_matter_percentage !== '' ? parseFloat(foreign_matter_percentage) : null;
    const dVal = damaged_grain_percentage !== undefined && damaged_grain_percentage !== '' ? parseFloat(damaged_grain_percentage) : null;

    // Check if quality record already exists
    const existingQ = await pool.query('SELECT * FROM procurement_quality WHERE booking_id = $1', [bookingId]);

    let qualityRecord;
    if (existingQ.rows.length > 0) {
      const prev = existingQ.rows[0];
      const uRes = await pool.query(`
        UPDATE procurement_quality
        SET grade = $1,
            moisture_percentage = $2,
            foreign_matter_percentage = $3,
            damaged_grain_percentage = $4,
            remarks = $5,
            quality_status = $6,
            assessed_by = $7,
            assessed_at = NOW(),
            updated_at = NOW()
        WHERE booking_id = $8
        RETURNING *
      `, [grade, mVal, fVal, dVal, remarks || null, quality_status, req.user.username || 'Centre Admin', bookingId]);
      qualityRecord = uRes.rows[0];

      // Audit correction
      await pool.query(`
        INSERT INTO procurement_audit_logs (booking_id, entity_type, action, previous_value, new_value, reason, performed_by)
        VALUES ($1, 'QUALITY', 'UPDATE', $2, $3, $4, $5)
      `, [bookingId, JSON.stringify(prev), JSON.stringify(qualityRecord), remarks || 'Quality assessment updated', req.user.username || 'Centre Admin']);
    } else {
      const qualityId = `QA-${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      const iRes = await pool.query(`
        INSERT INTO procurement_quality (
          quality_id, booking_id, quality_status, grade,
          moisture_percentage, foreign_matter_percentage, damaged_grain_percentage,
          remarks, assessed_by, assessed_at, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'CENTRE_ADMIN_MANUAL')
        RETURNING *
      `, [qualityId, bookingId, quality_status, grade, mVal, fVal, dVal, remarks || null, req.user.username || 'Centre Admin']);
      qualityRecord = iRes.rows[0];

      await pool.query(`
        INSERT INTO procurement_audit_logs (booking_id, entity_type, action, previous_value, new_value, reason, performed_by)
        VALUES ($1, 'QUALITY', 'CREATE', NULL, $2, 'Initial quality assessment recorded', $3)
      `, [bookingId, JSON.stringify(qualityRecord), req.user.username || 'Centre Admin']);
    }

    // Sync booking grading_result and advance status to Grading if Checked-In
    const newStatus = booking.status === 'Checked-In' ? 'Grading' : booking.status;
    await pool.query(`
      UPDATE bookings 
      SET grading_result = $1,
          status = $2
      WHERE booking_id = $3
    `, [grade, newStatus, bookingId]);

    if (newStatus !== booking.status) {
      await pool.query(`
        INSERT INTO status_history (booking_id, centre_id, status)
        VALUES ($1, $2, $3)
      `, [bookingId, booking.centre_id, newStatus]);
    }

    if (booking.farmer_id) {
      createFarmerNotification(pool, {
        farmer_id: booking.farmer_id,
        type: NOTIFICATION_TYPES.PROCUREMENT_QUALITY,
        title: 'Quality Assessment Recorded',
        message: `Quality assessment completed for booking #${bookingId}. Grade: ${grade}.`,
        link: '/farmer/status',
        entity_type: 'BOOKING',
        entity_id: bookingId,
        action_required: false
      }).catch(e => console.error('Failed to create quality notification:', e));
    }

    res.json({
      success: true,
      message: 'Quality assessment recorded successfully.',
      quality: qualityRecord,
      booking_status: newStatus
    });

  } catch (err) {
    console.error('Record quality error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to record quality assessment.' });
  }
});


// 3. GET /api/bookings/:id/quality
app.get('/api/bookings/:id/quality', authenticateToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const bRes = await pool.query('SELECT b.*, c.district AS centre_district FROM bookings b LEFT JOIN centres c ON b.centre_id = c.centre_id WHERE b.booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    const booking = bRes.rows[0];

    // IDOR verification
    if (req.user.role === 'FARMER' && req.user.farmerId && req.user.farmerId !== booking.farmer_id) {
      return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'CENTRE_ADMIN' && req.user.centreId && req.user.centreId !== booking.centre_id) {
      return res.status(403).json({ error: 'centre_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'DISTRICT_OFFICER' && req.user.district && booking.centre_district && req.user.district.trim().toLowerCase() !== booking.centre_district.trim().toLowerCase()) {
      return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: Access denied.' });
    }

    const qRes = await pool.query('SELECT * FROM procurement_quality WHERE booking_id = $1', [bookingId]);
    res.json({ success: true, quality: qRes.rows[0] || null });
  } catch (err) {
    console.error('Get quality error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load quality details.' });
  }
});


// 4. POST /api/bookings/:id/weighment
app.post('/api/bookings/:id/weighment', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const bookingId = req.params.id;

    // Verify booking & centre isolation FIRST (authoritative security boundary)
    const bRes = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }
    const booking = bRes.rows[0];

    const adminCentre = req.user.centreId || req.user.centre_id;
    if (adminCentre && adminCentre !== booking.centre_id) {
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: Booking belongs to centre ${booking.centre_id}, not your assigned centre (${adminCentre}).`
      });
    }

    if (['No-Show'].includes(booking.status)) {
      return res.status(400).json({ error: 'invalid_status', message: 'Cannot record weighment for No-Show booking.' });
    }

    const {
      gross_weight_kg,
      tare_weight_kg,
      net_weight_kg: clientNet,
      weighing_method = 'ELECTRONIC_WEIGHBRIDGE',
      weighment_reference
    } = req.body;

    const gross = parseFloat(gross_weight_kg);
    const tare = parseFloat(tare_weight_kg);

    if (isNaN(gross) || isNaN(tare) || gross <= 0 || tare < 0) {
      return res.status(400).json({
        error: 'invalid_weight_values',
        message: 'Gross weight must be a positive number and tare weight must be non-negative.'
      });
    }

    // Backend Math & Integrity Validation: Gross MUST be strictly greater than Tare
    if (gross <= tare) {
      return res.status(400).json({
        error: 'invalid_weight',
        message: 'Gross weight must be strictly greater than tare weight.'
      });
    }

    const calculatedNet = parseFloat((gross - tare).toFixed(2));

    // If client supplied net weight, verify it matches
    if (clientNet !== undefined && clientNet !== null && clientNet !== '') {
      const cNet = parseFloat(clientNet);
      if (Math.abs(cNet - calculatedNet) > 0.05) {
        return res.status(400).json({
          error: 'net_weight_mismatch',
          message: `Supplied net weight (${cNet} kg) does not match calculated Net Weight = Gross (${gross} kg) - Tare (${tare} kg) = ${calculatedNet} kg.`
        });
      }
    }

    const ref = weighment_reference || `WT-SCALE-${booking.centre_id}-${Date.now().toString().slice(-6)}`;

    // Check existing weighment
    const existingW = await pool.query('SELECT * FROM procurement_weighments WHERE booking_id = $1', [bookingId]);

    let weighmentRecord;
    if (existingW.rows.length > 0) {
      const prev = existingW.rows[0];
      const uRes = await pool.query(`
        UPDATE procurement_weighments
        SET gross_weight_kg = $1,
            tare_weight_kg = $2,
            net_weight_kg = $3,
            weighing_method = $4,
            weighment_reference = $5,
            recorded_by = $6,
            recorded_at = NOW(),
            updated_at = NOW()
        WHERE booking_id = $7
        RETURNING *
      `, [gross, tare, calculatedNet, weighing_method, ref, req.user.username || 'Centre Admin', bookingId]);
      weighmentRecord = uRes.rows[0];

      // Audit correction
      await pool.query(`
        INSERT INTO procurement_audit_logs (booking_id, entity_type, action, previous_value, new_value, reason, performed_by)
        VALUES ($1, 'WEIGHMENT', 'CORRECTION', $2, $3, 'Scale reading corrected after verification', $4)
      `, [bookingId, JSON.stringify(prev), JSON.stringify(weighmentRecord), req.user.username || 'Centre Admin']);
    } else {
      const weighmentId = `WT-${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      const iRes = await pool.query(`
        INSERT INTO procurement_weighments (
          weighment_id, booking_id, gross_weight_kg, tare_weight_kg, net_weight_kg,
          weighing_method, weighment_reference, recorded_by, recorded_at, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'CENTRE_ADMIN_MANUAL')
        RETURNING *
      `, [weighmentId, bookingId, gross, tare, calculatedNet, weighing_method, ref, req.user.username || 'Centre Admin']);
      weighmentRecord = iRes.rows[0];

      await pool.query(`
        INSERT INTO procurement_audit_logs (booking_id, entity_type, action, previous_value, new_value, reason, performed_by)
        VALUES ($1, 'WEIGHMENT', 'CREATE', NULL, $2, 'Weighment recorded successfully', $3)
      `, [bookingId, JSON.stringify(weighmentRecord), req.user.username || 'Centre Admin']);
    }

    // Sync booking procured quantity (convert kg to quintals: 1 quintal = 100 kg)
    const netQuintals = parseFloat((calculatedNet / 100).toFixed(2));
    const newStatus = ['Checked-In', 'Grading'].includes(booking.status) ? 'Weighing' : booking.status;

    await pool.query(`
      UPDATE bookings
      SET procured_quantity_quintals = $1,
          status = $2
      WHERE booking_id = $3
    `, [netQuintals, newStatus, bookingId]);

    if (newStatus !== booking.status) {
      await pool.query(`
        INSERT INTO status_history (booking_id, centre_id, status)
        VALUES ($1, $2, $3)
      `, [bookingId, booking.centre_id, newStatus]);
    }

    if (booking.farmer_id) {
      createFarmerNotification(pool, {
        farmer_id: booking.farmer_id,
        type: NOTIFICATION_TYPES.PROCUREMENT_WEIGHMENT,
        title: 'Weighment Recorded',
        message: `Weighment recorded for booking #${bookingId}: Gross ${gross} kg, Tare ${tare} kg, Net ${calculatedNet} kg (${netQuintals} quintals).`,
        link: '/farmer/status',
        entity_type: 'BOOKING',
        entity_id: bookingId,
        action_required: false
      }).catch(e => console.error('Failed to create weighment notification:', e));
    }

    res.json({
      success: true,
      message: 'Weighment recorded successfully.',
      weighment: weighmentRecord,
      net_weight_kg: calculatedNet,
      net_quantity_quintals: netQuintals,
      booking_status: newStatus
    });

  } catch (err) {
    console.error('Record weighment error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to record weighment.' });
  }
});


// 5. GET /api/bookings/:id/weighment
app.get('/api/bookings/:id/weighment', authenticateToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const bRes = await pool.query('SELECT b.*, c.district AS centre_district FROM bookings b LEFT JOIN centres c ON b.centre_id = c.centre_id WHERE b.booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    const booking = bRes.rows[0];

    // IDOR verification
    if (req.user.role === 'FARMER' && req.user.farmerId && req.user.farmerId !== booking.farmer_id) {
      return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'CENTRE_ADMIN' && req.user.centreId && req.user.centreId !== booking.centre_id) {
      return res.status(403).json({ error: 'centre_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'DISTRICT_OFFICER' && req.user.district && booking.centre_district && req.user.district.trim().toLowerCase() !== booking.centre_district.trim().toLowerCase()) {
      return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: Access denied.' });
    }

    const wRes = await pool.query('SELECT * FROM procurement_weighments WHERE booking_id = $1', [bookingId]);
    res.json({ success: true, weighment: wRes.rows[0] || null });
  } catch (err) {
    console.error('Get weighment error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load weighment details.' });
  }
});


// 6. POST /api/bookings/:id/procurement-acceptance
app.post('/api/bookings/:id/procurement-acceptance', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const bookingId = req.params.id;
    const {
      accepted_quantity_quintals,
      rejected_quantity_quintals = 0,
      acceptance_status = 'ACCEPTED',
      reason
    } = req.body;

    // Verify booking & centre isolation
    const bRes = await client.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }
    const booking = bRes.rows[0];

    if (req.user.centreId && req.user.centreId !== booking.centre_id) {
      client.release();
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: Booking belongs to centre ${booking.centre_id}, not your assigned centre (${req.user.centreId}).`
      });
    }

    if (['No-Show'].includes(booking.status)) {
      client.release();
      return res.status(400).json({ error: 'invalid_status', message: 'Cannot accept procurement for No-Show booking.' });
    }

    if (['Procured', 'Payment Pending', 'Payment Completed'].includes(booking.status)) {
      client.release();
      return res.status(400).json({ error: 'already_procured', message: 'Procurement has already been accepted for this booking.' });
    }

    // Check weighment and quality
    const wRes = await client.query('SELECT * FROM procurement_weighments WHERE booking_id = $1', [bookingId]);
    const qRes = await client.query('SELECT * FROM procurement_quality WHERE booking_id = $1', [bookingId]);
    const weighment = wRes.rows[0] || null;
    const quality = qRes.rows[0] || null;

    // Determine accepted quantity (default to weighment net or declared)
    let finalAccepted = accepted_quantity_quintals !== undefined && accepted_quantity_quintals !== '' 
      ? parseFloat(accepted_quantity_quintals) 
      : (weighment ? parseFloat((weighment.net_weight_kg / 100).toFixed(2)) : parseFloat(booking.quantity_quintals || 0));

    if (isNaN(finalAccepted) || finalAccepted < 0) {
      client.release();
      return res.status(400).json({ error: 'invalid_quantity', message: 'Accepted quantity must be a non-negative number.' });
    }

    const finalRejected = parseFloat(rejected_quantity_quintals || 0);

    // Calculate applicable MSP rate
    const applicableRate = booking.msp_rate_inr && booking.msp_rate_inr > 0 ? booking.msp_rate_inr : 2300;
    const grossPayable = parseFloat((finalAccepted * applicableRate).toFixed(2));
    const netPayable = grossPayable;

    // Begin PostgreSQL Transaction
    await client.query('BEGIN');

    // 1. Upsert Acceptance
    const acceptanceId = `ACC-${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const procRef = `TN-DPC-${booking.centre_id}-${Date.now().toString().slice(-8)}`;

    const accRes = await client.query(`
      INSERT INTO procurement_acceptances (
        acceptance_id, booking_id, acceptance_status, accepted_quantity_quintals,
        rejected_quantity_quintals, reason, procurement_reference, accepted_by, accepted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (booking_id) DO UPDATE SET
        acceptance_status = EXCLUDED.acceptance_status,
        accepted_quantity_quintals = EXCLUDED.accepted_quantity_quintals,
        rejected_quantity_quintals = EXCLUDED.rejected_quantity_quintals,
        reason = EXCLUDED.reason,
        accepted_by = EXCLUDED.accepted_by,
        accepted_at = NOW()
      RETURNING *
    `, [acceptanceId, bookingId, acceptance_status, finalAccepted, finalRejected, reason || null, procRef, req.user.username || 'Centre Admin']);

    // 2. Generate Digital Receipt
    const receiptId = `RCPT-${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const receiptNum = generateReceiptNumber();
    const netKg = weighment ? weighment.net_weight_kg : (finalAccepted * 100);

    const rcptRes = await client.query(`
      INSERT INTO procurement_receipts (
        receipt_id, booking_id, receipt_number, farmer_id, centre_id, crop,
        accepted_quantity_quintals, net_weight_kg, grade, procurement_date, recorded_by, receipt_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, $10, 'ISSUED')
      ON CONFLICT (booking_id) DO UPDATE SET
        accepted_quantity_quintals = EXCLUDED.accepted_quantity_quintals,
        net_weight_kg = EXCLUDED.net_weight_kg,
        grade = EXCLUDED.grade,
        recorded_by = EXCLUDED.recorded_by
      RETURNING *
    `, [receiptId, bookingId, receiptNum, booking.farmer_id, booking.centre_id, booking.crop, finalAccepted, netKg, quality?.grade || 'Standard', req.user.username || 'Centre Admin']);

    // 3. Initialize Payment Record
    const paymentId = `PAY-${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const txnRef = `SIM_TXN_${bookingId}_${Date.now().toString().slice(-6)}`;

    const payRes = await client.query(`
      INSERT INTO procurement_payments (
        payment_id, booking_id, payable_quantity_quintals, applicable_rate_inr,
        rate_source, gross_payable_inr, deductions_inr, net_payable_inr,
        payment_status, payment_method, transaction_reference, initiated_at, is_demo_payment
      ) VALUES ($1, $2, $3, $4, 'DEMO_RATE', $5, 0, $6, 'PAYMENT_PENDING', 'DBT_SIMULATED', $7, NOW(), TRUE)
      ON CONFLICT (booking_id) DO UPDATE SET
        payable_quantity_quintals = EXCLUDED.payable_quantity_quintals,
        applicable_rate_inr = EXCLUDED.applicable_rate_inr,
        gross_payable_inr = EXCLUDED.gross_payable_inr,
        net_payable_inr = EXCLUDED.net_payable_inr,
        updated_at = NOW()
      RETURNING *
    `, [paymentId, bookingId, finalAccepted, applicableRate, grossPayable, netPayable, txnRef]);

    // 4. Update Booking
    await client.query(`
      UPDATE bookings
      SET status = 'Procured',
          payment_status = 'Pending',
          payment_amount_inr = $1,
          procured_quantity_quintals = $2,
          msp_rate_inr = $3
      WHERE booking_id = $4
    `, [netPayable, finalAccepted, applicableRate, bookingId]);

    // 5. Status History
    await client.query(`
      INSERT INTO status_history (booking_id, centre_id, status)
      VALUES ($1, $2, 'Procured')
    `, [bookingId, booking.centre_id]);

    // 6. Audit Log
    await client.query(`
      INSERT INTO procurement_audit_logs (booking_id, entity_type, action, previous_value, new_value, reason, performed_by)
      VALUES ($1, 'ACCEPTANCE', 'ACCEPT_AND_ISSUE_RECEIPT', NULL, $2, 'Procurement accepted and digital receipt generated', $3)
    `, [bookingId, JSON.stringify({ acceptance: accRes.rows[0], receipt: rcptRes.rows[0], payment: payRes.rows[0] }), req.user.username || 'Centre Admin']);

    await client.query('COMMIT');
    client.release();

    if (booking.farmer_id) {
      createFarmerNotification(pool, {
        farmer_id: booking.farmer_id,
        type: NOTIFICATION_TYPES.PROCUREMENT_COMPLETED,
        title: 'Procurement Accepted & Receipt Issued',
        message: `Procurement accepted for booking #${bookingId}. Accepted quantity: ${finalAccepted} quintals. Digital receipt #${receiptNum} issued.`,
        link: '/farmer/status',
        entity_type: 'BOOKING',
        entity_id: bookingId,
        action_required: false
      }).catch(e => console.error('Failed to create procurement acceptance notification:', e));
    }

    res.json({
      success: true,
      message: 'Procurement accepted and digital receipt generated successfully.',
      acceptance: accRes.rows[0],
      receipt: rcptRes.rows[0],
      payment: payRes.rows[0],
      booking_status: 'Procured'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Procurement acceptance transaction error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to complete procurement acceptance transaction.' });
  }
});


// 7. GET /api/bookings/:id/receipt
app.get('/api/bookings/:id/receipt', authenticateToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const bRes = await pool.query(`
      SELECT b.*, f.name AS farmer_name, f.phone AS farmer_phone, c.centre_name, c.district AS centre_district, c.village_town
      FROM bookings b
      LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      WHERE b.booking_id = $1
    `, [bookingId]);

    if (bRes.rows.length === 0) return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    const booking = bRes.rows[0];

    // IDOR checks
    if (req.user.role === 'FARMER' && req.user.farmerId && req.user.farmerId !== booking.farmer_id) {
      return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'CENTRE_ADMIN' && req.user.centreId && req.user.centreId !== booking.centre_id) {
      return res.status(403).json({ error: 'centre_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'DISTRICT_OFFICER' && req.user.district && booking.centre_district && req.user.district.trim().toLowerCase() !== booking.centre_district.trim().toLowerCase()) {
      return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: Access denied.' });
    }

    const rRes = await pool.query('SELECT * FROM procurement_receipts WHERE booking_id = $1', [bookingId]);
    if (rRes.rows.length === 0) {
      return res.status(404).json({ error: 'receipt_not_found', message: 'No digital receipt issued for this booking yet.' });
    }

    const rRow = rRes.rows[0];
    const pRes = await pool.query('SELECT * FROM procurement_payments WHERE booking_id = $1', [bookingId]);
    const pRow = pRes.rows[0] || null;
    const totalPay = pRow ? pRow.net_payable_inr : (booking.payment_amount_inr || 0);
    const rHash = crypto.createHash('sha256').update(`${rRow.receipt_number}-${bookingId}-${rRow.accepted_quantity_quintals}-${totalPay}`).digest('hex');

    res.json({
      success: true,
      receipt: {
        ...rRow,
        total_amount_inr: totalPay,
        applicable_rate_inr: pRow ? pRow.applicable_rate_inr : (booking.msp_rate_inr || 2300),
        receipt_hash: rHash,
        farmer_name: booking.farmer_name,
        farmer_phone: booking.farmer_phone,
        centre_name: booking.centre_name,
        centre_district: booking.centre_district,
        village_town: booking.village_town
      }
    });

  } catch (err) {
    console.error('Get receipt error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load digital receipt.' });
  }
});


// 8. POST /api/bookings/:id/payment
app.post('/api/bookings/:id/payment', authenticateToken, requireRole('CENTRE_ADMIN'), async (req, res) => {
  try {
    const bookingId = req.params.id;
    const {
      payment_status,
      transaction_reference,
      failure_reason
    } = req.body;

    const validStatuses = ['PAYMENT_PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNDER_REVIEW'];
    if (!payment_status || !validStatuses.includes(payment_status)) {
      return res.status(400).json({
        error: 'invalid_payment_status',
        message: `Invalid payment status. Allowed values are: ${validStatuses.join(', ')}`
      });
    }

    // Verify booking & centre isolation
    const bRes = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) {
      return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    }
    const booking = bRes.rows[0];

    if (req.user.centreId && req.user.centreId !== booking.centre_id) {
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: Booking belongs to centre ${booking.centre_id}, not your assigned centre (${req.user.centreId}).`
      });
    }

    // Fetch existing payment
    const pRes = await pool.query('SELECT * FROM procurement_payments WHERE booking_id = $1', [bookingId]);
    let paymentRecord;

    const txnRef = transaction_reference || pRes.rows[0]?.transaction_reference || `DBT_${bookingId}_${Date.now().toString().slice(-6)}`;

    if (pRes.rows.length > 0) {
      const prev = pRes.rows[0];
      const completedAt = payment_status === 'COMPLETED' ? 'NOW()' : (prev.completed_at ? `'${prev.completed_at.toISOString()}'` : 'NULL');
      
      const uRes = await pool.query(`
        UPDATE procurement_payments
        SET payment_status = $1,
            transaction_reference = $2,
            failure_reason = $3,
            completed_at = ${payment_status === 'COMPLETED' ? 'NOW()' : 'completed_at'},
            updated_at = NOW()
        WHERE booking_id = $4
        RETURNING *
      `, [payment_status, txnRef, failure_reason || null, bookingId]);
      paymentRecord = uRes.rows[0];

      await pool.query(`
        INSERT INTO procurement_audit_logs (booking_id, entity_type, action, previous_value, new_value, reason, performed_by)
        VALUES ($1, 'PAYMENT', 'STATUS_CHANGE', $2, $3, $4, $5)
      `, [bookingId, JSON.stringify(prev), JSON.stringify(paymentRecord), failure_reason || `Payment status changed to ${payment_status}`, req.user.username || 'Centre Admin']);
    } else {
      const paymentId = `PAY-${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      const payableQty = booking.procured_quantity_quintals || booking.quantity_quintals || 0;
      const rate = booking.msp_rate_inr || 2300;
      const netPayable = booking.payment_amount_inr || (payableQty * rate);

      const iRes = await pool.query(`
        INSERT INTO procurement_payments (
          payment_id, booking_id, payable_quantity_quintals, applicable_rate_inr,
          rate_source, gross_payable_inr, deductions_inr, net_payable_inr,
          payment_status, payment_method, transaction_reference, initiated_at,
          completed_at, failure_reason, is_demo_payment
        ) VALUES ($1, $2, $3, $4, 'DEMO_RATE', $5, 0, $6, $7, 'DBT_SIMULATED', $8, NOW(), ${payment_status === 'COMPLETED' ? 'NOW()' : 'NULL'}, $9, TRUE)
        RETURNING *
      `, [paymentId, bookingId, payableQty, rate, netPayable, netPayable, payment_status, txnRef, failure_reason || null]);
      paymentRecord = iRes.rows[0];
    }

    // Sync booking status
    if (payment_status === 'COMPLETED') {
      await pool.query(`
        UPDATE bookings
        SET status = 'Payment Completed',
            payment_status = 'Completed'
        WHERE booking_id = $1
      `, [bookingId]);

      await pool.query(`
        INSERT INTO status_history (booking_id, centre_id, status)
        VALUES ($1, $2, 'Payment Completed')
      `, [bookingId, booking.centre_id]);
    } else if (payment_status === 'FAILED') {
      await pool.query(`
        UPDATE bookings
        SET payment_status = 'Failed'
        WHERE booking_id = $1
      `, [bookingId]);
    } else if (payment_status === 'PROCESSING') {
      await pool.query(`
        UPDATE bookings
        SET payment_status = 'Processing'
        WHERE booking_id = $1
      `, [bookingId]);
    }

    if (booking.farmer_id) {
      if (payment_status === 'COMPLETED') {
        createFarmerNotification(pool, {
          farmer_id: booking.farmer_id,
          type: NOTIFICATION_TYPES.PAYMENT_COMPLETED,
          title: 'Payment Transferred Successfully',
          message: `Direct Benefit Transfer of ₹${paymentRecord?.net_payable_inr || booking.payment_amount_inr || 0} for booking #${bookingId} has been credited.`,
          link: '/farmer/status',
          entity_type: 'BOOKING',
          entity_id: bookingId,
          action_required: false
        }).catch(e => console.error('Failed to create payment completed notification:', e));
      } else if (payment_status === 'PROCESSING') {
        createFarmerNotification(pool, {
          farmer_id: booking.farmer_id,
          type: NOTIFICATION_TYPES.PAYMENT_PROCESSING,
          title: 'Payment Processing Initiated',
          message: `Direct Benefit Transfer of ₹${paymentRecord?.net_payable_inr || booking.payment_amount_inr || 0} for booking #${bookingId} is currently processing.`,
          link: '/farmer/status',
          entity_type: 'BOOKING',
          entity_id: bookingId,
          action_required: false
        }).catch(e => console.error('Failed to create payment processing notification:', e));
      }
    }

    res.json({
      success: true,
      message: `Payment status updated to ${payment_status}.`,
      payment: paymentRecord,
      booking_payment_status: payment_status
    });

  } catch (err) {
    console.error('Update payment error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to update payment status.' });
  }
});


// 9. GET /api/bookings/:id/payment
app.get('/api/bookings/:id/payment', authenticateToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const bRes = await pool.query('SELECT b.*, c.district AS centre_district FROM bookings b LEFT JOIN centres c ON b.centre_id = c.centre_id WHERE b.booking_id = $1', [bookingId]);
    if (bRes.rows.length === 0) return res.status(404).json({ error: 'booking_not_found', message: 'Booking not found.' });
    const booking = bRes.rows[0];

    // IDOR checks
    if (req.user.role === 'FARMER' && req.user.farmerId && req.user.farmerId !== booking.farmer_id) {
      return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'CENTRE_ADMIN' && req.user.centreId && req.user.centreId !== booking.centre_id) {
      return res.status(403).json({ error: 'centre_access_denied', message: 'Forbidden: Access denied.' });
    }
    if (req.user.role === 'DISTRICT_OFFICER' && req.user.district && booking.centre_district && req.user.district.trim().toLowerCase() !== booking.centre_district.trim().toLowerCase()) {
      return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: Access denied.' });
    }

    const pRes = await pool.query('SELECT * FROM procurement_payments WHERE booking_id = $1', [bookingId]);
    res.json({ success: true, payment: pRes.rows[0] || null });
  } catch (err) {
    console.error('Get payment error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load payment details.' });
  }
});


// 10. GET /api/district-officer/procurement-summary
app.get('/api/district-officer/procurement-summary', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
  try {
    const assignedDistrict = req.user.district;

    if (req.query.district && req.query.district.trim().toLowerCase() !== assignedDistrict.trim().toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: As District Officer for ${assignedDistrict}, you cannot access summary for ${req.query.district}.`
      });
    }

    // 1. District totals (clean aggregations preventing Cartesian inflation)
    const totalsRes = await pool.query(`
      WITH booking_totals AS (
        SELECT 
          COUNT(b.booking_id)::int AS total_bookings_season,
          COUNT(b.booking_id) FILTER (WHERE b.booking_date = CURRENT_DATE)::int AS total_bookings_today,
          COUNT(b.booking_id) FILTER (WHERE b.status IN ('Procured', 'Payment Pending', 'Payment Completed'))::int AS total_procured,
          COALESCE(SUM(b.procured_quantity_quintals) FILTER (WHERE b.status IN ('Procured', 'Payment Pending', 'Payment Completed')), 0)::numeric AS total_quantity_procured_quintals
        FROM centres c
        JOIN bookings b ON c.centre_id = b.centre_id
        WHERE LOWER(c.district) = LOWER($1)
      ),
      quality_totals AS (
        SELECT COUNT(q.quality_id)::int AS quality_assessments_completed
        FROM centres c
        JOIN bookings b ON c.centre_id = b.centre_id
        JOIN procurement_quality q ON b.booking_id = q.booking_id
        WHERE LOWER(c.district) = LOWER($1)
      ),
      weigh_totals AS (
        SELECT COUNT(w.weighment_id)::int AS weighments_completed
        FROM centres c
        JOIN bookings b ON c.centre_id = b.centre_id
        JOIN procurement_weighments w ON b.booking_id = w.booking_id
        WHERE LOWER(c.district) = LOWER($1)
      ),
      pay_totals AS (
        SELECT 
          COUNT(p.payment_id) FILTER (WHERE p.payment_status = 'COMPLETED')::int AS payments_completed,
          COUNT(p.payment_id) FILTER (WHERE p.payment_status IN ('PAYMENT_PENDING', 'PROCESSING'))::int AS payments_pending,
          COUNT(p.payment_id) FILTER (WHERE p.payment_status = 'FAILED')::int AS payments_failed
        FROM centres c
        JOIN bookings b ON c.centre_id = b.centre_id
        JOIN procurement_payments p ON b.booking_id = p.booking_id
        WHERE LOWER(c.district) = LOWER($1)
      )
      SELECT 
        bt.*,
        qt.quality_assessments_completed,
        wt.weighments_completed,
        pt.payments_completed,
        pt.payments_pending,
        pt.payments_failed
      FROM booking_totals bt, quality_totals qt, weigh_totals wt, pay_totals pt
    `, [assignedDistrict]);

    // 2. Dispute totals from grievances
    const disputesRes = await pool.query(`
      SELECT 
        COUNT(g.grievance_id)::int AS total_procurement_disputes,
        COUNT(g.grievance_id) FILTER (WHERE g.issue_type IN ('QUALITY_DISPUTE', 'Quality Dispute', 'Grading Dispute'))::int AS quality_disputes,
        COUNT(g.grievance_id) FILTER (WHERE g.issue_type IN ('WEIGHT_DISPUTE', 'Weight Dispute'))::int AS weight_disputes,
        COUNT(g.grievance_id) FILTER (WHERE g.issue_type IN ('PAYMENT_DISPUTE', 'Payment Dispute', 'Payment Delay'))::int AS payment_disputes
      FROM grievances g
      JOIN centres c ON g.centre_id = c.centre_id
      WHERE LOWER(c.district) = LOWER($1)
    `, [assignedDistrict]);

    // 3. Centre breakdown (CTE prevents Cartesian multiplication between bookings and grievances)
    const centresRes = await pool.query(`
      WITH b_agg AS (
        SELECT 
          b.centre_id,
          COUNT(b.booking_id) FILTER (WHERE b.booking_date = CURRENT_DATE)::int AS today_bookings,
          COUNT(b.booking_id) FILTER (WHERE b.status IN ('Procured', 'Payment Pending', 'Payment Completed'))::int AS total_procured,
          COALESCE(SUM(b.procured_quantity_quintals) FILTER (WHERE b.status IN ('Procured', 'Payment Pending', 'Payment Completed')), 0)::numeric AS quantity_procured_quintals,
          COUNT(DISTINCT q.quality_id)::int AS quality_completed,
          COUNT(DISTINCT w.weighment_id)::int AS weighments_completed
        FROM bookings b
        LEFT JOIN procurement_quality q ON b.booking_id = q.booking_id
        LEFT JOIN procurement_weighments w ON b.booking_id = w.booking_id
        GROUP BY b.centre_id
      ),
      g_agg AS (
        SELECT centre_id, COUNT(grievance_id)::int AS centre_disputes
        FROM grievances
        GROUP BY centre_id
      )
      SELECT 
        c.centre_id,
        c.centre_name,
        c.village_town,
        COALESCE(ba.today_bookings, 0) AS today_bookings,
        COALESCE(ba.total_procured, 0) AS total_procured,
        COALESCE(ba.quantity_procured_quintals, 0) AS quantity_procured_quintals,
        COALESCE(ba.quality_completed, 0) AS quality_completed,
        COALESCE(ba.weighments_completed, 0) AS weighments_completed,
        COALESCE(ga.centre_disputes, 0) AS centre_disputes
      FROM centres c
      LEFT JOIN b_agg ba ON c.centre_id = ba.centre_id
      LEFT JOIN g_agg ga ON c.centre_id = ga.centre_id
      WHERE LOWER(c.district) = LOWER($1)
      ORDER BY quantity_procured_quintals DESC
      LIMIT 15
    `, [assignedDistrict]);

    const tRow = totalsRes.rows[0] || {};
    const dRow = disputesRes.rows[0] || {};
    const totalBookingsCount = Number(tRow.total_bookings_season || 0);
    const procuredQty = Number(tRow.total_quantity_procured_quintals || 0);

    const breakdown = centresRes.rows.map(cb => ({
      ...cb,
      total_bookings: Number(cb.today_bookings || cb.total_procured || 1),
      graded_count: Number(cb.quality_completed || 0),
      weighed_count: Number(cb.weighments_completed || 0),
      procured_count: Number(cb.total_procured || 0),
      net_weight_kg: Number(cb.quantity_procured_quintals || 0) * 100,
      total_payout_inr: Number(cb.quantity_procured_quintals || 0) * 2320,
      paid_count: Number(cb.total_procured || 0),
      open_disputes: Number(cb.centre_disputes || 0)
    }));

    res.json({
      success: true,
      district: assignedDistrict,
      summary: {
        total_bookings: totalBookingsCount,
        in_progress_count: Number(tRow.quality_assessments_completed || 0),
        procured_count: Number(tRow.total_procured || 0),
        total_net_kg: procuredQty * 100,
        total_payout_inr: procuredQty * 2320,
        payments_completed: Number(tRow.payments_completed || 0),
        ...tRow,
        ...dRow
      },
      centres: centresRes.rows,
      centre_breakdown: breakdown,
      _notice: 'District procurement analytics are calculated from logged centre operational events. Simulated/demo rates apply where live DBT integration is pending.'
    });

  } catch (err) {
    console.error('District procurement summary error:', err);
    res.status(500).json({ error: 'server_error', message: 'Unable to load district procurement summary.' });
  }
});


app.get('/api/test', (req, res) => {
  res.json({
    message: 'Backend is using the correct index.js'
  });
});

const PORT = process.env.PORT || 4000;
let fastAgiServerInstance = null;

const server = app.listen(PORT, (err) => {
  if (err) return;
  console.log(`Backend running on port ${PORT}`);

  // Automatically launch NEW FastAGI server for Extension 2000 (Port 4574)
  try {
    const { NewFastAgiServer } = require('./services/ivr/newFastAgiServer');
    const fastAgiPort = parseInt(process.env.NEW_FASTAGI_PORT, 10) || 4574;
    fastAgiServerInstance = new NewFastAgiServer({ port: fastAgiPort, host: '0.0.0.0' });
    fastAgiServerInstance.start()
      .then(() => {
        console.log(`[NEW-IVR] FastAGI daemon successfully listening on port ${fastAgiPort} (Extension 2000)`);
      })
      .catch((agiErr) => {
        if (agiErr.code === 'EADDRINUSE') {
          console.log(`[NEW-IVR] FastAGI port ${fastAgiPort} is already in use by another instance.`);
        } else {
          console.error(`[NEW-IVR] Warning: Could not start FastAGI on port ${fastAgiPort}:`, agiErr.message);
        }
      });
  } catch (ivrErr) {
    console.error('[NEW-IVR] Failed to initialize FastAGI server:', ivrErr.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing backend process before starting another instance.`);
  } else {
    console.error(`Backend server error on port ${PORT}:`, err.message);
  }
  process.exit(1);
});

// Graceful cleanup on shutdown
process.on('SIGINT', async () => {
  if (fastAgiServerInstance) {
    try { await fastAgiServerInstance.stop(); } catch (_) {}
  }
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (fastAgiServerInstance) {
    try { await fastAgiServerInstance.stop(); } catch (_) {}
  }
  process.exit(0);
});