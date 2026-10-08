/**
 * Canonical Centre Service for Kisan Vikas
 * Provides unified centre management, operational status authority, and Centre Health
 * calculation across all roles.
 * 
 * Rules:
 * 1. Operational status is authoritative from database ('Open', 'Closed', 'Paused').
 * 2. Closed centres MUST return null for wait times, queue metrics, processing speeds,
 *    and capacity percentages so the frontend displays '-' without misleading data.
 * 3. Synthetic/demo indicators are clearly distinguished.
 * 4. District containment is strictly validated.
 */

const { defaultCongestionService } = require('../congestion/congestionService');

class CentreService {
  constructor({ pool }) {
    this.pool = pool;
  }

  /**
   * Retrieves operational status and details of a single centre.
   */
  async getCentreById(centreId) {
    if (!centreId) return null;
    const res = await this.pool.query(
      'SELECT * FROM centres WHERE centre_id = $1',
      [centreId]
    );
    return res.rows[0] || null;
  }

  /**
   * Returns eligible operational centres for a given district.
   * Excludes 'Closed' and 'Retired' centres by default for farmer booking.
   */
  async getEligibleCentresForDistrict(district, { includeClosed = false } = {}) {
    if (!district) return [];
    const cleanDist = district.trim().toLowerCase();

    let query = `
      SELECT centre_id, centre_name, village_town, district, state,
             latitude, longitude, daily_capacity_slots,
             COALESCE(active_counters, 2) AS active_counters,
             staff_availability,
             COALESCE(processing_rate_min, 12) AS processing_rate_min,
             COALESCE(storage_capacity_mt, 250) AS storage_capacity_mt,
             COALESCE(current_stock_mt, 0) AS current_stock_mt,
             risk_level, operational_status, opening_date, closing_date, data_source
      FROM centres
      WHERE LOWER(TRIM(district)) = $1
    `;

    if (!includeClosed) {
      query += " AND operational_status NOT IN ('Closed', 'Retired') AND operational_status IS NOT NULL";
    }

    query += ' ORDER BY centre_name ASC';

    const res = await this.pool.query(query, [cleanDist]);
    return res.rows;
  }

  /**
   * Calculates accurate Centre Health metrics for a centre.
   * If the centre is CLOSED:
   * Returns NULL for wait time, queue count, processing speed, and capacity percentage.
   */
  formatCentreHealth(centre, { currentQueue = 0, totalTodayBookings = 0 } = {}) {
    const status = (centre.operational_status || 'Open').trim();
    const isClosed = status.toLowerCase() === 'closed' || status.toLowerCase() === 'retired';
    const isPaused = status.toLowerCase() === 'paused';

    if (isClosed) {
      return {
        centre_id: centre.centre_id,
        centre_name: centre.centre_name,
        village_town: centre.village_town,
        district: centre.district,
        operational_status: status,
        is_closed: true,
        is_operational: false,
        // Rule 17: Null representation for closed centre metrics
        waiting_farmers: null,
        estimated_wait_minutes: null,
        processing_speed_min: null,
        processing_speed_label: null,
        daily_capacity: null,
        storage_capacity_mt: centre.storage_capacity_mt != null ? Number(centre.storage_capacity_mt) : null,
        current_stock_mt: centre.current_stock_mt != null ? Number(centre.current_stock_mt) : null,
        storage_used_pct: null,
        capacity_utilization_percent: null,
        congestion_level: null,
        needs_attention: true,
        risk_level: centre.risk_level || 'LOW',
        notice: 'Centre is closed. No procurement operations active.'
      };
    }

    const q = Math.max(0, Number(currentQueue) || 0);
    const dailyCap = Math.max(1, Number(centre.daily_capacity_slots) || 40);
    const activeCounters = Math.max(1, Number(centre.active_counters) || 2);
    const procRate = Math.max(5, Number(centre.processing_rate_min) || 12);
    const storageCap = Number(centre.storage_capacity_mt) || 250;
    const currentStock = Number(centre.current_stock_mt) || 0;
    const storageUsedPct = storageCap > 0 ? Math.min(100, Math.round((currentStock / storageCap) * 100)) : 0;

    const congestion = defaultCongestionService.calculateCongestion({
      operationalStatus: status,
      dailyCapacity: dailyCap,
      activeQueueCount: q,
      activeCounters,
      processingRateMin: procRate
    });

    const needsAttention = isPaused ||
      (q >= dailyCap * 0.75) ||
      (congestion.estimated_wait_minutes >= 45) ||
      ((centre.risk_level || '').toUpperCase() === 'HIGH') ||
      (storageUsedPct >= 85);

    return {
      centre_id: centre.centre_id,
      centre_name: centre.centre_name,
      village_town: centre.village_town,
      district: centre.district,
      operational_status: status,
      is_closed: false,
      is_operational: !isPaused,
      waiting_farmers: q,
      estimated_wait_minutes: congestion.estimated_wait_minutes,
      processing_speed_min: procRate,
      processing_speed_label: `${procRate} min/farmer`,
      daily_capacity: dailyCap,
      storage_capacity_mt: storageCap,
      current_stock_mt: currentStock,
      storage_used_pct: storageUsedPct,
      capacity_utilization_percent: congestion.utilization_percent,
      congestion_level: congestion.congestion_level,
      needs_attention: needsAttention,
      risk_level: centre.risk_level || 'LOW',
      notice: null
    };
  }
}

module.exports = {
  CentreService
};
