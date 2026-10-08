const express = require('express');
const crypto = require('crypto');
const {
  authenticateToken,
  optionalAuthenticate,
  requireRole,
  enforceCentreAdminIsolation,
  enforceDistrictOfficerIsolation,
  enforceFarmerIsolation,
  normalizeDistrictName
} = require('./auth');

// Default benchmark reference yields (Demo/Synthetic)
const DEFAULT_CROP_BENCHMARKS = {
  'Paddy': { minYield: 1.60, maxYield: 2.00, minProc: 0.75, maxProc: 0.85, typicalDays: 105 },
  'Maize': { minYield: 1.40, maxYield: 1.90, minProc: 0.70, maxProc: 0.80, typicalDays: 100 },
  'Groundnut': { minYield: 0.80, maxYield: 1.20, minProc: 0.65, maxProc: 0.75, typicalDays: 110 },
  'Cotton': { minYield: 0.70, maxYield: 1.00, minProc: 0.60, maxProc: 0.75, typicalDays: 150 },
  'Sugarcane': { minYield: 30.00, maxYield: 38.00, minProc: 0.80, maxProc: 0.90, typicalDays: 360 }
};

/**
 * Ensures schema exists and default reference data is seeded.
 */
async function initPredictivePlanningDb(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS crop_reference_yields (
        crop VARCHAR(100) PRIMARY KEY,
        min_yield_mt_per_acre NUMERIC(6, 2) NOT NULL,
        max_yield_mt_per_acre NUMERIC(6, 2) NOT NULL,
        min_procurement_ratio NUMERIC(4, 2) DEFAULT 0.75,
        max_procurement_ratio NUMERIC(4, 2) DEFAULT 0.85,
        typical_duration_days INTEGER DEFAULT 105,
        data_source VARCHAR(50) DEFAULT 'DEMO_SYNTHETIC',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS crop_declarations (
        id VARCHAR(50) PRIMARY KEY,
        farmer_id VARCHAR(50) NOT NULL REFERENCES farmers(farmer_id),
        crop VARCHAR(100) NOT NULL,
        cultivated_area NUMERIC(10, 2) NOT NULL,
        area_unit VARCHAR(20) DEFAULT 'acres',
        sowing_date DATE NOT NULL,
        expected_harvest_start DATE NOT NULL,
        expected_harvest_end DATE NOT NULL,
        harvest_period VARCHAR(50) NOT NULL,
        expected_yield_min_mt NUMERIC(10, 2),
        expected_yield_max_mt NUMERIC(10, 2),
        expected_procurement_min_mt NUMERIC(10, 2),
        expected_procurement_max_mt NUMERIC(10, 2),
        farmer_estimated_procurement_qty NUMERIC(10, 2),
        irrigation_type VARCHAR(50) DEFAULT 'Canal',
        crop_variety VARCHAR(100),
        status VARCHAR(30) DEFAULT 'ACTIVE',
        created_via VARCHAR(30) DEFAULT 'FARMER_SELF',
        created_by VARCHAR(100),
        operator_id VARCHAR(100),
        update_reason TEXT,
        district VARCHAR(100) NOT NULL,
        village VARCHAR(100),
        centre_id VARCHAR(50) REFERENCES centres(centre_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS production_forecasts (
        forecast_id VARCHAR(50) PRIMARY KEY,
        crop_declaration_id VARCHAR(50) NOT NULL REFERENCES crop_declarations(id) ON DELETE CASCADE,
        forecast_version INTEGER DEFAULT 1,
        production_min_mt NUMERIC(10, 2) NOT NULL,
        production_max_mt NUMERIC(10, 2) NOT NULL,
        procurement_min_mt NUMERIC(10, 2) NOT NULL,
        procurement_max_mt NUMERIC(10, 2) NOT NULL,
        confidence_level VARCHAR(30) DEFAULT 'Moderate',
        forecast_method VARCHAR(50) DEFAULT 'REFERENCE_YIELD_RANGE',
        data_source VARCHAR(50) DEFAULT 'MODEL_ESTIMATE',
        notes TEXT,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        valid_until TIMESTAMP,
        is_current BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS crop_plan_audit_logs (
        audit_id SERIAL PRIMARY KEY,
        crop_declaration_id VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        previous_value JSONB,
        new_value JSONB,
        reason TEXT,
        performed_by VARCHAR(100) NOT NULL,
        performed_role VARCHAR(50),
        performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_crop_decl_farmer ON crop_declarations(farmer_id);
      CREATE INDEX IF NOT EXISTS idx_crop_decl_district ON crop_declarations(district);
      CREATE INDEX IF NOT EXISTS idx_crop_decl_crop ON crop_declarations(crop);
      CREATE INDEX IF NOT EXISTS idx_crop_decl_period ON crop_declarations(harvest_period);
      CREATE INDEX IF NOT EXISTS idx_crop_decl_centre ON crop_declarations(centre_id);
      CREATE INDEX IF NOT EXISTS idx_prod_fc_decl ON production_forecasts(crop_declaration_id);
      CREATE INDEX IF NOT EXISTS idx_prod_fc_current ON production_forecasts(crop_declaration_id, is_current);
      CREATE INDEX IF NOT EXISTS idx_crop_audit_decl ON crop_plan_audit_logs(crop_declaration_id);

      INSERT INTO crop_reference_yields (crop, min_yield_mt_per_acre, max_yield_mt_per_acre, min_procurement_ratio, max_procurement_ratio, typical_duration_days, data_source)
      VALUES 
        ('Paddy', 1.60, 2.00, 0.75, 0.85, 105, 'DEMO_SYNTHETIC'),
        ('Maize', 1.40, 1.90, 0.70, 0.80, 100, 'DEMO_SYNTHETIC'),
        ('Groundnut', 0.80, 1.20, 0.65, 0.75, 110, 'DEMO_SYNTHETIC'),
        ('Cotton', 0.70, 1.00, 0.60, 0.75, 150, 'DEMO_SYNTHETIC'),
        ('Sugarcane', 30.00, 38.00, 0.80, 0.90, 360, 'DEMO_SYNTHETIC')
      ON CONFLICT (crop) DO UPDATE SET
        min_yield_mt_per_acre = EXCLUDED.min_yield_mt_per_acre,
        max_yield_mt_per_acre = EXCLUDED.max_yield_mt_per_acre,
        min_procurement_ratio = EXCLUDED.min_procurement_ratio,
        max_procurement_ratio = EXCLUDED.max_procurement_ratio,
        typical_duration_days = EXCLUDED.typical_duration_days,
        updated_at = CURRENT_TIMESTAMP;
    `);

    await client.query('COMMIT');
    console.log('✅ Predictive Planning tables & reference yields verified in PostgreSQL.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Predictive planning table initialization failed:', err);
  } finally {
    client.release();
  }
}

/**
 * Calculates production and procurement estimation ranges.
 */
function calculateForecastRange(crop, cultivatedArea, benchmarks, farmerQty = null) {
  const normCrop = Object.keys(benchmarks).find(k => k.toLowerCase() === (crop || '').trim().toLowerCase());
  if (!normCrop) {
    const err = new Error(`Unsupported crop: ${crop}`);
    err.code = 'unsupported_crop';
    throw err;
  }
  const bm = benchmarks[normCrop];

  const area = parseFloat(cultivatedArea) || 1.0;
  const prodMin = parseFloat((area * bm.minYield).toFixed(2));
  const prodMax = parseFloat((area * bm.maxYield).toFixed(2));
  const procMin = parseFloat((prodMin * bm.minProc).toFixed(2));
  const procMax = parseFloat((prodMax * bm.maxProc).toFixed(2));

  return {
    production_min_mt: prodMin,
    production_max_mt: prodMax,
    procurement_min_mt: procMin,
    procurement_max_mt: procMax,
    confidence_level: 'Moderate',
    forecast_method: 'REFERENCE_YIELD_RANGE',
    data_source: 'MODEL_ESTIMATE'
  };
}

/**
 * Formats a Date or date string to 'Month Year' e.g. 'November 2026'
 */
function formatHarvestPeriod(dateStr) {
  if (!dateStr) return 'November 2026';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function createPredictivePlanningRouter(pool) {
  const router = express.Router();

  // Load benchmark reference yields
  async function getBenchmarks() {
    try {
      const res = await pool.query('SELECT * FROM crop_reference_yields');
      const bm = {};
      res.rows.forEach(r => {
        bm[r.crop] = {
          minYield: parseFloat(r.min_yield_mt_per_acre),
          maxYield: parseFloat(r.max_yield_mt_per_acre),
          minProc: parseFloat(r.min_procurement_ratio),
          maxProc: parseFloat(r.max_procurement_ratio),
          typicalDays: r.typical_duration_days
        };
      });
      return bm;
    } catch (e) {
      return DEFAULT_CROP_BENCHMARKS;
    }
  }

  // ====================================================================
  // REFERENCE YIELDS API
  // ====================================================================
  router.get('/crop-plans/reference-yields', async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM crop_reference_yields ORDER BY crop ASC');
      res.json({
        success: true,
        reference_yields: r.rows,
        _notice: 'DEMO/SYNTHETIC BENCHMARKS — Reference yields are configurable demo data for pre-harvest capacity simulation.'
      });
    } catch (err) {
      console.error('Fetch reference yields error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to fetch reference yields.' });
    }
  });

  // ====================================================================
  // FARMER: GET OWN CROP PLANS
  // ====================================================================
  router.get('/crop-plans/my', authenticateToken, async (req, res) => {
    try {
      if (req.user.role === 'FARMER' && req.query.farmer_id && req.query.farmer_id !== req.user.farmerId) {
        return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: You can only access your own crop plans.' });
      }
      const farmerId = req.user.role === 'FARMER' ? req.user.farmerId : (req.query.farmer_id || req.user.farmerId);
      if (!farmerId) {
        return res.status(400).json({ error: 'farmer_id_required', message: 'Farmer ID is required.' });
      }

      const q = `
        SELECT cd.*, 
               pf.forecast_id, pf.forecast_version, pf.production_min_mt, pf.production_max_mt,
               pf.procurement_min_mt, pf.procurement_max_mt, pf.confidence_level, pf.forecast_method,
               pf.data_source as forecast_data_source, pf.generated_at as forecast_generated_at
        FROM crop_declarations cd
        LEFT JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE cd.farmer_id = $1
        ORDER BY cd.created_at DESC
      `;
      const r = await pool.query(q, [farmerId]);

      res.json({
        success: true,
        farmer_id: farmerId,
        crop_plans: r.rows,
        count: r.rows.length,
        _notice: 'Estimated forecast values are calculated for procurement demand planning and do not represent a guaranteed commitment.'
      });
    } catch (err) {
      console.error('Get farmer crop plans error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to fetch crop plans.' });
    }
  });

  // ====================================================================
  // FARMER / GENERAL: GET SINGLE CROP PLAN WITH HISTORY
  // ====================================================================
  router.get('/crop-plans/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const declRes = await pool.query('SELECT * FROM crop_declarations WHERE id = $1', [id]);
      if (declRes.rows.length === 0) {
        return res.status(404).json({ error: 'crop_plan_not_found', message: 'Crop plan not found.' });
      }
      const decl = declRes.rows[0];

      // IDOR and perimeter checks
      if (req.user.role === 'FARMER' && req.user.farmerId !== decl.farmer_id) {
        return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: You can only access your own crop plans.' });
      }
      if (req.user.role === 'CSC_OPERATOR' && req.user.district && decl.district && req.user.district.toLowerCase() !== decl.district.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: You cannot access declarations outside your assigned district.' });
      }
      if (req.user.role === 'DISTRICT_OFFICER' && req.user.district && decl.district && req.user.district.toLowerCase() !== decl.district.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: You cannot access declarations outside your assigned district.' });
      }

      // Fetch all forecast versions
      const fcRes = await pool.query(`
        SELECT * FROM production_forecasts 
        WHERE crop_declaration_id = $1 
        ORDER BY forecast_version DESC
      `, [id]);

      // Fetch audit logs
      const auditRes = await pool.query(`
        SELECT * FROM crop_plan_audit_logs
        WHERE crop_declaration_id = $1
        ORDER BY performed_at DESC
      `, [id]);

      // Fetch farmer details
      const fRes = await pool.query('SELECT * FROM farmers WHERE farmer_id = $1', [decl.farmer_id]);

      const currentForecast = fcRes.rows.find(f => f.is_current) || fcRes.rows[0] || null;

      res.json({
        success: true,
        crop_plan: decl,
        farmer: fRes.rows[0] || null,
        current_forecast: currentForecast,
        forecast_versions: fcRes.rows,
        audit_history: auditRes.rows,
        _notice: 'Forecast values are estimates for pre-harvest planning and not a guaranteed production or procurement commitment.'
      });
    } catch (err) {
      console.error('Get crop plan error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load crop plan details.' });
    }
  });

  // ====================================================================
  // FARMER: CREATE CROP DECLARATION (Self-Service)
  // ====================================================================
  router.post('/crop-plans', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      const farmerId = req.user.farmerId || req.body.farmer_id;
      if (!farmerId) {
        return res.status(400).json({ error: 'farmer_id_required', message: 'Farmer ID is required.' });
      }

      // Role check
      if (req.user.role === 'FARMER' && req.user.farmerId !== farmerId) {
        return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: You can only submit a crop plan for yourself.' });
      }

      const {
        crop,
        cultivated_area,
        area_unit = 'acres',
        sowing_date,
        expected_harvest_start,
        expected_harvest_end,
        expected_procurement_quantity,
        irrigation_type = 'Canal',
        crop_variety = '',
        district: inputDistrict,
        village: inputVillage,
        centre_id: inputCentreId
      } = req.body;

      if (!crop || !cultivated_area || !sowing_date || !expected_harvest_start || !expected_harvest_end) {
        return res.status(400).json({
          error: 'missing_required_fields',
          message: 'crop, cultivated_area, sowing_date, expected_harvest_start, and expected_harvest_end are required.'
        });
      }

      const sDate = new Date(expected_harvest_start);
      const eDate = new Date(expected_harvest_end);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        return res.status(400).json({
          error: 'invalid_harvest_date',
          message: 'Expected harvest start and end dates must be valid dates.'
        });
      }
      if (sDate > eDate) {
        return res.status(400).json({
          error: 'invalid_harvest_date_range',
          message: 'Expected harvest start date must be before or equal to harvest end date.'
        });
      }

      const benchmarks = await getBenchmarks();
      const matchedCrop = Object.keys(benchmarks).find(k => k.toLowerCase() === (crop || '').trim().toLowerCase());
      if (!matchedCrop) {
        return res.status(400).json({
          error: 'unsupported_crop',
          message: `Unsupported crop '${crop}'. Allowed crops are: ${Object.keys(benchmarks).join(', ')}.`
        });
      }

      const area = parseFloat(cultivated_area);
      if (isNaN(area) || area <= 0) {
        return res.status(400).json({ error: 'invalid_area', message: 'Cultivated area must be a positive number.' });
      }

      // Resolve farmer profile
      const fRes = await client.query('SELECT * FROM farmers WHERE farmer_id = $1', [farmerId]);
      if (fRes.rows.length === 0) {
        return res.status(404).json({ error: 'farmer_not_found', message: 'Farmer not found in system.' });
      }
      const farmer = fRes.rows[0];
      const district = inputDistrict || farmer.district || 'Vellore';
      const village = inputVillage || farmer.village || '';

      // Resolve preferred/closest centre
      let centreId = inputCentreId || null;
      if (!centreId) {
        const cRes = await client.query('SELECT centre_id FROM centres WHERE LOWER(district) = LOWER($1) AND operational_status = $2 LIMIT 1', [district, 'Open']);
        if (cRes.rows.length > 0) centreId = cRes.rows[0].centre_id;
      }

      const harvestPeriod = formatHarvestPeriod(expected_harvest_start);
      const farmerQty = expected_procurement_quantity && !isNaN(parseFloat(expected_procurement_quantity)) ? parseFloat(expected_procurement_quantity) : null;
      const forecastData = calculateForecastRange(matchedCrop, area, benchmarks, farmerQty);

      await client.query('BEGIN');

      const planId = 'CP-2026-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const forecastId = 'FC-2026-' + crypto.randomBytes(3).toString('hex').toUpperCase();

      const insertDeclQuery = `
        INSERT INTO crop_declarations (
          id, farmer_id, crop, cultivated_area, area_unit, sowing_date,
          expected_harvest_start, expected_harvest_end, harvest_period,
          expected_yield_min_mt, expected_yield_max_mt,
          expected_procurement_min_mt, expected_procurement_max_mt,
          farmer_estimated_procurement_qty, irrigation_type, crop_variety,
          status, created_via, created_by, district, village, centre_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING *
      `;

      const declRes = await client.query(insertDeclQuery, [
        planId,
        farmerId,
        crop,
        area,
        area_unit,
        sowing_date,
        expected_harvest_start,
        expected_harvest_end,
        harvestPeriod,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        farmerQty,
        irrigation_type,
        crop_variety,
        'ACTIVE',
        'FARMER_SELF',
        req.user.username || farmerId,
        district,
        village,
        centreId
      ]);

      // Insert Initial Forecast (Version 1)
      const insertFcQuery = `
        INSERT INTO production_forecasts (
          forecast_id, crop_declaration_id, forecast_version,
          production_min_mt, production_max_mt,
          procurement_min_mt, procurement_max_mt,
          confidence_level, forecast_method, data_source,
          is_current
        ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, TRUE)
        RETURNING *
      `;

      const fcRes = await client.query(insertFcQuery, [
        forecastId,
        planId,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        forecastData.confidence_level,
        forecastData.forecast_method,
        forecastData.data_source
      ]);

      // Audit log
      await client.query(`
        INSERT INTO crop_plan_audit_logs (crop_declaration_id, action, new_value, reason, performed_by, performed_role)
        VALUES ($1, 'CREATED', $2, 'Initial farmer self-service crop declaration', $3, $4)
      `, [planId, JSON.stringify({ plan: declRes.rows[0], forecast: fcRes.rows[0] }), req.user.username || farmerId, req.user.role || 'FARMER']);

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Crop plan registered successfully.',
        crop_plan: declRes.rows[0],
        forecast: fcRes.rows[0],
        _notice: 'This is an estimate for procurement planning and is not a guaranteed production or procurement commitment.'
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Create crop plan error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to create crop plan.' });
    } finally {
      client.release();
    }
  });

  // ====================================================================
  // FARMER / CSC: UPDATE CROP DECLARATION (Increments Forecast Version)
  // ====================================================================
  router.put('/crop-plans/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const {
        cultivated_area,
        crop,
        sowing_date,
        expected_harvest_start,
        expected_harvest_end,
        expected_procurement_quantity,
        irrigation_type,
        crop_variety,
        status = 'ACTIVE',
        update_reason
      } = req.body;

      if (!update_reason || !update_reason.trim()) {
        return res.status(400).json({
          error: 'update_reason_required',
          message: 'An explicit update reason is required (e.g. Area changed, Crop damage, Harvest period changed).'
        });
      }

      const existingRes = await client.query('SELECT * FROM crop_declarations WHERE id = $1', [id]);
      if (existingRes.rows.length === 0) {
        return res.status(404).json({ error: 'crop_plan_not_found', message: 'Crop plan not found.' });
      }
      const existing = existingRes.rows[0];

      // IDOR and perimeter checks
      if (req.user.role === 'FARMER' && req.user.farmerId !== existing.farmer_id) {
        return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden: You cannot update another farmer crop plan.' });
      }
      if (req.user.role === 'CSC_OPERATOR' && req.user.district && existing.district && req.user.district.toLowerCase() !== existing.district.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden: You cannot update declarations outside your assigned district.' });
      }

      const newArea = cultivated_area ? parseFloat(cultivated_area) : parseFloat(existing.cultivated_area);
      const newCrop = crop || existing.crop;
      const newHarvestStart = expected_harvest_start || existing.expected_harvest_start;
      const newHarvestEnd = expected_harvest_end || existing.expected_harvest_end;
      const newSowingDate = sowing_date || existing.sowing_date;
      const newHarvestPeriod = formatHarvestPeriod(newHarvestStart);

      const sDate = new Date(newHarvestStart);
      const eDate = new Date(newHarvestEnd);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        return res.status(400).json({
          error: 'invalid_harvest_date',
          message: 'Expected harvest start and end dates must be valid dates.'
        });
      }
      if (sDate > eDate) {
        return res.status(400).json({
          error: 'invalid_harvest_date_range',
          message: 'Expected harvest start date must be before or equal to harvest end date.'
        });
      }

      const benchmarks = await getBenchmarks();
      const matchedCrop = Object.keys(benchmarks).find(k => k.toLowerCase() === newCrop.trim().toLowerCase());
      if (!matchedCrop) {
        return res.status(400).json({
          error: 'unsupported_crop',
          message: `Unsupported crop '${newCrop}'. Allowed crops are: ${Object.keys(benchmarks).join(', ')}.`
        });
      }

      const farmerQty = expected_procurement_quantity && !isNaN(parseFloat(expected_procurement_quantity)) ? parseFloat(expected_procurement_quantity) : existing.farmer_estimated_procurement_qty;
      const forecastData = calculateForecastRange(matchedCrop, newArea, benchmarks, farmerQty);

      await client.query('BEGIN');

      // 1. Mark prior forecast versions as not current
      await client.query(`
        UPDATE production_forecasts 
        SET is_current = FALSE 
        WHERE crop_declaration_id = $1
      `, [id]);

      // 2. Determine next forecast version number
      const vRes = await client.query(`
        SELECT COALESCE(MAX(forecast_version), 0) + 1 AS next_version 
        FROM production_forecasts 
        WHERE crop_declaration_id = $1
      `, [id]);
      const nextVersion = vRes.rows[0].next_version;

      // 3. Insert new forecast version
      const newForecastId = 'FC-2026-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const fcRes = await client.query(`
        INSERT INTO production_forecasts (
          forecast_id, crop_declaration_id, forecast_version,
          production_min_mt, production_max_mt,
          procurement_min_mt, procurement_max_mt,
          confidence_level, forecast_method, data_source,
          notes, is_current
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
        RETURNING *
      `, [
        newForecastId,
        id,
        nextVersion,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        forecastData.confidence_level,
        forecastData.forecast_method,
        forecastData.data_source,
        `Updated via version ${nextVersion}: ${update_reason}`
      ]);

      // 4. Update crop_declarations row
      const updateDeclRes = await client.query(`
        UPDATE crop_declarations
        SET crop = $1,
            cultivated_area = $2,
            sowing_date = $3,
            expected_harvest_start = $4,
            expected_harvest_end = $5,
            harvest_period = $6,
            expected_yield_min_mt = $7,
            expected_yield_max_mt = $8,
            expected_procurement_min_mt = $9,
            expected_procurement_max_mt = $10,
            farmer_estimated_procurement_qty = $11,
            irrigation_type = COALESCE($12, irrigation_type),
            crop_variety = COALESCE($13, crop_variety),
            status = $14,
            update_reason = $15,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $16
        RETURNING *
      `, [
        newCrop,
        newArea,
        newSowingDate,
        newHarvestStart,
        newHarvestEnd,
        newHarvestPeriod,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        farmerQty,
        irrigation_type,
        crop_variety,
        status,
        update_reason,
        id
      ]);

      // 5. Audit log
      await client.query(`
        INSERT INTO crop_plan_audit_logs (crop_declaration_id, action, previous_value, new_value, reason, performed_by, performed_role)
        VALUES ($1, 'UPDATED', $2, $3, $4, $5, $6)
      `, [
        id,
        JSON.stringify(existing),
        JSON.stringify({ plan: updateDeclRes.rows[0], forecast: fcRes.rows[0] }),
        update_reason,
        req.user.username || req.user.farmerId || 'operator',
        req.user.role || 'FARMER'
      ]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Crop plan updated to forecast version ${nextVersion}.`,
        crop_plan: updateDeclRes.rows[0],
        new_forecast: fcRes.rows[0],
        current_forecast: fcRes.rows[0],
        forecast_version: nextVersion,
        _notice: 'Forecast updated based on revised cultivation parameters. Historical versions preserved.'
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Update crop plan error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to update crop plan.' });
    } finally {
      client.release();
    }
  });

  // ====================================================================
  // RECALCULATE CROP PLAN FORECAST ESTIMATE
  // ====================================================================
  router.post('/crop-plans/:id/recalculate', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const declRes = await client.query('SELECT * FROM crop_declarations WHERE id = $1', [id]);
      if (declRes.rows.length === 0) {
        return res.status(404).json({ error: 'crop_plan_not_found', message: 'Crop plan not found.' });
      }
      const decl = declRes.rows[0];

      // IDOR check
      if (req.user.role === 'FARMER' && req.user.farmerId !== decl.farmer_id) {
        return res.status(403).json({ error: 'farmer_access_denied', message: 'Forbidden.' });
      }

      const benchmarks = await getBenchmarks();
      const forecastData = calculateForecastRange(decl.crop, decl.cultivated_area, benchmarks, decl.farmer_estimated_procurement_qty);

      await client.query('BEGIN');

      // 1. Mark prior forecast versions as not current
      await client.query('UPDATE production_forecasts SET is_current = FALSE WHERE crop_declaration_id = $1', [id]);

      // 2. Next version
      const vRes = await client.query('SELECT COALESCE(MAX(forecast_version), 0) + 1 AS next_version FROM production_forecasts WHERE crop_declaration_id = $1', [id]);
      const nextVersion = vRes.rows[0].next_version;

      // 3. Insert new forecast
      const newForecastId = 'FC-2026-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const fcRes = await client.query(`
        INSERT INTO production_forecasts (
          forecast_id, crop_declaration_id, forecast_version,
          production_min_mt, production_max_mt,
          procurement_min_mt, procurement_max_mt,
          confidence_level, forecast_method, data_source,
          notes, is_current
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
        RETURNING *
      `, [
        newForecastId,
        id,
        nextVersion,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        forecastData.confidence_level,
        forecastData.forecast_method,
        forecastData.data_source,
        `Recalculated via version ${nextVersion}`
      ]);

      // 4. Update declaration row
      await client.query(`
        UPDATE crop_declarations
        SET expected_yield_min_mt = $1,
            expected_yield_max_mt = $2,
            expected_procurement_min_mt = $3,
            expected_procurement_max_mt = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
      `, [
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        id
      ]);

      // 5. Audit log
      await client.query(`
        INSERT INTO crop_plan_audit_logs (crop_declaration_id, action, new_value, reason, performed_by, performed_role)
        VALUES ($1, 'RECALCULATED', $2, 'Manual recalculation using current benchmarks', $3, $4)
      `, [id, JSON.stringify(fcRes.rows[0]), req.user.username || req.user.farmerId, req.user.role || 'FARMER']);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Forecast recalculated to version ${nextVersion}.`,
        new_forecast: fcRes.rows[0],
        current_forecast: fcRes.rows[0],
        forecast_version: nextVersion
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Recalculate error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to recalculate forecast.' });
    } finally {
      client.release();
    }
  });

  // ====================================================================
  // CSC OPERATOR: LIST CROP PLANS IN ASSIGNED DISTRICT
  // ====================================================================
  router.get('/csc/crop-plans', authenticateToken, requireRole('CSC_OPERATOR', 'DISTRICT_OFFICER'), async (req, res) => {
    try {
      const assignedDistrict = req.user.district;
      const { search, crop, harvest_period } = req.query;

      let q = `
        SELECT cd.*, f.name as farmer_name, f.phone as farmer_phone,
               pf.forecast_id, pf.forecast_version, pf.production_min_mt, pf.production_max_mt,
               pf.procurement_min_mt, pf.procurement_max_mt
        FROM crop_declarations cd
        JOIN farmers f ON cd.farmer_id = f.farmer_id
        LEFT JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1)
      `;
      const params = [assignedDistrict];

      if (search && search.trim()) {
        params.push(`%${search.trim()}%`);
        q += ` AND (cd.farmer_id ILIKE $${params.length} OR f.name ILIKE $${params.length} OR f.phone ILIKE $${params.length} OR cd.id ILIKE $${params.length})`;
      }
      if (crop && crop !== 'ALL') {
        params.push(crop);
        q += ` AND cd.crop = $${params.length}`;
      }
      if (harvest_period && harvest_period !== 'ALL') {
        params.push(harvest_period);
        q += ` AND cd.harvest_period = $${params.length}`;
      }

      q += ' ORDER BY cd.created_at DESC';

      const r = await pool.query(q, params);

      res.json({
        success: true,
        district: assignedDistrict,
        crop_plans: r.rows,
        count: r.rows.length,
        _notice: 'CSC Assisted Crop Declarations — Operational planning signal only.'
      });
    } catch (err) {
      console.error('CSC list crop plans error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load CSC crop plans.' });
    }
  });

  // ====================================================================
  // CSC OPERATOR: CREATE ASSISTED DECLARATION & PRINTABLE RECEIPT
  // ====================================================================
  router.post('/csc/crop-plans', authenticateToken, requireRole('CSC_OPERATOR'), async (req, res) => {
    const client = await pool.connect();
    try {
      const assignedDistrict = req.user.district;
      const {
        farmer_id,
        crop,
        cultivated_area,
        area_unit = 'acres',
        sowing_date,
        expected_harvest_start,
        expected_harvest_end,
        expected_procurement_quantity,
        irrigation_type = 'Canal',
        crop_variety = '',
        centre_id: inputCentreId
      } = req.body;

      if (!farmer_id || !crop || !cultivated_area || !sowing_date || !expected_harvest_start || !expected_harvest_end) {
        return res.status(400).json({
          error: 'missing_required_fields',
          message: 'farmer_id, crop, cultivated_area, sowing_date, expected_harvest_start, and expected_harvest_end are required.'
        });
      }

      const sDate = new Date(expected_harvest_start);
      const eDate = new Date(expected_harvest_end);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        return res.status(400).json({
          error: 'invalid_harvest_date',
          message: 'Expected harvest start and end dates must be valid dates.'
        });
      }
      if (sDate > eDate) {
        return res.status(400).json({
          error: 'invalid_harvest_date_range',
          message: 'Expected harvest start date must be before or equal to harvest end date.'
        });
      }

      const benchmarks = await getBenchmarks();
      const matchedCrop = Object.keys(benchmarks).find(k => k.toLowerCase() === (crop || '').trim().toLowerCase());
      if (!matchedCrop) {
        return res.status(400).json({
          error: 'unsupported_crop',
          message: `Unsupported crop '${crop}'. Allowed crops are: ${Object.keys(benchmarks).join(', ')}.`
        });
      }

      // Verify farmer belongs to operator's assigned district
      const fRes = await client.query('SELECT * FROM farmers WHERE farmer_id = $1', [farmer_id]);
      if (fRes.rows.length === 0) {
        return res.status(404).json({ error: 'farmer_not_found', message: 'Farmer not found in registry.' });
      }
      const farmer = fRes.rows[0];

      if (req.body.district && assignedDistrict && req.body.district.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: CSC Operator is assigned to district ${assignedDistrict} and cannot create declarations in district ${req.body.district}.`
        });
      }

      if (farmer.district && assignedDistrict && farmer.district.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: CSC Operator is assigned to district ${assignedDistrict} and cannot assist farmer ${farmer.name} from district ${farmer.district}.`
        });
      }

      const area = parseFloat(cultivated_area);
      if (isNaN(area) || area <= 0) {
        return res.status(400).json({ error: 'invalid_area', message: 'Cultivated area must be a positive number.' });
      }

      const harvestPeriod = formatHarvestPeriod(expected_harvest_start);
      const farmerQty = expected_procurement_quantity && !isNaN(parseFloat(expected_procurement_quantity)) ? parseFloat(expected_procurement_quantity) : null;
      const forecastData = calculateForecastRange(matchedCrop, area, benchmarks, farmerQty);

      let centreId = inputCentreId || null;
      if (!centreId) {
        const cRes = await client.query('SELECT centre_id FROM centres WHERE LOWER(district) = LOWER($1) AND operational_status = $2 LIMIT 1', [assignedDistrict, 'Open']);
        if (cRes.rows.length > 0) centreId = cRes.rows[0].centre_id;
      }

      await client.query('BEGIN');

      const planId = 'CP-2026-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const forecastId = 'FC-2026-' + crypto.randomBytes(3).toString('hex').toUpperCase();

      const declRes = await client.query(`
        INSERT INTO crop_declarations (
          id, farmer_id, crop, cultivated_area, area_unit, sowing_date,
          expected_harvest_start, expected_harvest_end, harvest_period,
          expected_yield_min_mt, expected_yield_max_mt,
          expected_procurement_min_mt, expected_procurement_max_mt,
          farmer_estimated_procurement_qty, irrigation_type, crop_variety,
          status, created_via, created_by, operator_id, district, village, centre_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'ACTIVE', 'CSC_ASSISTED', $17, $18, $19, $20, $21)
        RETURNING *
      `, [
        planId,
        farmer_id,
        crop,
        area,
        area_unit,
        sowing_date,
        expected_harvest_start,
        expected_harvest_end,
        harvestPeriod,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        farmerQty,
        irrigation_type,
        crop_variety,
        req.user.username,
        req.user.username,
        farmer.district || assignedDistrict,
        farmer.village || '',
        centreId
      ]);

      const fcRes = await client.query(`
        INSERT INTO production_forecasts (
          forecast_id, crop_declaration_id, forecast_version,
          production_min_mt, production_max_mt,
          procurement_min_mt, procurement_max_mt,
          confidence_level, forecast_method, data_source,
          is_current
        ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, TRUE)
        RETURNING *
      `, [
        forecastId,
        planId,
        forecastData.production_min_mt,
        forecastData.production_max_mt,
        forecastData.procurement_min_mt,
        forecastData.procurement_max_mt,
        forecastData.confidence_level,
        forecastData.forecast_method,
        forecastData.data_source
      ]);

      // Audit log
      await client.query(`
        INSERT INTO crop_plan_audit_logs (crop_declaration_id, action, new_value, reason, performed_by, performed_role)
        VALUES ($1, 'CSC_ASSISTED_SUBMISSION', $2, 'Assisted crop declaration submitted at CSC kiosk', $3, 'CSC_OPERATOR')
      `, [planId, JSON.stringify({ plan: declRes.rows[0], forecast: fcRes.rows[0] }), req.user.username]);

      await client.query('COMMIT');

      const receipt = {
        receipt_id: 'RCPT-CSC-' + Date.now(),
        crop_plan_id: planId,
        farmer_id: farmer.farmer_id,
        farmer_name: farmer.name,
        district: farmer.district || assignedDistrict,
        village: farmer.village || '',
        crop,
        cultivated_area: area,
        area_unit: 'acres',
        harvest_period: harvestPeriod,
        estimated_production_range: `${forecastData.production_min_mt} – ${forecastData.production_max_mt} MT`,
        estimated_procurement_range: `${forecastData.procurement_min_mt} – ${forecastData.procurement_max_mt} MT`,
        registration_mode: 'CSC Assisted',
        operator_id: req.user.username,
        registered_at: new Date().toISOString(),
        advisory: 'Forecast / planning estimate only. This is not an official production or procurement commitment.'
      };

      res.status(201).json({
        success: true,
        message: 'Crop plan registered via CSC Operator successfully.',
        receipt,
        crop_plan: declRes.rows[0],
        forecast: fcRes.rows[0]
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('CSC create crop plan error:', err);
      res.status(500).json({ error: 'server_error', message: 'Failed to create assisted crop plan.' });
    } finally {
      client.release();
    }
  });

  // ====================================================================
  // DISTRICT OFFICER: PREDICTIVE PROCUREMENT FORECAST OVERVIEW
  // ====================================================================
  router.get('/district-officer/procurement-forecast', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
    try {
      const assignedDistrict = req.user.district;
      const requestedDistrict = req.query.district;

      // Cross-district security check
      if (requestedDistrict && requestedDistrict.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({
          error: 'district_access_denied',
          message: `Forbidden: You are assigned to district ${assignedDistrict} and cannot view forecasts for ${requestedDistrict}.`
        });
      }

      const { crop, harvest_period } = req.query;

      // 1. Fetch district summary metrics
      let q = `
        SELECT 
          COUNT(DISTINCT cd.id)::int AS total_plans,
          COUNT(DISTINCT cd.farmer_id)::int AS total_farmers,
          COALESCE(SUM(cd.cultivated_area), 0)::numeric AS total_cultivated_acres,
          COALESCE(SUM(pf.production_min_mt), 0)::numeric AS expected_production_min_mt,
          COALESCE(SUM(pf.production_max_mt), 0)::numeric AS expected_production_max_mt,
          COALESCE(SUM(pf.procurement_min_mt), 0)::numeric AS expected_procurement_min_mt,
          COALESCE(SUM(pf.procurement_max_mt), 0)::numeric AS expected_procurement_max_mt
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED'
      `;
      const params = [assignedDistrict];

      if (crop && crop !== 'ALL') {
        params.push(crop);
        q += ` AND cd.crop = $${params.length}`;
      }
      if (harvest_period && harvest_period !== 'ALL') {
        params.push(harvest_period);
        q += ` AND cd.harvest_period = $${params.length}`;
      }

      const sumRes = await pool.query(q, params);
      const summary = sumRes.rows[0] || {};

      // 2. Compute available DPC capacity in district
      const capRes = await pool.query(`
        SELECT 
          COUNT(*)::int as total_centres,
          COALESCE(SUM(CASE WHEN storage_capacity_mt > 0 THEN storage_capacity_mt ELSE 300 END), 0)::numeric AS total_capacity_mt
        FROM centres
        WHERE LOWER(district) = LOWER($1) AND operational_status != 'Retired'
      `, [assignedDistrict]);

      const centreInfo = capRes.rows[0] || { total_centres: 0, total_capacity_mt: 0 };
      const capacityMt = parseFloat(centreInfo.total_capacity_mt) || 0;
      const procMin = parseFloat(summary.expected_procurement_min_mt) || 0;
      const procMax = parseFloat(summary.expected_procurement_max_mt) || 0;

      // Potential capacity gap formula: max(0, demand - capacity)
      const gapMin = Math.max(0, procMin - capacityMt);
      const gapMax = Math.max(0, procMax - capacityMt);

      let riskLevel = 'NORMAL';
      if (gapMax > 0) {
        riskLevel = 'HIGH PRESSURE';
      } else if (procMax >= capacityMt * 0.8) {
        riskLevel = 'WATCH';
      }

      res.json({
        success: true,
        district: assignedDistrict,
        kpi_summary: {
          registered_plans: parseInt(summary.total_plans || 0),
          expected_farmers: parseInt(summary.total_farmers || 0),
          cultivated_acres: parseFloat(summary.total_cultivated_acres || 0),
          production_min_mt: procMin > 0 ? parseFloat(summary.expected_production_min_mt) : 0,
          production_max_mt: procMax > 0 ? parseFloat(summary.expected_production_max_mt) : 0,
          procurement_min_mt: procMin,
          procurement_max_mt: procMax,
          available_capacity_mt: capacityMt,
          potential_gap_min_mt: gapMin,
          potential_gap_max_mt: gapMax,
          risk_level: riskLevel,
          total_centres: parseInt(centreInfo.total_centres || 0)
        },
        _notice: 'DEMO MODE — Forecast values shown here are synthetic data created for demonstration and testing. They are not official TNCSC forecasts.'
      });
    } catch (err) {
      console.error('DO forecast summary error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load district forecast summary.' });
    }
  });

  // ====================================================================
  // DISTRICT OFFICER: CROP & HARVEST PERIOD BREAKDOWN
  // ====================================================================
  router.get('/district-officer/procurement-forecast/district', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
    try {
      const assignedDistrict = req.user.district;
      const requestedDistrict = req.query.district;
      if (requestedDistrict && requestedDistrict.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden.' });
      }

      const cropRes = await pool.query(`
        SELECT 
          cd.crop,
          COUNT(cd.id)::int AS plans_count,
          SUM(cd.cultivated_area)::numeric AS acres,
          SUM(pf.procurement_min_mt)::numeric AS min_proc_mt,
          SUM(pf.procurement_max_mt)::numeric AS max_proc_mt
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED'
        GROUP BY cd.crop
        ORDER BY max_proc_mt DESC
      `, [assignedDistrict]);

      const periodRes = await pool.query(`
        SELECT 
          cd.harvest_period,
          COUNT(cd.id)::int AS plans_count,
          SUM(pf.procurement_min_mt)::numeric AS min_proc_mt,
          SUM(pf.procurement_max_mt)::numeric AS max_proc_mt
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED'
        GROUP BY cd.harvest_period
        ORDER BY cd.harvest_period ASC
      `, [assignedDistrict]);

      res.json({
        success: true,
        district: assignedDistrict,
        crop_breakdown: cropRes.rows,
        harvest_breakdown: periodRes.rows,
        _notice: 'DEMO/SYNTHETIC AGGREGATE BREAKDOWN'
      });
    } catch (err) {
      console.error('DO breakdown error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load district breakdowns.' });
    }
  });

  // ====================================================================
  // DISTRICT OFFICER: CENTRE-LEVEL CAPACITY & FORECAST TABLE
  // ====================================================================
  router.get('/district-officer/procurement-forecast/centres', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
    try {
      const assignedDistrict = req.user.district;
      const requestedDistrict = req.query.district;
      if (requestedDistrict && requestedDistrict.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden.' });
      }

      // Fetch district centres
      const centresRes = await pool.query(`
        SELECT centre_id, centre_name, village_town, district, operational_status,
               storage_capacity_mt, daily_capacity_slots, active_counters, staff_availability
        FROM centres
        WHERE LOWER(district) = LOWER($1) AND operational_status != 'Retired'
        ORDER BY centre_name ASC
      `, [assignedDistrict]);

      // Fetch demand allocated or attributed to centres
      const demandRes = await pool.query(`
        SELECT 
          cd.centre_id,
          cd.crop,
          COUNT(DISTINCT cd.farmer_id)::int AS expected_farmers,
          COALESCE(SUM(pf.procurement_min_mt), 0)::numeric AS proc_min_mt,
          COALESCE(SUM(pf.procurement_max_mt), 0)::numeric AS proc_max_mt
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED' AND cd.centre_id IS NOT NULL
        GROUP BY cd.centre_id, cd.crop
      `, [assignedDistrict]);

      const demandMap = new Map();
      demandRes.rows.forEach(d => {
        if (!demandMap.has(d.centre_id)) demandMap.set(d.centre_id, []);
        demandMap.get(d.centre_id).push(d);
      });

      // If centre has no direct mapping, compute a deterministic demo allocation share
      const totalDeclaredRes = await pool.query(`
        SELECT 
          COALESCE(SUM(pf.procurement_min_mt), 0)::numeric AS tot_min,
          COALESCE(SUM(pf.procurement_max_mt), 0)::numeric AS tot_max,
          COUNT(DISTINCT cd.farmer_id)::int AS tot_farmers
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED'
      `, [assignedDistrict]);

      const totDecl = totalDeclaredRes.rows[0] || { tot_min: 0, tot_max: 0, tot_farmers: 0 };
      const centreCount = Math.max(1, centresRes.rows.length);

      const unassignedRes = await pool.query(`
        SELECT 
          COUNT(DISTINCT cd.farmer_id)::int AS unassigned_farmers,
          COALESCE(SUM(pf.procurement_min_mt), 0)::numeric AS unassigned_min_mt,
          COALESCE(SUM(pf.procurement_max_mt), 0)::numeric AS unassigned_max_mt
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED' AND cd.centre_id IS NULL
      `, [assignedDistrict]);
      const unassigned = unassignedRes.rows[0] || { unassigned_farmers: 0, unassigned_min_mt: 0, unassigned_max_mt: 0 };

      const table = centresRes.rows.map((c) => {
        const capacity = parseFloat(c.storage_capacity_mt) || 250;
        const mapped = demandMap.get(c.centre_id);

        let expFarmers = 0;
        let procMin = 0;
        let procMax = 0;
        let crop = 'Paddy';

        if (mapped && mapped.length > 0) {
          expFarmers = mapped.reduce((s, m) => s + m.expected_farmers, 0);
          procMin = parseFloat(mapped.reduce((s, m) => s + parseFloat(m.proc_min_mt), 0).toFixed(2));
          procMax = parseFloat(mapped.reduce((s, m) => s + parseFloat(m.proc_max_mt), 0).toFixed(2));
          crop = mapped[0].crop;
        } else {
          // No declarations mapped to this centre: report exact recorded 0
          expFarmers = 0;
          procMin = 0;
          procMax = 0;
        }

        const gapMin = Math.max(0, procMin - capacity);
        const gapMax = Math.max(0, procMax - capacity);

        let risk = 'NORMAL';
        if (gapMax > 0) {
          risk = 'HIGH PRESSURE';
        } else if (procMax >= capacity * 0.8 && procMax > 0) {
          risk = 'WATCH';
        }

        // Planning indicators (labeled "Planning estimate")
        const additionalSlots = gapMax > 0 ? Math.round(gapMax / 2.5) : 0;
        const additionalStorage = gapMax > 0 ? Math.round(gapMax) : 0;
        const additionalStaff = gapMax > 0 ? Math.ceil(gapMax / 200) : 0;

        return {
          centre_id: c.centre_id,
          centre_name: c.centre_name,
          village: c.village_town,
          crop,
          expected_farmers: expFarmers,
          expected_procurement_min_mt: procMin,
          expected_procurement_max_mt: procMax,
          available_capacity_mt: capacity,
          potential_gap_min_mt: gapMin,
          potential_gap_max_mt: gapMax,
          projected_pressure_str: gapMax > 0 ? `+${gapMin} – ${gapMax} MT` : `-${(capacity - procMax).toFixed(0)} MT`,
          risk_level: risk,
          planning_indicators: {
            estimated_additional_slots: additionalSlots,
            estimated_additional_storage_mt: additionalStorage,
            estimated_additional_staff: additionalStaff,
            label: 'Planning estimate'
          }
        };
      });

      res.json({
        success: true,
        district: assignedDistrict,
        centres_forecast: table,
        total_centres: table.length,
        unallocated_district_catchment: {
          farmers: parseInt(unassigned.unassigned_farmers || 0),
          procurement_min_mt: parseFloat(Number(unassigned.unassigned_min_mt || 0).toFixed(2)),
          procurement_max_mt: parseFloat(Number(unassigned.unassigned_max_mt || 0).toFixed(2)),
          notes: 'Farmers with district-level crop declarations not yet assigned to an individual centre.'
        },
        _notice: 'Official declaration aggregation grounded in verified PostgreSQL records'
      });
    } catch (err) {
      console.error('DO centres forecast error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load centres forecast table.' });
    }
  });

  // ====================================================================
  // DISTRICT OFFICER: MONTHLY DEMAND TRENDS
  // ====================================================================
  router.get('/district-officer/procurement-forecast/trends', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
    try {
      const assignedDistrict = req.user.district;
      const requestedDistrict = req.query.district;
      if (requestedDistrict && requestedDistrict.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden.' });
      }

      const defaultMonths = ['October 2026', 'November 2026', 'December 2026', 'January 2027'];
      const r = await pool.query(`
        SELECT 
          cd.harvest_period,
          COUNT(cd.id)::int AS plans_count,
          SUM(pf.procurement_min_mt)::numeric AS min_mt,
          SUM(pf.procurement_max_mt)::numeric AS max_mt
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(cd.district) = LOWER($1) AND cd.status != 'CANCELLED'
        GROUP BY cd.harvest_period
      `, [assignedDistrict]);

      const map = new Map(r.rows.map(x => [x.harvest_period, x]));
      const trends = defaultMonths.map(m => {
        if (map.has(m)) {
          const item = map.get(m);
          return {
            period: m,
            plans_count: item.plans_count,
            min_procurement_mt: parseFloat(item.min_mt),
            max_procurement_mt: parseFloat(item.max_mt),
            avg_procurement_mt: parseFloat(((parseFloat(item.min_mt) + parseFloat(item.max_mt)) / 2).toFixed(1))
          };
        }
        return {
          period: m,
          plans_count: 0,
          min_procurement_mt: 0,
          max_procurement_mt: 0,
          avg_procurement_mt: 0
        };
      });

      res.json({
        success: true,
        district: assignedDistrict,
        trends,
        _notice: 'DEMO/SYNTHETIC MONTHLY TRENDS'
      });
    } catch (err) {
      console.error('DO trends error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load trends.' });
    }
  });

  // ====================================================================
  // DISTRICT OFFICER: FORECAST VS ACTUAL COMPARISON
  // ====================================================================
  router.get('/district-officer/procurement-forecast/actual-vs-forecast', authenticateToken, requireRole('DISTRICT_OFFICER'), async (req, res) => {
    try {
      const assignedDistrict = req.user.district;
      const requestedDistrict = req.query.district;
      if (requestedDistrict && requestedDistrict.toLowerCase() !== assignedDistrict.toLowerCase()) {
        return res.status(403).json({ error: 'district_access_denied', message: 'Forbidden.' });
      }

      // Link actual procurement records from bookings / receipts with crop declarations
      const q = `
        SELECT 
          b.booking_id,
          b.farmer_id,
          f.name as farmer_name,
          b.crop,
          COALESCE(b.procured_quantity_quintals, b.quantity_quintals, 0)::numeric / 10.0 AS actual_procured_mt,
          b.status as booking_status,
          cd.id as crop_plan_id,
          cd.harvest_period,
          pf.procurement_min_mt as forecast_min_mt,
          pf.procurement_max_mt as forecast_max_mt
        FROM bookings b
        JOIN farmers f ON b.farmer_id = f.farmer_id
        JOIN crop_declarations cd ON b.farmer_id = cd.farmer_id AND LOWER(b.crop) = LOWER(cd.crop)
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE LOWER(b.centre_id) IN (SELECT LOWER(centre_id) FROM centres WHERE LOWER(district) = LOWER($1))
          AND b.status IN ('Procured', 'Payment Completed', 'Weighing')
        LIMIT 25
      `;

      const r = await pool.query(q, [assignedDistrict]);

      const comparisons = r.rows.map(row => {
        const actual = parseFloat(row.actual_procured_mt);
        const fMin = parseFloat(row.forecast_min_mt);
        const fMax = parseFloat(row.forecast_max_mt);

        const isWithin = actual >= fMin && actual <= fMax;
        return {
          booking_id: row.booking_id,
          farmer_id: row.farmer_id,
          farmer_name: row.farmer_name,
          crop: row.crop,
          harvest_period: row.harvest_period,
          forecast_range_mt: `${fMin} – ${fMax} MT`,
          actual_procured_mt: actual,
          forecast_vs_actual_status: isWithin ? 'Within Forecast Range' : 'Outside Forecast Range',
          variance_mt: parseFloat((actual - ((fMin + fMax) / 2)).toFixed(2))
        };
      });

      const withinCount = comparisons.filter(c => c.forecast_vs_actual_status === 'Within Forecast Range').length;
      const totalCount = comparisons.length;

      res.json({
        success: true,
        district: assignedDistrict,
        total_evaluations: totalCount,
        within_range_count: withinCount,
        accuracy_rate_pct: totalCount > 0 ? Math.round((withinCount / totalCount) * 100) : 0,
        comparisons,
        _notice: 'Forecast accuracy indicators are simple range verifications. No sophisticated ML precision claimed.'
      });
    } catch (err) {
      console.error('Actual vs forecast error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load actual vs forecast comparisons.' });
    }
  });

  // ====================================================================
  // CENTRE ADMIN: MY CENTRE DEMAND OUTLOOK
  // ====================================================================
  router.get('/admin/my-centre/procurement-outlook', authenticateToken, requireRole('CENTRE_ADMIN'), enforceCentreAdminIsolation, async (req, res) => {
    try {
      const assignedCentreId = req.user.centreId || req.user.centre_id;
      if (!assignedCentreId) {
        return res.status(400).json({ error: 'missing_centre_assignment', message: 'No centre assigned to this Centre Admin.' });
      }

      // Strictly block query centre spoofing
      const requestedCentre = req.query.centre_id || req.query.centreId;
      if (requestedCentre && requestedCentre !== assignedCentreId) {
        return res.status(403).json({
          error: 'centre_access_denied',
          message: `Forbidden: You are assigned to centre ${assignedCentreId} and cannot view centre ${requestedCentre}.`
        });
      }

      const cRes = await pool.query('SELECT * FROM centres WHERE centre_id = $1', [assignedCentreId]);
      if (cRes.rows.length === 0) {
        return res.status(404).json({ error: 'centre_not_found', message: 'Centre not found.' });
      }
      const centre = cRes.rows[0];
      const capacity = parseFloat(centre.storage_capacity_mt) || 250;

      // Check total active centres in district to apportion unallocated declarations fairly
      const districtCentresRes = await pool.query(
        `SELECT COUNT(*)::int AS active_centre_count FROM centres WHERE LOWER(district) = LOWER($1) AND operational_status NOT IN ('Closed', 'Retired')`,
        [centre.district]
      );
      const activeCentresInDistrict = Math.max(1, districtCentresRes.rows[0]?.active_centre_count || 1);

      // 1. Directly mapped declarations to this centre
      const directMappedRes = await pool.query(`
        SELECT 
          cd.crop,
          cd.harvest_period,
          COUNT(DISTINCT cd.farmer_id)::int AS expected_farmers,
          COALESCE(SUM(pf.procurement_min_mt), 0)::numeric AS proc_min,
          COALESCE(SUM(pf.procurement_max_mt), 0)::numeric AS proc_max
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE cd.centre_id = $1
          AND cd.status != 'CANCELLED'
        GROUP BY cd.crop, cd.harvest_period
        ORDER BY proc_max DESC
      `, [assignedCentreId]);

      // 2. Unallocated district declarations (if no direct centre mapping exists)
      const districtUnallocatedRes = await pool.query(`
        SELECT 
          cd.crop,
          cd.harvest_period,
          COUNT(DISTINCT cd.farmer_id)::int AS district_farmers,
          COALESCE(SUM(pf.procurement_min_mt), 0)::numeric AS dist_proc_min,
          COALESCE(SUM(pf.procurement_max_mt), 0)::numeric AS dist_proc_max
        FROM crop_declarations cd
        JOIN production_forecasts pf ON cd.id = pf.crop_declaration_id AND pf.is_current = TRUE
        WHERE cd.centre_id IS NULL AND LOWER(cd.district) = LOWER($1)
          AND cd.status != 'CANCELLED'
        GROUP BY cd.crop, cd.harvest_period
        ORDER BY dist_proc_max DESC
      `, [centre.district]);

      let totalFarmers = 0;
      let totalMin = 0;
      let totalMax = 0;
      let mappingMethod = 'DIRECT_CENTRE_ALLOCATION';
      let cropBreakdown = [];

      const distUnassignedRow = districtUnallocatedRes.rows[0] || {};
      const distUnassignedFarmers = parseInt(distUnassignedRow.district_farmers || 0);
      const distUnassignedMin = parseFloat(Number(distUnassignedRow.dist_proc_min || 0).toFixed(2));
      const distUnassignedMax = parseFloat(Number(distUnassignedRow.dist_proc_max || 0).toFixed(2));

      if (directMappedRes.rows.length > 0) {
        directMappedRes.rows.forEach(r => {
          totalFarmers += r.expected_farmers;
          totalMin += parseFloat(r.proc_min);
          totalMax += parseFloat(r.proc_max);
        });
        cropBreakdown = directMappedRes.rows;
      } else {
        // Zero declarations mapped to this centre: report exact recorded 0
        totalFarmers = 0;
        totalMin = 0;
        totalMax = 0;
        mappingMethod = 'DIRECT_CENTRE_ALLOCATION';
      }

      totalMin = parseFloat(totalMin.toFixed(2));
      totalMax = parseFloat(totalMax.toFixed(2));

      const gapMin = Math.max(0, parseFloat((totalMin - capacity).toFixed(2)));
      const gapMax = Math.max(0, parseFloat((totalMax - capacity).toFixed(2)));

      let statusStr = 'Normal Capacity';
      if (totalFarmers === 0) {
        statusStr = 'No Declared Demand';
      } else if (gapMax > 0) {
        statusStr = 'Potential Capacity Pressure';
      } else if (totalMax >= capacity * 0.8) {
        statusStr = 'Watch Capacity';
      }

      res.json({
        success: true,
        centre: {
          centre_id: centre.centre_id,
          centre_name: centre.centre_name,
          village: centre.village_town,
          district: centre.district,
          storage_capacity_mt: capacity,
          daily_slots: centre.daily_capacity_slots
        },
        demand_outlook: {
          forecast_period: 'November 2026',
          primary_crop: cropBreakdown[0]?.crop || 'Paddy',
          expected_farmers: totalFarmers,
          expected_procurement_min_mt: totalMin,
          expected_procurement_max_mt: totalMax,
          centre_capacity_mt: capacity,
          potential_pressure_min_mt: gapMin,
          potential_pressure_max_mt: gapMax,
          status: statusStr,
          mapping_method: mappingMethod,
          active_centres_in_district: activeCentresInDistrict,
          crop_breakdown: cropBreakdown
        },
        guidance: totalFarmers > 0 
          ? 'Early planning forecast grounded in farmer crop declarations. Adjust slot allocations accordingly.'
          : 'No crop declarations registered in this operational catchment area.',
        _notice: 'Authoritative demand planning model grounded in PostgreSQL crop declarations and benchmark yields.'
      });
    } catch (err) {
      console.error('Centre demand outlook error:', err);
      res.status(500).json({ error: 'server_error', message: 'Unable to load centre demand outlook.' });
    }
  });

  return router;
}

module.exports = {
  initPredictivePlanningDb,
  createPredictivePlanningRouter
};
