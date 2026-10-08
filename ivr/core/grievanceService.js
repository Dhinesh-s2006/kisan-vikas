const config = require('../config/ivrConfig');

class GrievanceService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
    this.categoryMap = {
      '1': { type: 'Procurement Dispute', desc: 'Queue delay and token waiting time dispute' },
      '2': { type: 'Staff Conduct', desc: 'Centre facilities or counter staffing concern' },
      '3': { type: 'Payment Delay', desc: 'Direct Benefit Transfer or bank credit delay' },
      '4': { type: 'Procurement Dispute', desc: 'Booking slot or appointment scheduling issue' },
      '5': { type: 'Other', desc: 'General grievance logged via Telephone IVR' }
    };
  }

  getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Submit grievance with DTMF category selection.
   */
  async submitGrievance({
    farmer_id,
    booking_id,
    centre_id,
    categoryKey = '5'
  }, token) {
    const cat = this.categoryMap[categoryKey] || this.categoryMap['5'];

    const resp = await fetch(`${this.baseUrl}/grievances`, {
      method: 'POST',
      headers: this.getHeaders(token),
      body: JSON.stringify({
        farmer_id,
        booking_id: booking_id || null,
        centre_id,
        issue_type: cat.type,
        description: `[IVR Category ${categoryKey}]: ${cat.desc}`
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

module.exports = GrievanceService;
