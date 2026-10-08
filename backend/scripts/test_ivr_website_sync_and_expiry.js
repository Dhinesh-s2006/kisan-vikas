/**
 * Comprehensive Verification Suite for Kisan Vikas:
 * 1. IVR Centre Selection & Website Recommendation Synchronization
 * 2. Expired Booking Non-blocking & Historical Audit Preservation
 * 3. Protected Arrived States & Future Active Duplicate Prevention
 * 4. Authoritative FastAGI Telephony Extension 2000 on Port 4574
 * 5. Complete Branding & Zero "Kisan Queue" in Prompts
 */

const { Pool } = require('pg');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { getKolkataNow, isSlotExpired, normalizeDateStr } = require('../services/booking/slotValidation');
const { CentreRecommendationService } = require('../services/centre/centreRecommendationService');

const localIvrDir = path.resolve(__dirname, '../../ivr');
const FASTAGI_DIR = process.env.FASTAGI_DIR || (fs.existsSync('C:/KisanQueue-IVR') ? 'C:/KisanQueue-IVR' : localIvrDir);
const BookingService = require(`${FASTAGI_DIR}/core/bookingService`);
const promptDictionary = require(`${FASTAGI_DIR}/prompts/promptMessages`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue'
});

const API_BASE_URL = 'http://localhost:4000/api';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('   KISAN VIKAS: IVR & WEBSITE SYNC + EXPIRED BOOKING TEST SUITE        ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testNum, name, details = '') {
    if (condition) {
      console.log(`  ✓ [TEST ${String(testNum).padStart(2, '0')}] PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ✗ [TEST ${String(testNum).padStart(2, '0')}] FAIL: ${name} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  const { todayStr, currentTimeStr } = getKolkataNow();
  const ivrBookingService = new BookingService(API_BASE_URL);
  const webRecService = new CentreRecommendationService({ pool });

  // Clean up any previous test artifacts
  await pool.query("DELETE FROM reschedule_events WHERE booking_id LIKE 'B_SYNC_%'");
  await pool.query("DELETE FROM bookings WHERE booking_id LIKE 'B_SYNC_%' OR farmer_id LIKE 'FARMER_SYNC_%'");

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Website & IVR Recommendation Synchronization
    // -------------------------------------------------------------------------
    console.log('\n--- 1. WEBSITE & IVR RECOMMENDATION SYNCHRONIZATION ---');
    const farmerRes = await pool.query('SELECT farmer_id, district, name, village FROM farmers WHERE district = $1 LIMIT 1', ['Vellore']);
    const testFarmer = farmerRes.rows[0];

    // Web recommendation
    const webRec = await webRecService.getRecommendations({
      district: testFarmer.district,
      date: todayStr,
      farmerId: testFarmer.farmer_id
    });

    // IVR recommendation via BookingService (calls GET /api/centres/recommend)
    const ivrRec = await ivrBookingService.getRecommendations({
      district: testFarmer.district,
      date: todayStr,
      farmer_id: testFarmer.farmer_id
    });

    assert(
      webRec.recommended_centre.centre_id === ivrRec.recommended_centre.centre_id,
      1,
      'Website and IVR agree on recommended centre ID',
      `Web: ${webRec.recommended_centre.centre_id}, IVR: ${ivrRec.recommended_centre.centre_id}`
    );

    assert(
      webRec.recommended_centre.centre_name === ivrRec.recommended_centre.centre_name,
      2,
      'Website and IVR agree on recommended centre name',
      `Web: ${webRec.recommended_centre.centre_name}, IVR: ${ivrRec.recommended_centre.centre_name}`
    );

    assert(
      webRec.recommended_centre.road_distance_km === ivrRec.recommended_centre.road_distance_km,
      3,
      'Website and IVR use identical road distance source and value',
      `Distance: ${webRec.recommended_centre.road_distance_km} vs ${ivrRec.recommended_centre.road_distance_km}`
    );

    assert(
      webRec.recommended_centre.has_available_slots === ivrRec.recommended_centre.has_available_slots,
      4,
      'Website and IVR agree on slot availability status',
      `Available: ${webRec.recommended_centre.has_available_slots}`
    );

    assert(
      webRec.alternatives.length === ivrRec.alternatives.length,
      5,
      'Website and IVR return matching alternatives count',
      `Web alts: ${webRec.alternatives.length}, IVR alts: ${ivrRec.alternatives.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Expired Appointments Do Not Block New Bookings
    // -------------------------------------------------------------------------
    console.log('\n--- 2. EXPIRED APPOINTMENTS & AUDIT TRAIL PRESERVATION ---');

    // Pick an existing slot in the past or yesterday
    const pastSlotRes = await pool.query(
      `SELECT slot_id, centre_id, date, start_time, end_time 
       FROM slots 
       WHERE (date < $1 OR (date = $1 AND end_time <= $2)) 
       ORDER BY date ASC, end_time ASC LIMIT 1`,
      [todayStr, currentTimeStr]
    );

    let pastSlot = pastSlotRes.rows[0];
    if (!pastSlot) {
      // Create a dummy slot yesterday for test
      const dummyDate = '2026-10-01';
      const dummySlotId = 'TEST_PAST_SLOT_01';
      await pool.query(
        `INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, operational_status)
         VALUES ($1, $2, $3, '08:00:00', '09:00:00', 10, 0, 'Open')
         ON CONFLICT (slot_id) DO NOTHING`,
        [dummySlotId, 'TN_DPC_3475', dummyDate]
      );
      pastSlot = {
        slot_id: dummySlotId,
        centre_id: 'TN_DPC_3475',
        date: dummyDate,
        start_time: '08:00:00',
        end_time: '09:00:00'
      };
    }

    const testExpiredFarmerId = 'FARMER_SYNC_EXP_01';
    // Ensure farmer exists
    await pool.query(
      `INSERT INTO farmers (farmer_id, name, phone, district, village, primary_crop)
       VALUES ($1, 'Test Expired Farmer', '9894000001', 'Vellore', 'Anaicut', 'Paddy (Common)')
       ON CONFLICT (farmer_id) DO NOTHING`,
      [testExpiredFarmerId]
    );

    // Insert past un-arrived booking in 'Booked' status
    const expiredBookingId = 'B_SYNC_EXP_001';
    await pool.query(
      `INSERT INTO bookings (booking_id, farmer_id, centre_id, slot_id, booking_date, status, crop, quantity_quintals)
       VALUES ($1, $2, $3, $4, $5, 'Booked', 'Paddy (Common)', 20)
       ON CONFLICT (booking_id) DO NOTHING`,
      [expiredBookingId, testExpiredFarmerId, pastSlot.centre_id, pastSlot.slot_id, pastSlot.date]
    );

    // Call GET /api/farmers/:farmerId/active-booking
    const activeCheckResp = await fetch(`${API_BASE_URL}/farmers/${testExpiredFarmerId}/active-booking`);
    const activeCheckData = await activeCheckResp.json();

    assert(
      activeCheckData.has_active_booking === false,
      6,
      'Past unarrived appointment does not count as active booking',
      `has_active_booking: ${activeCheckData.has_active_booking}`
    );

    assert(
      activeCheckData.has_expired_booking === true && activeCheckData.expired_booking != null,
      7,
      'Expired appointment correctly detected and returned in expired_booking payload',
      `has_expired_booking: ${activeCheckData.has_expired_booking}`
    );

    // Verify booking record was NOT deleted from DB (audit preservation)
    const auditRes = await pool.query('SELECT booking_id, status FROM bookings WHERE booking_id = $1', [expiredBookingId]);
    assert(
      auditRes.rows.length === 1,
      8,
      'Expired appointment record is retained in database for audit trail and missed visits tracking',
      `Record count: ${auditRes.rows.length}, status: ${auditRes.rows[0]?.status}`
    );

    // Verify farmer CAN create a new booking on an open future slot in their registered district
    const { ensureCentreSlots } = require('../services/booking/slotService');
    await ensureCentreSlots(pool, 'TN_DPC_3475', todayStr, 2);

    const futureSlotRes = await pool.query(
      `SELECT s.slot_id, s.centre_id, s.date, s.start_time, s.end_time, s.max_farmers, s.booked_count 
       FROM slots s
       JOIN centres c ON s.centre_id = c.centre_id
       WHERE c.district = 'Vellore' AND s.date >= $1 AND (s.booked_count < s.max_farmers) AND (s.date > $1 OR s.start_time > $2)
       ORDER BY s.date ASC, s.start_time ASC LIMIT 1`,
      [todayStr, currentTimeStr]
    );
    const futureSlot = futureSlotRes.rows[0];

    if (futureSlot) {
      const newBookingResp = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: testExpiredFarmerId,
          centre_id: futureSlot.centre_id,
          slot_id: futureSlot.slot_id,
          booking_date: normalizeDateStr(futureSlot.date),
          crop: 'Paddy (Common)',
          quantity_quintals: 25
        })
      });

      const newBookingData = await newBookingResp.json();
      const createdBookingId = newBookingData.booking_id || newBookingData.booking?.booking_id;
      assert(
        (newBookingResp.status === 200 || newBookingResp.status === 201) && createdBookingId != null,
        9,
        'Farmer with expired appointment successfully books valid future slot without 409 conflict',
        `HTTP Status: ${newBookingResp.status}, booking_id: ${createdBookingId}`
      );

      // Now that they have a genuine future booking, attempting ANOTHER booking must be blocked
      const dupBookingResp = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: testExpiredFarmerId,
          centre_id: futureSlot.centre_id,
          slot_id: futureSlot.slot_id,
          booking_date: normalizeDateStr(futureSlot.date),
          crop: 'Paddy (Common)',
          quantity_quintals: 10
        })
      });

      assert(
        dupBookingResp.status === 409,
        10,
        'Farmer with genuine active future booking is blocked from duplicate booking (HTTP 409)',
        `HTTP Status: ${dupBookingResp.status}`
      );

      // Clean up future booking immediately so next tests start with clean slate
      if (createdBookingId) {
        await pool.query('DELETE FROM bookings WHERE booking_id = $1', [createdBookingId]);
        await pool.query('UPDATE slots SET booked_count = GREATEST(0, booked_count - 1) WHERE slot_id = $1', [futureSlot.slot_id]);
      }
    }

    // -------------------------------------------------------------------------
    // TEST 3: Arrived Farmer Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 3. ARRIVED FARMER PROTECTION FROM EXPIRY ---');
    const arrivedBookingId = 'B_SYNC_ARRIVED_01';
    await pool.query(
      `INSERT INTO bookings (booking_id, farmer_id, centre_id, slot_id, booking_date, status, crop, quantity_quintals)
       VALUES ($1, $2, $3, $4, $5, 'Checked-In', 'Paddy (Common)', 20)
       ON CONFLICT (booking_id) DO UPDATE SET status = 'Checked-In'`,
      [arrivedBookingId, testExpiredFarmerId, pastSlot.centre_id, pastSlot.slot_id, pastSlot.date]
    );

    const arrivedCheckResp = await fetch(`${API_BASE_URL}/farmers/${testExpiredFarmerId}/active-booking`);
    const arrivedCheckData = await arrivedCheckResp.json();

    assert(
      arrivedCheckData.has_active_booking === true && arrivedCheckData.active_booking.booking_id === arrivedBookingId,
      11,
      'Checked-in farmer is protected and retained as active even after scheduled slot time passes',
      `Active: ${arrivedCheckData.has_active_booking}, ID: ${arrivedCheckData.active_booking?.booking_id}`
    );

    // Clean up
    await pool.query('DELETE FROM bookings WHERE booking_id = $1', [arrivedBookingId]);

    // -------------------------------------------------------------------------
    // TEST 4: Immediate Pre-booking Revalidation
    // -------------------------------------------------------------------------
    console.log('\n--- 4. PRE-BOOKING REVALIDATION (SLOT EXPIRY & CLOSED CENTRES) ---');
    const expiredValidation = await webRecService.validateCentreAndSlot({
      centreId: pastSlot.centre_id,
      slotId: pastSlot.slot_id,
      date: pastSlot.date
    });

    assert(
      expiredValidation.valid === false && expiredValidation.reason.includes('expired'),
      12,
      'Pre-booking revalidation rejects expired slot immediately',
      `Valid: ${expiredValidation.valid}, Reason: ${expiredValidation.reason}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Multilingual IVR Prompts & Branding
    // -------------------------------------------------------------------------
    console.log('\n--- 5. IVR PROMPT BRANDING & KISAN VIKAS VERIFICATION ---');

    let promptKisanQueueOccurrences = 0;
    let kisanVikasOccurrences = 0;

    for (const [langKey, langPrompts] of Object.entries(promptDictionary)) {
      for (const [key, msg] of Object.entries(langPrompts)) {
        if (typeof msg === 'string') {
          if (msg.includes('Kisan Queue') || msg.includes('கிசான் கியூ')) {
            promptKisanQueueOccurrences++;
            console.error(`Found obsolete branding in ${langKey}.${key}: "${msg}"`);
          }
          if (msg.includes('Kisan Vikas') || msg.includes('கிசான் விகாஸ்')) {
            kisanVikasOccurrences++;
          }
        }
      }
    }

    assert(
      promptKisanQueueOccurrences === 0,
      13,
      'Zero occurrences of "Kisan Queue" in IVR prompt dictionary',
      `Occurrences: ${promptKisanQueueOccurrences}`
    );

    assert(
      kisanVikasOccurrences >= 6,
      14,
      'Kisan Vikas branding correctly present across English, Tamil, and Hindi IVR prompts',
      `Occurrences: ${kisanVikasOccurrences}`
    );

    assert(
      !!promptDictionary.English.booking_expired_notice &&
      !!promptDictionary.Tamil.booking_expired_notice &&
      !!promptDictionary.Hindi.booking_expired_notice,
      15,
      'Dedicated expired-booking notice present in all three IVR languages',
      'English, Tamil, and Hindi all have booking_expired_notice'
    );

    // -------------------------------------------------------------------------
    // TEST 6: Authoritative FastAGI Telephony Extension 2000 (Port 4574)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. AUTHORITATIVE FASTAGI TELEPHONY EXTENSION (2000) ---');

    const port4574Active = await new Promise(resolve => {
      const client = net.createConnection({ port: 4574, host: '127.0.0.1' }, () => {
        client.end();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });

    assert(
      port4574Active,
      16,
      'Authoritative IVR Extension 2000 FastAGI server is listening on port 4574',
      `Port 4574 active: ${port4574Active}`
    );

  } catch (err) {
    console.error('Fatal error in test suite:', err);
    failed++;
  } finally {
    // Final cleanup of test records
    await pool.query("DELETE FROM reschedule_events WHERE booking_id LIKE 'B_SYNC_%'");
    await pool.query("DELETE FROM bookings WHERE booking_id LIKE 'B_SYNC_%' OR farmer_id LIKE 'FARMER_SYNC_%'");
    await pool.query("DELETE FROM farmers WHERE farmer_id LIKE 'FARMER_SYNC_%'");
    await pool.end();
  }

  console.log('\n========================================================================');
  console.log(`TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();
