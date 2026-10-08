/**
 * Speech Adapters & Multi-Provider Coordinator
 * Enforces Sarvam as the PRIMARY voice engine for both STT and TTS.
 * 
 * Hierarchy:
 * - STT: Primary: Sarvam STT ('saaras:v3') -> Fallback: Bhashini ASR
 * - TTS: Primary: Sarvam TTS ('bulbul:v1') -> Fallback: Mock / Browser Speech
 */

const SarvamSpeechService = require('./sarvamSpeechService');
const BhashiniSpeechService = require('./bhashiniSpeechService');
const SarvamTTSProvider = require('./sarvamTTSProvider');

class SpeechAdapters {
  constructor({
    sttPrimary = null,
    sttFallback = null,
    ttsPrimary = null
  } = {}) {
    // Sarvam is configured as primary STT engine
    this.sttPrimary = sttPrimary || new SarvamSpeechService();
    this.sttFallback = sttFallback || new BhashiniSpeechService();
    this.ttsPrimary = ttsPrimary || new SarvamTTSProvider();
  }

  getHealth() {
    return {
      sarvamSTTConfigured: Boolean(this.sttPrimary?.isConfigured()),
      bhashiniSTTConfigured: Boolean(this.sttFallback?.isConfigured()),
      sarvamTTSConfigured: Boolean(this.ttsPrimary?.isConfigured()),
      primarySTT: 'sarvam',
      fallbackSTT: 'bhashini',
      primaryTTS: 'sarvam'
    };
  }

  /**
   * Transcribe speech audio with Sarvam as primary and Bhashini as fallback
   */
  async transcribe({ audioBuffer, mimeType, languageCode = 'ta-IN', voiceRequestId = null }) {
    let lastError = null;

    // 1. Primary: Sarvam STT
    if (this.sttPrimary && this.sttPrimary.isConfigured()) {
      try {
        console.log(`[SpeechAdapters] Submitting audio to PRIMARY STT: Sarvam (${languageCode})`);
        const result = await this.sttPrimary.transcribe({
          audioBuffer,
          mimeType,
          languageCode,
          voiceRequestId
        });
        return { ...result, provider: 'sarvam' };
      } catch (err) {
        lastError = err;
        console.warn(`[SpeechAdapters] Sarvam STT failed (${err.code || err.message}). Attempting fallback.`);
      }
    }

    // 2. Fallback: Bhashini STT
    if (this.sttFallback && this.sttFallback.isConfigured()) {
      try {
        console.log(`[SpeechAdapters] Submitting audio to FALLBACK STT: Bhashini (${languageCode})`);
        const result = await this.sttFallback.transcribe({
          audioBuffer,
          mimeType,
          languageCode,
          voiceRequestId
        });
        return { ...result, provider: 'bhashini', fallbackFrom: 'sarvam' };
      } catch (err) {
        lastError = err;
        console.error(`[SpeechAdapters] Fallback Bhashini STT also failed:`, err.message);
      }
    }

    if (lastError) throw lastError;
    throw new Error('SpeechAdapters: No speech transcription providers configured.');
  }

  /**
   * Synthesize text into speech with Sarvam TTS
   */
  async synthesize({ text, languageCode = 'ta-IN' }) {
    return this.ttsPrimary.synthesize({ text, languageCode });
  }
}

const defaultSpeechAdapters = new SpeechAdapters();

module.exports = {
  SpeechAdapters,
  defaultSpeechAdapters,
  SarvamSTTProvider: SarvamSpeechService,
  SarvamTTSProvider,
  BhashiniSTTProvider: BhashiniSpeechService
};
