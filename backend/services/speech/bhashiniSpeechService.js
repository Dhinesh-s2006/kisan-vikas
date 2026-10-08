/**
 * Bhashini ASR Speech-to-Text Provider (Primary)
 * Integrates with Digital India Bhashini Division (Udyat / ULCA pipeline)
 * 
 * Features:
 * - Dynamic service discovery via getModelsPipeline (no hardcoded model IDs)
 * - Safe credential isolation (never hardcoded in source, read strictly from process.env)
 * - Multi-language support (Tamil, English, Hindi, Telugu, Kannada, Malayalam)
 * - Safe key redaction & error sanitization
 * - In-memory pipeline configuration caching
 * - Credit & quality validation (discards silent or malformed audio)
 */

function sanitizeError(err) {
  let msg = err?.message || String(err) || 'Unknown error';
  msg = msg.replace(/api-subscription-key=[^&\s]+/gi, 'api-subscription-key=[REDACTED]');
  msg = msg.replace(/ulcaApiKey=[^&\s]+/gi, 'ulcaApiKey=[REDACTED]');
  msg = msg.replace(/sk_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  msg = msg.replace(/[0-9a-fA-F]{32,}/g, '[REDACTED_KEY]');
  return msg;
}

class BhashiniSpeechService {
  constructor({
    userId,
    udyatKey,
    inferenceKey,
    pipelineId,
    serviceId,
    enabled,
    configUrl,
    computeUrl,
    timeoutMs
  } = {}) {
    // Strictly read from environment or constructor; NEVER hardcode credentials in source
    this.userId = userId !== undefined ? userId : (process.env.BHASHINI_USER_ID || '');
    this.udyatKey = udyatKey !== undefined ? udyatKey : (process.env.BHASHINI_UDYAT_KEY || process.env.BHASHINI_ULCA_API_KEY || '');
    this.inferenceKey = inferenceKey !== undefined ? inferenceKey : (process.env.BHASHINI_INFERENCE_KEY || '');
    this.pipelineId = pipelineId || process.env.BHASHINI_PIPELINE_ID || '';
    this.serviceIdOverride = serviceId || process.env.BHASHINI_SERVICE_ID || '';
    this.enabled = enabled !== undefined ? enabled : (process.env.BHASHINI_ASR_ENABLED !== 'false');
    this.configUrl = (configUrl || process.env.BHASHINI_CONFIG_URL || 'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline').replace(/\/+$/, '');
    this.computeUrl = (computeUrl || process.env.BHASHINI_COMPUTE_URL || 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline').replace(/\/+$/, '');
    this.timeoutMs = Number(timeoutMs || process.env.BHASHINI_TIMEOUT_MS || 15000);

    // Cache discovered pipeline endpoints & serviceIds per language: Map<sourceLang, { serviceId, callbackUrl, inferenceApiKeyName, inferenceApiKeyValue, audioFormat, timestamp }>
    this.pipelineCache = new Map();
    this.cacheTtlMs = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Evaluates if Bhashini is fully configured with required credentials without leaking secrets.
   */
  isConfigured() {
    return Boolean(
      this.enabled &&
      this.userId && this.userId.trim().length > 0 &&
      this.udyatKey && this.udyatKey.trim().length > 0 &&
      this.inferenceKey && this.inferenceKey.trim().length > 0
    );
  }

  /**
   * Normalizes input language string to Bhashini standard 2-letter language code
   */
  normalizeLanguageCode(lang) {
    if (!lang) return 'ta';
    const clean = String(lang).trim().toLowerCase();
    if (clean === 'ta' || clean.startsWith('ta-') || clean.includes('tamil')) return 'ta';
    if (clean === 'en' || clean.startsWith('en-') || clean.includes('english')) return 'en';
    if (clean === 'hi' || clean.startsWith('hi-') || clean.includes('hindi')) return 'hi';
    if (clean === 'te' || clean.startsWith('te-') || clean.includes('telugu')) return 'te';
    if (clean === 'kn' || clean.startsWith('kn-') || clean.includes('kannada')) return 'kn';
    if (clean === 'ml' || clean.startsWith('ml-') || clean.includes('malayalam')) return 'ml';
    return clean.split(/[-_]/)[0] || 'ta';
  }

  /**
   * Client-side audio validation: Discard empty, silent, or oversize audio before contacting Bhashini.
   */
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

    // Fast silence detection
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
   * Discover pipeline service configuration for target language.
   * Caches configuration to minimize discovery roundtrips.
   */
  async getPipelineConfig(sourceLang) {
    const cached = this.pipelineCache.get(sourceLang);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached;
    }

    // If an explicit serviceId override is set via environment, we can use default compute endpoint
    if (this.serviceIdOverride) {
      const config = {
        serviceId: this.serviceIdOverride,
        callbackUrl: this.computeUrl,
        inferenceApiKeyName: 'Authorization',
        inferenceApiKeyValue: this.inferenceKey,
        audioFormat: 'wav'
      };
      this.pipelineCache.set(sourceLang, { ...config, timestamp: Date.now() });
      return config;
    }

    const payload = {
      pipelineTasks: [
        {
          taskType: 'asr',
          config: {
            language: {
              sourceLanguage: sourceLang
            }
          }
        }
      ]
    };

    if (this.pipelineId) {
      payload.pipelineRequestConfig = {
        pipelineId: this.pipelineId
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      console.log(`[BHASHINI ASR] Querying pipeline config for language: ${sourceLang}`);
      const resp = await fetch(this.configUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'userID': this.userId,
          'Authorization': this.udyatKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        throw new Error(`Bhashini getModelsPipeline failed [HTTP ${resp.status}]: ${errorText.substring(0, 200)}`);
      }

      const data = await resp.json();

      // Extract ASR task configuration
      const asrTask = (data.pipelineResponseConfig || []).find(t => t.taskType === 'asr') || (data.pipelineResponseConfig || [])[0];
      const serviceConfig = asrTask?.config?.[0] || asrTask?.config;
      const discoveredServiceId = serviceConfig?.serviceId || '';
      const audioFormat = serviceConfig?.audioFormat || 'wav';

      const inferenceEndpoint = data.pipelineInferenceAPIEndPoint || {};
      const callbackUrl = inferenceEndpoint.callbackUrl || this.computeUrl;
      const inferenceApiKeyName = inferenceEndpoint.inferenceApiKey?.name || 'Authorization';
      const inferenceApiKeyValue = inferenceEndpoint.inferenceApiKey?.value || this.inferenceKey;

      if (!discoveredServiceId) {
        throw new Error(`No Bhashini ASR serviceId discovered for language '${sourceLang}'.`);
      }

      console.log(`[BHASHINI ASR] Discovered ASR serviceId for '${sourceLang}': ${discoveredServiceId} (format: ${audioFormat})`);

      const config = {
        serviceId: discoveredServiceId,
        callbackUrl,
        inferenceApiKeyName,
        inferenceApiKeyValue,
        audioFormat,
        timestamp: Date.now()
      };

      this.pipelineCache.set(sourceLang, config);
      return config;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Bhashini getModelsPipeline timed out after ${this.timeoutMs}ms.`);
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    }
  }

  /**
   * Transcribe an audio buffer using Bhashini ASR
   * @param {Object} params
   * @param {Buffer} params.audioBuffer - Raw audio data
   * @param {string} [params.mimeType='audio/wav'] - MIME type of the audio
   * @param {string} [params.languageCode='ta-IN'] - Expected language ('ta-IN', 'en-IN', 'hi-IN')
   * @param {string} [params.voiceRequestId] - Unique tracking request identifier
   * @returns {Promise<Object>} Normalized transcript structure { transcript, language, rawLanguageCode, requestId, provider }
   */
  async transcribe({ audioBuffer, mimeType = 'audio/wav', languageCode = 'ta-IN', voiceRequestId = null } = {}) {
    if (!this.isConfigured()) {
      const err = new Error('Bhashini ASR is not configured or disabled (BHASHINI_USER_ID, BHASHINI_UDYAT_KEY, BHASHINI_INFERENCE_KEY).');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      err.userMessage = 'Speech recognition service is currently unavailable. Please type your request.';
      throw err;
    }

    // 1. Credit & quality validation
    this.validateAudio(audioBuffer);

    // Audio format check: Bhashini ASR pipeline strictly requires standard PCM WAV format
    const isWav = audioBuffer.length >= 12 &&
      audioBuffer.toString('ascii', 0, 4) === 'RIFF' &&
      audioBuffer.toString('ascii', 8, 12) === 'WAVE';

    if (!isWav) {
      const err = new Error(`Bhashini ASR requires standard PCM WAV format. Received non-WAV format (${mimeType}).`);
      err.code = 'UNSUPPORTED_AUDIO_FORMAT';
      err.userMessage = 'Audio format not supported by Bhashini. Falling back to secondary speech provider.';
      console.warn(`[BHASHINI ASR] Request ${voiceRequestId || 'VR-N/A'} - Non-WAV audio detected (${mimeType}). Triggering fallback.`);
      throw err;
    }

    const sourceLang = this.normalizeLanguageCode(languageCode);

    // 2. Discover or get cached pipeline configuration
    const pipelineConfig = await this.getPipelineConfig(sourceLang);

    // 3. Prepare audio payload (Base64 encoded string)
    const base64Audio = audioBuffer.toString('base64');

    const computePayload = {
      pipelineTasks: [
        {
          taskType: 'asr',
          config: {
            language: {
              sourceLanguage: sourceLang
            },
            serviceId: pipelineConfig.serviceId,
            audioFormat: pipelineConfig.audioFormat || 'wav'
          }
        }
      ],
      inputData: {
        audio: [
          {
            audioContent: base64Audio
          }
        ]
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    console.log(`[BHASHINI ASR] Request ${voiceRequestId || 'VR-N/A'} - Submitting ${audioBuffer.length} bytes to Bhashini ASR (${pipelineConfig.serviceId}, lang: ${sourceLang})`);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      headers[pipelineConfig.inferenceApiKeyName || 'Authorization'] = pipelineConfig.inferenceApiKeyValue || this.inferenceKey;

      const resp = await fetch(pipelineConfig.callbackUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(computePayload),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch (_) {}

        const errMessage = errorJson?.message || errorJson?.error || errorText || resp.statusText;
        const err = new Error(`Bhashini ASR error [${resp.status}]: ${errMessage}`);
        err.status = resp.status;

        if (resp.status === 400) {
          err.code = 'INVALID_AUDIO_FORMAT';
          err.userMessage = "I couldn't process the audio recording. Please try speaking again.";
        } else if (resp.status === 401 || resp.status === 403) {
          err.code = 'AUTH_ERROR';
          err.userMessage = 'Speech recognition authorization failed.';
        } else if (resp.status === 429) {
          err.code = 'QUOTA_EXHAUSTED';
          err.userMessage = 'Speech service is busy right now. Please try again or type below.';
        } else if (resp.status >= 500) {
          err.code = 'SERVER_ERROR';
          err.userMessage = 'Speech service temporarily unavailable. Please try again.';
        } else {
          err.code = 'API_ERROR';
          err.userMessage = 'Unable to transcribe voice input.';
        }

        console.error(`[BHASHINI ASR] Request ${voiceRequestId || 'VR-N/A'} - Error: ${sanitizeError(err)}`);
        throw err;
      }

      const data = await resp.json();

      // Extract transcript: pipelineResponse[0].output[0].source
      const asrResult = (data.pipelineResponse || []).find(r => r.taskType === 'asr') || (data.pipelineResponse || [])[0];
      const output = asrResult?.output?.[0] || {};
      const transcript = String(output.source || output.target || '').trim();

      console.log(`[BHASHINI ASR] Request ${voiceRequestId || 'VR-N/A'} - Succeeded (length: ${transcript.length}, lang: ${sourceLang})`);

      return {
        transcript,
        language: sourceLang,
        rawLanguageCode: languageCode,
        requestId: asrResult?.config?.serviceId || pipelineConfig.serviceId || null,
        provider: 'bhashini',
        serviceId: pipelineConfig.serviceId
      };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Bhashini ASR timed out after ${this.timeoutMs}ms.`);
        timeoutErr.code = 'TIMEOUT';
        timeoutErr.userMessage = 'Voice processing took too long. Please try speaking again.';
        console.error(`[BHASHINI ASR] Request ${voiceRequestId || 'VR-N/A'} - ${timeoutErr.message}`);
        throw timeoutErr;
      }
      throw err;
    }
  }
}

module.exports = BhashiniSpeechService;
