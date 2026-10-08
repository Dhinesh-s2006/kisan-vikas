/**
 * KISAN QUEUE — Farmer Notification Service
 * Centralized, zero-external-cost in-app notification engine.
 * 
 * Features:
 * - Safe non-blocking execution (never crashes business transactions)
 * - Strict farmer ownership validation & IDOR isolation
 * - Built-in idempotency protection against duplicate spam
 * - Type-safe event dispatching
 */

const NOTIFICATION_TYPES = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  PACING_ADVISORY: 'PACING_ADVISORY',
  PROCUREMENT_QUALITY: 'PROCUREMENT_QUALITY',
  PROCUREMENT_WEIGHMENT: 'PROCUREMENT_WEIGHMENT',
  PROCUREMENT_COMPLETED: 'PROCUREMENT_COMPLETED',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  GRIEVANCE_SUBMITTED: 'GRIEVANCE_SUBMITTED',
  GRIEVANCE_UPDATED: 'GRIEVANCE_UPDATED',
  GRIEVANCE_CONFIRMATION: 'GRIEVANCE_CONFIRMATION',
  GRIEVANCE_REOPENED: 'GRIEVANCE_REOPENED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  SYSTEM_INFORMATION: 'SYSTEM_INFORMATION'
};

const PRIORITIES = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  SUCCESS: 'SUCCESS'
};

/**
 * Creates an in-app farmer notification with built-in idempotency checks.
 */
async function createFarmerNotification(pool, payload) {
  const farmerId = payload.farmerId || payload.farmer_id;
  const type = payload.type || payload.notification_type;
  const title = payload.title;
  const message = payload.message;
  const priority = payload.priority || (payload.actionRequired || payload.action_required ? PRIORITIES.ACTION_REQUIRED : PRIORITIES.INFO);
  const actionRequired = Boolean(payload.actionRequired !== undefined ? payload.actionRequired : payload.action_required);
  const actionUrl = payload.actionUrl || payload.action_url || payload.link || null;
  const bookingId = payload.bookingId || payload.booking_id || (payload.entity_type === 'BOOKING' ? payload.entity_id : null);
  const grievanceId = payload.grievanceId || payload.grievance_id || (payload.entity_type === 'GRIEVANCE' ? payload.entity_id : null);
  const centreId = payload.centreId || payload.centre_id || (payload.entity_type === 'CENTRE' ? payload.entity_id : null);
  const idempotent = payload.idempotent !== undefined ? payload.idempotent : true;

  if (!farmerId || !type || !title || !message) {
    console.warn('[NotificationService] Missing required fields for notification:', { farmerId, type, title });
    return null;
  }

  function formatRow(r) {
    if (!r) return null;
    return {
      ...r,
      id: r.notification_id,
      type: r.notification_type,
      link: r.action_url
    };
  }

  try {
    // Idempotency: Prevent duplicate notifications on repeated API calls or page refreshes
    if (idempotent) {
      if (type === NOTIFICATION_TYPES.BOOKING_CONFIRMED && bookingId) {
        const existing = await pool.query(
          'SELECT * FROM notifications WHERE farmer_id = $1 AND notification_type = $2 AND related_booking_id = $3 LIMIT 1',
          [farmerId, type, bookingId]
        );
        if (existing.rows.length > 0) return formatRow(existing.rows[0]);
      } else if (type === NOTIFICATION_TYPES.GRIEVANCE_CONFIRMATION && grievanceId) {
        const existing = await pool.query(
          'SELECT * FROM notifications WHERE farmer_id = $1 AND notification_type = $2 AND related_grievance_id = $3 AND is_read = FALSE LIMIT 1',
          [farmerId, type, grievanceId]
        );
        if (existing.rows.length > 0) return formatRow(existing.rows[0]);
      } else if (type === NOTIFICATION_TYPES.PACING_ADVISORY && (bookingId || payload.entity_id)) {
        // Prevent duplicate pacing notifications within 30 minutes for the same booking
        const refId = bookingId || payload.entity_id;
        const existing = await pool.query(
          `SELECT * FROM notifications 
           WHERE farmer_id = $1 AND notification_type = $2 AND (related_booking_id = $3 OR message = $4)
             AND created_at > NOW() - INTERVAL '30 minutes' 
           LIMIT 1`,
          [farmerId, type, refId, message]
        );
        if (existing.rows.length > 0) return formatRow(existing.rows[0]);
      } else if (type === NOTIFICATION_TYPES.PROCUREMENT_COMPLETED && bookingId) {
        const existing = await pool.query(
          'SELECT * FROM notifications WHERE farmer_id = $1 AND notification_type = $2 AND related_booking_id = $3 LIMIT 1',
          [farmerId, type, bookingId]
        );
        if (existing.rows.length > 0) return formatRow(existing.rows[0]);
      } else if (type === NOTIFICATION_TYPES.PAYMENT_COMPLETED && bookingId) {
        const existing = await pool.query(
          'SELECT * FROM notifications WHERE farmer_id = $1 AND notification_type = $2 AND related_booking_id = $3 LIMIT 1',
          [farmerId, type, bookingId]
        );
        if (existing.rows.length > 0) return formatRow(existing.rows[0]);
      }
    }

    const res = await pool.query(`
      INSERT INTO notifications (
        farmer_id, notification_type, title, message, priority,
        action_required, action_url, related_booking_id,
        related_grievance_id, related_centre_id, is_read, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, NOW())
      RETURNING *
    `, [
      farmerId,
      type,
      title,
      message,
      priority,
      Boolean(actionRequired),
      actionUrl || null,
      bookingId || null,
      grievanceId || null,
      centreId || null
    ]);

    return formatRow(res.rows[0]);
  } catch (err) {
    // Non-blocking: never crash the parent business transaction
    console.error('[NotificationService] Error creating notification:', err.message);
    return null;
  }
}

/**
 * Fetch notifications for an authenticated farmer.
 */
async function getFarmerNotifications(pool, farmerId, options = {}) {
  const { unreadOnly = false, actionRequiredOnly = false, limit = 50 } = options;

  let query = `
    SELECT 
      notification_id,
      notification_id AS id,
      notification_type,
      notification_type AS type,
      title,
      message,
      priority,
      action_required,
      action_url,
      action_url AS link,
      related_booking_id,
      related_grievance_id,
      related_centre_id,
      is_read,
      read_at,
      created_at
    FROM notifications
    WHERE farmer_id = $1
  `;
  const params = [farmerId];

  if (unreadOnly) {
    query += ` AND is_read = FALSE`;
  }

  if (actionRequiredOnly) {
    query += ` AND action_required = TRUE`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Get unread notification count for an authenticated farmer.
 */
async function getUnreadCount(pool, farmerId) {
  const res = await pool.query(
    'SELECT COUNT(*)::int as count FROM notifications WHERE farmer_id = $1 AND is_read = FALSE',
    [farmerId]
  );
  return res.rows[0]?.count || 0;
}

/**
 * Mark a single notification as read with strict farmer ownership enforcement.
 */
async function markNotificationAsRead(pool, notificationId, farmerId) {
  // Check existence and ownership
  const check = await pool.query(
    'SELECT notification_id, farmer_id FROM notifications WHERE notification_id = $1',
    [notificationId]
  );

  if (check.rows.length === 0) {
    return { found: false, allowed: false, updated: false };
  }

  if (check.rows[0].farmer_id !== farmerId) {
    return { found: true, allowed: false, updated: false };
  }

  const res = await pool.query(
    'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE notification_id = $1 AND farmer_id = $2 RETURNING *',
    [notificationId, farmerId]
  );

  return { found: true, allowed: true, updated: true, notification: res.rows[0] };
}

/**
 * Mark all unread notifications as read for an authenticated farmer.
 */
async function markAllNotificationsAsRead(pool, farmerId) {
  const res = await pool.query(
    'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE farmer_id = $1 AND is_read = FALSE RETURNING notification_id',
    [farmerId]
  );
  return res.rowCount || 0;
}

/**
 * Safe no-op: notifications must be strictly user-specific and generated from real business events.
 * Never creates canned or fake global demo notifications.
 */
async function seedDemoNotifications(pool, farmerId) {
  return 0;
}

module.exports = {
  NOTIFICATION_TYPES,
  PRIORITIES,
  createFarmerNotification,
  getFarmerNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  seedDemoNotifications
};
