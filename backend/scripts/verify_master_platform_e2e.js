const { Pool } = require('pg');
const { generateToken } = require('../auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue'
});

const API_BASE = 'http://localhost:4000/api';

async function apiGet(url, headers = {}) {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function apiPost(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('====================================================');
  console.log('  KISAN QUEUE / UZHAVARSETHU MASTER E2E TEST SUITE  ');
  console.log('====================================================\n');

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition, testName, details = '') {
    totalCount++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      if (details) console.log(`       -> ${details}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      if (details) console.error(`       -> ${details}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: AUTHORITATIVE LOCALITY & DISTRICT VALIDATION
    // -------------------------------------------------------------
    console.log('\n--- 1. Authoritative Locality & District Isolation ---');
    
    // Fetch valid localities for Thanjavur
    const locRes = await apiGet(`${API_BASE}/localities?district=Thanjavur`);
    assert(
      locRes.data && locRes.data.localities && locRes.data.localities.length > 0,
      'Localities lookup for Thanjavur returns authoritative records',
      `Found ${locRes.data?.localities?.length} localities`
    );

    const validLocality = locRes.data.localities[0];

    // Validate valid combination
    const valRes = await apiGet(`${API_BASE}/localities/validate?locality_id=${validLocality.locality_id}&district=Thanjavur`);
    assert(
      valRes.data.valid === true,
      'Valid locality belongs to Thanjavur',
      `Locality: ${validLocality.locality_name} (${validLocality.locality_id})`
    );

    // Cross-district validation: Send Thanjavur locality with Ariyalur district
    const crossValRes = await apiGet(`${API_BASE}/localities/validate?locality_id=${validLocality.locality_id}&district=Ariyalur`);
    assert(
      crossValRes.data.valid === false,
      'Cross-district locality mismatch correctly rejected',
      `Result: valid=${crossValRes.data.valid}, message=${crossValRes.data.message || crossValRes.data.error}`
    );

    // -------------------------------------------------------------
    // TEST 2: IVR HARD REGISTRATION GATE
    // -------------------------------------------------------------
    console.log('\n--- 2. Telephony / IVR Hard Registration Gate ---');

    // Test unregistered caller
    const unregRes = await apiPost(`${API_BASE}/ivr/incoming`, {
      From: '+919999999999',
      CallSid: 'TEST_UNREG_CALL_001'
    });
    assert(
      unregRes.data.action === 'REJECT_UNREGISTERED' && unregRes.data.response?.end_call === true,
      'Unregistered caller is blocked with clear instructions and hung up',
      `Prompt: "${unregRes.data.response?.text_prompt?.slice(0, 60)}..."`
    );

    // Find an existing registered farmer in DB with valid phone
    const farmerRes = await pool.query('SELECT farmer_id, name, phone, district FROM farmers WHERE phone IS NOT NULL AND length(phone) >= 10 LIMIT 1');
    const registeredFarmer = farmerRes.rows[0];

    // Test registered caller
    const regRes = await apiPost(`${API_BASE}/ivr/incoming`, {
      From: registeredFarmer.phone,
      CallSid: 'TEST_REG_CALL_002'
    });
    assert(
      regRes.data.action === 'SHOW_TASK_MENU' && regRes.data.farmer_id === registeredFarmer.farmer_id,
      'Registered caller is recognized and served with personalized 1-press menu',
      `Farmer: ${registeredFarmer.name} (${registeredFarmer.farmer_id}), District: ${registeredFarmer.district}`
    );

    // -------------------------------------------------------------
    // TEST 3: AI DATA GATEWAY TENANT & ROLE ISOLATION
    // -------------------------------------------------------------
    console.log('\n--- 3. AI Data Gateway Scoped Access & Zero AI SQL ---');
    const { AIDataGateway } = require('../services/ai/aiDataGateway');
    const gateway = new AIDataGateway({ pool });

    // Test DO access within assigned district
    const doThanjavur = await gateway.execute({
      user: { role: 'DISTRICT_OFFICER', district: 'Thanjavur' },
      functionName: 'getDistrictOverview',
      params: { district: 'Thanjavur' }
    });
    const totalCentres = parseInt(doThanjavur?.centres?.total_centres || 0, 10);
    assert(
      doThanjavur && totalCentres > 0,
      'District Officer can query overview within assigned district',
      `Centres: ${totalCentres}, District: ${doThanjavur.district}`
    );

    // Test DO cross-district access violation
    let crossDistrictBlocked = false;
    try {
      await gateway.execute({
        user: { role: 'DISTRICT_OFFICER', district: 'Thanjavur' },
        functionName: 'getDistrictOverview',
        params: { district: 'Ariyalur' } // assigned to Thanjavur, trying to read Ariyalur
      });
    } catch (err) {
      crossDistrictBlocked = err.message.includes('RBAC Violation') || err.message.includes('cannot access');
    }
    assert(
      crossDistrictBlocked,
      'District Officer blocked from querying data outside assigned district',
      'Tenant isolation strictly enforced'
    );

    // Test Farmer querying own status
    const farmerStatus = await gateway.execute({
      user: { role: 'FARMER', farmerId: registeredFarmer.farmer_id },
      functionName: 'getFarmerBookingStatus',
      params: { farmer_id: registeredFarmer.farmer_id }
    });
    assert(
      farmerStatus && farmerStatus.farmer_id === registeredFarmer.farmer_id,
      'Farmer can query own booking status via AI Data Gateway',
      `Farmer: ${farmerStatus.farmer_id}`
    );

    // Test Farmer attempting to query another farmer's status
    let farmerHijackBlocked = false;
    try {
      await gateway.execute({
        user: { role: 'FARMER', farmerId: registeredFarmer.farmer_id },
        functionName: 'getFarmerBookingStatus',
        params: { farmer_id: 'OTHER_FARMER_123' }
      });
    } catch (err) {
      farmerHijackBlocked = err.message.includes('RBAC Violation') || err.message.includes('cannot access');
    }
    assert(
      farmerHijackBlocked,
      'Farmer blocked from querying another farmer\'s data',
      'Farmer boundary strictly enforced'
    );

    // -------------------------------------------------------------
    // TEST 4: CONVERSATIONAL AI EARLY OUT-OF-SCOPE REFUSAL
    // -------------------------------------------------------------
    console.log('\n--- 4. Conversational AI Out-of-Scope Intent Guard ---');
    const farmerToken = generateToken({
      userId: registeredFarmer.farmer_id,
      farmerId: registeredFarmer.farmer_id,
      role: 'FARMER',
      district: registeredFarmer.district
    });

    const outOfScopeRes = await apiPost(
      `${API_BASE}/voice-agent/understand`,
      { text: 'Who won the cricket match yesterday and what is the weather in Delhi?' },
      { Authorization: `Bearer ${farmerToken}` }
    );
    assert(
      outOfScopeRes.data.intent === 'OUT_OF_SCOPE' && outOfScopeRes.data.assistant_reply.includes('Kisan Queue'),
      'AI immediately refuses general knowledge questions without querying DB',
      `Reply: "${outOfScopeRes.data.assistant_reply}"`
    );

    // -------------------------------------------------------------
    // TEST 5: INTELLIGENT BOOKING ENGINE DETERMINISTIC PREVIEW
    // -------------------------------------------------------------
    console.log('\n--- 5. Deterministic Multicriteria Allocation Engine ---');
    const previewRes = await apiPost(`${API_BASE}/booking-requests/optimize-preview`, {
      district: 'Thanjavur',
      locality_id: validLocality.locality_id,
      crop: 'Paddy (Common)',
      quantity_quintals: 15,
      preferred_date: '2026-09-20'
    });
    const allocScore = previewRes.data.allocation?.total_score || previewRes.data.allocation?.score;
    assert(
      previewRes.data.success === true && previewRes.data.allocation != null && allocScore != null,
      'Allocation engine successfully evaluates and ranks DPCs',
      `Selected Centre: "${previewRes.data.allocation?.centre_name}", Score: ${allocScore}/100, Distance: ${previewRes.data.allocation?.distance_km} km`
    );

    // -------------------------------------------------------------
    // TEST 6: CONCURRENCY & ZERO OVERBOOKING UNDER COMPETING LOAD
    // -------------------------------------------------------------
    console.log('\n--- 6. High Concurrency Slot Hold & Zero Overbooking ---');
    
    // Create a special test slot with capacity = 1
    const testCentreRes = await pool.query("SELECT centre_id FROM centres WHERE district = 'Thanjavur' AND operational_status NOT IN ('Closed', 'Retired') LIMIT 1");
    const testCentreId = testCentreRes.rows[0].centre_id;
    const testDate = '2026-12-31';
    const testSlotId = 'TEST_SLOT_RACE_001';

    // Remove existing test slots for this date to be completely clean
    await pool.query('DELETE FROM slots WHERE slot_id = $1 OR (centre_id = $2 AND date = $3)', [testSlotId, testCentreId, testDate]);

    // Insert 1 test slot with max_farmers = 1 and booked_count = 0, held_count = 0
    await pool.query(
      `INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count)
       VALUES ($1, $2, $3, '09:00', '10:00', 1, 0, 0)`,
      [testSlotId, testCentreId, testDate]
    );

    // Create 2 distinct registered dummy farmers
    await pool.query(
      `INSERT INTO farmers (farmer_id, name, phone, district)
       VALUES ('TEST_RACE_F1', 'Racer One', '9000000001', 'Thanjavur'),
              ('TEST_RACE_F2', 'Racer Two', '9000000002', 'Thanjavur')
       ON CONFLICT (farmer_id) DO UPDATE SET district = 'Thanjavur'`
    );

    // Clean any prior bookings for these test farmers
    await pool.query("DELETE FROM bookings WHERE farmer_id IN ('TEST_RACE_F1', 'TEST_RACE_F2')");
    await pool.query("DELETE FROM booking_requests WHERE farmer_id IN ('TEST_RACE_F1', 'TEST_RACE_F2')");

    const { BookingRequestService } = require('../services/booking/bookingRequestService');
    const bookingReqService = new BookingRequestService({ pool });

    // Launch both requests simultaneously to create a true race condition
    const [res1, res2] = await Promise.all([
      bookingReqService.processBookingRequest({
        farmer_id: 'TEST_RACE_F1',
        district: 'Thanjavur',
        locality_id: validLocality.locality_id,
        crop: 'Paddy (Common)',
        quantity_quintals: 10,
        preferred_date: testDate,
        source: 'WEB'
      }),
      bookingReqService.processBookingRequest({
        farmer_id: 'TEST_RACE_F2',
        district: 'Thanjavur',
        locality_id: validLocality.locality_id,
        crop: 'Paddy (Common)',
        quantity_quintals: 10,
        preferred_date: testDate,
        source: 'WEB'
      })
    ]);

    // Inspect slot row in DB
    const finalSlot = await pool.query('SELECT booked_count, held_count, max_farmers FROM slots WHERE slot_id = $1', [testSlotId]);
    const booked = finalSlot.rows[0].booked_count;

    assert(
      booked <= 1,
      'Slot booked_count does not exceed max_farmers (ZERO OVERBOOKING)',
      `Slot Capacity: 1, Final Booked Count: ${booked}`
    );

    if (!res1.success && !res2.success) {
      console.log('DEBUG RES1:', JSON.stringify(res1));
      console.log('DEBUG RES2:', JSON.stringify(res2));
    }

    assert(
      (res1.success === true || res2.success === true),
      'Concurrent booking engine safely allocated without data corruption',
      `Request 1 success: ${res1.success} (Booking #${res1.booking_id || 'none'}), Request 2 success: ${res2.success} (Booking #${res2.booking_id || 'none'})`
    );

    // Clean up test data
    await pool.query("DELETE FROM bookings WHERE farmer_id IN ('TEST_RACE_F1', 'TEST_RACE_F2')");
    await pool.query("DELETE FROM booking_requests WHERE farmer_id IN ('TEST_RACE_F1', 'TEST_RACE_F2')");
    await pool.query('DELETE FROM slots WHERE slot_id = $1', [testSlotId]);
    await pool.query("DELETE FROM farmers WHERE farmer_id IN ('TEST_RACE_F1', 'TEST_RACE_F2')");

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`  E2E TEST RESULTS: ${passedCount} / ${totalCount} PASSED`);
    console.log('====================================================\n');

    process.exit(passedCount === totalCount ? 0 : 1);
  } catch (error) {
    console.error('Fatal test error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
