/**
 * Intelligent Booking Engine for Kisan Vikas
 * Deterministic, backend-controlled procurement centre and slot allocation engine.
 * 
 * CORE RULES:
 * 1. ZERO LLM in allocation: all assignment decisions are mathematical and deterministic.
 * 2. Multicriteria scoring using configurable weights (Distance, Availability, Queue, Speed, Storage).
 * 3. Concurrency-safe slot hold with expiration and row-level locking.
 * 4. Strict tenant isolation (farmer district containment).
 * 5. Expired-slot protection (Asia/Kolkata timezone).
 * 6. Multi-day window lookahead: searches within configured BOOKING_LOOKAHEAD_DAYS window
 *    if no specific preferred date is given or today's slots have passed.
 * 7. Fail-safe: Returns NO_FEASIBLE_SLOT if no eligible slot exists across the window.
 */

const { defaultDistanceService, haversineDistanceKm } = require('../distance/distanceService');
const { defaultCongestionService } = require('../congestion/congestionService');
const {
  isSlotExpired,
  isSlotBookable
} = require('./slotValidation');
const {
  getKolkataNow,
  normalizeDateStr,
  getValidBookingDates,
  isPastDate,
  BOOKING_LOOKAHEAD_DAYS
} = require('../common/timeService');
const { ensureCentreSlots } = require('./slotService');

const DEFAULT_WEIGHTS = {
  distance: 0.30,           // 30% - Proximity
  slotAvailability: 0.25,   // 25% - Open capacity
  queuePressure: 0.20,      // 20% - Low queue congestion
  processingSpeed: 0.15,    // 15% - Turnaround speed
  storageCapacity: 0.10     // 10% - Storage safety headroom
};

class IntelligentBookingEngine {
  constructor(optionsOrPool = {}) {
    if (optionsOrPool && typeof optionsOrPool.query === 'function') {
      this.pool = optionsOrPool;
      this.weights = { ...DEFAULT_WEIGHTS };
      this.lookaheadDays = BOOKING_LOOKAHEAD_DAYS;
    } else {
      const { pool, weights = DEFAULT_WEIGHTS, lookaheadDays = BOOKING_LOOKAHEAD_DAYS } = optionsOrPool;
      this.pool = pool;
      this.weights = { ...DEFAULT_WEIGHTS, ...weights };
      this.lookaheadDays = lookaheadDays;
    }
  }

  /**
   * Find and rank candidate procurement centres and allocate optimal slot.
   */
  async optimizeBooking({
    district,
    farmerLocation = null, // { latitude, longitude, locality_name }
    preferredDate = null,  // 'YYYY-MM-DD' or null
    preferredCentreId = null,
    quantityQuintals = 10,
    crop = 'Paddy (Common)'
  }) {
    if (!district) {
      throw new Error('District is required for booking optimization.');
    }

    const { todayStr } = getKolkataNow();
    const cleanDistrict = district.trim();

    // 1. Strict past-date rejection
    if (preferredDate) {
      const targetDate = normalizeDateStr(preferredDate);
      if (targetDate < todayStr) {
        return {
          status: 'NO_FEASIBLE_SLOT',
          error_code: 'PAST_DATE',
          reason: `Cannot book procurement slots for a past date (${targetDate}). Please select an upcoming date.`,
          allocation: null,
          target_date: targetDate,
          candidates: []
        };
      }
    }

    // Determine candidate dates to evaluate
    const candidateDates = preferredDate
      ? [{ dateStr: normalizeDateStr(preferredDate), label: preferredDate }]
      : getValidBookingDates(this.lookaheadDays);

    // 2. Fetch eligible centres in the district (strictly excluding Closed and Retired centres)
    let centresQuery = `
      SELECT c.centre_id, c.centre_name, c.district, c.village_town,
             c.latitude, c.longitude, c.daily_capacity_slots,
             COALESCE(c.storage_capacity_mt, 500) AS storage_capacity_mt,
             COALESCE(c.current_stock_mt, 0) AS current_stock_mt,
             COALESCE(c.processing_rate_min, 12) AS processing_rate_min,
             COALESCE(c.active_counters, 2) AS active_counters,
             c.operational_status
      FROM centres c
      WHERE LOWER(TRIM(c.district)) = LOWER($1)
        AND LOWER(TRIM(c.operational_status)) NOT IN ('closed', 'retired', 'inactive')
        AND c.operational_status IS NOT NULL
    `;
    const queryParams = [cleanDistrict];
    if (preferredCentreId) {
      centresQuery += ` AND c.centre_id = $2`;
      queryParams.push(preferredCentreId);
    }
    centresQuery += ` ORDER BY c.centre_name ASC`;

    const centresRes = await this.pool.query(centresQuery, queryParams);

    const candidateCentres = centresRes.rows;
    if (candidateCentres.length === 0) {
      return {
        status: 'NO_FEASIBLE_CENTRE',
        error_code: 'NO_ACTIVE_CENTRES',
        reason: `No active or operational procurement centres found in ${district}.`,
        allocation: null,
        candidates: []
      };
    }

    const centreIds = candidateCentres.map(c => c.centre_id);
    const farmerLat = farmerLocation?.latitude ? Number(farmerLocation.latitude) : null;
    const farmerLon = farmerLocation?.longitude ? Number(farmerLocation.longitude) : null;

    // Search across candidate dates (preferring the earliest feasible date)
    for (const dateObj of candidateDates) {
      const targetDate = dateObj.dateStr;

      // Ensure valid slots exist for all candidate centres on targetDate
      await Promise.all(candidateCentres.map(c => ensureCentreSlots(this.pool, c.centre_id, targetDate, 1)));

      // Fetch open slots for all eligible centres on this targetDate
      const slotsRes = await this.pool.query(`
        SELECT slot_id, centre_id, date, start_time, end_time, max_farmers,
               booked_count, COALESCE(held_count, 0) AS held_count
        FROM slots
        WHERE centre_id = ANY($1)
          AND date = $2
          AND (booked_count + COALESCE(held_count, 0)) < max_farmers
        ORDER BY start_time ASC
      `, [centreIds, targetDate]);

      // Fetch active queue count per centre for targetDate
      const queueRes = await this.pool.query(`
        SELECT centre_id, COUNT(*) AS active_count
        FROM bookings
        WHERE centre_id = ANY($1)
          AND booking_date = $2
          AND status IN ('Confirmed', 'On The Way', 'Checked-In')
        GROUP BY centre_id
      `, [centreIds, targetDate]);

      const queueMap = {};
      for (const q of queueRes.rows) {
        queueMap[q.centre_id] = Number(q.active_count);
      }

      const slotsByCentre = {};
      for (const s of slotsRes.rows) {
        // Exclude expired slots (Kolkata timezone: past date or current time >= end_time)
        const slotExp = isSlotExpired(s.date, s.end_time);
        if (slotExp.expired) {
          continue;
        }
        if (!slotsByCentre[s.centre_id]) slotsByCentre[s.centre_id] = [];
        slotsByCentre[s.centre_id].push(s);
      }

      // Score centres that have open, non-expired slots on this date
      const scoredCentres = [];

      for (const centre of candidateCentres) {
        const openSlots = slotsByCentre[centre.centre_id] || [];
        const hasSlots = openSlots.length > 0;
        const queueCount = queueMap[centre.centre_id] || 0;

        // Metric A: Distance & Proximity
        let straightLineKm = null;
        let roadDistanceKm = null;
        let distanceScore = 50; // Neutral default

        if (farmerLat && farmerLon && centre.latitude && centre.longitude) {
          straightLineKm = haversineDistanceKm(farmerLat, farmerLon, centre.latitude, centre.longitude);
          // Road distance calculation via DistanceService
          const roadInfo = await defaultDistanceService.getRoadDistance(
            { latitude: farmerLat, longitude: farmerLon },
            { latitude: centre.latitude, longitude: centre.longitude }
          );
          roadDistanceKm = roadInfo.distance_km;
          distanceScore = Math.max(0, Math.min(100, Math.round(100 - (roadDistanceKm * 2))));
        }

        // Metric B: Slot Availability
        const totalOpenCapacity = openSlots.reduce((acc, s) => acc + (s.max_farmers - s.booked_count - s.held_count), 0);
        const slotScore = hasSlots ? Math.min(100, totalOpenCapacity * 10) : 0;

        // Metric C: Queue Pressure & Congestion
        const congestion = defaultCongestionService.calculateCongestion({
          operationalStatus: centre.operational_status,
          dailyCapacity: centre.daily_capacity_slots,
          activeQueueCount: queueCount,
          activeCounters: centre.active_counters,
          processingRateMin: centre.processing_rate_min
        });
        const queueScore = Math.max(0, 100 - (queueCount * 3));

        // Metric D: Processing Speed
        const counters = Number(centre.active_counters || 2);
        const rateMin = Number(centre.processing_rate_min || 12);
        const farmersPerHour = (60 / rateMin) * counters;
        const speedScore = Math.min(100, Math.round(farmersPerHour * 10));

        // Metric E: Storage Safety
        const capMt = Number(centre.storage_capacity_mt || 500);
        const stockMt = Number(centre.current_stock_mt || 0);
        const occupancyPct = capMt > 0 ? (stockMt / capMt) * 100 : 50;
        const storageScore = Math.max(0, Math.round(100 - occupancyPct));

        const totalScore = Number((
          (distanceScore * this.weights.distance) +
          (slotScore * this.weights.slotAvailability) +
          (queueScore * this.weights.queuePressure) +
          (speedScore * this.weights.processingSpeed) +
          (storageScore * this.weights.storageCapacity)
        ).toFixed(2));

        scoredCentres.push({
          centre_id: centre.centre_id,
          centre_name: centre.centre_name,
          village_town: centre.village_town,
          district: centre.district,
          distance_km: roadDistanceKm != null ? roadDistanceKm : straightLineKm,
          straight_line_km: straightLineKm,
          total_score: hasSlots ? totalScore : -1,
          open_slots_count: openSlots.length,
          total_open_capacity: totalOpenCapacity,
          active_queue: queueCount,
          congestion_level: congestion.congestion_level,
          estimated_wait_minutes: congestion.estimated_wait_minutes,
          breakdown: {
            distanceScore,
            slotScore,
            queueScore,
            speedScore,
            storageScore
          },
          open_slots: openSlots
        });
      }

      // Sort descending by total score
      scoredCentres.sort((a, b) => b.total_score - a.total_score);

      const viable = scoredCentres.filter(c => c.total_score > 0 && c.open_slots_count > 0);

      if (viable.length > 0) {
        const optimalCentre = viable[0];
        const bestSlot = optimalCentre.open_slots[0];
        const slotDateStr = bestSlot.date ? normalizeDateStr(bestSlot.date) : targetDate;

        return {
          status: 'SLOT_FEASIBLE',
          target_date: slotDateStr,
          allocation: {
            centre_id: optimalCentre.centre_id,
            centre_name: optimalCentre.centre_name,
            village_town: optimalCentre.village_town,
            district: optimalCentre.district,
            distance_km: optimalCentre.distance_km,
            straight_line_km: optimalCentre.straight_line_km,
            slot_id: bestSlot.slot_id,
            slot_date: slotDateStr,
            start_time: bestSlot.start_time,
            end_time: bestSlot.end_time,
            total_score: optimalCentre.total_score,
            congestion_level: optimalCentre.congestion_level,
            estimated_wait_minutes: optimalCentre.estimated_wait_minutes,
            optimization_reason: {
              distance_km: optimalCentre.distance_km,
              active_queue: optimalCentre.active_queue,
              open_slots: optimalCentre.open_slots_count,
              congestion_level: optimalCentre.congestion_level,
              scores: optimalCentre.breakdown
            }
          },
          candidates: viable.slice(0, 5)
        };
      }
      // If preferredDate was specified and had no slots, don't continue to other dates
      if (preferredDate) {
        break;
      }
    }

    return {
      status: 'NO_FEASIBLE_SLOT',
      error_code: 'NO_FEASIBLE_SLOT',
      reason: preferredDate
        ? `All procurement centres in ${district} are fully booked or have no available slots for ${preferredDate}.`
        : `No feasible upcoming procurement slots found in ${district} within the ${this.lookaheadDays}-day booking window.`,
      allocation: null,
      target_date: preferredDate || todayStr,
      candidates: []
    };
  }

  /**
   * Concurrency-safe slot hold with expiration using row locking.
   */
  async holdSlot(client, slotId, holdDurationMs = 120000) {
    const res = await client.query(`
      SELECT slot_id, centre_id, date, start_time, end_time, max_farmers,
             booked_count, COALESCE(held_count, 0) AS held_count
      FROM slots
      WHERE slot_id = $1
      FOR UPDATE
    `, [slotId]);

    if (res.rows.length === 0) {
      return { success: false, reason: 'SLOT_NOT_FOUND' };
    }

    const slot = res.rows[0];
    const { bookable, reason } = isSlotBookable(slot);

    if (!bookable) {
      return { success: false, reason };
    }

    await client.query(`
      UPDATE slots
      SET held_count = COALESCE(held_count, 0) + 1
      WHERE slot_id = $1
    `, [slotId]);

    const expiresAt = new Date(Date.now() + holdDurationMs);

    return {
      success: true,
      slot_id: slotId,
      expires_at: expiresAt
    };
  }

  /**
   * Release an expired or abandoned slot hold.
   */
  async releaseHold(client, slotId) {
    await client.query(`
      UPDATE slots
      SET held_count = GREATEST(0, COALESCE(held_count, 1) - 1)
      WHERE slot_id = $1
    `, [slotId]);
  }
}

module.exports = {
  IntelligentBookingEngine,
  DEFAULT_WEIGHTS
};
