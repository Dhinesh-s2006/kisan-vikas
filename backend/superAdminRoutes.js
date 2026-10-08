const express = require('express');
const {
  hashPassword,
  verifyPassword,
  generateToken,
  authenticateToken,
  requireRole
} = require('./auth');
const { ensureCentreSlots } = require('./services/booking/slotService');
const { getKolkataNow, isPastDate, normalizeDateStr } = require('./services/common/timeService');

function createSuperAdminRouter({ pool }) {
  const router = express.Router();

  // Helper to record administrative audit logs
  async function recordAdminAudit(adminUser, action, resourceType, resourceId, status = 'SUCCESS', details = {}) {
    try {
      await pool.query(
        `INSERT INTO admin_audit_logs (admin_id, admin_username, action, resource_type, resource_id, status, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          adminUser?.userId || adminUser?.user_id || 'SYSTEM',
          adminUser?.username || 'admin',
          action,
          resourceType,
          resourceId ? String(resourceId) : null,
          status,
          JSON.stringify(details)
        ]
      );
    } catch (err) {
      console.error('Failed to record admin audit log:', err.message);
    }
  }

  // =========================================================================
  // 1. AUTHENTICATION & SESSION MANAGEMENT
  // =========================================================================

  // POST /api/super-admin/login
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          error: 'missing_credentials',
          message: 'Username and password are required.'
        });
      }

      const q = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
      if (q.rows.length === 0) {
        await recordAdminAudit({ username }, 'SUPER_ADMIN_LOGIN_FAILED', 'AUTH', username, 'FAILURE', { reason: 'User not found' });
        return res.status(401).json({
          error: 'invalid_credentials',
          message: 'Invalid administrative username or password.'
        });
      }

      const user = q.rows[0];

      if (user.is_active === false) {
        await recordAdminAudit({ username: user.username }, 'SUPER_ADMIN_LOGIN_FAILED', 'AUTH', user.user_id, 'FAILURE', { reason: 'Account deactivated' });
        return res.status(403).json({
          error: 'account_deactivated',
          message: 'This administrative account has been deactivated. Please contact state IT administration.'
        });
      }

      // Check password
      const match = verifyPassword(password, user.password_hash);
      if (!match) {
        await recordAdminAudit({ username: user.username }, 'SUPER_ADMIN_LOGIN_FAILED', 'AUTH', user.user_id, 'FAILURE', { reason: 'Incorrect password' });
        return res.status(401).json({
          error: 'invalid_credentials',
          message: 'Invalid administrative username or password.'
        });
      }

      // Strict role check: ONLY SUPER_ADMIN allowed
      if (user.role !== 'SUPER_ADMIN') {
        await recordAdminAudit({ username: user.username }, 'SUPER_ADMIN_LOGIN_FORBIDDEN', 'AUTH', user.user_id, 'FAILURE', { reason: 'Role mismatch: ' + user.role });
        return res.status(403).json({
          error: 'access_denied',
          message: `Access denied. Role "${user.role}" does not have Super Administrator privileges.`
        });
      }

      const tokenPayload = {
        userId: user.user_id,
        username: user.username,
        role: 'SUPER_ADMIN',
        fullName: user.full_name || 'Chief Administrator',
        district: user.district || 'State HQ (Chennai)'
      };

      const token = generateToken(tokenPayload);

      await recordAdminAudit(tokenPayload, 'SUPER_ADMIN_LOGIN', 'AUTH', user.user_id, 'SUCCESS', { ip: req.ip });

      return res.json({
        success: true,
        token,
        user: tokenPayload,
        message: 'Super Administrator session authenticated successfully.'
      });
    } catch (err) {
      console.error('Super Admin login error:', err);
      res.status(500).json({ error: 'server_error', message: 'Authentication failed.' });
    }
  });

  // GET /api/super-admin/me
  router.get('/me', authenticateToken, requireRole('SUPER_ADMIN'), (req, res) => {
    res.json({
      success: true,
      user: req.user
    });
  });

  // =========================================================================
  // 2. DASHBOARD OVERVIEW METRICS
  // =========================================================================

  // GET /api/super-admin/overview
  router.get('/overview', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const [
        farmersCount,
        centresCount,
        openCentresCount,
        bookingsCount,
        upcomingBookingsCount,
        procuredCount,
        statusDist,
        recentAudits,
        recentBookings
      ] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM farmers'),
        pool.query('SELECT COUNT(*) as count FROM centres'),
        pool.query("SELECT COUNT(*) as count FROM centres WHERE operational_status = 'OPEN'"),
        pool.query('SELECT COUNT(*) as count FROM bookings'),
        pool.query('SELECT COUNT(*) as count FROM bookings WHERE booking_date >= CURRENT_DATE'),
        pool.query("SELECT COUNT(*) as count FROM bookings WHERE status IN ('PROCURED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED')"),
        pool.query('SELECT status, COUNT(*) as count FROM bookings GROUP BY status ORDER BY count DESC'),
        pool.query('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10'),
        pool.query(`
          SELECT b.booking_id, b.farmer_id, f.name as farmer_name, b.centre_id, c.centre_name, b.booking_date, b.crop, b.quantity_quintals, b.status, b.token
          FROM bookings b
          LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
          LEFT JOIN centres c ON b.centre_id = c.centre_id
          ORDER BY b.created_at DESC LIMIT 8
        `)
      ]);

      const totalCentres = parseInt(centresCount.rows[0].count, 10);
      const openCentres = parseInt(openCentresCount.rows[0].count, 10);
      const closedCentres = totalCentres - openCentres;

      res.json({
        success: true,
        metrics: {
          totalFarmers: parseInt(farmersCount.rows[0].count, 10),
          totalCentres,
          openCentres,
          closedCentres,
          totalBookings: parseInt(bookingsCount.rows[0].count, 10),
          upcomingBookings: parseInt(upcomingBookingsCount.rows[0].count, 10),
          procuredBookings: parseInt(procuredCount.rows[0].count, 10),
          statusDistribution: statusDist.rows,
          recentAuditLogs: recentAudits.rows,
          recentBookings: recentBookings.rows
        }
      });
    } catch (err) {
      console.error('Super Admin overview error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch administrative metrics.' });
    }
  });

  // =========================================================================
  // 3. FARMER MANAGEMENT
  // =========================================================================

  // GET /api/super-admin/farmers
  router.get('/farmers', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
      const offset = (page - 1) * limit;

      const { search, district, status } = req.query;
      const conditions = [];
      const params = [];

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        conditions.push(`(
          LOWER(farmer_id) LIKE $${params.length} OR
          LOWER(name) LIKE $${params.length} OR
          LOWER(phone) LIKE $${params.length} OR
          LOWER(village) LIKE $${params.length}
        )`);
      }

      if (district && district.trim()) {
        params.push(district.trim());
        conditions.push(`LOWER(district) = LOWER($${params.length})`);
      }

      if (status === 'active') {
        conditions.push('is_active IS NOT FALSE');
      } else if (status === 'inactive') {
        conditions.push('is_active = FALSE');
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*) as count FROM farmers ${whereClause}`, params);
      const total = parseInt(countRes.rows[0].count, 10);

      params.push(limit, offset);
      const query = `
        SELECT farmer_id, name, phone, village, district, land_holding_acres, primary_crop, preferred_language, smartphone_access, block, panchayat, COALESCE(is_active, true) as is_active
        FROM farmers
        ${whereClause}
        ORDER BY farmer_id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const listRes = await pool.query(query, params);

      res.json({
        success: true,
        farmers: listRes.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      console.error('Super Admin fetch farmers error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch farmers.' });
    }
  });

  // GET /api/super-admin/farmers/:id
  router.get('/farmers/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const fRes = await pool.query('SELECT * FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [id]);
      if (fRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Farmer not found.' });
      }

      const bookingsRes = await pool.query(
        `SELECT booking_id, booking_date, crop, quantity_quintals, status, token, centre_id 
         FROM bookings WHERE LOWER(farmer_id) = LOWER($1) ORDER BY booking_date DESC LIMIT 5`,
        [id]
      );

      res.json({
        success: true,
        farmer: fRes.rows[0],
        recentBookings: bookingsRes.rows
      });
    } catch (err) {
      console.error('Super Admin get farmer error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to retrieve farmer details.' });
    }
  });

  // POST /api/super-admin/farmers
  router.post('/farmers', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const {
        farmer_id,
        name,
        phone,
        village,
        district,
        land_holding_acres,
        primary_crop,
        preferred_language,
        smartphone_access,
        block,
        panchayat
      } = req.body;

      if (!farmer_id || !name || !phone || !district) {
        return res.status(400).json({
          error: 'missing_fields',
          message: 'Farmer ID, Full Name, Mobile Number, and District are mandatory.'
        });
      }

      const cleanId = String(farmer_id).trim().toUpperCase();
      const existing = await pool.query('SELECT farmer_id FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [cleanId]);
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'duplicate_farmer_id',
          message: `Farmer ID "${cleanId}" already exists.`
        });
      }

      await pool.query(
        `INSERT INTO farmers (farmer_id, name, phone, village, district, land_holding_acres, primary_crop, preferred_language, smartphone_access, block, panchayat, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
        [
          cleanId,
          name.trim(),
          phone.trim(),
          village ? village.trim() : '',
          district.trim(),
          parseFloat(land_holding_acres) || 1.0,
          primary_crop || 'Paddy (Samba)',
          preferred_language || 'ta',
          smartphone_access || 'YES',
          block || '',
          panchayat || ''
        ]
      );

      await recordAdminAudit(req.user, 'CREATE_FARMER', 'FARMER', cleanId, 'SUCCESS', { name, district, phone });

      res.status(201).json({
        success: true,
        message: `Farmer ${name} (${cleanId}) registered successfully.`,
        farmer_id: cleanId
      });
    } catch (err) {
      console.error('Super Admin create farmer error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to create farmer record.' });
    }
  });

  // PUT /api/super-admin/farmers/:id
  router.put('/farmers/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        phone,
        village,
        district,
        land_holding_acres,
        primary_crop,
        preferred_language,
        smartphone_access,
        block,
        panchayat
      } = req.body;

      if (!name || !phone || !district) {
        return res.status(400).json({
          error: 'missing_fields',
          message: 'Full Name, Mobile Number, and District cannot be empty.'
        });
      }

      const check = await pool.query('SELECT * FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Farmer record not found.' });
      }

      await pool.query(
        `UPDATE farmers
         SET name = $1, phone = $2, village = $3, district = $4, land_holding_acres = $5,
             primary_crop = $6, preferred_language = $7, smartphone_access = $8, block = $9, panchayat = $10
         WHERE LOWER(farmer_id) = LOWER($11)`,
        [
          name.trim(),
          phone.trim(),
          village ? village.trim() : '',
          district.trim(),
          parseFloat(land_holding_acres) || 1.0,
          primary_crop || 'Paddy (Samba)',
          preferred_language || 'ta',
          smartphone_access || 'YES',
          block || '',
          panchayat || '',
          id
        ]
      );

      await recordAdminAudit(req.user, 'UPDATE_FARMER', 'FARMER', id, 'SUCCESS', { name, phone, district });

      res.json({
        success: true,
        message: `Farmer ${id} details updated successfully.`
      });
    } catch (err) {
      console.error('Super Admin update farmer error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update farmer record.' });
    }
  });

  // PATCH /api/super-admin/farmers/:id/status
  router.patch('/farmers/:id/status', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

      if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'invalid_status', message: 'is_active must be true or false.' });
      }

      const check = await pool.query('SELECT farmer_id, name FROM farmers WHERE LOWER(farmer_id) = LOWER($1)', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Farmer not found.' });
      }

      await pool.query('UPDATE farmers SET is_active = $1 WHERE LOWER(farmer_id) = LOWER($2)', [is_active, id]);
      await recordAdminAudit(req.user, is_active ? 'ACTIVATE_FARMER' : 'DEACTIVATE_FARMER', 'FARMER', id, 'SUCCESS', { is_active });

      res.json({
        success: true,
        message: `Farmer ${id} has been ${is_active ? 'activated' : 'deactivated'}.`,
        is_active
      });
    } catch (err) {
      console.error('Super Admin toggle farmer status error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to change farmer status.' });
    }
  });

  // =========================================================================
  // 4. USERS AND ROLES MANAGEMENT
  // =========================================================================

  // GET /api/super-admin/users
  router.get('/users', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
      const offset = (page - 1) * limit;

      const { search, role, status } = req.query;
      const conditions = [];
      const params = [];

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        conditions.push(`(
          LOWER(username) LIKE $${params.length} OR
          LOWER(COALESCE(full_name, '')) LIKE $${params.length} OR
          LOWER(COALESCE(district, '')) LIKE $${params.length} OR
          LOWER(COALESCE(centre_id, '')) LIKE $${params.length}
        )`);
      }

      if (role && role.trim()) {
        params.push(role.trim().toUpperCase());
        conditions.push(`role = $${params.length}`);
      }

      if (status === 'active') {
        conditions.push('is_active IS NOT FALSE');
      } else if (status === 'inactive') {
        conditions.push('is_active = FALSE');
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
      const total = parseInt(countRes.rows[0].count, 10);

      params.push(limit, offset);
      // Strictly exclude password_hash from response
      const query = `
        SELECT user_id, username, role, full_name, district, centre_id, farmer_id, created_at, COALESCE(is_active, true) as is_active
        FROM users
        ${whereClause}
        ORDER BY created_at DESC NULLS LAST, username ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const listRes = await pool.query(query, params);

      res.json({
        success: true,
        users: listRes.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      console.error('Super Admin fetch users error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch system users.' });
    }
  });

  // POST /api/super-admin/users
  router.post('/users', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { username, password, role, full_name, district, centre_id, farmer_id } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({
          error: 'missing_fields',
          message: 'Username, password, and role are required.'
        });
      }

      const validRoles = ['SUPER_ADMIN', 'DISTRICT_OFFICER', 'CENTRE_ADMIN', 'CSC_OPERATOR', 'FARMER'];
      const cleanRole = role.trim().toUpperCase();
      if (!validRoles.includes(cleanRole)) {
        return res.status(400).json({
          error: 'invalid_role',
          message: `Role must be one of: ${validRoles.join(', ')}`
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error: 'weak_password',
          message: 'Password must be at least 6 characters long.'
        });
      }

      const cleanUser = username.trim().toLowerCase();
      const existing = await pool.query('SELECT user_id FROM users WHERE LOWER(username) = LOWER($1)', [cleanUser]);
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'duplicate_username',
          message: `Username "${cleanUser}" is already taken.`
        });
      }

      const userId = `USR_${cleanRole}_${Date.now()}`;
      const passHash = hashPassword(password);

      await pool.query(
        `INSERT INTO users (user_id, username, password_hash, role, full_name, district, centre_id, farmer_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          userId,
          cleanUser,
          passHash,
          cleanRole,
          full_name ? full_name.trim() : cleanUser,
          district ? district.trim() : null,
          centre_id ? centre_id.trim() : null,
          farmer_id ? farmer_id.trim() : null
        ]
      );

      await recordAdminAudit(req.user, 'CREATE_USER', 'USER', userId, 'SUCCESS', { username: cleanUser, role: cleanRole, district, centre_id });

      res.status(201).json({
        success: true,
        message: `Account "${cleanUser}" created with role "${cleanRole}".`,
        user_id: userId
      });
    } catch (err) {
      console.error('Super Admin create user error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to create user account.' });
    }
  });

  // PUT /api/super-admin/users/:id
  router.put('/users/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { full_name, district, centre_id, role, is_active } = req.body;

      const userRes = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'User not found.' });
      }

      const targetUser = userRes.rows[0];

      // Protect last active Super Admin
      if (targetUser.role === 'SUPER_ADMIN' && (role !== 'SUPER_ADMIN' || is_active === false)) {
        const saCountRes = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'SUPER_ADMIN' AND is_active IS NOT FALSE");
        const saCount = parseInt(saCountRes.rows[0].count, 10);
        if (saCount <= 1) {
          return res.status(400).json({
            error: 'cannot_demote_last_admin',
            message: 'Cannot demote or deactivate the only active Super Administrator account.'
          });
        }
      }

      const validRoles = ['SUPER_ADMIN', 'DISTRICT_OFFICER', 'CENTRE_ADMIN', 'CSC_OPERATOR', 'FARMER'];
      const targetRole = role ? role.trim().toUpperCase() : targetUser.role;
      if (!validRoles.includes(targetRole)) {
        return res.status(400).json({ error: 'invalid_role', message: 'Invalid role assignment.' });
      }

      await pool.query(
        `UPDATE users
         SET full_name = $1, district = $2, centre_id = $3, role = $4, is_active = $5
         WHERE user_id = $6`,
        [
          full_name ? full_name.trim() : targetUser.full_name,
          district ? district.trim() : targetUser.district,
          centre_id ? centre_id.trim() : targetUser.centre_id,
          targetRole,
          typeof is_active === 'boolean' ? is_active : targetUser.is_active,
          id
        ]
      );

      await recordAdminAudit(req.user, 'UPDATE_USER', 'USER', id, 'SUCCESS', { role: targetRole, is_active, district });

      res.json({
        success: true,
        message: `Account ${targetUser.username} updated successfully.`
      });
    } catch (err) {
      console.error('Super Admin update user error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update user account.' });
    }
  });

  // POST /api/super-admin/users/:id/reset-password
  router.post('/users/:id/reset-password', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { new_password } = req.body;

      if (!new_password || new_password.length < 6) {
        return res.status(400).json({
          error: 'invalid_password',
          message: 'New password must be at least 6 characters long.'
        });
      }

      const userRes = await pool.query('SELECT user_id, username FROM users WHERE user_id = $1', [id]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'User not found.' });
      }

      const passHash = hashPassword(new_password);
      await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [passHash, id]);

      await recordAdminAudit(req.user, 'RESET_PASSWORD', 'USER', id, 'SUCCESS', { username: userRes.rows[0].username });

      res.json({
        success: true,
        message: `Password for user "${userRes.rows[0].username}" has been reset successfully.`
      });
    } catch (err) {
      console.error('Super Admin reset password error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to reset password.' });
    }
  });

  // PATCH /api/super-admin/users/:id/status
  router.patch('/users/:id/status', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

      if (typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'invalid_status', message: 'is_active must be boolean.' });
      }

      const userRes = await pool.query('SELECT user_id, username, role FROM users WHERE user_id = $1', [id]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'User not found.' });
      }

      // Cannot deactivate self
      if (req.user.userId === id && !is_active) {
        return res.status(400).json({
          error: 'self_deactivation',
          message: 'You cannot deactivate your own administrative account.'
        });
      }

      await pool.query('UPDATE users SET is_active = $1 WHERE user_id = $2', [is_active, id]);
      await recordAdminAudit(req.user, is_active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', 'USER', id, 'SUCCESS', { username: userRes.rows[0].username, is_active });

      res.json({
        success: true,
        message: `User ${userRes.rows[0].username} has been ${is_active ? 'activated' : 'deactivated'}.`,
        is_active
      });
    } catch (err) {
      console.error('Super Admin toggle user status error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update user status.' });
    }
  });

  // =========================================================================
  // 5. PROCUREMENT CENTRE MANAGEMENT
  // =========================================================================

  // GET /api/super-admin/centres
  router.get('/centres', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
      const offset = (page - 1) * limit;

      const { search, district, status } = req.query;
      const conditions = [];
      const params = [];

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        conditions.push(`(
          LOWER(centre_id) LIKE $${params.length} OR
          LOWER(centre_name) LIKE $${params.length} OR
          LOWER(village_town) LIKE $${params.length}
        )`);
      }

      if (district && district.trim()) {
        params.push(district.trim());
        conditions.push(`LOWER(district) = LOWER($${params.length})`);
      }

      if (status && status.trim()) {
        params.push(status.trim().toUpperCase());
        conditions.push(`operational_status = $${params.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*) as count FROM centres ${whereClause}`, params);
      const total = parseInt(countRes.rows[0].count, 10);

      params.push(limit, offset);
      const query = `
        SELECT centre_id, centre_name, village_town, district, operational_status,
               daily_capacity_slots, storage_capacity_mt, current_stock_mt,
               active_counters, staff_availability, processing_rate_min, risk_level
        FROM centres
        ${whereClause}
        ORDER BY centre_id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const listRes = await pool.query(query, params);

      res.json({
        success: true,
        centres: listRes.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      console.error('Super Admin fetch centres error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch centres.' });
    }
  });

  // GET /api/super-admin/centres/:id
  router.get('/centres/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const cRes = await pool.query('SELECT * FROM centres WHERE centre_id = $1', [id]);
      if (cRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Centre not found.' });
      }

      const historyRes = await pool.query(
        'SELECT * FROM centre_status_history WHERE centre_id = $1 ORDER BY changed_at DESC LIMIT 5',
        [id]
      );

      res.json({
        success: true,
        centre: cRes.rows[0],
        statusHistory: historyRes.rows
      });
    } catch (err) {
      console.error('Super Admin get centre error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to get centre details.' });
    }
  });

  // POST /api/super-admin/centres
  router.post('/centres', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const {
        centre_id,
        centre_name,
        village_town,
        district,
        operational_status,
        daily_capacity_slots,
        storage_capacity_mt,
        active_counters,
        staff_availability,
        processing_rate_min
      } = req.body;

      if (!centre_id || !centre_name || !district) {
        return res.status(400).json({
          error: 'missing_fields',
          message: 'Centre ID, Centre Name, and District are required.'
        });
      }

      const cleanId = centre_id.trim().toUpperCase();
      const existing = await pool.query('SELECT centre_id FROM centres WHERE centre_id = $1', [cleanId]);
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'duplicate_centre_id',
          message: `Centre ID "${cleanId}" already exists.`
        });
      }

      await pool.query(
        `INSERT INTO centres (
          centre_id, centre_name, village_town, district, operational_status,
          daily_capacity_slots, storage_capacity_mt, active_counters, staff_availability, processing_rate_min, state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Tamil Nadu')`,
        [
          cleanId,
          centre_name.trim(),
          village_town ? village_town.trim() : '',
          district.trim(),
          operational_status || 'OPEN',
          parseInt(daily_capacity_slots, 10) || 50,
          parseFloat(storage_capacity_mt) || 500.0,
          parseInt(active_counters, 10) || 2,
          parseInt(staff_availability, 10) || 5,
          parseInt(processing_rate_min, 10) || 12
        ]
      );

      await recordAdminAudit(req.user, 'CREATE_CENTRE', 'CENTRE', cleanId, 'SUCCESS', { centre_name, district, operational_status });

      res.status(201).json({
        success: true,
        message: `Procurement centre ${centre_name} (${cleanId}) registered successfully.`,
        centre_id: cleanId
      });
    } catch (err) {
      console.error('Super Admin create centre error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to create centre record.' });
    }
  });

  // PUT /api/super-admin/centres/:id
  router.put('/centres/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const {
        centre_name,
        village_town,
        district,
        operational_status,
        daily_capacity_slots,
        storage_capacity_mt,
        active_counters,
        staff_availability,
        processing_rate_min,
        status_reason
      } = req.body;

      const cRes = await pool.query('SELECT * FROM centres WHERE centre_id = $1', [id]);
      if (cRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Centre not found.' });
      }

      const current = cRes.rows[0];
      const newStatus = operational_status || current.operational_status;

      await pool.query(
        `UPDATE centres
         SET centre_name = $1, village_town = $2, district = $3, operational_status = $4,
             daily_capacity_slots = $5, storage_capacity_mt = $6, active_counters = $7,
             staff_availability = $8, processing_rate_min = $9
         WHERE centre_id = $10`,
        [
          centre_name ? centre_name.trim() : current.centre_name,
          village_town !== undefined ? village_town.trim() : current.village_town,
          district ? district.trim() : current.district,
          newStatus,
          parseInt(daily_capacity_slots, 10) || current.daily_capacity_slots,
          parseFloat(storage_capacity_mt) || current.storage_capacity_mt,
          parseInt(active_counters, 10) || current.active_counters,
          parseInt(staff_availability, 10) || current.staff_availability,
          parseInt(processing_rate_min, 10) || current.processing_rate_min,
          id
        ]
      );

      // If operational status changed, record in centre_status_history
      if (current.operational_status !== newStatus) {
        await pool.query(
          `INSERT INTO centre_status_history (centre_id, previous_status, new_status, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            current.operational_status,
            newStatus,
            req.user.username || 'superadmin',
            status_reason || 'Administrative status update via Super Admin Portal'
          ]
        );
      }

      await recordAdminAudit(req.user, 'UPDATE_CENTRE', 'CENTRE', id, 'SUCCESS', {
        previous_status: current.operational_status,
        new_status: newStatus,
        active_counters,
        staff_availability
      });

      res.json({
        success: true,
        message: `Centre ${id} updated successfully.`
      });
    } catch (err) {
      console.error('Super Admin update centre error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update centre details.' });
    }
  });

  // =========================================================================
  // 6. SLOTS AND CAPACITY MANAGEMENT
  // =========================================================================

  // GET /api/super-admin/slots
  router.get('/slots', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const { centre_id, date, district } = req.query;
      const conditions = [];
      const params = [];

      if (centre_id && centre_id.trim()) {
        params.push(centre_id.trim().toUpperCase());
        conditions.push(`s.centre_id = $${params.length}`);
      }

      if (date && date.trim()) {
        params.push(date.trim());
        conditions.push(`s.date = $${params.length}`);
      }

      if (district && district.trim()) {
        params.push(district.trim());
        conditions.push(`LOWER(c.district) = LOWER($${params.length})`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(
        `SELECT COUNT(*) as count 
         FROM slots s
         LEFT JOIN centres c ON s.centre_id = c.centre_id
         ${whereClause}`,
        params
      );
      const total = parseInt(countRes.rows[0].count, 10);

      params.push(limit, offset);
      const query = `
        SELECT s.slot_id, s.centre_id, c.centre_name, c.district, s.date, s.start_time, s.end_time,
               s.max_farmers, s.booked_count, s.held_count,
               GREATEST(0, s.max_farmers - s.booked_count - COALESCE(s.held_count, 0)) as available_capacity,
               c.operational_status as centre_status
        FROM slots s
        LEFT JOIN centres c ON s.centre_id = c.centre_id
        ${whereClause}
        ORDER BY s.date DESC, s.start_time ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const listRes = await pool.query(query, params);

      // Compute expiration tag based on today's date and time
      const kolkataNow = getKolkataNow();
      const todayStr = kolkataNow.todayStr;
      const [curH, curM] = kolkataNow.currentTimeStr.split(':').map(Number);
      const nowMinutes = curH * 60 + (curM || 0);

      const slotsWithExpiry = listRes.rows.map(slot => {
        const slotDate = normalizeDateStr(slot.date);
        let isExpired = false;
        if (slotDate < todayStr) {
          isExpired = true;
        } else if (slotDate === todayStr) {
          const [endH, endM] = String(slot.end_time).split(':').map(Number);
          if (endH * 60 + (endM || 0) <= nowMinutes) {
            isExpired = true;
          }
        }
        return {
          ...slot,
          is_expired: isExpired,
          is_full: (slot.booked_count + (slot.held_count || 0)) >= slot.max_farmers
        };
      });

      res.json({
        success: true,
        slots: slotsWithExpiry,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      console.error('Super Admin fetch slots error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch slots.' });
    }
  });

  // PUT /api/super-admin/slots/:id/capacity
  router.put('/slots/:id/capacity', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { max_farmers } = req.body;

      const newCapacity = parseInt(max_farmers, 10);
      if (isNaN(newCapacity) || newCapacity < 1) {
        return res.status(400).json({
          error: 'invalid_capacity',
          message: 'Capacity must be a positive integer greater than 0.'
        });
      }

      const sRes = await pool.query('SELECT * FROM slots WHERE slot_id = $1', [id]);
      if (sRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Slot not found.' });
      }

      const slot = sRes.rows[0];
      if (newCapacity < slot.booked_count) {
        return res.status(400).json({
          error: 'capacity_too_low',
          message: `Cannot set capacity to ${newCapacity}. This slot already has ${slot.booked_count} confirmed farmer bookings.`
        });
      }

      await pool.query('UPDATE slots SET max_farmers = $1 WHERE slot_id = $2', [newCapacity, id]);
      await recordAdminAudit(req.user, 'UPDATE_SLOT_CAPACITY', 'SLOT', id, 'SUCCESS', {
        previous_capacity: slot.max_farmers,
        new_capacity: newCapacity,
        booked_count: slot.booked_count
      });

      res.json({
        success: true,
        message: `Capacity for slot ${id} updated to ${newCapacity}.`,
        slot_id: id,
        max_farmers: newCapacity
      });
    } catch (err) {
      console.error('Super Admin update slot capacity error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update slot capacity.' });
    }
  });

  // POST /api/super-admin/slots/generate
  router.post('/slots/generate', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { centre_id, date } = req.body;

      if (!centre_id || !date) {
        return res.status(400).json({ error: 'missing_fields', message: 'centre_id and date are required.' });
      }

      if (isPastDate(date)) {
        return res.status(400).json({ error: 'past_date', message: 'Cannot generate slots for past dates.' });
      }

      const cRes = await pool.query('SELECT centre_id, operational_status FROM centres WHERE centre_id = $1', [centre_id]);
      if (cRes.rows.length === 0) {
        return res.status(404).json({ error: 'centre_not_found', message: 'Centre not found.' });
      }

      if (cRes.rows[0].operational_status !== 'OPEN') {
        return res.status(400).json({
          error: 'centre_not_open',
          message: `Cannot generate slots. Centre ${centre_id} is currently ${cRes.rows[0].operational_status}.`
        });
      }

      await ensureCentreSlots(pool, centre_id, date);
      await recordAdminAudit(req.user, 'GENERATE_SLOTS', 'SLOT', `${centre_id}_${date}`, 'SUCCESS', { centre_id, date });

      const generated = await pool.query('SELECT * FROM slots WHERE centre_id = $1 AND date = $2 ORDER BY start_time ASC', [centre_id, date]);

      res.json({
        success: true,
        message: `Slots for centre ${centre_id} on ${date} verified and generated.`,
        slotsCount: generated.rows.length,
        slots: generated.rows
      });
    } catch (err) {
      console.error('Super Admin generate slots error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to generate slots.' });
    }
  });

  // =========================================================================
  // 7. BOOKING MANAGEMENT
  // =========================================================================

  // GET /api/super-admin/bookings
  router.get('/bookings', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
      const offset = (page - 1) * limit;

      const { search, district, centre_id, date, status } = req.query;
      const conditions = [];
      const params = [];

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        conditions.push(`(
          LOWER(b.booking_id) LIKE $${params.length} OR
          LOWER(b.farmer_id) LIKE $${params.length} OR
          LOWER(COALESCE(b.token, '')) LIKE $${params.length} OR
          LOWER(COALESCE(f.name, '')) LIKE $${params.length} OR
          LOWER(COALESCE(f.phone, '')) LIKE $${params.length}
        )`);
      }

      if (district && district.trim()) {
        params.push(district.trim());
        conditions.push(`LOWER(COALESCE(c.district, f.district)) = LOWER($${params.length})`);
      }

      if (centre_id && centre_id.trim()) {
        params.push(centre_id.trim().toUpperCase());
        conditions.push(`b.centre_id = $${params.length}`);
      }

      if (date && date.trim()) {
        params.push(date.trim());
        conditions.push(`b.booking_date = $${params.length}`);
      }

      if (status && status.trim()) {
        params.push(status.trim().toUpperCase());
        conditions.push(`b.status = $${params.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(
        `SELECT COUNT(*) as count
         FROM bookings b
         LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
         LEFT JOIN centres c ON b.centre_id = c.centre_id
         ${whereClause}`,
        params
      );
      const total = parseInt(countRes.rows[0].count, 10);

      params.push(limit, offset);
      const query = `
        SELECT b.booking_id, b.farmer_id, f.name as farmer_name, f.phone as farmer_phone,
               b.centre_id, c.centre_name, c.district as centre_district,
               b.slot_id, b.booking_date, b.crop, b.quantity_quintals, b.status,
               b.token, b.grading_result, b.procured_quantity_quintals, b.payment_status,
               b.created_at
        FROM bookings b
        LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
        LEFT JOIN centres c ON b.centre_id = c.centre_id
        ${whereClause}
        ORDER BY b.booking_date DESC, b.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const listRes = await pool.query(query, params);

      res.json({
        success: true,
        bookings: listRes.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      console.error('Super Admin fetch bookings error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch bookings.' });
    }
  });

  // GET /api/super-admin/bookings/:id
  router.get('/bookings/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const bRes = await pool.query(
        `SELECT b.*, f.name as farmer_name, f.phone as farmer_phone, f.village as farmer_village, f.district as farmer_district,
                c.centre_name, c.district as centre_district, s.start_time, s.end_time
         FROM bookings b
         LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
         LEFT JOIN centres c ON b.centre_id = c.centre_id
         LEFT JOIN slots s ON b.slot_id = s.slot_id
         WHERE b.booking_id = $1`,
        [id]
      );

      if (bRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Booking not found.' });
      }

      const booking = bRes.rows[0];

      // Grab related Phase 7.3 procurement records if present
      const [quality, weighment, acceptance, receipt, payment, history] = await Promise.all([
        pool.query('SELECT * FROM procurement_quality WHERE booking_id = $1', [id]),
        pool.query('SELECT * FROM procurement_weighments WHERE booking_id = $1', [id]),
        pool.query('SELECT * FROM procurement_acceptances WHERE booking_id = $1', [id]),
        pool.query('SELECT * FROM procurement_receipts WHERE booking_id = $1', [id]),
        pool.query('SELECT * FROM procurement_payments WHERE booking_id = $1', [id]),
        pool.query('SELECT * FROM status_history WHERE booking_id = $1 ORDER BY changed_at ASC', [id])
      ]);

      res.json({
        success: true,
        booking,
        records: {
          quality: quality.rows[0] || null,
          weighment: weighment.rows[0] || null,
          acceptance: acceptance.rows[0] || null,
          receipt: receipt.rows[0] || null,
          payment: payment.rows[0] || null,
          history: history.rows
        }
      });
    } catch (err) {
      console.error('Super Admin get booking error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to retrieve booking.' });
    }
  });

  // PATCH /api/super-admin/bookings/:id/status
  router.patch('/bookings/:id/status', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { new_status, reason, notes } = req.body;

      const validStatuses = [
        'BOOKED',
        'CONFIRMED',
        'CHECKED_IN',
        'GRADING',
        'PROCURED',
        'PAYMENT_PENDING',
        'PAYMENT_COMPLETED',
        'CANCELLED'
      ];

      if (!new_status || !validStatuses.includes(new_status.toUpperCase())) {
        return res.status(400).json({
          error: 'invalid_status',
          message: `Status must be one of: ${validStatuses.join(' → ')}`
        });
      }

      const bRes = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [id]);
      if (bRes.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Booking not found.' });
      }

      const current = bRes.rows[0];
      const targetStatus = new_status.toUpperCase();

      await pool.query('UPDATE bookings SET status = $1 WHERE booking_id = $2', [targetStatus, id]);

      // Record in status_history
      await pool.query(
        `INSERT INTO status_history (booking_id, status, notes)
         VALUES ($1, $2, $3)`,
        [id, targetStatus, `Super Admin Override by ${req.user.username}: ${reason || notes || 'Administrative lifecycle update'}`]
      );

      await recordAdminAudit(req.user, 'UPDATE_BOOKING_STATUS', 'BOOKING', id, 'SUCCESS', {
        previous_status: current.status,
        new_status: targetStatus,
        reason
      });

      res.json({
        success: true,
        message: `Booking ${id} status updated to ${targetStatus}.`,
        booking_id: id,
        previous_status: current.status,
        new_status: targetStatus
      });
    } catch (err) {
      console.error('Super Admin update booking status error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update booking status.' });
    }
  });

  // =========================================================================
  // 8. WEBSITE CONTENT MANAGEMENT
  // =========================================================================

  // GET /api/super-admin/content
  router.get('/content', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const q = await pool.query('SELECT * FROM website_content ORDER BY priority ASC, updated_at DESC');
      res.json({
        success: true,
        content: q.rows
      });
    } catch (err) {
      console.error('Super Admin fetch content error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch website content.' });
    }
  });

  // POST /api/super-admin/content
  router.post('/content', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { content_key, title, category, content, priority, is_active } = req.body;

      if (!content_key || !title || !category || !content) {
        return res.status(400).json({
          error: 'missing_fields',
          message: 'Key, Title, Category, and Content are required.'
        });
      }

      const cleanKey = content_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const existing = await pool.query('SELECT id FROM website_content WHERE content_key = $1', [cleanKey]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'duplicate_key', message: `Content key "${cleanKey}" already exists.` });
      }

      const ins = await pool.query(
        `INSERT INTO website_content (content_key, title, category, content, priority, is_active, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          cleanKey,
          title.trim(),
          category.trim().toUpperCase(),
          content.trim(),
          parseInt(priority, 10) || 0,
          typeof is_active === 'boolean' ? is_active : true,
          req.user.username
        ]
      );

      await recordAdminAudit(req.user, 'CREATE_CONTENT', 'CONTENT', cleanKey, 'SUCCESS', { title, category });

      res.status(201).json({
        success: true,
        message: 'Website content published successfully.',
        item: ins.rows[0]
      });
    } catch (err) {
      console.error('Super Admin create content error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to save website content.' });
    }
  });

  // PUT /api/super-admin/content/:id
  router.put('/content/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const { title, category, content, priority, is_active } = req.body;

      const check = await pool.query('SELECT * FROM website_content WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Content item not found.' });
      }

      const current = check.rows[0];

      await pool.query(
        `UPDATE website_content
         SET title = $1, category = $2, content = $3, priority = $4, is_active = $5, updated_by = $6, updated_at = NOW()
         WHERE id = $7`,
        [
          title ? title.trim() : current.title,
          category ? category.trim().toUpperCase() : current.category,
          content ? content.trim() : current.content,
          priority !== undefined ? parseInt(priority, 10) : current.priority,
          typeof is_active === 'boolean' ? is_active : current.is_active,
          req.user.username,
          id
        ]
      );

      await recordAdminAudit(req.user, 'UPDATE_CONTENT', 'CONTENT', current.content_key, 'SUCCESS', { title, is_active });

      res.json({
        success: true,
        message: 'Content updated successfully.'
      });
    } catch (err) {
      console.error('Super Admin update content error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update website content.' });
    }
  });

  // DELETE /api/super-admin/content/:id
  router.delete('/content/:id', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { id } = req.params;
      const check = await pool.query('SELECT * FROM website_content WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Content item not found.' });
      }

      await pool.query('DELETE FROM website_content WHERE id = $1', [id]);
      await recordAdminAudit(req.user, 'DELETE_CONTENT', 'CONTENT', check.rows[0].content_key, 'SUCCESS');

      res.json({
        success: true,
        message: 'Content item removed successfully.'
      });
    } catch (err) {
      console.error('Super Admin delete content error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to remove content item.' });
    }
  });

  // =========================================================================
  // 9. SYSTEM SETTINGS
  // =========================================================================

  // GET /api/super-admin/settings
  router.get('/settings', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const q = await pool.query('SELECT * FROM system_settings ORDER BY category ASC, setting_key ASC');
      res.json({
        success: true,
        settings: q.rows
      });
    } catch (err) {
      console.error('Super Admin fetch settings error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to fetch settings.' });
    }
  });

  // PUT /api/super-admin/settings/:key
  router.put('/settings/:key', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const { key } = req.params;
      const { setting_value } = req.body;

      if (setting_value === undefined || setting_value === null) {
        return res.status(400).json({ error: 'missing_value', message: 'setting_value is required.' });
      }

      const check = await pool.query('SELECT * FROM system_settings WHERE setting_key = $1', [key]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: `Setting "${key}" not recognized.` });
      }

      await pool.query(
        'UPDATE system_settings SET setting_value = $1, updated_by = $2, updated_at = NOW() WHERE setting_key = $3',
        [String(setting_value).trim(), req.user.username, key]
      );

      await recordAdminAudit(req.user, 'UPDATE_SETTING', 'SETTING', key, 'SUCCESS', {
        previous_value: check.rows[0].setting_value,
        new_value: setting_value
      });

      res.json({
        success: true,
        message: `Setting "${key}" updated successfully.`,
        setting_key: key,
        setting_value
      });
    } catch (err) {
      console.error('Super Admin update setting error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update system setting.' });
    }
  });

  // =========================================================================
  // 10. AUDIT LOGS
  // =========================================================================

  // GET /api/super-admin/audit-logs
  router.get('/audit-logs', authenticateToken, requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const { search, action, resource_type } = req.query;
      const conditions = [];
      const params = [];

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        conditions.push(`(
          LOWER(admin_username) LIKE $${params.length} OR
          LOWER(action) LIKE $${params.length} OR
          LOWER(resource_type) LIKE $${params.length} OR
          LOWER(COALESCE(resource_id, '')) LIKE $${params.length}
        )`);
      }

      if (action && action.trim()) {
        params.push(action.trim().toUpperCase());
        conditions.push(`action = $${params.length}`);
      }

      if (resource_type && resource_type.trim()) {
        params.push(resource_type.trim().toUpperCase());
        conditions.push(`resource_type = $${params.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*) as count FROM admin_audit_logs ${whereClause}`, params);
      const total = parseInt(countRes.rows[0].count, 10);

      params.push(limit, offset);
      const query = `
        SELECT id, admin_id, admin_username, action, resource_type, resource_id, status, details, created_at
        FROM admin_audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const listRes = await pool.query(query, params);

      res.json({
        success: true,
        logs: listRes.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      console.error('Super Admin fetch audit logs error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to retrieve administrative audit logs.' });
    }
  });

  return router;
}

module.exports = {
  createSuperAdminRouter
};
