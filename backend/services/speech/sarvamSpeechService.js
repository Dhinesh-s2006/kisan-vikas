/**
 * Sarvam AI Speech-to-Text Provider
 * Handles audio submission to Sarvam STT (saaras:v3) with credit protection,
 * timeout controls, error sanitization, and safe logging.
 */

function sanitizeError(err) {
  let msg = err?.message || String(err) || 'Unknown error';
  msg = msg.replace(/api-subscription-key=[^&\s]+/gi, 'api-subscription-key=[REDACTED]');
  msg = msg.replace(/sk_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  return msg;
}

class SarvamSpeechService {
  constructor({
    apiKey,
    enabled,
    model,
    baseUrl,
    timeoutMs
  } = {}) {
    this.apiKey = apiKey !== undefined ? apiKey : (process.env.SARVAM_API_KEY || '');
    this.enabled = enabled !== undefined ? enabled : (process.env.SARVAM_STT_ENABLED !== 'false');
    this.model = model || process.env.SARVAM_STT_MODEL || 'saaras:v3';
    this.baseUrl = (baseUrl || process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai').replace(/\/+$/, '');
    this.timeoutMs = Number(timeoutMs || process.env.SARVAM_TIMEOUT_MS || 15000);
  }

  isConfigured() {
    return Boolean(this.enabled && this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Normalize language code to Sarvam format (e.g., 'ta' -> 'ta-IN', 'en' -> 'en-IN')
   */
  normalizeLanguageCode(lang) {
    if (!lang) return 'ta-IN';
    const clean = String(lang).trim().toLowerCase();
    if (clean === 'ta' || clean.startsWith('ta-') || clean.includes('tamil')) return 'ta-IN';
    if (clean === 'en' || clean.startsWith('en-') || clean.includes('english')) return 'en-IN';
    if (clean === 'hi' || clean.startsWith('hi-') || clean.includes('hindi')) return 'hi-IN';
    if (clean === 'te' || clean.startsWith('te-') || clean.includes('telugu')) return 'te-IN';
    if (clean === 'kn' || clean.startsWith('kn-') || clean.includes('kannada')) return 'kn-IN';
    if (clean === 'ml' || clean.startsWith('ml-') || clean.includes('malayalam')) return 'ml-IN';
    return lang;
  }

  /**
   * Determine suitable filename for the given MIME type
   */
  getFilenameForMime(mimeType) {
    const clean = String(mimeType || '').toLowerCase();
    if (clean.includes('webm')) return 'speech.webm';
    if (clean.includes('ogg') || clean.includes('opus')) return 'speech.ogg';
    if (clean.includes('mp4') || clean.includes('m4a') || clean.includes('aac')) return 'speech.m4a';
    if (clean.includes('mp3') || clean.includes('mpeg')) return 'speech.mp3';
    if (clean.includes('flac')) return 'speech.flac';
    return 'speech.wav';
  }

  /**
   * Normalize MIME type to match Sarvam allowed audio types list (strips codec parameters like ;codecs=opus)
   */
  cleanMimeType(mimeType) {
    if (!mimeType) return 'audio/webm';
    const base = String(mimeType).split(';')[0].trim().toLowerCase();
    if (base.includes('webm')) return 'audio/webm';
    if (base.includes('ogg') || base.includes('opus')) return 'audio/ogg';
    if (base.includes('mp4') || base.includes('m4a')) return 'audio/mp4';
    if (base.includes('wav')) return 'audio/wav';
    if (base.includes('mpeg') || base.includes('mp3')) return 'audio/mpeg';
    if (base.includes('flac')) return 'audio/flac';
    if (base.includes('aac')) return 'audio/aac';
    return base || 'audio/webm';
  }

  /**
   * Performs preliminary checks on audio buffer to protect API credits.
   */
  validateAudio(audioBuffer) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
      const err = new Error('No valid audio buffer provided.');
      err.code = 'INVALID_AUDIO';
      err.userMessage = "I couldn't hear anything. Please try again.";
      throw err;
    }

    // Minimum 400 bytes (header + minimum audible audio frames)
    if (audioBuffer.length < 400) {
      const err = new Error(`Audio recording too short (${audioBuffer.length} bytes).`);
      err.code = 'AUDIO_TOO_SHORT';
      err.userMessage = "I couldn't hear anything. Please try again.";
      throw err;
    }

    // Maximum 10MB limit
    if (audioBuffer.length > 10 * 1024 * 1024) {
      const err = new Error(`Audio recording exceeds maximum limit (${audioBuffer.length} bytes).`);
      err.code = 'AUDIO_TOO_LARGE';
      err.userMessage = "The voice recording is too large. Please speak a shorter sentence.";
      throw err;
    }

    // Fast silence detection: check if all samples in data payload are identical or near zero
    // Skip first 44 bytes (potential WAV header)
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
   * Transcribe audio buffer using Sarvam STT REST API
   * @param {Object} params
   * @param {Buffer} params.audioBuffer - Raw audio data
   * @param {string} [params.mimeType='audio/wav'] - MIME type of the audio
   * @param {string} [params.languageCode='ta-IN'] - Expected language ('ta-IN', 'en-IN')
   * @param {string} [params.voiceRequestId] - Unique tracking request identifier
   * @returns {Promise<Object>} { transcript, language, rawLanguageCode, requestId }
   */
  async transcribe({ audioBuffer, mimeType = 'audio/wav', languageCode = 'ta-IN', voiceRequestId = null } = {}) {
    if (!this.isConfigured()) {
      const err = new Error('Sarvam STT is not configured or disabled (SARVAM_API_KEY).');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      err.userMessage = 'Speech recognition service is currently unavailable. Please type your request.';
      throw err;
    }

    // 1. Credit Protection Validation: Discard invalid/empty audio before contacting API
    this.validateAudio(audioBuffer);

    const normalizedMime = this.cleanMimeType(mimeType);
    const filename = this.getFilenameForMime(normalizedMime);
    const resolvedLang = this.normalizeLanguageCode(languageCode);

    // 2. Build multipart/form-data payload natively
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: normalizedMime });
    form.append('file', blob, filename);
    form.append('model', this.model);
    if (resolvedLang) {
      form.append('language_code', resolvedLang);
    }

    const endpoint = `${this.baseUrl}/speech-to-text`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    console.log(`[VOICE STT] Request ${voiceRequestId || 'VR-N/A'} - Submitting ${audioBuffer.length} bytes (${filename}, ${resolvedLang}) to Sarvam (${this.model})`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey
        },
        body: form,
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch (_) {}

        const errMessage = errorJson?.error?.message || errorJson?.detail || errorText || response.statusText;
        const err = new Error(`Sarvam STT error [${response.status}]: ${errMessage}`);
        err.status = response.status;

        if (response.status === 400) {
          err.code = 'INVALID_AUDIO_FORMAT';
          err.userMessage = "I couldn't process the audio recording. Please try speaking again.";
        } else if (response.status === 401 || response.status === 403) {
          err.code = 'AUTH_ERROR';
          err.userMessage = 'Speech recognition authorization failed.';
        } else if (response.status === 429) {
          err.code = 'QUOTA_EXHAUSTED';
          err.userMessage = 'Speech service is busy right now. Please try again or type below.';
        } else if (response.status >= 500) {
          err.code = 'SERVER_ERROR';
          err.userMessage = 'Speech service temporarily unavailable. Please try again.';
        } else {
          err.code = 'API_ERROR';
          err.userMessage = 'Unable to transcribe voice input.';
        }

        console.error(`[VOICE STT] Request ${voiceRequestId || 'VR-N/A'} - Sarvam error: ${sanitizeError(err)}`);
        throw err;
      }

      const data = await response.json();
      const transcript = String(data.transcript || '').trim();
      const detectedLang = data.language_code || resolvedLang;

      console.log(`[VOICE STT] Request ${voiceRequestId || 'VR-N/A'} - Sarvam STT succeeded (length: ${transcript.length}, lang: ${detectedLang})`);

      return {
        transcript,
        language: detectedLang.startsWith('ta') ? 'ta' : (detectedLang.startsWith('en') ? 'en' : detectedLang),
        rawLanguageCode: detectedLang,
        requestId: data.request_id || null,
        provider: 'sarvam'
      };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Sarvam STT timed out after ${this.timeoutMs}ms.`);
        timeoutErr.code = 'TIMEOUT';
        timeoutErr.userMessage = 'Voice processing took too long. Please try speaking again.';
        console.error(`[VOICE STT] Request ${voiceRequestId || 'VR-N/A'} - ${timeoutErr.message}`);
        throw timeoutErr;
      }
      throw err;
    }
  }
}

module.exports = SarvamSpeechService;
