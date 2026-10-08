const config = require('../config/ivrConfig');

class PaymentService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
  }

  getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Retrieve payment status for a booking.
   */
  async getPaymentStatus(bookingId, token) {
    const resp = await fetch(`${this.baseUrl}/bookings/${bookingId}/payment`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      if (resp.status === 404) return { payment: null, available: false };
      throw new Error(`Failed to fetch payment status: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return {
      available: Boolean(data.payment),
      payment: data.payment
    };
  }
}

module.exports = PaymentService;
