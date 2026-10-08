/**
 * Canonical Time & Timezone Service for Kisan Vikas
 * Standard Timezone: Asia/Kolkata (Indian Standard Time, UTC+05:30)
 * 
 * Rules:
 * 1. Single clock for all booking, slot, queue, and expiry decisions.
 * 2. Standardized ISO (YYYY-MM-DD) date formatting.
 * 3. Configurable booking lookahead window (BOOKING_LOOKAHEAD_DAYS).
 */

const BOOKING_LOOKAHEAD_DAYS = parseInt(process.env.BOOKING_LOOKAHEAD_DAYS, 10) || 7;

/**
 * Returns current date and time in Asia/Kolkata timezone.
 * @param {Date} [now]
 * @returns {{ todayStr: string, currentTimeStr: string, dateObj: Date }}
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

  return { todayStr, currentTimeStr, dateObj: now };
}

/**
 * Normalizes any date representation (Date, ISO string, etc.) to YYYY-MM-DD in Asia/Kolkata.
 * @param {string|Date} dateInput
 * @returns {string} YYYY-MM-DD
 */
function normalizeDateStr(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
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
 * Generates an array of valid upcoming booking dates within BOOKING_LOOKAHEAD_DAYS.
 * @param {number} [daysAhead]
 * @param {Date} [baseDate]
 * @returns {Array<{ dateStr: string, dayNumber: number, monthName: string, label: string }>}
 */
function getValidBookingDates(daysAhead = BOOKING_LOOKAHEAD_DAYS, baseDate = new Date()) {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dates = [];
  const { todayStr } = getKolkataNow(baseDate);
  const [startY, startM, startD] = todayStr.split('-').map(Number);
  const start = new Date(Date.UTC(startY, startM - 1, startD));

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);

    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const dayNumber = d.getUTCDate();
    const monthName = MONTH_NAMES[d.getUTCMonth()];

    dates.push({
      dateStr,
      dayNumber,
      monthName,
      label: `${dayNumber} ${monthName}`
    });
  }
  return dates;
}

/**
 * Checks if a target date is strictly in the past relative to Asia/Kolkata today.
 * @param {string|Date} date
 * @returns {boolean}
 */
function isPastDate(date) {
  const dateStr = normalizeDateStr(date);
  const { todayStr } = getKolkataNow();
  return Boolean(dateStr && dateStr < todayStr);
}

module.exports = {
  BOOKING_LOOKAHEAD_DAYS,
  getKolkataNow,
  normalizeDateStr,
  getValidBookingDates,
  isPastDate
};
