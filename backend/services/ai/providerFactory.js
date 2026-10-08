/**
 * AI Provider Factory & Fallback Chain
 * Manages Primary LLM -> Secondary LLM -> Deterministic Offline Rule Parser.
 *
 * Rules:
 * - Fallback ONLY on provider/service failures (429, quota, timeout, network error, 5xx).
 * - Never switch providers for valid conversational states (missing fields, ambiguity, low confidence).
 * - Standardizes output schema across all providers.
 * - Never leaks API keys or secrets.
 */

const GeminiProvider = require('./geminiProvider');
const OpenAIProvider = require('./openaiProvider');
const FallbackRuleProvider = require('./fallbackRuleProvider');

function sanitizeError(err) {
  let msg = err?.message || String(err) || 'Unknown error';
  msg = msg.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
  msg = msg.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  msg = msg.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/AQ\.[0-9A-Za-z-_]{30,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/gsk_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/sk-or-v1-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/password=[^&\s]+/gi, 'password=[REDACTED]');
  return msg;
}

class ProviderFactory {
  constructor() {
    this.primaryProvider = null;
    this.fallbackProviders = [];
    this.fallbackProvider = null;
    this.offlineRuleProvider = new FallbackRuleProvider();
    this.enableOfflineFallback = process.env.AI_ENABLE_OFFLINE_FALLBACK !== 'false';
    this.initializeProviders();
  }

  /**
   * Instantiate an AI provider based on configuration.
   */
  createProviderInstance(providerName, { name, model, apiKey, baseUrl, timeoutMs, fetchFn } = {}) {
    const norm = String(providerName || '').trim().toLowerCase();
    switch (norm) {
      case 'gemini':
        return new GeminiProvider({
          model: model || process.env.AI_MODEL || 'gemini-3.5-flash-lite',
          apiKey: apiKey !== undefined ? apiKey : (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || ''),
          baseUrl: baseUrl || process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com',
          timeoutMs: timeoutMs !== undefined ? timeoutMs : Number(process.env.AI_TIMEOUT_MS || 30000)
        });
      case 'groq':
        return new OpenAIProvider({
          name: 'groq',
          model: model || process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
          apiKey: apiKey !== undefined ? apiKey : (process.env.GROQ_API_KEY || ''),
          baseUrl: baseUrl || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
          timeoutMs: timeoutMs !== undefined ? timeoutMs : Number(process.env.AI_TIMEOUT_MS || 30000),
          fetchFn
        });
      case 'openrouter':
        return new OpenAIProvider({
          name: 'openrouter',
          model: model || process.env.OPENROUTER_MODEL || 'openrouter/free',
          apiKey: apiKey !== undefined ? apiKey : (process.env.OPENROUTER_API_KEY || ''),
          baseUrl: baseUrl || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
          timeoutMs: timeoutMs !== undefined ? timeoutMs : Number(process.env.AI_TIMEOUT_MS || 30000),
          fetchFn
        });
      case 'openai':
        return new OpenAIProvider({
          name: name || 'openai',
          model: model || process.env.OPENAI_MODEL || process.env.AI_FALLBACK_MODEL || 'gpt-4o-mini',
          apiKey: apiKey !== undefined ? apiKey : (process.env.OPENAI_API_KEY || process.env.AI_FALLBACK_API_KEY || ''),
          baseUrl: baseUrl || process.env.OPENAI_BASE_URL || process.env.AI_FALLBACK_BASE_URL || 'https://api.openai.com/v1',
          timeoutMs: timeoutMs !== undefined ? timeoutMs : Number(process.env.OPENAI_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 30000),
          fetchFn
        });
      case 'rules':
      case 'fallback_rules':
        return new FallbackRuleProvider();
      default:
        return null;
    }
  }

  /**
   * Read environment configuration and set up primary & fallback providers.
   * Fallback chain: Gemini (primary) -> Groq (fallback 1) -> OpenRouter (fallback 2) -> Offline Rules (fallback 3)
   */
  initializeProviders() {
    const primaryName = process.env.AI_PROVIDER || 'gemini';
    const primaryModel = process.env.AI_MODEL || (primaryName === 'gemini' ? 'gemini-3.5-flash-lite' : 'openai/gpt-oss-120b');
    const primaryKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '';
    const primaryBaseUrl = process.env.AI_BASE_URL || '';
    const primaryTimeoutMs = Number(process.env.AI_TIMEOUT_MS || 30000);

    this.primaryProvider = this.createProviderInstance(primaryName, {
      model: primaryModel,
      apiKey: primaryKey,
      baseUrl: primaryBaseUrl,
      timeoutMs: primaryTimeoutMs
    });

    this.fallbackProviders = [];

    // Fallback 1: Groq
    const groq = this.createProviderInstance('groq');
    if (groq) this.fallbackProviders.push(groq);

    // Fallback 2: OpenRouter
    const openrouter = this.createProviderInstance('openrouter');
    if (openrouter) this.fallbackProviders.push(openrouter);

    // Optional Fallback: OpenAI (if OPENAI_API_KEY is configured)
    if (process.env.OPENAI_API_KEY || (process.env.AI_FALLBACK_PROVIDER === 'openai' && process.env.AI_FALLBACK_API_KEY)) {
      const openai = this.createProviderInstance('openai');
      if (openai) this.fallbackProviders.push(openai);
    }

    // Preserve legacy single fallback reference
    this.fallbackProvider = this.fallbackProviders[0] || null;
  }

  /**
   * Re-read environment variables and reload provider instances.
   */
  reinitialize() {
    this.enableOfflineFallback = process.env.AI_ENABLE_OFFLINE_FALLBACK !== 'false';
    this.initializeProviders();
    return this;
  }

  /**
   * Execute understanding request through provider chain:
   * 1. Primary LLM (Gemini)
   * 2. Fallback LLM 1 (Groq)
   * 3. Fallback LLM 2 (OpenRouter)
   * 4. Offline Rule-Based (Guaranteed deterministic fallback)
   */
  async extractIntent(params) {
    const errors = [];
    console.log('[VOICE AI] Request received');

    const providerChain = [];
    if (this.primaryProvider) {
      providerChain.push(this.primaryProvider);
    }
    if (Array.isArray(this.fallbackProviders)) {
      for (const fp of this.fallbackProviders) {
        if (fp && !providerChain.includes(fp)) {
          providerChain.push(fp);
        }
      }
    } else if (this.fallbackProvider && !providerChain.includes(this.fallbackProvider)) {
      providerChain.push(this.fallbackProvider);
    }

    const getDisplayName = (provider) => {
      if (!provider) return 'AI';
      if (provider.name === 'gemini') return 'Gemini';
      if (provider.name === 'groq') return 'Groq';
      if (provider.name === 'openrouter') return 'OpenRouter';
      if (provider.name === 'openai') return 'OpenAI';
      return provider.name.charAt(0).toUpperCase() + provider.name.slice(1);
    };

    for (let i = 0; i < providerChain.length; i++) {
      const provider = providerChain[i];
      const providerUpper = (provider.name || 'AI').toUpperCase();
      const displayName = getDisplayName(provider);
      const nextProvider = providerChain[i + 1];
      const nextTarget = nextProvider ? (nextProvider.name || 'AI').toUpperCase() : 'OFFLINE_RULES';

      // Gracefully skip unconfigured external provider without crashing
      const isLocal = provider.baseUrl && (provider.baseUrl.includes('localhost') || provider.baseUrl.includes('127.0.0.1'));
      if (!provider.apiKey && !isLocal) {
        const missingKeyMsg = provider.name === 'gemini'
          ? 'Gemini API key is not configured (AI_API_KEY).'
          : `${displayName} API key is not configured.`;
        errors.push({ provider: provider.name, error: missingKeyMsg, code: 'MISSING_API_KEY' });
        console.log(`[VOICE AI] Attempting provider: ${providerUpper}`);
        console.log(`[VOICE AI] ${displayName} failed: ${missingKeyMsg}`);
        console.log(`[VOICE AI] Falling back to ${nextTarget}`);
        continue;
      }

      console.log(`[VOICE AI] Attempting provider: ${providerUpper}`);
      try {
        const result = await provider.extractIntent(params);
        console.log(`[VOICE AI] ${displayName} succeeded`);
        console.log(`[VOICE AI] Model: ${provider.model}`);
        return {
          ...result,
          provider_used: provider.name,
          fallback_history: errors.length > 0 ? errors.map(e => e.provider) : undefined
        };
      } catch (err) {
        const safeErr = sanitizeError(err);
        errors.push({ provider: provider.name, error: safeErr, code: err.code });
        console.log(`[VOICE AI] ${displayName} failed: ${safeErr}`);
        console.log(`[VOICE AI] Falling back to ${nextTarget}`);
      }
    }

    // 4. Deterministic Offline Rule Parser (Guaranteed fallback)
    if (this.enableOfflineFallback && this.offlineRuleProvider) {
      try {
        const result = await this.offlineRuleProvider.extractIntent(params);
        return {
          ...result,
          provider_used: 'fallback_rules',
          fallback_history: errors.length > 0 ? errors.map(e => e.provider) : undefined
        };
      } catch (ruleErr) {
        console.error('[VOICE AI] Critical: Offline rule provider encountered error:', ruleErr);
        throw ruleErr;
      }
    }

    // If offline fallback was disabled and all failed
    const finalErr = new Error('All configured AI providers failed to process the request.');
    finalErr.details = errors;
    throw finalErr;
  }

  /**
   * Public health status report (strictly no secrets or API keys)
   */
  getHealth() {
    return {
      status: 'ok',
      service: 'Kisan Voice AI Agent',
      timestamp: new Date().toISOString(),
      primary: {
        provider: this.primaryProvider ? this.primaryProvider.name : 'none',
        model: this.primaryProvider?.model || 'none',
        configured: Boolean(this.primaryProvider?.apiKey || this.primaryProvider?.baseUrl)
      },
      secondary: {
        provider: this.fallbackProviders?.[0]?.name || this.fallbackProvider?.name || 'none',
        model: this.fallbackProviders?.[0]?.model || this.fallbackProvider?.model || 'none',
        configured: Boolean(this.fallbackProviders?.[0]?.apiKey || this.fallbackProvider?.apiKey)
      },
      fallbacks: (this.fallbackProviders || []).map(fp => ({
        provider: fp.name,
        model: fp.model,
        configured: Boolean(fp.apiKey)
      })),
      gemini_configured: Boolean(process.env.AI_API_KEY || process.env.GEMINI_API_KEY),
      groq_configured: Boolean(process.env.GROQ_API_KEY),
      openrouter_configured: Boolean(process.env.OPENROUTER_API_KEY),
      openai_configured: Boolean(process.env.OPENAI_API_KEY || process.env.AI_FALLBACK_API_KEY),
      primary_model: this.primaryProvider?.model || process.env.AI_MODEL || 'none',
      fallback_model: this.fallbackProviders?.[0]?.model || process.env.GROQ_MODEL || 'none',
      timeout_ms: Number(process.env.AI_TIMEOUT_MS || 30000),
      offline_fallback: {
        enabled: this.enableOfflineFallback,
        provider: 'fallback_rules'
      }
    };
  }
}

// Singleton instance
const defaultFactory = new ProviderFactory();

module.exports = {
  ProviderFactory,
  defaultFactory
};
