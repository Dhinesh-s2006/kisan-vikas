const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { CentreService } = require('../services/centre/centreService');
const { defaultDistanceService } = require('../services/distance/distanceService');
const { ensureCentreSlots } = require('../services/booking/slotService');
const { isSlotExpired, getKolkataNow, normalizeDateStr } = require('../services/booking/slotValidation');

async function recommendCentre({ farmerId, district, dateStr }) {
  const { todayStr } = getKolkataNow();
  const cleanDate = normalizeDateStr(dateStr) || todayStr;

  let farmerCoords = null;
  let targetDistrict = district;

  if (farmerId) {
    const fRes = await pool.query('SELECT farmer_id, name, village, district FROM farmers WHERE farmer_id = $1', [farmerId.trim()]);
    if (fRes.rows.length > 0) {
      const f = fRes.rows[0];
      targetDistrict = f.district || targetDistrict;
      if (f.village && targetDistrict) {
        const locRes = await pool.query(
          'SELECT latitude, longitude FROM localities WHERE LOWER(district) = LOWER($1) AND (LOWER(locality_name) = LOWER($2) OR locality_name ILIKE $3) AND latitude IS NOT NULL LIMIT 1',
          [targetDistrict, f.village, `%${f.village}%`]
        );
        if (locRes.rows.length > 0) {
          farmerCoords = { latitude: Number(locRes.rows[0].latitude), longitude: Number(locRes.rows[0].longitude) };
        }
      }
    }
  }

  const centreService = new CentreService({ pool });
  const operationalCentres = await centreService.getEligibleCentresForDistrict(targetDistrict, { includeClosed: false });

  if (operationalCentres.length === 0) {
    return { success: false, message: 'No operational centres in district.' };
  }

  const candidates = [];

  for (const c of operationalCentres.slice(0, 15)) { // Check top 15 operational centres
    await ensureCentreSlots(pool, c.centre_id, cleanDate, 1);

    const sRes = await pool.query(
      'SELECT slot_id, date, start_time, end_time, max_farmers, booked_count, held_count FROM slots WHERE centre_id = $1 AND date = $2 ORDER BY start_time ASC',
      [c.centre_id, cleanDate]
    );

    const availSlots = sRes.rows.filter(s => {
      const exp = isSlotExpired(cleanDate, s.end_time);
      const isFull = (Number(s.booked_count) + Number(s.held_count || 0)) >= Number(s.max_farmers);
      return !exp.expired && !isFull;
    });

    let distInfo = { distance_km: null, duration_minutes: null, provider: 'UNAVAILABLE', is_estimated: true };
    if (farmerCoords && c.latitude && c.longitude) {
      distInfo = await defaultDistanceService.getRoadDistance(farmerCoords, {
        latitude: Number(c.latitude),
        longitude: Number(c.longitude)
      });
    }

    candidates.push({
      centre_id: c.centre_id,
      centre_name: c.centre_name,
      village_town: c.village_town,
      district: c.district,
      operational_status: c.operational_status,
      has_available_slots: availSlots.length > 0,
      available_slot_count: availSlots.length,
      earliest_available_slot: availSlots[0] || null,
      road_distance_km: distInfo.distance_km,
      duration_minutes: distInfo.duration_minutes,
      provider: distInfo.provider,
      is_estimated: distInfo.is_estimated
    });
  }

  candidates.sort((a, b) => {
    // 1. Has available slots
    if (a.has_available_slots && !b.has_available_slots) return -1;
    if (!a.has_available_slots && b.has_available_slots) return 1;

    // 2. Road distance
    if (a.road_distance_km !== null && b.road_distance_km !== null) {
      if (a.road_distance_km !== b.road_distance_km) return a.road_distance_km - b.road_distance_km;
    } else if (a.road_distance_km !== null) {
      return -1;
    } else if (b.road_distance_km !== null) {
      return 1;
    }

    // 3. Available slot count
    if (b.available_slot_count !== a.available_slot_count) {
      return b.available_slot_count - a.available_slot_count;
    }

    return (a.centre_name || '').localeCompare(b.centre_name || '');
  });

  const top = candidates[0];
  const distLabel = top.road_distance_km !== null ? `${top.road_distance_km} km by road` : null;
  const reason = top.has_available_slots
    ? 'Available slots on your selected date'
    : 'Nearest centre (slots full on this date, check alternate dates)';
  const badgeLabel = 'Recommended · Nearest available';

  return {
    success: true,
    recommended_centre: {
      ...top,
      badge_label: badgeLabel,
      distance_label: distLabel,
      reason
    },
    candidates_count: candidates.length
  };
}

async function run() {
  // Test with farmer DEMO_F_000052 (Chellappanpettai, Thanjavur)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const res = await recommendCentre({
    farmerId: 'DEMO_F_000052',
    district: 'Thanjavur',
    dateStr: tomorrowStr
  });

  console.log('Recommendation result:');
  console.dir(res, { depth: null });

  await pool.end();
}

run().catch(console.error);
