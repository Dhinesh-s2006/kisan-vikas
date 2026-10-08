const config = require('../config/ivrConfig');

class FarmerService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Look up farmer by registered 10-digit mobile number.
   * Calls existing Kisan Queue /api/farmers endpoint.
   * @param {string} phone
   * @returns {Promise<{ registered: boolean, farmer: object|null, token: string|null }>}
   */
  async lookupByPhone(phone) {
    if (!phone) return { registered: false, farmer: null, token: null };
    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

    try {
      const resp = await fetch(`${this.baseUrl}/farmers?search=${encodeURIComponent(cleanPhone)}`);
      if (!resp.ok) {
        throw new Error(`Failed to query farmers: HTTP ${resp.status}`);
      }

      const list = await resp.json();
      if (!Array.isArray(list) || list.length === 0) {
        return { registered: false, farmer: null, token: null };
      }

      // Exact phone match
      const matched = list.find(f => (f.phone || '').replace(/\D/g, '').slice(-10) === cleanPhone) || list[0];
      if (!matched || (matched.phone || '').replace(/\D/g, '').slice(-10) !== cleanPhone) {
        return { registered: false, farmer: null, token: null };
      }

      // Obtain session token for authenticated operations
      let token = null;
      try {
        const detailResp = await fetch(`${this.baseUrl}/farmers/${matched.farmer_id}`);
        if (detailResp.ok) {
          const detail = await detailResp.json();
          token = detail.token || null;
        }
      } catch (_) {}

      return {
        registered: true,
        farmer: matched,
        token
      };
    } catch (err) {
      console.error('[FARMER SERVICE] Lookup error:', err.message);
      throw err;
    }
  }
}

module.exports = FarmerService;
