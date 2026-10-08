/**
 * Google Gemini AI Provider Adapter
 * Uses native fetch with AbortController for reliable, dependency-free Gemini API communication.
 */

const AIProvider = require('./aiProvider');

class GeminiProvider extends AIProvider {
  constructor({
    model = 'gemini-2.5-flash-lite',
    apiKey = '',
    baseUrl = 'https://generativelanguage.googleapis.com',
    timeoutMs
  } = {}) {
    const resolvedTimeout = Number(timeoutMs || process.env.AI_TIMEOUT_MS || 30000);
    super({ name: 'gemini', model, apiKey, baseUrl, timeoutMs: resolvedTimeout });
  }

  async extractIntent({ text, transcript, conversationHistory = [], currentDraft = {}, availableDistricts = [], availableCentres = [], farmerName = '' } = {}) {
    const inputQuery = text || transcript || '';
    if (!this.apiKey) {
      const err = new Error('Gemini API key is not configured (AI_API_KEY).');
      err.code = 'MISSING_API_KEY';
      throw err;
    }

    const systemPrompt = this.buildSystemPrompt({ availableDistricts, availableCentres, currentDraft, farmerName });
    const schemaInstruction = this.getSchemaInstruction();

    // Build contents array with conversation context
    const parts = [
      { text: `${systemPrompt}\n\n${schemaInstruction}\n\nRecent Conversation History:\n${JSON.stringify(conversationHistory.slice(-4))}\n\nCurrent Farmer Utterance:\n"${inputQuery}"\n\nReturn ONLY the JSON result:` }
    ];

    const url = `${this.baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch (_) {}

        const err = new Error(`Gemini API error [${response.status}]: ${errorJson?.error?.message || errorText || response.statusText}`);
        err.status = response.status;
        if (response.status === 429) {
          err.code = 'QUOTA_OR_RATE_LIMIT';
        } else if (response.status === 401 || response.status === 403) {
          err.code = 'AUTH_ERROR';
        } else if (response.status >= 500) {
          err.code = 'SERVER_ERROR';
        } else {
          err.code = 'API_ERROR';
        }
        throw err;
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        const err = new Error('Empty response from Gemini model');
        err.code = 'EMPTY_RESPONSE';
        throw err;
      }

      // Parse JSON from model text (stripping markdown backticks if present)
      const cleanJson = rawText.replace(/```(?:json)?/gi, '').trim();
      const parsed = JSON.parse(cleanJson);
      return this.normalizeResult(parsed, currentDraft);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Gemini API request timed out after ${this.timeoutMs}ms`);
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    }
  }
}

module.exports = GeminiProvider;
