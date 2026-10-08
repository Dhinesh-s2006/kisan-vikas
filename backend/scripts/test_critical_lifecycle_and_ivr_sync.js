const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue'
});

const API_BASE = 'http://localhost:4000/api';

async function runTests() {
  console.log('========================================================================');
  console.log('   CRITICAL LIFECYCLE, IVR PERSISTENCE & QUEUE CONSISTENCY VERIFICATION');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Verify Farmer F929614 (Rahul Suhkla) initial state
    const farmerRes = await pool.query("SELECT * FROM farmers WHERE farmer_id = 'F929614'");
    assert(farmerRes.rows.length === 1, 'Farmer F929614 exists in database');
    const farmer = farmerRes.rows[0];

    // Check existing booking B362707 is Payment Completed
    const b362Res = await pool.query("SELECT * FROM bookings WHERE booking_id = 'B362707'");
    assert(b362Res.rows.length === 1 && b362Res.rows[0].status === 'Payment Completed', 'Booking B362707 has status Payment Completed');

    // 2. Active booking endpoint must NOT return B362707 as an active booking
    const activeCheck1 = await fetch(`${API_BASE}/farmers/${farmer.farmer_id}/active-booking`).then(r => r.json());
    assert(
      activeCheck1.active_booking?.booking_id !== 'B362707',
      'Farmer active booking does not return completed B362707'
    );
    const b385Res = await pool.query("SELECT booking_date::text as raw_d FROM bookings WHERE booking_id = 'B385094'");
    assert(
      b385Res.rows[0]?.raw_d === '2026-10-08',
      'B385094 booking returns calendar date "2026-10-08" (No UTC offset shift)'
    );

    // 3. Test IVR Booking Flow with a dedicated sync test farmer
    const syncFarmerId = 'F_SYNC_TEST';
    await pool.query(`
      INSERT INTO farmers (farmer_id, name, phone, village, district)
      VALUES ($1, 'Sync Test Farmer', '+91 99999 11111', 'Ussoor', 'Vellore')
      ON CONFLICT (farmer_id) DO NOTHING
    `, [syncFarmerId]);
    await pool.query('DELETE FROM bookings WHERE farmer_id = $1', [syncFarmerId]);

    // Find an open future slot in Vellore
    const slotsRes = await pool.query(`
      SELECT s.slot_id, s.centre_id, TO_CHAR(s.date, 'YYYY-MM-DD') AS slot_date_str, s.start_time, s.end_time, s.booked_count, s.max_farmers
      FROM slots s
      JOIN centres c ON s.centre_id = c.centre_id
      WHERE c.district = 'Vellore' AND s.date > (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
        AND s.booked_count < s.max_farmers AND (s.is_expired = FALSE OR s.is_expired IS NULL)
      ORDER BY s.date ASC, s.start_time ASC
      LIMIT 1
    `);
    assert(slotsRes.rows.length === 1, 'Found valid upcoming future slot in Vellore');
    const targetSlot = slotsRes.rows[0];
    const targetDateStr = targetSlot.slot_date_str;

    // Create a new booking as if from IVR Ext 2000 with per-call idempotency key
    const uniqueIdemKey = `IVR_2000_${syncFarmerId}_${targetDateStr}_${Date.now()}`;
    const testBookingId = `B_TEST_SYNC_${Date.now().toString().slice(-6)}`;

    const createResp = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': uniqueIdemKey
      },
      body: JSON.stringify({
        booking_id: testBookingId,
        farmer_id: syncFarmerId,
        slot_id: targetSlot.slot_id,
        centre_id: targetSlot.centre_id,
        district: 'Vellore',
        booking_date: targetDateStr,
        crop: 'Paddy (Common)',
        quantity_quintals: 50,
        booking_source: 'IVR',
        idempotency_key: uniqueIdemKey
      })
    });
    const createData = await createResp.json();

    assert(createResp.status === 200 && createData.success === true, `Booking created successfully via API: ID #${createData.booking_id}`);
    assert(createData.booking_id === testBookingId, 'Created booking ID matches requested booking ID (not stale replay)');

    // 4. Verify booking was actually committed in PostgreSQL
    const dbVerify = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [testBookingId]);
    assert(dbVerify.rows.length === 1, 'Booking record is physically committed and persisted in PostgreSQL');
    assert(dbVerify.rows[0].status === 'Confirmed', 'Committed booking status is Confirmed');
    assert(dbVerify.rows[0].farmer_id === syncFarmerId, 'Committed booking references correct farmer_id');
    assert(dbVerify.rows[0].slot_id === targetSlot.slot_id, 'Committed booking references correct slot_id');

    // 5. Active booking endpoint now returns this newly created booking
    const activeCheck2 = await fetch(`${API_BASE}/farmers/${syncFarmerId}/active-booking`).then(r => r.json());
    assert(activeCheck2.has_active_booking === true, 'Farmer now has active_booking = true');
    assert(activeCheck2.active_booking.booking_id === testBookingId, `Active booking ID matches newly booked #${testBookingId}`);

    // 6. Test Idempotency with exact same active key
    const replayResp = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': uniqueIdemKey
      },
      body: JSON.stringify({
        booking_id: `B_SHOULD_NOT_CREATE_${Date.now()}`,
        farmer_id: syncFarmerId,
        slot_id: targetSlot.slot_id,
        centre_id: targetSlot.centre_id,
        district: 'Vellore',
        booking_date: targetDateStr,
        crop: 'Paddy (Common)',
        quantity_quintals: 50,
        booking_source: 'IVR',
        idempotency_key: uniqueIdemKey
      })
    });
    const replayData = await replayResp.json();
    assert(replayResp.status === 200 && replayData.idempotent_replay === true, 'Network replay with active idempotency key returns idempotent_replay = true');
    assert(replayData.booking_id === testBookingId, 'Replay returned the existing active booking ID');

    // 7. Centre Queue consistency: active booking is present in /api/centres/:id/queue
    const queueResp = await fetch(`${API_BASE}/centres/${targetSlot.centre_id}/queue`).then(r => r.json());
    const inQueue = queueResp.some(b => b.booking_id === testBookingId);
    assert(inQueue === true, 'Newly booked visit is visible in centre active queue');
    const completedInQueue = queueResp.some(b => b.status === 'Payment Completed' || b.status === 'Cancelled' || b.status === 'Expired');
    assert(completedInQueue === false, 'Completed, cancelled, and expired visits are strictly excluded from centre active queue');

    // 8. Rescheduling validation: reject past/expired slot
    // Find or create a slot in the past
    const pastSlotRes = await pool.query(`
      SELECT slot_id FROM slots 
      WHERE centre_id = $1 AND date < (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
      LIMIT 1
    `, [targetSlot.centre_id]);
    if (pastSlotRes.rows.length > 0) {
      const pastSlotId = pastSlotRes.rows[0].slot_id;
      const reschedPast = await fetch(`${API_BASE}/bookings/${testBookingId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'ACCEPT',
          new_slot_id: pastSlotId,
          new_centre_id: targetSlot.centre_id,
          reason: 'Attempting invalid past slot'
        })
      });
      const reschedPastData = await reschedPast.json();
      assert(reschedPast.status === 400 && reschedPastData.code === 'SLOT_EXPIRED', 'Rescheduling to a past/expired slot is strictly rejected with SLOT_EXPIRED');
    }

    // 9. Advance status to Payment Completed and verify removal from active visit
    await pool.query("UPDATE bookings SET status = 'Payment Completed' WHERE booking_id = $1", [testBookingId]);
    const activeCheck3 = await fetch(`${API_BASE}/farmers/${syncFarmerId}/active-booking`).then(r => r.json());
    assert(activeCheck3.has_active_booking === false, 'After status advances to Payment Completed, farmer has has_active_booking = false');

    const queueRespAfter = await fetch(`${API_BASE}/centres/${targetSlot.centre_id}/queue`).then(r => r.json());
    const inQueueAfter = queueRespAfter.some(b => b.booking_id === testBookingId);
    assert(inQueueAfter === false, 'After Payment Completed, visit is removed from centre active queue');

    // Clean up test booking
    await pool.query('DELETE FROM status_history WHERE booking_id = $1', [testBookingId]);
    await pool.query('DELETE FROM bookings WHERE booking_id = $1', [testBookingId]);
    await pool.query('UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE slot_id = $1', [targetSlot.slot_id]);
    await pool.query('UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE slot_id = $1', [targetSlot.slot_id]);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n========================================================================');
  console.log(`   FINAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
