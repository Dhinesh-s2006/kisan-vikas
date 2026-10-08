require('dotenv').config({ path: 'c:/Users/DHINESH.S/Desktop/kisan-queue/backend/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { IVRService } = require('../services/ivr/ivrService');

async function testCases() {
  const ivr = new IVRService({ pool });

  console.log('=== TEST 6: Existing completed bookings ===');
  const completedFarmers = await pool.query(
    "SELECT DISTINCT farmer_id FROM bookings WHERE status IN ('Payment Completed', 'Procured', 'Cancelled')"
  );
  console.log(`Found ${completedFarmers.rows.length} farmers with completed/cancelled records.`);
  
  for (const row of completedFarmers.rows.slice(0, 3)) {
    const active = await ivr.getActiveBookingForFarmer(row.farmer_id);
    console.log(`Farmer ${row.farmer_id} - Has Active Booking: ${Boolean(active)} (Active ID: ${active?.booking_id || 'none'})`);
  }

  console.log('\n=== TEST 7: Booking Engine Failure / No Feasible Slot ===');
  // Attempting to book in a district with no open centres (e.g. invalid district)
  try {
    const fakeReq = await ivr.bookingRequestService.processBookingRequest({
      farmerId: 'F969805',
      phoneNumber: '9000000016',
      district: 'NonExistentDistrict',
      localityName: 'Nowhere',
      crop: 'Paddy (Grade A)',
      quantityQuintals: 10,
      source: 'IVR'
    });
    console.log('Non-existent district response:', fakeReq);
  } catch (e) {
    console.log('Graceful failure:', e.message);
  }

  console.log('\n=== TEST 8: Database failure simulation ===');
  const deadPool = new Pool({ connectionString: 'postgres://postgres:wrong@localhost:5432/wrongdb' });
  const deadIvr = new IVRService({ pool: deadPool });
  try {
    const failLookup = await deadIvr.getFarmerByPhone('9000000016');
    console.log('Dead pool result:', failLookup);
  } catch (err) {
    console.log('Dead pool caught error properly:', err.message);
  }
  await deadPool.end().catch(() => {});

  console.log('\n=== TEST 12: Concurrent booking protection ===');
  // Run two simultaneous processBookingRequest for a farmer
  // We will pick a fresh registered farmer who has no active booking
  const freshFarmerRes = await pool.query(`
    SELECT f.farmer_id, f.phone, f.district, f.village
    FROM farmers f
    WHERE f.farmer_id NOT IN (
      SELECT farmer_id FROM bookings WHERE status NOT IN ('Procured', 'Payment Completed', 'Cancelled', 'No-Show')
    )
    LIMIT 1
  `);
  
  if (freshFarmerRes.rows.length > 0) {
    const fresh = freshFarmerRes.rows[0];
    console.log(`Testing concurrent booking for fresh farmer ${fresh.farmer_id} (${fresh.phone}, ${fresh.district})`);
    
    const [res1, res2] = await Promise.all([
      ivr.bookingRequestService.processBookingRequest({
        farmerId: fresh.farmer_id,
        phoneNumber: fresh.phone,
        district: fresh.district,
        localityName: fresh.village,
        crop: 'Paddy (Common)',
        quantityQuintals: 10,
        source: 'IVR',
        idempotencyKey: `CONCURRENT-1-${Date.now()}`
      }),
      ivr.bookingRequestService.processBookingRequest({
        farmerId: fresh.farmer_id,
        phoneNumber: fresh.phone,
        district: fresh.district,
        localityName: fresh.village,
        crop: 'Paddy (Common)',
        quantityQuintals: 10,
        source: 'IVR',
        idempotencyKey: `CONCURRENT-2-${Date.now()}`
      })
    ]);

    console.log('Concurrent call 1 result:', res1.success ? `SUCCESS (Booking: #${res1.booking_id})` : `FAILED (${res1.error})`);
    console.log('Concurrent call 2 result:', res2.success ? `SUCCESS (Booking: #${res2.booking_id})` : `FAILED (${res2.error})`);
    
    // Exactly one should succeed, or if duplicate detected, error: ACTIVE_BOOKING_EXISTS
    const successCount = (res1.success ? 1 : 0) + (res2.success ? 1 : 0);
    console.log(`Concurrent success count: ${successCount} (Must be at most 1: ${successCount <= 1})`);
  }

  await pool.end();
}

testCases().catch(console.error);
