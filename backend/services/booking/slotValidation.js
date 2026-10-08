/**
 * Slot Validation & Expiration Engine
 * 
 * Rules:
 * 1. Timezone: Asia/Kolkata (Indian Standard Time, UTC+05:30).
 * 2. Yesterday's slot -> REJECT (expired).
 * 3. Today's slot that already ended (currentTime >= end_time) -> REJECT (expired).
 * 4. Today's slot that has not started -> ALLOW (if capacity available).
 * 5. Today's slot in progress -> ALLOW if before end_time (if capacity available).
 * 6. Tomorrow / Future slot -> ALLOW (if capacity available).
 * 7. Capacity alone is NEVER enough: expired slot with free capacity MUST be rejected.
 */

/**
 * Returns current date and time formatted in Asia/Kolkata timezone.
 * @param {Date} [now] - Optional reference date (defaults to current time)
 * @returns {{ todayStr: string, currentTimeStr: string }}
 */
function getKolkataNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);

  const getPart = (t) => parts.find(p => p.type === t)?.value || '00';
  const todayStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  const currentTimeStr = `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;

  return { todayStr, currentTimeStr };
}

/**
 * Normalizes any date representation to YYYY-MM-DD in Asia/Kolkata.
 * @param {string|Date} dateInput
 * @returns {string} YYYY-MM-DD
 */
function normalizeDateStr(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    // If ISO string like "2026-10-02T18:30:00.000Z", extract date in Asia/Kolkata
    if (dateInput.includes('T') || dateInput.includes('Z')) {
      const d = new Date(dateInput);
      if (!isNaN(d.getTime())) {
        return getKolkataNow(d).todayStr;
      }
    }
    return dateInput.slice(0, 10);
  }
  if (dateInput instanceof Date) {
    return getKolkataNow(dateInput).todayStr;
  }
  return String(dateInput).slice(0, 10);
}

/**
 * Evaluates whether a slot is expired based on Date, Time, and Kolkata timezone.
 * @param {string|Date} slotDate - The date of the slot
 * @param {string} endTime - The end time of the slot (e.g. "09:00", "09:00:00")
 * @param {Date} [now] - Optional mock time for unit tests
 * @returns {{ expired: boolean, reason: string, slotDateStr: string, todayStr: string }}
 */
function isSlotExpired(slotDate, endTime, now = new Date()) {
  const slotDateStr = normalizeDateStr(slotDate);
  const { todayStr, currentTimeStr } = getKolkataNow(now);

  if (!slotDateStr) {
    return { expired: true, reason: 'INVALID_DATE', slotDateStr, todayStr };
  }

  // 1. Past Date (Yesterday or earlier) -> EXPIRED
  if (slotDateStr < todayStr) {
    return { expired: true, reason: 'PAST_DATE', slotDateStr, todayStr };
  }

  // 2. Future Date (Tomorrow or later) -> NOT EXPIRED
  if (slotDateStr > todayStr) {
    return { expired: false, reason: 'FUTURE_DATE', slotDateStr, todayStr };
  }

  // 3. Today: compare end_time against current Kolkata time
  const cleanEndTime = String(endTime || '00:00:00').trim();
  const normalizedEndTime = cleanEndTime.length === 5 ? `${cleanEndTime}:00` : cleanEndTime.slice(0, 8);

  // If slot has already ended -> EXPIRED
  if (currentTimeStr >= normalizedEndTime) {
    return { expired: true, reason: 'TIME_ELAPSED', slotDateStr, todayStr };
  }

  return { expired: false, reason: 'UPCOMING_OR_ACTIVE', slotDateStr, todayStr };
}

/**
 * Validates whether a slot is bookable (capacity AND time validity).
 * @param {object} slot - The slot object { date, end_time, max_farmers, booked_count, held_count }
 * @param {Date} [now] - Optional reference date for testing
 * @returns {{ bookable: boolean, reason: string }}
 */
function isSlotBookable(slot, now = new Date()) {
  if (!slot) {
    return { bookable: false, reason: 'SLOT_NOT_FOUND' };
  }

  const { expired, reason: expReason } = isSlotExpired(slot.date, slot.end_time, now);
  if (expired) {
    return { bookable: false, reason: `SLOT_EXPIRED:${expReason}` };
  }

  const maxFarmers = Number(slot.max_farmers || 0);
  const bookedCount = Number(slot.booked_count || 0);
  const heldCount = Number(slot.held_count || 0);
  const availableCapacity = maxFarmers - (bookedCount + heldCount);

  if (availableCapacity <= 0) {
    return { bookable: false, reason: 'SLOT_FULL' };
  }

  return { bookable: true, reason: 'AVAILABLE', availableCapacity };
}

/**
 * Canonical evaluation of whether an existing booking is genuinely active.
 * An appointment that is past or whose slot has expired without the farmer having arrived
 * is NOT genuinely active and must NEVER block a farmer from booking a valid future slot.
 * 
 * Rules:
 * 1. Statuses 'Procured', 'Payment Pending', 'Payment Completed', 'No-Show', 'Cancelled', 'Expired', 'Missed Visit', 'Rescheduled' -> NOT active.
 * 2. If booking_date < todayStr -> NOT active (expired).
 * 3. If booking_date == todayStr:
 *    - If physically checked in / processing ('Checked-In', 'Grading', 'Weighing') -> ACTIVE!
 *    - If not checked in: check if slot expired (isSlotExpired(booking_date, end_time)).
 *      If expired -> NOT active (expired).
 *      If not expired -> ACTIVE.
 * 4. If booking_date > todayStr -> ACTIVE (valid future appointment).
 */
function isBookingGenuinelyActive(booking, now = new Date()) {
  if (!booking) return { active: false, reason: 'NO_BOOKING' };

  const inactiveStatuses = [
    'Procured', 'Payment Pending', 'Payment Completed',
    'No-Show', 'Cancelled', 'Expired', 'Missed Visit', 'Rescheduled'
  ];
  const status = (booking.status || '').trim();
  if (inactiveStatuses.includes(status)) {
    return { active: false, reason: `INACTIVE_STATUS:${status}`, expired: status === 'Expired' || status === 'Missed Visit' };
  }

  // 1. Physically checked in / processing ('Checked-In', 'Grading', 'Weighing') -> ALWAYS ACTIVE!
  // A farmer who has already arrived is protected until workflow completes.
  const isPhysicalPresence = ['Checked-In', 'Grading', 'Weighing'].includes(status);
  if (isPhysicalPresence) {
    return { active: true, reason: 'YARD_PROCESSING', inYard: true };
  }

  const { todayStr } = getKolkataNow(now);
  const bookingDateStr = normalizeDateStr(booking.booking_date);

  // 2. Unarrived and past date -> expired
  if (bookingDateStr < todayStr) {
    return { active: false, reason: 'PAST_DATE', expired: true };
  }

  // 3. Today -> evaluate slot end time
  if (bookingDateStr === todayStr) {
    const endTime = booking.end_time || '23:59:59';
    const exp = isSlotExpired(bookingDateStr, endTime, now);
    if (exp.expired) {
      return { active: false, reason: `SLOT_TIME_PASSED:${exp.reason}`, expired: true };
    }
    return { active: true, reason: 'TODAY_ACTIVE_UPCOMING' };
  }

  // 3. Future date -> active appointment
  return { active: true, reason: 'FUTURE_APPOINTMENT' };
}

module.exports = {
  getKolkataNow,
  normalizeDateStr,
  isSlotExpired,
  isSlotBookable,
  isBookingGenuinelyActive
};
