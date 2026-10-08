/**
 * Canonical Slot Generation and Availability Service for Kisan Vikas
 * 
 * Rules:
 * 1. Timezone: Asia/Kolkata.
 * 2. Operating hours: 8 hourly windows from 08:00 to 16:00.
 * 3. Daily capacity: Based on centre's configured daily_capacity_slots.
 *    slot_capacity = Math.max(1, Math.floor(daily_capacity_slots / 8)).
 * 4. Safe and idempotent: Uses ON CONFLICT (slot_id) DO NOTHING.
 * 5. Closed centres: Never generate active slots for closed/retired centres.
 * 6. Expired slots: Rejects past dates and past times on the current day.
 */

const { getKolkataNow, normalizeDateStr, isSlotExpired } = require('./slotValidation');

const STANDARD_HOURLY_SLOTS = [
  ['08:00:00', '09:00:00'],
  ['09:00:00', '10:00:00'],
  ['10:00:00', '11:00:00'],
  ['11:00:00', '12:00:00'],
  ['12:00:00', '13:00:00'],
  ['13:00:00', '14:00:00'],
  ['14:00:00', '15:00:00'],
  ['15:00:00', '16:00:00']
];

/**
 * Ensures that slot records exist in the database for the given centre and date range.
 * Idempotent: Never overwrites existing slots or existing bookings.
 * 
 * @param {object} pool - PostgreSQL pool or client
 * @param {string} centreId - Centre ID (e.g. 'TN_DPC_0002')
 * @param {string} startDateStr - YYYY-MM-DD
 * @param {number} daysCount - Number of days to generate (default 7)
 * @returns {Promise<Array<object>>} - List of slots created or existing
 */
async function ensureCentreSlots(pool, centreId, startDateStr, daysCount = 7) {
  if (!centreId) return [];

  const cleanStartDate = normalizeDateStr(startDateStr) || getKolkataNow().todayStr;
  const { todayStr } = getKolkataNow();

  // 1. Fetch centre metadata
  const cRes = await pool.query(
    `SELECT centre_id, centre_name, district, operational_status, daily_capacity_slots, opening_date, closing_date
     FROM centres WHERE centre_id = $1`,
    [centreId]
  );

  if (cRes.rows.length === 0) return [];
  const centre = cRes.rows[0];

  const status = (centre.operational_status || '').trim().toLowerCase();
  if (status === 'closed' || status === 'retired') {
    return [];
  }

  const dailyCap = Math.max(8, Number(centre.daily_capacity_slots) || 40);
  const maxFarmersPerSlot = Math.max(1, Math.floor(dailyCap / STANDARD_HOURLY_SLOTS.length));

  const allSlots = [];

  const [startY, startM, startD] = cleanStartDate.split('-').map(Number);
  const startUtc = new Date(Date.UTC(startY, startM - 1, startD));

  for (let d = 0; d < daysCount; d++) {
    const targetDateObj = new Date(startUtc);
    targetDateObj.setUTCDate(startUtc.getUTCDate() + d);
    const year = targetDateObj.getUTCFullYear();
    const month = String(targetDateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(targetDateObj.getUTCDate()).padStart(2, '0');
    const targetDateStr = `${year}-${month}-${day}`;

    // Skip past dates
    if (targetDateStr < todayStr) {
      continue;
    }

    // Check opening date constraint if present
    if (centre.opening_date) {
      const openDateStr = normalizeDateStr(centre.opening_date);
      if (openDateStr && targetDateStr < openDateStr) {
        continue;
      }
    }

    // Check closing date constraint if present
    // Only a planned future closing date (closeDateStr >= todayStr) should constrain slot creation.
    // If a centre is Open/Active, any historical closing date in the past (closeDateStr < todayStr) is stale and ignored.
    if (centre.closing_date) {
      const closeDateStr = normalizeDateStr(centre.closing_date);
      if (closeDateStr && closeDateStr >= todayStr && targetDateStr > closeDateStr) {
        continue;
      }
    }

    const dateClean = targetDateStr.replace(/-/g, '');

    for (const [startTime, endTime] of STANDARD_HOURLY_SLOTS) {
      const timeClean = startTime.slice(0, 5).replace(':', '');
      const slotId = `${centreId}_${dateClean}_${timeClean}`;

      const insertRes = await pool.query(
        `INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0)
         ON CONFLICT (slot_id) DO NOTHING
         RETURNING *`,
        [slotId, centreId, targetDateStr, startTime, endTime, maxFarmersPerSlot]
      );

      if (insertRes.rows.length > 0) {
        allSlots.push(insertRes.rows[0]);
      }
    }
  }

  return allSlots;
}

/**
 * Retrieves slots for a centre on a given date with full status decoration.
 * Guarantees that slots are created if the centre is operational and valid.
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {string} centreId - Centre ID
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} [authenticatedFarmerId] - Farmer ID for booked_by_user checks
 * @returns {Promise<object>} - Decorated slots array with metadata
 */
async function getCentreSlotsWithAvailability(pool, centreId, dateStr, authenticatedFarmerId = null) {
  if (!centreId) {
    return {
      error: 'missing_centre_id',
      error_code: 'CENTRE_NOT_FOUND',
      message: 'Centre ID is required.',
      slots: []
    };
  }

  const cleanDate = normalizeDateStr(dateStr);
  const { todayStr } = getKolkataNow();

  // 1. Verify centre exists and operational status
  const cRes = await pool.query(
    `SELECT centre_id, centre_name, district, operational_status, daily_capacity_slots, opening_date, closing_date
     FROM centres WHERE centre_id = $1`,
    [centreId]
  );

  if (cRes.rows.length === 0) {
    return {
      error: 'centre_not_found',
      error_code: 'CENTRE_NOT_FOUND',
      message: `Procurement centre '${centreId}' not found.`,
      slots: []
    };
  }

  const centre = cRes.rows[0];
  const status = (centre.operational_status || '').trim().toLowerCase();
  const isClosed = status === 'closed' || status === 'retired';

  if (isClosed) {
    const closedResult = [];
    closedResult.centre_id = centreId;
    closedResult.centre_name = centre.centre_name;
    closedResult.operational_status = centre.operational_status || 'Closed';
    closedResult.error_code = 'CENTRE_CLOSED';
    closedResult.message = `Procurement centre ${centre.centre_name || centreId} is currently closed for operations.`;
    closedResult.slots = [];
    return closedResult;
  }

  // 2. Date validation
  if (!cleanDate) {
    const invalidDateResult = [];
    invalidDateResult.error_code = 'INVALID_DATE';
    invalidDateResult.message = 'A valid date is required.';
    invalidDateResult.slots = [];
    return invalidDateResult;
  }

  if (cleanDate < todayStr) {
    const pastResult = [];
    pastResult.centre_id = centreId;
    pastResult.error_code = 'PAST_DATE';
    pastResult.message = `Cannot view or book slots for a past date (${cleanDate}). Today is ${todayStr}.`;
    pastResult.slots = [];
    return pastResult;
  }

  // 3. Ensure slots exist for this centre and date
  await ensureCentreSlots(pool, centreId, cleanDate, 1);

  // 4. Retrieve farmer's active booking on this date for booked_by_user decoration
  let userBookings = [];
  if (authenticatedFarmerId) {
    const ubRes = await pool.query(
      `SELECT slot_id, booking_id, status FROM bookings
       WHERE farmer_id = $1 AND centre_id = $2 AND booking_date = $3
         AND status NOT IN ('Payment Completed', 'No-Show', 'Cancelled')`,
      [authenticatedFarmerId, centreId, cleanDate]
    );
    userBookings = ubRes.rows;
  }

  // 5. Query all slots for centre and date
  const slotsRes = await pool.query(
    `SELECT * FROM slots
     WHERE centre_id = $1 AND date = $2
     ORDER BY start_time ASC`,
    [centreId, cleanDate]
  );

  const decoratedSlots = slotsRes.rows.map(s => {
    const exp = isSlotExpired(s.date, s.end_time);
    const isFull = (Number(s.booked_count) + Number(s.held_count || 0)) >= Number(s.max_farmers);
    const userBooking = userBookings.find(b => b.slot_id === s.slot_id);
    const bookedByUser = !!userBooking;

    let slotStatus = 'AVAILABLE';
    if (exp.expired) slotStatus = 'EXPIRED';
    else if (bookedByUser) slotStatus = 'BOOKED_BY_YOU';
    else if (isFull) slotStatus = 'FULL';

    const isAvailable = !exp.expired && !isFull && !bookedByUser;

    return {
      ...s,
      is_expired: exp.expired,
      expiration_reason: exp.reason,
      bookable: isAvailable,
      is_available: isAvailable,
      booked_by_user: bookedByUser,
      user_booking_id: userBooking ? userBooking.booking_id : null,
      slot_status: slotStatus
    };
  });

  const availableCount = decoratedSlots.filter(s => s.bookable).length;
  const expiredCount = decoratedSlots.filter(s => s.is_expired).length;

  decoratedSlots.centre_id = centreId;
  decoratedSlots.centre_name = centre.centre_name;
  decoratedSlots.operational_status = centre.operational_status;
  decoratedSlots.date = cleanDate;
  decoratedSlots.available_count = availableCount;

  if (decoratedSlots.length === 0) {
    decoratedSlots.error_code = 'NO_SLOTS_CONFIGURED';
    decoratedSlots.message = `No slots configured for ${centre.centre_name || centreId} on ${cleanDate}.`;
  } else if (availableCount === 0) {
    if (expiredCount === decoratedSlots.length) {
      decoratedSlots.error_code = 'NO_FUTURE_SLOTS';
      decoratedSlots.message = `All slots for today (${cleanDate}) have already concluded. Please choose an upcoming date.`;
    } else {
      decoratedSlots.error_code = 'ALL_SLOTS_FULL';
      decoratedSlots.message = `All slots at ${centre.centre_name || centreId} on ${cleanDate} are fully booked.`;
    }
  }

  return decoratedSlots;
}

/**
 * Automatically expires past and concluded slots and un-arrived bookings in Asia/Kolkata timezone.
 * Safe and idempotent: updates slots table and marks un-arrived elapsed bookings as 'Expired'.
 * Does not penalize arrived farmers ('Checked-In', 'Grading', 'Weighing') or overwrite historical bookings.
 * 
 * @param {object} pool - PostgreSQL pool or client
 * @returns {Promise<{ expiredSlotsCount: number, expiredBookingsCount: number, expiredSlotIds: string[], todayStr: string, currentTimeStr: string }>}
 */
async function expirePastSlots(pool) {
  const { todayStr, currentTimeStr } = getKolkataNow();

  // 1. Expire past slot windows
  const updateRes = await pool.query(
    `UPDATE slots
     SET is_expired = TRUE,
         status = 'EXPIRED'
     WHERE (date < $1 OR (date = $1 AND end_time <= $2))
       AND (is_expired = FALSE OR status IS NULL OR status != 'EXPIRED')
     RETURNING slot_id`,
    [todayStr, currentTimeStr]
  );

  // 2. Mark un-arrived bookings whose scheduled slot has ended as 'Expired'
  // Distinguishes unarrived expiry from physical yard presence and explicit No-Show
  const bookingRes = await pool.query(
    `UPDATE bookings b
     SET status = 'Expired'
     FROM slots s
     WHERE b.slot_id = s.slot_id
       AND (b.booking_date < $1 OR (b.booking_date = $1 AND s.end_time <= $2))
       AND b.status IN ('Booked', 'Confirmed', 'Pending', 'On The Way')
     RETURNING b.booking_id`,
    [todayStr, currentTimeStr]
  );

  // Catch past date un-arrived bookings even if slot_id is unlinked
  const pastRes = await pool.query(
    `UPDATE bookings
     SET status = 'Expired'
     WHERE booking_date < $1
       AND status IN ('Booked', 'Confirmed', 'Pending', 'On The Way')
     RETURNING booking_id`,
    [todayStr]
  );

  const totalExpiredBookings = (bookingRes.rowCount || 0) + (pastRes.rowCount || 0);

  return {
    expiredCount: updateRes.rowCount || 0,
    expiredSlotsCount: updateRes.rowCount || 0,
    expiredBookingsCount: totalExpiredBookings,
    expiredSlotIds: (updateRes.rows || []).map(r => r.slot_id),
    todayStr,
    currentTimeStr
  };
}

module.exports = {
  STANDARD_HOURLY_SLOTS,
  ensureCentreSlots,
  getCentreSlotsWithAvailability,
  expirePastSlots
};
