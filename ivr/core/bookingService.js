const config = require('../config/ivrConfig');

class BookingService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
  }

  getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Check if farmer already has an active booking.
   * Authoritative backend check enforcing One Active Booking Rule.
   */
  async checkActiveBooking(farmerId, token) {
    const resp = await fetch(`${this.baseUrl}/farmers/${farmerId}/active-booking`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      throw new Error(`Failed to check active booking: HTTP ${resp.status}`);
    }
    return await resp.json();
  }

  /**
   * Authoritative centre recommendation matching Website logic exactly.
   * Calls GET /api/centres/recommend
   */
  async getRecommendations({ district, date, farmer_id, crop, quantity_quintals } = {}, token) {
    const params = new URLSearchParams();
    if (district) params.append('district', district);
    if (date) params.append('date', date);
    if (farmer_id) params.append('farmer_id', farmer_id);
    if (crop) params.append('crop', crop);
    if (quantity_quintals) params.append('quantity_quintals', quantity_quintals);

    const resp = await fetch(`${this.baseUrl}/centres/recommend?${params.toString()}`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch recommendations: HTTP ${resp.status}`);
    }
    return await resp.json();
  }

  /**
   * Retrieve available procurement centres in farmer's registered district.
   */
  async getAvailableCentres(district, token) {
    const resp = await fetch(`${this.baseUrl}/centres?district=${encodeURIComponent(district)}`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch centres: HTTP ${resp.status}`);
    }
    const centres = await resp.json();
    return (centres || []).filter(c => c.operational_status !== 'Closed' && c.operational_status !== 'Retired');
  }

  /**
   * Retrieve valid open slots for a centre.
   */
  async getAvailableSlots(centreId, date, token) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const url = `${this.baseUrl}/centres/${centreId}/slots?date=${encodeURIComponent(targetDate)}`;
    const resp = await fetch(url, { headers: this.getHeaders(token) });
    if (!resp.ok) {
      throw new Error(`Failed to fetch slots: HTTP ${resp.status}`);
    }
    const slots = await resp.json();
    if (!Array.isArray(slots)) return [];
    // Return slots with available capacity
    return slots.filter(s => (s.booked_count || 0) < (s.max_farmers || 20));
  }

  /**
   * Atomically create booking through existing backend API with idempotency support.
   */
  async createBooking({
    booking_id,
    farmer_id,
    slot_id,
    centre_id,
    district,
    booking_date,
    crop = 'Paddy (Common)',
    quantity_quintals = 50,
    msp_rate_inr = 2275,
    idempotency_key = null,
    booking_source = 'IVR'
  }, token) {
    const bookingId = booking_id || ('B' + Math.floor(100000 + Math.random() * 900000));
    const headers = this.getHeaders(token);
    if (idempotency_key) {
      headers['Idempotency-Key'] = idempotency_key;
    }

    const resp = await fetch(`${this.baseUrl}/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        booking_id: bookingId,
        farmer_id,
        slot_id,
        centre_id,
        district,
        booking_date,
        crop,
        quantity_quintals,
        msp_rate_inr,
        idempotency_key,
        booking_source
      })
    });

    const data = await resp.json();
    return {
      status: resp.status,
      ok: resp.ok,
      data
    };
  }
}

module.exports = BookingService;
