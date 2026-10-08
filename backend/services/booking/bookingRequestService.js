/**
 * Booking Request Service
 * Single unified booking request processor shared across Web, IVR, and CSC.
 * 
 * Rules:
 * 1. Booking Request != Final Booking (explicit state machine).
 * 2. Hard check: Registered Farmer Only.
 * 3. Enforces single active booking rule.
 * 4. Transactional slot hold and allocation.
 * 5. Built-in idempotency protection.
 */

const crypto = require('crypto');
const { LocalityService } = require('../locality/localityService');
const { IntelligentBookingEngine } = require('./intelligentBookingEngine');
const { isBookingGenuinelyActive, normalizeDateStr } = require('./slotValidation');
const { createFarmerNotification, NOTIFICATION_TYPES } = require('../../notificationService');

class BookingRequestService {
  constructor({ pool }) {
    this.pool = pool;
    this.localityService = new LocalityService({ pool });
    this.bookingEngine = new IntelligentBookingEngine({ pool });
  }

  /**
   * Process a booking request from Web, IVR, or CSC
   */
  async processBookingRequest(params = {}) {
    const farmerId = params.farmerId || params.farmer_id || null;
    const phoneNumber = params.phoneNumber || params.phone_number || params.phone || null;
    const district = params.district || null;
    const localityId = params.localityId || params.locality_id || null;
    const localityName = params.localityName || params.locality_name || null;
    const crop = params.crop || 'Paddy (Common)';
    const quantityQuintals = params.quantityQuintals != null ? params.quantityQuintals : (params.quantity_quintals != null ? params.quantity_quintals : 10);
    const preferredDate = params.preferredDate || params.preferred_date || null;
    const source = params.source || 'WEB';
    const idempotencyKey = params.idempotencyKey || params.idempotency_key || null;
    // 1. Idempotency Check: if this exact request was already processed, return existing
    if (idempotencyKey) {
      const existing = await this.pool.query(`
        SELECT br.*, b.token, b.queue_position_at_booking
        FROM booking_requests br
        LEFT JOIN bookings b ON br.final_booking_id = b.booking_id
        WHERE br.idempotency_key = $1
        LIMIT 1
      `, [idempotencyKey]);

      if (existing.rows.length > 0) {
        return {
          success: true,
          is_idempotent_duplicate: true,
          booking_request: existing.rows[0],
          booking_id: existing.rows[0].final_booking_id
        };
      }
    }

    // 2. Validate Farmer Registration
    let farmer = null;
    if (farmerId) {
      const fRes = await this.pool.query('SELECT * FROM farmers WHERE farmer_id = $1', [farmerId]);
      if (fRes.rows.length > 0) farmer = fRes.rows[0];
    } else if (phoneNumber) {
      const fRes = await this.pool.query('SELECT * FROM farmers WHERE phone = $1', [phoneNumber]);
      if (fRes.rows.length > 0) farmer = fRes.rows[0];
    }

    if (!farmer) {
      return {
        success: false,
        error: 'UNREGISTERED_FARMER',
        message: 'Only registered farmers can book procurement slots. Please register via our website or nearest CSC Kiosk.'
      };
    }

    const effectiveFarmerId = farmer.farmer_id;
    const effectivePhone = phoneNumber || farmer.phone;
    const effectiveDistrict = district || farmer.district;

    // 3. One Active Booking Rule Enforcement (Using canonical isBookingGenuinelyActive)
    const candidateBookings = await this.pool.query(`
      SELECT b.booking_id, b.centre_id, b.slot_id, b.booking_date, b.status, b.token,
             c.centre_name, s.start_time, s.end_time
      FROM bookings b
      LEFT JOIN centres c ON b.centre_id = c.centre_id
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.farmer_id = $1
        AND b.status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'Cancelled')
      ORDER BY b.booking_date DESC, b.created_at DESC
      LIMIT 10
    `, [effectiveFarmerId]);

    let active = null;
    for (const b of candidateBookings.rows) {
      const evaluation = isBookingGenuinelyActive(b);
      if (evaluation.active) {
        active = b;
        break;
      } else if (evaluation.expired) {
        if (b.status !== 'Expired' && b.status !== 'Missed Visit' && b.status !== 'No-Show') {
          this.pool.query("UPDATE bookings SET status = 'Expired' WHERE booking_id = $1", [b.booking_id]).catch(() => {});
        }
      }
    }

    if (active) {
      return {
        success: false,
        error: 'ACTIVE_BOOKING_EXISTS',
        message: `You already have an active procurement appointment #${active.booking_id} at ${active.centre_name || active.centre_id} on ${normalizeDateStr(active.booking_date)}.`,
        active_booking: active
      };
    }

    // 4. Locality Master Validation
    let farmerLocation = null;
    let resolvedLocalityName = localityName || farmer.village || null;

    if (localityId || resolvedLocalityName) {
      const locValidation = await this.localityService.validateLocalityDistrict(
        effectiveDistrict,
        localityId || resolvedLocalityName
      );
      if (locValidation.valid) {
        farmerLocation = locValidation.locality;
        resolvedLocalityName = locValidation.locality.locality_name;
      }
    }

    // 5. Create Booking Request Record in DB (Status: REQUESTED)
    const requestId = `BR-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const requestReference = `REQ-${Date.now().toString().slice(-6)}`;

    await this.pool.query(`
      INSERT INTO booking_requests (
        request_id, request_reference, farmer_id, phone_number, district,
        locality_id, locality_name, crop, quantity_quintals, status, source,
        idempotency_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'REQUESTED', $10, $11, NOW(), NOW())
    `, [
      requestId,
      requestReference,
      effectiveFarmerId,
      effectivePhone,
      effectiveDistrict,
      farmerLocation?.locality_id || null,
      resolvedLocalityName,
      crop,
      quantityQuintals,
      source,
      idempotencyKey
    ]);

    // Update status to OPTIMIZING
    await this.pool.query(
      "UPDATE booking_requests SET status = 'OPTIMIZING', updated_at = NOW() WHERE request_id = $1",
      [requestId]
    );

    // 6. Run Deterministic Intelligent Booking Engine
    const optimizationResult = await this.bookingEngine.optimizeBooking({
      district: effectiveDistrict,
      farmerLocation,
      preferredDate,
      quantityQuintals,
      crop
    });

    if (optimizationResult.status !== 'SLOT_FEASIBLE') {
      await this.pool.query(`
        UPDATE booking_requests 
        SET status = 'NO_FEASIBLE_SLOT',
            optimization_reason = $2,
            updated_at = NOW()
        WHERE request_id = $1
      `, [requestId, JSON.stringify(optimizationResult)]);

      return {
        success: false,
        error: 'NO_FEASIBLE_SLOT',
        message: optimizationResult.reason || 'No available slots found for the requested date.',
        request_reference: requestReference,
        candidates: optimizationResult.candidates
      };
    }

    const { allocation } = optimizationResult;

    // 7. Atomic Concurrency-Safe Final Booking Execution
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Hold slot atomically
      const holdRes = await this.bookingEngine.holdSlot(client, allocation.slot_id);
      if (!holdRes.success) {
        await client.query('ROLLBACK');
        await this.pool.query(
          "UPDATE booking_requests SET status = 'NO_FEASIBLE_SLOT', updated_at = NOW() WHERE request_id = $1",
          [requestId]
        );
        const isExp = String(holdRes.reason).startsWith('SLOT_EXPIRED');
        return {
          success: false,
          error: isExp ? 'SLOT_EXPIRED' : 'SLOT_HELD_BY_ANOTHER',
          message: isExp
            ? 'The selected procurement slot has already expired. Please select an upcoming slot.'
            : 'Selected slot was just filled by another transaction. Please retry.'
        };
      }

      // Generate final booking parameters
      const bookingId = `BK-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const token = `TK-${Date.now().toString().slice(-4)}`;

      // Calculate queue position at centre today
      const qRes = await client.query(`
        SELECT COUNT(*) as q_count 
        FROM bookings 
        WHERE centre_id = $1 AND booking_date = $2
      `, [allocation.centre_id, allocation.slot_date]);
      const queuePos = Number(qRes.rows[0]?.q_count || 0) + 1;
      const estimatedWait = queuePos * 12;

      // Insert final confirmed booking
      await client.query(`
        INSERT INTO bookings (
          booking_id, farmer_id, slot_id, centre_id, booking_date, crop,
          quantity_quintals, status, token, queue_position_at_booking,
          estimated_wait_minutes, booking_source, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'Confirmed', $8, $9, $10, $11, NOW()
        )
      `, [
        bookingId,
        effectiveFarmerId,
        allocation.slot_id,
        allocation.centre_id,
        allocation.slot_date,
        crop,
        quantityQuintals,
        token,
        queuePos,
        estimatedWait,
        source
      ]);

      // Release hold and increment booked count
      await client.query(`
        UPDATE slots
        SET booked_count = booked_count + 1,
            held_count = GREATEST(0, COALESCE(held_count, 1) - 1)
        WHERE slot_id = $1
      `, [allocation.slot_id]);

      // Update booking request to CONFIRMED
      await client.query(`
        UPDATE booking_requests
        SET status = 'CONFIRMED',
            selected_centre_id = $2,
            selected_slot_id = $3,
            final_booking_id = $4,
            assigned_at = NOW(),
            sms_status = 'SENT',
            optimization_reason = $5,
            updated_at = NOW()
        WHERE request_id = $1
      `, [
        requestId,
        allocation.centre_id,
        allocation.slot_id,
        bookingId,
        JSON.stringify(allocation.optimization_reason)
      ]);

      await client.query('COMMIT');

      // Dispatch in-app notification
      try {
        await createFarmerNotification(this.pool, {
          farmerId: effectiveFarmerId,
          type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
          title: 'Procurement Appointment Confirmed',
          message: `Your booking #${bookingId} at ${allocation.centre_name} on ${allocation.slot_date} (${allocation.start_time} - ${allocation.end_time}) is confirmed. Token: ${token}`,
          bookingId,
          centreId: allocation.centre_id
        });
      } catch (e) {
        console.warn('[BookingRequestService] Notification error (non-fatal):', e.message);
      }

      return {
        success: true,
        request_reference: requestReference,
        booking_id: bookingId,
        token,
        centre_name: allocation.centre_name,
        centre_id: allocation.centre_id,
        date: allocation.slot_date,
        time: `${allocation.start_time.slice(0, 5)} - ${allocation.end_time.slice(0, 5)}`,
        queue_number: queuePos,
        distance_km: allocation.distance_km,
        crop,
        quantity_quintals: quantityQuintals
      };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[BookingRequestService] Transaction error:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve status of a booking request
   */
  async getBookingRequestStatus(requestReference) {
    const res = await this.pool.query(`
      SELECT br.*, b.token, b.queue_position_at_booking, c.centre_name
      FROM booking_requests br
      LEFT JOIN bookings b ON br.final_booking_id = b.booking_id
      LEFT JOIN centres c ON br.selected_centre_id = c.centre_id
      WHERE br.request_reference = $1 OR br.request_id = $1
      LIMIT 1
    `, [requestReference]);

    return res.rows[0] || null;
  }
}

module.exports = {
  BookingRequestService
};
