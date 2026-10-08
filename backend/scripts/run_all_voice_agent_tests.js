/**
 * Master Voice Agent Test Runner
 * Executes all test suites across Phases 3 through 9 sequentially:
 * - Phase 3: Microphone & Sarvam STT Health
 * - Phase 4: STT Transcript -> Gemini NLU & Safety
 * - Phase 5: Intent Spectrum & Multi-Turn State Retention
 * - Phase 6: Intent-to-API & Database Connections
 * - Phase 7: Backend Grounding & Browser TTS Contracts
 * - Phase 9: Fallback Resiliency, Deduplication & Tenant Isolation
 */

const { execSync } = require('child_process');
const path = require('path');

const suites = [
  { name: 'Phase 2.1: Bhashini ASR Primary & Sarvam Fallback STT', file: 'test_bhashini_stt.js' },
  { name: 'Phase 3: Frontend Voice Client & STT Service', file: 'test_phase3_voice_frontend.js' },
  { name: 'Phase 4: STT Transcript to Gemini NLU', file: 'test_phase4_transcript_to_nlu.js' },
  { name: 'Phase 5: Intent Handling & Conversation State', file: 'test_phase5_intents_state.js' },
  { name: 'Phase 6: Database & Backend API Connections', file: 'test_phase6_api_connections.js' },
  { name: 'Phase 7: Backend Grounding & Browser TTS', file: 'test_phase7_tts_grounding.js' },
  { name: 'Phase 9: Fallback, Deduplication & Isolation', file: 'test_phase9_fallback_dedup.js' },
  { name: 'Phase 9.1: Multi-Provider Fallback (Gemini -> Groq -> OpenRouter -> Offline Rules)', file: 'test_openai_fallback.js' }
];

console.log('================================================================');
console.log('🚀 EXECUTING KISAN VOICE AGENT FULL REGRESSION SUITE (PHASES 3-9)');
console.log('================================================================\n');

let allPassed = true;
const summary = [];

for (const suite of suites) {
  const filePath = path.resolve(__dirname, suite.file);
  console.log(`\n▶ Running ${suite.name} (${suite.file})...`);
  try {
    const output = execSync(`node "${filePath}"`, {
      encoding: 'utf-8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    console.log(output);

    // Extract total test count
    const match = output.match(/TOTAL.*?:\s*(\d+)\s*\|\s*PASSED:\s*(\d+)/i);
    if (match) {
      summary.push({ name: suite.name, total: parseInt(match[1]), passed: parseInt(match[2]), status: 'PASSED' });
    } else {
      summary.push({ name: suite.name, status: 'PASSED' });
    }
  } catch (err) {
    console.error(err.stdout || err.stderr || err.message);
    summary.push({ name: suite.name, status: 'FAILED' });
    allPassed = false;
    break;
  }
}

console.log('\n================================================================');
console.log('📊 REGRESSION SUITE SUMMARY REPORT');
console.log('================================================================');
let grandTotal = 0;
let grandPassed = 0;
for (const s of summary) {
  const countStr = s.total ? `(${s.passed}/${s.total} tests)` : '';
  console.log(`  ${s.status === 'PASSED' ? '✓' : '✗'} ${s.name}: ${s.status} ${countStr}`);
  if (s.total) grandTotal += s.total;
  if (s.passed) grandPassed += s.passed;
}
console.log('----------------------------------------------------------------');
console.log(`GRAND TOTAL: ${grandPassed} / ${grandTotal} TESTS PASSED`);
console.log('================================================================\n');

if (!allPassed) {
  process.exit(1);
}
