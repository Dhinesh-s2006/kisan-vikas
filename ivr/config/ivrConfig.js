const path = require('path');
// Safely load dotenv in standalone IVR mode; in backend/Render, process.env is already populated
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (err) {
  // Gracefully use existing process.env when dotenv cannot be resolved
}

module.exports = {
  fastAgiPort: parseInt(process.env.FASTAGI_PORT, 10) || 4574,
  fastAgiHost: process.env.FASTAGI_HOST || '0.0.0.0',
  kisanQueueApiUrl: (process.env.KISAN_QUEUE_API_URL || 'http://localhost:4000/api').replace(/\/+$/, ''),
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'Tamil',
  maxDtmfRetries: parseInt(process.env.MAX_DTMF_RETRIES, 10) || 3,
  dtmfTimeoutMs: parseInt(process.env.DTMF_TIMEOUT_MS, 10) || 6000
};
