const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { defaultDistanceService } = require('../services/distance/distanceService');

async function test() {
  const fRes = await pool.query("SELECT farmer_id, name, village, district, phone FROM farmers WHERE district ILIKE '%Thanjavur%' OR district ILIKE '%Tiruvarur%' OR district ILIKE '%Nagapattinam%' LIMIT 5");
  console.log('Tamil Nadu farmers:', fRes.rows);

  const locCount = await pool.query('SELECT count(*) FROM localities');
  console.log('Locality count:', locCount.rows[0].count);

  for (const f of fRes.rows) {
    const m = await pool.query(
      'SELECT locality_name, district, latitude, longitude FROM localities WHERE LOWER(district)=LOWER($1) AND (LOWER(locality_name)=LOWER($2) OR locality_name ILIKE $3) LIMIT 1',
      [f.district, f.village, '%' + f.village + '%']
    );
    console.log(`Farmer ${f.name} (${f.village}, ${f.district}) match:`, m.rows[0] || 'No exact locality');
  }

  // Check centres in Thanjavur
  const cRes = await pool.query("SELECT centre_id, centre_name, village_town, district, latitude, longitude, operational_status FROM centres WHERE LOWER(district) = 'thanjavur' LIMIT 5");
  console.log('Thanjavur centres:', cRes.rows);

  // Test road distance between a locality and a centre
  if (cRes.rows.length > 0) {
    const c = cRes.rows[0];
    const farmerLoc = { latitude: 10.7870, longitude: 79.1378 }; // Thanjavur coords
    const cLoc = { latitude: c.latitude, longitude: c.longitude };
    const dist = await defaultDistanceService.getRoadDistance(farmerLoc, cLoc);
    console.log(`Road distance from farmer to ${c.centre_name}:`, dist);
  }

  await pool.end();
}

test().catch(console.error);
