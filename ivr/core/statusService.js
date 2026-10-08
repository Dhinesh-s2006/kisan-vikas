const config = require('../config/ivrConfig');

class StatusService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
  }

  getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Retrieve authoritative Digital Pass details including live wait time and dynamic pacing.
   */
  async getDigitalPass(bookingId, token) {
    const resp = await fetch(`${this.baseUrl}/bookings/pass/${bookingId}`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch digital pass: HTTP ${resp.status}`);
    }
    return await resp.json();
  }
}

module.exports = StatusService;
