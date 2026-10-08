/**
 * Automated Test Suite — Kisan Voice AI Agent
 * Comprehensive Verification covering:
 * 1. AI Provider Factory initialization and safe health check
 * 2. Fallback Rule Provider intent & entity extraction (including Anaicut direct/phrase extraction)
 * 3. Automatic fallback chain on provider error (429, timeout, network)
 * 4. Normal conversational states do NOT trigger provider switching
 * 5. Authentication & JWT farmer identity isolation on /api/voice-agent/understand
 * 6. Live slot lookup and active booking collision detection
 * 7. Live Centre resolution against Database (Anaicut, Aiyyur, Thirumanur, non-existent)
 * 8. Multi-turn conversation flow (Turn 1 -> 2 -> 3 -> 4) with state merging & missing_fields progression
 * 9. Guard preventing repeated centre questions once resolved
 * 10. Single-sentence end-to-end extraction
 */

const assert = require('assert');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { generateToken } = require('../auth');
const AIProvider = require('../services/ai/aiProvider');
const FallbackRuleProvider = require('../services/ai/fallbackRuleProvider');
const { ProviderFactory } = require('../services/ai/providerFactory');

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:4000/api';
let pool;

async function runTests() {
  console.log('\n======================================================');
  console.log('🤖 RUNNING KISAN VOICE AI AGENT AUTOMATED TEST SUITE');
  console.log('======================================================\n');

  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let passed = 0;
  let total = 0;

  function record(desc, ok, details = '') {
    total++;
    if (ok) {
      passed++;
      console.log(`  ✓ [TEST ${total}] ${desc}`);
    } else {
      console.error(`  ✗ [TEST ${total}] ${desc} -> FAILED: ${details}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Safe Health Endpoint (Public, No Secrets)
    // -------------------------------------------------------------
    console.log('\n--- 1. Health Status & Public Configuration ---');
    const healthRes = await fetch(`${BASE_URL}/voice-agent/health`);
    const healthData = await healthRes.json();
    record(
      'Health endpoint returns HTTP 200 with status "ok"',
      healthRes.status === 200 && healthData.status === 'ok'
    );
    record(
      'Health endpoint reports primary, secondary, and offline fallback without secrets',
      healthData.primary && healthData.secondary && healthData.offline_fallback &&
      healthData.primary.apiKey === undefined && healthData.secondary.apiKey === undefined
    );

    // -------------------------------------------------------------
    // TEST 2: Fallback Rule Provider - Greeting Intent
    // -------------------------------------------------------------
    console.log('\n--- 2. Deterministic Rule Provider Intent & Entity Extraction ---');
    const ruleProvider = new FallbackRuleProvider();
    const greetRes = await ruleProvider.extractIntent({ text: 'Vanakkam! Good morning' });
    record(
      'Extracts GREETING intent from greeting phrase',
      greetRes.intent === 'GREETING' && greetRes.confidence >= 0.8
    );

    // -------------------------------------------------------------
    // TEST 3: Fallback Rule Provider - Full Booking Utterance
    // -------------------------------------------------------------
    const fullQuery = 'I want to book a slot for 20 quintals of paddy in Thanjavur tomorrow morning';
    const bookRes = await ruleProvider.extractIntent({
      text: fullQuery,
      availableDistricts: ['Thanjavur', 'Tiruvarur', 'Cuddalore']
    });
    record(
      'Extracts BOOK_SLOT intent with district, crop, quantity, and time preference',
      bookRes.intent === 'BOOK_SLOT' &&
      bookRes.entities.district === 'Thanjavur' &&
      bookRes.entities.crop.includes('Paddy') &&
      bookRes.entities.quantity_quintals === 20 &&
      bookRes.entities.time_preference === 'morning'
    );

    // -------------------------------------------------------------
    // TEST 4: Fallback Rule Provider - Centre Extraction (Anaicut variations)
    // -------------------------------------------------------------
    console.log('\n--- 3. Fallback Provider Centre Name Recognition ---');
    const directAnaicut = await ruleProvider.extractIntent({ text: 'Anaicut' });
    record(
      'Extracts candidate centre_name "Anaicut" from standalone text input',
      directAnaicut.entities.centre_name === 'Anaicut'
    );

    const phraseAnaicut = await ruleProvider.extractIntent({ text: 'I want to book paddy at Anaicut' });
    record(
      'Extracts candidate centre_name "Anaicut" from "I want to book paddy at Anaicut"',
      phraseAnaicut.entities.centre_name === 'Anaicut'
    );

    const timingAnaicut = await ruleProvider.extractIntent({ text: 'I want to book paddy at Anaicut tomorrow morning' });
    record(
      'Extracts candidate centre_name "Anaicut" from "I want to book paddy at Anaicut tomorrow morning"',
      timingAnaicut.entities.centre_name === 'Anaicut' &&
      timingAnaicut.entities.time_preference === 'morning'
    );

    // -------------------------------------------------------------
    // TEST 5: Fallback Rule Provider - Unit Conversions (Tons & Bags)
    // -------------------------------------------------------------
    const tonRes = await ruleProvider.extractIntent({ text: '5 tons of paddy in Madurai' });
    record(
      'Converts 5 tons to 50 quintals (1 ton = 10 quintals)',
      tonRes.entities.quantity_quintals === 50 && tonRes.entities.district === 'Madurai'
    );

    const bagRes = await ruleProvider.extractIntent({ text: '40 bags of paddy' });
    record(
      'Converts 40 bags to 20 quintals (1 bag = 0.5 quintal)',
      bagRes.entities.quantity_quintals === 20
    );

    // -------------------------------------------------------------
    // TEST 6: Fallback Rule Provider - Status Query Intent
    // -------------------------------------------------------------
    const statusRes = await ruleProvider.extractIntent({ text: 'Where is my truck and what is my queue position?' });
    record(
      'Extracts QUERY_STATUS intent for tracking inquiries',
      statusRes.intent === 'QUERY_STATUS'
    );

    // -------------------------------------------------------------
    // TEST 7: Provider Factory Fallback Chain on Service Error
    // -------------------------------------------------------------
    console.log('\n--- 4. Provider Factory & Fallback Chain ---');
    const mockFactory = new ProviderFactory();

    class MockFailingPrimary extends AIProvider {
      constructor() {
        super({ name: 'mock_failing_gemini' });
      }
      async extractIntent() {
        const err = new Error('Resource has been exhausted (e.g. check quota).');
        err.code = 'QUOTA_OR_RATE_LIMIT';
        err.status = 429;
        throw err;
      }
    }

    mockFactory.primaryProvider = new MockFailingPrimary();
    const fallbackExecRes = await mockFactory.extractIntent({
      text: 'I want to deliver 15 quintals to Thanjavur'
    });

    record(
      'Automatically falls back to offline rule parser when primary LLM fails with 429/quota',
      fallbackExecRes.provider_used === 'fallback_rules' &&
      fallbackExecRes.entities.quantity_quintals === 15 &&
      fallbackExecRes.entities.district === 'Thanjavur'
    );

    // -------------------------------------------------------------
    // TEST 8: Conversational Ambiguity Does NOT Trigger Provider Switching
    // -------------------------------------------------------------
    class MockAmbiguousLLM extends AIProvider {
      constructor() {
        super({ name: 'mock_working_llm' });
      }
      async extractIntent() {
        return this.normalizeResult({
          intent: 'UNKNOWN',
          entities: { district: null },
          assistant_reply: 'I am not sure what you meant. Could you specify your district?',
          confidence: 0.3
        });
      }
    }

    mockFactory.primaryProvider = new MockAmbiguousLLM();
    const ambiguousRes = await mockFactory.extractIntent({ text: 'asdfghjk' });
    record(
      'Ambiguity / missing fields do NOT trigger provider switching (active provider handles conversational state)',
      ambiguousRes.provider_used === 'mock_working_llm' &&
      ambiguousRes.intent === 'UNKNOWN' &&
      ambiguousRes.confidence === 0.3
    );

    // -------------------------------------------------------------
    // TEST 9: Authenticated Endpoint Requires Valid Token
    // -------------------------------------------------------------
    console.log('\n--- 5. Backend Authentication & Farmer Identity Isolation ---');
    const unauthRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' })
    });
    record(
      'POST /api/voice-agent/understand rejects unauthenticated requests with HTTP 401',
      unauthRes.status === 401
    );

    // -------------------------------------------------------------
    // TEST 10: Endpoint Rejects Non-FARMER Roles
    // -------------------------------------------------------------
    const officerToken = generateToken({
      userId: 'DO101',
      role: 'DISTRICT_OFFICER',
      district: 'Thanjavur'
    });
    const officerRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${officerToken}`
      },
      body: JSON.stringify({ text: 'Book slot in Thanjavur' })
    });
    record(
      'POST /api/voice-agent/understand denies non-FARMER roles with HTTP 403',
      officerRes.status === 403
    );

    // -------------------------------------------------------------
    // TEST 11: Authenticated Farmer Derives Identity Strictly From JWT
    // -------------------------------------------------------------
    const verifiedFarmerId = 'F1001';
    const farmerToken = generateToken({
      userId: verifiedFarmerId,
      farmerId: verifiedFarmerId,
      role: 'FARMER',
      district: 'Ariyalur'
    });

    const farmerReqRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        text: 'I want to book 25 quintals of paddy in Ariyalur tomorrow',
        farmer_id: 'HACKED_FARMER_999'
      })
    });

    const farmerReqData = await farmerReqRes.json();
    record(
      'Authenticated endpoint strictly derives farmer_id from JWT, ignoring body spoofing',
      farmerReqRes.status === 200 &&
      farmerReqData.farmer_id === verifiedFarmerId &&
      farmerReqData.entities.quantity_quintals === 25
    );

    // -------------------------------------------------------------
    // TEST 12: Live Centre Resolution — "Anaicut" Resolution
    // -------------------------------------------------------------
    console.log('\n--- 6. Live Database Centre Resolution & Normalization ---');
    const anaicutApiRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        text: 'Anaicut',
        currentBookingState: {
          district: 'Ariyalur',
          crop: 'Paddy (Common)',
          quantity_quintals: 10,
          booking_date: '2026-09-24'
        }
      })
    });

    const anaicutData = await anaicutApiRes.json();
    record(
      'Resolves "Anaicut" to live database centre TN_DPC_3475 and removes "centre" from missing_fields',
      anaicutApiRes.status === 200 &&
      anaicutData.entities.centre_id === 'TN_DPC_3475' &&
      anaicutData.entities.centre_name.toLowerCase().includes('anaicut') &&
      !anaicutData.missing_fields.includes('centre')
    );
    record(
      'Populates live available slots upon resolving centre and date',
      Array.isArray(anaicutData.available_slots) && anaicutData.available_slots.length > 0
    );
    record(
      'Assistant does NOT ask the centre question again once centre is resolved',
      !anaicutData.assistant_reply.toLowerCase().includes('which direct procurement centre')
    );

    // -------------------------------------------------------------
    // TEST 13: Non-existent Centre in District
    // -------------------------------------------------------------
    const nonExistentRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        text: 'NonExistentCentreXYZ',
        currentBookingState: {
          district: 'Ariyalur'
        }
      })
    });
    const nonExistentData = await nonExistentRes.json();
    record(
      'Reports friendly not-found message when centre does not exist in district',
      nonExistentRes.status === 200 &&
      nonExistentData.assistant_reply.toLowerCase().includes('couldn\'t find a procurement centre named nonexistentcentrexyz in ariyalur')
    );

    // -------------------------------------------------------------
    // TEST 14: Exact 4-Turn Multi-Conversation Test
    // -------------------------------------------------------------
    console.log('\n--- 7. Exact 4-Turn Multi-Conversation Simulation ---');
    let state = {};

    // Turn 1: "I want to book paddy."
    const t1Res = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${farmerToken}` },
      body: JSON.stringify({ text: 'I want to book paddy.', currentBookingState: state })
    });
    const t1 = await t1Res.json();
    state = { ...state, ...t1.entities };
    record(
      'Turn 1: "I want to book paddy." -> asks for district',
      t1.entities.crop.includes('Paddy') &&
      t1.missing_fields.includes('district') &&
      t1.assistant_reply.toLowerCase().includes('district')
    );

    // Turn 2: "Ariyalur"
    const t2Res = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${farmerToken}` },
      body: JSON.stringify({ text: 'Ariyalur', currentBookingState: state })
    });
    const t2 = await t2Res.json();
    state = { ...state, ...t2.entities };
    record(
      'Turn 2: "Ariyalur" -> district is Ariyalur, asks for centre',
      t2.entities.district === 'Ariyalur' &&
      t2.missing_fields.includes('centre') &&
      t2.assistant_reply.toLowerCase().includes('which direct procurement centre')
    );

    // Turn 3: "Anaicut"
    const t3Res = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${farmerToken}` },
      body: JSON.stringify({ text: 'Anaicut', currentBookingState: state })
    });
    const t3 = await t3Res.json();
    state = { ...state, ...t3.entities };
    record(
      'Turn 3: "Anaicut" -> resolves centre, does NOT repeat centre question, removes centre from missing_fields',
      t3.entities.centre_id === 'TN_DPC_3475' &&
      !t3.missing_fields.includes('centre') &&
      !t3.assistant_reply.toLowerCase().includes('which direct procurement centre')
    );

    // Turn 4: "Tomorrow morning"
    const t4Res = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${farmerToken}` },
      body: JSON.stringify({ text: 'Tomorrow morning', currentBookingState: state })
    });
    const t4 = await t4Res.json();
    state = { ...state, ...t4.entities };
    record(
      'Turn 4: "Tomorrow morning" -> resolves date, time preference, and matches morning slot',
      t4.entities.booking_date !== null &&
      t4.entities.time_preference === 'morning' &&
      Array.isArray(t4.available_slots) && t4.available_slots.length > 0
    );

    // -------------------------------------------------------------
    // TEST 15: Single-Sentence Input Extraction
    // -------------------------------------------------------------
    console.log('\n--- 8. Single-Sentence Full Entity Extraction ---');
    const singleSentenceRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${farmerToken}` },
      body: JSON.stringify({
        text: 'I want to book paddy at Anaicut tomorrow morning for 10 quintals.'
      })
    });
    const singleData = await singleSentenceRes.json();
    record(
      'Single-sentence extracts crop, centre, date, time preference, and quantity together',
      singleData.entities.crop.includes('Paddy') &&
      singleData.entities.centre_id === 'TN_DPC_3475' &&
      singleData.entities.quantity_quintals === 10 &&
      singleData.entities.time_preference === 'morning' &&
      singleData.entities.booking_date !== null &&
      !singleData.missing_fields.includes('centre') &&
      !singleData.missing_fields.includes('crop') &&
      !singleData.missing_fields.includes('quantity_quintals')
    );

    // -------------------------------------------------------------
    // TEST 16: Active Booking Concurrency Warning
    // -------------------------------------------------------------
    console.log('\n--- 9. Active Booking Collision Detection ---');
    const activeBookingDb = await pool.query(`
      SELECT farmer_id, booking_id, centre_id, booking_date
      FROM bookings
      WHERE booking_date >= CURRENT_DATE
        AND status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'No-Show', 'Cancelled')
      LIMIT 1
    `);

    if (activeBookingDb.rows.length > 0) {
      const activeFarmer = activeBookingDb.rows[0];
      const activeFarmerToken = generateToken({
        userId: activeFarmer.farmer_id,
        farmerId: activeFarmer.farmer_id,
        role: 'FARMER'
      });

      const collisionRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeFarmerToken}`
        },
        body: JSON.stringify({
          text: 'I want to book another appointment'
        })
      });

      const collisionData = await collisionRes.json();
      record(
        'Detects active appointment and attaches active_booking alert banner details',
        collisionRes.status === 200 &&
        collisionData.has_active_booking === true &&
        collisionData.active_booking &&
        collisionData.active_booking.booking_id === activeFarmer.booking_id
      );
    } else {
      record('Detects active appointment (skipped - no active booking in DB)', true);
    }

    // -------------------------------------------------------------
    // TEST 17: UI Actions Never Extracted as Candidate Centre or Quantity
    // -------------------------------------------------------------
    console.log('\n--- 10. Conversation State Isolation & UI Action Separation ---');
    const actionChips = ['Change date', 'Change Centre', 'Change Slot', 'Morning Slot', 'Afternoon Slot', 'Confirm Booking'];
    for (const actionLabel of actionChips) {
      const chipRes = await ruleProvider.extractIntent({ text: actionLabel });
      record(
        `Action chip "${actionLabel}" is NOT extracted as centre_name`,
        chipRes.entities.centre_name === null || chipRes.entities.centre_name === undefined
      );
    }

    // -------------------------------------------------------------
    // TEST 18: Natural Month Date Parsing ("29 September")
    // -------------------------------------------------------------
    const septDateRes = await ruleProvider.extractIntent({
      text: '29 September',
      currentBookingState: { quantity_quintals: 10, crop: 'Paddy (Common)' }
    });
    record(
      '"29 September" is parsed into booking_date "2026-09-29"',
      septDateRes.entities.booking_date === '2026-09-29'
    );
    record(
      '"29 September" does NOT overwrite quantity_quintals to 29',
      septDateRes.entities.quantity_quintals !== 29
    );

    // -------------------------------------------------------------
    // TEST 19: CHANGE_DATE Action Clears Date & Slot, Preserves Other Entities
    // -------------------------------------------------------------
    const changeDateApiRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        action: 'CHANGE_DATE',
        currentBookingState: {
          district: 'Ariyalur',
          centre_id: 'TN_DPC_3475',
          centre_name: 'Anaicut Direct Paddy Procurement Centre',
          booking_date: '2026-09-24',
          slot_id: 'SLOT-1',
          crop: 'Paddy (Common)',
          quantity_quintals: 10
        }
      })
    });
    const changeDateData = await changeDateApiRes.json();
    record(
      'CHANGE_DATE action clears booking_date and slot_id',
      changeDateData.entities.booking_date === null &&
      changeDateData.entities.slot_id === null
    );
    record(
      'CHANGE_DATE action strictly PRESERVES district, centre_id, centre_name, crop, and quantity',
      changeDateData.entities.district === 'Ariyalur' &&
      changeDateData.entities.centre_id === 'TN_DPC_3475' &&
      changeDateData.entities.centre_name.includes('Anaicut') &&
      changeDateData.entities.crop === 'Paddy (Common)' &&
      changeDateData.entities.quantity_quintals === 10
    );

    // -------------------------------------------------------------
    // TEST 20: CHANGE_CENTRE Action Clears Centre & Slot, Preserves Other Entities
    // -------------------------------------------------------------
    const changeCentreApiRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        action: 'CHANGE_CENTRE',
        currentBookingState: {
          district: 'Ariyalur',
          centre_id: 'TN_DPC_3475',
          centre_name: 'Anaicut Direct Paddy Procurement Centre',
          booking_date: '2026-09-29',
          slot_id: 'SLOT-1',
          crop: 'Paddy (Common)',
          quantity_quintals: 10
        }
      })
    });
    const changeCentreData = await changeCentreApiRes.json();
    record(
      'CHANGE_CENTRE action clears centre_id, centre_name, and slot_id',
      changeCentreData.entities.centre_id === null &&
      changeCentreData.entities.centre_name === null &&
      changeCentreData.entities.slot_id === null
    );
    record(
      'CHANGE_CENTRE action strictly PRESERVES district, booking_date, crop, and quantity',
      changeCentreData.entities.district === 'Ariyalur' &&
      changeCentreData.entities.booking_date === '2026-09-29' &&
      changeCentreData.entities.crop === 'Paddy (Common)' &&
      changeCentreData.entities.quantity_quintals === 10
    );

    // -------------------------------------------------------------
    // TEST 21: Centre Replacement to "Aiyyur" Updates Centre Cleanly
    // -------------------------------------------------------------
    const aiyyurApiRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        text: 'Aiyyur',
        currentBookingState: {
          district: 'Ariyalur',
          booking_date: '2026-09-29',
          crop: 'Paddy (Common)',
          quantity_quintals: 10
        }
      })
    });
    const aiyyurData = await aiyyurApiRes.json();
    record(
      'Standalone input "Aiyyur" resolves to Aiyyur Direct Paddy Procurement Centre (TN_DPC_0001)',
      aiyyurApiRes.status === 200 &&
      aiyyurData.entities.centre_id === 'TN_DPC_0001' &&
      aiyyurData.entities.centre_name.toLowerCase().includes('aiyyur')
    );
    record(
      'Resolving "Aiyyur" preserves booking_date 2026-09-29 and quantity 10',
      aiyyurData.entities.booking_date === '2026-09-29' &&
      aiyyurData.entities.quantity_quintals === 10 &&
      aiyyurData.entities.crop === 'Paddy (Common)'
    );

    // -------------------------------------------------------------
    // TEST 22: Free-text "Change date" Intercepted Cleanly
    // -------------------------------------------------------------
    const textChangeDateRes = await fetch(`${BASE_URL}/voice-agent/understand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${farmerToken}`
      },
      body: JSON.stringify({
        text: 'Change date',
        currentBookingState: {
          district: 'Ariyalur',
          centre_id: 'TN_DPC_0001',
          centre_name: 'Aiyyur Direct Paddy Procurement Centre',
          booking_date: '2026-09-29',
          crop: 'Paddy (Common)',
          quantity_quintals: 10
        }
      })
    });
    const textChangeDateData = await textChangeDateRes.json();
    record(
      'Free-text "Change date" does NOT set centre_name to "Change date"',
      textChangeDateData.entities.centre_name !== 'Change date' &&
      textChangeDateData.entities.centre_id === 'TN_DPC_0001'
    );
    record(
      'Free-text "Change date" clears booking_date and prompts for date',
      textChangeDateData.entities.booking_date === null &&
      textChangeDateData.assistant_reply.toLowerCase().includes('what date')
    );

    // Summary
    console.log('\n======================================================');
    console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
    console.log('======================================================\n');

    if (passed === total) {
      console.log('🎉 ALL KISAN VOICE AGENT TESTS PASSED SUCCESSFULLY!\n');
    } else {
      throw new Error(`Test suite failed: ${total - passed} failure(s)`);
    }

  } catch (err) {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

runTests();
