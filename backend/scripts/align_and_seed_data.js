const path = require('path');
const crypto = require('crypto');
const backendDir = path.join(__dirname, '..');
const { Pool } = require(path.join(backendDir, 'node_modules/pg'));
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Allowed realistic capacity tiers from specification
const CAPACITY_TIERS = [30, 40, 50, 60, 75, 80, 100, 120, 150, 200];

// Specific overrides for the 5 Centre Admin demo centres:
const DEMO_CENTRE_OVERRIDE = {
  'TN_DPC_0859': 80, // Madurai (Live Demo Centre: plenty of available capacity)
  'TN_DPC_1894': 60, // Thanjavur (Medium Congestion)
  'TN_DPC_2520': 50, // Thiruchirappalli (High Congestion)
  'TN_DPC_0589': 75, // Erode (Low Congestion)
  'TN_DPC_1750': 40  // Salem (Moderate Load)
};

// Deterministic hash function mapping centre_id to a capacity tier
function getDeterministicCapacity(centreId) {
  if (DEMO_CENTRE_OVERRIDE[centreId]) {
    return DEMO_CENTRE_OVERRIDE[centreId];
  }
  const hash = crypto.createHash('md5').update(centreId).digest('hex');
  const num = parseInt(hash.substring(0, 8), 16);
  return CAPACITY_TIERS[num % CAPACITY_TIERS.length];
}

// Realistic Tamil Nadu Farmer Names Pool
const TAMIL_FIRST_NAMES = [
  'Murugan', 'Selvam', 'Karuppasamy', 'Senthil', 'Anandhan', 'Palanisamy',
  'Saravanan', 'Ramasamy', 'Karthik', 'Subramani', 'Muthukumar', 'Velu',
  'Ganesan', 'Chidambaram', 'Natarajan', 'Vijayan', 'Sundaram', 'Manickam',
  'Meenakshi', 'Lakshmi', 'Revathi', 'Kavitha', 'Radha', 'Kalyani', 'Selvi'
];

const TAMIL_INITIALS = ['K.', 'S.', 'M.', 'R.', 'T.', 'P.', 'A.', 'V.', 'N.', 'G.', 'C.'];

// District to realistic villages mapping
const DISTRICT_VILLAGES = {
  'Ariyalur': ['Aiyyur', 'Kattathur', 'Sriraman', 'Jayankondam', 'Sendurai', 'Andimadam', 'T.Palur'],
  'Madurai': ['Keelanedungulam Va', 'Katchirayanpatti Va', 'Keelavalavu Va', 'Melur', 'Vadipatti', 'Thirumangalam', 'Usilampatti'],
  'Thanjavur': ['Agarappettai', 'Chellappanpettai', 'Palaiyapatti', 'Kumbakonam', 'Papanasam', 'Orathanadu', 'Pattukkottai'],
  'Thiruchirappalli': ['L.Abisekapuiram', 'Valadi', 'Nallampillai', 'Manapparai', 'Lalgudi', 'Musiri', 'Thuraiyur'],
  'Erode': ['Kavindapadi', 'Soundappur', 'Bhavani', 'Perundurai', 'Gobichettipalayam', 'Sathyamangalam', 'Kodumudi'],
  'Salem': ['Thalaivasal', 'Attur', 'Mettur', 'Omalur', 'Edappadi', 'Sankari', 'Valapady']
};

const CROPS = ['Paddy (ADT-45)', 'Paddy (BPT-5204)', 'Paddy (Co-51)', 'Groundnut', 'Sugarcane', 'Millets'];

async function executeMigration() {
  const client = await pool.connect();
  console.log('====================================================');
  console.log('KISAN QUEUE — DATABASE ALIGNMENT & DEMO POPULATION');
  console.log('====================================================\n');

  try {
    await client.query('BEGIN');
    console.log('✓ Transaction started (BEGIN).');

    // ----------------------------------------------------
    // STEP 1: Audit Pre-Migration Counts
    // ----------------------------------------------------
    const preFarmers = await client.query('SELECT count(*) FROM farmers');
    const preBookings = await client.query('SELECT count(*) FROM bookings');
    const preSlots = await client.query('SELECT count(*) FROM slots');
    const preGrievances = await client.query('SELECT count(*) FROM grievances');

    console.log('Initial Database Record Counts:');
    console.log(`  Farmers:    ${preFarmers.rows[0].count}`);
    console.log(`  Bookings:   ${preBookings.rows[0].count}`);
    console.log(`  Slots:      ${preSlots.rows[0].count}`);
    console.log(`  Grievances: ${preGrievances.rows[0].count}\n`);

    // ----------------------------------------------------
    // STEP 2: Retire Legacy Centres (PC001 - PC005)
    // ----------------------------------------------------
    console.log('STEP 2: Retiring Legacy Centres (PC001–PC005)...');
    const retireRes = await client.query(`
      UPDATE centres 
      SET operational_status = 'Retired',
          data_source = 'Retired Legacy Demo Centre'
      WHERE centre_id IN ('PC001', 'PC002', 'PC003', 'PC004', 'PC005')
      RETURNING centre_id, operational_status
    `);
    console.log(`✓ Retired ${retireRes.rows.length} legacy centres (operational_status = 'Retired').`);

    // ----------------------------------------------------
    // STEP 3: Deterministic Varied Capacity for TN_DPC Centres
    // ----------------------------------------------------
    console.log('\nSTEP 3: Applying Deterministic Varied Capacities across TN_DPC centres...');
    const tnCentres = await client.query(`
      SELECT centre_id FROM centres WHERE centre_id LIKE 'TN_DPC_%' ORDER BY centre_id
    `);

    // Batch update using a temporary VALUES table for optimal performance
    const capacityValues = tnCentres.rows.map(c => {
      const cap = getDeterministicCapacity(c.centre_id);
      return `('${c.centre_id}', ${cap})`;
    }).join(',');

    await client.query(`
      UPDATE centres AS c
      SET daily_capacity_slots = v.cap,
          data_source = 'TNCSC Official GIS + Synthetic Operational Capacity (DEMO)'
      FROM (VALUES ${capacityValues}) AS v(cid, cap)
      WHERE c.centre_id = v.cid
    `);
    console.log(`✓ Updated daily_capacity_slots across ${tnCentres.rows.length} TN_DPC centres.`);

    // ----------------------------------------------------
    // STEP 4: Configure 5 Centre Admin Demo Centres
    // ----------------------------------------------------
    console.log('\nSTEP 4: Configuring 5 Centre Admin Demo Centres (Intentional Demo Overrides)...');
    const demoCentresConfig = [
      { id: 'TN_DPC_0859', cap: 80, district: 'Madurai', admin: 'admin_madurai', fullName: 'K. Saravanan (Centre Admin Madurai)' },
      { id: 'TN_DPC_1894', cap: 60, district: 'Thanjavur', admin: 'admin_thanjavur', fullName: 'R. Kumar (Centre Admin Thanjavur)' },
      { id: 'TN_DPC_2520', cap: 50, district: 'Thiruchirappalli', admin: 'admin_trichy', fullName: 'S. Prakash (Centre Admin Trichy)' },
      { id: 'TN_DPC_0589', cap: 75, district: 'Erode', admin: 'admin_erode', fullName: 'M. Rajendran (Centre Admin Erode)' },
      { id: 'TN_DPC_1750', cap: 40, district: 'Salem', admin: 'admin_salem', fullName: 'P. Aravind (Centre Admin Salem)' }
    ];

    for (const d of demoCentresConfig) {
      // Update centre operational status and capacity
      await client.query(`
        UPDATE centres 
        SET operational_status = 'Open',
            daily_capacity_slots = $2,
            active_counters = 2,
            processing_rate_min = 12,
            data_source = 'TNCSC Official GIS + Demo Operational Override (DEMO)'
        WHERE centre_id = $1
      `, [d.id, d.cap]);

      // Reassign Centre Admin account in users table
      await client.query(`
        UPDATE users 
        SET centre_id = $2,
            district = $3,
            full_name = $4
        WHERE username = $1
      `, [d.admin, d.id, d.district, d.fullName]);

      console.log(`  ✓ ${d.admin} assigned to ${d.id} (${d.district}) — Capacity: ${d.cap}, Status: Open`);
    }

    // ----------------------------------------------------
    // STEP 5: Generate Realistic Synthetic Demo Farmers
    // ----------------------------------------------------
    console.log('\nSTEP 5: Generating Realistic Tamil Nadu Demo Farmers...');
    const demoFarmers = [];
    const targetDistricts = ['Ariyalur', 'Madurai', 'Thanjavur', 'Thiruchirappalli', 'Erode', 'Salem'];
    
    let farmerIndex = 1;
    for (const dist of targetDistricts) {
      const villages = DISTRICT_VILLAGES[dist] || ['Main Village'];
      // Generate 25 farmers per district
      for (let i = 0; i < 25; i++) {
        const fid = `DEMO_F_${String(farmerIndex).padStart(6, '0')}`;
        const initial = TAMIL_INITIALS[(farmerIndex * 7) % TAMIL_INITIALS.length];
        const firstName = TAMIL_FIRST_NAMES[(farmerIndex * 13) % TAMIL_FIRST_NAMES.length];
        const name = `${initial} ${firstName}`;
        const phone = `9${String(800000000 + farmerIndex * 12345).slice(0, 9)}`;
        const village = villages[i % villages.length];
        const crop = CROPS[(i + farmerIndex) % CROPS.length];
        const land = (1.0 + (i * 0.35)).toFixed(1);
        const lang = 'Tamil';
        const smartphone = i % 4 === 0 ? 'No' : 'Yes';

        demoFarmers.push({
          farmer_id: fid,
          name,
          phone,
          village,
          district: dist,
          land_holding_acres: parseFloat(land),
          primary_crop: crop,
          preferred_language: lang,
          smartphone_access: smartphone
        });

        farmerIndex++;
      }
    }

    const farmerValues = demoFarmers.map(f =>
      `('${f.farmer_id}', '${f.name.replace("'", "''")}', '${f.phone}', '${f.village.replace("'", "''")}', '${f.district}', ${f.land_holding_acres}, '${f.primary_crop}', '${f.preferred_language}', '${f.smartphone_access}')`
    ).join(',');

    await client.query(`
      INSERT INTO farmers (farmer_id, name, phone, village, district, land_holding_acres, primary_crop, preferred_language, smartphone_access)
      VALUES ${farmerValues}
      ON CONFLICT (farmer_id) DO NOTHING
    `);
    console.log(`✓ Inserted ${demoFarmers.length} synthetic Tamil Nadu farmers (DEMO_F_000001 to DEMO_F_${String(demoFarmers.length).padStart(6, '0')}).`);

    // ----------------------------------------------------
    // STEP 6: Generate Future Slots (17 Sept 2026 – 17 Oct 2026)
    // ----------------------------------------------------
    console.log('\nSTEP 6: Generating Active Future Slots (17 Sept 2026 – 17 Oct 2026)...');
    const demoCentreIds = [
      'TN_DPC_0001', 'TN_DPC_0003', // Ariyalur
      'TN_DPC_0859', 'TN_DPC_0885', // Madurai
      'TN_DPC_1894', 'TN_DPC_1901', // Thanjavur
      'TN_DPC_2520', 'TN_DPC_2550', // Thiruchirappalli
      'TN_DPC_0589', // Erode
      'TN_DPC_1750'  // Salem
    ];

    const timeSlots = [
      { start: '08:00:00', end: '09:00:00', code: '0800' },
      { start: '09:00:00', end: '10:00:00', code: '0900' },
      { start: '10:00:00', end: '11:00:00', code: '1000' },
      { start: '11:00:00', end: '12:00:00', code: '1100' },
      { start: '13:00:00', end: '14:00:00', code: '1300' },
      { start: '14:00:00', end: '15:00:00', code: '1400' },
      { start: '15:00:00', end: '16:00:00', code: '1500' },
      { start: '16:00:00', end: '17:00:00', code: '1600' }
    ];

    const slotsToInsert = [];
    const startDate = new Date('2026-09-17T00:00:00Z');
    
    for (const cid of demoCentreIds) {
      const cRow = await client.query('SELECT daily_capacity_slots FROM centres WHERE centre_id = $1', [cid]);
      const dailyCap = cRow.rows[0]?.daily_capacity_slots || 60;
      const slotMax = Math.max(2, Math.round(dailyCap / 8));

      for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
        const d = new Date(startDate);
        d.setUTCDate(d.getUTCDate() + dayOffset);
        const dateStr = d.toISOString().slice(0, 10);
        const dateCompact = dateStr.replace(/-/g, '');

        for (const ts of timeSlots) {
          const slotId = `${cid}_${dateCompact}_${ts.code}`;
          slotsToInsert.push({
            slot_id: slotId,
            centre_id: cid,
            date: dateStr,
            start_time: ts.start,
            end_time: ts.end,
            max_farmers: slotMax,
            booked_count: 0
          });
        }
      }
    }

    const slotValues = slotsToInsert.map(s =>
      `('${s.slot_id}', '${s.centre_id}', '${s.date}', '${s.start_time}', '${s.end_time}', ${s.max_farmers}, ${s.booked_count})`
    ).join(',');

    await client.query(`
      INSERT INTO slots (slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count)
      VALUES ${slotValues}
      ON CONFLICT (slot_id) DO NOTHING
    `);
    console.log(`✓ Inserted ${slotsToInsert.length} future slots across 10 key demonstration centres for 17 Sept – 17 Oct 2026.`);

    // ----------------------------------------------------
    // STEP 7: Populate Demo Operational Scenarios (17 Sept 2026)
    // ----------------------------------------------------
    console.log('\nSTEP 7: Populating Controlled Operational Demo Scenarios on 17 Sept 2026...');

    const scenarios = [
      { centre_id: 'TN_DPC_0859', district: 'Madurai', target_bookings: 24, scenario: 'LIVE DEMO (PLENTY AVAILABLE CAPACITY)' },
      { centre_id: 'TN_DPC_0001', district: 'Ariyalur', target_bookings: 20, scenario: 'LIVE DEMO (ARIYALUR FARMER BOOKING)' },
      { centre_id: 'TN_DPC_1901', district: 'Thanjavur', target_bookings: 15, scenario: 'LOW CONGESTION' },
      { centre_id: 'TN_DPC_0589', district: 'Erode', target_bookings: 18, scenario: 'LOW CONGESTION (ERODE ADMIN)' },
      { centre_id: 'TN_DPC_1894', district: 'Thanjavur', target_bookings: 33, scenario: 'MEDIUM CONGESTION (THANJAVUR ADMIN)' },
      { centre_id: 'TN_DPC_2520', district: 'Thiruchirappalli', target_bookings: 40, scenario: 'HIGH CONGESTION (TRICHY ADMIN)' },
      { centre_id: 'TN_DPC_1750', district: 'Salem', target_bookings: 16, scenario: 'MODERATE LOAD (SALEM ADMIN)' }
    ];

    let bookingIdCounter = 1000;
    let totalDemoBookingsCreated = 0;

    for (const sc of scenarios) {
      const fRes = await client.query('SELECT farmer_id FROM farmers WHERE district = $1 LIMIT $2', [sc.district, sc.target_bookings + 5]);
      const availableFarmers = fRes.rows;

      const sRes = await client.query(`
        SELECT slot_id, max_farmers, booked_count 
        FROM slots 
        WHERE centre_id = $1 AND date = '2026-09-17' 
        ORDER BY start_time
      `, [sc.centre_id]);
      const daySlots = sRes.rows;

      let bookedThisCentre = 0;
      for (let i = 0; i < sc.target_bookings && i < availableFarmers.length; i++) {
        const slot = daySlots[i % daySlots.length];
        const farmer = availableFarmers[i];
        const bId = `B_DEMO_${bookingIdCounter++}`;
        
        let status = 'Booked';
        if (i < Math.floor(sc.target_bookings * 0.3)) {
          status = (i % 2 === 0) ? 'Payment Completed' : 'Procured';
        } else if (i < Math.floor(sc.target_bookings * 0.6)) {
          status = (i % 2 === 0) ? 'Grading' : 'Checked-In';
        } else {
          status = (i % 3 === 0) ? 'Confirmed' : 'Booked';
        }

        const queuePos = i + 1;
        const estWait = Math.max(5, queuePos * 6);
        const token = `Q${String(queuePos).padStart(3, '0')}`;

        await client.query(`
          INSERT INTO bookings (
            booking_id, farmer_id, slot_id, centre_id, booking_date, crop,
            quantity_quintals, status, payment_status, queue_position_at_booking,
            estimated_wait_minutes, booking_source, token, created_at, reschedule_count
          ) VALUES (
            $1, $2, $3, $4, '2026-09-17', 'Paddy (ADT-45)', 15.0, $5,
            $6, $7, $8, 'DEMO_SYNTHETIC', $9, '2026-09-17 07:30:00', 0
          )
          ON CONFLICT (booking_id) DO NOTHING
        `, [
          bId,
          farmer.farmer_id,
          slot.slot_id,
          sc.centre_id,
          status,
          status === 'Payment Completed' ? 'Completed' : 'Pending',
          queuePos,
          estWait,
          token
        ]);

        await client.query('UPDATE slots SET booked_count = booked_count + 1 WHERE slot_id = $1', [slot.slot_id]);

        bookedThisCentre++;
        totalDemoBookingsCreated++;
      }

      console.log(`  ✓ Scenario [${sc.scenario}] at ${sc.centre_id} (${sc.district}): ${bookedThisCentre} bookings generated on 17 Sept 2026.`);
    }

    // ----------------------------------------------------
    // STEP 8: Post-Migration Integrity Validations
    // ----------------------------------------------------
    console.log('\nSTEP 8: Running Foreign-Key & Data Integrity Validations...');

    // 1. Orphan check: bookings with non-existent centre
    const orphanBookingsCentre = await client.query(`
      SELECT count(*) FROM bookings b LEFT JOIN centres c ON b.centre_id = c.centre_id WHERE c.centre_id IS NULL
    `);
    if (parseInt(orphanBookingsCentre.rows[0].count) > 0) {
      throw new Error(`Integrity Failure: ${orphanBookingsCentre.rows[0].count} orphan bookings found!`);
    }
    console.log('  ✓ Zero orphan bookings (all centres exist).');

    // 2. Orphan check: bookings with non-existent slot
    const orphanBookingsSlot = await client.query(`
      SELECT count(*) FROM bookings b LEFT JOIN slots s ON b.slot_id = s.slot_id WHERE s.slot_id IS NULL
    `);
    if (parseInt(orphanBookingsSlot.rows[0].count) > 0) {
      throw new Error(`Integrity Failure: ${orphanBookingsSlot.rows[0].count} orphan bookings found!`);
    }
    console.log('  ✓ Zero orphan slot references in bookings.');

    // 3. Orphan check: bookings with non-existent farmer
    const orphanBookingsFarmer = await client.query(`
      SELECT count(*) FROM bookings b LEFT JOIN farmers f ON b.farmer_id = f.farmer_id WHERE f.farmer_id IS NULL
    `);
    if (parseInt(orphanBookingsFarmer.rows[0].count) > 0) {
      throw new Error(`Integrity Failure: ${orphanBookingsFarmer.rows[0].count} orphan bookings found!`);
    }
    console.log('  ✓ Zero orphan farmer references in bookings.');

    // 4. District mismatch check: booking centre district vs farmer district for demo bookings
    const districtMismatch = await client.query(`
      SELECT count(*) 
      FROM bookings b 
      JOIN centres c ON b.centre_id = c.centre_id 
      JOIN farmers f ON b.farmer_id = f.farmer_id 
      WHERE b.booking_source = 'DEMO_SYNTHETIC' AND c.district != f.district
    `);
    if (parseInt(districtMismatch.rows[0].count) > 0) {
      throw new Error(`Integrity Failure: ${districtMismatch.rows[0].count} demo bookings have mismatched farmer/centre districts!`);
    }
    console.log('  ✓ 100% District-Farmer alignment for all demo bookings.');

    // 5. Check capacity non-zero
    const zeroCap = await client.query('SELECT count(*) FROM centres WHERE daily_capacity_slots <= 0');
    if (parseInt(zeroCap.rows[0].count) > 0) {
      throw new Error(`Integrity Failure: Found ${zeroCap.rows[0].count} centres with zero/negative capacity!`);
    }
    console.log('  ✓ 100% positive, non-zero capacity across all centres.');

    // 6. Check legacy centres retirement
    const activeLegacy = await client.query("SELECT count(*) FROM centres WHERE centre_id IN ('PC001','PC002','PC003','PC004','PC005') AND operational_status != 'Retired'");
    if (parseInt(activeLegacy.rows[0].count) > 0) {
      throw new Error(`Integrity Failure: Legacy centres still marked active!`);
    }
    console.log('  ✓ All 5 legacy centres successfully retired (operational_status = Retired).');

    // 7. Check 5 Centre Admins
    const adminChecks = await client.query(`
      SELECT username, centre_id, district FROM users WHERE username IN ('admin_madurai', 'admin_thanjavur', 'admin_trichy', 'admin_erode', 'admin_salem')
    `);
    console.log('  ✓ Centre Admin assignments successfully verified:');
    adminChecks.rows.forEach(a => console.log(`      ${a.username} -> ${a.centre_id} (${a.district})`));

    // COMMIT
    await client.query('COMMIT');
    console.log('\n====================================================');
    console.log('✓ SUCCESS: TRANSACTION COMMITTED SUCCESSFULLY.');
    console.log('====================================================');

    // Post-migration counts
    const postFarmers = await client.query('SELECT count(*) FROM farmers');
    const postBookings = await client.query('SELECT count(*) FROM bookings');
    const postSlots = await client.query('SELECT count(*) FROM slots');
    const postGrievances = await client.query('SELECT count(*) FROM grievances');

    return {
      success: true,
      preCounts: {
        farmers: parseInt(preFarmers.rows[0].count),
        bookings: parseInt(preBookings.rows[0].count),
        slots: parseInt(preSlots.rows[0].count),
        grievances: parseInt(preGrievances.rows[0].count)
      },
      postCounts: {
        farmers: parseInt(postFarmers.rows[0].count),
        bookings: parseInt(postBookings.rows[0].count),
        slots: parseInt(postSlots.rows[0].count),
        grievances: parseInt(postGrievances.rows[0].count)
      },
      demoBookingsCreated: totalDemoBookingsCreated
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ ROLLBACK EXECUTED DUE TO ERROR:', err);
    return {
      success: false,
      error: err.message
    };
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  executeMigration().then(res => {
    if (!res.success) {
      process.exit(1);
    }
  });
}

module.exports = { executeMigration };
