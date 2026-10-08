/**
 * Canonical Centre Recommendation Service for Kisan Vikas
 * Shared single-source-of-truth recommendation engine used by both:
 * 1. Farmer Web Application (GET /api/centres/recommend)
 * 2. Voice IVR Telephony (Extension 2000 FastAGI)
 * 
 * Rules:
 * - Deterministic, shared ranking algorithm:
 *     1. Available non-expired slots on chosen date
 *     2. Shortest road distance (via defaultDistanceService)
 *     3. Available slot count (descending)
 *     4. Alphabetical centre name
 * - Strict district containment (no cross-district recommendations)
 * - Excludes 'Closed' and 'Retired' centres
 * - Real road distance with documented fallback (straight-line distance clearly flagged)
 * - Immediate pre-booking revalidation
 */

const { CentreService } = require('./centreService');
const { defaultDistanceService } = require('../distance/distanceService');
const {
  isSlotExpired,
  isSlotBookable
} = require('../booking/slotValidation');
const { ensureCentreSlots } = require('../booking/slotService');
const {
  getKolkataNow,
  normalizeDateStr
} = require('../common/timeService');

class CentreRecommendationService {
  constructor({ pool }) {
    this.pool = pool;
    this.centreService = new CentreService({ pool });
  }

  /**
   * Resolves a registered farmer's profile, district, and coordinates from localities.
   */
  async resolveFarmerLocation(farmerId) {
    if (!farmerId) return { farmerRecord: null, targetDistrict: null, farmerCoords: null };

    const fRes = await this.pool.query(
      'SELECT farmer_id, name, phone, village, district, block, panchayat, primary_crop FROM farmers WHERE farmer_id = $1',
      [String(farmerId).trim()]
    );

    if (fRes.rows.length === 0) {
      return { farmerRecord: null, targetDistrict: null, farmerCoords: null };
    }

    const farmerRecord = fRes.rows[0];
    const targetDistrict = (farmerRecord.district || '').trim();
    let farmerCoords = null;

    if (farmerRecord.village && targetDistrict) {
      // Resolve coordinates from localities table by village & district
      const locRes = await this.pool.query(
        `SELECT latitude, longitude FROM localities 
         WHERE LOWER(district) = LOWER($1) 
           AND (LOWER(locality_name) = LOWER($2) OR locality_name ILIKE $3)
           AND latitude IS NOT NULL 
         LIMIT 1`,
        [targetDistrict, farmerRecord.village.trim(), `%${farmerRecord.village.trim()}%`]
      );
      if (locRes.rows.length > 0 && locRes.rows[0].latitude != null && locRes.rows[0].longitude != null) {
        farmerCoords = {
          latitude: Number(locRes.rows[0].latitude),
          longitude: Number(locRes.rows[0].longitude)
        };
      }
    }

    return { farmerRecord, targetDistrict, farmerCoords };
  }

  /**
   * Generates canonical procurement centre recommendations and ranked alternatives.
   */
  async getRecommendations({
    district = null,
    date = null,
    farmerId = null,
    farmerCoords = null,
    crop = 'Paddy (Common)',
    quantityQuintals = 10
  } = {}) {
    const { todayStr } = getKolkataNow();
    const cleanDate = normalizeDateStr(date) || todayStr;

    // 1. Resolve farmer profile and registered district
    let targetDistrict = district ? district.trim() : null;
    let resolvedCoords = farmerCoords;
    let farmerRecord = null;

    if (farmerId) {
      const resolved = await this.resolveFarmerLocation(farmerId);
      farmerRecord = resolved.farmerRecord;
      if (farmerRecord) {
        const regDistrict = resolved.targetDistrict;
        if (targetDistrict && regDistrict && targetDistrict.toLowerCase() !== regDistrict.toLowerCase()) {
          const err = new Error(`Validation failed: Farmer ${farmerId} is registered in '${regDistrict}', but requested district is '${targetDistrict}'. Cross-district recommendations are prohibited.`);
          err.code = 'INVALID_DISTRICT_CENTRE';
          err.statusCode = 400;
          throw err;
        }
        targetDistrict = regDistrict || targetDistrict;
        if (!resolvedCoords) {
          resolvedCoords = resolved.farmerCoords;
        }
      }
    }

    if (!targetDistrict) {
      const err = new Error('District is required for centre recommendation.');
      err.code = 'MISSING_DISTRICT';
      err.statusCode = 400;
      throw err;
    }

    // 2. Fetch eligible operational centres (excluding Closed and Retired)
    const operationalCentres = await this.centreService.getEligibleCentresForDistrict(targetDistrict, { includeClosed: false });

    if (operationalCentres.length === 0) {
      const err = new Error(`No active or open procurement centres found in ${targetDistrict}.`);
      err.code = 'NO_OPERATIONAL_CENTRES';
      err.statusCode = 404;
      throw err;
    }

    // 3. For each operational centre, evaluate slot availability and road distance
    const candidates = [];

    for (const c of operationalCentres) {
      // Ensure slots exist for cleanDate if on or after today
      if (cleanDate >= todayStr) {
        await ensureCentreSlots(this.pool, c.centre_id, cleanDate, 1);
      }

      const slotsRes = await this.pool.query(
        `SELECT slot_id, date, start_time, end_time, max_farmers, booked_count, held_count 
         FROM slots 
         WHERE centre_id = $1 AND date = $2 
         ORDER BY start_time ASC`,
        [c.centre_id, cleanDate]
      );

      const availableSlots = slotsRes.rows.filter(s => {
        const exp = isSlotExpired(cleanDate, s.end_time);
        const capacityRemaining = Number(s.max_farmers) - (Number(s.booked_count) + Number(s.held_count || 0));
        return !exp.expired && capacityRemaining > 0;
      });

      let distResult = {
        distance_km: null,
        duration_minutes: null,
        provider: 'UNAVAILABLE',
        is_estimated: true
      };

      if (resolvedCoords && c.latitude != null && c.longitude != null) {
        distResult = await defaultDistanceService.getRoadDistance(resolvedCoords, {
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
        daily_capacity_slots: c.daily_capacity_slots,
        active_counters: c.active_counters,
        has_available_slots: availableSlots.length > 0,
        available_slot_count: availableSlots.length,
        earliest_available_slot: availableSlots[0] || null,
        available_slots: availableSlots,
        road_distance_km: distResult.distance_km,
        duration_minutes: distResult.duration_minutes,
        provider: distResult.provider,
        is_estimated: distResult.is_estimated
      });
    }

    // 4. Rank candidates using canonical tie-breaker hierarchy:
    // Priority 1: Has available slots on selected date
    // Priority 2: Shortest road distance (ascending, nulls last)
    // Priority 3: Available slot count (descending)
    // Priority 4: Centre name alphabetical
    candidates.sort((a, b) => {
      if (a.has_available_slots && !b.has_available_slots) return -1;
      if (!a.has_available_slots && b.has_available_slots) return 1;

      if (a.road_distance_km != null && b.road_distance_km != null) {
        if (a.road_distance_km !== b.road_distance_km) return a.road_distance_km - b.road_distance_km;
      } else if (a.road_distance_km != null) {
        return -1;
      } else if (b.road_distance_km != null) {
        return 1;
      }

      if (b.available_slot_count !== a.available_slot_count) {
        return b.available_slot_count - a.available_slot_count;
      }

      return (a.centre_name || '').localeCompare(b.centre_name || '');
    });

    const top = candidates[0];
    const distLabel = top.road_distance_km != null ? `${top.road_distance_km} km by road` : null;
    const reason = top.has_available_slots
      ? 'Available slots on your selected date'
      : 'Nearest operational centre in your district (slots currently full on this date)';
    const badgeLabel = top.has_available_slots
      ? 'Recommended · Nearest available'
      : 'Nearest operational centre';

    const recommendedCentre = {
      ...top,
      badge_label: badgeLabel,
      distance_label: distLabel,
      reason
    };

    const alternatives = candidates.slice(1);

    return {
      success: true,
      recommended_centre: recommendedCentre,
      alternatives,
      farmer: farmerRecord ? {
        farmer_id: farmerRecord.farmer_id,
        name: farmerRecord.name,
        district: farmerRecord.district,
        village: farmerRecord.village,
        has_coordinates: !!resolvedCoords
      } : null,
      date: cleanDate,
      centres_count: candidates.length,
      all_centres: candidates
    };
  }

  /**
   * Authoritatively revalidates the chosen centre and slot immediately before committing a booking.
   */
  async validateCentreAndSlot({ centreId, slotId, date }) {
    if (!centreId) return { valid: false, reason: 'Centre ID is required.' };
    if (!slotId) return { valid: false, reason: 'Slot ID is required.' };

    const cleanDate = normalizeDateStr(date);
    const centre = await this.centreService.getCentreById(centreId);
    if (!centre) {
      return { valid: false, reason: 'Procurement centre not found.' };
    }

    const opStatus = (centre.operational_status || '').trim();
    if (opStatus.toLowerCase() === 'closed' || opStatus.toLowerCase() === 'retired') {
      return { valid: false, reason: `Procurement centre ${centre.centre_name} is currently ${opStatus}.` };
    }

    const slotRes = await this.pool.query(
      'SELECT slot_id, centre_id, date, start_time, end_time, max_farmers, booked_count, COALESCE(held_count, 0) AS held_count FROM slots WHERE slot_id = $1',
      [slotId]
    );

    if (slotRes.rows.length === 0) {
      return { valid: false, reason: 'Selected slot does not exist.' };
    }

    const slot = slotRes.rows[0];
    const slotDateStr = normalizeDateStr(slot.date);
    if (cleanDate && slotDateStr !== cleanDate) {
      return { valid: false, reason: `Slot date (${slotDateStr}) does not match requested date (${cleanDate}).` };
    }

    const exp = isSlotExpired(slotDateStr, slot.end_time);
    if (exp.expired) {
      return { valid: false, reason: `Slot time (${slot.start_time} - ${slot.end_time}) has already expired.` };
    }

    const remaining = Number(slot.max_farmers) - (Number(slot.booked_count) + Number(slot.held_count));
    if (remaining <= 0) {
      return { valid: false, reason: 'Selected slot is fully booked.' };
    }

    return {
      valid: true,
      centre,
      slot,
      remainingCapacity: remaining
    };
  }
}

module.exports = {
  CentreRecommendationService
};
