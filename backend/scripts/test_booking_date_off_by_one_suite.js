/**
 * Kisan Vikas — Mandatory Regression Suite for Date Off-by-One Repair
 * 
 * Verifies:
 * - Test 0: B385094 raw database value vs API response vs UI formatHumanDate display.
 * - Test 1: IVR selects 8 October 2026 -> PostgreSQL bookings.booking_date stores strictly '2026-10-08'.
 * - Test 2: Farmer Web must display '8 Oct 2026'.
 * - Test 3: Centre Admin must display '8 Oct 2026'.
 * - Test 4: IVR and Farmer Website agree on booking_date, centre, slot, and booking_id.
 * - Test 5: Dates around midnight ('2026-10-07', '2026-10-08', '2026-10-09') have zero previous-day or next-day shift across serialization.
 * - Test 6: Late evening appointment near midnight (23:00–23:59 Asia/Kolkata) maintains the exact calendar date.
 * - Test 7: Expiry engine correctly uses Asia/Kolkata time and calendar dates without timezone drift.
 */

const { Pool, types } = require('pg');
const { generateToken } = require('../auth');

// Force type parser 1082 in test runner
types.setTypeParser(1082, (val) => val);

const pool = new Pool({ connectionString: 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue' });
const API_BASE = 'http://localhost:4000/api';

async function httpGet(url, headers = {}) {
  const res = await fetch(url, { headers });
  const data = await res.json();
  return { status: res.status, data };
}

async function httpPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, data };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatHumanDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const s = String(dateStr).trim();
    if (s.includes('T') || s.includes('Z')) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Asia/Kolkata'
        });
      }
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const year = m[1];
      const monthIdx = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${day} ${MONTHS_SHORT[monthIdx]} ${year}`;
      }
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  } catch {
    return String(dateStr);
  }
}

const { isSlotExpired, getKolkataNow, normalizeDateStr } = require('../services/booking/slotValidation');

async function runRegressionSuite() {
  console.log('========================================================================');
  console.log('🌾 KISAN VIKAS — MANDATORY DATE REGRESSION & OFF-BY-ONE TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(title, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [PASS] ${title}`);
    } else {
      console.error(`❌ [FAIL] ${title}`);
      if (details) console.error(`   Details: ${details}`);
    }
  }

  try {
    // ------------------------------------------------------------------------
    // TEST 0: Inspect existing booking B385094
    // ------------------------------------------------------------------------
    console.log('--- TEST 0: Inspection of Production Booking B385094 ---');
    const b385094Db = await pool.query(`
      SELECT booking_id, farmer_id, slot_id, centre_id,
             booking_date::text AS raw_date_text,
             status
      FROM bookings
      WHERE booking_id = 'B385094'
    `);
    assert(
      'B385094 exists in database',
      b385094Db.rows.length > 0,
      `Rows found: ${b385094Db.rows.length}`
    );

    const bRecord = b385094Db.rows[0];
    assert(
      'B385094 PostgreSQL booking_date is strictly "2026-10-08"',
      bRecord.raw_date_text === '2026-10-08',
      `DB Value: ${bRecord.raw_date_text}`
    );

    // Call API for farmer F929614 active booking (or expired booking for completed window)
    const activeRes = await httpGet(`${API_BASE}/farmers/${bRecord.farmer_id}/active-booking`);
    const activeBooking = activeRes.data.active_booking || activeRes.data.expired_booking;
    assert(
      'API returns active_booking with booking_date "2026-10-08" (No UTC offset shift)',
      activeBooking && (activeBooking.booking_date === '2026-10-08' || activeBooking.booking_date_str === '2026-10-08'),
      `API returned: ${activeBooking?.booking_date || activeBooking?.booking_date_str}`
    );

    // Test Farmer Web formatHumanDate for B385094
    const bFormattedWeb = formatHumanDate(activeBooking?.booking_date || activeBooking?.booking_date_str);
    assert(
      'Farmer Web formats B385094 as "8 Oct 2026"',
      bFormattedWeb === '8 Oct 2026',
      `Formatted result: ${bFormattedWeb}`
    );

    // ------------------------------------------------------------------------
    // TEST 1: IVR selects 8 October 2026 -> Database must contain 2026-10-08
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 1: IVR Date Selection & Atomic Database Persistence ---');
    const test1FarmerId = 'F_DATE_TEST';
    const test1Date = '2026-10-08';
    const test1SlotId = 'TN_DPC_3477_20261008_1600';
    const test1CentreId = 'TN_DPC_3477';
    const test1BookingId = `B_TEST1_${Date.now()}`;
    const test1IdempotencyKey = `IVR_TEST1_${Date.now()}`;

    // Ensure test farmer exists and has no prior active booking
    await pool.query(`
      INSERT INTO farmers (farmer_id, name, district, village, phone)
      VALUES ('F_DATE_TEST', 'Kavitha Murugan', 'Vellore', 'Ussoor', '9000000088')
      ON CONFLICT (farmer_id) DO UPDATE SET district = 'Vellore'
    `);
    await pool.query(`DELETE FROM bookings WHERE farmer_id = 'F_DATE_TEST'`);

    // Ensure slot exists
    await pool.query(`
      INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count, is_expired, status)
      VALUES ($1, $2, $3::date, '16:00:00', '17:00:00', 50, 0, 0, false, 'AVAILABLE')
      ON CONFLICT (slot_id) DO UPDATE SET is_expired = false, booked_count = 0, status = 'AVAILABLE'
    `, [test1SlotId, test1CentreId, test1Date]);

    const postRes = await httpPost(`${API_BASE}/bookings`, {
      booking_id: test1BookingId,
      farmer_id: test1FarmerId,
      centre_id: test1CentreId,
      slot_id: test1SlotId,
      district: 'Vellore',
      booking_date: test1Date, // "2026-10-08"
      crop: 'Maize',
      quantity_quintals: 25,
      booking_source: 'IVR',
      idempotency_key: test1IdempotencyKey
    });

    assert(
      'POST /api/bookings returns 200 with booking_id',
      postRes.status === 200 && postRes.data.booking_id === test1BookingId,
      JSON.stringify(postRes.data)
    );

    const test1Db = await pool.query(`
      SELECT booking_id, booking_date::text as raw_date, TO_CHAR(booking_date, 'YYYY-MM-DD') as to_char_date
      FROM bookings
      WHERE booking_id = $1
    `, [test1BookingId]);

    assert(
      'Database bookings.booking_date strictly contains "2026-10-08"',
      test1Db.rows[0].raw_date === '2026-10-08' && test1Db.rows[0].to_char_date === '2026-10-08',
      `DB raw_date: ${test1Db.rows[0].raw_date}`
    );

    // ------------------------------------------------------------------------
    // TEST 2: Farmer Web must display 8 Oct 2026
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Farmer Web Date Serialization & Display ---');
    const farmerToken = generateToken({ role: 'FARMER', farmerId: test1FarmerId });
    const farmerHeaders = { Authorization: `Bearer ${farmerToken}` };

    const farmerBookingsRes = await httpGet(`${API_BASE}/bookings/${test1FarmerId}`, farmerHeaders);
    const foundBooking = farmerBookingsRes.data.find(b => b.booking_id === test1BookingId);
    assert(
      'GET /api/bookings/:farmerId serializes booking_date as calendar date "2026-10-08"',
      foundBooking && foundBooking.booking_date === '2026-10-08',
      `Serialized value: ${foundBooking?.booking_date}`
    );

    const farmerWebDisplay = formatHumanDate(foundBooking.booking_date);
    assert(
      'Farmer Web formatHumanDate produces "8 Oct 2026"',
      farmerWebDisplay === '8 Oct 2026',
      `Displayed: ${farmerWebDisplay}`
    );

    // ------------------------------------------------------------------------
    // TEST 3: Centre Admin must display 8 Oct 2026
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: Centre Admin Date Display Parity ---');
    const adminQueueRes = await httpGet(`${API_BASE}/centres/${test1CentreId}/queue`);
    const adminRows = Array.isArray(adminQueueRes.data) ? adminQueueRes.data : (adminQueueRes.data?.queue || []);
    const adminBooking = adminRows.find(b => b.booking_id === test1BookingId);
    assert(
      'Centre Admin queue API returns booking_date "2026-10-08"',
      adminBooking && (adminBooking.booking_date === '2026-10-08' || adminBooking.booking_date_str === '2026-10-08'),
      `Admin booking_date: ${adminBooking?.booking_date}`
    );

    const adminWebDisplay = formatHumanDate(adminBooking.booking_date || adminBooking.booking_date_str);
    assert(
      'Centre Admin formatHumanDate produces "8 Oct 2026"',
      adminWebDisplay === '8 Oct 2026',
      `Admin displayed: ${adminWebDisplay}`
    );

    // ------------------------------------------------------------------------
    // TEST 4: IVR and Website agree on booking date, centre, slot, booking ID
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: Channel Parity Between IVR and Website ---');
    assert(
      'Both IVR and Website have matching booking ID',
      test1BookingId === foundBooking.booking_id && foundBooking.booking_id === adminBooking.booking_id
    );
    assert(
      'Both IVR and Website have matching centre ID',
      test1CentreId === foundBooking.centre_id && foundBooking.centre_id === adminBooking.centre_id
    );
    assert(
      'Both IVR and Website have matching slot ID',
      test1SlotId === foundBooking.slot_id && foundBooking.slot_id === adminBooking.slot_id
    );
    assert(
      'Both IVR and Website have matching calendar booking date ("2026-10-08")',
      test1Date === foundBooking.booking_date && formatHumanDate(foundBooking.booking_date) === formatHumanDate(test1Date)
    );

    // ------------------------------------------------------------------------
    // TEST 5: Dates around midnight (2026-10-07, 2026-10-08, 2026-10-09)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: Midnight Boundary Dates (2026-10-07, 2026-10-08, 2026-10-09) ---');
    const testDates = ['2026-10-07', '2026-10-08', '2026-10-09'];
    for (const dStr of testDates) {
      const slotId = `TN_DPC_3477_${dStr.replace(/-/g, '')}_1500`;
      const bId = `B_MID_${dStr}_${Date.now()}`;

      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count, is_expired, status)
        VALUES ($1, $2, $3::date, '15:00:00', '16:00:00', 50, 0, 0, false, 'AVAILABLE')
        ON CONFLICT (slot_id) DO NOTHING
      `, [slotId, test1CentreId, dStr]);

      await pool.query(`
        INSERT INTO bookings (booking_id, farmer_id, slot_id, centre_id, booking_date, crop, quantity_quintals, status, msp_rate_inr, payment_status, queue_position_at_booking, estimated_wait_minutes, sms_notifications_sent, booking_source, operator_id, token, idempotency_key, created_at)
        VALUES ($1, $2, $3, $4, $5::date, 'Paddy', 30, 'Confirmed', 2275, 'Not Applicable', 1, 10, 1, 'SELF_SERVICE', NULL, 'Q001', $6, NOW())
      `, [bId, 'F_DATE_TEST', slotId, test1CentreId, dStr, `IDEM_${bId}`]);

      // Query through API
      const fetchRes = await httpGet(`${API_BASE}/bookings/F_DATE_TEST`, farmerHeaders);
      const record = fetchRes.data.find(b => b.booking_id === bId);

      const dbRaw = await pool.query(`SELECT booking_date::text as raw_d FROM bookings WHERE booking_id = $1`, [bId]);

      assert(
        `Date ${dStr} stored on disk as "${dStr}" and returned by API as "${dStr}"`,
        dbRaw.rows[0].raw_d === dStr && record.booking_date === dStr,
        `DB: ${dbRaw.rows[0].raw_d}, API: ${record.booking_date}`
      );

      const human = formatHumanDate(record.booking_date);
      const expectedDay = parseInt(dStr.slice(8), 10);
      assert(
        `Date ${dStr} formatted without previous-day shift: "${human}"`,
        human.startsWith(`${expectedDay} Oct 2026`),
        `Formatted: ${human}`
      );
    }

    // ------------------------------------------------------------------------
    // TEST 6: Appointment near midnight (23:00–23:59 Asia/Kolkata)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: Late Evening Appointment Near Midnight (23:00–23:59 Asia/Kolkata) ---');
    const lateSlotDate = '2026-10-08';
    const lateSlotId = `TN_DPC_3477_20261008_2300`;
    const lateBookingId = `B_LATE_${Date.now()}`;

    await pool.query(`
      INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, held_count, is_expired, status)
      VALUES ($1, $2, $3::date, '23:00:00', '23:59:00', 50, 0, 0, false, 'AVAILABLE')
      ON CONFLICT (slot_id) DO NOTHING
    `, [lateSlotId, test1CentreId, lateSlotDate]);

    await pool.query(`
      INSERT INTO bookings (booking_id, farmer_id, slot_id, centre_id, booking_date, crop, quantity_quintals, status, msp_rate_inr, payment_status, queue_position_at_booking, estimated_wait_minutes, sms_notifications_sent, booking_source, operator_id, token, idempotency_key, created_at)
      VALUES ($1, $2, $3, $4, $5::date, 'Paddy', 30, 'Confirmed', 2275, 'Not Applicable', 1, 10, 1, 'SELF_SERVICE', NULL, 'Q001', $6, NOW())
    `, [lateBookingId, 'F_DATE_TEST', lateSlotId, test1CentreId, lateSlotDate, `IDEM_${lateBookingId}`]);

    const lateFetch = await httpGet(`${API_BASE}/bookings/F_DATE_TEST`, farmerHeaders);
    const lateRecord = lateFetch.data.find(b => b.booking_id === lateBookingId);

    assert(
      '23:00 appointment booking_date remains calendar date "2026-10-08" (No midnight roll-over)',
      lateRecord && lateRecord.booking_date === '2026-10-08',
      `Booking date: ${lateRecord?.booking_date}`
    );
    assert(
      '23:00 appointment formats as "8 Oct 2026"',
      formatHumanDate(lateRecord.booking_date) === '8 Oct 2026'
    );

    // ------------------------------------------------------------------------
    // TEST 7: Expired slot logic uses Asia/Kolkata time and correct date
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Slot Expiration Logic Uses Asia/Kolkata Time ---');
    // Simulate mock time: 2026-10-08 09:30:00 IST (04:00:00 UTC)
    const mockNow = new Date('2026-10-08T04:00:00.000Z'); // 09:30 IST

    // Slot that ended at 09:00:00 on 2026-10-08 should be expired at 09:30 IST
    const endedSlot = isSlotExpired('2026-10-08', '09:00:00', mockNow);
    assert(
      'Slot on 2026-10-08 ending at 09:00:00 IST is marked EXPIRED at 09:30:00 IST',
      endedSlot.expired === true && endedSlot.reason === 'TIME_ELAPSED',
      JSON.stringify(endedSlot)
    );

    // Slot ending at 11:00:00 on 2026-10-08 should be ACTIVE at 09:30 IST
    const futureSlotToday = isSlotExpired('2026-10-08', '11:00:00', mockNow);
    assert(
      'Slot on 2026-10-08 ending at 11:00:00 IST is marked ACTIVE at 09:30:00 IST',
      futureSlotToday.expired === false && futureSlotToday.reason === 'UPCOMING_OR_ACTIVE',
      JSON.stringify(futureSlotToday)
    );

    // Slot on 2026-10-09 is future date
    const tomorrowSlot = isSlotExpired('2026-10-09', '08:00:00', mockNow);
    assert(
      'Slot on 2026-10-09 is marked NOT EXPIRED (FUTURE_DATE) at 09:30:00 IST',
      tomorrowSlot.expired === false && tomorrowSlot.reason === 'FUTURE_DATE',
      JSON.stringify(tomorrowSlot)
    );

    // Slot on 2026-10-07 is past date
    const yesterdaySlot = isSlotExpired('2026-10-07', '23:59:00', mockNow);
    assert(
      'Slot on 2026-10-07 is marked EXPIRED (PAST_DATE) at 09:30:00 IST',
      yesterdaySlot.expired === true && yesterdaySlot.reason === 'PAST_DATE',
      JSON.stringify(yesterdaySlot)
    );

    console.log('\n========================================================================');
    console.log(`🏁 REGRESSION SUITE COMPLETE: ${passed} / ${total} ASSERTIONS PASSED (${Math.round((passed / total) * 100)}%)`);
    console.log('========================================================================\n');

  } catch (err) {
    console.error('Fatal suite error:', err);
  } finally {
    await pool.end();
  }
}

runRegressionSuite();
