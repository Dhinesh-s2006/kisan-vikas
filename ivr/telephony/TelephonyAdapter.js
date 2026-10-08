/**
 * Base Abstract Telephony Adapter Interface
 * 
 * Provides a provider-neutral interface between telephony systems
 * (Asterisk FastAGI, Exotel, Twilio, etc.) and the Kisan Queue IVR Core.
 */
class TelephonyAdapter {
  constructor(channelContext = {}) {
    if (new.target === TelephonyAdapter) {
      throw new TypeError('Cannot construct TelephonyAdapter instances directly — please use a provider implementation.');
    }
    this.context = channelContext;
  }

  /**
   * Answer incoming call channel.
   * @returns {Promise<void>}
   */
  async answerCall() {
    throw new Error('answerCall() must be implemented by telephony adapter');
  }

  /**
   * Retrieve the caller's phone number from telephony signaling.
   * @returns {string} E.g. "9433218196"
   */
  getCallerNumber() {
    throw new Error('getCallerNumber() must be implemented by telephony adapter');
  }

  /**
   * Play pre-recorded audio file or tone.
   * @param {string} audioFile
   * @returns {Promise<void>}
   */
  async playAudio(audioFile) {
    throw new Error('playAudio() must be implemented by telephony adapter');
  }

  /**
   * Synthesize or speak a text prompt with optional language code.
   * @param {string} text
   * @param {string} [language]
   * @returns {Promise<void>}
   */
  async speak(text, language = 'ta-IN') {
    throw new Error('speak() must be implemented by telephony adapter');
  }

  /**
   * Wait for and collect DTMF keypad input digits.
   * @param {number} maxDigits
   * @param {number} timeoutMs
   * @returns {Promise<string>} e.g. "1" or "" on timeout
   */
  async collectDTMF(maxDigits = 1, timeoutMs = 6000) {
    throw new Error('collectDTMF() must be implemented by telephony adapter');
  }

  /**
   * Hang up call cleanly.
   * @returns {Promise<void>}
   */
  async hangup() {
    throw new Error('hangup() must be implemented by telephony adapter');
  }
}

module.exports = TelephonyAdapter;
