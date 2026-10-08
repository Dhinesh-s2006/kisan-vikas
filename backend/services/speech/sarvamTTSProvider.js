/**
 * Sarvam AI Text-to-Speech (TTS) Provider Adapter
 * Integrates Sarvam 'bulbul:v1'/'bulbul:v2' TTS for Indian languages (Tamil, Hindi, English).
 * 
 * Features:
 * - Direct HTTP REST with AbortController timeout protection
 * - Sanitized logging (never leaks subscription keys)
 * - Returns base64 audio payload or Buffer
 */

class SarvamTTSProvider {
  constructor({
    apiKey = process.env.SARVAM_API_KEY || '',
    model = process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
    baseUrl = process.env.SARVAM_BASE_URL || 'https://api.sarvam.ai',
    timeoutMs = Number(process.env.SARVAM_TIMEOUT_MS || 15000),
    speaker = process.env.SARVAM_TTS_SPEAKER || 'priya'
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.speaker = speaker;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  normalizeLanguageCode(lang) {
    if (!lang) return 'ta-IN';
    const clean = String(lang).trim().toLowerCase();
    if (clean === 'ta' || clean.startsWith('ta-') || clean.includes('tamil')) return 'ta-IN';
    if (clean === 'en' || clean.startsWith('en-') || clean.includes('english')) return 'en-IN';
    if (clean === 'hi' || clean.startsWith('hi-') || clean.includes('hindi')) return 'hi-IN';
    return 'ta-IN';
  }

  /**
   * Synthesize text into speech audio
   * @param {Object} params
   * @param {string} params.text - The plain text prompt to synthesize
   * @param {string} [params.languageCode='ta-IN'] - Target language
   * @returns {Promise<{ audioBase64: string, mimeType: string, provider: string }>}
   */
  async synthesize({ text, languageCode = 'ta-IN' }) {
    if (!text || text.trim().length === 0) {
      throw new Error('SarvamTTS: Text parameter is required.');
    }

    if (!this.isConfigured()) {
      return {
        audioBase64: null,
        mimeType: 'audio/wav',
        provider: 'sarvam_mock',
        is_mock: true,
        message: 'Sarvam API key not configured; client should use local synthesis or DTMF.'
      };
    }

    const resolvedLang = this.normalizeLanguageCode(languageCode);
    const endpoint = `${this.baseUrl}/text-to-speech`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: [text.trim()],
          target_language_code: resolvedLang,
          speaker: this.speaker,
          model: this.model,
          speech_sample_rate: 8000, // standard telephony rate
          enable_preprocessing: true
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Sarvam TTS error [${response.status}]: ${errText}`);
      }

      const data = await response.json();
      const audioBase64 = data.audios?.[0] || null;

      return {
        audioBase64,
        mimeType: 'audio/wav',
        provider: 'sarvam',
        model: this.model,
        language: resolvedLang
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn('[SarvamTTSProvider] Synthesis failed, returning fallback:', err.message);
      return {
        audioBase64: null,
        mimeType: 'audio/wav',
        provider: 'sarvam_fallback',
        error: err.message
      };
    }
  }
}

module.exports = SarvamTTSProvider;
