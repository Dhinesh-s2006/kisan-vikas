const assert = require('assert');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { generateToken } = require('../auth');
const {
  NOTIFICATION_TYPES,
  PRIORITIES,
  createFarmerNotification,
  getFarmerNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead
} = require('../notificationService');

const API_BASE = 'http://localhost:4000/api';
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME
      }
);

async function api(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('===============================================================');
  console.log('FARMER NOTIFICATION CENTER — COMPREHENSIVE VERIFICATION SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function record(testName, ok, detail = '') {
    if (ok) {
      console.log(`  ✓ PASS: ${testName} ${detail ? '(' + detail + ')' : ''}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} — ${detail}`);
      failed++;
    }
  }

  const testFarmerA = 'FARMER-NOTIF-TEST-A';
  const testFarmerB = 'FARMER-NOTIF-TEST-B';

  const tokenFarmerA = generateToken({
    role: 'FARMER',
    farmerId: testFarmerA,
    farmer_id: testFarmerA,
    username: 'farmer_test_a'
  });

  const tokenFarmerB = generateToken({
    role: 'FARMER',
    farmerId: testFarmerB,
    farmer_id: testFarmerB,
    username: 'farmer_test_b'
  });

  const tokenOfficer = generateToken({
    role: 'DISTRICT_OFFICER',
    district: 'Vellore',
    username: 'officer_test'
  });

  try {
    // -----------------------------------------------------------------
    // TEST 1: Schema Integrity Check
    // -----------------------------------------------------------------
    console.log('[1/7] Testing Database Schema...');
    const tableRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'notifications'
    `);
    const cols = tableRes.rows.map(r => r.column_name);
    const hasRequiredCols = ['notification_id', 'farmer_id', 'notification_type', 'title', 'message', 'action_url', 'is_read', 'action_required', 'created_at']
      .every(c => cols.includes(c));
    record('Notifications Table & Schema Verified', hasRequiredCols, `Columns count: ${cols.length}`);

    // Clean up any stale test notifications for test farmers
    await pool.query('DELETE FROM notifications WHERE farmer_id IN ($1, $2)', [testFarmerA, testFarmerB]);
    await pool.query(`
      INSERT INTO farmers (farmer_id, name, district, phone)
      VALUES ($1, 'Test Farmer A', 'Vellore', '9999999991')
      ON CONFLICT (farmer_id) DO NOTHING
    `, [testFarmerA]);

    // -----------------------------------------------------------------
    // TEST 2: Endpoint Authentication & Access Control
    // -----------------------------------------------------------------
    console.log('\n[2/7] Testing Auth & RBAC Security Boundaries...');
    const noAuthRes = await api('GET', '/notifications');
    record('Unauthenticated GET /api/notifications rejected', noAuthRes.status === 401, `Status: ${noAuthRes.status}`);

    const officerRes = await api('GET', '/notifications', null, tokenOfficer);
    record('Non-Farmer Role rejected from farmer notifications', officerRes.status === 403, `Status: ${officerRes.status}`);

    const farmerRes = await api('GET', '/notifications', null, tokenFarmerA);
    record('Authenticated Farmer Allowed', farmerRes.status === 200, `Status: ${farmerRes.status}`);

    // -----------------------------------------------------------------
    // TEST 3: Creation & Service Helpers
    // -----------------------------------------------------------------
    console.log('\n[3/7] Testing Notification Creation & Querying...');
    const notif1 = await createFarmerNotification(pool, {
      farmer_id: testFarmerA,
      type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: 'Booking Confirmed Test',
      message: 'Your slot booking has been confirmed.',
      link: '/farmer/status',
      entity_type: 'BOOKING',
      entity_id: 'BK-TEST-1',
      action_required: false
    });
    record('createFarmerNotification executed successfully', !!notif1?.id, `ID: ${notif1?.id}`);

    const notif2 = await createFarmerNotification(pool, {
      farmer_id: testFarmerA,
      type: NOTIFICATION_TYPES.GRIEVANCE_CONFIRMATION,
      title: 'Action Required: Grievance Resolution',
      message: 'Officer proposed resolution. Please confirm.',
      link: '/farmer/grievance',
      entity_type: 'GRIEVANCE',
      entity_id: 'GR-TEST-1',
      action_required: true,
      priority: PRIORITIES.URGENT
    });
    record('Action Required Notification created', notif2?.action_required === true, `Action required: ${notif2?.action_required}`);

    // -----------------------------------------------------------------
    // TEST 4: REST API Endpoints & Filtering
    // -----------------------------------------------------------------
    console.log('\n[4/7] Testing REST API Endpoints & Filter Queries...');
    const unreadCountRes = await api('GET', '/notifications/unread-count', null, tokenFarmerA);
    record('GET /api/notifications/unread-count returns 2', unreadCountRes.data?.unread_count === 2, `Count: ${unreadCountRes.data?.unread_count}`);

    const listAllRes = await api('GET', '/notifications', null, tokenFarmerA);
    record('GET /api/notifications returns list', listAllRes.data?.notifications?.length === 2, `Received ${listAllRes.data?.notifications?.length} items`);

    const filterActionRes = await api('GET', '/notifications?action_required_only=true', null, tokenFarmerA);
    record('GET /api/notifications?action_required_only=true', filterActionRes.data?.notifications?.length === 1 && filterActionRes.data?.notifications[0].action_required === true, `Count: ${filterActionRes.data?.notifications?.length}`);

    // -----------------------------------------------------------------
    // TEST 5: Mark as Read & IDOR Protection
    // -----------------------------------------------------------------
    console.log('\n[5/7] Testing Mark As Read & Anti-IDOR Authorization...');
    // IDOR test: Farmer B tries to mark Farmer A's notification as read
    const idorRes = await api('PATCH', `/notifications/${notif1.id}/read`, {}, tokenFarmerB);
    record('Farmer B cannot mark Farmer A notification read (IDOR blocked)', idorRes.status === 404 || idorRes.status === 403, `Status: ${idorRes.status}`);

    // Farmer A marks notif1 as read
    const mark1Res = await api('PATCH', `/notifications/${notif1.id}/read`, {}, tokenFarmerA);
    record('Farmer A marks own notification as read', mark1Res.status === 200 && mark1Res.data?.success === true, `Status: ${mark1Res.status}`);

    const unreadAfter1 = await api('GET', '/notifications/unread-count', null, tokenFarmerA);
    record('Unread count decremented to 1', unreadAfter1.data?.unread_count === 1, `Count: ${unreadAfter1.data?.unread_count}`);

    // Mark all as read
    const markAllRes = await api('PATCH', '/notifications/read-all', {}, tokenFarmerA);
    record('PATCH /api/notifications/read-all marks all read', markAllRes.status === 200 && (markAllRes.data?.updated_count >= 1 || markAllRes.data?.success === true), `Updated: ${markAllRes.data?.updated_count}`);

    const unreadAfterAll = await api('GET', '/notifications/unread-count', null, tokenFarmerA);
    record('Unread count is now 0', unreadAfterAll.data?.unread_count === 0, `Count: ${unreadAfterAll.data?.unread_count}`);

    // -----------------------------------------------------------------
    // TEST 6: Idempotency Protection against duplicate spam
    // -----------------------------------------------------------------
    console.log('\n[6/7] Testing Idempotency & Deduplication...');
    const duplicateA = await createFarmerNotification(pool, {
      farmer_id: testFarmerA,
      type: NOTIFICATION_TYPES.PACING_ADVISORY,
      title: 'Pacing Advisory',
      message: 'Queue pacing adjusted for today.',
      link: '/farmer/status',
      entity_type: 'PACING',
      entity_id: 'PACE-TEST-1'
    });
    const duplicateB = await createFarmerNotification(pool, {
      farmer_id: testFarmerA,
      type: NOTIFICATION_TYPES.PACING_ADVISORY,
      title: 'Pacing Advisory',
      message: 'Queue pacing adjusted for today.',
      link: '/farmer/status',
      entity_type: 'PACING',
      entity_id: 'PACE-TEST-1'
    });
    record('Idempotency prevents duplicate notification within window', duplicateA.id === duplicateB.id, `ID A: ${duplicateA.id}, ID B: ${duplicateB.id}`);

    // -----------------------------------------------------------------
    // TEST 7: Farmer Isolation (No Cross-Farmer Leakage)
    // -----------------------------------------------------------------
    console.log('\n[7/8] Testing Farmer Data Isolation...');
    const farmerBList = await api('GET', '/notifications', null, tokenFarmerB);
    record('Farmer B sees 0 notifications from Farmer A', farmerBList.data?.notifications?.length === 0, `Farmer B count: ${farmerBList.data?.notifications?.length}`);

    // -----------------------------------------------------------------
    // TEST 8: Real Event Trigger Pipeline (Grievance Resolution -> Notification)
    // -----------------------------------------------------------------
    console.log('\n[8/8] Testing Live Event Trigger Pipeline...');
    const testGrievanceId = `GR-NOTIF-${Date.now().toString().slice(-6)}`;
    await pool.query(`
      INSERT INTO grievances (grievance_id, farmer_id, centre_id, issue_type, description, status, sla_deadline, created_at)
      VALUES ($1, $2, 'TN_DPC_0859', 'QUEUE_DELAY', 'Test delay grievance', 'UNDER_INVESTIGATION', NOW() + INTERVAL '24 hours', NOW())
    `, [testGrievanceId, testFarmerA]);

    const resolveRes = await api('PATCH', `/grievances/${testGrievanceId}/resolve`, {
      resolution_notes: 'Issue verified and resolved at centre'
    });
    record('Officer resolves grievance via PATCH /api/grievances/:id/resolve', resolveRes.status === 200, `Status: ${resolveRes.status}`);

    // Verify notification was created for Farmer A
    const triggerNotifs = await api('GET', '/notifications?action_required_only=true', null, tokenFarmerA);
    const grNotif = triggerNotifs.data?.notifications?.find(n => n.related_grievance_id === testGrievanceId);
    record('GRIEVANCE_CONFIRMATION notification automatically generated', !!grNotif, `Notification ID: ${grNotif?.id}`);
    record('Triggered notification has action_required = true', grNotif?.action_required === true, `Action required: ${grNotif?.action_required}`);
    record('Triggered notification points to /farmer/grievance', grNotif?.link === '/farmer/grievance', `Link: ${grNotif?.link}`);

    // Cleanup test grievance
    await pool.query('DELETE FROM grievance_history WHERE grievance_id = $1', [testGrievanceId]);
    await pool.query('DELETE FROM grievances WHERE grievance_id = $1', [testGrievanceId]);

  } catch (err) {
    console.error('Test execution failed with error:', err);
    failed++;
  } finally {
    // Cleanup test notifications
    try {
      await pool.query('DELETE FROM notifications WHERE farmer_id IN ($1, $2)', [testFarmerA, testFarmerB]);
      await pool.query('DELETE FROM farmers WHERE farmer_id = $1', [testFarmerA]);
    } catch (e) {
      console.error('Cleanup error:', e);
    }
    await pool.end();
  }

  console.log('\n===============================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
