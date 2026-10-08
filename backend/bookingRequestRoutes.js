/**
 * Booking Request API Routes
 * Unified entry point for deterministic booking requests across Web, IVR, and CSC.
 */

const express = require('express');
const { authenticateToken, optionalAuthenticate } = require('./auth');
const { BookingRequestService } = require('./services/booking/bookingRequestService');
const { IntelligentBookingEngine } = require('./services/booking/intelligentBookingEngine');

function createBookingRequestRouter({ pool }) {
  const router = express.Router();
  const bookingRequestService = new BookingRequestService({ pool });
  const bookingEngine = new IntelligentBookingEngine({ pool });

  /**
   * POST /api/booking-requests
   * Unified booking request creation and automatic optimization
   */
  router.post('/', optionalAuthenticate, async (req, res) => {
    try {
      const {
        farmer_id,
        phone_number,
        district,
        locality_id,
        locality_name,
        crop,
        quantity_quintals,
        preferred_date,
        source = 'WEB',
        idempotency_key
      } = req.body;

      // Identity resolution: prioritize JWT if logged in as FARMER
      let effectiveFarmerId = farmer_id;
      if (req.user && req.user.role === 'FARMER') {
        effectiveFarmerId = req.user.farmerId || req.user.farmer_id;
      }

      if (!effectiveFarmerId && !phone_number) {
        return res.status(400).json({
          error: 'missing_identity',
          message: 'Either farmer_id or phone_number is required.'
        });
      }

      const result = await bookingRequestService.processBookingRequest({
        farmerId: effectiveFarmerId,
        phoneNumber: phone_number,
        district,
        localityId: locality_id,
        localityName: locality_name,
        crop: crop || 'Paddy (Common)',
        quantityQuintals: quantity_quintals ? parseFloat(quantity_quintals) : 10,
        preferredDate: preferred_date,
        source: source || 'WEB',
        idempotencyKey: idempotency_key || req.headers['idempotency-key'] || null
      });

      if (!result.success) {
        const statusCode = result.error === 'ACTIVE_BOOKING_EXISTS' ? 409 :
                           result.error === 'UNREGISTERED_FARMER' ? 403 :
                           result.error === 'NO_FEASIBLE_SLOT' ? 404 : 400;
        return res.status(statusCode).json(result);
      }

      res.status(201).json(result);
    } catch (err) {
      console.error('[BookingRequestRouter] Error:', err);
      res.status(500).json({
        error: 'booking_request_failed',
        message: 'Could not process booking request. Please try again.',
        details: err.message
      });
    }
  });

  /**
   * POST /api/booking-requests/optimize-preview
   * Preview ranked candidate centres without committing a booking
   */
  router.post('/optimize-preview', optionalAuthenticate, async (req, res) => {
    try {
      const { district, locality_id, locality_name, preferred_date, quantity_quintals, crop } = req.body;
      if (!district) {
        return res.status(400).json({ error: 'missing_district', message: 'District is required for optimization.' });
      }

      // Check locality coords if provided
      let farmerLocation = null;
      if (locality_id || locality_name) {
        const lRes = await pool.query(`
          SELECT latitude, longitude, locality_name 
          FROM localities 
          WHERE (locality_id = $1 OR LOWER(locality_name) = LOWER($2)) AND LOWER(district) = LOWER($3)
          LIMIT 1
        `, [locality_id || '', locality_name || '', district.trim()]);
        if (lRes.rows.length > 0) farmerLocation = lRes.rows[0];
      }

      const result = await bookingEngine.optimizeBooking({
        district: district.trim(),
        farmerLocation,
        preferredDate: preferred_date,
        quantityQuintals: quantity_quintals || 10,
        crop: crop || 'Paddy (Common)'
      });

      res.json({
        success: result.status === 'SLOT_FEASIBLE',
        ...result
      });
    } catch (err) {
      console.error('[BookingRequestRouter] Error in /optimize-preview:', err);
      res.status(500).json({ error: 'optimization_failed', message: err.message });
    }
  });

  /**
   * GET /api/booking-requests/:reference
   */
  router.get('/:reference', optionalAuthenticate, async (req, res) => {
    try {
      const status = await bookingRequestService.getBookingRequestStatus(req.params.reference);
      if (!status) {
        return res.status(404).json({ error: 'not_found', message: 'Booking request not found.' });
      }
      res.json({ success: true, booking_request: status });
    } catch (err) {
      res.status(500).json({ error: 'failed_to_fetch_request', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createBookingRequestRouter
};
