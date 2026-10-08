/**
 * IVR Telephony API Routes
 * Endpoints:
 * - POST /api/ivr/incoming    (Incoming call webhook)
 * - POST /api/ivr/handle-dtmf (DTMF selection webhook)
 * - POST /api/ivr/test-call   (Local simulator endpoint for automated tests)
 */

const express = require('express');
const { IVRService } = require('./services/ivr/ivrService');

function createIVRRouter({ pool }) {
  const router = express.Router();
  const ivrService = new IVRService({ pool });

  /**
   * Incoming call webhook
   */
  router.post('/incoming', async (req, res) => {
    try {
      const result = await ivrService.handleIncomingCall(req);
      if (result.response?.contentType === 'text/xml') {
        res.setHeader('Content-Type', 'text/xml');
        return res.send(result.response.xml);
      }
      res.json(result);
    } catch (err) {
      console.error('[IVR Router] Error in /incoming:', err);
      res.status(500).json({ error: 'ivr_error', message: err.message });
    }
  });

  /**
   * DTMF selection webhook
   */
  router.post('/handle-dtmf', async (req, res) => {
    try {
      const result = await ivrService.handleDtmfSelection(req);
      if (result.response?.contentType === 'text/xml') {
        res.setHeader('Content-Type', 'text/xml');
        return res.send(result.response.xml);
      }
      res.json(result);
    } catch (err) {
      console.error('[IVR Router] Error in /handle-dtmf:', err);
      res.status(500).json({ error: 'ivr_error', message: err.message });
    }
  });

  /**
   * Test Call Simulator endpoint for offline automated testing
   */
  router.post('/test-call', async (req, res) => {
    try {
      const { callerPhone, digits } = req.body;
      const fakeReq = {
        body: {
          From: callerPhone,
          Digits: digits,
          CallSid: `TEST-${Date.now()}`
        }
      };

      if (digits !== undefined && digits !== null) {
        const dtmfResult = await ivrService.handleDtmfSelection(fakeReq);
        return res.json(dtmfResult);
      }

      const callResult = await ivrService.handleIncomingCall(fakeReq);
      res.json(callResult);
    } catch (err) {
      console.error('[IVR Router] Error in /test-call:', err);
      res.status(500).json({ error: 'test_call_error', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createIVRRouter
};
