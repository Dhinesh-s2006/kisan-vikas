const net = require('net');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: 'postgres://postgres:Dhinesh%402006@localhost:5432/kisan_queue' });

async function testFarmerBooking() {
  const callerId = '9800037035'; // C. Natarajan (DEMO_F_000003)
  console.log(`\n============================================================`);
  console.log(`TEST: LIVE FASTAGI BOOKING CALL FOR REGISTERED FARMER ${callerId}`);
  console.log(`============================================================`);

  const events = [];
  const digits = ['2', '1', '1']; // 2=English, 1=Confirm Identity, 1=Book Visit
  let digitIdx = 0;

  await new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 4574, host: '127.0.0.1' }, () => {
      console.log('[CONNECTED] Connected to FastAGI 4574');
      const handshake = [
        'agi_network: yes',
        'agi_network_script: ivr',
        'agi_request: agi://host.docker.internal:4574/ivr',
        'agi_channel: PJSIP/trunk-000002',
        'agi_language: en',
        'agi_type: PJSIP',
        'agi_uniqueid: ' + Date.now(),
        'agi_version: 20.0.0',
        `agi_callerid: ${callerId}`,
        'agi_calleridname: C. Natarajan',
        'agi_dnid: 2000',
        'agi_context: from-exotel',
        'agi_extension: 2000',
        'agi_priority: 1',
        ''
      ].join('\n') + '\n';
      client.write(handshake);
    });

    client.on('data', (d) => {
      const text = d.toString('utf8');
      for (const line of text.split('\n').filter(Boolean)) {
        if (line.includes('EXEC Verbose')) {
          console.log('[IVR SPOKEN]:', line.trim());
          events.push(line.trim());
        }
        if (line.includes('initial_lang') || line.includes('STREAM FILE') || line.includes('WAIT FOR DIGIT 6000')) {
          if (digitIdx < digits.length) {
            const dig = digits[digitIdx++];
            console.log(`>>> Injecting DTMF: ${dig}`);
            client.write(`200 result=${dig.charCodeAt(0)}\n`);
          } else {
            client.write('200 result=0\n');
          }
        } else if (line.includes('WAIT FOR DIGIT 250')) {
          client.write('200 result=0\n');
        } else {
          client.write('200 result=0\n');
        }
      }
    });

    client.on('close', () => {
      console.log('[DISCONNECTED] Call completed');
      resolve();
    });

    client.on('error', reject);
  });

  // Now verify database booking record
  console.log('\n--- VERIFYING POSTGRESQL DATABASE RECORD ---');
  const dbRes = await pool.query(`
    SELECT b.booking_id, b.farmer_id, b.centre_id, b.booking_date, b.booking_source, b.status, s.start_time, s.end_time, s.date as slot_date
    FROM bookings b
    LEFT JOIN slots s ON b.slot_id = s.slot_id
    WHERE b.farmer_id = 'DEMO_F_000003'
    ORDER BY b.created_at DESC
    LIMIT 1;
  `);

  if (dbRes.rows.length === 0) {
    console.error('FAILED: No booking record found in database for DEMO_F_000003!');
    process.exit(1);
  }

  const booking = dbRes.rows[0];
  console.table([booking]);

  const bookingDateStr = booking.slot_date ? booking.slot_date.toISOString().slice(0, 10) : booking.booking_date.toISOString().slice(0, 10);
  console.log(`Allocated Date: ${bookingDateStr}, Time: ${booking.start_time} - ${booking.end_time}, Status: ${booking.status}`);

  // Verify that the allocated date is NOT expired
  const nowKolkata = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayStr = nowKolkata.toISOString().slice(0, 10);
  console.log(`Current Kolkata Date: ${todayStr}`);

  if (bookingDateStr < todayStr) {
    console.error('CRITICAL FAILURE: Allocated booking date is in the PAST!');
    process.exit(1);
  }

  console.log('SUCCESS: Allocated booking is strictly FUTURE or VALID TODAY!');
  await pool.end();
  process.exit(0);
}

testFarmerBooking().catch(err => {
  console.error('Error during test:', err);
  process.exit(1);
});
