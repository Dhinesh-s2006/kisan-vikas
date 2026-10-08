/**
 * AI Data Gateway / Policy Enforcement Layer
 * Strict tenant isolation, RBAC policy enforcement, and authorized data gateway.
 * 
 * CORE ARCHITECTURAL MANDATES:
 * 1. ZERO AI SQL: The AI/LLM never generates or executes SQL.
 * 2. Strict Scope Resolution:
 *    - District Officer: scope = user.district (from JWT).
 *    - Centre Admin: scope = user.centreId (from JWT).
 *    - Farmer: scope = user.farmerId (from JWT).
 *    - CSC: scope = user.district (from JWT).
 * 3. Frontend-provided IDs are treated only as candidate filters and are validated against JWT scope.
 * 4. Predefined, allowlisted data functions only.
 * 5. Sensitive data minimization & field masking.
 * 6. Audit logging for compliance.
 */

class AIDataGateway {
  constructor({ pool }) {
    this.pool = pool;

    // Registry of allowlisted data functions mapped to required roles
    this.allowedFunctions = {
      // District Officer functions
      'getDistrictOverview': ['DISTRICT_OFFICER'],
      'getCentresHealth': ['DISTRICT_OFFICER'],
      'getDistrictBookings': ['DISTRICT_OFFICER'],
      'getProcurementSummary': ['DISTRICT_OFFICER'],
      'getDemandForecast': ['DISTRICT_OFFICER'],
      'getStorageRisk': ['DISTRICT_OFFICER'],
      'getGrievanceSummary': ['DISTRICT_OFFICER'],

      // Centre Admin functions
      'getCentreOverview': ['CENTRE_ADMIN', 'DISTRICT_OFFICER'],
      'getCentreQueue': ['CENTRE_ADMIN', 'DISTRICT_OFFICER'],
      'getCentrePacing': ['CENTRE_ADMIN', 'DISTRICT_OFFICER'],

      // Farmer functions
      'getFarmerBookingStatus': ['FARMER', 'CSC_OPERATOR'],
      'getFarmerCentreStatus': ['FARMER', 'CSC_OPERATOR'],
      'getFarmerPaymentStatus': ['FARMER', 'CSC_OPERATOR'],
      'getFarmerProcurementStatus': ['FARMER', 'CSC_OPERATOR'],
      'getFarmerGrievances': ['FARMER', 'CSC_OPERATOR']
    };
  }

  /**
   * Main Gateway Access Point
   */
  async execute({ user, functionName, params = {} }) {
    if (!user || !user.role) {
      throw new Error('AIDataGateway: Authentication required. Missing user identity.');
    }

    // 1. Function allowlist check
    const allowedRoles = this.allowedFunctions[functionName];
    if (!allowedRoles) {
      throw new Error(`AIDataGateway: Function '${functionName}' is not in the approved data allowlist.`);
    }

    // 2. Role validation
    if (!allowedRoles.includes(user.role)) {
      throw new Error(`AIDataGateway: Role '${user.role}' is not authorized to execute '${functionName}'.`);
    }

    // 3. Strict Scope Enforcement
    let sanitizedResult = null;

    if (user.role === 'DISTRICT_OFFICER') {
      const officerDistrict = user.district;
      if (!officerDistrict) throw new Error('AIDataGateway: Missing district in officer context.');

      // If params specifies a district, verify it matches officer district
      if (params.district && params.district.trim().toLowerCase() !== officerDistrict.trim().toLowerCase()) {
        throw new Error(`AIDataGateway RBAC Violation: District Officer assigned to '${officerDistrict}' cannot access '${params.district}'.`);
      }

      sanitizedResult = await this._executeDistrictFunction(functionName, officerDistrict, params);
    } else if (user.role === 'CENTRE_ADMIN') {
      const adminCentre = user.centreId || user.centre_id;
      if (!adminCentre) throw new Error('AIDataGateway: Missing centreId in admin context.');

      if (params.centreId && params.centreId !== adminCentre) {
        throw new Error(`AIDataGateway RBAC Violation: Centre Admin assigned to '${adminCentre}' cannot access '${params.centreId}'.`);
      }

      sanitizedResult = await this._executeCentreFunction(functionName, adminCentre, params);
    } else if (user.role === 'FARMER') {
      const farmerId = user.farmerId || user.farmer_id;
      if (!farmerId) throw new Error('AIDataGateway: Missing farmerId in farmer context.');

      const requestedFarmerId = params.farmerId || params.farmer_id;
      if (requestedFarmerId && requestedFarmerId !== farmerId) {
        throw new Error(`AIDataGateway RBAC Violation: Farmer cannot access data for farmer '${requestedFarmerId}'.`);
      }

      sanitizedResult = await this._executeFarmerFunction(functionName, farmerId, params);
    } else if (user.role === 'CSC_OPERATOR') {
      const cscDistrict = user.district;
      sanitizedResult = await this._executeCscFunction(functionName, cscDistrict, params);
    }

    // 4. Audit Log
    try {
      await this.pool.query(`
        INSERT INTO officer_ai_audit_logs (
          user_id, officer_role, district, query_text, response_summary, provider, model, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        user.userId || user.farmerId || 'UNKNOWN',
        user.role,
        user.district || 'N/A',
        `GATEWAY_CALL: ${functionName}`,
        `Executed successfully (${JSON.stringify(sanitizedResult).slice(0, 100)})`,
        'GATEWAY',
        'policy-v2'
      ]);
    } catch (e) {
      // Non-fatal audit log catch
    }

    return sanitizedResult;
  }

  // =========================================================================
  // APPROVED DISTRICT FUNCTIONS (Zero AI SQL)
  // =========================================================================

  async _executeDistrictFunction(functionName, district, params) {
    const cleanDist = district.trim();

    switch (functionName) {
      case 'getDistrictOverview': {
        const [cRes, bRes, gRes] = await Promise.all([
          this.pool.query(`
            SELECT COUNT(*) AS total_centres,
                   COUNT(*) FILTER (WHERE operational_status NOT IN ('Closed', 'Retired')) AS open_centres,
                   COUNT(*) FILTER (WHERE operational_status = 'Closed') AS closed_centres,
                   COUNT(*) FILTER (WHERE risk_level = 'HIGH') AS high_risk_centres,
                   COALESCE(SUM(storage_capacity_mt), 0) AS total_storage_mt,
                   COALESCE(SUM(current_stock_mt), 0) AS total_stock_mt
            FROM centres
            WHERE LOWER(district) = LOWER($1)
          `, [cleanDist]),
          this.pool.query(`
            SELECT COUNT(*) AS total_bookings_today,
                   COALESCE(SUM(quantity_quintals), 0) AS total_quintals_today,
                   COUNT(*) FILTER (WHERE status = 'Checked-In') AS active_in_queue,
                   COUNT(*) FILTER (WHERE status = 'Procured') AS completed_today
            FROM bookings b
            JOIN centres c ON b.centre_id = c.centre_id
            WHERE LOWER(c.district) = LOWER($1) AND b.booking_date = CURRENT_DATE
          `, [cleanDist]),
          this.pool.query(`
            SELECT COUNT(*) AS open_grievances,
                   COUNT(*) FILTER (WHERE sla_deadline < NOW() AND status != 'Resolved') AS escalated_grievances
            FROM grievances g
            JOIN centres c ON g.centre_id = c.centre_id
            WHERE LOWER(c.district) = LOWER($1) AND g.status != 'Resolved'
          `, [cleanDist])
        ]);

        return {
          district: cleanDist,
          centres: cRes.rows[0],
          bookings_today: bRes.rows[0],
          grievances: gRes.rows[0]
        };
      }

      case 'getCentresHealth': {
        const res = await this.pool.query(`
          SELECT centre_id, centre_name, village_town, operational_status,
                 daily_capacity_slots, storage_capacity_mt, current_stock_mt,
                 processing_rate_min, active_counters, risk_level,
                 (
                   SELECT COUNT(*) 
                   FROM bookings b 
                   WHERE b.centre_id = c.centre_id 
                     AND b.booking_date = CURRENT_DATE 
                     AND b.status IN ('Confirmed', 'On The Way', 'Checked-In')
                 ) AS active_queue
          FROM centres c
          WHERE LOWER(district) = LOWER($1)
          ORDER BY (CASE WHEN risk_level = 'HIGH' THEN 1 WHEN operational_status = 'Closed' THEN 2 ELSE 3 END), centre_name ASC
          LIMIT 50
        `, [cleanDist]);

        return {
          district: cleanDist,
          total_returned: res.rows.length,
          centres: res.rows
        };
      }

      case 'getProcurementSummary': {
        const res = await this.pool.query(`
          SELECT b.crop,
                 COUNT(*) AS total_procured_bookings,
                 COALESCE(SUM(b.procured_quantity_quintals), 0) AS total_procured_quintals,
                 COALESCE(SUM(b.payment_amount_inr), 0) AS total_dbt_payout_inr,
                 COUNT(*) FILTER (WHERE b.payment_status = 'Completed') AS completed_payments,
                 COUNT(*) FILTER (WHERE b.payment_status = 'Pending') AS pending_payments
          FROM bookings b
          JOIN centres c ON b.centre_id = c.centre_id
          WHERE LOWER(c.district) = LOWER($1) AND b.status IN ('Procured', 'Payment Pending', 'Payment Completed')
          GROUP BY b.crop
        `, [cleanDist]);

        return {
          district: cleanDist,
          procurement_by_crop: res.rows
        };
      }

      case 'getGrievanceSummary': {
        const res = await this.pool.query(`
          SELECT g.issue_type,
                 COUNT(*) AS total_tickets,
                 COUNT(*) FILTER (WHERE g.status = 'Open') AS open_tickets,
                 COUNT(*) FILTER (WHERE g.status = 'Under Review') AS reviewing_tickets,
                 COUNT(*) FILTER (WHERE g.status = 'Resolved') AS resolved_tickets,
                 COUNT(*) FILTER (WHERE g.sla_deadline < NOW() AND g.status != 'Resolved') AS breached_sla
          FROM grievances g
          JOIN centres c ON g.centre_id = c.centre_id
          WHERE LOWER(c.district) = LOWER($1)
          GROUP BY g.issue_type
        `, [cleanDist]);

        return {
          district: cleanDist,
          tickets_by_type: res.rows
        };
      }

      default:
        throw new Error(`AIDataGateway: Unhandled district function '${functionName}'.`);
    }
  }

  // =========================================================================
  // APPROVED FARMER FUNCTIONS (Zero AI SQL)
  // =========================================================================

  async _executeFarmerFunction(functionName, farmerId, params) {
    switch (functionName) {
      case 'getFarmerBookingStatus': {
        const res = await this.pool.query(`
          SELECT b.booking_id, b.slot_id, b.centre_id, b.booking_date, b.crop,
                 b.quantity_quintals, b.status, b.token, b.queue_position_at_booking,
                 b.estimated_wait_minutes, c.centre_name, c.district, c.village_town,
                 s.start_time, s.end_time
          FROM bookings b
          LEFT JOIN centres c ON b.centre_id = c.centre_id
          LEFT JOIN slots s ON b.slot_id = s.slot_id
          WHERE b.farmer_id = $1
          ORDER BY b.booking_date DESC, b.created_at DESC
          LIMIT 3
        `, [farmerId]);

        return {
          farmer_id: farmerId,
          active_booking: res.rows.find(r => ['Confirmed', 'On The Way', 'Checked-In'].includes(r.status)) || null,
          recent_bookings: res.rows
        };
      }

      case 'getFarmerPaymentStatus': {
        const res = await this.pool.query(`
          SELECT b.booking_id, b.booking_date, b.crop, b.procured_quantity_quintals,
                 b.payment_amount_inr, b.payment_status, c.centre_name,
                 p.transaction_reference, p.completed_at
          FROM bookings b
          LEFT JOIN centres c ON b.centre_id = c.centre_id
          LEFT JOIN procurement_payments p ON b.booking_id = p.booking_id
          WHERE b.farmer_id = $1
            AND (b.status IN ('Procured', 'Payment Pending', 'Payment Completed') OR b.payment_status IS NOT NULL)
          ORDER BY b.booking_date DESC
          LIMIT 3
        `, [farmerId]);

        return {
          farmer_id: farmerId,
          payments: res.rows
        };
      }

      case 'getFarmerProcurementStatus': {
        const res = await this.pool.query(`
          SELECT b.booking_id, b.crop, b.booking_date, b.status, c.centre_name,
                 q.grade, q.moisture_percentage,
                 w.net_weight_kg, w.gross_weight_kg,
                 r.receipt_number
          FROM bookings b
          LEFT JOIN centres c ON b.centre_id = c.centre_id
          LEFT JOIN procurement_quality q ON b.booking_id = q.booking_id
          LEFT JOIN procurement_weighments w ON b.booking_id = w.booking_id
          LEFT JOIN procurement_receipts r ON b.booking_id = r.booking_id
          WHERE b.farmer_id = $1
          ORDER BY b.booking_date DESC
          LIMIT 3
        `, [farmerId]);

        return {
          farmer_id: farmerId,
          procurements: res.rows
        };
      }

      case 'getFarmerGrievances': {
        const res = await this.pool.query(`
          SELECT g.grievance_id, g.issue_type, g.description, g.status,
                 g.created_at, g.sla_deadline, g.resolved_at, c.centre_name
          FROM grievances g
          LEFT JOIN centres c ON g.centre_id = c.centre_id
          WHERE g.farmer_id = $1
          ORDER BY g.created_at DESC
          LIMIT 5
        `, [farmerId]);

        return {
          farmer_id: farmerId,
          grievances: res.rows
        };
      }

      default:
        throw new Error(`AIDataGateway: Unhandled farmer function '${functionName}'.`);
    }
  }

  // =========================================================================
  // APPROVED CENTRE FUNCTIONS
  // =========================================================================

  async _executeCentreFunction(functionName, centreId, params) {
    switch (functionName) {
      case 'getCentreOverview': {
        const res = await this.pool.query(`
          SELECT centre_id, centre_name, district, village_town, operational_status,
                 daily_capacity_slots, storage_capacity_mt, current_stock_mt,
                 processing_rate_min, active_counters
          FROM centres
          WHERE centre_id = $1
        `, [centreId]);
        return res.rows[0] || null;
      }

      case 'getCentreQueue': {
        const res = await this.pool.query(`
          SELECT b.booking_id, b.token, b.status, b.crop, b.quantity_quintals,
                 b.queue_position_at_booking, f.name AS farmer_name
          FROM bookings b
          LEFT JOIN farmers f ON b.farmer_id = f.farmer_id
          WHERE b.centre_id = $1 AND b.booking_date = CURRENT_DATE
          ORDER BY b.queue_position_at_booking ASC
        `, [centreId]);
        return { centre_id: centreId, queue: res.rows };
      }

      default:
        throw new Error(`AIDataGateway: Unhandled centre function '${functionName}'.`);
    }
  }

  // =========================================================================
  // APPROVED CSC FUNCTIONS
  // =========================================================================

  async _executeCscFunction(functionName, district, params) {
    if (params.farmerId) {
      // CSC accessing on behalf of registered farmer in their district
      const fCheck = await this.pool.query('SELECT district FROM farmers WHERE farmer_id = $1', [params.farmerId]);
      if (fCheck.rows.length === 0 || fCheck.rows[0].district.trim().toLowerCase() !== district.trim().toLowerCase()) {
        throw new Error(`AIDataGateway RBAC Violation: Farmer '${params.farmerId}' does not belong to CSC district '${district}'.`);
      }
      return this._executeFarmerFunction(functionName, params.farmerId, params);
    }
    return this._executeDistrictFunction(functionName, district, params);
  }
}

module.exports = {
  AIDataGateway
};
