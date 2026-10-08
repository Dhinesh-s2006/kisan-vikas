const config = require('../config/ivrConfig');

class RescheduleService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
  }

  getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Fetch valid alternative slots suggested for rescheduling.
   */
  async getSuggestions(bookingId, token) {
    const resp = await fetch(`${this.baseUrl}/bookings/${bookingId}/reschedule-suggestions`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch reschedule suggestions: HTTP ${resp.status}`);
    }
    return await resp.json();
  }

  /**
   * Execute rescheduling decision (ACCEPT or REJECT).
   */
  async executeReschedule(bookingId, { decision, new_slot_id, new_centre_id, reason }, token) {
    const resp = await fetch(`${this.baseUrl}/bookings/${bookingId}/reschedule`, {
      method: 'POST',
      headers: this.getHeaders(token),
      body: JSON.stringify({
        decision,
        new_slot_id,
        new_centre_id,
        reason: reason || 'Rescheduled via Kisan Vikas Accessibility Telephone IVR'
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

module.exports = RescheduleService;
