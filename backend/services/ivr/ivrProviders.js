/**
 * IVR Provider Adapters
 * Abstraction layer for telephony vendors (Twilio, Exotel, Mock/Local).
 * 
 * The business logic NEVER depends directly on vendor APIs.
 */

class IVRProvider {
  async parseIncomingCall(req) {
    throw new Error('parseIncomingCall must be implemented by adapter.');
  }

  buildResponse({ message, audioUrl = null, gatherDtmf = false, numDigits = 1, endCall = false }) {
    throw new Error('buildResponse must be implemented by adapter.');
  }
}

/**
 * Mock IVR Provider for deterministic local development and automated testing
 */
class MockIVRProvider extends IVRProvider {
  async parseIncomingCall(req) {
    const fromNumber = req.body?.From || req.body?.caller || req.body?.phone || req.query?.From || '9800012345';
    const digits = req.body?.Digits || req.body?.dtmf || req.query?.Digits || null;
    const callSid = req.body?.CallSid || req.query?.CallSid || `CALL-${Date.now()}`;
    return { callSid, fromNumber, digits };
  }

  buildResponse({ message, audioUrl = null, gatherDtmf = false, numDigits = 1, endCall = false }) {
    return {
      provider: 'mock',
      text_prompt: message,
      audio_url: audioUrl,
      gather_dtmf: gatherDtmf,
      num_digits: numDigits,
      end_call: endCall,
      xml: `<Response><Say>${message}</Say>${gatherDtmf ? `<Gather numDigits="${numDigits}"/>` : ''}${endCall ? '<Hangup/>' : ''}</Response>`
    };
  }
}

/**
 * Twilio IVR Provider Adapter (TwiML generator)
 */
class TwilioIVRProvider extends IVRProvider {
  async parseIncomingCall(req) {
    return {
      callSid: req.body?.CallSid || '',
      fromNumber: req.body?.From ? req.body.From.replace(/^\+91/, '').replace(/\D/g, '') : '',
      digits: req.body?.Digits || null
    };
  }

  buildResponse({ message, audioUrl = null, gatherDtmf = false, numDigits = 1, endCall = false, actionUrl = '/api/ivr/handle-dtmf' }) {
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
    if (audioUrl) {
      twiml += `<Play>${audioUrl}</Play>`;
    } else {
      twiml += `<Say voice="Polly.Aditi" language="ta-IN">${message}</Say>`;
    }

    if (gatherDtmf && !endCall) {
      twiml += `<Gather action="${actionUrl}" method="POST" numDigits="${numDigits}" timeout="5"><Say>Please enter your selection.</Say></Gather>`;
    }

    if (endCall) {
      twiml += '<Hangup/>';
    }
    twiml += '</Response>';

    return {
      provider: 'twilio',
      contentType: 'text/xml',
      xml: twiml
    };
  }
}

/**
 * Exotel IVR Provider Adapter (HTTP JSON / Audio format)
 */
class ExotelIVRProvider extends IVRProvider {
  async parseIncomingCall(req) {
    return {
      callSid: req.query?.CallSid || req.body?.CallSid || '',
      fromNumber: req.query?.From ? req.query.From.replace(/^\+91/, '').replace(/\D/g, '') : '',
      digits: req.query?.Digits || req.body?.Digits || null
    };
  }

  buildResponse({ message, audioUrl = null, gatherDtmf = false, numDigits = 1, endCall = false }) {
    return {
      provider: 'exotel',
      select: gatherDtmf ? 'dtmf' : 'none',
      max_digits: numDigits,
      text: message,
      audio: audioUrl,
      hangup: endCall
    };
  }
}

module.exports = {
  IVRProvider,
  MockIVRProvider,
  TwilioIVRProvider,
  ExotelIVRProvider
};
