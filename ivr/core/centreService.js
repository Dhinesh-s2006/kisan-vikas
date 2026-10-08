const config = require('../config/ivrConfig');

class CentreService {
  constructor(baseUrl = config.kisanQueueApiUrl) {
    this.baseUrl = baseUrl;
  }

  getHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /**
   * Retrieve live centre operational status and dynamic pacing advisory.
   */
  async getCentrePacing(centreId, token) {
    const resp = await fetch(`${this.baseUrl}/centres/${centreId}/pacing`, {
      headers: this.getHeaders(token)
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch centre pacing: HTTP ${resp.status}`);
    }
    return await resp.json();
  }
}

module.exports = CentreService;
