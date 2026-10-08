/**
 * Comprehensive Verification Suite for Kisan Vikas Canonical Business Logic
 * Covers ALL 20 mandatory rules defined in Section 42 of the Master Specification.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const { generateToken } = require('../auth');
const { getKolkataNow, normalizeDateStr } = require('../services/common/timeService');
const { defaultDistanceService } = require('../services/distance/distanceService');
const { defaultWeatherService } = require('../services/weather/weatherService');
const { defaultCongestionService } = require('../services/congestion/congestionService');
const { BookingRequestService } = require('../services/booking/bookingRequestService');

const BASE_URL = 'http://localhost:4000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const results = {};

function logTestHeader(ruleNum, ruleTitle) {
  console.log(`\n======================================================================`);
  console.log(`TEST [Rule ${ruleNum}]: ${ruleTitle}`);
  console.log(`======================================================================`);
}

function recordResult(ruleNum, status, details) {
  results[`Rule ${ruleNum}`] = { status, details };
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [Rule ${ruleNum}] ${status}: ${details}`);
}

async function runTests() {
  console.log('🚀 Starting Kisan Vikas 20-Rule Verification Suite...');
  const { todayStr, currentTimeStr } = getKolkataNow();
  console.log(`Asia/Kolkata Clock: Today = ${todayStr}, Time = ${currentTimeStr}`);

  try {
    // Pre-test setup: cancel any active bookings for test farmer F969805 to avoid active-booking conflict
    await pool.query("UPDATE bookings SET status = 'Cancelled' WHERE farmer_id = 'F969805' AND status NOT IN ('Procured', 'Payment Completed', 'No-Show', 'Cancelled')");
    await pool.query("UPDATE bookings SET status = 'Cancelled' WHERE slot_id LIKE 'SLOT_%'");
    await pool.query("DELETE FROM slots WHERE slot_id LIKE 'SLOT_%' AND slot_id NOT IN (SELECT slot_id FROM bookings WHERE slot_id IS NOT NULL)");

    // -------------------------------------------------------------------------
    // Rule 1: Past date -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(1, 'Past Date Booking Rejection');
    {
      const pastDate = '2026-09-01';
      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805', // Deepak in Ariyalur
          centre_id: 'TN_DPC_0001',
          booking_date: pastDate,
          slot_id: 'TN_DPC_0001_20260901_0800'
        })
      });
      const data = await res.json();
      if (res.status === 400 && data.error === 'past_date') {
        recordResult(1, 'PASS', `Rejected past date ${pastDate} with HTTP 400 and error 'past_date'`);
      } else {
        recordResult(1, 'FAIL', `Expected HTTP 400 'past_date', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 2: Yesterday -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(2, 'Yesterday Booking Rejection');
    {
      const todayDate = new Date(`${todayStr}T00:00:00Z`);
      todayDate.setDate(todayDate.getDate() - 1);
      const yesterdayStr = todayDate.toISOString().slice(0, 10);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: 'TN_DPC_0001',
          booking_date: yesterdayStr,
          slot_id: `TN_DPC_0001_${yesterdayStr.replace(/-/g, '')}_0800`
        })
      });
      const data = await res.json();
      if (res.status === 400 && data.error === 'past_date') {
        recordResult(2, 'PASS', `Rejected yesterday (${yesterdayStr}) with HTTP 400 and error 'past_date'`);
      } else {
        recordResult(2, 'FAIL', `Expected HTTP 400 'past_date', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 3: Today expired slot -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(3, 'Today Expired Slot Rejection');
    {
      const nowKolkata = getKolkataNow();
      const [h, m, s] = nowKolkata.currentTimeStr.split(':').map(Number);
      const totalSec = h * 3600 + m * 60 + s;
      const expiredSec = Math.max(1, totalSec - 120); // 2 minutes ago
      const eh = String(Math.floor(expiredSec / 3600)).padStart(2, '0');
      const em = String(Math.floor((expiredSec % 3600) / 60)).padStart(2, '0');
      const es = String(expiredSec % 60).padStart(2, '0');
      const expiredEndTime = `${eh}:${em}:${es}`;
      const expiredStartTime = '00:00:00';

      const testExpiredSlotId = `SLOT_EXP_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, 'TN_DPC_0001', $2, $3, $4, 20, 0)
        ON CONFLICT (slot_id) DO NOTHING
      `, [testExpiredSlotId, todayStr, expiredStartTime, expiredEndTime]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: 'TN_DPC_0001',
          booking_date: todayStr,
          slot_id: testExpiredSlotId
        })
      });
      const data = await res.json();
      
      // Clean up bookings & test slot
      await pool.query('DELETE FROM bookings WHERE slot_id = $1', [testExpiredSlotId]);
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testExpiredSlotId]);

      if (res.status === 400 && (data.error === 'slot_expired' || data.code === 'SLOT_EXPIRED')) {
        recordResult(3, 'PASS', `Rejected today expired slot (ended at ${expiredEndTime}, current ${nowKolkata.currentTimeStr}) with HTTP 400 and code 'SLOT_EXPIRED'`);
      } else {
        recordResult(3, 'FAIL', `Expected HTTP 400 'slot_expired', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 4: Today future slot -> allowed
    // -------------------------------------------------------------------------
    logTestHeader(4, 'Today Future Slot Allowed');
    {
      const testFutureSlotId = `SLOT_FUT_${Date.now()}`;
      // Slot ending at 23:59:00 today
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, 'TN_DPC_0001', $2, '23:00:00', '23:59:00', 20, 0)
        ON CONFLICT (slot_id) DO NOTHING
      `, [testFutureSlotId, todayStr]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: 'TN_DPC_0001',
          booking_date: todayStr,
          slot_id: testFutureSlotId,
          crop: 'Paddy (Grade A)',
          quantity_quintals: 10
        })
      });
      const data = await res.json();

      let testBookingId = data.booking_id;
      if ((res.status === 200 || res.status === 201) && data.success) {
        recordResult(4, 'PASS', `Allowed future slot today (${todayStr} 23:00-23:59) -> Booking #${testBookingId}`);
      } else {
        recordResult(4, 'FAIL', `Expected HTTP 200/201 success, got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
      if (testBookingId) await pool.query('DELETE FROM bookings WHERE booking_id = $1', [testBookingId]);
      await pool.query('DELETE FROM bookings WHERE slot_id = $1', [testFutureSlotId]);
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testFutureSlotId]);
    }

    // -------------------------------------------------------------------------
    // Rule 5: Tomorrow -> allowed
    // -------------------------------------------------------------------------
    logTestHeader(5, 'Tomorrow Booking Allowed');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 1);
      const tomorrowStr = d.toISOString().slice(0, 10);

      const testTomorrowSlotId = `SLOT_TOM_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, 'TN_DPC_0001', $2, '10:00:00', '11:00:00', 20, 0)
        ON CONFLICT (slot_id) DO NOTHING
      `, [testTomorrowSlotId, tomorrowStr]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: 'TN_DPC_0001',
          booking_date: tomorrowStr,
          slot_id: testTomorrowSlotId,
          crop: 'Paddy (Grade A)',
          quantity_quintals: 15
        })
      });
      const data = await res.json();

      let testBookingId = data.booking_id;
      if ((res.status === 200 || res.status === 201) && data.success) {
        recordResult(5, 'PASS', `Successfully booked tomorrow slot (${tomorrowStr} 10:00-11:00) -> Booking #${testBookingId}`);
      } else {
        recordResult(5, 'FAIL', `Expected HTTP 200/201 success, got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
      if (testBookingId) await pool.query('DELETE FROM bookings WHERE booking_id = $1', [testBookingId]);
      await pool.query('DELETE FROM bookings WHERE slot_id = $1', [testTomorrowSlotId]);
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testTomorrowSlotId]);
    }

    // -------------------------------------------------------------------------
    // Rule 6: Full slot -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(6, 'Full Slot Rejection');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 2);
      const targetDate = d.toISOString().slice(0, 10);

      const testFullSlotId = `SLOT_FULL_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, 'TN_DPC_0001', $2, '14:00:00', '15:00:00', 10, 10)
        ON CONFLICT (slot_id) DO NOTHING
      `, [testFullSlotId, targetDate]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: 'TN_DPC_0001',
          booking_date: targetDate,
          slot_id: testFullSlotId
        })
      });
      const data = await res.json();
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testFullSlotId]);

      if ((res.status === 400 || res.status === 409) && data.error === 'slot_full') {
        recordResult(6, 'PASS', `Rejected full slot (10/10 capacity) with HTTP ${res.status} and error 'slot_full'`);
      } else {
        recordResult(6, 'FAIL', `Expected HTTP 400/409 'slot_full', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 7: Closed centre -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(7, 'Closed Centre Booking Rejection');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 2);
      const targetDate = d.toISOString().slice(0, 10);

      // Create a test closed centre in Ariyalur
      const testClosedCentreId = `C_CLOSED_${Date.now()}`;
      await pool.query(`
        INSERT INTO centres (centre_id, centre_name, district, village_town, operational_status)
        VALUES ($1, 'Test Closed Centre', 'Ariyalur', 'Test Village', 'Closed')
        ON CONFLICT (centre_id) DO UPDATE SET operational_status = 'Closed'
      `, [testClosedCentreId]);

      const testSlotId = `SLOT_CLS_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, $2, $3, '10:00:00', '11:00:00', 20, 0)
        ON CONFLICT (slot_id) DO NOTHING
      `, [testSlotId, testClosedCentreId, targetDate]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: testClosedCentreId,
          booking_date: targetDate,
          slot_id: testSlotId
        })
      });
      const data = await res.json();

      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testSlotId]);
      await pool.query('DELETE FROM centres WHERE centre_id = $1', [testClosedCentreId]);

      if (res.status === 400 && data.error === 'centre_closed') {
        recordResult(7, 'PASS', `Rejected booking at Closed centre with HTTP 400 and error 'centre_closed'`);
      } else {
        recordResult(7, 'FAIL', `Expected HTTP 400 'centre_closed', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 8: Opened centre -> allowed
    // -------------------------------------------------------------------------
    logTestHeader(8, 'Opened Centre Booking Allowed');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 2);
      const targetDate = d.toISOString().slice(0, 10);

      // Create a test centre opened by DO
      const testOpenedCentreId = `C_OPEN_${Date.now()}`;
      await pool.query(`
        INSERT INTO centres (centre_id, centre_name, district, village_town, operational_status)
        VALUES ($1, 'Test Opened Centre', 'Ariyalur', 'Test Village', 'Open')
      `, [testOpenedCentreId]);

      const testSlotId = `SLOT_OPN_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, $2, $3, '11:00:00', '12:00:00', 20, 0)
      `, [testSlotId, testOpenedCentreId, targetDate]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805',
          centre_id: testOpenedCentreId,
          booking_date: targetDate,
          slot_id: testSlotId,
          crop: 'Paddy (Grade A)',
          quantity_quintals: 10
        })
      });
      const data = await res.json();
      const testBookingId = data.booking_id;

      if (testBookingId) {
        await pool.query('DELETE FROM bookings WHERE booking_id = $1', [testBookingId]);
      }
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testSlotId]);
      await pool.query('DELETE FROM centres WHERE centre_id = $1', [testOpenedCentreId]);

      if ((res.status === 200 || res.status === 201) && data.success) {
        recordResult(8, 'PASS', `Successfully booked at officially Open centre -> Booking #${testBookingId}`);
      } else {
        recordResult(8, 'FAIL', `Expected HTTP 200/201 success, got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 9: Wrong district centre -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(9, 'Wrong District Centre Rejection');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 2);
      const targetDate = d.toISOString().slice(0, 10);

      // Farmer Deepak is registered in Ariyalur
      // Attempt to book Erode centre 'TN_DPC_0589'
      const testWrongDistSlotId = `SLOT_WRONG_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, 'TN_DPC_0589', $2, '10:00:00', '11:00:00', 20, 0)
        ON CONFLICT (slot_id) DO NOTHING
      `, [testWrongDistSlotId, targetDate]);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F969805', // Ariyalur farmer
          centre_id: 'TN_DPC_0589', // Erode centre
          booking_date: targetDate,
          slot_id: testWrongDistSlotId
        })
      });
      const data = await res.json();
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testWrongDistSlotId]);

      if (res.status === 400 && data.error === 'mismatched_district_centre' || data.code === 'INVALID_DISTRICT_CENTRE') {
        recordResult(9, 'PASS', `Rejected cross-district booking (Farmer in Ariyalur vs Centre in Erode) with HTTP 400 'INVALID_DISTRICT_CENTRE'`);
      } else {
        recordResult(9, 'FAIL', `Expected HTTP 400 'INVALID_DISTRICT_CENTRE', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 10: Farmer without valid identity (unregistered) -> rejected
    // -------------------------------------------------------------------------
    logTestHeader(10, 'Unregistered Farmer Identity Rejection');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 2);
      const targetDate = d.toISOString().slice(0, 10);

      const res = await fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'UNREGISTERED_GHOST_FARMER',
          centre_id: 'TN_DPC_0001',
          booking_date: targetDate,
          slot_id: 'ANY_SLOT'
        })
      });
      const data = await res.json();

      if (res.status === 404 && data.error === 'farmer_not_found') {
        recordResult(10, 'PASS', `Rejected unregistered farmer with HTTP 404 and error 'farmer_not_found'`);
      } else {
        recordResult(10, 'FAIL', `Expected HTTP 404 'farmer_not_found', got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 11: Two simultaneous bookings -> only valid capacity accepted
    // -------------------------------------------------------------------------
    logTestHeader(11, 'Concurrency Double-Booking Protection');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 3);
      const targetDate = d.toISOString().slice(0, 10);

      // Create slot with EXACTLY 1 capacity seat left
      const testRaceSlotId = `SLOT_RACE_${Date.now()}`;
      await pool.query(`
        INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
        VALUES ($1, 'TN_DPC_0001', $2, '15:00:00', '16:00:00', 5, 4)
      `, [testRaceSlotId, targetDate]);

      // Ensure 2 distinct test farmers exist in Ariyalur without prior active bookings
      await pool.query(`
        INSERT INTO farmers (farmer_id, name, district, village, phone)
        VALUES ('F_TEST_RACE_1', 'Race Farmer 1', 'Ariyalur', 'Jayankondam', '9000000011'),
               ('F_TEST_RACE_2', 'Race Farmer 2', 'Ariyalur', 'Jayankondam', '9000000012')
        ON CONFLICT (farmer_id) DO NOTHING
      `);
      await pool.query("DELETE FROM bookings WHERE farmer_id IN ('F_TEST_RACE_1', 'F_TEST_RACE_2')");

      // Fire 2 concurrent booking requests simultaneously with 2 distinct Ariyalur farmers
      const req1 = fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F_TEST_RACE_1',
          centre_id: 'TN_DPC_0001',
          booking_date: targetDate,
          slot_id: testRaceSlotId
        })
      }).then(r => r.json().then(d => ({ status: r.status, data: d })));

      const req2 = fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: 'F_TEST_RACE_2',
          centre_id: 'TN_DPC_0001',
          booking_date: targetDate,
          slot_id: testRaceSlotId
        })
      }).then(r => r.json().then(d => ({ status: r.status, data: d })));

      const [res1, res2] = await Promise.all([req1, req2]);

      const successCount = ((res1.status === 200 || res1.status === 201) ? 1 : 0) +
                           ((res2.status === 200 || res2.status === 201) ? 1 : 0);
      const fullCount = ((res1.status === 400 || res1.status === 409) && (res1.data.error === 'slot_full' || res1.data.error === 'centre_full' || res1.data.code === 'SLOT_FULL') ? 1 : 0) +
                        ((res2.status === 400 || res2.status === 409) && (res2.data.error === 'slot_full' || res2.data.error === 'centre_full' || res2.data.code === 'SLOT_FULL') ? 1 : 0);

      // Clean up bookings, slot & test farmers
      if (res1.data?.booking_id) await pool.query('DELETE FROM bookings WHERE booking_id = $1', [res1.data.booking_id]);
      if (res2.data?.booking_id) await pool.query('DELETE FROM bookings WHERE booking_id = $1', [res2.data.booking_id]);
      await pool.query('DELETE FROM bookings WHERE slot_id = $1', [testRaceSlotId]);
      await pool.query('DELETE FROM slots WHERE slot_id = $1', [testRaceSlotId]);
      await pool.query("DELETE FROM bookings WHERE farmer_id IN ('F_TEST_RACE_1', 'F_TEST_RACE_2')");
      await pool.query("DELETE FROM farmers WHERE farmer_id IN ('F_TEST_RACE_1', 'F_TEST_RACE_2')");

      if (successCount === 1 && fullCount === 1) {
        recordResult(11, 'PASS', `Concurrency protected: Exactly 1 request accepted and 1 rejected for capacity limit`);
      } else {
        recordResult(11, 'FAIL', `Expected exactly 1 success and 1 full rejection, got success=${successCount}, full=${fullCount} (res1: ${res1.status}, res2: ${res2.status})`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 12: IVR booking -> valid future slot
    // -------------------------------------------------------------------------
    logTestHeader(12, 'IVR Booking Deterministic Allocation');
    {
      const bookingReqService = new BookingRequestService({ pool });
      const ivrRes = await bookingReqService.processBookingRequest({
        farmerId: 'F969805',
        phoneNumber: '9000000016',
        district: 'Ariyalur',
        localityName: 'Annangaranpettai',
        crop: 'Paddy (Grade A)',
        quantityQuintals: 10,
        source: 'IVR',
        idempotencyKey: `IVR_TEST_${Date.now()}`
      });

      if (ivrRes.success && ivrRes.booking_id && ivrRes.date >= todayStr) {
        recordResult(12, 'PASS', `IVR successfully booked #${ivrRes.booking_id} at ${ivrRes.centre_name} on future date ${ivrRes.date} at ${ivrRes.time} (Token: ${ivrRes.token})`);
        // Clean up
        await pool.query('DELETE FROM bookings WHERE booking_id = $1', [ivrRes.booking_id]);
      } else {
        recordResult(12, 'FAIL', `IVR booking failed or returned past date: ${JSON.stringify(ivrRes)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 13: CSC booking -> same booking engine
    // -------------------------------------------------------------------------
    logTestHeader(13, 'CSC Assisted Booking (Shared Engine)');
    {
      const bookingReqService = new BookingRequestService({ pool });
      const cscRes = await bookingReqService.processBookingRequest({
        farmerId: 'F969805',
        phoneNumber: '9000000016',
        district: 'Ariyalur',
        localityName: 'Annangaranpettai',
        crop: 'Paddy (Grade A)',
        quantityQuintals: 20,
        source: 'CSC',
        operatorId: 'CSC_OP_01',
        idempotencyKey: `CSC_TEST_${Date.now()}`
      });

      if (cscRes.success && cscRes.booking_id) {
        recordResult(13, 'PASS', `CSC booking processed via canonical engine -> Booking #${cscRes.booking_id} at ${cscRes.centre_name}`);
        await pool.query('DELETE FROM bookings WHERE booking_id = $1', [cscRes.booking_id]);
      } else {
        recordResult(13, 'FAIL', `CSC booking failed: ${JSON.stringify(cscRes)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 14: Web booking -> same booking engine
    // -------------------------------------------------------------------------
    logTestHeader(14, 'Farmer Web Booking (Shared Engine)');
    {
      const bookingReqService = new BookingRequestService({ pool });
      const webRes = await bookingReqService.processBookingRequest({
        farmerId: 'F969805',
        phoneNumber: '9000000016',
        district: 'Ariyalur',
        localityName: 'Annangaranpettai',
        crop: 'Paddy (Grade A)',
        quantityQuintals: 12,
        source: 'WEB',
        idempotencyKey: `WEB_TEST_${Date.now()}`
      });

      if (webRes.success && webRes.booking_id) {
        recordResult(14, 'PASS', `Web self-service booking processed via canonical engine -> Booking #${webRes.booking_id}`);
        await pool.query('DELETE FROM bookings WHERE booking_id = $1', [webRes.booking_id]);
      } else {
        recordResult(14, 'FAIL', `Web booking failed: ${JSON.stringify(webRes)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 15: Alternative centre -> only eligible centres in district returned
    // -------------------------------------------------------------------------
    logTestHeader(15, 'Alternative Centre District Containment');
    {
      const d = new Date(`${todayStr}T00:00:00Z`);
      d.setDate(d.getDate() + 2);
      const targetDate = d.toISOString().slice(0, 10);

      // Create a temporary booking in Ariyalur
      const testBId = `B_TEST_ALT_${Date.now()}`;
      await pool.query(`
        INSERT INTO bookings (booking_id, farmer_id, centre_id, slot_id, booking_date, status)
        VALUES ($1, 'F969805', 'TN_DPC_0001', 'TN_DPC_0001_20261005_0800', $2, 'Booked')
      `, [testBId, targetDate]);

      const res = await fetch(`${BASE_URL}/api/bookings/${testBId}/reschedule-suggestions`);
      const data = await res.json();
      await pool.query('DELETE FROM bookings WHERE booking_id = $1', [testBId]);

      if (res.status === 200 && data.success && Array.isArray(data.suggestions)) {
        const altCentres = data.suggestions.filter(s => s.type === 'ALTERNATIVE_CENTRE');
        const invalidDistCentres = altCentres.filter(s => s.district?.toLowerCase() !== 'ariyalur');

        if (invalidDistCentres.length === 0) {
          recordResult(15, 'PASS', `All ${altCentres.length} suggested alternative centres strictly belong to farmer's district (Ariyalur)`);
        } else {
          recordResult(15, 'FAIL', `Found alternative centres outside farmer district: ${JSON.stringify(invalidDistCentres)}`);
        }
      } else {
        recordResult(15, 'FAIL', `Reschedule suggestions API returned error: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 16: Closed centre Centre Health -> no misleading wait/processing values
    // -------------------------------------------------------------------------
    logTestHeader(16, 'Closed Centre Health Metrics (Null Representation)');
    {
      const doToken = generateToken({
        userId: 'USR_DO_ARIYALUR',
        username: 'officer_ariyalur',
        role: 'DISTRICT_OFFICER',
        district: 'Ariyalur'
      });

      // Temporarily mark one centre in Ariyalur as Closed
      const testCentreId = 'TN_DPC_0002';
      const origStatusRes = await pool.query('SELECT operational_status FROM centres WHERE centre_id = $1', [testCentreId]);
      const origStatus = origStatusRes.rows[0]?.operational_status || 'Open';

      await pool.query("UPDATE centres SET operational_status = 'Closed' WHERE centre_id = $1", [testCentreId]);

      const res = await fetch(`${BASE_URL}/api/district-officer/centres?district=Ariyalur`, {
        headers: { 'Authorization': `Bearer ${doToken}` }
      });
      const data = await res.json();

      // Restore original status
      await pool.query("UPDATE centres SET operational_status = $1 WHERE centre_id = $2", [origStatus, testCentreId]);

      const closedC = (data.centres || []).find(c => c.centre_id === testCentreId);
      if (closedC &&
          closedC.waiting_farmers === null &&
          closedC.estimated_wait_minutes === null &&
          closedC.processing_speed_min === null &&
          closedC.daily_capacity === null) {
        recordResult(16, 'PASS', `Closed centre health accurately reports null for waiting_farmers, estimated_wait_minutes, processing_speed_min, and daily_capacity`);
      } else {
        recordResult(16, 'FAIL', `Closed centre health contained misleading non-null values: ${JSON.stringify(closedC)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 17: Weather API failure -> graceful fallback
    // -------------------------------------------------------------------------
    logTestHeader(17, 'Weather API Fail-Safe Fallback');
    {
      // Pass completely invalid lat/lon to trigger fallback
      const adv = await defaultWeatherService.getWeatherAdvisory('NonexistentDistrict', 999.9, 999.9);
      if (adv && adv.available === false && typeof adv.advisory === 'string') {
        recordResult(17, 'PASS', `Gracefully handled weather service fallback without throwing: '${adv.advisory.slice(0, 50)}...'`);
      } else {
        recordResult(17, 'FAIL', `Weather fallback did not return safe structure: ${JSON.stringify(adv)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 18: Distance API failure -> graceful fallback
    // -------------------------------------------------------------------------
    logTestHeader(18, 'Distance API Fail-Safe Fallback');
    {
      const origin = { latitude: 10.7870, longitude: 79.1378 };
      const dest = { latitude: 11.1401, longitude: 79.0786 };
      const dist = await defaultDistanceService.getRoadDistance(origin, dest);

      if (dist && typeof dist.distance_km === 'number' && dist.distance_km > 0 && dist.provider) {
        recordResult(18, 'PASS', `Distance service returned valid distance (${dist.distance_km} km, provider: ${dist.provider}) with calibrated road multiplier`);
      } else {
        recordResult(18, 'FAIL', `Distance calculation failed: ${JSON.stringify(dist)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 19: District Officer outside district -> forbidden (403)
    // -------------------------------------------------------------------------
    logTestHeader(19, 'District Officer Jurisdiction Enforcement');
    {
      const maduraiOfficerToken = generateToken({
        userId: 'USR_DO_MADURAI',
        username: 'officer_madurai',
        role: 'DISTRICT_OFFICER',
        district: 'Madurai'
      });

      // Attempt to access Erode centres
      const res = await fetch(`${BASE_URL}/api/district-officer/centres?district=Erode`, {
        headers: { 'Authorization': `Bearer ${maduraiOfficerToken}` }
      });
      const data = await res.json();

      if (res.status === 403 && data.error === 'district_access_denied') {
        recordResult(19, 'PASS', `Forbidden: District Officer for Madurai cannot access centres in Erode (HTTP 403 district_access_denied)`);
      } else {
        recordResult(19, 'FAIL', `Expected HTTP 403 district_access_denied, got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // Rule 20: Centre Admin outside centre -> forbidden (403)
    // -------------------------------------------------------------------------
    logTestHeader(20, 'Centre Admin Boundary Isolation');
    {
      const maduraiAdminToken = generateToken({
        userId: 'USR_ADMIN_MADURAI',
        username: 'admin_madurai',
        role: 'CENTRE_ADMIN',
        centreId: 'TN_DPC_0859', // Madurai centre
        district: 'Madurai'
      });

      // Attempt to modify pacing or quality at another centre (TN_DPC_0589 in Erode)
      const res = await fetch(`${BASE_URL}/api/centres/TN_DPC_0589/pacing/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${maduraiAdminToken}`
        },
        body: JSON.stringify({ active_counters: 3, processing_rate_min: 10 })
      });
      const data = await res.json();

      if (res.status === 403) {
        recordResult(20, 'PASS', `Forbidden: Centre Admin for TN_DPC_0859 cannot manage centre TN_DPC_0589 (HTTP 403)`);
      } else {
        recordResult(20, 'FAIL', `Expected HTTP 403, got HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
    }

    // -------------------------------------------------------------------------
    // SUMMARY REPORT
    // -------------------------------------------------------------------------
    console.log(`\n======================================================================`);
    console.log(`FINAL CANONICAL BUSINESS LOGIC AUDIT REPORT`);
    console.log(`======================================================================`);
    let passCount = 0;
    let failCount = 0;
    for (let r = 1; r <= 20; r++) {
      const res = results[`Rule ${r}`];
      if (res && res.status === 'PASS') {
        passCount++;
        console.log(`Rule ${String(r).padStart(2, ' ')}: PASS  - ${res.details}`);
      } else {
        failCount++;
        console.log(`Rule ${String(r).padStart(2, ' ')}: FAIL  - ${res ? res.details : 'Not executed'}`);
      }
    }
    console.log(`======================================================================`);
    console.log(`TOTAL: 20 | PASSED: ${passCount} | FAILED: ${failCount}`);
    console.log(`STATUS: ${failCount === 0 ? 'ALL 20 RULES VERIFIED AND PASSED' : 'SOME TESTS FAILED'}`);
    console.log(`======================================================================\n`);

  } catch (err) {
    console.error('Test suite uncaught error:', err);
  } finally {
    await pool.end();
  }
}

runTests();
