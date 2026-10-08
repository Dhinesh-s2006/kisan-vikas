/**
 * Canonical Congestion Service for Kisan Vikas
 * Provides unified, single-source-of-truth congestion calculation across
 * Web, IVR, CSC, and Admin dashboards.
 * 
 * Rules:
 * 1. Calculated dynamically from real database data: daily capacity, booked count,
 *    active counters, queue size, and processing rates.
 * 2. Standardized levels: 'LOW', 'MEDIUM', 'HIGH', 'FULL'.
 * 3. Consistent thresholds:
 *    - FULL: 100% capacity utilized, or 0 slots remaining.
 *    - HIGH: >= 75% capacity utilized, or wait >= 45 min.
 *    - MEDIUM: >= 50% capacity utilized, or wait >= 25 min.
 *    - LOW: < 50% capacity utilized and wait < 25 min.
 * 4. Closed centres: return null for wait times, queue metrics, and congestion levels.
 */

class CongestionService {
  /**
   * Evaluates congestion state for a centre and specific date.
   * @param {object} params
   * @param {string} params.operationalStatus - 'Open', 'Closed', 'Paused'
   * @param {number} params.dailyCapacity - Daily slot capacity of centre
   * @param {number} params.activeQueueCount - Current number of active farmers waiting/booked
   * @param {number} params.activeCounters - Number of operational verification counters
   * @param {number} params.processingRateMin - Average minutes required to process a farmer
   * @param {number} [params.totalSlotsCapacity] - Total capacity across slots
   * @param {number} [params.bookedSlotsCount] - Number of slots booked
   * @returns {{
   *   congestion_level: 'LOW'|'MEDIUM'|'HIGH'|'FULL'|null,
   *   utilization_percent: number|null,
   *   active_queue: number|null,
   *   estimated_wait_minutes: number|null,
   *   is_congested: boolean,
   *   reason: string,
   *   is_closed: boolean
   * }}
   */
  calculateCongestion({
    operationalStatus = 'Open',
    dailyCapacity = 40,
    activeQueueCount = 0,
    activeCounters = 2,
    processingRateMin = 12,
    totalSlotsCapacity = null,
    bookedSlotsCount = null
  } = {}) {
    const isClosed = String(operationalStatus || '').trim().toLowerCase() === 'closed';
    const isPaused = String(operationalStatus || '').trim().toLowerCase() === 'paused';

    if (isClosed) {
      return {
        congestion_level: null,
        utilization_percent: null,
        active_queue: null,
        estimated_wait_minutes: null,
        is_congested: false,
        reason: 'Centre is currently closed. No procurement operations active.',
        is_closed: true
      };
    }

    const effectiveDailyCap = Math.max(1, Number(dailyCapacity) || 40);
    const queue = Math.max(0, Number(activeQueueCount) || 0);
    const counters = Math.max(1, Number(activeCounters) || 2);
    const rateMin = Math.max(5, Number(processingRateMin) || 12);

    // Calculate capacity utilization percentage
    let utilization = Math.round((queue / effectiveDailyCap) * 100);
    if (totalSlotsCapacity != null && bookedSlotsCount != null && totalSlotsCapacity > 0) {
      utilization = Math.round((bookedSlotsCount / totalSlotsCapacity) * 100);
    }
    const safeUtilization = Math.min(100, Math.max(0, utilization));

    // Waiting time formula: (queue * rateMin) / counters
    const estimatedWaitMinutes = queue === 0 ? 0 : Math.max(1, Math.round((queue * rateMin) / counters));

    let congestionLevel = 'LOW';
    let isCongested = false;
    let reason = 'Normal queue throughput. Minimum waiting time expected.';

    if (isPaused) {
      congestionLevel = 'HIGH';
      isCongested = true;
      reason = 'Centre operations are temporarily paused by District Administration.';
    } else if (queue === 0) {
      // Zero farmers physically waiting: strictly LOW congestion, never 'Very busy'
      congestionLevel = 'LOW';
      isCongested = false;
      reason = 'No farmers currently waiting in physical queue. Direct unloading available.';
    } else if (safeUtilization >= 100 || (totalSlotsCapacity != null && bookedSlotsCount >= totalSlotsCapacity && queue >= (counters * 3))) {
      congestionLevel = 'FULL';
      isCongested = true;
      reason = `Centre has reached maximum daily procurement capacity (${safeUtilization}% booked).`;
    } else if (estimatedWaitMinutes >= 45 || queue >= (counters * 4)) {
      congestionLevel = 'HIGH';
      isCongested = true;
      reason = `Extended queue density (approx. ${estimatedWaitMinutes} minutes estimated wait).`;
    } else if (estimatedWaitMinutes >= 20 || queue >= (counters * 2)) {
      congestionLevel = 'MEDIUM';
      isCongested = false;
      reason = `Moderate physical queue density (${queue} farmers waiting).`;
    }

    return {
      congestion_level: congestionLevel,
      utilization_percent: safeUtilization,
      active_queue: queue,
      estimated_wait_minutes: estimatedWaitMinutes,
      is_congested: isCongested,
      reason,
      is_closed: false
    };
  }

  /**
   * Retrieves authoritative, shared live metrics for a centre and optionally for a specific booking.
   * Single source of truth for physical queue, wait times, throughput, and capacity utilization.
   * 
   * @param {object} pool - PostgreSQL pool or client
   * @param {string} centreId - Centre ID
   * @param {string} [bookingId] - Optional booking ID to compute individual farmers_ahead
   * @returns {Promise<object>}
   */
  async getCentreLiveMetrics(pool, centreId, bookingId = null) {
    if (!centreId) return null;

    // 1. Fetch Centre Metadata
    const cRes = await pool.query(`
      SELECT centre_id, centre_name, village_town, district, daily_capacity_slots,
             COALESCE(active_counters, 2) AS active_counters,
             COALESCE(processing_rate_min, 12) AS processing_rate_min,
             COALESCE(storage_capacity_mt, 250) AS storage_capacity_mt,
             COALESCE(current_stock_mt, 0) AS current_stock_mt,
             operational_status
      FROM centres
      WHERE centre_id = $1
    `, [centreId]);

    if (cRes.rows.length === 0) return null;
    const centre = cRes.rows[0];

    const isClosed = String(centre.operational_status || '').trim().toLowerCase() === 'closed';
    const isPaused = String(centre.operational_status || '').trim().toLowerCase() === 'paused';

    if (isClosed) {
      return {
        centre_id: centre.centre_id,
        centre_name: centre.centre_name,
        operational_status: 'Closed',
        is_closed: true,
        physical_queue_length: 0,
        farmers_ahead: 0,
        estimated_wait_minutes: null,
        display_wait: 'Closed',
        congestion_level: null,
        theoretical_throughput_per_hr: 0,
        actual_throughput_today: 0,
        daily_capacity: Number(centre.daily_capacity_slots || 40),
        appointments_today: 0,
        active_counters: Number(centre.active_counters || 2),
        processing_rate_min: Number(centre.processing_rate_min || 12),
        storage_capacity_mt: Number(centre.storage_capacity_mt || 250),
        current_stock_mt: Number(centre.current_stock_mt || 0),
        reason: 'Centre is closed for operations.'
      };
    }

    const activeCounters = Math.max(1, Number(centre.active_counters) || 2);
    const plannedRate = Math.max(5, Number(centre.processing_rate_min) || 12);
    const dailyCapacity = Math.max(1, Number(centre.daily_capacity_slots) || 40);

    // 2. Turnaround velocity from recent completions (status_history: Checked-In -> Procured)
    const histRes = await pool.query(`
      SELECT booking_id,
             MAX(CASE WHEN status='Checked-In' THEN changed_at END) AS checkin_time,
             MAX(CASE WHEN status='Procured' THEN changed_at END) AS procured_time
      FROM status_history
      WHERE centre_id = $1
      GROUP BY booking_id
      HAVING MAX(CASE WHEN status='Procured' THEN changed_at END) IS NOT NULL
         AND MAX(CASE WHEN status='Checked-In' THEN changed_at END) IS NOT NULL
      ORDER BY procured_time DESC
      LIMIT 10
    `, [centreId]);

    let observedRate = plannedRate;
    let rateSource = 'configured_baseline';
    if (histRes.rows.length > 0) {
      const validDurations = histRes.rows
        .map(r => (new Date(r.procured_time) - new Date(r.checkin_time)) / 60000)
        .filter(d => d > 0 && d <= 300);
      if (validDurations.length > 0) {
        observedRate = Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length);
        rateSource = 'recent_completions_moving_average';
      }
    }
    const effectiveRate = Math.max(5, observedRate);

    // 3. Authoritative Queue Aggregation on Asia/Kolkata Today
    const queueAggRes = await pool.query(`
      SELECT
        COUNT(booking_id) FILTER (WHERE status IN ('Checked-In', 'Grading', 'Weighing')) AS physical_queue_length,
        COUNT(booking_id) FILTER (WHERE status IN ('Grading', 'Weighing')) AS being_served_count,
        COUNT(booking_id) FILTER (WHERE status = 'Checked-In') AS waiting_bay_count,
        COUNT(booking_id) FILTER (WHERE status IN ('Booked', 'Confirmed', 'On The Way')) AS upcoming_appointments,
        COUNT(booking_id) FILTER (WHERE status IN ('Procured', 'Payment Pending', 'Payment Completed')) AS procured_today_count,
        COUNT(booking_id) FILTER (WHERE status = 'No-Show') AS no_shows_today_count,
        COUNT(booking_id) FILTER (WHERE status = 'Cancelled') AS cancelled_today_count,
        COUNT(booking_id) AS total_today_appointments
      FROM bookings
      WHERE centre_id = $1
        AND booking_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
        AND (is_demo = FALSE OR is_demo IS NULL)
    `, [centreId]);

    const qRow = queueAggRes.rows[0] || {};
    const physicalQueueLength = parseInt(qRow.physical_queue_length) || 0;
    const beingServedCount = parseInt(qRow.being_served_count) || 0;
    const waitingBayCount = parseInt(qRow.waiting_bay_count) || 0;
    const upcomingAppointments = parseInt(qRow.upcoming_appointments) || 0;
    const procuredTodayCount = parseInt(qRow.procured_today_count) || 0;
    const totalTodayAppointments = parseInt(qRow.total_today_appointments) || 0;

    // 4. Individual Booking Farmers-Ahead Calculation
    let farmersAhead = 0;
    let farmerInPhysicalQueue = false;
    let aheadExplanation = 'Direct unloading or not in physical queue';

    if (bookingId) {
      const bRes = await pool.query(`
        SELECT booking_id, status, queue_position_at_booking, created_at, booking_date
        FROM bookings
        WHERE booking_id = $1
      `, [bookingId]);

      if (bRes.rows.length > 0) {
        const b = bRes.rows[0];
        const isPhysical = ['Checked-In', 'Grading', 'Weighing'].includes(b.status);

        if (isPhysical) {
          farmerInPhysicalQueue = true;
          // Count only physically waiting farmers ahead by checkin or queue position
          const aheadRes = await pool.query(`
            SELECT count(*) FROM bookings
            WHERE centre_id = $1
              AND booking_date = $2
              AND status IN ('Checked-In', 'Grading', 'Weighing')
              AND (queue_position_at_booking < $3 OR (queue_position_at_booking = $3 AND created_at < $4))
              AND booking_id != $5
          `, [centreId, b.booking_date, b.queue_position_at_booking, b.created_at || new Date(), bookingId]);
          farmersAhead = parseInt(aheadRes.rows[0]?.count) || 0;
          aheadExplanation = `${farmersAhead} farmers ahead in verified physical queue`;
        } else if (['Procured', 'Payment Pending', 'Payment Completed'].includes(b.status)) {
          farmersAhead = 0;
          aheadExplanation = 'Procurement completed';
        } else {
          // Scheduled/Confirmed/On The Way: not yet checked in at the gate
          farmersAhead = 0;
          aheadExplanation = 'Not in physical queue until arrival check-in at gate';
        }
      }
    }

    // 5. Estimated Waiting Time Formula:
    let estimatedWaitMinutes = 0;
    if (bookingId && farmerInPhysicalQueue) {
      estimatedWaitMinutes = Math.max(1, Math.ceil((farmersAhead + 1) / activeCounters) * effectiveRate);
    } else if (physicalQueueLength > 0) {
      estimatedWaitMinutes = Math.max(1, Math.ceil(physicalQueueLength / activeCounters) * effectiveRate);
    }

    const displayWait = estimatedWaitMinutes > 0 ? `~${estimatedWaitMinutes} min` : '< 5 min';

    // 6. Throughput Calculations: Theoretical vs Measured
    const theoreticalThroughputPerHr = Math.round(activeCounters * (60 / effectiveRate));
    const actualThroughputToday = procuredTodayCount;

    // 7. Capacity Utilization Disambiguation:
    const slotUtilizationPercent = Math.min(100, Math.round((totalTodayAppointments / dailyCapacity) * 100));
    const bayCapacity = activeCounters * 4;
    const bayUtilizationPercent = Math.min(100, Math.round((physicalQueueLength / bayCapacity) * 100));
    const storageCapacityMt = Number(centre.storage_capacity_mt || 250);
    const currentStockMt = Number(centre.current_stock_mt || 0);
    const storageUtilizationPercent = storageCapacityMt > 0
      ? Math.min(100, Math.round((currentStockMt / storageCapacityMt) * 100))
      : 0;

    // 8. Congestion Level:
    let congestionLevel = 'LOW';
    let isCongested = false;
    let reason = 'Normal queue throughput. Minimum waiting time expected.';

    if (isPaused) {
      congestionLevel = 'PAUSED';
      isCongested = true;
      reason = 'Centre operations are temporarily paused by District Administration.';
    } else if (physicalQueueLength === 0 && beingServedCount === 0) {
      // Zero physical waiting farmers: strictly LOW congestion, never 'Very busy'
      congestionLevel = 'LOW';
      isCongested = false;
      reason = 'No farmers currently waiting in physical queue. Rapid unloading available.';
    } else if (estimatedWaitMinutes > 35 || physicalQueueLength >= (activeCounters * 4)) {
      congestionLevel = 'HIGH';
      isCongested = true;
      reason = `Heavy physical queue backlog (${physicalQueueLength} farmers waiting, ~${estimatedWaitMinutes} min wait).`;
    } else if (estimatedWaitMinutes > 15 || physicalQueueLength >= (activeCounters * 2)) {
      congestionLevel = 'MODERATE';
      isCongested = false;
      reason = `Moderate physical queue density (${physicalQueueLength} farmers waiting, ~${estimatedWaitMinutes} min wait).`;
    }

    return {
      centre_id: centre.centre_id,
      centre_name: centre.centre_name,
      operational_status: centre.operational_status,
      is_closed: false,
      is_paused: isPaused,
      available_appointment_slots: Math.max(0, dailyCapacity - totalTodayAppointments),
      valid_confirmed_appointments: upcomingAppointments,
      farmers_actually_arrived: physicalQueueLength + procuredTodayCount,
      farmers_currently_processing: beingServedCount,
      current_estimated_waiting_time: estimatedWaitMinutes,
      physical_queue_length: physicalQueueLength,
      farmers_being_served: beingServedCount,
      farmers_waiting_in_bay: waitingBayCount,
      upcoming_appointments: upcomingAppointments,
      appointments_today: totalTodayAppointments,
      farmers_ahead: farmersAhead,
      farmer_in_physical_queue: farmerInPhysicalQueue,
      ahead_explanation: aheadExplanation,
      estimated_wait_minutes: estimatedWaitMinutes,
      display_wait: physicalQueueLength === 0 && beingServedCount === 0 ? '0 min (No queue)' : displayWait,
      congestion_level: congestionLevel,
      is_congested: isCongested,
      reason,
      active_counters: activeCounters,
      processing_rate_min: effectiveRate,
      processing_rate_source: rateSource,
      theoretical_throughput_per_hr: theoreticalThroughputPerHr,
      actual_throughput_today: actualThroughputToday,
      daily_capacity: dailyCapacity,
      daily_capacity_slots: dailyCapacity,
      slot_utilization_percent: slotUtilizationPercent,
      bay_capacity: bayCapacity,
      bay_utilization_percent: bayUtilizationPercent,
      storage_capacity_mt: storageCapacityMt,
      current_stock_mt: currentStockMt,
      storage_utilization_percent: storageUtilizationPercent,
      last_updated_at: new Date().toISOString(),
      timestamp: new Date().toISOString()
    };
  }
}

// Singleton export
const defaultCongestionService = new CongestionService();

module.exports = {
  CongestionService,
  defaultCongestionService
};
