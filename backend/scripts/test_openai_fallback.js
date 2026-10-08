/**
 * Automated Verification Suite for Multi-Provider AI Fallback Configuration
 *
 * Verifies the complete fallback chain:
 * Primary: Gemini
 * Fallback 1: Groq
 * Fallback 2: OpenRouter
 * Fallback 3: Offline Rules (Deterministic regex engine)
 *
 * Verifies:
 * 1. Groq uses correct base URL, model, and API key
 * 2. OpenRouter uses correct base URL, model, and API key
 * 3. ProviderFactory precedence: Gemini -> Groq -> OpenRouter -> Offline Rules
 * 4. Gemini success -> no fallback attempted
 * 5. Gemini failure -> Groq attempted and succeeds
 * 6. Gemini failure + Groq failure -> OpenRouter attempted and succeeds
 * 7. Gemini + Groq + OpenRouter failure -> Offline Rules succeeds
 * 8. Missing Groq key -> gracefully skips Groq
 * 9. Missing OpenRouter key -> gracefully skips OpenRouter
 * 10. Missing all external keys -> gracefully falls back to Offline Rules
 * 11. Security: API keys (Gemini, Groq, OpenRouter, OpenAI) are redacted and never logged
 * 12. Schema consistency: Normalized response remains 100% compatible with Kisan Voice Agent
 *
 * STRICT SECURITY:
 * Never prints, logs, or leaks any secret or API key.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const assert = require('assert');

const OpenAIProvider = require('../services/ai/openaiProvider');
const GeminiProvider = require('../services/ai/geminiProvider');
const { ProviderFactory } = require('../services/ai/providerFactory');
const FallbackRuleProvider = require('../services/ai/fallbackRuleProvider');

let total = 0;
let passed = 0;

function record(name, condition, extra = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ [TEST ${total}] ${name}`);
  } else {
    console.error(`  ✗ [TEST ${total}] FAILED: ${name} ${extra}`);
    throw new Error(`Test failed: ${name}`);
  }
}

// Reusable mock fetch returning normalized JSON completion
const createMockFetch = (providerName, modelName) => async (url, options) => {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: 'BOOK_SLOT',
              crop: 'Paddy',
              quantity_quintals: 50,
              preferred_date: '2026-09-30',
              district: 'Ariyalur',
              language: 'en',
              confidence: 0.95,
              assistant_reply: `I have recorded 50 quintals of Paddy for delivery in Ariyalur.`,
              suggested_actions: ['Confirm Booking', 'Change Slot']
            })
          }
        }
      ]
    })
  };
};

async function runMultiProviderFallbackTests() {
  console.log('================================================================');
  console.log('🤖 RUNNING VERIFICATION: MULTI-PROVIDER AI FALLBACK & RESILIENCY');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test Group 1: Groq & OpenRouter Configuration & Base URLs
  // -------------------------------------------------------------
  console.log('--- 1. Provider Adapter Configuration & Base URLs ---');

  const testGroqKey = 'gsk_testplaceholdergroqkey1234567890abcdefghijklmnopqrstuvwxyz';
  const groqInstance = new OpenAIProvider({
    name: 'groq',
    apiKey: testGroqKey
  });

  record(
    'Groq adapter sets name to groq',
    groqInstance.name === 'groq'
  );
  record(
    'Groq adapter resolves base URL to https://api.groq.com/openai/v1',
    groqInstance.baseUrl === (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1')
  );
  record(
    'Groq adapter defaults model to openai/gpt-oss-120b',
    groqInstance.model === (process.env.GROQ_MODEL || 'openai/gpt-oss-120b')
  );
  record(
    'Groq adapter accepts passed API key',
    groqInstance.apiKey === testGroqKey
  );

  const testOpenRouterKey = 'sk-or-v1-testplaceholderopenrouterkey1234567890abcdefghijkl';
  const openrouterInstance = new OpenAIProvider({
    name: 'openrouter',
    apiKey: testOpenRouterKey
  });

  record(
    'OpenRouter adapter sets name to openrouter',
    openrouterInstance.name === 'openrouter'
  );
  record(
    'OpenRouter adapter resolves base URL to https://openrouter.ai/api/v1',
    openrouterInstance.baseUrl === (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
  );
  record(
    'OpenRouter adapter defaults model to openrouter/free',
    openrouterInstance.model === (process.env.OPENROUTER_MODEL || 'openrouter/free')
  );
  record(
    'OpenRouter adapter accepts passed API key',
    openrouterInstance.apiKey === testOpenRouterKey
  );

  // -------------------------------------------------------------
  // Test Group 2: ProviderFactory Fallback Precedence & Health Check
  // -------------------------------------------------------------
  console.log('\n--- 2. Provider Precedence & Health Diagnostics ---');

  const factoryInstance = new ProviderFactory();
  record(
    'Primary provider is configured as Gemini',
    factoryInstance.primaryProvider !== null && factoryInstance.primaryProvider.name === 'gemini'
  );

  record(
    'Fallback 1 is configured as Groq',
    Array.isArray(factoryInstance.fallbackProviders) &&
    factoryInstance.fallbackProviders[0]?.name === 'groq'
  );

  record(
    'Fallback 2 is configured as OpenRouter',
    Array.isArray(factoryInstance.fallbackProviders) &&
    factoryInstance.fallbackProviders[1]?.name === 'openrouter'
  );

  const healthReport = factoryInstance.getHealth();
  record(
    'getHealth() reports primary as gemini',
    healthReport.primary?.provider === 'gemini'
  );
  record(
    'getHealth() reports secondary as groq',
    healthReport.secondary?.provider === 'groq'
  );
  record(
    'getHealth() returns boolean diagnostics for gemini, groq, openrouter, openai',
    typeof healthReport.gemini_configured === 'boolean' &&
    typeof healthReport.groq_configured === 'boolean' &&
    typeof healthReport.openrouter_configured === 'boolean' &&
    typeof healthReport.openai_configured === 'boolean'
  );

  // -------------------------------------------------------------
  // Test Group 3: Gemini Success (No Fallback Triggered)
  // -------------------------------------------------------------
  console.log('\n--- 3. Primary Provider Success (Zero Fallback) ---');

  const factoryPrimarySuccess = new ProviderFactory();
  factoryPrimarySuccess.primaryProvider = {
    name: 'gemini',
    model: 'gemini-3.5-flash-lite',
    apiKey: 'AQ.testmockkey',
    extractIntent: async () => ({
      intent: 'BOOK_SLOT',
      entities: { crop: 'Paddy', quantity_quintals: 50 },
      assistant_reply: 'Booking details recorded.',
      suggested_actions: ['Confirm'],
      confidence: 0.98
    })
  };

  const primaryResult = await factoryPrimarySuccess.extractIntent({ text: 'Book paddy slot' });
  record(
    'Primary Gemini succeeds and returns provider_used = gemini',
    primaryResult.provider_used === 'gemini'
  );
  record(
    'No fallback history recorded when primary succeeds',
    primaryResult.fallback_history === undefined
  );

  // -------------------------------------------------------------
  // Test Group 4: Gemini Fails -> Groq Recovers
  // -------------------------------------------------------------
  console.log('\n--- 4. Gemini Failure -> Groq Fallback ---');

  const factoryGeminiFails = new ProviderFactory();
  factoryGeminiFails.primaryProvider = {
    name: 'gemini',
    model: 'gemini-3.5-flash-lite',
    apiKey: 'AQ.testmockkey',
    extractIntent: async () => {
      const err = new Error('Gemini API quota exceeded (HTTP 429)');
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }
  };
  factoryGeminiFails.fallbackProviders = [
    new OpenAIProvider({
      name: 'groq',
      apiKey: testGroqKey,
      fetchFn: createMockFetch('groq', 'openai/gpt-oss-120b')
    }),
    new OpenAIProvider({
      name: 'openrouter',
      apiKey: testOpenRouterKey,
      fetchFn: createMockFetch('openrouter', 'openrouter/free')
    })
  ];

  const groqResult = await factoryGeminiFails.extractIntent({ text: 'Book 50 quintals paddy tomorrow' });
  record(
    'Groq is attempted and succeeds when Gemini fails',
    groqResult.provider_used === 'groq'
  );
  record(
    'Fallback history records gemini failure',
    Array.isArray(groqResult.fallback_history) && groqResult.fallback_history.includes('gemini')
  );

  // -------------------------------------------------------------
  // Test Group 5: Gemini Fails + Groq Fails -> OpenRouter Recovers
  // -------------------------------------------------------------
  console.log('\n--- 5. Gemini Fails + Groq Fails -> OpenRouter Fallback ---');

  const factoryDualFails = new ProviderFactory();
  factoryDualFails.primaryProvider = {
    name: 'gemini',
    model: 'gemini-3.5-flash-lite',
    apiKey: 'AQ.testmockkey',
    extractIntent: async () => {
      throw new Error('Gemini upstream network timeout');
    }
  };
  factoryDualFails.fallbackProviders = [
    new OpenAIProvider({
      name: 'groq',
      apiKey: testGroqKey,
      extractIntent: async () => {
        const err = new Error('Groq rate limit exceeded (429 Too Many Requests)');
        err.code = 'QUOTA_OR_RATE_LIMIT';
        throw err;
      }
    }),
    new OpenAIProvider({
      name: 'openrouter',
      apiKey: testOpenRouterKey,
      fetchFn: createMockFetch('openrouter', 'openrouter/free')
    })
  ];

  const openrouterResult = await factoryDualFails.extractIntent({ text: 'Check booking status for token T-1001' });
  record(
    'OpenRouter is attempted and succeeds when both Gemini and Groq fail',
    openrouterResult.provider_used === 'openrouter'
  );
  record(
    'Fallback history records both gemini and groq failures',
    Array.isArray(openrouterResult.fallback_history) &&
    openrouterResult.fallback_history.includes('gemini') &&
    openrouterResult.fallback_history.includes('groq')
  );

  // -------------------------------------------------------------
  // Test Group 6: Gemini + Groq + OpenRouter Fail -> Offline Rules
  // -------------------------------------------------------------
  console.log('\n--- 6. All LLMs Fail -> Guaranteed Offline Rules Fallback ---');

  const factoryAllFail = new ProviderFactory();
  factoryAllFail.primaryProvider = {
    name: 'gemini',
    model: 'gemini-3.5-flash-lite',
    apiKey: 'AQ.testmockkey',
    extractIntent: async () => { throw new Error('Gemini service unavailable (503)'); }
  };
  factoryAllFail.fallbackProviders = [
    new OpenAIProvider({
      name: 'groq',
      apiKey: testGroqKey,
      extractIntent: async () => { throw new Error('Groq server error (500)'); }
    }),
    new OpenAIProvider({
      name: 'openrouter',
      apiKey: testOpenRouterKey,
      extractIntent: async () => { throw new Error('OpenRouter provider unavailable (503)'); }
    })
  ];

  const offlineResult = await factoryAllFail.extractIntent({
    text: 'நெல் 50 மூட்டை பதிவு செய்ய வேண்டும்'
  });

  record(
    'Deterministic offline rule provider is used when all external LLMs fail',
    offlineResult.provider_used === 'fallback_rules'
  );
  record(
    'Offline rules correctly extracts Tamil crop and booking intent',
    offlineResult.intent === 'BOOK_SLOT' &&
    Boolean(offlineResult.entities?.crop?.includes('Paddy') || offlineResult.crop?.includes('Paddy'))
  );
  record(
    'Fallback history records all failed providers (gemini, groq, openrouter)',
    Array.isArray(offlineResult.fallback_history) &&
    offlineResult.fallback_history.includes('gemini') &&
    offlineResult.fallback_history.includes('groq') &&
    offlineResult.fallback_history.includes('openrouter')
  );

  // -------------------------------------------------------------
  // Test Group 7: Graceful Skipping of Missing Keys
  // -------------------------------------------------------------
  console.log('\n--- 7. Graceful Skipping on Missing API Keys ---');

  // Case A: Missing Groq key skips directly to OpenRouter
  const factorySkipGroq = new ProviderFactory();
  factorySkipGroq.primaryProvider = {
    name: 'gemini',
    model: 'gemini-3.5-flash-lite',
    apiKey: 'AQ.testmockkey',
    extractIntent: async () => { throw new Error('Gemini quota limit'); }
  };
  factorySkipGroq.fallbackProviders = [
    new OpenAIProvider({
      name: 'groq',
      apiKey: '' // Missing Groq key
    }),
    new OpenAIProvider({
      name: 'openrouter',
      apiKey: testOpenRouterKey,
      fetchFn: createMockFetch('openrouter', 'openrouter/free')
    })
  ];

  const skipGroqResult = await factorySkipGroq.extractIntent({ text: 'Book appointment tomorrow' });
  record(
    'Missing Groq key is gracefully skipped without crashing and OpenRouter resolves query',
    skipGroqResult.provider_used === 'openrouter'
  );

  // Case B: Missing OpenRouter key skips directly to Offline Rules
  const factorySkipOpenRouter = new ProviderFactory();
  factorySkipOpenRouter.primaryProvider = {
    name: 'gemini',
    apiKey: 'AQ.testmockkey',
    extractIntent: async () => { throw new Error('Gemini quota limit'); }
  };
  factorySkipOpenRouter.fallbackProviders = [
    new OpenAIProvider({
      name: 'groq',
      apiKey: testGroqKey,
      extractIntent: async () => { throw new Error('Groq 500'); }
    }),
    new OpenAIProvider({
      name: 'openrouter',
      apiKey: '' // Missing OpenRouter key
    })
  ];

  const skipOpenRouterResult = await factorySkipOpenRouter.extractIntent({ text: 'I want to book paddy' });
  record(
    'Missing OpenRouter key is gracefully skipped without crashing and Offline Rules resolves query',
    skipOpenRouterResult.provider_used === 'fallback_rules'
  );

  // Case C: Missing ALL external keys falls back directly to Offline Rules
  const factoryAllKeysMissing = new ProviderFactory();
  factoryAllKeysMissing.primaryProvider = {
    name: 'gemini',
    apiKey: '' // Missing Gemini key
  };
  factoryAllKeysMissing.fallbackProviders = [
    new OpenAIProvider({ name: 'groq', apiKey: '' }),
    new OpenAIProvider({ name: 'openrouter', apiKey: '' })
  ];

  const allMissingResult = await factoryAllKeysMissing.extractIntent({ text: 'Vanakkam' });
  record(
    'When all external keys are missing, system falls back safely to Offline Rules without 500 error',
    allMissingResult.provider_used === 'fallback_rules' && allMissingResult.intent === 'GREETING'
  );

  // -------------------------------------------------------------
  // Test Group 8: Security & API Key Redaction
  // -------------------------------------------------------------
  console.log('\n--- 8. Security: Key Redaction & Privacy ---');

  const healthJson = JSON.stringify(healthReport);
  record(
    'Health check output does not expose any raw API key string',
    !healthJson.includes('AIza') &&
    !healthJson.includes('gsk_') &&
    !healthJson.includes('sk-or-v1-') &&
    !healthJson.includes('sk-proj')
  );

  // Test sanitizer against all key formats
  const sensitiveError = new Error(
    'Failed with Groq gsk_1234567890abcdef1234567890abcdef and OpenRouter sk-or-v1-1234567890abcdef1234567890 and OpenAI sk-proj-1234567890abcdef1234567890'
  );
  const factorySanitizeTest = new ProviderFactory();
  factorySanitizeTest.primaryProvider = {
    name: 'gemini',
    apiKey: 'AQ.key',
    extractIntent: async () => { throw sensitiveError; }
  };
  factorySanitizeTest.fallbackProviders = [];
  factorySanitizeTest.enableOfflineFallback = false;

  let sanitizedErrorMsg = '';
  try {
    await factorySanitizeTest.extractIntent({ text: 'test' });
  } catch (err) {
    sanitizedErrorMsg = JSON.stringify(err.details || err.message);
  }

  record(
    'Sanitizer redacts Groq keys (gsk_...) in error details and logs',
    !sanitizedErrorMsg.includes('gsk_1234567890abcdef1234567890abcdef') &&
    sanitizedErrorMsg.includes('[REDACTED_API_KEY]')
  );
  record(
    'Sanitizer redacts OpenRouter keys (sk-or-v1-...) in error details and logs',
    !sanitizedErrorMsg.includes('sk-or-v1-1234567890abcdef1234567890')
  );

  // -------------------------------------------------------------
  // Test Group 9: Normalized Response Schema Compatibility
  // -------------------------------------------------------------
  console.log('\n--- 9. Normalized Output Schema Compatibility ---');

  record(
    'Response contains standardized intent field',
    typeof groqResult.intent === 'string' && groqResult.intent.length > 0
  );
  record(
    'Response contains standardized entities object',
    typeof groqResult.entities === 'object' && groqResult.entities !== null
  );
  record(
    'Response contains standardized assistant_reply string',
    typeof groqResult.assistant_reply === 'string' && groqResult.assistant_reply.length > 0
  );
  record(
    'Response contains standardized suggested_actions array',
    Array.isArray(groqResult.suggested_actions)
  );
  record(
    'Response contains numeric confidence score',
    typeof groqResult.confidence === 'number'
  );

  console.log('\n================================================================');
  console.log(`TOTAL MULTI-PROVIDER TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runMultiProviderFallbackTests().catch(err => {
  console.error('\n❌ Unhandled test error in multi-provider suite:', err);
  process.exit(1);
});
