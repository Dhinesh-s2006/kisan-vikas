const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const http = require('http');
const { generateToken } = require('../auth');
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

function makeAuthHeader(farmerId, name = 'Farmer', district = 'Ariyalur') {
  const token = generateToken({
    userId: 'USR_' + farmerId,
    username: farmerId,
    role: 'FARMER',
    farmerId: farmerId,
    district: district,
    fullName: name
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING MULTI-FARMER NOTIFICATION ISOLATION AUDIT');
  console.log('====================================================');

  const farmerA = 'F932193';
  const farmerB = 'F105026';
  const farmerC = 'F_TEST_EMPTY_' + Date.now();

  const headersA = makeAuthHeader(farmerA, 'Lathika');
  const headersB = makeAuthHeader(farmerB, 'Vignesh');
  const headersC = makeAuthHeader(farmerC, 'Test Farmer Empty');

  // Ensure Farmer C exists in the farmers table so FK constraints don't fail if we book
  await pool.query(
    `INSERT INTO farmers (farmer_id, name, phone, district, village)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (farmer_id) DO NOTHING`,
    [farmerC, 'Empty Notifications Farmer', '9876543210', 'Ariyalur', 'Jayankondam']
  );

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // TEST 1: Farmer A initial check
  console.log('\n--- 1. Testing Farmer A (F932193) ---');
  const resA1 = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications/unread-count',
    method: 'GET',
    headers: headersA
  });
  assert(resA1.status === 200, `Farmer A unread count HTTP 200 (Got ${resA1.status})`);
  assert(resA1.data.unread_count === 2, `Farmer A unread count is 2 (Got ${resA1.data.unread_count})`);

  const resA2 = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications',
    method: 'GET',
    headers: headersA
  });
  assert(resA2.status === 200, `Farmer A notifications HTTP 200 (Got ${resA2.status})`);
  assert(Array.isArray(resA2.data.notifications), 'Farmer A notifications is an array');
  assert(resA2.data.notifications.length === 2, `Farmer A has exactly 2 notifications (Got ${resA2.data.notifications.length})`);
  
  // Verify Farmer A does NOT see fake demo notifications or others
  const aHasFakePayment = resA2.data.notifications.some(n => n.title && n.title.includes('Payment Completed'));
  assert(!aHasFakePayment, 'Farmer A has NO fake payment notifications');
  const aHasFakeProcurement = resA2.data.notifications.some(n => n.title && n.title.includes('Procurement Completed'));
  assert(!aHasFakeProcurement, 'Farmer A has NO fake procurement completed notifications');
  const aHasWrongOwner = resA2.data.notifications.some(n => n.farmer_id && n.farmer_id !== farmerA);
  assert(!aHasWrongOwner, 'All notifications for Farmer A belong strictly to Farmer A');

  // TEST 2: Farmer B initial check
  console.log('\n--- 2. Testing Farmer B (F105026) ---');
  const resB1 = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications/unread-count',
    method: 'GET',
    headers: headersB
  });
  assert(resB1.status === 200, `Farmer B unread count HTTP 200 (Got ${resB1.status})`);
  assert(resB1.data.unread_count === 1, `Farmer B unread count is 1 (Got ${resB1.data.unread_count})`);

  const resB2 = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications',
    method: 'GET',
    headers: headersB
  });
  assert(resB2.status === 200, `Farmer B notifications HTTP 200 (Got ${resB2.status})`);
  assert(resB2.data.notifications.length === 1, `Farmer B has exactly 1 notification (Got ${resB2.data.notifications.length})`);
  const bHasWrongOwner = resB2.data.notifications.some(n => n.farmer_id && n.farmer_id !== farmerB);
  assert(!bHasWrongOwner, 'All notifications for Farmer B belong strictly to Farmer B');
  const bHasAnotifs = resB2.data.notifications.some(n => n.farmer_id === farmerA);
  assert(!bHasAnotifs, 'Farmer B cannot see Farmer A notifications');

  // TEST 3: Farmer C (Zero Notifications Account)
  console.log('\n--- 3. Testing Farmer C (Zero Notifications) ---');
  const resC1 = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications/unread-count',
    method: 'GET',
    headers: headersC
  });
  assert(resC1.status === 200, `Farmer C unread count HTTP 200 (Got ${resC1.status})`);
  assert(resC1.data.unread_count === 0, `Farmer C unread count is 0 (Got ${resC1.data.unread_count})`);

  const resC2 = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications',
    method: 'GET',
    headers: headersC
  });
  assert(resC2.status === 200, `Farmer C notifications HTTP 200 (Got ${resC2.status})`);
  assert(resC2.data.notifications.length === 0, `Farmer C has empty notifications list (Got ${resC2.data.notifications.length})`);
  
  // Verify NO fake demo notifications were seeded for Farmer C!
  const dbCheckC = await pool.query('SELECT * FROM notifications WHERE farmer_id = $1', [farmerC]);
  assert(dbCheckC.rows.length === 0, `Database has 0 notifications seeded for Farmer C (Got ${dbCheckC.rows.length})`);

  // TEST 4: Cross-User Mark-All-Read Isolation
  console.log('\n--- 4. Testing Mark All Read Cross-User Isolation ---');
  const resMarkA = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications/read-all',
    method: 'PATCH',
    headers: headersA
  });
  assert(resMarkA.status === 200, `Farmer A mark-all-read HTTP 200 (Got ${resMarkA.status})`);

  // Check Farmer A is now 0 unread
  const resAAfter = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications/unread-count',
    method: 'GET',
    headers: headersA
  });
  assert(resAAfter.data.unread_count === 0, `Farmer A unread count is now 0 (Got ${resAAfter.data.unread_count})`);

  // Check Farmer B is STILL 1 unread!
  const resBAfter = await request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/notifications/unread-count',
    method: 'GET',
    headers: headersB
  });
  assert(resBAfter.data.unread_count === 1, `Farmer B unread count remains 1 unchanged (Got ${resBAfter.data.unread_count})`);

  // Restore Farmer A's read status back to false for future checks
  await pool.query('UPDATE notifications SET is_read = false WHERE farmer_id = $1', [farmerA]);

  // TEST 5: Booking Notification Dynamic Routing Isolation
  console.log('\n--- 5. Testing Dynamic Notification Creation Isolation ---');
  // Pick an active slot with capacity at an operational centre
  const slotRes = await pool.query(`
    SELECT s.*, c.district AS centre_district
    FROM slots s
    JOIN centres c ON s.centre_id = c.centre_id
    WHERE c.operational_status NOT IN ('Closed', 'Retired')
      AND s.booked_count < s.max_farmers
    LIMIT 1
  `);
  if (slotRes.rows.length > 0) {
    const slot = slotRes.rows[0];
    const formattedDate = slot.date instanceof Date ? slot.date.toISOString().slice(0, 10) : String(slot.date).slice(0, 10);
    await pool.query('UPDATE farmers SET district = $1 WHERE farmer_id = $2', [slot.centre_district, farmerC]);

    const bookingRes = await request({
      hostname: 'localhost',
      port: 4000,
      path: '/api/bookings',
      method: 'POST',
      headers: makeAuthHeader(farmerC, 'Test Farmer Empty', slot.centre_district)
    }, {
      farmer_id: farmerC,
      centre_id: slot.centre_id,
      district: slot.centre_district,
      slot_id: slot.slot_id,
      booking_date: formattedDate,
      crop: 'Paddy',
      crop_variety: 'Ponni',
      quantity_quintals: 10,
      transport_mode: 'TRACTOR'
    });

    if (bookingRes.status !== 200 && bookingRes.status !== 201) {
      console.log('Booking failure response:', bookingRes.data);
    }

    assert(bookingRes.status === 200 || bookingRes.status === 201, `Created booking for Farmer C (Got HTTP ${bookingRes.status})`);

    // Verify Farmer C now has 1 notification
    const resCWithBooking = await request({
      hostname: 'localhost',
      port: 4000,
      path: '/api/notifications',
      method: 'GET',
      headers: headersC
    });
    assert(resCWithBooking.data.notifications.length === 1, `Farmer C now has exactly 1 notification (Got ${resCWithBooking.data.notifications.length})`);
    assert(resCWithBooking.data.notifications[0].type === 'BOOKING_CONFIRMED', `Farmer C notification is BOOKING_CONFIRMED`);

    // Verify Farmer B STILL only has 1 notification (not affected)
    const resBCheck = await request({
      hostname: 'localhost',
      port: 4000,
      path: '/api/notifications',
      method: 'GET',
      headers: headersB
    });
    assert(resBCheck.data.notifications.length === 1, `Farmer B still has only 1 notification (Got ${resBCheck.data.notifications.length})`);

    // Clean up test booking and notification
    await pool.query('DELETE FROM notifications WHERE farmer_id = $1', [farmerC]);
    await pool.query('DELETE FROM bookings WHERE farmer_id = $1', [farmerC]);
    await pool.query('DELETE FROM farmers WHERE farmer_id = $1', [farmerC]);
  } else {
    console.log('Skipping slot booking creation (no slots with available capacity)');
  }

  console.log('\n====================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
  await pool.end();
}

runTests().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
