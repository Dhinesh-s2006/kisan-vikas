/**
 * Canonical Farmer Fairness and Disruption Protection Engine
 * 
 * Rules:
 * 1. Interaction-based metrics only: reschedules, pacing delays, and system disruptions.
 * 2. Absolutely zero socioeconomic or demographic profiling.
 * 3. Weights:
 *    - Reschedule weight: 15
 *    - Disruption weight: 25
 *    - Recent 24h bonus: 30
 *    - Recent 7d bonus: 15
 * 4. Protection Thresholds:
 *    - High: score >= 50 or reschedules >= 2
 *    - Moderate: score >= 25 or reschedules >= 1
 *    - Low: default standard tracking
 */

const FAIRNESS_CONFIG = {
  RESCHEDULE_WEIGHT: 15,
  DISRUPTION_WEIGHT: 25,
  RECENT_24H_BONUS: 30,
  RECENT_7D_BONUS: 15,
  HIGH_PROTECTION_THRESHOLD: 50,
  MODERATE_PROTECTION_THRESHOLD: 25
};

/**
 * Calculates fairness metrics and priority levels for a batch of farmer IDs in a single query.
 * 
 * @param {string[]} farmerIds - Array of farmer IDs
 * @param {object} pool - PostgreSQL connection pool
 * @returns {Promise<object>} Map of farmer_id -> fairness details
 */
async function calculateBatchFarmerFairness(farmerIds, pool) {
  if (!farmerIds || !Array.isArray(farmerIds) || farmerIds.length === 0) return {};

  const query = `
    SELECT 
      b.farmer_id,
      COALESCE(SUM(b.reschedule_count), 0)::integer AS total_reschedules,
      COALESCE(SUM(b.disruption_count), 0)::integer AS total_disruptions,
      MAX(b.last_disrupted_at) AS last_disrupted_at,
      MAX(re.last_reschedule_at) AS last_reschedule_at,
      COUNT(b.booking_id)::integer AS total_bookings
    FROM bookings b
    LEFT JOIN (
      SELECT re_sub.booking_id, MAX(re_sub.created_at) AS last_reschedule_at
      FROM reschedule_events re_sub
      WHERE re_sub.is_system_disruption = true OR re_sub.is_system_disruption IS NULL
      GROUP BY re_sub.booking_id
    ) re ON b.booking_id = re.booking_id
    WHERE b.farmer_id = ANY($1::text[])
    GROUP BY b.farmer_id
  `;
  const res = await pool.query(query, [farmerIds]);
  const results = {};
  const now = Date.now();

  for (const row of res.rows) {
    const reschedules = Number(row.total_reschedules || 0);
    const disruptions = Number(row.total_disruptions || 0);

    const lastDisruptedTime = row.last_disrupted_at ? new Date(row.last_disrupted_at).getTime() : 0;
    const lastRescheduleTime = row.last_reschedule_at ? new Date(row.last_reschedule_at).getTime() : 0;
    const mostRecent = Math.max(lastDisruptedTime, lastRescheduleTime);

    let bonus = 0;
    if (mostRecent > 0) {
      const diffHours = (now - mostRecent) / (1000 * 60 * 60);
      if (diffHours <= 24) {
        bonus = FAIRNESS_CONFIG.RECENT_24H_BONUS;
      } else if (diffHours <= 24 * 7) {
        bonus = FAIRNESS_CONFIG.RECENT_7D_BONUS;
      }
    }

    const score = (FAIRNESS_CONFIG.RESCHEDULE_WEIGHT * reschedules) + 
                  (FAIRNESS_CONFIG.DISRUPTION_WEIGHT * disruptions) + 
                  bonus;

    let protectionLevel = 'LOW';
    let status = 'STANDARD';
    let message = 'Standard fairness queue tracking active.';

    if (reschedules >= 2 || score >= FAIRNESS_CONFIG.HIGH_PROTECTION_THRESHOLD) {
      protectionLevel = 'HIGH';
      status = 'PROTECTED_HIGH_PRIORITY';
      message = 'High fairness protection active: Repeated system disruptions detected. Scheduling is strongly protected against unnecessary changes.';
    } else if (reschedules >= 1 || score >= FAIRNESS_CONFIG.MODERATE_PROTECTION_THRESHOLD) {
      protectionLevel = 'MODERATE';
      status = 'PREVIOUSLY_RESCHEDULED';
      message = 'Moderate fairness protection active: Prior system disruptions recorded. Preserving your current schedule is prioritized.';
    }

    let priorityReason = 'Standard scheduled appointment';
    if (bonus > 0 && reschedules > 0) {
      priorityReason = `Disrupted in last ${bonus === 30 ? '24h' : '7d'} (+${bonus} pts) & ${reschedules} reschedule (+${reschedules * FAIRNESS_CONFIG.RESCHEDULE_WEIGHT} pts)`;
    } else if (bonus > 0) {
      priorityReason = `Operational disruption in last ${bonus === 30 ? '24h' : '7d'} (+${bonus} pts)`;
    } else if (reschedules > 0) {
      priorityReason = `${reschedules} prior system reschedule (+${reschedules * FAIRNESS_CONFIG.RESCHEDULE_WEIGHT} pts)`;
    } else if (disruptions > 0) {
      priorityReason = `${disruptions} recorded system disruption (+${disruptions * FAIRNESS_CONFIG.DISRUPTION_WEIGHT} pts)`;
    }

    results[row.farmer_id] = {
      farmer_id: row.farmer_id,
      fairness_score: score,
      protection_level: protectionLevel,
      status,
      message,
      priority_reason: priorityReason,
      metrics: {
        reschedule_count: reschedules,
        disruption_count: disruptions,
        recent_bonus: bonus,
        last_disrupted_at: mostRecent > 0 ? new Date(mostRecent).toISOString() : null,
        total_bookings: Number(row.total_bookings || 0)
      }
    };
  }

  for (const fId of farmerIds) {
    if (!results[fId]) {
      results[fId] = {
        farmer_id: fId,
        fairness_score: 0,
        protection_level: 'LOW',
        status: 'STANDARD',
        message: 'Standard fairness queue tracking active.',
        priority_reason: 'Standard scheduled appointment',
        metrics: {
          reschedule_count: 0,
          disruption_count: 0,
          recent_bonus: 0,
          last_disrupted_at: null,
          total_bookings: 0
        }
      };
    }
  }

  return results;
}

async function calculateFarmerFairness(farmerId, pool) {
  const batch = await calculateBatchFarmerFairness([farmerId], pool);
  return batch[farmerId];
}

module.exports = {
  FAIRNESS_CONFIG,
  calculateBatchFarmerFairness,
  calculateFarmerFairness
};
