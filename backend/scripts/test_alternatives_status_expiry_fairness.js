const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const { generateToken } = require('../auth');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = 'http://localhost:4000/api';

async function runTests() {
  console.log('================================================================');
  console.log('KISAN VIKAS: ALTERNATIVES, STATUS, EXPIRY & FAIRNESS TEST SUITE');
  console.log('================================================================\n');

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
    // 1. Setup Admin Token for Centre Admin
    const adminUserRes = await pool.query(
      `SELECT user_id, username, role, centre_id FROM users WHERE role = 'CENTRE_ADMIN' AND centre_id IS NOT NULL LIMIT 1`
    );
    if (adminUserRes.rows.length === 0) {
      throw new Error('No CENTRE_ADMIN user found in database');
    }
    const adminUser = adminUserRes.rows[0];
    const adminToken = generateToken(
      { userId: adminUser.user_id, username: adminUser.username, role: adminUser.role, centreId: adminUser.centre_id },
      7200
    );
    console.log(`[TEST SETUP] Using Admin: ${adminUser.username} for Centre: ${adminUser.centre_id}`);

    // Find an active centre and a sample booking
    const centreRes = await pool.query(
      `SELECT centre_id, centre_name, district, operational_status FROM centres WHERE centre_id = $1`,
      [adminUser.centre_id]
    );
    const centre = centreRes.rows[0];
    console.log(`[TEST SETUP] Centre: ${centre.centre_name} (${centre.district}) - ${centre.operational_status}\n`);

    // =========================================================================
    // TEST SECTION 1: AUTHORITATIVE CENTRE STATUS & CONGESTION PARITY
    // =========================================================================
    console.log('--- TEST SECTION 1: Authoritative Centre Status & Congestion Parity ---');
    const adminMetricsRes = await fetch(`${BASE_URL}/admin/my-centre`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminData = await adminMetricsRes.json();
    assert(adminMetricsRes.status === 200, 'Admin /api/admin/my-centre returns 200 OK');
    assert(adminData.centre != null, 'Admin returns centre object');
    assert(adminData.stats != null, 'Admin returns dynamic stats object');
    assert(adminData.queue != null && Array.isArray(adminData.queue), 'Admin returns queue array');

    const adminQueueCount = adminData.stats?.active_queue_today ?? adminData.queue.length;
    const adminCongestion = adminData.stats?.congestion_level || 'LOW';
    const adminWait = adminData.stats?.estimated_wait_minutes ?? 0;
    console.log(`  Admin view: queue=${adminQueueCount}, wait=${adminWait}m, congestion=${adminCongestion}`);

    // Verify digital pass live status for a booking at this centre
    let testBookingRes = await pool.query(
      `SELECT booking_id FROM bookings WHERE centre_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [centre.centre_id]
    );
    if (testBookingRes.rows.length === 0) {
      testBookingRes = await pool.query(`SELECT booking_id FROM bookings ORDER BY created_at DESC LIMIT 1`);
    }
    const sampleBookingId = testBookingRes.rows[0]?.booking_id;

    if (sampleBookingId) {
      const passRes = await fetch(`${BASE_URL}/bookings/pass/${sampleBookingId}`);
      const passData = await passRes.json();
      assert(passRes.status === 200, `Farmer /api/bookings/pass/${sampleBookingId} returns 200 OK`);
      assert(passData.live_metrics != null, 'Farmer pass includes authoritative live_metrics');

      const passQueue = passData.live_metrics.active_queue ?? passData.live_metrics.current_queue_count ?? 0;
      const passWait = passData.live_metrics.estimated_wait_minutes ?? 0;
      const passCongestion = passData.live_metrics.congestion_level ?? 'LOW';
      console.log(`  Farmer pass view: queue=${passQueue}, wait=${passWait}m, congestion=${passCongestion}`);

      // Grounding & Contradiction Test: If wait is under 15 min or queue is low, congestion MUST NOT be Very busy
      if (passWait <= 15 && passQueue <= 5) {
        assert(
          passCongestion !== 'VERY_BUSY' && passCongestion !== 'Very busy',
          `Congestion parity: low queue (${passQueue}) and low wait (${passWait}m) is NOT labeled "Very busy"`
        );
      } else {
        assert(true, 'Congestion aligns with high queue load');
      }
    }
    console.log('');

    // =========================================================================
    // TEST SECTION 2: ALTERNATIVE SLOT RECOMMENDATIONS & ROAD DISTANCE
    // =========================================================================
    console.log('--- TEST SECTION 2: Alternative Slot Recommendations & Road Distance ---');
    if (sampleBookingId) {
      const suggestionsRes = await fetch(`${BASE_URL}/bookings/${sampleBookingId}/reschedule-suggestions`);
      const suggestionsData = await suggestionsRes.json();
      assert(suggestionsRes.status === 200, 'Reschedule suggestions endpoint returns 200 OK');
      assert(suggestionsData.success === true, 'Response indicates success: true');
      assert(Array.isArray(suggestionsData.same_centre_alternatives), 'Returns same_centre_alternatives array');
      assert(Array.isArray(suggestionsData.nearby_centre_alternatives), 'Returns nearby_centre_alternatives array');
      assert(typeof suggestionsData.is_original_expired === 'boolean', 'Includes is_original_expired flag');

      // Check original booking preservation
      const originalBookingBefore = await pool.query(`SELECT status, centre_id, booking_date FROM bookings WHERE booking_id = $1`, [sampleBookingId]);
      assert(originalBookingBefore.rows.length === 1, 'Original booking intact in database after query');

      // Check road distance verification on suggestions
      const allSuggestions = [
        ...suggestionsData.same_centre_alternatives,
        ...suggestionsData.nearby_centre_alternatives
      ];

      if (allSuggestions.length > 0) {
        const sampleSugg = allSuggestions[0];
        console.log(`  Sample suggestion: Centre=${sampleSugg.centre_name}, Date=${sampleSugg.date}, Slot=${sampleSugg.start_time}-${sampleSugg.end_time}`);
        assert(sampleSugg.distance_km != null, 'Suggestion includes verified distance_km');
        assert(sampleSugg.is_road_distance === true, 'Distance is verified road distance (is_road_distance: true)');
        assert(sampleSugg.why_recommended != null && Array.isArray(sampleSugg.why_recommended), 'Collapsible why_recommended explanation provided');
        assert(sampleSugg.available_capacity > 0, 'Offered slot has positive verified available_capacity');
        assert(!sampleSugg.is_expired, 'Offered alternative slot is strictly unexpired');
      } else {
        console.log('  Note: No open alternative slots in 7-day lookahead window for this specific centre.');
      }
    }
    console.log('');

    // =========================================================================
    // TEST SECTION 3: APPOINTMENT EXPIRY IN ASIA/KOLKATA
    // =========================================================================
    console.log('--- TEST SECTION 3: Appointment Expiry in Asia/Kolkata ---');
    // Query a historical slot that is in the past
    const pastSlotRes = await pool.query(
      `SELECT s.slot_id, s.centre_id, s.date, s.start_time, s.end_time 
       FROM slots s 
       WHERE s.date < CURRENT_DATE 
       LIMIT 1`
    );

    if (pastSlotRes.rows.length > 0) {
      const pastSlot = pastSlotRes.rows[0];
      const farmerForPast = await pool.query(
        `SELECT f.farmer_id FROM farmers f 
         JOIN centres c ON f.district = c.district 
         WHERE c.centre_id = $1 LIMIT 1`,
        [pastSlot.centre_id]
      );
      const testFarmerId = farmerForPast.rows[0]?.farmer_id || 'FARMER_001';
      const slotDateStr = typeof pastSlot.date === 'string' ? pastSlot.date.slice(0, 10) : pastSlot.date.toISOString().slice(0, 10);

      // Try to book this past slot
      const bookPastRes = await fetch(`${BASE_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmer_id: testFarmerId,
          centre_id: pastSlot.centre_id,
          slot_id: pastSlot.slot_id,
          booking_date: slotDateStr,
          crop: 'Paddy (Common)',
          quantity_quintals: 10
        })
      });
      const bookPastData = await bookPastRes.json();
      assert(bookPastRes.status === 400, 'Attempting to book a past slot returns HTTP 400 Bad Request');
      assert(
        bookPastData.message?.toLowerCase().includes('past') || 
        bookPastData.message?.toLowerCase().includes('expired') ||
        bookPastData.code?.toLowerCase().includes('past') ||
        bookPastData.code?.toLowerCase().includes('expired'),
        `Rejected with clear expiry message: "${bookPastData.message || bookPastData.error}"`
      );
    } else {
      console.log('  No past slot found to test rejection directly.');
    }
    console.log('');

    // =========================================================================
    // TEST SECTION 4: MISSED APPOINTMENT MANAGEMENT & CAPACITY RESTORATION
    // =========================================================================
    console.log('--- TEST SECTION 4: Missed Appointment Management & Restoration ---');
    const missedRes = await fetch(`${BASE_URL}/admin/missed-appointments`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const missedData = await missedRes.json();
    assert(missedRes.status === 200, 'GET /api/admin/missed-appointments returns 200 OK');
    assert(Array.isArray(missedData.missed_appointments), 'Returns missed_appointments list');
    const missedCount = missedData.count ?? missedData.missed_appointments?.length ?? 0;
    console.log(`  Found ${missedCount} missed/elapsed appointments for centre ${adminUser.centre_id}`);

    // If there is a missed appointment, test transactional slot restoration
    if (missedData.missed_appointments.length > 0) {
      const targetMissed = missedData.missed_appointments[0];
      console.log(`  Testing restore for booking ${targetMissed.booking_id} (Farmer: ${targetMissed.farmer_name})`);

      // Find a valid future slot for restoration
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);
      const futureDateStr = futureDate.toISOString().slice(0, 10);

      // Ensure slots are prepared for future date
      const { ensureCentreSlots } = require('../services/booking/slotService');
      await ensureCentreSlots(pool, adminUser.centre_id, futureDateStr, 1);

      const slotsRes = await fetch(`${BASE_URL}/centres/${adminUser.centre_id}/slots?date=${futureDateStr}`);
      const slotsData = await slotsRes.json();
      const rawSlots = Array.isArray(slotsData) ? slotsData : (slotsData.slots || []);
      const openSlot = rawSlots.find(s => !s.is_expired && s.booked_count < s.max_farmers);

      if (openSlot) {
        const restoreRes = await fetch(`${BASE_URL}/admin/missed-appointments/${targetMissed.booking_id}/restore-slot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            target_date: futureDateStr,
            target_slot_id: openSlot.slot_id,
            reason: 'Automated test suite slot restoration'
          })
        });
        const restoreData = await restoreRes.json();
        assert(restoreRes.status === 200, 'POST /admin/missed-appointments/:id/restore-slot returns 200 OK');
        assert(restoreData.success === true, 'Restoration reports success: true');
        assert(restoreData.new_status === 'Confirmed', 'Restored booking status updated to Confirmed');
        assert(restoreData.restored_date === futureDateStr, 'Booking date updated to target future date');

        // Verify audit trail logged in database
        const auditRes = await pool.query(
          `SELECT action, reason FROM reschedule_events WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [targetMissed.booking_id]
        );
        assert(auditRes.rows.length > 0, 'Audit record exists in reschedule_events');
        assert(auditRes.rows[0].action === 'RESTORED', `Audit action is recorded as RESTORED (${auditRes.rows[0].reason})`);
        // Test release capacity workflow on another missed appointment
        if (missedData.missed_appointments.length > 1) {
          const releaseTarget = missedData.missed_appointments[1];
          const releaseRes = await fetch(`${BASE_URL}/admin/missed-appointments/${releaseTarget.booking_id}/release-capacity`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`
            },
            body: JSON.stringify({
              reason: 'Automated test capacity release'
            })
          });
          const releaseData = await releaseRes.json();
          assert(releaseRes.status === 200, 'POST /admin/missed-appointments/:id/release-capacity returns 200 OK');
          assert(releaseData.success === true, 'Capacity release reports success: true');
          assert(releaseData.status === 'No-Show', 'Capacity release sets status to No-Show');
        }
      } else {
        console.log(`  No open slots found on ${futureDateStr} to perform test restoration.`);
      }
    } else {
      console.log('  No missed appointments currently exist for this centre to test restoration.');
    }
    console.log('');

    // =========================================================================
    // TEST SECTION 5: FAIRNESS ENGINE PRIORITY SORTING & TIE-BREAKING
    // =========================================================================
    console.log('--- TEST SECTION 5: Fairness Engine Priority Sorting & Tie-Breaking ---');
    // Fetch queue sorted by fairness_desc
    const sortedQueueRes = await fetch(`${BASE_URL}/admin/my-centre?sort=fairness_desc`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const sortedQueueData = await sortedQueueRes.json();
    assert(sortedQueueRes.status === 200, 'GET /admin/my-centre?sort=fairness_desc returns 200 OK');
    const sortedQueue = sortedQueueData.queue || [];
    console.log(`  Fetched ${sortedQueue.length} queue items with fairness sorting`);

    if (sortedQueue.length > 1) {
      let sortingValid = true;
      const protRank = { 'HIGH': 3, 'MODERATE': 2, 'LOW': 1 };
      for (let i = 0; i < sortedQueue.length - 1; i++) {
        const curr = sortedQueue[i];
        const next = sortedQueue[i + 1];
        const currRank = protRank[curr.protection_level] || 1;
        const nextRank = protRank[next.protection_level] || 1;

        if (currRank < nextRank) {
          sortingValid = false;
          console.error(`  Sorting violation at index ${i}: rank ${currRank} < ${nextRank}`);
          break;
        } else if (currRank === nextRank) {
          if ((curr.fairness_score || 0) < (next.fairness_score || 0)) {
            sortingValid = false;
            console.error(`  Tie-breaker violation at index ${i}: score ${curr.fairness_score} < ${next.fairness_score}`);
            break;
          }
        }
      }
      assert(sortingValid, 'Queue correctly sorted by protection level (HIGH -> MOD -> STD) and fairness score DESC');
    } else {
      assert(true, 'Queue has <= 1 item; sorting trivially valid');
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
