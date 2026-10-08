/**
 * Speech Service Abstraction Layer
 * Coordinates Multi-Provider Speech-to-Text:
 * 
 * Order of Precedence:
 * 1. Primary:  Bhashini ASR (Digital India Bhashini Division)
 * 2. Fallback: Sarvam STT (saaras:v3)
 * 
 * Features:
 * - Duplicate request protection (voiceRequestId cache) to preserve provider credits
 * - True infrastructure-failure fallback (timeout, 5xx, rate limits, 401/403)
 * - Safe conversational non-fallback (empty/silent audio rejected before contacting either provider)
 * - Non-sensitive health reporting
 */

const BhashiniSpeechService = require('./bhashiniSpeechService');
const SarvamSpeechService = require('./sarvamSpeechService');

class SpeechService {
  constructor({
    primaryProvider = null,
    fallbackProvider = null,
    provider = null, // Backward compatibility for tests passing single provider
    duplicateCacheTtlMs = 60000
  } = {}) {
    if (provider) {
      // If a single provider is explicitly injected, assign it as primary
      this.primaryProvider = provider;
      this.fallbackProvider = fallbackProvider;
    } else {
      this.primaryProvider = primaryProvider || new BhashiniSpeechService();
      this.fallbackProvider = fallbackProvider || new SarvamSpeechService();
    }

    this.duplicateCacheTtlMs = duplicateCacheTtlMs;
    // Map<voiceRequestId, { timestamp, result, inFlightPromise }>
    this.processedRequests = new Map();

    // Periodic sweep of expired duplicate cache entries (every 2 minutes)
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.processedRequests.entries()) {
        if (now - entry.timestamp > this.duplicateCacheTtlMs) {
          this.processedRequests.delete(id);
        }
      }
    }, 120000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Health status for public and operational inspection without leaking keys.
   */
  getHealth() {
    const isBhashiniReady = Boolean(this.primaryProvider?.isConfigured());
    const isSarvamReady = Boolean(this.fallbackProvider?.isConfigured());

    let activeProvider = 'none';
    if (isBhashiniReady) {
      activeProvider = 'bhashini';
    } else if (isSarvamReady) {
      activeProvider = 'sarvam';
    }

    return {
      enabled: Boolean((this.primaryProvider?.enabled) || (this.fallbackProvider?.enabled)),
      provider: activeProvider,
      primary: 'bhashini',
      fallback: 'sarvam',
      bhashiniConfigured: isBhashiniReady,
      sarvamConfigured: isSarvamReady,
      configured: Boolean(isBhashiniReady || isSarvamReady),
      model: isBhashiniReady ? 'bhashini-asr' : (this.fallbackProvider?.model || 'saaras:v3')
    };
  }

  /**
   * Internal execution of primary -> fallback provider chain
   */
  async _executeTranscription({ audioBuffer, mimeType, languageCode, voiceRequestId }) {
    let lastError = null;
    let fallbackOccurred = false;

    // 1. Attempt Primary: Bhashini ASR
    if (this.primaryProvider && this.primaryProvider.isConfigured()) {
      try {
        console.log(`[VOICE STT] Attempting PRIMARY provider: BHASHINI (lang: ${languageCode})`);
        const result = await this.primaryProvider.transcribe({
          audioBuffer,
          mimeType,
          languageCode,
          voiceRequestId
        });
        console.log(`[VOICE STT] Primary provider BHASHINI succeeded (transcript length: ${result.transcript?.length || 0})`);
        return result;
      } catch (err) {
        lastError = err;
        // Credit protection & audio validation errors: DO NOT fallback to Sarvam
        if (['INVALID_AUDIO', 'AUDIO_TOO_SHORT', 'AUDIO_SILENT', 'AUDIO_TOO_LARGE'].includes(err.code)) {
          throw err;
        }

        console.warn(`[VOICE STT] Primary provider BHASHINI failed [${err.code || err.message}]. Falling back to SARVAM STT...`);
        fallbackOccurred = true;
      }
    } else {
      console.log(`[VOICE STT] Primary provider BHASHINI not configured or disabled. Using SARVAM STT directly.`);
    }

    // 2. Attempt Fallback: Sarvam STT
    if (this.fallbackProvider && this.fallbackProvider.isConfigured()) {
      try {
        console.log(`[VOICE STT] Attempting FALLBACK provider: SARVAM (lang: ${languageCode})`);
        const result = await this.fallbackProvider.transcribe({
          audioBuffer,
          mimeType,
          languageCode,
          voiceRequestId
        });
        console.log(`[VOICE STT] Fallback provider SARVAM succeeded (transcript length: ${result.transcript?.length || 0})`);
        if (fallbackOccurred) {
          result.fallbackFrom = 'bhashini';
        }
        return result;
      } catch (sarvamErr) {
        console.error(`[VOICE STT] Fallback provider SARVAM failed [${sarvamErr.code || sarvamErr.message}].`);
        throw sarvamErr;
      }
    }

    if (lastError) {
      throw lastError;
    }

    const unconfiguredErr = new Error('No speech-to-text service is currently configured.');
    unconfiguredErr.code = 'PROVIDER_NOT_CONFIGURED';
    unconfiguredErr.userMessage = 'Speech recognition service is currently unavailable. Please type your request.';
    throw unconfiguredErr;
  }

  validateAudio(audioBuffer) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
      const err = new Error('No valid audio buffer provided.');
      err.code = 'INVALID_AUDIO';
      err.userMessage = "I couldn't hear anything. Please try again.";
      throw err;
    }

    if (audioBuffer.length < 400) {
      const err = new Error(`Audio recording too short (${audioBuffer.length} bytes).`);
      err.code = 'AUDIO_TOO_SHORT';
      err.userMessage = "I couldn't hear anything. Please try again.";
      throw err;
    }

    if (audioBuffer.length > 10 * 1024 * 1024) {
      const err = new Error(`Audio recording exceeds maximum limit (${audioBuffer.length} bytes).`);
      err.code = 'AUDIO_TOO_LARGE';
      err.userMessage = "The voice recording is too large. Please speak a shorter sentence.";
      throw err;
    }

    const startOffset = Math.min(44, Math.floor(audioBuffer.length / 4));
    let nonZeroCount = 0;
    const sampleLimit = Math.min(audioBuffer.length, startOffset + 2000);
    for (let i = startOffset; i < sampleLimit; i++) {
      if (audioBuffer[i] !== 0 && audioBuffer[i] !== 128) {
        nonZeroCount++;
      }
    }

    if (nonZeroCount < 10) {
      const err = new Error('Audio buffer contains only silence.');
      err.code = 'AUDIO_SILENT';
      err.userMessage = "I couldn't hear anything. Please try again.";
      throw err;
    }

    return true;
  }

  /**
   * Transcribe an audio recording to text.
   * Enforces duplicate protection: multiple calls with the same voiceRequestId
   * will NOT trigger multiple credit-consuming requests to upstream providers.
   */
  async transcribe({ audioBuffer, mimeType = 'audio/wav', languageCode = 'ta-IN', voiceRequestId = null } = {}) {
    // 1. Check duplicate request cache
    if (voiceRequestId && typeof voiceRequestId === 'string') {
      const existing = this.processedRequests.get(voiceRequestId);
      if (existing) {
        if (existing.result) {
          console.log(`[VOICE STT] Duplicate voiceRequestId "${voiceRequestId}" detected. Returning cached transcription without consuming credit.`);
          return {
            ...existing.result,
            is_cached: true
          };
        }
        if (existing.inFlightPromise) {
          console.log(`[VOICE STT] In-flight request for voiceRequestId "${voiceRequestId}" detected. Awaiting identical request.`);
          return await existing.inFlightPromise;
        }
      }
    }

    // 2. Wrap execution in in-flight tracking
    let executePromise;
    if (voiceRequestId) {
      executePromise = (async () => {
        const res = await this._executeTranscription({
          audioBuffer,
          mimeType,
          languageCode,
          voiceRequestId
        });
        this.processedRequests.set(voiceRequestId, {
          timestamp: Date.now(),
          result: res,
          inFlightPromise: null
        });
        return res;
      })();

      this.processedRequests.set(voiceRequestId, {
        timestamp: Date.now(),
        result: null,
        inFlightPromise: executePromise
      });

      try {
        return await executePromise;
      } catch (err) {
        // Remove from cache on error so valid retries aren't permanently locked
        this.processedRequests.delete(voiceRequestId);
        throw err;
      }
    } else {
      return await this._executeTranscription({
        audioBuffer,
        mimeType,
        languageCode,
        voiceRequestId: null
      });
    }
  }
}

const defaultSpeechService = new SpeechService();

module.exports = {
  SpeechService,
  defaultSpeechService
};
