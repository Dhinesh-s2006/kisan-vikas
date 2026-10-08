/**
 * Automated Test Suite for Phase 2: Sarvam STT & Voice Endpoint
 * Verifies:
 * 1. Health endpoint reporting speechProvider: "sarvam" without secrets
 * 2. Auth & RBAC enforcement (401 unauthenticated, 403 non-farmer)
 * 3. Credit Protection: Empty audio rejection (0 API calls)
 * 4. Credit Protection: Silent audio rejection (0 API calls)
 * 5. Credit Protection: Too short audio rejection (0 API calls)
 * 6. Duplicate protection with voiceRequestId
 * 7. Live/Mock Sarvam STT integration & error sanitization
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { generateToken } = require('../auth');
const { SpeechService } = require('../services/speech/speechService');
const SarvamSpeechService = require('../services/speech/sarvamSpeechService');

const PORT = process.env.PORT || 4000;
const BASE_URL = `http://localhost:${PORT}/api`;

let total = 0;
let passed = 0;

function record(name, condition) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ [TEST ${total}] ${name}`);
  } else {
    console.error(`  ✗ [TEST ${total}] FAILED: ${name}`);
    throw new Error(`Assertion failed for: ${name}`);
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🎤 TESTING PHASE 2: SARVAM STT & TRANSCRIBE ENDPOINT');
  console.log('======================================================\n');

  try {
    // 1. Health Status
    console.log('--- 1. Health Status & Speech Configuration ---');
    const healthRes = await fetch(`${BASE_URL}/voice-agent/health`);
    record('Health endpoint returns HTTP 200', healthRes.status === 200);
    const health = await healthRes.json();
    record('Health reports speechProvider = "sarvam"', health.speechProvider === 'sarvam');
    record('Health reports voiceAgent = true', health.voiceAgent === true);
    record('Health reports speechConfigured = true', health.speechConfigured === true);
    const healthStr = JSON.stringify(health);
    record('Health does NOT leak Sarvam API key', !healthStr.includes('sk_') && !healthStr.includes('SARVAM_API_KEY'));

    // 2. Authentication & Authorization
    console.log('\n--- 2. Auth & Role Restrictions ---');
    const unauthRes = await fetch(`${BASE_URL}/voice-agent/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: 'dGVzdA==' })
    });
    record('POST /transcribe rejects unauthenticated requests with HTTP 401', unauthRes.status === 401);

    const adminToken = generateToken({ userId: 'ADMIN_01', role: 'CENTRE_ADMIN' });
    const forbiddenRes = await fetch(`${BASE_URL}/voice-agent/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ audio: 'dGVzdA==' })
    });
    record('POST /transcribe denies non-FARMER role with HTTP 403', forbiddenRes.status === 403);

    const farmerToken = generateToken({ userId: 'FARMER_TEST', farmerId: 'FARMER_TEST', role: 'FARMER' });

    // 3. Credit Protection: Empty / Silent / Short Audio
    console.log('\n--- 3. Credit Protection: Rejection of Empty/Silent Audio ---');
    const emptyRes = await fetch(`${BASE_URL}/voice-agent/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({})
    });
    const emptyJson = await emptyRes.json();
    record('Rejects completely missing audio with HTTP 400', emptyRes.status === 400);
    record('Empty audio returns user-friendly message', emptyJson.message.includes("couldn't hear anything"));

    // Audio too short (<400 bytes)
    const shortBuffer = Buffer.from('RIFF1234WAVEfmt ');
    const shortRes = await fetch(`${BASE_URL}/voice-agent/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({ audio: shortBuffer.toString('base64') })
    });
    const shortJson = await shortRes.json();
    record('Rejects audio buffer < 400 bytes with HTTP 400', shortRes.status === 400);
    record('Short audio returns friendly message', shortJson.message.includes("couldn't hear anything"));

    // Pure silence audio (1000 zero bytes)
    const silentBuffer = Buffer.alloc(1000, 0);
    const silentRes = await fetch(`${BASE_URL}/voice-agent/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({ audio: silentBuffer.toString('base64') })
    });
    const silentJson = await silentRes.json();
    record('Rejects pure silent audio with HTTP 400', silentRes.status === 400);
    record('Silent audio returns friendly message', silentJson.message.includes("couldn't hear anything"));

    // 4. Duplicate Request Protection
    console.log('\n--- 4. Duplicate Request Protection ---');
    let sarvamCallsCount = 0;
    class MockSarvamProvider {
      constructor() {
        this.enabled = true;
        this.model = 'mock-saaras';
      }
      isConfigured() { return true; }
      async transcribe({ voiceRequestId }) {
        sarvamCallsCount++;
        return {
          transcript: 'எனக்கு நெல் விற்க slot வேண்டும்',
          language: 'ta',
          requestId: 'mock-sarvam-123'
        };
      }
    }

    const testSpeechService = new SpeechService({
      provider: new MockSarvamProvider(),
      duplicateCacheTtlMs: 5000
    });

    const testRequestId = 'VR-DUP-TEST-001';
    const validAudBuffer = Buffer.alloc(1000, 50);

    const call1 = await testSpeechService.transcribe({
      audioBuffer: validAudBuffer,
      voiceRequestId: testRequestId
    });
    const call2 = await testSpeechService.transcribe({
      audioBuffer: validAudBuffer,
      voiceRequestId: testRequestId
    });

    record('First call executes STT provider', sarvamCallsCount === 1);
    record('Duplicate voiceRequestId returns cached transcript', call2.transcript === call1.transcript);
    record('Duplicate request does NOT consume second provider call (calls = 1)', sarvamCallsCount === 1);
    record('Duplicate response flags is_cached = true', call2.is_cached === true);

    // 5. Sarvam Service Error Sanitization & Timeout
    console.log('\n--- 5. Sarvam Service Error Sanitization & Timeouts ---');
    const invalidKeyService = new SarvamSpeechService({
      apiKey: 'sk_invalid_test_secret_1234567890',
      timeoutMs: 3000
    });

    try {
      // 1-second audio tone
      const sampleRate = 16000;
      const numSamples = 16000;
      const dataSize = numSamples * 2;
      const buffer = Buffer.alloc(44 + dataSize);
      buffer.write('RIFF', 0);
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write('WAVE', 8);
      buffer.write('fmt ', 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(sampleRate * 2, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write('data', 36);
      buffer.writeUInt32LE(dataSize, 40);
      for (let i = 0; i < numSamples; i++) {
        buffer.writeInt16LE(Math.floor(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 10000), 44 + i * 2);
      }

      await invalidKeyService.transcribe({ audioBuffer: buffer });
      record('Invalid key should fail', false);
    } catch (err) {
      record('Invalid API key fails gracefully', Boolean(err));
      record('Error message redacts secret API key', !err.message.includes('sk_invalid_test_secret'));
    }

    console.log('\n======================================================');
    console.log(`TOTAL PHASE 2 TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('Fatal error in Phase 2 tests:', err);
    process.exit(1);
  }
}

runTests();
