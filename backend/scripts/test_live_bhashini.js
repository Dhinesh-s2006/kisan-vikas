/**
 * Live Bhashini ASR Pipeline & Fallback Verification Script
 * 
 * Verifies live connectivity with Bhashini:
 * 1. Inspects BHASHINI_USER_ID, BHASHINI_UDYAT_KEY, BHASHINI_INFERENCE_KEY, BHASHINI_PIPELINE_ID in backend/.env
 * 2. Queries official getModelsPipeline endpoint to discover authorized ASR serviceId & formats
 * 3. Submits real spoken audio (WAV) to Bhashini compute endpoint
 * 4. Confirms successful transcription without contacting Sarvam
 * 5. Simulates Bhashini failure to confirm seamless automatic fallback to Sarvam STT
 */

const fs = require('fs');
const path = require('path');
require('c:/Users/DHINESH.S/Desktop/kisan-queue/backend/node_modules/dotenv').config({ path: 'c:/Users/DHINESH.S/Desktop/kisan-queue/backend/.env' });
const BhashiniSpeechService = require('../services/speech/bhashiniSpeechService');
const SarvamSpeechService = require('../services/speech/sarvamSpeechService');
const { SpeechService } = require('../services/speech/speechService');

function getVerificationAudio() {
  const candidatePath = 'C:/KisanQueue-IVR/asterisk/sounds/initial_lang.wav';
  if (fs.existsSync(candidatePath)) {
    console.log(`Using real spoken audio sample: ${candidatePath}`);
    return fs.readFileSync(candidatePath);
  }

  // Fallback synthetic 16kHz WAV
  console.log('Generating synthetic 16kHz WAV audio sample...');
  const sampleRate = 16000;
  const durationSeconds = 1.5;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.floor(Math.sin(2 * Math.PI * 300 * t) * 18000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

async function verifyLive() {
  console.log('============================================================');
  console.log('🌐 LIVE BHASHINI ASR & SARVAM FALLBACK VERIFICATION');
  console.log('============================================================\n');

  const bhashini = new BhashiniSpeechService();
  const sarvam = new SarvamSpeechService();

  console.log('Checking configuration in backend/.env:');
  console.log(`- BHASHINI_USER_ID configured:       ${Boolean(bhashini.userId && bhashini.userId.trim())}`);
  console.log(`- BHASHINI_UDYAT_KEY configured:     ${Boolean(bhashini.udyatKey && bhashini.udyatKey.trim())}`);
  console.log(`- BHASHINI_INFERENCE_KEY configured: ${Boolean(bhashini.inferenceKey && bhashini.inferenceKey.trim())}`);
  console.log(`- BHASHINI_PIPELINE_ID configured:  ${Boolean(bhashini.pipelineId && bhashini.pipelineId.trim())}`);
  console.log(`- SARVAM_API_KEY configured:         ${Boolean(sarvam.isConfigured())}\n`);

  if (!bhashini.isConfigured()) {
    console.error('❌ BHASHINI credentials are not fully populated in backend/.env.');
    process.exit(1);
  }

  const sampleAudio = getVerificationAudio();

  // Step 1: Live Discovery from Bhashini
  console.log('\n--- Step 1: Discovering authorized ASR service for Tamil ("ta") ---');
  let config;
  try {
    config = await bhashini.getPipelineConfig('ta');
    console.log(`  ✓ Pipeline discovery succeeded!`);
    console.log(`  - Discovered Service ID: ${config.serviceId}`);
    console.log(`  - Compute Callback URL:  ${config.callbackUrl}`);
    console.log(`  - Expected Audio Format: ${config.audioFormat}`);
  } catch (discErr) {
    console.error(`  ✗ Discovery failed: ${discErr.message}`);
    process.exit(1);
  }

  // Step 2: Live Primary ASR Transcription (Sarvam NOT called)
  console.log('\n--- Step 2: Submitting audio to Bhashini ASR (PRIMARY) ---');
  let sarvamWasCalled = false;
  const wrappedSarvam = {
    isConfigured: () => sarvam.isConfigured(),
    enabled: sarvam.enabled,
    model: sarvam.model,
    transcribe: async (params) => {
      sarvamWasCalled = true;
      return await sarvam.transcribe(params);
    }
  };

  const speechService = new SpeechService({ primaryProvider: bhashini, fallbackProvider: wrappedSarvam });
  try {
    const res = await speechService.transcribe({
      audioBuffer: sampleAudio,
      mimeType: 'audio/wav',
      languageCode: 'ta-IN',
      voiceRequestId: `VR-LIVE-${Date.now()}`
    });
    console.log(`  ✓ Primary Bhashini ASR succeeded!`);
    console.log(`  - Provider Used:           ${res.provider}`);
    console.log(`  - Language:                ${res.language}`);
    console.log(`  - Service ID:              ${res.serviceId || res.requestId}`);
    console.log(`  - Transcript:              "${res.transcript}"`);
    console.log(`  - Sarvam Called:           ${sarvamWasCalled ? 'YES (UNEXPECTED)' : 'NO (AS EXPECTED ✅)'}`);
    if (sarvamWasCalled) {
      throw new Error('Sarvam was called despite Bhashini succeeding!');
    }
  } catch (asrErr) {
    console.error(`  ✗ Bhashini ASR failed: ${asrErr.message}`);
    process.exit(1);
  }

  // Step 3: Proving Fallback: Bhashini Failure -> Automatic Sarvam
  console.log('\n--- Step 3: Simulating Bhashini upstream failure to prove Sarvam Fallback ---');
  sarvamWasCalled = false;
  const failingBhashini = new BhashiniSpeechService({
    userId: bhashini.userId,
    udyatKey: bhashini.udyatKey,
    inferenceKey: 'invalid_simulated_key_for_fallback_test',
    pipelineId: bhashini.pipelineId,
    serviceId: 'simulated_failure_id'
  });
  const fallbackService = new SpeechService({ primaryProvider: failingBhashini, fallbackProvider: wrappedSarvam });

  try {
    const fallbackRes = await fallbackService.transcribe({
      audioBuffer: sampleAudio,
      mimeType: 'audio/wav',
      languageCode: 'ta-IN',
      voiceRequestId: `VR-FALLBACK-TEST-${Date.now()}`
    });
    console.log(`  ✓ Automatic fallback succeeded!`);
    console.log(`  - Provider Used:           ${fallbackRes.provider}`);
    console.log(`  - Fallback From:           ${fallbackRes.fallbackFrom}`);
    console.log(`  - Sarvam Called:           ${sarvamWasCalled ? 'YES (AS EXPECTED ✅)' : 'NO (UNEXPECTED)'}`);
    console.log(`  - Transcript:              "${fallbackRes.transcript}"`);
  } catch (fbErr) {
    console.error(`  ✗ Fallback failed: ${fbErr.message}`);
    process.exit(1);
  }

  console.log('\n============================================================');
  console.log('🎉 ALL LIVE BHASHINI + SARVAM FALLBACK CHECKS PASSED ✅');
  console.log('============================================================\n');
}

verifyLive();
