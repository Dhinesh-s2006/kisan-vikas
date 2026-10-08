/**
 * OpenAI-Compatible AI Provider Adapter
 * Supports OpenAI, Groq, Ollama, DeepSeek, or any proxy conforming to /v1/chat/completions.
 */

const AIProvider = require('./aiProvider');

class OpenAIProvider extends AIProvider {
  constructor({
    name = 'openai',
    model,
    apiKey,
    baseUrl,
    timeoutMs,
    fetchFn
  } = {}) {
    const resolvedName = name || 'openai';

    let defaultModel = 'gpt-4o-mini';
    let defaultApiKey = '';
    let defaultBaseUrl = 'https://api.openai.com/v1';

    if (resolvedName === 'groq') {
      defaultModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
      defaultApiKey = process.env.GROQ_API_KEY || '';
      defaultBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
    } else if (resolvedName === 'openrouter') {
      defaultModel = process.env.OPENROUTER_MODEL || 'openrouter/free';
      defaultApiKey = process.env.OPENROUTER_API_KEY || '';
      defaultBaseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    } else {
      defaultModel = process.env.OPENAI_MODEL || process.env.AI_FALLBACK_MODEL || 'gpt-4o-mini';
      defaultApiKey = process.env.OPENAI_API_KEY || process.env.AI_FALLBACK_API_KEY || '';
      defaultBaseUrl = process.env.OPENAI_BASE_URL || process.env.AI_FALLBACK_BASE_URL || 'https://api.openai.com/v1';
    }

    const resolvedModel = model || defaultModel;
    const resolvedApiKey = apiKey !== undefined ? apiKey : defaultApiKey;
    const resolvedBaseUrl = baseUrl || defaultBaseUrl;
    const resolvedTimeout = Number(
      timeoutMs ||
      process.env.OPENAI_TIMEOUT_MS ||
      process.env.AI_TIMEOUT_MS ||
      30000
    );
    super({
      name: resolvedName,
      model: resolvedModel,
      apiKey: resolvedApiKey,
      baseUrl: resolvedBaseUrl,
      timeoutMs: resolvedTimeout
    });
    this.fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  }

  async extractIntent({ text, transcript, conversationHistory = [], currentDraft = {}, availableDistricts = [], availableCentres = [], farmerName = '' } = {}) {
    const inputQuery = text || transcript || '';
    const providerLabel = this.name === 'openai'
      ? 'OpenAI'
      : this.name === 'groq'
        ? 'Groq'
        : this.name === 'openrouter'
          ? 'OpenRouter'
          : (this.name ? this.name.charAt(0).toUpperCase() + this.name.slice(1) : 'OpenAI');

    if (!this.apiKey && !this.baseUrl.includes('localhost') && !this.baseUrl.includes('127.0.0.1')) {
      const err = new Error(`${providerLabel} API key is not configured.`);
      err.code = 'MISSING_API_KEY';
      throw err;
    }

    const systemPrompt = this.buildSystemPrompt({ availableDistricts, availableCentres, currentDraft, farmerName });
    const schemaInstruction = this.getSchemaInstruction();

    const messages = [
      { role: 'system', content: `${systemPrompt}\n\n${schemaInstruction}` }
    ];

    if (Array.isArray(conversationHistory)) {
      conversationHistory.slice(-4).forEach(msg => {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content)
          });
        }
      });
    }

    messages.push({ role: 'user', content: inputQuery });

    const cleanBaseUrl = this.baseUrl.replace(/\/+$/, '');
    const url = cleanBaseUrl.endsWith('/chat/completions')
      ? cleanBaseUrl
      : `${cleanBaseUrl}/chat/completions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const fetchImpl = this.fetchFn || fetch;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://kisan-queue.gov.in',
          'X-Title': 'Kisan Queue Voice Assistant'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.1
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch (_) {}

        const err = new Error(`${providerLabel} API error [${response.status}]: ${errorJson?.error?.message || errorText || response.statusText}`);
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
      const rawText = data?.choices?.[0]?.message?.content;
      if (!rawText) {
        const err = new Error(`Empty response from ${providerLabel}-compatible provider`);
        err.code = 'EMPTY_RESPONSE';
        throw err;
      }

      const cleanJson = rawText.replace(/```(?:json)?/gi, '').trim();
      const parsed = JSON.parse(cleanJson);
      return this.normalizeResult(parsed, currentDraft);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`${providerLabel} API request timed out after ${this.timeoutMs}ms`);
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    }
  }
}

module.exports = OpenAIProvider;
