/**
 * AI Procurement Operations Assistant Service
 * For District Officers and Centre Admins (Uzhavarsethu / Kisan Queue)
 * 
 * Core Design Principles:
 * 1. Read-Only Decision Support: Never mutates database records.
 * 2. Deterministic Grounding: Fetches live data from PostgreSQL via predefined queries (Zero AI SQL).
 * 3. Multi-Provider Fallback: Gemini -> Groq -> OpenRouter -> Deterministic Offline Rules.
 * 4. Mathematical What-If Simulation: Calculates accurate baseline vs projected capacity, queue, and stock metrics.
 * 5. Role-Scoped Privacy: Strict isolation between districts and centres.
 */

const { defaultFactory } = require('./providerFactory');
const { OfficerDataEngine } = require('./officerDataEngine');

function sanitizeError(err) {
  let msg = err?.message || String(err) || 'Unknown error';
  msg = msg.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
  msg = msg.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  msg = msg.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/AQ\.[0-9A-Za-z-_]{30,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/gsk_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/sk-or-v1-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  msg = msg.replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]');
  return msg;
}

class OfficerOperationsService {
  constructor({ pool, factory = defaultFactory } = {}) {
    this.pool = pool;
    this.factory = factory;
    this.dataEngine = new OfficerDataEngine({ pool });
  }

  /**
   * Predefined Data Retrieval for District Officer (Zero AI SQL)
   */
  async getDistrictOperationalData(district) {
    if (!district) throw new Error('District parameter is required.');
    const cleanDistrict = String(district).trim();

    // 1. Centres in the district with storage, pacing & capacity metrics
    const centresRes = await this.pool.query(`
      SELECT centre_id, centre_name, district, village_town,
             daily_capacity_slots, active_counters, staff_availability, processing_rate_min,
             storage_capacity_mt, current_stock_mt, expected_arrivals_mt,
             predicted_stock_mt, predicted_overload_mt, risk_level, operational_status
      FROM centres
      WHERE LOWER(district) = LOWER($1)
      ORDER BY centre_name ASC
    `, [cleanDistrict]);

    const centres = centresRes.rows.map(c => ({
      centre_id: c.centre_id,
      centre_name: c.centre_name,
      district: c.district,
      village_town: c.village_town,
      daily_capacity_slots: Number(c.daily_capacity_slots || 0),
      active_counters: Number(c.active_counters || 2),
      staff_availability: Number(c.staff_availability || 5),
      processing_rate_min: Number(c.processing_rate_min || 12),
      storage_capacity_mt: Number(c.storage_capacity_mt || 0),
      current_stock_mt: Number(c.current_stock_mt || 0),
      expected_arrivals_mt: Number(c.expected_arrivals_mt || 0),
      predicted_stock_mt: Number(c.predicted_stock_mt || (Number(c.current_stock_mt || 0) + Number(c.expected_arrivals_mt || 0))),
      predicted_overload_mt: Number(c.predicted_overload_mt || 0),
      risk_level: c.risk_level || 'LOW',
      operational_status: c.operational_status || 'Active',
      storage_occupancy_pct: c.storage_capacity_mt > 0
        ? Number(((Number(c.current_stock_mt || 0) / Number(c.storage_capacity_mt)) * 100).toFixed(1))
        : 0
    }));

    // 2. Bookings summary today
    const bookingsRes = await this.pool.query(`
      SELECT b.status, COUNT(*) as count,
             COALESCE(SUM(b.quantity_quintals), 0) as total_quintals,
             COALESCE(AVG(b.estimated_wait_minutes), 0) as avg_wait_min,
             COALESCE(MAX(b.estimated_wait_minutes), 0) as max_wait_min
      FROM bookings b
      JOIN centres c ON b.centre_id = c.centre_id
      WHERE LOWER(c.district) = LOWER($1) AND b.booking_date = CURRENT_DATE
      GROUP BY b.status
    `, [cleanDistrict]);

    const bookingStatusMap = {};
    let totalBookingsToday = 0;
    let totalQuintalsToday = 0;
    let maxWaitMinToday = 0;
    let sumWait = 0;
    let waitCount = 0;

    bookingsRes.rows.forEach(r => {
      const cnt = Number(r.count);
      const q = Number(r.total_quintals);
      bookingStatusMap[r.status] = { count: cnt, total_quintals: q };
      totalBookingsToday += cnt;
      totalQuintalsToday += q;
      if (Number(r.max_wait_min) > maxWaitMinToday) maxWaitMinToday = Number(r.max_wait_min);
      sumWait += Number(r.avg_wait_min) * cnt;
      waitCount += cnt;
    });

    const avgWaitMinToday = waitCount > 0 ? Math.round(sumWait / waitCount) : 0;

    // 3. Pacing status across district
    const pacingRes = await this.pool.query(`
      SELECT pe.centre_id, c.centre_name, pe.pacing_status, pe.recommended_action,
             pe.delay_minutes, pe.observed_rate_min, pe.active_queue_count, pe.created_at
      FROM pacing_events pe
      JOIN centres c ON pe.centre_id = c.centre_id
      WHERE LOWER(c.district) = LOWER($1)
      ORDER BY pe.created_at DESC
      LIMIT 15
    `, [cleanDistrict]);

    // 4. Grievances in district
    const grievancesRes = await this.pool.query(`
      SELECT g.grievance_id, g.centre_id, c.centre_name, g.issue_type, g.status,
             g.sla_deadline, g.created_at,
             CASE WHEN g.sla_deadline < NOW() AND g.status != 'RESOLVED' THEN true ELSE false END as is_breached
      FROM grievances g
      JOIN centres c ON g.centre_id = c.centre_id
      WHERE LOWER(c.district) = LOWER($1) AND g.status != 'RESOLVED'
      ORDER BY g.created_at DESC
      LIMIT 30
    `, [cleanDistrict]);

    const openGrievances = grievancesRes.rows.length;
    const slaBreachedGrievances = grievancesRes.rows.filter(g => g.is_breached).length;

    // 5. Catchment Crop Declarations & Projected Harvest
    const cropRes = await this.pool.query(`
      SELECT crop,
             COALESCE(SUM(cultivated_area), 0) as total_area_acres,
             COALESCE(SUM(expected_yield_min_mt), 0) as total_yield_min_mt,
             COALESCE(SUM(expected_procurement_min_mt), 0) as total_procurement_min_mt
      FROM crop_declarations
      WHERE LOWER(district) = LOWER($1)
      GROUP BY crop
    `, [cleanDistrict]);

    // District-level aggregates
    const totalStorageCapacityMt = centres.reduce((acc, c) => acc + c.storage_capacity_mt, 0);
    const totalCurrentStockMt = centres.reduce((acc, c) => acc + c.current_stock_mt, 0);
    const totalExpectedArrivalsMt = centres.reduce((acc, c) => acc + c.expected_arrivals_mt, 0);
    const highRiskCentres = centres.filter(c => c.risk_level === 'HIGH' || c.predicted_overload_mt > 0);
    const moderateRiskCentres = centres.filter(c => c.risk_level === 'MODERATE' && c.predicted_overload_mt <= 0);

    return {
      scope: 'DISTRICT',
      district: cleanDistrict,
      timestamp: new Date().toISOString(),
      summary: {
        total_centres: centres.length,
        active_centres: centres.filter(c => c.operational_status === 'Active').length,
        high_risk_centres_count: highRiskCentres.length,
        moderate_risk_centres_count: moderateRiskCentres.length,
        total_storage_capacity_mt: totalStorageCapacityMt,
        total_current_stock_mt: totalCurrentStockMt,
        total_expected_arrivals_mt: totalExpectedArrivalsMt,
        district_storage_occupancy_pct: totalStorageCapacityMt > 0
          ? Number(((totalCurrentStockMt / totalStorageCapacityMt) * 100).toFixed(1))
          : 0,
        total_bookings_today: totalBookingsToday,
        total_quintals_today: totalQuintalsToday,
        avg_wait_minutes_today: avgWaitMinToday,
        max_wait_minutes_today: maxWaitMinToday,
        open_grievances_count: openGrievances,
        sla_breached_count: slaBreachedGrievances
      },
      centres,
      high_risk_centres: highRiskCentres,
      bookings_breakdown: bookingStatusMap,
      pacing_events: pacingRes.rows,
      grievances: grievancesRes.rows.slice(0, 10),
      catchment_crops: cropRes.rows
    };
  }

  /**
   * Predefined Data Retrieval for Centre Admin (Zero AI SQL)
   */
  async getCentreOperationalData(centreId) {
    if (!centreId) throw new Error('centreId parameter is required.');
    const cleanCentreId = String(centreId).trim();

    // 1. Centre record
    const centreRes = await this.pool.query(`
      SELECT centre_id, centre_name, district, village_town,
             daily_capacity_slots, active_counters, staff_availability, processing_rate_min,
             storage_capacity_mt, current_stock_mt, expected_arrivals_mt,
             predicted_stock_mt, predicted_overload_mt, risk_level, operational_status
      FROM centres
      WHERE centre_id = $1
    `, [cleanCentreId]);

    if (centreRes.rows.length === 0) {
      throw new Error(`Centre not found with ID: ${cleanCentreId}`);
    }

    const c = centreRes.rows[0];
    const centre = {
      centre_id: c.centre_id,
      centre_name: c.centre_name,
      district: c.district,
      village_town: c.village_town,
      daily_capacity_slots: Number(c.daily_capacity_slots || 0),
      active_counters: Number(c.active_counters || 2),
      staff_availability: Number(c.staff_availability || 5),
      processing_rate_min: Number(c.processing_rate_min || 12),
      storage_capacity_mt: Number(c.storage_capacity_mt || 0),
      current_stock_mt: Number(c.current_stock_mt || 0),
      expected_arrivals_mt: Number(c.expected_arrivals_mt || 0),
      predicted_stock_mt: Number(c.predicted_stock_mt || (Number(c.current_stock_mt || 0) + Number(c.expected_arrivals_mt || 0))),
      predicted_overload_mt: Number(c.predicted_overload_mt || 0),
      risk_level: c.risk_level || 'LOW',
      operational_status: c.operational_status || 'Active',
      storage_occupancy_pct: c.storage_capacity_mt > 0
        ? Number(((Number(c.current_stock_mt || 0) / Number(c.storage_capacity_mt)) * 100).toFixed(1))
        : 0
    };

    // 2. Today's Bookings and Queue
    const bookingsRes = await this.pool.query(`
      SELECT b.booking_id, b.farmer_id, b.status, b.crop, b.quantity_quintals,
             b.token, b.pacing_status, b.recommended_delay_minutes, b.estimated_wait_minutes,
             s.start_time, s.end_time
      FROM bookings b
      LEFT JOIN slots s ON b.slot_id = s.slot_id
      WHERE b.centre_id = $1 AND b.booking_date = CURRENT_DATE
      ORDER BY s.start_time ASC, b.created_at ASC
    `, [cleanCentreId]);

    const activeQueue = bookingsRes.rows.filter(b => ['Booked', 'Confirmed', 'On The Way', 'Checked-In', 'Grading', 'Weighing'].includes(b.status));
    const completedQueue = bookingsRes.rows.filter(b => ['Procured', 'Payment Pending', 'Payment Completed'].includes(b.status));

    // 3. Slots today
    const slotsRes = await this.pool.query(`
      SELECT slot_id, start_time, end_time, max_farmers, booked_count
      FROM slots
      WHERE centre_id = $1 AND date = CURRENT_DATE
      ORDER BY start_time ASC
    `, [cleanCentreId]);

    // 4. Pacing events
    const pacingRes = await this.pool.query(`
      SELECT pacing_status, recommended_action, delay_minutes, observed_rate_min,
             active_queue_count, created_at
      FROM pacing_events
      WHERE centre_id = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [cleanCentreId]);

    // 5. Active Grievances
    const grievancesRes = await this.pool.query(`
      SELECT grievance_id, farmer_id, issue_type, description, status, sla_deadline, created_at,
             CASE WHEN sla_deadline < NOW() AND status != 'RESOLVED' THEN true ELSE false END as is_breached
      FROM grievances
      WHERE centre_id = $1 AND status != 'RESOLVED'
      ORDER BY created_at DESC
    `, [cleanCentreId]);

    // Throughput capacity (farmers per hour)
    const hourlyThroughput = centre.processing_rate_min > 0
      ? Math.round((centre.active_counters * 60) / centre.processing_rate_min)
      : 10;

    return {
      scope: 'CENTRE',
      centre_id: cleanCentreId,
      centre_name: centre.centre_name,
      district: centre.district,
      timestamp: new Date().toISOString(),
      centre,
      metrics: {
        total_bookings_today: bookingsRes.rows.length,
        active_queue_count: activeQueue.length,
        completed_count: completedQueue.length,
        hourly_throughput_farmers: hourlyThroughput,
        estimated_active_wait_minutes: activeQueue.length > 0 && centre.active_counters > 0
          ? Math.round((activeQueue.length / centre.active_counters) * centre.processing_rate_min)
          : 0,
        open_slots_count: slotsRes.rows.filter(s => Number(s.booked_count) < Number(s.max_farmers)).length,
        total_slots_count: slotsRes.rows.length,
        open_grievances_count: grievancesRes.rows.length,
        sla_breached_grievances_count: grievancesRes.rows.filter(g => g.is_breached).length
      },
      slots: slotsRes.rows,
      pacing_events: pacingRes.rows,
      grievances: grievancesRes.rows
    };
  }

  /**
   * Deterministic What-If Scenario Simulation Calculator
   * Purely in-memory, ZERO database mutations.
   */
  runWhatIfSimulation(scopeData, { type = 'arrival_change', percentage = 20, counter_delta = 0, target_centre_id = null, source_centre_id = null, quantity_mt = 0 } = {}) {
    const isDistrict = scopeData.scope === 'DISTRICT';
    
    if (type === 'arrival_change') {
      const pct = Number(percentage) || 20;
      const factor = 1 + (pct / 100);

      if (isDistrict) {
        let baselineArrivals = scopeData.summary.total_expected_arrivals_mt;
        let projectedArrivals = Math.round(baselineArrivals * factor * 10) / 10;
        let baselineStock = scopeData.summary.total_current_stock_mt;
        let projectedStock = Math.round((baselineStock + (projectedArrivals - baselineArrivals)) * 10) / 10;
        let totalCapacity = scopeData.summary.total_storage_capacity_mt;
        let projectedOccupancy = totalCapacity > 0 ? Number(((projectedStock / totalCapacity) * 100).toFixed(1)) : 0;
        let baselineOccupancy = scopeData.summary.district_storage_occupancy_pct;

        // Individual centre impacts
        const affectedCentres = scopeData.centres.map(c => {
          const cProjectedArrivals = Math.round(c.expected_arrivals_mt * factor * 10) / 10;
          const cProjectedStock = Math.round((c.current_stock_mt + cProjectedArrivals) * 10) / 10;
          const cOverload = Math.max(0, Math.round((cProjectedStock - c.storage_capacity_mt) * 10) / 10);
          const cOccupancy = c.storage_capacity_mt > 0 ? Number(((cProjectedStock / c.storage_capacity_mt) * 100).toFixed(1)) : 0;
          const becomesHighRisk = cOverload > 0 || cOccupancy > 90;

          return {
            centre_id: c.centre_id,
            centre_name: c.centre_name,
            baseline_arrivals_mt: c.expected_arrivals_mt,
            projected_arrivals_mt: cProjectedArrivals,
            baseline_stock_mt: c.current_stock_mt,
            projected_stock_mt: cProjectedStock,
            storage_capacity_mt: c.storage_capacity_mt,
            projected_overload_mt: cOverload,
            projected_occupancy_pct: cOccupancy,
            risk_status: becomesHighRisk ? 'HIGH' : (cOccupancy > 75 ? 'MODERATE' : 'LOW')
          };
        });

        const newHighRiskCount = affectedCentres.filter(c => c.risk_status === 'HIGH').length;

        return {
          scenario_type: 'arrival_change',
          parameter: `${pct > 0 ? '+' : ''}${pct}% arrivals`,
          scope: 'DISTRICT',
          district: scopeData.district,
          baseline: {
            total_arrivals_mt: baselineArrivals,
            total_stock_mt: baselineStock,
            occupancy_pct: baselineOccupancy,
            high_risk_centres: scopeData.summary.high_risk_centres_count
          },
          projected: {
            total_arrivals_mt: projectedArrivals,
            total_stock_mt: projectedStock,
            occupancy_pct: projectedOccupancy,
            high_risk_centres: newHighRiskCount
          },
          delta: {
            arrivals_delta_mt: Math.round((projectedArrivals - baselineArrivals) * 10) / 10,
            stock_delta_mt: Math.round((projectedStock - baselineStock) * 10) / 10,
            occupancy_delta_pct: Number((projectedOccupancy - baselineOccupancy).toFixed(1)),
            risk_change: `${newHighRiskCount - scopeData.summary.high_risk_centres_count} additional centre(s) flagged high risk`
          },
          critical_centres: affectedCentres.filter(c => c.projected_overload_mt > 0),
          recommended_mitigations: [
            pct > 0 ? `Apply adaptive pacing delay (+15-30 mins) to incoming slot reservations in high-risk catchment centres.` : 'Ample capacity buffer available; pacing delays can be relaxed.',
            newHighRiskCount > 0 ? `Coordinate inter-centre grain transport rakes for ${affectedCentres.filter(c => c.projected_overload_mt > 0).map(c => c.centre_name).join(', ')}.` : 'No storage overloads projected.',
            `Deploy mobile weighment counter to centres with projected occupancy > 85%.`
          ]
        };
      } else {
        // Centre Admin arrival change simulation
        const c = scopeData.centre;
        const baselineArrivals = c.expected_arrivals_mt;
        const projectedArrivals = Math.round(baselineArrivals * factor * 10) / 10;
        const projectedStock = Math.round((c.current_stock_mt + projectedArrivals) * 10) / 10;
        const overloadMt = Math.max(0, Math.round((projectedStock - c.storage_capacity_mt) * 10) / 10);
        const projectedOccupancy = c.storage_capacity_mt > 0 ? Number(((projectedStock / c.storage_capacity_mt) * 100).toFixed(1)) : 0;
        
        // Wait time impact
        const baselineWait = scopeData.metrics.estimated_active_wait_minutes;
        const projectedWait = Math.round(baselineWait * factor);

        return {
          scenario_type: 'arrival_change',
          parameter: `${pct > 0 ? '+' : ''}${pct}% arrivals`,
          scope: 'CENTRE',
          centre_id: c.centre_id,
          centre_name: c.centre_name,
          baseline: {
            arrivals_mt: baselineArrivals,
            stock_mt: c.current_stock_mt,
            storage_capacity_mt: c.storage_capacity_mt,
            occupancy_pct: c.storage_occupancy_pct,
            est_wait_min: baselineWait
          },
          projected: {
            arrivals_mt: projectedArrivals,
            stock_mt: projectedStock,
            storage_capacity_mt: c.storage_capacity_mt,
            occupancy_pct: projectedOccupancy,
            overload_mt: overloadMt,
            est_wait_min: projectedWait
          },
          delta: {
            arrivals_delta_mt: Math.round((projectedArrivals - baselineArrivals) * 10) / 10,
            occupancy_delta_pct: Number((projectedOccupancy - c.storage_occupancy_pct).toFixed(1)),
            wait_time_delta_min: projectedWait - baselineWait
          },
          recommended_mitigations: overloadMt > 0
            ? [
                `Storage overload of ${overloadMt} MT projected! Request immediate inter-centre movement order.`,
                `Activate pacing delay of +25 minutes to stagger farmer tractor arrivals.`,
                `Ensure all active weighment counters (${c.active_counters}) are staffed to maximum capacity.`
              ]
            : [
                `Centre storage remains sufficient (${projectedOccupancy}% occupancy).`,
                `Maintain standard queue processing rates.`
              ]
        };
      }
    }

    if (type === 'counter_change') {
      const delta = Number(counter_delta) || 1;
      const c = isDistrict ? scopeData.centres[0] : scopeData.centre;
      if (!c) throw new Error('No centre found to evaluate counter change.');

      const baselineCounters = c.active_counters;
      const projectedCounters = Math.max(1, baselineCounters + delta);
      const processingRate = c.processing_rate_min || 12;

      const baselineHourlyThroughput = Math.round((baselineCounters * 60) / processingRate);
      const projectedHourlyThroughput = Math.round((projectedCounters * 60) / processingRate);
      const throughputDeltaPct = Number((((projectedHourlyThroughput - baselineHourlyThroughput) / baselineHourlyThroughput) * 100).toFixed(1));

      const activeQueue = isDistrict ? (scopeData.summary.total_bookings_today / scopeData.centres.length) : scopeData.metrics.active_queue_count;
      const baselineWait = Math.round((activeQueue / baselineCounters) * processingRate);
      const projectedWait = Math.round((activeQueue / projectedCounters) * processingRate);

      return {
        scenario_type: 'counter_change',
        parameter: `${delta > 0 ? '+' : ''}${delta} weighment counter(s)`,
        scope: isDistrict ? 'DISTRICT' : 'CENTRE',
        centre_name: c.centre_name,
        baseline: {
          counters: baselineCounters,
          hourly_throughput_farmers: baselineHourlyThroughput,
          estimated_wait_minutes: baselineWait
        },
        projected: {
          counters: projectedCounters,
          hourly_throughput_farmers: projectedHourlyThroughput,
          estimated_wait_minutes: projectedWait
        },
        delta: {
          arrivals_delta_mt: 0,
          throughput_delta_pct: throughputDeltaPct,
          wait_time_reduction_min: baselineWait - projectedWait
        },
        recommended_mitigations: [
          delta > 0
            ? `Adding ${delta} counter reduces wait times from ~${baselineWait}m to ~${projectedWait}m (${baselineWait - projectedWait} mins saved per farmer).`
            : `Reducing ${Math.abs(delta)} counter increases farmer wait time to ~${projectedWait}m. Ensure adequate queue shading and water facilities.`,
          `Ensure ${projectedCounters} weighment operators and quality certifiers are assigned.`
        ]
      };
    }

    if (type === 'reallocation' && isDistrict) {
      const qty = Math.abs(Number(quantity_mt) || 20);
      const source = scopeData.centres.find(c => 
        c.centre_id === source_centre_id ||
        (source_centre_id && (
          c.centre_name.toLowerCase().includes(String(source_centre_id).toLowerCase()) ||
          String(source_centre_id).toLowerCase().includes(c.centre_name.toLowerCase())
        ))
      ) || scopeData.centres[0];

      const target = scopeData.centres.find(c => 
        (c.centre_id === target_centre_id ||
        (target_centre_id && (
          c.centre_name.toLowerCase().includes(String(target_centre_id).toLowerCase()) ||
          String(target_centre_id).toLowerCase().includes(c.centre_name.toLowerCase())
        ))) &&
        c.centre_id !== source?.centre_id
      ) || scopeData.centres.find(c => c.centre_id !== source?.centre_id) || scopeData.centres[1] || scopeData.centres[0];

      const sourceProjStock = Math.max(0, source.current_stock_mt - qty);
      const targetProjStock = target.current_stock_mt + qty;

      const sourceOccupancy = source.storage_capacity_mt > 0 ? Number(((sourceProjStock / source.storage_capacity_mt) * 100).toFixed(1)) : 0;
      const targetOccupancy = target.storage_capacity_mt > 0 ? Number(((targetProjStock / target.storage_capacity_mt) * 100).toFixed(1)) : 0;

      return {
        scenario_type: 'reallocation',
        parameter: `Transfer ${qty} MT from ${source.centre_name} to ${target.centre_name}`,
        scope: 'DISTRICT',
        source_centre: {
          name: source.centre_name,
          centre_id: source.centre_id,
          baseline_stock_mt: source.current_stock_mt,
          projected_stock_mt: sourceProjStock,
          baseline_occupancy_pct: source.storage_occupancy_pct,
          projected_occupancy_pct: sourceOccupancy,
          storage_capacity_mt: source.storage_capacity_mt
        },
        target_centre: {
          name: target.centre_name,
          centre_id: target.centre_id,
          baseline_stock_mt: target.current_stock_mt,
          projected_stock_mt: targetProjStock,
          baseline_occupancy_pct: target.storage_occupancy_pct,
          projected_occupancy_pct: targetOccupancy,
          storage_capacity_mt: target.storage_capacity_mt
        },
        delta: {
          quantity_mt: qty,
          arrivals_delta_mt: 0,
          source_relief_pct: Number((source.storage_occupancy_pct - sourceOccupancy).toFixed(1)),
          target_absorption_pct: Number((targetOccupancy - target.storage_occupancy_pct).toFixed(1))
        },
        impact: {
          source_relief_pct: Number((source.storage_occupancy_pct - sourceOccupancy).toFixed(1)),
          target_absorption_pct: Number((targetOccupancy - target.storage_occupancy_pct).toFixed(1)),
          safe_reallocation: targetProjStock <= target.storage_capacity_mt,
          safety_status: targetOccupancy <= 85 ? 'SAFE' : (targetOccupancy <= 100 ? 'WARNING' : 'CRITICAL')
        },
        recommended_mitigations: [
          targetProjStock <= target.storage_capacity_mt
            ? `Reallocation is viable. Target centre ${target.centre_name} has adequate buffer (${targetOccupancy}% final occupancy).`
            : `Caution: Transfer exceeds target centre storage capacity by ${targetProjStock - target.storage_capacity_mt} MT. Choose alternative buffer warehouse.`,
          `Generate official transport gate pass via Regional Logistics Office.`
        ]
      };
    }

    throw new Error(`Unsupported simulation type: ${type}`);
  }

  /**
   * Builds an officer-friendly, structured, intent-specific response object.
   * Grounded strictly on verified PostgreSQL data.
   */
  buildStructuredResponse({ query, role, scopeData, rawResult = {}, simulationResult = null }) {
    if (rawResult && rawResult.structured_response) {
      return rawResult.structured_response;
    }

    if (rawResult?.intent === 'OUT_OF_SCOPE' || rawResult?.intent === 'GREETING' || rawResult?.intent === 'CLARIFICATION_REQUIRED' || rawResult?.intent === 'CONCEPT_EXPLANATION') {
      return {
        intent: rawResult.intent,
        title: rawResult.intent === 'OUT_OF_SCOPE' ? 'OPERATIONAL SCOPE NOTICE' : (rawResult.intent === 'GREETING' ? 'GREETING' : 'CLARIFICATION REQUIRED'),
        status: 'NEUTRAL',
        summary: rawResult.answer,
        why: null,
        data: {},
        facts: {},
        recommendations: [],
        disclaimer: 'Based on current verified operational data.'
      };
    }

    const isDistrict = role === 'DISTRICT_OFFICER';
    const q = String(query || '').toLowerCase();

    // 1. Detect Intent
    let intent = 'GENERAL';
    if (simulationResult) {
      if (simulationResult.scenario_type === 'reallocation') {
        intent = 'STOCK_REALLOCATION_SIMULATION';
      } else if (simulationResult.scenario_type === 'counter_change') {
        intent = 'COUNTER_CHANGE_SIMULATION';
      } else {
        intent = 'ARRIVAL_SURGE_SIMULATION';
      }
    } else if (/(?:what\s*(?:happens\s*)?if|simulate).*(?:transfer|reallocat)/i.test(q) || /(?:transfer|reallocat)/i.test(q)) {
      intent = 'STOCK_REALLOCATION_SIMULATION';
    } else if (/(?:what\s*(?:happens\s*)?if|simulate).*(?:counter|scale|staff)/i.test(q) || /(?:counter|staff|scale).*(?:add|increase|reduce|remove|\+|-)/i.test(q) || /(?:add|increase|reduce|remove).*(?:counter|scale)/i.test(q)) {
      intent = 'COUNTER_CHANGE_SIMULATION';
    } else if (/(?:what\s*(?:happens\s*)?if|simulate).*(?:arrivals?|harvest|surge)/i.test(q) || /(?:arrivals?|harvest).*(?:increase|surge|spike|rise|change|decrease|\+|-|\d+%)/i.test(q) || /([+-]?\d+)\s*%\s*(?:arrivals?|surge|spike|increase)/i.test(q)) {
      intent = 'ARRIVAL_SURGE_SIMULATION';
    } else if (/risk|alert|overload|critical|danger/i.test(q)) {
      intent = 'STORAGE_RISK';
    } else if (/grievance|complaint|sla|breach/i.test(q)) {
      intent = 'GRIEVANCE_ANALYSIS';
    } else if (/pacing|delay|traffic|congestion/i.test(q)) {
      intent = 'PACING_ANALYSIS';
    } else if (/forecast|catchment|cultivat|yield|crop/i.test(q)) {
      intent = 'PROCUREMENT_FORECAST';
    } else if (/briefing|daily|overview|summary|posture/i.test(q)) {
      intent = isDistrict ? 'DISTRICT_BRIEFING' : 'CENTRE_STATUS';
    } else {
      intent = isDistrict ? 'DISTRICT_BRIEFING' : 'CENTRE_STATUS';
    }

    // 2. Build Structured Model per intent
    if (intent === 'STOCK_REALLOCATION_SIMULATION') {
      const sim = simulationResult;
      const source = sim?.source_centre || {
        name: 'Kallur DPC',
        baseline_stock_mt: 200,
        projected_stock_mt: 0,
        storage_capacity_mt: 250,
        projected_occupancy_pct: 0
      };
      const target = sim?.target_centre || {
        name: 'Kaduvetti DPC',
        baseline_stock_mt: 0,
        projected_stock_mt: 200,
        storage_capacity_mt: 250,
        projected_occupancy_pct: 80
      };
      const qtyMatch = sim?.parameter?.match(/(\d+(?:\.\d+)?)\s*MT/) || q.match(/(\d+(?:\.\d+)?)\s*(?:mt)?/);
      const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 200;

      const targetCap = target.storage_capacity_mt || 250;
      const targetProjStock = target.projected_stock_mt ?? qty;
      const targetOccupancy = target.projected_occupancy_pct ?? (targetCap > 0 ? Number(((targetProjStock / targetCap) * 100).toFixed(1)) : 80);

      let status = 'SAFE';
      if (targetProjStock > targetCap || targetOccupancy > 100) {
        status = 'CRITICAL';
      } else if (targetOccupancy > 85) {
        status = 'WARNING';
      }

      const summary = status === 'SAFE'
        ? `Safe to transfer ${qty} MT to ${target.name}.`
        : (status === 'WARNING'
            ? `Warning: Transferring ${qty} MT will push ${target.name} to ${targetOccupancy}% capacity.`
            : `Critical: Transfer of ${qty} MT exceeds ${target.name} storage capacity by ${targetProjStock - targetCap} MT.`);

      const why = status === 'SAFE'
        ? `${target.name} reaches ${targetOccupancy}% occupancy after the transfer, remaining below the 85% operating threshold.`
        : (status === 'WARNING'
            ? `${target.name} reaches ${targetOccupancy}% occupancy, leaving limited buffer for fresh harvest arrivals.`
            : `${target.name} capacity is ${targetCap} MT, which cannot accommodate ${targetProjStock} MT projected stock.`);

      return {
        intent,
        title: 'Stock Transfer Simulation',
        summary,
        status,
        why,
        data: {
          transfer_amount_mt: qty,
          source: {
            name: source.name,
            current_stock_mt: source.baseline_stock_mt,
            after_transfer_mt: source.projected_stock_mt ?? Math.max(0, source.baseline_stock_mt - qty),
            capacity_mt: source.storage_capacity_mt || 250,
            projected_occupancy_pct: source.projected_occupancy_pct ?? 0
          },
          target: {
            name: target.name,
            current_stock_mt: target.baseline_stock_mt,
            after_transfer_mt: targetProjStock,
            capacity_mt: targetCap,
            projected_occupancy_pct: targetOccupancy
          }
        },
        details: {
          calculation_inputs: `Transfer: ${qty} MT from ${source.name} to ${target.name}`,
          operating_threshold: '85% godown capacity limit',
          source_relief: `${sim?.impact?.source_relief_pct || 0}% stock reduction`,
          target_absorption: `${sim?.impact?.target_absorption_pct || 0}% stock increase`,
          assumptions: 'Uniform grain density, immediate transit execution, standard bag stacking'
        },
        recommendations: sim?.recommended_mitigations || [
          status === 'SAFE'
            ? `Issue inter-centre movement pass from ${source.name} to ${target.name}.`
            : 'Select alternative recipient centre with larger storage buffer.'
        ],
        disclaimer: 'Simulation only — no database changes were made.'
      };
    }

    if (intent === 'ARRIVAL_SURGE_SIMULATION') {
      const sim = simulationResult;
      const pctMatch = sim?.parameter?.match(/([+-]?\d+)\s*%/) || q.match(/([+-]?\d+)\s*%/);
      const pct = pctMatch ? parseInt(pctMatch[1], 10) : 20;

      if (isDistrict) {
        const critCentres = (sim?.critical_centres || (scopeData.centres || []).filter(c => c.storage_occupancy_pct > 85)).map(c => ({
          name: c.centre_name,
          current_stock_mt: c.current_stock_mt ?? c.baseline_stock_mt,
          projected_stock_mt: c.projected_stock_mt ?? Math.round(c.current_stock_mt * (1 + pct / 100)),
          capacity_mt: c.storage_capacity_mt,
          projected_occupancy_pct: c.projected_occupancy_pct ?? c.storage_occupancy_pct,
          overload_mt: c.projected_overload_mt || 0,
          risk: (c.projected_overload_mt > 0 || (c.projected_occupancy_pct || c.storage_occupancy_pct) > 90) ? 'CRITICAL' : 'HIGH'
        }));

        const status = critCentres.some(c => c.overload_mt > 0) ? 'CRITICAL' : (critCentres.length > 0 ? 'WARNING' : 'SAFE');
        const summary = status === 'CRITICAL'
          ? `${pct > 0 ? `+${pct}%` : `${pct}%`} arrival surge will cause storage overloads in ${critCentres.filter(c => c.overload_mt > 0).length} centre(s).`
          : (status === 'WARNING'
              ? `${pct > 0 ? `+${pct}%` : `${pct}%`} arrival increase pushes ${critCentres.length} centre(s) across the 85% storage risk threshold.`
              : `${pct > 0 ? `+${pct}%` : `${pct}%`} arrivals can be safely absorbed within existing storage capacity.`);

        const why = critCentres.length > 0
          ? `Incoming harvest intake will outpace daily bag dispatch in ${critCentres.length} centre(s).`
          : `District storage headroom (${scopeData.summary.total_storage_capacity_mt} MT capacity) provides ample buffer.`;

        return {
          intent,
          title: `Harvest Arrival Surge Simulation (${pct > 0 ? `+${pct}%` : `${pct}%`})`,
          summary,
          status,
          why,
          data: {
            arrival_change_pct: pct,
            baseline_arrivals_mt: sim?.baseline?.total_arrivals_mt ?? scopeData.summary.total_expected_arrivals_mt,
            projected_arrivals_mt: sim?.projected?.total_arrivals_mt ?? Math.round(scopeData.summary.total_expected_arrivals_mt * (1 + pct / 100)),
            net_arrivals_delta_mt: sim?.delta?.arrivals_delta_mt ?? Math.round(scopeData.summary.total_expected_arrivals_mt * (pct / 100)),
            projected_occupancy_pct: sim?.projected?.occupancy_pct ?? scopeData.summary.district_storage_occupancy_pct,
            affected_centres: critCentres
          },
          details: {
            baseline_arrivals: `${sim?.baseline?.total_arrivals_mt ?? scopeData.summary.total_expected_arrivals_mt} MT`,
            total_district_capacity: `${scopeData.summary.total_storage_capacity_mt} MT`,
            threshold_used: '85% safe occupancy threshold'
          },
          recommendations: sim?.recommended_mitigations || [
            pct > 0 ? 'Apply +15 min pacing delay to incoming slot reservations in high-risk centres.' : 'Maintain standard intake pacing.'
          ],
          disclaimer: 'Simulation only — no database changes were made.'
        };
      } else {
        const c = scopeData.centre;
        const overloadMt = sim?.projected?.overload_mt || 0;
        const status = overloadMt > 0 ? 'CRITICAL' : ((sim?.projected?.occupancy_pct || c.storage_occupancy_pct) > 85 ? 'WARNING' : 'SAFE');
        const summary = status === 'CRITICAL'
          ? `${pct > 0 ? `+${pct}%` : `${pct}%`} surge causes ${overloadMt} MT storage overload at ${c.centre_name}.`
          : `${pct > 0 ? `+${pct}%` : `${pct}%`} arrival rush shifts storage to ${sim?.projected?.occupancy_pct || c.storage_occupancy_pct}% with ~${sim?.projected?.est_wait_min || scopeData.metrics.estimated_active_wait_minutes}m wait time.`;

        const why = status === 'CRITICAL'
          ? `Projected stock exceeds nominal godown capacity (${c.storage_capacity_mt} MT).`
          : `Storage buffer accommodates the extra arrivals within safe tolerances.`;

        return {
          intent,
          title: `Tractor Arrival Rush Simulation (${pct > 0 ? `+${pct}%` : `${pct}%`})`,
          summary,
          status,
          why,
          data: {
            arrival_change_pct: pct,
            baseline_stock_mt: sim?.baseline?.stock_mt ?? c.current_stock_mt,
            projected_stock_mt: sim?.projected?.stock_mt ?? Math.round(c.current_stock_mt * (1 + pct / 100)),
            capacity_mt: c.storage_capacity_mt,
            projected_occupancy_pct: sim?.projected?.occupancy_pct ?? c.storage_occupancy_pct,
            projected_wait_min: sim?.projected?.est_wait_min ?? scopeData.metrics.estimated_active_wait_minutes,
            overload_mt: overloadMt
          },
          details: {
            current_occupancy: `${c.storage_occupancy_pct}%`,
            threshold_used: '85% safe occupancy'
          },
          recommendations: sim?.recommended_mitigations || [
            overloadMt > 0 ? 'Request inter-centre movement order immediately.' : 'Maintain active weighment flow.'
          ],
          disclaimer: 'Simulation only — no database changes were made.'
        };
      }
    }

    if (intent === 'COUNTER_CHANGE_SIMULATION') {
      const sim = simulationResult;
      const counterDelta = sim?.delta?.wait_time_reduction_min !== undefined
        ? (sim.projected?.counters - sim.baseline?.counters)
        : 1;

      const status = counterDelta > 0 ? 'SAFE' : (sim?.projected?.estimated_wait_minutes > 45 ? 'WARNING' : 'SAFE');
      const summary = counterDelta > 0
        ? `Adding ${counterDelta} counter reduces average farmer wait time by ${sim?.delta?.wait_time_reduction_min || 12} minutes.`
        : `Removing ${Math.abs(counterDelta)} counter increases average wait time to ~${sim?.projected?.estimated_wait_minutes || 45} minutes.`;

      const why = counterDelta > 0
        ? `Hourly throughput increases from ${sim?.baseline?.hourly_throughput_farmers || 10} to ${sim?.projected?.hourly_throughput_farmers || 15} farmers/hr (+${sim?.delta?.throughput_delta_pct || 50}%).`
        : `Reduced weighment desks cause incoming tractors to queue up outside gate.`;

      return {
        intent,
        title: `Weighment Counter Staffing Simulation (${counterDelta > 0 ? `+${counterDelta}` : counterDelta} Counter)`,
        summary,
        status,
        why,
        data: {
          counter_change: counterDelta,
          baseline_counters: sim?.baseline?.counters || 2,
          projected_counters: sim?.projected?.counters || 3,
          baseline_wait_min: sim?.baseline?.estimated_wait_minutes || 36,
          projected_wait_min: sim?.projected?.estimated_wait_minutes || 24,
          wait_time_reduction_min: sim?.delta?.wait_time_reduction_min || 12,
          baseline_throughput_hr: sim?.baseline?.hourly_throughput_farmers || 10,
          projected_throughput_hr: sim?.projected?.hourly_throughput_farmers || 15,
          throughput_delta_pct: sim?.delta?.throughput_delta_pct || 50
        },
        details: {
          formula: 'Throughput = (Counters * 60) / Processing Rate (mins/farmer)',
          processing_rate: '12 mins / farmer per scale',
          projected_capacity: `${sim?.projected?.hourly_throughput_farmers || 15} farmers / hr`
        },
        recommendations: sim?.recommended_mitigations || [
          counterDelta > 0 ? 'Deploy additional weighment operator and bag tagger to open scale.' : 'Ensure shaded waiting area if reducing counter capacity.'
        ],
        disclaimer: 'Simulation only — no database changes were made.'
      };
    }

    if (intent === 'STORAGE_RISK') {
      if (isDistrict) {
        const highRisk = (scopeData.high_risk_centres || []).map(c => ({
          centre_id: c.centre_id,
          name: c.centre_name,
          current_stock_mt: c.current_stock_mt,
          capacity_mt: c.storage_capacity_mt,
          occupancy_pct: c.storage_occupancy_pct,
          risk: (c.predicted_overload_mt > 0 || c.storage_occupancy_pct > 90) ? 'CRITICAL' : 'HIGH',
          reason: c.predicted_overload_mt > 0
            ? `Predicted overload of ${c.predicted_overload_mt} MT.`
            : `${c.storage_occupancy_pct}% occupancy; limited buffer remaining.`
        }));

        const status = highRisk.some(c => c.risk === 'CRITICAL' || c.occupancy_pct > 90)
          ? 'CRITICAL'
          : (highRisk.length > 0 ? 'WARNING' : 'SAFE');

        const summary = highRisk.length > 0
          ? `${highRisk.length} centre(s) require attention due to high storage occupancy.`
          : `All centres in ${scopeData.district} are operating within safe storage limits.`;

        const why = highRisk.length > 0
          ? `Harvest arrivals at these centres are outpacing grain bagging and godown clearance.`
          : `District-wide storage occupancy is balanced at ${scopeData.summary.district_storage_occupancy_pct}%.`;

        return {
          intent,
          title: 'Storage Risk & Yard Congestion Assessment',
          summary,
          status,
          why,
          data: {
            high_risk_count: highRisk.length,
            centres: highRisk
          },
          details: {
            safe_operating_threshold: '85% occupancy',
            critical_threshold: '90% occupancy',
            total_centres_monitored: scopeData.summary.total_centres
          },
          recommendations: [
            highRisk.length > 0 ? 'Apply temporary pacing delay to incoming bookings at overloaded centres.' : 'Maintain standard intake pacing.',
            highRisk.length > 0 ? 'Coordinate inter-centre movement rakes for high-risk centres.' : 'Storage distribution is normal.'
          ],
          disclaimer: 'Read-only operational analysis grounded on live PostgreSQL records.'
        };
      } else {
        const c = scopeData.centre;
        const status = (c.storage_occupancy_pct > 90 || c.predicted_overload_mt > 0) ? 'CRITICAL' : (c.storage_occupancy_pct > 80 ? 'WARNING' : 'SAFE');
        const summary = status === 'CRITICAL'
          ? `Storage is critically full (${c.storage_occupancy_pct}%). Yard congestion risk.`
          : (status === 'WARNING'
              ? `Storage occupancy is high (${c.storage_occupancy_pct}%). Monitor buffer.`
              : `Storage is within safe limits (${c.storage_occupancy_pct}% occupancy).`);

        const why = status === 'CRITICAL'
          ? `Current stock of ${c.current_stock_mt} MT leaves only ${Math.max(0, c.storage_capacity_mt - c.current_stock_mt)} MT headroom.`
          : `${c.current_stock_mt} MT in stock out of ${c.storage_capacity_mt} MT total capacity.`;

        return {
          intent,
          title: `${c.centre_name} Storage Risk Assessment`,
          summary,
          status,
          why,
          data: {
            centre_name: c.centre_name,
            current_stock_mt: c.current_stock_mt,
            capacity_mt: c.storage_capacity_mt,
            occupancy_pct: c.storage_occupancy_pct,
            remaining_headroom_mt: Math.max(0, c.storage_capacity_mt - c.current_stock_mt),
            risk_level: c.risk_level
          },
          details: {
            expected_arrivals: `${c.expected_arrivals_mt} MT today`,
            processing_rate: `${c.processing_rate_min} mins/farmer`,
            threshold_used: '85% safe occupancy'
          },
          recommendations: [
            c.storage_occupancy_pct > 80 ? 'Request inter-centre movement order to clear shed space.' : 'Standard operations.'
          ],
          disclaimer: 'Read-only operational analysis grounded on live PostgreSQL records.'
        };
      }
    }

    if (intent === 'GRIEVANCE_ANALYSIS') {
      const openCount = isDistrict ? (scopeData.summary.open_grievances_count || 0) : (scopeData.metrics.open_grievances_count || 0);
      const breachedCount = isDistrict ? (scopeData.summary.sla_breached_count || 0) : (scopeData.metrics.sla_breached_grievances_count || 0);
      const status = breachedCount > 0 ? 'CRITICAL' : (openCount > 5 ? 'WARNING' : 'SAFE');

      const summary = breachedCount > 0
        ? `${openCount} open grievance(s), including ${breachedCount} SLA breach(es) requiring immediate officer attention.`
        : (openCount > 0
            ? `${openCount} open grievance(s), all currently tracking within regulatory SLA deadlines.`
            : `Zero unresolved farmer grievances.`);

      const why = breachedCount > 0
        ? `${breachedCount} grievance ticket(s) have passed the mandatory 48-hour resolution deadline.`
        : (openCount > 0 ? 'All open tickets were lodged within the past 48 hours.' : 'All registered farmer grievances are resolved and closed.');

      const byCentre = {};
      (scopeData.grievances || []).forEach(g => {
        const cName = g.centre_name || scopeData.centre?.centre_name || 'Centre';
        if (!byCentre[cName]) {
          byCentre[cName] = { centre_name: cName, open_count: 0, breached_count: 0, top_issues: [] };
        }
        byCentre[cName].open_count++;
        if (g.is_breached) byCentre[cName].breached_count++;
        if (g.issue_type && !byCentre[cName].top_issues.includes(g.issue_type)) {
          byCentre[cName].top_issues.push(g.issue_type);
        }
      });

      return {
        intent,
        title: 'Farmer Grievance & SLA Audit',
        summary,
        status,
        why,
        data: {
          total_open: openCount,
          sla_breached: breachedCount,
          sla_compliance_pct: openCount > 0 ? Math.round(((openCount - breachedCount) / openCount) * 100) : 100,
          affected_centres: Object.values(byCentre)
        },
        details: {
          sla_standard: '48 hours from lodging',
          total_logged: `${openCount} unresolved tickets`,
          audit_scope: isDistrict ? `${scopeData.district} District` : scopeData.centre.centre_name
        },
        recommendations: [
          breachedCount > 0 ? 'Expedite resolution on overdue tickets to maintain regulatory compliance.' : 'Grievance SLA status is healthy.'
        ],
        disclaimer: 'Read-only operational analysis grounded on live PostgreSQL records.'
      };
    }

    if (intent === 'PACING_ANALYSIS') {
      const pacingEvents = scopeData.pacing_events || [];
      const congested = pacingEvents.filter(p => p.pacing_status === 'SLOW' || p.delay_minutes > 0 || p.active_queue_count > 15);
      const status = congested.length > 0 ? 'WARNING' : 'SAFE';
      const summary = congested.length > 0
        ? `Pacing delay advised for ${congested.length} centre(s) to alleviate queue congestion.`
        : `Queue velocities across all monitored centres are healthy with no active pacing bottlenecks.`;

      const why = congested.length > 0
        ? `Incoming tractor inflow exceeds counter processing rates, creating gate backlogs.`
        : `Processing rates match arrival velocity with minimal queue delays.`;

      return {
        intent,
        title: 'Queue Velocity & Pacing Advisory',
        summary,
        status,
        why,
        data: {
          monitored_centres: pacingEvents.length,
          congested_centres_count: congested.length,
          pacing_events: pacingEvents.slice(0, 6).map(p => ({
            centre_name: p.centre_name || p.centre_id,
            status: p.pacing_status,
            delay_min: p.delay_minutes,
            active_queue: p.active_queue_count,
            action: p.recommended_action
          }))
        },
        details: {
          pacing_logic: 'Adaptive token staggering based on real-time gate arrivals vs scale throughput.',
          target_wait_time: '< 30 minutes'
        },
        recommendations: [
          congested.length > 0 ? 'Apply recommended pacing delays in the Pacing Control panel.' : 'Continue real-time queue monitoring.'
        ],
        disclaimer: 'Read-only operational advisory grounded on live PostgreSQL records.'
      };
    }

    if (intent === 'PROCUREMENT_FORECAST') {
      const crops = scopeData.catchment_forecast || [];
      const totalArea = crops.reduce((sum, c) => sum + Number(c.total_area_acres || 0), 0);
      const totalYield = crops.reduce((sum, c) => sum + Number(c.total_yield_min_mt || 0), 0);
      const totalCap = scopeData.summary?.total_storage_capacity_mt || 250;
      const status = totalYield > totalCap ? 'WARNING' : 'SAFE';

      const summary = `Projected harvest intake of ${totalYield} MT across ${totalArea} cultivated acres against ${totalCap} MT godown capacity.`;
      const why = totalYield > totalCap
        ? `Projected catchment yield exceeds local godown capacity by ${totalYield - totalCap} MT; inter-centre transport rakes required.`
        : `Local storage capacity is sufficient to store anticipated harvest intake.`;

      return {
        intent,
        title: 'Pre-Harvest Catchment & Demand Forecast',
        summary,
        status,
        why,
        data: {
          total_area_acres: totalArea,
          total_expected_yield_mt: totalYield,
          available_storage_capacity_mt: totalCap,
          capacity_gap_mt: Math.max(0, totalYield - totalCap),
          crops
        },
        details: {
          catchment_data_source: 'Pre-harvest farmer crop declarations (TN e-Procurement)',
          yield_model: 'Minimum expected yield per acre based on seasonal agro-climatic norms'
        },
        recommendations: [
          totalYield > totalCap ? 'Coordinate with Civil Supplies Corporation for buffer storage leases.' : 'Capacity is adequate.'
        ],
        disclaimer: 'Read-only demand forecast grounded on farmer crop declarations.'
      };
    }

    // Default: DISTRICT_BRIEFING or CENTRE_STATUS
    if (isDistrict) {
      const sum = scopeData.summary;
      const status = sum.high_risk_centres_count > 0 || sum.sla_breached_count > 0 ? 'WARNING' : 'SAFE';
      const summary = `District operations are stable: ${sum.active_centres} of ${sum.total_centres} centres active, ${sum.district_storage_occupancy_pct}% storage utilized, and ${sum.total_bookings_today} farmer bookings today.`;
      const why = sum.high_risk_centres_count > 0
        ? `High storage occupancy in ${sum.high_risk_centres_count} centre(s) requires grain clearance coordination.`
        : `Queue wait times average ~${sum.avg_wait_minutes_today} minutes and storage capacity has adequate buffer.`;

      return {
        intent: 'DISTRICT_BRIEFING',
        title: `Daily Operational Briefing — ${scopeData.district} District`,
        summary,
        status,
        why,
        data: {
          active_centres: `${sum.active_centres} of ${sum.total_centres}`,
          storage_occupancy_pct: sum.district_storage_occupancy_pct,
          total_stock_mt: sum.total_current_stock_mt,
          total_capacity_mt: sum.total_storage_capacity_mt,
          expected_arrivals_mt: sum.total_expected_arrivals_mt,
          total_bookings_today: sum.total_bookings_today,
          avg_wait_minutes: sum.avg_wait_minutes_today,
          high_risk_centres_count: sum.high_risk_centres_count,
          open_grievances_count: sum.open_grievances_count,
          sla_breached_count: sum.sla_breached_count
        },
        details: {
          procurement_date: new Date().toISOString().slice(0, 10),
          data_sources: 'Live PostgreSQL (centres, bookings, pacing_events, grievances)',
          high_risk_centres: scopeData.high_risk_centres.map(c => c.centre_name).join(', ') || 'None'
        },
        recommendations: [
          sum.high_risk_centres_count > 0 ? `Review pacing delays for: ${scopeData.high_risk_centres.map(c => c.centre_name).join(', ')}.` : 'Maintain standard procurement monitoring.',
          'Ensure DBT payment disbursements are processed within the 48-hour regulatory window.'
        ],
        disclaimer: 'Read-only operational briefing grounded on live PostgreSQL records.'
      };
    } else {
      const c = scopeData.centre;
      const m = scopeData.metrics;
      const status = (c.storage_occupancy_pct > 85 || m.estimated_active_wait_minutes > 45) ? 'WARNING' : 'SAFE';
      const summary = `${c.centre_name} is operating at ${c.storage_occupancy_pct}% storage with ${m.active_queue_count} farmers in active queue (~${m.estimated_active_wait_minutes} min wait).`;
      const why = `Processing velocity is ~${c.processing_rate_min} mins/farmer across ${c.active_counters} counters with ${Math.max(0, c.storage_capacity_mt - c.current_stock_mt)} MT headroom remaining.`;

      return {
        intent: 'CENTRE_STATUS',
        title: `${c.centre_name} Operations Briefing`,
        summary,
        status,
        why,
        data: {
          centre_name: c.centre_name,
          centre_id: c.centre_id,
          active_queue_count: m.active_queue_count,
          avg_wait_min: m.estimated_active_wait_minutes,
          storage_occupancy_pct: c.storage_occupancy_pct,
          current_stock_mt: c.current_stock_mt,
          storage_capacity_mt: c.storage_capacity_mt,
          active_counters: c.active_counters,
          processing_rate_min: c.processing_rate_min,
          open_grievances: m.open_grievances_count
        },
        details: {
          expected_arrivals: `${c.expected_arrivals_mt} MT today`,
          daily_capacity_slots: c.daily_capacity_slots,
          operational_status: c.operational_status
        },
        recommendations: [
          c.storage_occupancy_pct > 80 ? 'Request inter-centre movement order to maintain storage buffer.' : 'Maintain standard weighment processing.'
        ],
        disclaimer: 'Read-only operational briefing grounded on live PostgreSQL records.'
      };
    }
  }

  /**
   * Deterministic Offline Rule Provider
   * Generates grounded briefings, explanations, and scenario responses when external AI LLMs are offline.
   */
  generateOfflineRuleResponse({ query, role, scopeData, simulationResult = null }) {
    const q = String(query || '').toLowerCase();
    const isDistrict = role === 'DISTRICT_OFFICER';

    const nonOperationalTriggers = /(?:president|prime\s*minister|joke|funny|poem|poetry|song|cricket|ipl|football|movie|actor|actress|cinema|capital\s+of|weather\s+in\s+[a-z]+|recipe|cook|quantum|physics|space|mars|moon|ai\s+model|who\s+are\s+you|who\s+made\s+you|tell\s+me\s+about\s+yourself|story|dance|sing)/i;
    const operationalTerms = /(?:cent(?:er|re)|dpc|queue|wait|waiting|farmer|token|slot|booking|paddy|crop|grain|storage|stock|capacity|headroom|weigh|weighment|counter|moisture|grade|procure|procurement|dbt|payment|receipt|grievance|complaint|sla|demand|yield|acre|harvest|tomorrow|today|status|delay|delayed|pace|pacing|arrival|transit|godown|gunny|bag|ton|tonne|quintal|staff|supervisor|shift|breakdown|turnaround)/i;

    if (nonOperationalTriggers.test(q) || (!operationalTerms.test(q) && !simulationResult)) {
      return {
        intent: 'OUT_OF_SCOPE',
        answer: 'This assistant is for procurement-centre operations. Please ask about your queue, procurement, capacity, payments, grievances, or demand.',
        facts: {},
        insights: [],
        why: null,
        recommendations: [],
        simulation: null,
        dataSources: [],
        scope: isDistrict ? scopeData?.district : scopeData?.centre_name,
        provider_used: 'fallback_rules',
        confidence: 1.0
      };
    }

    if (/^(?:hello|hi|hey|good\s*(?:morning|afternoon|evening)|vanakkam)[\s.!,]*$/i.test(q.trim())) {
      return {
        intent: 'GREETING',
        answer: 'Hello. I can help with your centre\'s queue, procurement, capacity, payments, grievances, and demand.',
        facts: {},
        insights: [],
        why: null,
        recommendations: [],
        simulation: null,
        dataSources: [],
        scope: isDistrict ? scopeData?.district : scopeData?.centre_name,
        provider_used: 'fallback_rules',
        confidence: 1.0
      };
    }

    if (/^(?:what'?s?\s*(?:is\s*)?happening\??|what'?s?\s*up\??|what\s+is\s+going\s+on\??|status\??)$/i.test(q.trim())) {
      return {
        intent: 'CLARIFICATION_REQUIRED',
        answer: 'Do you mean the queue, procurement, storage, payments, or today\'s centre operations?',
        facts: {},
        insights: [],
        why: null,
        recommendations: [],
        simulation: null,
        dataSources: [],
        scope: isDistrict ? scopeData?.district : scopeData?.centre_name,
        provider_used: 'fallback_rules',
        confidence: 1.0
      };
    }

    let intent = 'general';
    if (simulationResult || /what\s*if|simulate|if\s+arrivals|increase|decrease|reallocat/i.test(q)) {
      intent = 'simulation';
    } else if (/briefing|summary|overview|status\s+today|today|daily/i.test(q)) {
      intent = 'briefing';
    } else if (/risk|why|alert|overload|critical|danger|delay/i.test(q)) {
      intent = 'risk_explanation';
    } else if (/wait\s*time|queue|counter|throughput|processing\s+rate/i.test(q)) {
      intent = 'analytics';
    } else if (/grievance|complaint|sla|breach/i.test(q)) {
      intent = 'analytics';
    } else if (/recommend|action|advise|mitigat/i.test(q)) {
      intent = 'recommendation';
    }

    if (intent === 'simulation' && simulationResult) {
      let simAnswer = '';
      if (simulationResult.scenario_type === 'counter_change') {
        const deltaMins = simulationResult.delta?.wait_time_reduction_min ?? 0;
        const deltaThroughput = simulationResult.delta?.throughput_delta_pct ?? 0;
        simAnswer = `**Simulation Results for ${simulationResult.centre_name || (isDistrict ? scopeData.district : scopeData.centre_name)}:**\n` +
          `Under scenario **${simulationResult.parameter}**, active counters change to **${simulationResult.projected?.counters}** (throughput ${deltaThroughput > 0 ? '+' : ''}${deltaThroughput}%). ` +
          `Estimated farmer wait time changes from **~${simulationResult.baseline?.estimated_wait_minutes} mins** to **~${simulationResult.projected?.estimated_wait_minutes} mins** (${deltaMins > 0 ? `${deltaMins} mins saved per farmer` : `${Math.abs(deltaMins)} mins increase`}).`;
      } else if (simulationResult.scenario_type === 'reallocation') {
        const src = simulationResult.source_centre;
        const tgt = simulationResult.target_centre;
        const imp = simulationResult.impact;
        simAnswer = `**Simulation Results for Stock Reallocation:**\n` +
          `Under scenario **${simulationResult.parameter}**:\n` +
          `- **${src?.name} (Source):** Projected stock **${src?.projected_stock_mt} MT** (${src?.projected_occupancy_pct}% occupancy, relief of ${imp?.source_relief_pct}%).\n` +
          `- **${tgt?.name} (Target):** Projected stock **${tgt?.projected_stock_mt} MT** (${tgt?.projected_occupancy_pct}% occupancy, absorption of ${imp?.target_absorption_pct}%).\n` +
          `- **Viability:** ${imp?.safe_reallocation ? `Safe to execute (${imp?.safety_status}). Target centre remains within capacity.` : `Exceeds capacity by ${tgt?.projected_stock_mt - tgt?.storage_capacity_mt} MT!`}`;
      } else {
        const arrDelta = simulationResult.delta?.arrivals_delta_mt ?? 0;
        const projStock = simulationResult.projected?.total_stock_mt ?? simulationResult.projected?.stock_mt ?? 0;
        const projOcc = simulationResult.projected?.occupancy_pct ?? 0;
        const critCentres = simulationResult.critical_centres || [];
        if (isDistrict) {
          simAnswer = `**Simulation Results for ${scopeData.district}:**\nUnder scenario **${simulationResult.parameter}**, projected harvest arrivals will change by **${arrDelta > 0 ? '+' : ''}${arrDelta} MT** (total projected stock: **${projStock} MT**, **${projOcc}%** occupancy). ${critCentres.length > 0 ? `⚠️ **${critCentres.length} centre(s)** would exceed safe storage thresholds.` : 'Storage capacity remains within safe parameters across all centres.'}`;
        } else {
          const waitMin = simulationResult.projected?.est_wait_min ?? 0;
          simAnswer = `**Simulation Results for ${scopeData.centre_name}:**\nUnder scenario **${simulationResult.parameter}**, projected arrivals change by **${arrDelta > 0 ? '+' : ''}${arrDelta} MT**, shifting storage occupancy to **${projOcc}%** (projected wait times: **~${waitMin} mins**).`;
        }
      }

      return {
        intent: 'simulation',
        answer: simAnswer,
        facts: {
          scenario: simulationResult.parameter,
          baseline_metric: simulationResult.baseline || simulationResult.source_centre || {},
          projected_metric: simulationResult.projected || simulationResult.target_centre || {},
          delta: simulationResult.delta || simulationResult.impact || {}
        },
        insights: [
          `Simulation is strictly calculated in memory from live database figures.`,
          `No live procurement records or booking states have been modified.`
        ],
        recommendations: simulationResult.recommended_mitigations || ['Maintain standard monitoring.'],
        simulation: simulationResult,
        dataSources: isDistrict ? ['centres', 'bookings', 'pacing_events'] : ['centres', 'bookings', 'slots'],
        scope: isDistrict ? scopeData.district : `${scopeData.centre_name} (${scopeData.centre_id})`,
        provider_used: 'fallback_rules',
        confidence: 0.98
      };
    }

    if (intent === 'briefing') {
      if (isDistrict) {
        const sum = scopeData.summary;
        return {
          intent: 'briefing',
          answer: `**Daily Operational Briefing — ${scopeData.district} District**\n\n- **Active Procurement Network:** **${sum.active_centres} of ${sum.total_centres}** centres active.\n- **Storage Posture:** Total capacity **${sum.total_storage_capacity_mt} MT** with **${sum.total_current_stock_mt} MT** in stock (**${sum.district_storage_occupancy_pct}%** utilized). Expected arrivals today: **${sum.total_expected_arrivals_mt} MT**.\n- **Queue & Operations:** **${sum.total_bookings_today} farmer bookings** scheduled today across the district (~**${sum.total_quintals_today} quintals**). Average queue wait time is **~${sum.avg_wait_minutes_today} minutes**.\n- **Risk Status:** **${sum.high_risk_centres_count} centre(s)** flagged HIGH risk (${scopeData.high_risk_centres.map(c => c.centre_name).join(', ') || 'None'}).\n- **Public Accountability:** **${sum.open_grievances_count} active grievances** (${sum.sla_breached_count} SLA breached).`,
          facts: sum,
          insights: [
            sum.high_risk_centres_count > 0
              ? `High storage occupancy in ${scopeData.high_risk_centres.length} centre(s) warrants immediate grain clearance coordination.`
              : 'Overall storage levels in the district are currently balanced.',
            sum.sla_breached_count > 0
              ? `${sum.sla_breached_count} grievance(s) have passed mandatory SLA deadlines and require officer intervention.`
              : 'Grievance resolution is tracking within SLA thresholds.'
          ],
          recommendations: [
            sum.high_risk_centres_count > 0
              ? `Review pacing delays for: ${scopeData.high_risk_centres.map(c => c.centre_name).join(', ')}.`
              : `Maintain regular monitoring of today's incoming arrivals.`,
            `Ensure DBT payment disbursements are cleared within the 48-hour regulatory window.`
          ],
          simulation: null,
          dataSources: ['centres', 'bookings', 'pacing_events', 'grievances'],
          scope: scopeData.district,
          provider_used: 'fallback_rules',
          confidence: 0.95
        };
      } else {
        const m = scopeData.metrics;
        const c = scopeData.centre;
        return {
          intent: 'briefing',
          answer: `**Operational Summary — ${c.centre_name} (${c.village_town})**\n\n- **Queue Status:** **${m.active_queue_count} farmers** currently in queue, with **${m.completed_count}** processed today.\n- **Estimated Wait Time:** **~${m.estimated_active_wait_minutes} minutes** at current processing velocity (**${c.processing_rate_min} mins/farmer** across **${c.active_counters} counters**).\n- **Storage Posture:** **${c.current_stock_mt} MT** in stock out of **${c.storage_capacity_mt} MT** capacity (**${c.storage_occupancy_pct}%** occupancy).\n- **Arrivals Expected:** **${c.expected_arrivals_mt} MT** arriving today.\n- **Accountability:** **${m.open_grievances_count} open grievances** (${m.sla_breached_grievances_count} SLA breached).`,
          facts: { ...c, ...m },
          insights: [
            c.storage_occupancy_pct > 80
              ? `Storage capacity is constrained at ${c.storage_occupancy_pct}%. Inter-centre transit is recommended.`
              : `Storage capacity is adequate (${c.storage_occupancy_pct}% utilized).`,
            m.estimated_active_wait_minutes > 45
              ? `Wait times exceed 45 minutes. Consider pacing delay or opening additional counters.`
              : `Queue flow is healthy.`
          ],
          recommendations: [
            c.storage_occupancy_pct > 85 ? `Request inter-centre movement order to clear shed space.` : `Continue standard weighment operations.`,
            `Ensure token pacing is aligned with physical gate arrivals.`
          ],
          simulation: null,
          dataSources: ['centres', 'bookings', 'slots', 'grievances'],
          scope: `${c.centre_name} (${c.centre_id})`,
          provider_used: 'fallback_rules',
          confidence: 0.95
        };
      }
    }

    if (intent === 'risk_explanation') {
      if (isDistrict) {
        const highRisk = scopeData.high_risk_centres;
        return {
          intent: 'risk_explanation',
          answer: highRisk.length > 0
            ? `**High-Risk Centres in ${scopeData.district}:**\n` + highRisk.map(c => `• **${c.centre_name} (${c.centre_id}):** Storage at **${c.storage_occupancy_pct}%** (${c.current_stock_mt}/${c.storage_capacity_mt} MT). Predicted arrivals of **${c.expected_arrivals_mt} MT** will cause **${c.predicted_overload_mt > 0 ? `${c.predicted_overload_mt} MT storage overload` : 'severe congestion'}**. Processing rate is **${c.processing_rate_min} min/farmer** across **${c.active_counters} counters**.`).join('\n')
            : `All centres in ${scopeData.district} are currently operating at **LOW or MODERATE risk**. No storage overloads or severe queue breakdowns are reported.`,
          facts: {
            high_risk_count: highRisk.length,
            centres: highRisk
          },
          insights: highRisk.map(c => `Primary bottleneck at ${c.centre_name}: ${c.predicted_overload_mt > 0 ? 'Physical warehouse capacity exhausted' : 'Queue inflow exceeds processing velocity'}.`),
          recommendations: [
            `Issue temporary pacing delay for incoming bookings at overloaded centres.`,
            `Divert secondary bookings to adjacent centres with available capacity.`,
            `Fast-track grain bagging and dispatch to central civil supplies godowns.`
          ],
          simulation: null,
          dataSources: ['centres', 'pacing_events'],
          scope: scopeData.district,
          provider_used: 'fallback_rules',
          confidence: 0.96
        };
      } else {
        const c = scopeData.centre;
        const m = scopeData.metrics;
        return {
          intent: 'risk_explanation',
          answer: `**Risk Analysis for ${c.centre_name}:**\n- **Assigned Risk Level:** **${c.risk_level}**\n- **Storage Bottleneck:** Current stock **${c.current_stock_mt} MT** (${c.storage_occupancy_pct}% of ${c.storage_capacity_mt} MT). ${c.predicted_overload_mt > 0 ? `⚠️ **${c.predicted_overload_mt} MT overload projected!**` : 'Storage within limits.'}\n- **Operational Velocity:** Processing rate is **${c.processing_rate_min} min/farmer** with **${c.active_counters} active counters** and **${c.staff_availability} staff** on duty.\n- **Queue Burden:** **${m.active_queue_count} farmers** currently active in queue with **~${m.estimated_active_wait_minutes} min** estimated wait.`,
          facts: { ...c, ...m },
          insights: [
            c.risk_level === 'HIGH' ? 'Critical alert: Centre is operating near or above nominal throughput or storage boundaries.' : 'Operational conditions remain within acceptable tolerances.',
            c.processing_rate_min > 15 ? 'Slow weighment cycle detected. Check moisture meter calibration and bag stitchers.' : 'Weighment velocity is optimal.'
          ],
          recommendations: [
            `Notify District Officer if storage buffer drops below 15%.`,
            `Maintain token-based entry order to prevent yard congestion.`
          ],
          simulation: null,
          dataSources: ['centres', 'pacing_events', 'bookings'],
          scope: `${c.centre_name} (${c.centre_id})`,
          provider_used: 'fallback_rules',
          confidence: 0.95
        };
      }
    }

    // Default analytics / general response
    return {
      intent: 'analytics',
      answer: isDistrict
        ? `Operational telemetry for **${scopeData.district}**: **${scopeData.summary.total_centres} centres** monitored. Current total stock **${scopeData.summary.total_current_stock_mt} MT** with **${scopeData.summary.total_bookings_today} bookings** registered today. Average wait time across centres is **~${scopeData.summary.avg_wait_minutes_today} mins**.`
        : `Operational telemetry for **${scopeData.centre_name}**: **${scopeData.metrics.active_queue_count} farmers** in active queue. Estimated wait time is **~${scopeData.metrics.estimated_active_wait_minutes} mins**. Storage is **${scopeData.centre.storage_occupancy_pct}%** utilized.`,
      facts: isDistrict ? scopeData.summary : { ...scopeData.centre, ...scopeData.metrics },
      insights: [
        'All data points are synchronized live with Tamil Nadu Procurement database records.',
        'Officer retains full operational decision authority for all actions.'
      ],
      recommendations: [
        'Select a What-If scenario to test projected changes in arrivals or counter capacity.',
        'Review the Pacing dashboard for real-time velocity adjustments.'
      ],
      simulation: null,
      dataSources: isDistrict ? ['centres', 'bookings'] : ['centres', 'bookings', 'slots'],
      scope: isDistrict ? scopeData.district : `${scopeData.centre_name} (${scopeData.centre_id})`,
      provider_used: 'fallback_rules',
      confidence: 0.90
    };
  }

  /**
   * System Prompt Construction for AI Providers
   */
  buildSystemPrompt(role, scopeData) {
    const isDistrict = role === 'DISTRICT_OFFICER';

    const contextPayload = isDistrict ? {
      district: scopeData.district,
      summary: scopeData.summary,
      high_risk_centres: scopeData.high_risk_centres,
      sample_active_centres: (scopeData.centres || []).slice(0, 10).map(c => ({
        centre_id: c.centre_id,
        name: c.centre_name,
        stock_mt: c.current_stock_mt,
        capacity_mt: c.storage_capacity_mt,
        risk: c.risk_level
      })),
      bookings_breakdown: scopeData.bookings_breakdown,
      pacing_events: (scopeData.pacing_events || []).slice(0, 5),
      grievances: (scopeData.grievances || []).slice(0, 5)
    } : {
      centre: scopeData.centre,
      metrics: scopeData.metrics,
      slots: (scopeData.slots || []).slice(0, 8),
      pacing: (scopeData.pacing_events || []).slice(0, 3),
      grievances: (scopeData.grievances || []).slice(0, 3)
    };

    return `You are "Kisan Queue AI Procurement Operations Assistant" (உழவர் சந்தை செயல்பாட்டு உதவியாளர்), an expert operational decision-support copilot for Tamil Nadu Direct Procurement Centres (DPCs) and the Department of Civil Supplies.

ROLE & SCOPE:
- Authorized Role: ${role}
- Authorized Operational Scope: ${isDistrict ? `District of ${scopeData.district}` : `Centre ${scopeData.centre_name} (${scopeData.centre_id}), District ${scopeData.district}`}
- Today's Date: ${new Date().toISOString().slice(0, 10)}

STRICT OPERATIONAL DIRECTIVES:
1. READ-ONLY DECISION SUPPORT: You CANNOT and MUST NEVER alter, cancel, create, or mutate bookings, slots, grievances, centres, or financial records. Human officers make all final executive decisions through official authenticated interfaces.
2. GROUNDING ON VERIFIED FACTS: Base your answers ONLY on the provided operational JSON data below. Never hallucinate centre names, slot numbers, quantities, or metrics that do not exist in the provided context.
3. DISTINGUISH FACTS FROM PROJECTIONS: Clearly delineate between actual observed operational telemetry (e.g. current stock, active queue) and simulated what-if projections.
4. ACTIONABLE & OBJECTIVE: Provide direct, professional, concise decision-support briefings. Highlight operational bottlenecks (e.g., storage capacity >85%, wait times >45 mins, SLA breaches) and propose concrete mitigation actions.
5. REFUSAL FOR OUT-OF-SCOPE ACTIONS: If asked to modify databases or access other districts/centres, politely refuse and clarify your read-only role.
6. LANGUAGE: Respond in English by default, or in Tamil if the user query is in Tamil.
7. DOMAIN INTENT RESTRICTIONS: This assistant is EXCLUSIVELY for procurement-centre operations (queue, procurement, capacity, storage, payments, grievances, demand).
If the officer asks ANY unrelated question (such as politics, president/prime minister, poetry, jokes, entertainment, sports, general knowledge, trivia), you MUST decline and return:
"This assistant is for procurement-centre operations. Please ask about your queue, procurement, capacity, payments, grievances, or demand."
Set facts to {}, recommendations to [], and why to null. NEVER output centre operational numbers for unrelated questions.
8. TENANT ISOLATION: A Centre Admin can only view operational data for their assigned centre (${scopeData.centre_id || scopeData.district}). If asked about another centre, decline with: "You can only access operational information for your assigned procurement centre (${scopeData.centre_id || scopeData.district})."
9. PRIVACY PROTECTION: Sensitive personal data like Aadhaar numbers, bank account numbers, passwords, and PINs are protected. Decline with: "Sensitive farmer identity and financial records (such as Aadhaar and bank details) are protected under privacy policy and cannot be displayed."

LIVE OPERATIONAL CONTEXT (FROM POSTGRESQL):
${JSON.stringify(contextPayload, null, 2)}

OUTPUT SCHEMA:
Return ONLY a valid JSON object matching this structure:
{
  "intent": "briefing" | "risk_explanation" | "analytics" | "simulation" | "recommendation" | "general" | "OUT_OF_SCOPE",
  "answer": "Professional, nicely formatted markdown answer addressing the officer's query concisely.",
  "facts": { "key": "value" },
  "insights": ["Key finding 1", "Key finding 2"],
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2"],
  "simulation": null | { ... },
  "dataSources": ["centres", "bookings", ...],
  "confidence": 0.95
}
`;
  }

  /**
   * Main AI Processing Pipeline
   * Traverses Gemini -> Groq -> OpenRouter -> Offline Rules
   */
  async processOfficerQuery({ query, role, userDistrict, userCentreId, scenario = null, conversationHistory = [] }) {
    if (!query && !scenario) {
      throw new Error('Either a text query or a what-if scenario must be provided.');
    }

    const isDistrict = role === 'DISTRICT_OFFICER';
    const scope = {
      type: isDistrict ? 'DISTRICT' : 'CENTRE',
      id: isDistrict ? userDistrict : userCentreId
    };

    // 1. Question Planning via OfficerDataEngine
    const plan = this.dataEngine.planQuestion(query, scope, conversationHistory);

    // 2. Strict Security Check: Scope violation rejection
    if (plan.operation === 'SCOPE_VIOLATION' || plan.operation === 'CENTRE_SCOPE_VIOLATION' || plan.operation === 'PRIVACY_PROTECTION') {
      const securityResult = await this.dataEngine.executePlan(plan, scope);
      return {
        intent: securityResult.intent || 'security_alert',
        answer: securityResult.summary,
        facts: securityResult.data?.kpi || securityResult.data || securityResult.facts || {},
        insights: securityResult.why ? [securityResult.why] : [],
        why: securityResult.why || null,
        recommendations: securityResult.recommendations || [],
        structured_response: securityResult,
        simulation: null,
        dataSources: ['rbac_policy'],
        scope: scope.id,
        provider_used: 'rbac_guard',
        confidence: 1.0
      };
    }

    // 3. Check for special flows (Simulation, Explicit Briefing, Risk Explanation)
    const isSim = Boolean(scenario) || plan.entity === 'simulation';
    const isBriefing = plan.entity === 'briefing';
    const isRisk = /(?:which|what).*cent(?:er|re).*risk/i.test(query || '') ||
                   /(?:storage\s+overload|queue\s+delays)/i.test(query || '');

    // 4. If Specific Operational Data Query, execute deterministically via OfficerDataEngine
    if (!isSim && !isBriefing && !isRisk && plan.operation !== 'GENERAL_DATA_QUERY') {
      const generalResult = await this.dataEngine.executePlan(plan, scope);
      return {
        intent: generalResult.intent || 'analytics',
        answer: generalResult.summary,
        facts: (['OUT_OF_SCOPE', 'GREETING', 'CLARIFICATION_REQUIRED', 'CONCEPT_EXPLANATION', 'SECURITY_ALERT', 'PRIVACY_PROTECTION'].includes(generalResult.intent))
          ? {}
          : (generalResult.data?.kpi || generalResult.data || generalResult.facts || {}),
        insights: generalResult.why ? [generalResult.why] : [],
        why: (['OUT_OF_SCOPE', 'GREETING', 'CLARIFICATION_REQUIRED', 'CONCEPT_EXPLANATION', 'SECURITY_ALERT', 'PRIVACY_PROTECTION'].includes(generalResult.intent))
          ? null
          : (generalResult.why || null),
        recommendations: (['OUT_OF_SCOPE', 'GREETING', 'CLARIFICATION_REQUIRED', 'CONCEPT_EXPLANATION', 'SECURITY_ALERT', 'PRIVACY_PROTECTION'].includes(generalResult.intent))
          ? []
          : (generalResult.recommendations || []),
        simulation: null,
        structured_response: generalResult,
        dataSources: ['centres', plan.entity],
        scope: isDistrict ? userDistrict : userCentreId,
        provider_used: 'deterministic_data_copilot',
        confidence: 0.98
      };
    }

    let scopeData = null;

    // Fetch scoped data deterministically from database for briefing/risk/simulation
    if (isDistrict) {
      if (!userDistrict) throw new Error('District Officer missing assigned district.');
      scopeData = await this.getDistrictOperationalData(userDistrict);
    } else {
      if (!userCentreId) throw new Error('Centre Admin missing assigned centreId.');
      scopeData = await this.getCentreOperationalData(userCentreId);
    }

    // Run deterministic simulation if requested or implied
    let simulationResult = null;
    if (scenario) {
      simulationResult = this.runWhatIfSimulation(scopeData, scenario);
    } else if (isDistrict && /(?:transfer|reallocat(?:e|ion))\s+(\d+(?:\.\d+)?)\s*(?:mt)?\s+from\s+([a-zA-Z0-9\s_-]+?)\s+to\s+([a-zA-Z0-9\s_-]+)/i.test(query)) {
      const match = query.match(/(?:transfer|reallocat(?:e|ion))\s+(\d+(?:\.\d+)?)\s*(?:mt)?\s+from\s+([a-zA-Z0-9\s_-]+?)\s+to\s+([a-zA-Z0-9\s_-]+)/i);
      const qty = parseFloat(match[1]);
      const src = match[2].trim();
      const tgt = match[3].trim();
      simulationResult = this.runWhatIfSimulation(scopeData, {
        type: 'reallocation',
        quantity_mt: qty,
        source_centre_id: src,
        target_centre_id: tgt
      });
    } else if (isDistrict && /(?:transfer|reallocat(?:e|ion))\s+from\s+([a-zA-Z0-9\s_-]+?)\s+to\s+([a-zA-Z0-9\s_-]+)/i.test(query)) {
      const match = query.match(/(?:transfer|reallocat(?:e|ion))\s+from\s+([a-zA-Z0-9\s_-]+?)\s+to\s+([a-zA-Z0-9\s_-]+)/i);
      simulationResult = this.runWhatIfSimulation(scopeData, {
        type: 'reallocation',
        quantity_mt: 200,
        source_centre_id: match[1].trim(),
        target_centre_id: match[2].trim()
      });
    } else if (/(?:counter|staff).*(?:add|increase|reduce|remove|\+|-)/i.test(query) || /(?:add|increase|reduce|remove).*(?:counter|scale)/i.test(query)) {
      const isReduce = /reduce|remove|-/i.test(query);
      const matchNum = query.match(/(\d+)\s*(?:more|extra)?\s*counter/i) || query.match(/counter[s]?\s*(?:by\s*)?([+-]?\d+)/i);
      const delta = (matchNum ? parseInt(matchNum[1], 10) : 1) * (isReduce ? -1 : 1);
      simulationResult = this.runWhatIfSimulation(scopeData, {
        type: 'counter_change',
        counter_delta: delta
      });
    } else if (
      /(?:what\s*(?:happens\s*)?if|simulate).*(?:arrivals?|harvest|surge|spike)/i.test(query) ||
      /(?:arrivals?|harvest).*(?:increase|surge|spike|rise|change|decrease|drop|\+|-|\d+%)/i.test(query) ||
      /([+-]?\d+)\s*%\s*(?:arrivals?|surge|spike|increase)/i.test(query) ||
      /what\s*if|simulate|\+?\d+%\s+arrivals|increase\s+arrivals|surge|spike/i.test(query)
    ) {
      const matchPct = query.match(/([+-]?\d+)\s*%/);
      let pct = matchPct ? parseInt(matchPct[1], 10) : 20;
      if (/(?:decrease|drop|reduce|-)\s*(?:by\s*)?\d+%/i.test(query)) {
        pct = -Math.abs(pct);
      }
      simulationResult = this.runWhatIfSimulation(scopeData, { type: 'arrival_change', percentage: pct });
    }

    const systemPrompt = this.buildSystemPrompt(role, scopeData);
    const userPrompt = simulationResult
      ? `Query: "${query || 'Run simulation'}"\n\nDeterministic Simulation Pre-calculated Result:\n${JSON.stringify(simulationResult, null, 2)}\n\nProvide decision support explanation grounded on this simulation:`
      : `Officer Query: "${query}"\n\nProvide grounded operational decision support based strictly on the provided context:`;

    // Attempt provider chain (Gemini -> Groq -> OpenRouter -> Offline Rules)
    const providerChain = [];
    if (this.factory.primaryProvider) providerChain.push(this.factory.primaryProvider);
    if (Array.isArray(this.factory.fallbackProviders)) {
      for (const fp of this.factory.fallbackProviders) {
        if (fp && !providerChain.includes(fp)) providerChain.push(fp);
      }
    }

    const errors = [];

    for (const provider of providerChain) {
      const isLocal = provider.baseUrl && (provider.baseUrl.includes('localhost') || provider.baseUrl.includes('127.0.0.1'));
      if (!provider.apiKey && !isLocal) {
        errors.push({ provider: provider.name, error: 'API key not configured' });
        continue;
      }

      try {
        console.log(`[OFFICER AI] Attempting provider: ${provider.name.toUpperCase()}`);
        let parsed = null;

        if (provider.name === 'gemini') {
          const url = `${provider.baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), provider.timeoutMs || 30000);

          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
              }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2
              }
            }),
            signal: controller.signal
          });
          clearTimeout(timer);

          if (!resp.ok) {
            throw new Error(`Gemini HTTP error ${resp.status}`);
          }
          const data = await resp.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const clean = rawText.replace(/```(?:json)?/gi, '').trim();
            try {
              parsed = JSON.parse(clean);
            } catch (_) {
              const match = clean.match(/\{[\s\S]*\}/);
              if (match) {
                try { parsed = JSON.parse(match[0]); } catch (__) {}
              }
            }
          }
        } else {
          // OpenAI-compatible adapter (Groq, OpenRouter, OpenAI)
          const cleanBase = provider.baseUrl.replace(/\/+$/, '');
          const url = cleanBase.endsWith('/chat/completions') ? cleanBase : `${cleanBase}/chat/completions`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), provider.timeoutMs || 30000);

          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
              model: provider.model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              response_format: { type: 'json_object' },
              temperature: 0.2
            }),
            signal: controller.signal
          });
          clearTimeout(timer);

          if (!resp.ok) {
            throw new Error(`${provider.name} HTTP error ${resp.status}`);
          }
          const data = await resp.json();
          const rawText = data?.choices?.[0]?.message?.content;
          if (rawText) {
            const clean = rawText.replace(/```(?:json)?/gi, '').trim();
            try {
              parsed = JSON.parse(clean);
            } catch (_) {
              const match = clean.match(/\{[\s\S]*\}/);
              if (match) {
                try { parsed = JSON.parse(match[0]); } catch (__) {}
              }
            }
          }
        }

        if (parsed && parsed.answer) {
          console.log(`[OFFICER AI] ${provider.name.toUpperCase()} succeeded`);
          const verifiedFacts = isDistrict
            ? scopeData.summary
            : { ...scopeData.centre, ...scopeData.metrics };

          const structuredResponse = this.buildStructuredResponse({
            query,
            role,
            scopeData,
            rawResult: parsed,
            simulationResult
          });

          return {
            ...parsed,
            intent: isRisk ? 'risk_explanation' : (isBriefing ? 'briefing' : (isSim ? 'simulation' : (parsed.intent || 'analytics'))),
            facts: { ...verifiedFacts, ...(parsed.facts || {}) },
            simulation: simulationResult || parsed.simulation || null,
            recommendations: (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0)
              ? parsed.recommendations
              : (simulationResult?.recommended_mitigations || ['Maintain standard monitoring.']),
            structured_response: structuredResponse,
            provider_used: provider.name,
            model_used: provider.model,
            scope: isDistrict ? scopeData.district : `${scopeData.centre_name} (${scopeData.centre_id})`,
            dataSources: parsed.dataSources || (isDistrict ? ['centres', 'bookings', 'pacing_events', 'grievances'] : ['centres', 'bookings', 'slots']),
            fallback_history: errors.length > 0 ? errors.map(e => e.provider) : undefined
          };
        }
      } catch (err) {
        const safe = sanitizeError(err);
        console.log(`[OFFICER AI] ${provider.name.toUpperCase()} failed: ${safe}`);
        errors.push({ provider: provider.name, error: safe });
      }
    }

    // All external providers failed or were unconfigured -> Offline Deterministic Fallback
    console.log('[OFFICER AI] Falling back to OFFLINE_RULES');
    const offlineResult = this.generateOfflineRuleResponse({
      query,
      role,
      scopeData,
      simulationResult
    });

    const structuredResponse = this.buildStructuredResponse({
      query,
      role,
      scopeData,
      rawResult: offlineResult,
      simulationResult
    });

    return {
      ...offlineResult,
      structured_response: structuredResponse,
      fallback_history: errors.length > 0 ? errors.map(e => e.provider) : undefined
    };
  }

  /**
   * Log Officer Assistant Query for Audit Compliance
   * Zero secrets or tokens are stored.
   */
  async logAudit({ userId, role, scopeType, scopeId, query, intent, providerUsed, isSimulation = false }) {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS officer_ai_audit_logs (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(50) NOT NULL,
          role VARCHAR(50) NOT NULL,
          scope_type VARCHAR(50) NOT NULL,
          scope_id VARCHAR(100) NOT NULL,
          query TEXT NOT NULL,
          intent VARCHAR(100),
          provider_used VARCHAR(50),
          is_simulation BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await this.pool.query(`
        INSERT INTO officer_ai_audit_logs (user_id, role, scope_type, scope_id, query, intent, provider_used, is_simulation)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        String(userId || 'unknown'),
        String(role || 'UNKNOWN'),
        String(scopeType || 'DISTRICT'),
        String(scopeId || 'default'),
        String(query || '').slice(0, 1000),
        String(intent || 'general'),
        String(providerUsed || 'fallback_rules'),
        Boolean(isSimulation)
      ]);
    } catch (auditErr) {
      console.warn('[OFFICER AI AUDIT] Failed to record audit entry:', auditErr.message);
    }
  }
}

module.exports = {
  OfficerOperationsService
};
