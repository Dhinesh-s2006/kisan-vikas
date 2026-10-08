const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEMO_DISTRICTS = [
  'Vellore',
  'Madurai',
  'Thanjavur',
  'Erode',
  'Salem',
  'Coimbatore',
  'Tiruppur',
  'Cuddalore',
  'Thiruvarur',
  'Thiruchirappalli'
];

const CROPS = [
  { name: 'Paddy', weight: 55, minYield: 1.6, maxYield: 2.0, minProc: 0.75, maxProc: 0.85, typicalDays: 105 },
  { name: 'Maize', weight: 15, minYield: 1.4, maxYield: 1.9, minProc: 0.70, maxProc: 0.80, typicalDays: 100 },
  { name: 'Groundnut', weight: 10, minYield: 0.8, maxYield: 1.2, minProc: 0.65, maxProc: 0.75, typicalDays: 110 },
  { name: 'Cotton', weight: 10, minYield: 0.7, maxYield: 1.0, minProc: 0.60, maxProc: 0.75, typicalDays: 150 },
  { name: 'Sugarcane', weight: 10, minYield: 30.0, maxYield: 38.0, minProc: 0.80, maxProc: 0.90, typicalDays: 360 }
];

const HARVEST_PERIODS = [
  { period: 'October 2026', start: '2026-10-01', end: '2026-10-31', sowingMonth: 6 },
  { period: 'November 2026', start: '2026-11-01', end: '2026-11-30', sowingMonth: 7 },
  { period: 'December 2026', start: '2026-12-01', end: '2026-12-31', sowingMonth: 8 },
  { period: 'January 2027', start: '2027-01-01', end: '2027-01-31', sowingMonth: 9 }
];

function pickCrop(r) {
  let accum = 0;
  for (const c of CROPS) {
    accum += c.weight;
    if (r < accum) return c;
  }
  return CROPS[0];
}

async function seed() {
  const client = await pool.connect();
  try {
    console.log('--- Seeding Predictive Procurement Demand Planning Demo Dataset ---');
    await client.query('BEGIN');

    // 1. Check existing synthetic declarations count
    const existingCountRes = await client.query(`
      SELECT COUNT(*)::int as cnt FROM crop_declarations WHERE id LIKE 'CP-DEMO-%'
    `);
    const existingCount = existingCountRes.rows[0].cnt;
    if (existingCount >= 280) {
      console.log(`Found ${existingCount} existing synthetic crop declarations. Refreshing/retaining intact.`);
      await client.query('COMMIT');
      return;
    }

    // 2. Load existing farmers by district
    const farmersRes = await client.query(`SELECT farmer_id, name, village, district FROM farmers`);
    const districtFarmersMap = new Map();
    farmersRes.rows.forEach(f => {
      const d = f.district || 'Vellore';
      if (!districtFarmersMap.has(d)) districtFarmersMap.set(d, []);
      districtFarmersMap.get(d).push(f);
    });

    // 3. Load open centres by district
    const centresRes = await client.query(`
      SELECT centre_id, centre_name, village_town, district 
      FROM centres 
      WHERE operational_status = 'Open'
    `);
    const districtCentresMap = new Map();
    centresRes.rows.forEach(c => {
      const d = c.district || 'Vellore';
      if (!districtCentresMap.has(d)) districtCentresMap.set(d, []);
      districtCentresMap.get(d).push(c);
    });

    let declarationSeq = 1;
    let extraFarmerSeq = 1;

    for (const district of DEMO_DISTRICTS) {
      // Vellore gets 120 declarations for the master demo scenario, others get ~20
      const quota = (district === 'Vellore') ? 120 : 20;
      console.log(`Seeding ${quota} crop declarations for ${district}...`);

      const availableFarmers = districtFarmersMap.get(district) || [];
      const availableCentres = districtCentresMap.get(district) || [];

      for (let i = 0; i < quota; i++) {
        // Resolve or create farmer
        let farmer;
        if (i < availableFarmers.length) {
          farmer = availableFarmers[i];
        } else {
          // Create synthetic demo farmer if needed
          const extraId = `DEMO_CROP_F_${district.substring(0, 3).toUpperCase()}_${String(extraFarmerSeq++).padStart(4, '0')}`;
          const insertFarmerRes = await client.query(`
            INSERT INTO farmers (farmer_id, name, phone, village, district, land_holding_acres, primary_crop)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (farmer_id) DO UPDATE SET district = EXCLUDED.district
            RETURNING *
          `, [
            extraId,
            `Farmer ${district} ${i + 1}`,
            `9840${String(100000 + declarationSeq).substring(0, 6)}`,
            `Village ${district} ${((i % 5) + 1)}`,
            district,
            2.5,
            'Paddy'
          ]);
          farmer = insertFarmerRes.rows[0];
          availableFarmers.push(farmer);
        }

        // Resolve preferred centre
        const centre = availableCentres.length > 0 ? availableCentres[i % availableCentres.length] : null;

        // Determine crop & period
        const randSeed = (declarationSeq * 17 + i * 31) % 100;
        const cropObj = (district === 'Vellore' && i < 100) ? CROPS[0] : pickCrop(randSeed); // 85% Paddy in Vellore demo
        
        // Harvest period: mostly November in Vellore, distributed in others
        let periodObj;
        if (district === 'Vellore') {
          periodObj = (i < 80) ? HARVEST_PERIODS[1] : HARVEST_PERIODS[i % HARVEST_PERIODS.length]; // November
        } else {
          periodObj = HARVEST_PERIODS[i % HARVEST_PERIODS.length];
        }

        // Area: 1.5 to 3.5 acres
        const area = (district === 'Vellore') ? 2.0 : parseFloat((1.5 + ((declarationSeq % 5) * 0.5)).toFixed(1));
        const prodMin = parseFloat((area * cropObj.minYield).toFixed(2));
        const prodMax = parseFloat((area * cropObj.maxYield).toFixed(2));
        const procMin = parseFloat((prodMin * cropObj.minProc).toFixed(2));
        const procMax = parseFloat((prodMax * cropObj.maxProc).toFixed(2));

        const sowingDate = `2026-0${periodObj.sowingMonth}-15`;
        const planId = `CP-DEMO-${String(declarationSeq).padStart(6, '0')}`;
        const forecastId = `FC-DEMO-${String(declarationSeq).padStart(6, '0')}`;
        const isCSC = (declarationSeq % 3 === 0);

        // Insert crop declaration
        await client.query(`
          INSERT INTO crop_declarations (
            id, farmer_id, crop, cultivated_area, area_unit, sowing_date,
            expected_harvest_start, expected_harvest_end, harvest_period,
            expected_yield_min_mt, expected_yield_max_mt,
            expected_procurement_min_mt, expected_procurement_max_mt,
            irrigation_type, crop_variety, status, created_via, created_by,
            operator_id, district, village, centre_id
          ) VALUES ($1, $2, $3, $4, 'acres', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE', $15, $16, $17, $18, $19, $20)
          ON CONFLICT (id) DO NOTHING
        `, [
          planId,
          farmer.farmer_id,
          cropObj.name,
          area,
          sowingDate,
          periodObj.start,
          periodObj.end,
          periodObj.period,
          prodMin,
          prodMax,
          procMin,
          procMax,
          (declarationSeq % 2 === 0 ? 'Canal' : 'Borewell'),
          `${cropObj.name} Hybrid-${(declarationSeq % 4) + 1}`,
          isCSC ? 'CSC_ASSISTED' : 'FARMER_SELF',
          isCSC ? `csc_operator_${district.toLowerCase()}` : farmer.farmer_id,
          isCSC ? `csc_operator_${district.toLowerCase()}` : null,
          district,
          farmer.village || 'Demo Village',
          centre ? centre.centre_id : null
        ]);

        // Insert initial forecast v1
        await client.query(`
          INSERT INTO production_forecasts (
            forecast_id, crop_declaration_id, forecast_version,
            production_min_mt, production_max_mt,
            procurement_min_mt, procurement_max_mt,
            confidence_level, forecast_method, data_source,
            is_current
          ) VALUES ($1, $2, 1, $3, $4, $5, $6, 'Moderate', 'REFERENCE_YIELD_RANGE', 'DEMO_SYNTHETIC', TRUE)
          ON CONFLICT (forecast_id) DO NOTHING
        `, [
          forecastId,
          planId,
          prodMin,
          prodMax,
          procMin,
          procMax
        ]);

        // For 10 declarations in Vellore, add a version 2 history update to test versioning
        if (district === 'Vellore' && i < 10) {
          const v2ForecastId = `FC-DEMO-${String(declarationSeq).padStart(6, '0')}-V2`;
          await client.query(`
            UPDATE production_forecasts SET is_current = FALSE WHERE forecast_id = $1
          `, [forecastId]);

          await client.query(`
            INSERT INTO production_forecasts (
              forecast_id, crop_declaration_id, forecast_version,
              production_min_mt, production_max_mt,
              procurement_min_mt, procurement_max_mt,
              confidence_level, forecast_method, data_source,
              notes, is_current
            ) VALUES ($1, $2, 2, $3, $4, $5, $6, 'Moderate', 'REFERENCE_YIELD_RANGE', 'DEMO_SYNTHETIC', 'Updated via version 2: Area refinement prior to harvest', TRUE)
            ON CONFLICT (forecast_id) DO NOTHING
          `, [
            v2ForecastId,
            planId,
            parseFloat((prodMin * 0.95).toFixed(2)),
            parseFloat((prodMax * 0.95).toFixed(2)),
            parseFloat((procMin * 0.95).toFixed(2)),
            parseFloat((procMax * 0.95).toFixed(2))
          ]);
        }

        declarationSeq++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Successfully seeded ${declarationSeq - 1} synthetic crop declarations across 10 demo districts.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
