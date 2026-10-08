/**
 * Canonical Booking Status Transition Service for Kisan Vikas
 * 
 * Rules:
 * 1. Preserves the official status flow:
 *    Booked -> Confirmed -> (On The Way) -> Checked-In -> Grading -> (Weighing) -> Procured -> Payment Pending -> Payment Completed
 * 2. Strict transition validation: prevents arbitrary state jumping or backwards mutation.
 * 3. Expired / No-Show handling: bookings whose slot time elapses un-arrived transition to 'Expired'.
 * 4. Rescheduling: Missed / Expired / No-Show appointments can only be reopened by allocating a valid future appointment ('Rescheduled').
 * 5. Terminal states: 'Payment Completed', 'Cancelled', 'Rescheduled' cannot be transitioned.
 */

const ALLOWED_TRANSITIONS = {
  'Booked': ['Confirmed', 'Cancelled', 'No-Show', 'Expired'],
  'Confirmed': ['On The Way', 'Checked-In', 'Cancelled', 'No-Show', 'Expired'],
  'On The Way': ['Checked-In', 'Cancelled', 'No-Show', 'Expired'],
  'Checked-In': ['Grading', 'Cancelled'],
  'Grading': ['Weighing', 'Procured', 'Cancelled'],
  'Weighing': ['Procured', 'Cancelled'],
  'Procured': ['Payment Pending', 'Payment Completed'],
  'Payment Pending': ['Payment Completed'],
  'Payment Completed': [],
  'Cancelled': [],
  'No-Show': ['Rescheduled'],
  'Expired': ['Rescheduled'],
  'Rescheduled': []
};

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS);

/**
 * Validates if a transition from currentStatus to newStatus is permissible.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {{ valid: boolean, error?: string, allowed?: string[] }}
 */
function validateStatusTransition(currentStatus, newStatus) {
  if (!newStatus || !ALL_STATUSES.includes(newStatus)) {
    return {
      valid: false,
      error: `Invalid target status '${newStatus}'. Allowed statuses: ${ALL_STATUSES.join(', ')}`
    };
  }

  // Idempotent: setting same status is permitted without error
  if (currentStatus === newStatus) {
    return { valid: true };
  }

  const allowedNext = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowedNext) {
    return {
      valid: false,
      error: `Unknown current booking status '${currentStatus}'.`
    };
  }

  if (allowedNext.length === 0) {
    return {
      valid: false,
      error: `Booking is in terminal status '${currentStatus}' and cannot be transitioned further.`
    };
  }

  if (!allowedNext.includes(newStatus)) {
    return {
      valid: false,
      error: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Permitted transitions: ${allowedNext.join(', ')}`,
      allowed: allowedNext
    };
  }

  return { valid: true };
}

/**
 * Determines whether a booking status represents an active physical presence at the centre.
 * @param {string} status
 * @returns {boolean}
 */
function isPhysicalYardPresence(status) {
  return ['Checked-In', 'Grading', 'Weighing'].includes(status);
}

/**
 * Determines whether a booking status is a historical missed or elapsed visit.
 * @param {string} status
 * @returns {boolean}
 */
function isMissedOrExpired(status) {
  return ['Expired', 'No-Show', 'Missed Visit'].includes(status);
}

module.exports = {
  ALLOWED_TRANSITIONS,
  ALL_STATUSES,
  validateStatusTransition,
  isPhysicalYardPresence,
  isMissedOrExpired
};
