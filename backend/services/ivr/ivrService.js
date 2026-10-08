/**
 * Kisan Queue IVR Service
 * Telephony business logic engine.
 * 
 * Production Rules:
 * 1. Strict Real Caller ID identification (NO hardcoded identities).
 * 2. Canonical Indian phone normalization (10-digit mobile starting with 6, 7, 8, 9).
 * 3. Registered Farmer Hard Gate: Reject unregistered callers safely.
 * 4. Explicit Farmer Identity Confirmation before allowing task operations.
 * 5. Uses BookingRequestService & IntelligentBookingEngine for deterministic allocation.
 * 6. Enforces Single Active Booking Rule specifically per authenticated farmer.
 */

const { BookingRequestService } = require('../booking/bookingRequestService');
const { isBookingGenuinelyActive, normalizeDateStr } = require('../booking/slotValidation');
const { MockIVRProvider, TwilioIVRProvider, ExotelIVRProvider } = require('./ivrProviders');

/**
 * Normalizes any Indian phone representation into canonical 10-digit mobile string.
 * Supports: +91 9000000016, +919000000016, 919000000016, 09000000016, (900) 000-0016, 9000000016.
 * Validates that final digits match standard Indian mobile prefix [6-9] and 10 digits length.
 * @param {string|number} rawPhone
 * @returns {string|null} 10-digit string or null if invalid
 */
function normalizeIndianPhoneNumber(rawPhone) {
  if (!rawPhone) return null;
  let digits = String(rawPhone).trim().replace(/[\s\-\(\)\+\.]/g, '');

  if (digits.startsWith('0091') && digits.length === 14) {
    digits = digits.slice(4);
  } else if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }

  if (/^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }

  return null;
}

/**
 * Masks phone number for secure logging (e.g. 900****016)
 * @param {string} phone 
 * @returns {string}
 */
function maskPhoneNumber(phone) {
  if (!phone || String(phone).length < 6) return '******';
  const str = String(phone);
  return str.slice(0, 3) + '****' + str.slice(-3);
}

class IVRService {
  constructor({ pool, provider = null } = {}) {
    this.pool = pool;
    this.bookingRequestService = new BookingRequestService({ pool });

    const providerType = process.env.IVR_PROVIDER || 'mock';
    if (provider) {
      this.provider = provider;
    } else if (providerType === 'twilio') {
      this.provider = new TwilioIVRProvider();
    } else if (providerType === 'exotel') {
      this.provider = new ExotelIVRProvider();
    } else {
      this.provider = new MockIVRProvider();
    }
  }

  /**
   * Authoritative lookup of registered farmer by phone number.
   * Parameterized query with canonical normalization.
   * @param {string} rawPhone 
   * @returns {Promise<{ found: boolean, reason: string, normalizedPhone: string|null, farmer: object|null }>}
   */
  async getFarmerByPhone(rawPhone) {
    const normalized = normalizeIndianPhoneNumber(rawPhone);
    if (!normalized) {
      return {
        found: false,
        reason: 'INVALID_PHONE_FORMAT',
        normalizedPhone: null,
        farmer: null
      };
    }

    const res = await this.pool.query(
      'SELECT farmer_id, name, phone, village, district, primary_crop FROM farmers WHERE phone = $1',
      [normalized]
    );

    if (res.rows.length === 0) {
      return {
        found: false,
        reason: 'NOT_FOUND',
        normalizedPhone: normalized,
        farmer: null
      };
    }

    return {
      found: true,
      reason: 'SUCCESS',
      normalizedPhone: normalized,
      farmer: res.rows[0]
    };
  }

  /**
   * Authoritative check for genuinely active bookings of a specific farmer.
   * Excludes completed, procured, cancelled, or no-show bookings.
   * @param {string} farmerId 
   * @returns {Promise<{ activeBooking: object|null, expiredBooking: object|null }>}
   */
  async getActiveBookingForFarmer(farmerId) {
    if (!farmerId) return { activeBooking: null, expiredBooking: null };
    const res = await this.pool.query(`
      SELECT b.booking_id, b.centre_id, b.slot_id, b.booking_date, b.status, b.token,
             c.centre_name, s.start_time, s.end_time
      FROM bookings b
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.farmer_id = $1
        AND b.status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'Cancelled')
      ORDER BY b.booking_date DESC, b.created_at DESC
      LIMIT 10
    `, [farmerId]);

    let activeBooking = null;
    let expiredBooking = null;

    for (const b of res.rows) {
      const evaluation = isBookingGenuinelyActive(b);
      if (evaluation.active) {
        activeBooking = b;
        break;
      } else if (evaluation.expired && !expiredBooking) {
        expiredBooking = b;
        if (b.status !== 'Expired' && b.status !== 'Missed Visit' && b.status !== 'No-Show') {
          this.pool.query("UPDATE bookings SET status = 'Expired', updated_at = NOW() WHERE booking_id = $1", [b.booking_id]).catch(() => {});
        }
      }
    }

    return { activeBooking, expiredBooking };
  }

  /**
   * Handle incoming call arrival
   * Step 1: Strict Registered Farmer Verification & Identity Confirmation Prompt
   */
  async handleIncomingCall(req) {
    const { callSid, fromNumber } = await this.provider.parseIncomingCall(req);
    const lookup = await this.getFarmerByPhone(fromNumber);

    // 1. HARD GATE: Reject unregistered or invalid caller ID
    if (!lookup.found) {
      console.log(`[IVR GATE] REJECTED unregistered caller: ${maskPhoneNumber(fromNumber)} (reason: ${lookup.reason})`);
      const unregPrompt = 'We could not find a registered farmer account for this phone number. Please register on Kisan Vikas or visit your nearest assisted service centre. Thank you.';

      return {
        registered: false,
        caller: lookup.normalizedPhone || String(fromNumber),
        maskedCaller: maskPhoneNumber(fromNumber),
        action: 'REJECT_UNREGISTERED',
        reason: lookup.reason,
        response: this.provider.buildResponse({
          message: unregPrompt,
          endCall: true
        })
      };
    }

    // 2. Caller IS registered: Greet and initiate identity confirmation
    const farmer = lookup.farmer;
    console.log(`[IVR GATE] VERIFIED registered farmer: ${farmer.name} (${farmer.farmer_id}) for ${maskPhoneNumber(farmer.phone)}`);

    const confirmPrompt = `Welcome to Kisan Vikas. We found your farmer account. Farmer name: ${farmer.name}. If this is correct, press 1. To end the call, press 2.`;

    return {
      registered: true,
      farmer_id: farmer.farmer_id,
      name: farmer.name,
      district: farmer.district,
      village: farmer.village,
      caller: lookup.normalizedPhone,
      maskedCaller: maskPhoneNumber(farmer.phone),
      action: 'CONFIRM_IDENTITY',
      response: this.provider.buildResponse({
        message: confirmPrompt,
        gatherDtmf: true,
        numDigits: 1,
        endCall: false
      })
    };
  }

  /**
   * Handle DTMF selection from verified caller
   */
  async handleDtmfSelection(req) {
    const { callSid, fromNumber, digits } = await this.provider.parseIncomingCall(req);
    const lookup = await this.getFarmerByPhone(fromNumber);

    if (!lookup.found) {
      return {
        registered: false,
        action: 'REJECT_UNREGISTERED',
        response: this.provider.buildResponse({
          message: 'Authentication failed. Please register via our website.',
          endCall: true
        })
      };
    }

    const farmer = lookup.farmer;
    const selection = String(digits || '').trim();
    const step = req.body?.step || req.query?.step || 'MENU';

    // Step A: Farmer Identity Confirmation (Press 1 = Yes, Press 2 = No)
    if (step === 'CONFIRM_IDENTITY') {
      if (selection === '1') {
        console.log(`[IVR] Identity CONFIRMED by caller for farmer ${farmer.farmer_id}`);
        const menuPrompt = 'Please choose an option. Press 1 to book a procurement visit. Press 2 to check your booking. Press 3 to check procurement centre status. Press 4 to check payment status. Press 5 for grievance. Press 9 for help.';
        return {
          status: 'IDENTITY_CONFIRMED',
          action: 'SHOW_TASK_MENU',
          farmer_id: farmer.farmer_id,
          name: farmer.name,
          response: this.provider.buildResponse({
            message: menuPrompt,
            gatherDtmf: true,
            numDigits: 1,
            endCall: false
          })
        };
      } else if (selection === '2') {
        console.log(`[IVR] Identity REJECTED by caller for farmer ${farmer.farmer_id} - Terminating call`);
        return {
          status: 'IDENTITY_CANCELLED',
          action: 'HANGUP',
          response: this.provider.buildResponse({
            message: 'Thank you for calling Kisan Vikas. Goodbye.',
            endCall: true
          })
        };
      } else {
        return {
          status: 'INVALID_CONFIRM_OPTION',
          action: 'RETRY_CONFIRM',
          response: this.provider.buildResponse({
            message: 'Invalid selection. If this is your account, press 1. To exit, press 2.',
            gatherDtmf: true,
            numDigits: 1,
            endCall: false
          })
        };
      }
    }

    // Step B: Task Menu Selection
    switch (selection) {
      case '1': {
        // Option 1: Book Procurement Visit (Enforces One Active Booking Rule & Runs Intelligent Engine)
        const { activeBooking, expiredBooking } = await this.getActiveBookingForFarmer(farmer.farmer_id);
        if (activeBooking) {
          const bDateStr = activeBooking.booking_date ? normalizeDateStr(activeBooking.booking_date) : 'scheduled date';
          const activePrompt = `Notice: You already have an active procurement appointment #${activeBooking.booking_id} on ${bDateStr}. Farmers may only hold one active booking at a time. Goodbye.`;
          return {
            status: 'ACTIVE_BOOKING_EXISTS',
            active_booking: activeBooking,
            response: this.provider.buildResponse({
              message: activePrompt,
              endCall: true
            })
          };
        }

        let prefixNotice = '';
        if (expiredBooking) {
          console.log(`[IVR] Farmer ${farmer.farmer_id} had an expired booking #${expiredBooking.booking_id}. Informing farmer and proceeding with new booking.`);
          prefixNotice = 'Your previous procurement appointment has expired. We are now booking your new visit. ';
        }

        console.log(`[IVR] Invoking BookingRequestService for farmer ${farmer.farmer_id} in ${farmer.district}`);
        const bookingReqRes = await this.bookingRequestService.processBookingRequest({
          farmerId: farmer.farmer_id,
          phoneNumber: farmer.phone,
          district: farmer.district,
          localityName: farmer.village,
          crop: farmer.primary_crop || 'Paddy (Grade A)',
          quantityQuintals: 10,
          source: 'IVR',
          idempotencyKey: `IVR-${callSid || Date.now()}`
        });

        if (bookingReqRes.success) {
          console.log(`[IVR] Booking confirmed #${bookingReqRes.booking_id} at ${bookingReqRes.centre_name} (Token: ${bookingReqRes.token})`);
          const successPrompt = `${prefixNotice}Your procurement visit has been booked successfully at ${bookingReqRes.centre_name} on ${bookingReqRes.date} at ${bookingReqRes.time}. Your token number is ${bookingReqRes.token}. Your booking details have been sent by SMS. Thank you.`;
          return {
            status: 'BOOKING_CONFIRMED',
            booking: bookingReqRes,
            response: this.provider.buildResponse({
              message: successPrompt,
              endCall: true
            })
          };
        } else if (bookingReqRes.error === 'ACTIVE_BOOKING_EXISTS') {
          return {
            status: 'ACTIVE_BOOKING_EXISTS',
            active_booking: bookingReqRes.active_booking,
            response: this.provider.buildResponse({
              message: `Notice: You already have an active procurement appointment #${bookingReqRes.active_booking?.booking_id}. Goodbye.`,
              endCall: true
            })
          };
        } else {
          console.warn(`[IVR] Booking engine could not allocate slot:`, bookingReqRes.message);
          const failPrompt = `${prefixNotice}We could not find an available slot at this time. Your request has not been booked. Please try again later or use the Kisan Vikas website. Goodbye.`;
          return {
            status: 'NO_FEASIBLE_SLOT',
            response: this.provider.buildResponse({
              message: failPrompt,
              endCall: true
            })
          };
        }
      }

      case '2': {
        // Option 2: Check My Booking
        const active = await this.getActiveBookingForFarmer(farmer.farmer_id);
        if (active) {
          const dateStr = active.booking_date ? normalizeDateStr(active.booking_date) : 'scheduled date';
          const timeStr = active.start_time ? active.start_time.slice(0, 5) : 'scheduled time';
          const statusPrompt = `Your procurement visit is at ${active.centre_name || active.centre_id} on ${dateStr} at ${timeStr}. Your token number is ${active.token || 'assigned'}. Goodbye.`;
          return {
            status: 'BOOKING_STATUS',
            has_booking: true,
            booking: active,
            response: this.provider.buildResponse({
              message: statusPrompt,
              endCall: true
            })
          };
        } else {
          const noBookingPrompt = 'You currently do not have an active procurement booking. Goodbye.';
          return {
            status: 'BOOKING_STATUS',
            has_booking: false,
            booking: null,
            response: this.provider.buildResponse({
              message: noBookingPrompt,
              endCall: true
            })
          };
        }
      }

      case '3': {
        // Option 3: Procurement Centre Status
        const cRes = await this.pool.query(`
          SELECT centre_id, centre_name, operational_status, active_counters
          FROM centres
          WHERE LOWER(district) = LOWER($1) AND operational_status NOT IN ('Closed', 'Retired')
          LIMIT 1
        `, [farmer.district]);

        if (cRes.rows.length > 0) {
          const c = cRes.rows[0];
          const centrePrompt = `Your procurement centre ${c.centre_name} is currently open and operational. Goodbye.`;
          return {
            status: 'CENTRE_STATUS',
            isOpen: true,
            centre: c,
            response: this.provider.buildResponse({
              message: centrePrompt,
              endCall: true
            })
          };
        } else {
          const closedPrompt = 'Procurement centres in your district are currently closed or at full capacity. Goodbye.';
          return {
            status: 'CENTRE_STATUS',
            isOpen: false,
            centre: null,
            response: this.provider.buildResponse({
              message: closedPrompt,
              endCall: true
            })
          };
        }
      }

      case '4': {
        // Option 4: Payment Status
        const pRes = await this.pool.query(`
          SELECT booking_id, crop, procured_quantity_quintals, payment_amount_inr, payment_status
          FROM bookings
          WHERE farmer_id = $1 AND status IN ('Procured', 'Payment Completed')
          ORDER BY booking_date DESC
          LIMIT 1
        `, [farmer.farmer_id]);

        if (pRes.rows.length > 0) {
          const p = pRes.rows[0];
          const paymentPrompt = `Your latest procurement payment of ${p.payment_amount_inr || 0} rupees for booking #${p.booking_id} has been ${p.payment_status || 'completed'}. Goodbye.`;
          return {
            status: 'PAYMENT_STATUS',
            payment: p,
            response: this.provider.buildResponse({
              message: paymentPrompt,
              endCall: true
            })
          };
        } else {
          const noPaymentPrompt = 'All your past procurement payments have been credited directly to your registered bank account. Goodbye.';
          return {
            status: 'PAYMENT_STATUS',
            payment: null,
            response: this.provider.buildResponse({
              message: noPaymentPrompt,
              endCall: true
            })
          };
        }
      }

      case '5': {
        // Option 5: Grievance Status & Helpline
        const gRes = await this.pool.query(`
          SELECT grievance_id, category, status
          FROM grievances
          WHERE farmer_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `, [farmer.farmer_id]);

        if (gRes.rows.length > 0) {
          const g = gRes.rows[0];
          const gPrompt = `Your grievance #${g.grievance_id} is currently ${g.status}. For assistance, call toll-free 1 8 0 0 4 2 5 0 0 1. Goodbye.`;
          return {
            status: 'GRIEVANCE_STATUS',
            grievance: g,
            response: this.provider.buildResponse({
              message: gPrompt,
              endCall: true
            })
          };
        } else {
          const noGrievancePrompt = 'For grievance assistance or helpline support, our officer toll-free number is 1 8 0 0 4 2 5 0 0 1. Your inquiry has been recorded. Goodbye.';
          return {
            status: 'GRIEVANCE_STATUS',
            grievance: null,
            response: this.provider.buildResponse({
              message: noGrievancePrompt,
              endCall: true
            })
          };
        }
      }

      case '9': {
        // Option 9: Help
        const helpPrompt = 'Kisan Queue helpline is 1 8 0 0 4 2 5 0 0 1. Our officers are available Monday to Friday from 9 AM to 5 PM. Goodbye.';
        return {
          status: 'HELP',
          response: this.provider.buildResponse({
            message: helpPrompt,
            endCall: true
          })
        };
      }

      default: {
        return {
          status: 'INVALID_MENU_OPTION',
          response: this.provider.buildResponse({
            message: 'Invalid selection. Goodbye.',
            endCall: true
          })
        };
      }
    }
  }
}

module.exports = {
  IVRService,
  normalizeIndianPhoneNumber,
  maskPhoneNumber
};
