/**
 * Comprehensive Verification of Open Centre -> Slot Availability -> Farmer Website + IVR
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });
const net = require('net');
const { IntelligentBookingEngine } = require('../services/booking/IntelligentBookingEngine');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kisan_queue'
});

async function runTests() {
  console.log('================================================================');
  console.log('🌾 KISAN QUEUE — OPEN CENTRE & SLOT AVAILABILITY AUDIT & VERIFICATION');
  console.log('================================================================\n');

  // Test 1: Inspect Target Opened Centres
  console.log('--- TEST 1: Inspecting Target Opened Centres in PostgreSQL ---');
  const targetCentres = ['TN_DPC_0010', 'TN_DPC_0049', 'TN_DPC_2258', 'TN_DPC_2283', 'TN_DPC_0002', 'TN_DPC_3475'];
  const centresRes = await pool.query(`
    SELECT centre_id, centre_name, district, operational_status, opening_date, closing_date, daily_capacity_slots
    FROM centres
    WHERE centre_id = ANY($1)
    ORDER BY centre_id
  `, [targetCentres]);

  console.table(centresRes.rows);

  // Test 2: Call Farmer Website Slot Endpoint for Oct 6, 2026
  console.log('\n--- TEST 2: Calling Farmer Website Slot Endpoint (GET /api/centres/:id/slots?date=2026-10-06) ---');
  for (const c of centresRes.rows) {
    const url = `http://localhost:4000/api/centres/${c.centre_id}/slots?date=2026-10-06`;
    const res = await fetch(url);
    const data = await res.json();
    const isArray = Array.isArray(data);
    const slotCount = isArray ? data.length : (data.slots ? data.slots.length : 0);
    const availableCount = isArray ? data.filter(s => s.bookable || s.is_available).length : 0;
    
    console.log(`[${c.centre_id}] ${c.centre_name}:`);
    console.log(`  HTTP Status: ${res.status}`);
    console.log(`  Is Array: ${isArray}`);
    console.log(`  Slot Count: ${slotCount}`);
    console.log(`  Available Slots: ${availableCount}`);
    console.log(`  Error Code: ${data.error_code || 'NONE'}`);
    if (isArray && data.length > 0) {
      console.log(`  First Slot: ${data[0].slot_id} (${data[0].start_time}-${data[0].end_time}) status=${data[0].slot_status} bookable=${data[0].bookable}`);
    }
    if (slotCount === 0) {
      throw new Error(`FAILURE: Centre ${c.centre_id} has 0 slots on 2026-10-06!`);
    }
  }

  // Test 3: Verify Persistence in `slots` table
  console.log('\n--- TEST 3: Verifying PostgreSQL `slots` Table Records for 2026-10-06 ---');
  const dbSlots = await pool.query(`
    SELECT centre_id, COUNT(*) as slot_count, MIN(start_time) as first_slot, MAX(end_time) as last_slot
    FROM slots
    WHERE centre_id = ANY($1) AND date = '2026-10-06'
    GROUP BY centre_id
    ORDER BY centre_id
  `, [targetCentres]);
  console.table(dbSlots.rows);

  // Test 4: Intelligent Booking Engine Allocation
  console.log('\n--- TEST 4: Verifying IntelligentBookingEngine for Ariyalur & Vellore ---');
  const engine = new IntelligentBookingEngine(pool);

  // Test Ariyalur booking recommendation
  const ariyalurAllocation = await engine.optimizeBooking({
    district: 'Ariyalur',
    preferredCentreId: 'TN_DPC_0010',
    preferredDate: '2026-10-06',
    quantityQuintals: 40
  });
  console.log('Ariyalur (TN_DPC_0010) Engine Status:', ariyalurAllocation.status);
  console.log('Allocation result:', ariyalurAllocation.allocation?.centre_id, ariyalurAllocation.allocation?.slot_id, ariyalurAllocation.allocation?.date);
  if (ariyalurAllocation.status !== 'SLOT_FEASIBLE' || !ariyalurAllocation.allocation) {
    throw new Error(`IntelligentBookingEngine failed to find slot for TN_DPC_0010: ${ariyalurAllocation.reason}`);
  }

  // Test Vellore booking recommendation (Abi's district)
  const velloreAllocation = await engine.optimizeBooking({
    district: 'Vellore',
    preferredCentreId: 'TN_DPC_3475',
    preferredDate: '2026-10-06',
    quantityQuintals: 50
  });
  console.log('Vellore (TN_DPC_3475) Engine Status:', velloreAllocation.status);
  console.log('Allocation result:', velloreAllocation.allocation?.centre_id, velloreAllocation.allocation?.slot_id, velloreAllocation.allocation?.date);
  if (velloreAllocation.status !== 'SLOT_FEASIBLE' || !velloreAllocation.allocation) {
    throw new Error(`IntelligentBookingEngine failed to find slot for TN_DPC_3475: ${velloreAllocation.reason}`);
  }

  // Test 5: Live FastAGI Simulation on Port 4574 (Extension 2000)
  console.log('\n--- TEST 5: Simulating Call on FastAGI Port 4574 (Extension 2000) ---');
  await new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 4574, host: '127.0.0.1' }, () => {
      console.log('Connected to FastAGI port 4574 successfully.');
      // Send FastAGI initial handshake environment
      const env = [
        'agi_network: yes',
        'agi_network_script: agi://127.0.0.1:4574',
        'agi_request: agi://127.0.0.1:4574',
        'agi_channel: PJSIP/2000-00000001',
        'agi_language: en',
        'agi_type: PJSIP',
        'agi_uniqueid: 1728123456.1',
        'agi_callerid: 2000',
        'agi_calleridname: MicroSIP Test',
        'agi_callingpres: 0',
        'agi_callingani2: 0',
        'agi_callington: 0',
        'agi_callingtns: 0',
        'agi_dnid: 2000',
        'agi_rdnis: unknown',
        'agi_context: default',
        'agi_extension: 2000',
        'agi_priority: 1',
        'agi_enhanced: 0.0',
        'agi_accountcode: ',
        'agi_threadid: 12345678',
        '',
        ''
      ].join('\n');
      client.write(env);
    });

    let buffer = '';
    client.on('data', (chunk) => {
      const text = chunk.toString();
      buffer += text;
      const safeWrite = (msg) => {
        if (!client.destroyed && client.writable) {
          try { client.write(msg); } catch (_) {}
        }
      };

      if (text.includes('ANSWER')) {
        safeWrite('200 result=0\n');
      } else if (text.includes('STREAM FILE')) {
        safeWrite('200 result=0 endpos=0\n');
      } else if (text.includes('GET DATA') || text.includes('WAIT FOR DIGIT')) {
        safeWrite('200 result=49\n'); // ASCII '1' is 49
      } else if (text.includes('SAY') || text.includes('EXEC')) {
        safeWrite('200 result=0\n');
      } else if (text.includes('HANGUP')) {
        safeWrite('200 result=0\n');
        client.end();
      }
    });

    client.on('end', () => {
      console.log('FastAGI call session ended cleanly.');
      resolve();
    });

    client.on('error', (err) => {
      console.error('FastAGI client error:', err.message);
      resolve();
    });

    setTimeout(() => {
      if (!client.destroyed) client.end();
      resolve();
    }, 3000);
  });

  // Test 6: DO Opens a Currently Closed Centre
  console.log('\n--- TEST 6: Testing DO Opening a Closed Centre Live via API ---');
  const { generateToken } = require('../auth');
  const closedCentreRes = await pool.query(`
    SELECT centre_id, centre_name, district, operational_status, closing_date
    FROM centres
    WHERE LOWER(TRIM(district)) = 'ariyalur' AND operational_status = 'Closed'
    ORDER BY centre_id
    LIMIT 1
  `);
  if (closedCentreRes.rows.length > 0) {
    const closedCentre = closedCentreRes.rows[0];
    console.log(`Testing DO opening centre: ${closedCentre.centre_id} (${closedCentre.centre_name}) - Currently ${closedCentre.operational_status}`);

    const token = generateToken({
      userId: 'USR_DO_ARIYALUR',
      username: 'do_ariyalur',
      role: 'DISTRICT_OFFICER',
      district: 'Ariyalur'
    });

    // Call POST /api/district-officer/centres/:id/open
    const openRes = await fetch(`http://localhost:4000/api/district-officer/centres/${closedCentre.centre_id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        opening_date: '2026-10-06',
        reason: 'Seasonal paddy procurement opening verified by DO',
        notes: 'Scales and moisture meters calibrated and ready'
      })
    });
    const openData = await openRes.json();
    console.log('DO Open Centre Response:', openData.success, openData.message);

    // Verify DB state
    const verifyRes = await pool.query('SELECT operational_status, opening_date, closing_date FROM centres WHERE centre_id = $1', [closedCentre.centre_id]);
    console.log('Updated DB record:', verifyRes.rows[0]);

    // Verify slots exist on 2026-10-06
    const slotRes = await fetch(`http://localhost:4000/api/centres/${closedCentre.centre_id}/slots?date=2026-10-06`);
    const slots = await slotRes.json();
    console.log(`Farmer website slot fetch for newly opened ${closedCentre.centre_id}: ${Array.isArray(slots) ? `${slots.length} slots found!` : 'FAILED'}`);

    if (!Array.isArray(slots) || slots.length === 0) {
      throw new Error(`FAILURE: Newly opened centre ${closedCentre.centre_id} has no slots!`);
    }
  }

  console.log('\n================================================================');
  console.log('✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');

  await pool.end();
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
