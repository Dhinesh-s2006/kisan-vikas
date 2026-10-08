/**
 * Phase 1 Booking Slot Expiration Test Suite
 * Tests 1 to 10 covering:
 * - Deterministic slot validation logic (Asia/Kolkata timezone)
 * - IntelligentBookingEngine optimization
 * - Backend POST /api/bookings transaction enforcement
 * - Unified BookingRequestService (Web & CSC)
 * - IVR One-Press Booking selection
 */

const { Pool } = require('pg');
const {
  isSlotExpired,
  isSlotBookable,
  getKolkataNow,
  normalizeDateStr
} = require('../services/booking/slotValidation');
const { IntelligentBookingEngine } = require('../services/booking/intelligentBookingEngine');
const { BookingRequestService } = require('../services/booking/bookingRequestService');

const pool = new Pool({ connectionString: 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue' });

async function runTestSuite() {
  console.log('============================================================');
  console.log('PHASE 1: EXPIRED SLOT BOOKING TEST SUITE (10 TESTS)');
  console.log('Timezone: Asia/Kolkata');
  const { todayStr, currentTimeStr } = getKolkataNow();
  console.log(`Current Kolkata Reference Time: ${todayStr} ${currentTimeStr}`);
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(testName, condition, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
      failed++;
    }
  }

  // Reference mock time for tests: 2026-10-02 17:00:00 (5:00 PM IST)
  // 11:30 UTC = 17:00 IST
  const mockNow = new Date('2026-10-02T11:30:00.000Z');

  // TEST 1: Today + expired slot -> reject
  const t1 = isSlotBookable({ date: '2026-10-02', end_time: '09:00:00', max_farmers: 10, booked_count: 0 }, mockNow);
  assert('TEST 1: Today + expired slot (08:00 - 09:00 at 17:00) -> reject', t1.bookable === false && t1.reason.includes('SLOT_EXPIRED'), JSON.stringify(t1));

  // TEST 2: Today + upcoming slot -> allow
  const t2 = isSlotBookable({ date: '2026-10-02', end_time: '19:00:00', max_farmers: 10, booked_count: 2 }, mockNow);
  assert('TEST 2: Today + upcoming slot (18:00 - 19:00 at 17:00) -> allow', t2.bookable === true && t2.reason === 'AVAILABLE', JSON.stringify(t2));

  // TEST 3: Tomorrow + available slot -> allow
  const t3 = isSlotBookable({ date: '2026-10-03', end_time: '09:00:00', max_farmers: 10, booked_count: 4 }, mockNow);
  assert('TEST 3: Tomorrow + available slot (08:00 - 09:00 on 2026-10-03) -> allow', t3.bookable === true && t3.reason === 'AVAILABLE', JSON.stringify(t3));

  // TEST 4: Yesterday + slot -> reject
  const t4 = isSlotBookable({ date: '2026-10-01', end_time: '18:00:00', max_farmers: 10, booked_count: 0 }, mockNow);
  assert('TEST 4: Yesterday + slot (2026-10-01) -> reject', t4.bookable === false && t4.reason.includes('PAST_DATE'), JSON.stringify(t4));

  // TEST 5: Future + full slot -> reject
  const t5 = isSlotBookable({ date: '2026-10-03', end_time: '10:00:00', max_farmers: 10, booked_count: 10 }, mockNow);
  assert('TEST 5: Future + full slot (max 10, booked 10) -> reject', t5.bookable === false && t5.reason === 'SLOT_FULL', JSON.stringify(t5));

  // TEST 6: Today + expired + capacity available -> reject
  const t6 = isSlotBookable({ date: '2026-10-02', end_time: '12:00:00', max_farmers: 20, booked_count: 0, held_count: 0 }, mockNow);
  assert('TEST 6: Today + expired + capacity available (12:00 end at 17:00, 20 free) -> reject', t6.bookable === false && t6.reason.includes('SLOT_EXPIRED'), JSON.stringify(t6));

  // TEST 7: Today + future + capacity available -> allow
  const t7 = isSlotBookable({ date: '2026-10-02', end_time: '20:00:00', max_farmers: 20, booked_count: 5, held_count: 0 }, mockNow);
  assert('TEST 7: Today + future + capacity available (20:00 end at 17:00, 15 free) -> allow', t7.bookable === true && t7.availableCapacity === 15, JSON.stringify(t7));

  // TEST 8: Intelligent Booking Engine & IVR one-press booking -> must never select expired slot
  const engine = new IntelligentBookingEngine({ pool });
  const optResult = await engine.optimizeBooking({
    district: 'Ariyalur',
    preferredDate: todayStr
  });

  if (optResult.status === 'SLOT_FEASIBLE') {
    const alloc = optResult.allocation;
    const expCheck = isSlotExpired(alloc.slot_date, alloc.end_time);
    assert('TEST 8: IVR / Engine slot allocation is strictly non-expired', expCheck.expired === false, `Allocated expired slot ${alloc.slot_date} ${alloc.end_time}`);
  } else {
    // If all today's slots ended, engine correctly reported NO_FEASIBLE_SLOT
    assert('TEST 8: IVR / Engine correctly returned NO_FEASIBLE_SLOT because today slots are expired', optResult.status === 'NO_FEASIBLE_SLOT', optResult.reason);
  }

  // TEST 9 & 10: Web and CSC booking via API -> reject expired slot
  // Find a registered farmer without an active booking so slot check is evaluated
  const freeFarmerRes = await pool.query(`
    SELECT f.farmer_id, f.district
    FROM farmers f
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.farmer_id = f.farmer_id
        AND b.booking_date >= CURRENT_DATE
        AND b.status NOT IN ('Procured', 'Payment Pending', 'Payment Completed', 'No-Show', 'Cancelled')
    )
    LIMIT 1
  `);
  const testFarmerId = freeFarmerRes.rows[0]?.farmer_id || 'F969805';

  // Find an expired slot from DB (e.g. today's 08:00 slot or yesterday's slot) at an operational centre
  const expiredSlotRes = await pool.query(`
    SELECT s.slot_id, s.centre_id, s.date, s.start_time, s.end_time, c.district
    FROM slots s
    JOIN centres c ON s.centre_id = c.centre_id
    WHERE s.date <= CURRENT_DATE AND s.end_time <= CURRENT_TIME
      AND c.operational_status NOT IN ('Closed', 'Retired')
    LIMIT 1
  `);

  if (expiredSlotRes.rows.length > 0) {
    const expSlot = expiredSlotRes.rows[0];
    const postRes = await fetch('http://localhost:4000/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmer_id: testFarmerId,
        slot_id: expSlot.slot_id,
        centre_id: expSlot.centre_id,
        district: expSlot.district,
        booking_date: expSlot.date.toISOString().slice(0, 10),
        booking_source: 'WEB'
      })
    });
    const postData = await postRes.json();
    assert('TEST 9: Web booking of expired slot is rejected with HTTP 400', postRes.status === 400 && postData.error === 'slot_expired', `Status: ${postRes.status}, Body: ${JSON.stringify(postData)}`);
  } else {
    console.log('[SKIP] TEST 9: No historical expired slot found in DB');
  }

  // TEST 10: CSC booking via API -> reject expired slot
  if (expiredSlotRes.rows.length > 0) {
    const expSlot = expiredSlotRes.rows[0];
    const cscRes = await fetch('http://localhost:4000/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmer_id: testFarmerId,
        slot_id: expSlot.slot_id,
        centre_id: expSlot.centre_id,
        district: expSlot.district,
        booking_date: expSlot.date.toISOString().slice(0, 10),
        booking_source: 'CSC'
      })
    });
    const cscData = await cscRes.json();
    assert('TEST 10: CSC booking of expired slot is rejected with HTTP 400', cscRes.status === 400 && cscData.error === 'slot_expired', `Status: ${cscRes.status}, Body: ${JSON.stringify(cscData)}`);
  } else {
    console.log('[SKIP] TEST 10: No historical expired slot found in DB');
  }

  console.log('\n============================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================');

  await pool.end();
  setTimeout(() => {
    process.exit(failed > 0 ? 1 : 0);
  }, 100);
}

runTestSuite().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

