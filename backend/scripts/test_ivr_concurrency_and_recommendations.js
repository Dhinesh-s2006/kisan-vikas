/**
 * Comprehensive Concurrency, Idempotency, and Smart Recommendation Test Suite
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const API_BASE = 'http://localhost:4000/api';

async function runTests() {
  console.log('================================================================');
  console.log('KISAN VIKAS: CONCURRENCY, IDEMPOTENCY & RECOMMENDATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Database Invariant Constraint Check
    // -------------------------------------------------------------
    console.log('--- TEST 1: Database Invariant Constraint Check ---');
    const constraintRes = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conname = 'chk_slot_capacity' AND conrelid = 'slots'::regclass
    `);
    assert(constraintRes.rows.length === 1, 'Constraint chk_slot_capacity exists on slots table');
    assert(
      constraintRes.rows[0]?.pg_get_constraintdef?.includes('booked_count <= max_farmers'),
      'chk_slot_capacity enforces booked_count <= max_farmers'
    );

    // -------------------------------------------------------------
    // TEST 2: High Concurrency Slot Overbooking Protection
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: High Concurrency Slot Overbooking Protection ---');
    // Setup a dedicated test slot with max_farmers = 3
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const testDate = tomorrow.toISOString().slice(0, 10);
    const testSlotId = `CONCURRENCY_TEST_SLOT_${Date.now()}`;
    const testCentreId = 'TN_DPC_2283'; // Aalakkudi Chief (Thanjavur)

    await pool.query(`
      INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count)
      VALUES ($1, $2, $3, '10:00:00', '11:00:00', 3, 0, 0)
    `, [testSlotId, testCentreId, testDate]);

    // Create 10 temporary test farmers in Thanjavur
    const testFarmers = [];
    for (let i = 0; i < 10; i++) {
      const fId = `TEST_FARMER_CC_${Date.now()}_${i}`;
      await pool.query(`
        INSERT INTO farmers (farmer_id, name, district, village, phone, is_active)
        VALUES ($1, $2, 'Thanjavur', 'Aalakkudi Chief', $3, true)
      `, [fId, `Test Farmer ${i}`, `99990000${String(i).padStart(2, '0')}`]);
      testFarmers.push(fId);
    }

    console.log(`  Firing 10 simultaneous concurrent booking requests for a slot with capacity 3...`);
    const bookingPromises = testFarmers.map((fId, idx) => {
      return fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: fId,
          slot_id: testSlotId,
          centre_id: testCentreId,
          district: 'Thanjavur',
          booking_date: testDate,
          crop: 'Paddy (Common)',
          quantity_quintals: 25,
          idempotency_key: `IDEM_TEST_${fId}`
        })
      }).then(async res => ({ status: res.status, data: await res.json() }));
    });

    const results = await Promise.all(bookingPromises);
    const successCount = results.filter(r => r.status === 200).length;
    const conflictCount = results.filter(r => r.status === 409).length;

    console.log(`  Results: ${successCount} succeeded (HTTP 200), ${conflictCount} rejected with conflict (HTTP 409)`);
    assert(successCount === 3, `Exactly 3 bookings succeeded out of 10 concurrent requests (got ${successCount})`);
    assert(conflictCount === 7, `Remaining 7 requests were rejected with 409 slot_full (got ${conflictCount})`);

    // Verify slot table booked_count
    const slotCheck = await pool.query('SELECT booked_count, max_farmers FROM slots WHERE slot_id = $1', [testSlotId]);
    const finalBooked = slotCheck.rows[0].booked_count;
    assert(finalBooked === 3, `Slot booked_count is exactly 3 in database (got ${finalBooked})`);
    assert(finalBooked <= slotCheck.rows[0].max_farmers, `Slot booked_count (${finalBooked}) never exceeded max_farmers (${slotCheck.rows[0].max_farmers})`);

    // -------------------------------------------------------------
    // TEST 3: Booking Idempotency & Replay Protection
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Booking Idempotency & Replay Protection ---');
    const winningFarmer = testFarmers[0];
    const idemKey = `IDEM_TEST_${winningFarmer}`;

    // Send the exact same request again
    const replayRes = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmer_id: winningFarmer,
        slot_id: testSlotId,
        centre_id: testCentreId,
        district: 'Thanjavur',
        booking_date: testDate,
        crop: 'Paddy (Common)',
        quantity_quintals: 25,
        idempotency_key: idemKey
      })
    });

    assert(replayRes.status === 200, `Replayed request with same idempotency key returned HTTP 200 (got ${replayRes.status})`);
    const replayData = await replayRes.json();
    assert(replayData.idempotent_replay === true, 'Response indicates idempotent_replay: true');
    assert(replayData.success === true, 'Response indicates success: true');

    // Verify slot count did not increase
    const slotCheckAfterReplay = await pool.query('SELECT booked_count FROM slots WHERE slot_id = $1', [testSlotId]);
    assert(slotCheckAfterReplay.rows[0].booked_count === 3, `Slot count remains 3 after replayed request (got ${slotCheckAfterReplay.rows[0].booked_count})`);

    // -------------------------------------------------------------
    // TEST 4: Smart Procurement Centre Recommendation API
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Smart Procurement Centre Recommendation API ---');
    const recRes = await fetch(`${API_BASE}/centres/recommend?district=Thanjavur&farmer_id=DEMO_F_000052&date=${testDate}`);
    assert(recRes.status === 200, `Recommendation endpoint returned HTTP 200 (got ${recRes.status})`);

    const recData = await recRes.json();
    assert(recData.success === true, 'Recommendation returned success: true');
    assert(recData.recommended_centre != null, 'Returned recommended_centre object');
    assert(recData.recommended_centre.operational_status === 'Open', 'Recommended centre is operational (Open)');
    assert(recData.recommended_centre.has_available_slots === true, 'Recommended centre has available slots');
    assert(recData.recommended_centre.badge_label.includes('Recommended'), `Badge label is "${recData.recommended_centre.badge_label}"`);
    assert(recData.recommended_centre.distance_label != null, `Road distance label provided: "${recData.recommended_centre.distance_label}"`);
    assert(recData.recommended_centre.reason != null, `Clear explanation provided: "${recData.recommended_centre.reason}"`);

    // Cross-district rejection test
    const crossRes = await fetch(`${API_BASE}/centres/recommend?district=Salem&farmer_id=DEMO_F_000052&date=${testDate}`);
    assert(crossRes.status === 400, `Cross-district recommendation request properly rejected with HTTP 400 (got ${crossRes.status})`);

    // -------------------------------------------------------------
    // Cleanup Test Data
    // -------------------------------------------------------------
    console.log('\n--- Cleaning up temporary test records ---');
    await pool.query('DELETE FROM bookings WHERE slot_id = $1', [testSlotId]);
    await pool.query('DELETE FROM slots WHERE slot_id = $1', [testSlotId]);
    for (const fId of testFarmers) {
      await pool.query('DELETE FROM notifications WHERE farmer_id = $1', [fId]);
      await pool.query('DELETE FROM farmers WHERE farmer_id = $1', [fId]);
    }
    console.log('  Cleaned up temporary test slot, bookings, and farmers.');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
