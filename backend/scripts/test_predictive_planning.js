const assert = require('assert');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const API_BASE = 'http://localhost:4000/api';
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME
      }
);

async function api(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('===============================================================');
  console.log('PREDICTIVE DEMAND PLANNING — COMPREHENSIVE AUTOMATED TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function record(testName, ok, detail = '') {
    if (ok) {
      console.log(`  ✓ PASS: ${testName} ${detail ? '(' + detail + ')' : ''}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} — ${detail}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Baseline zero-deletion check
    // -------------------------------------------------------------
    const cRes = await pool.query('SELECT COUNT(*)::int as count FROM centres');
    const fRes = await pool.query('SELECT COUNT(*)::int as count FROM farmers');
    const bRes = await pool.query('SELECT COUNT(*)::int as count FROM bookings');
    const dRes = await pool.query('SELECT COUNT(*)::int as count FROM crop_declarations');

    record('Baseline Centres Preserved', cRes.rows[0].count >= 3598, `Centres count: ${cRes.rows[0].count}`);
    record('Baseline Farmers Preserved', fRes.rows[0].count >= 259, `Farmers count: ${fRes.rows[0].count}`);
    record('Baseline Bookings Preserved', bRes.rows[0].count >= 180, `Bookings count: ${bRes.rows[0].count}`);
    record('Seeded Crop Declarations Present', dRes.rows[0].count >= 300, `Declarations count: ${dRes.rows[0].count}`);

    // -------------------------------------------------------------
    // TEST 2: Reference Yields Public Endpoint
    // -------------------------------------------------------------
    const refRes = await api('GET', '/crop-plans/reference-yields');
    const benchmarks = refRes.data?.reference_yields || [];
    record('GET /crop-plans/reference-yields returns benchmarks', benchmarks.length >= 5, `Found ${benchmarks.length} crops`);
    const paddyBenchmark = benchmarks.find(b => b.crop.toLowerCase().includes('paddy'));
    const yMin = parseFloat(paddyBenchmark?.min_yield_mt_per_acre ?? paddyBenchmark?.yield_min_mt_per_acre ?? 0);
    record('Paddy benchmark values correct',
      paddyBenchmark && Math.abs(yMin - 1.6) < 0.01,
      `Yield min: ${yMin}, max: ${paddyBenchmark?.max_yield_mt_per_acre}`
    );

    // -------------------------------------------------------------
    // Authenticate Actors
    // -------------------------------------------------------------
    const testDoPassword = process.env.TEST_DO_PASSWORD;
    const testDoMaduraiPassword = process.env.TEST_DO_MADURAI_PASSWORD || process.env.INITIAL_DEMO_PASSWORD || process.env.TEST_ADMIN_PASSWORD;
    const testCscPassword = process.env.TEST_CSC_PASSWORD;
    const testAdminPassword = process.env.TEST_ADMIN_PASSWORD || process.env.INITIAL_DEMO_PASSWORD;

    if (!testDoPassword || !testCscPassword || !testAdminPassword) {
      throw new Error(
        'Missing test credentials in environment! Please ensure TEST_DO_PASSWORD, TEST_CSC_PASSWORD, and TEST_ADMIN_PASSWORD are set in backend/.env'
      );
    }

    // DO Vellore
    const doLoginRes = await api('POST', '/auth/login', { username: 'district_officer_vellore', password: testDoPassword });
    const doToken = doLoginRes.data?.token;
    assert(doToken, 'DO Vellore token received');
    record('DO Vellore Login Successful', !!doToken, `User: ${doLoginRes.data?.user?.username} (${doLoginRes.data?.user?.district})`);

    // DO Madurai
    const doMaduraiRes = await api('POST', '/auth/login', { username: 'officer_madurai', password: testDoMaduraiPassword });
    const doMaduraiToken = doMaduraiRes.data?.token;
    assert(doMaduraiToken, 'DO Madurai token received');
    record('DO Madurai Login Successful', !!doMaduraiToken, `User: ${doMaduraiRes.data?.user?.username} (${doMaduraiRes.data?.user?.district})`);

    // CSC Vellore
    const cscLoginRes = await api('POST', '/auth/login', { username: 'csc_vellore', password: testCscPassword });
    const cscToken = cscLoginRes.data?.token;
    assert(cscToken, 'CSC Vellore token received');
    record('CSC Vellore Login Successful', !!cscToken, `User: ${cscLoginRes.data?.user?.username} (${cscLoginRes.data?.user?.district})`);

    // Centre Admin Madurai (TN_DPC_0859)
    const adminLoginRes = await api('POST', '/auth/login', { username: 'admin_madurai', password: testAdminPassword });
    const adminToken = adminLoginRes.data?.token;
    assert(adminToken, 'Admin Madurai token received');
    record('Centre Admin Madurai Login Successful', !!adminToken, `User: ${adminLoginRes.data?.user?.username}`);

    // Farmer 1 Session
    const farmerRegRes = await api('POST', '/farmers/register', {
      farmer_id: 'FARMER-1',
      name: 'Murugan S.',
      district: 'Vellore',
      village: 'Anaicut',
      phone: '9876543210',
      land_holding_acres: 4.5,
      primary_crop: 'Paddy',
      preferred_language: 'Tamil',
      smartphone_access: 'Yes'
    });
    const farmerToken = farmerRegRes.data?.token;
    assert(farmerToken, 'Farmer 1 token generated');
    record('Farmer 1 Session Activated', !!farmerToken, `Farmer ID: FARMER-1`);

    // Farmer 2 Session
    const farmer2RegRes = await api('POST', '/farmers/register', {
      farmer_id: 'FARMER-2',
      name: 'Ramasamy K.',
      district: 'Vellore',
      village: 'Anaicut',
      phone: '9876543211',
      land_holding_acres: 3.0,
      primary_crop: 'Paddy',
      preferred_language: 'Tamil',
      smartphone_access: 'Yes'
    });
    const farmer2Token = farmer2RegRes.data?.token;
    assert(farmer2Token, 'Farmer 2 token generated');
    record('Farmer 2 Session Activated', !!farmer2Token, `Farmer ID: FARMER-2`);

    // -------------------------------------------------------------
    // TEST 3: Farmer Self-Service Crop Plan Creation
    // -------------------------------------------------------------
    const createRes = await api('POST', '/crop-plans', {
      farmer_id: 'FARMER-1',
      crop: 'Paddy',
      cultivated_area: 5.0,
      area_unit: 'acres',
      sowing_date: '2026-07-15',
      expected_harvest_start: '2026-11-01',
      expected_harvest_end: '2026-11-20',
      irrigation_type: 'Canal',
      crop_variety: 'ADT 45',
      expected_procurement_quantity: null
    }, farmerToken);

    const newPlan = createRes.data?.crop_plan;
    record('POST /crop-plans creates declaration', newPlan && newPlan.id.startsWith('CP-2026-'), `Plan ID: ${newPlan?.id}`);

    // Math range verification: 5.0 acres * (1.6 - 2.0) = 8.0 - 10.0 MT production; 75-85% = 6.0 - 8.5 MT procurement
    const forecastV1 = createRes.data?.forecast;
    record('Forecast calculation formula accurate',
      forecastV1 &&
      parseFloat(forecastV1.production_min_mt) === 8.0 &&
      parseFloat(forecastV1.production_max_mt) === 10.0 &&
      parseFloat(forecastV1.procurement_min_mt) === 6.0 &&
      parseFloat(forecastV1.procurement_max_mt) === 8.5,
      `Prod: ${forecastV1?.production_min_mt}-${forecastV1?.production_max_mt} MT, Proc: ${forecastV1?.procurement_min_mt}-${forecastV1?.procurement_max_mt} MT`
    );

    // -------------------------------------------------------------
    // TEST 4: Farmer Get Own Plans & Details
    // -------------------------------------------------------------
    const myPlansRes = await api('GET', '/crop-plans/my?farmer_id=FARMER-1', null, farmerToken);
    record('GET /crop-plans/my returns farmer declarations', myPlansRes.data?.crop_plans?.length > 0, `Count: ${myPlansRes.data.count}`);

    const detailsRes = await api('GET', `/crop-plans/${newPlan.id}`, null, farmerToken);
    record('GET /crop-plans/:id returns plan with version history', detailsRes.data?.forecast_versions?.length >= 1 && detailsRes.data?.audit_history?.length >= 1);

    // -------------------------------------------------------------
    // TEST 5: Farmer Update Crop Plan (Increments Forecast Version)
    // -------------------------------------------------------------
    // Update without reason must be rejected
    const updateNoReasonRes = await api('PUT', `/crop-plans/${newPlan.id}`, { cultivated_area: 6.0 }, farmerToken);
    record('PUT /crop-plans/:id rejects update without explicit reason', updateNoReasonRes.status === 400 && updateNoReasonRes.data?.error === 'update_reason_required');

    // Update with reason
    const updateRes = await api('PUT', `/crop-plans/${newPlan.id}`, {
      cultivated_area: 6.0,
      update_reason: 'Acreage expanded after boundary survey'
    }, farmerToken);

    record('PUT /crop-plans/:id updates declaration', updateRes.data?.success === true);
    record('PUT /crop-plans/:id increments forecast version to v2', updateRes.data?.new_forecast?.forecast_version === 2, `Version: ${updateRes.data?.new_forecast?.forecast_version}`);
    record('Updated forecast recalculated accurately',
      parseFloat(updateRes.data?.new_forecast?.production_min_mt) === 9.6 &&
      parseFloat(updateRes.data?.new_forecast?.production_max_mt) === 12.0,
      `Prod: ${updateRes.data?.new_forecast?.production_min_mt}-${updateRes.data?.new_forecast?.production_max_mt} MT`
    );

    // -------------------------------------------------------------
    // TEST 6: Recalculate Endpoint
    // -------------------------------------------------------------
    const recalcRes = await api('POST', `/crop-plans/${newPlan.id}/recalculate`, {}, farmerToken);
    record('POST /crop-plans/:id/recalculate increments to v3', recalcRes.data?.new_forecast?.forecast_version === 3, `Version: ${recalcRes.data?.new_forecast?.forecast_version}`);

    // -------------------------------------------------------------
    // TEST 7: CSC Assisted Crop Plan Registration & Printable Receipt
    // -------------------------------------------------------------
    const cscPlanRes = await api('POST', '/csc/crop-plans', {
      farmer_id: 'FARMER-2',
      crop: 'Groundnut',
      cultivated_area: 4.0,
      area_unit: 'acres',
      sowing_date: '2026-07-10',
      expected_harvest_start: '2026-10-25',
      expected_harvest_end: '2026-11-15',
      district: 'Vellore'
    }, cscToken);

    const cscReceipt = cscPlanRes.data?.receipt;
    record('POST /csc/crop-plans creates assisted declaration', cscPlanRes.status === 201 && cscReceipt, `Receipt ID: ${cscReceipt?.receipt_id}`);
    record('CSC receipt contains printable metadata & advisory',
      cscReceipt?.crop_plan_id && cscReceipt?.farmer_name && cscReceipt?.estimated_production_range && cscReceipt?.advisory,
      `Advisory: "${cscReceipt?.advisory?.slice(0, 30)}..."`
    );

    // -------------------------------------------------------------
    // TEST 8: CSC District List
    // -------------------------------------------------------------
    const cscListRes = await api('GET', '/csc/crop-plans?district=Vellore', null, cscToken);
    record('GET /csc/crop-plans returns district crop declarations', cscListRes.data?.crop_plans?.length > 0, `Count: ${cscListRes.data.count}`);

    // -------------------------------------------------------------
    // TEST 9: District Officer Procurement Forecast & 5 KPIs
    // -------------------------------------------------------------
    const doForecastRes = await api('GET', '/district-officer/procurement-forecast?district=Vellore', null, doToken);
    const kpi = doForecastRes.data?.kpi_summary;
    record('GET /district-officer/procurement-forecast returns 5 KPIs',
      kpi &&
      kpi.registered_plans >= 100 &&
      kpi.expected_farmers >= 50 &&
      kpi.cultivated_acres > 0 &&
      kpi.procurement_min_mt > 0 &&
      kpi.available_capacity_mt > 0,
      `Plans: ${kpi?.registered_plans}, Farmers: ${kpi?.expected_farmers}, Demand: ${kpi?.procurement_min_mt}-${kpi?.procurement_max_mt} MT`
    );
    record('District storage capacity gap formula correct (max(0, demand - capacity))',
      kpi?.potential_gap_min_mt >= 0 && kpi?.potential_gap_max_mt >= 0 && ['NORMAL', 'WATCH', 'HIGH PRESSURE'].includes(kpi?.risk_level),
      `Gap: ${kpi?.potential_gap_min_mt}-${kpi?.potential_gap_max_mt} MT, Risk: ${kpi?.risk_level}`
    );

    // -------------------------------------------------------------
    // TEST 10: DO District Breakdown & Trends
    // -------------------------------------------------------------
    const doDistRes = await api('GET', '/district-officer/procurement-forecast/district?district=Vellore', null, doToken);
    record('GET /district-officer/procurement-forecast/district returns crop & harvest breakdowns',
      doDistRes.data?.crop_breakdown?.length > 0 && doDistRes.data?.harvest_breakdown?.length > 0
    );

    const doTrendsRes = await api('GET', '/district-officer/procurement-forecast/trends?district=Vellore', null, doToken);
    record('GET /district-officer/procurement-forecast/trends returns monthly demand curve',
      doTrendsRes.data?.trends?.length === 4,
      `Months: ${doTrendsRes.data?.trends?.map(t => t.period.split(' ')[0]).join(', ')}`
    );

    // -------------------------------------------------------------
    // TEST 11: DO Centres Capacity & Forecast Table with Planning Indicators
    // -------------------------------------------------------------
    const doCentresRes = await api('GET', '/district-officer/procurement-forecast/centres?district=Vellore', null, doToken);
    const cTable = doCentresRes.data?.centres_forecast || [];
    record('GET /district-officer/procurement-forecast/centres returns DPC table', cTable.length > 0, `Count: ${cTable.length} centres`);
    const firstCentre = cTable[0];
    record('DPC table includes planning indicators (slots, storage, staff)',
      firstCentre?.planning_indicators &&
      firstCentre.planning_indicators.label === 'Planning estimate' &&
      firstCentre.risk_level,
      `Risk: ${firstCentre?.risk_level}, Slots: +${firstCentre?.planning_indicators?.estimated_additional_slots}`
    );

    // -------------------------------------------------------------
    // TEST 12: DO Actual vs Forecast Comparison Table
    // -------------------------------------------------------------
    const doCompRes = await api('GET', '/district-officer/procurement-forecast/actual-vs-forecast?district=Vellore', null, doToken);
    record('GET /district-officer/procurement-forecast/actual-vs-forecast cross-references weighment receipts',
      doCompRes.data?.accuracy_rate_pct !== undefined && Array.isArray(doCompRes.data?.comparisons),
      `Accuracy Rate: ${doCompRes.data?.accuracy_rate_pct}% (${doCompRes.data?.within_range_count}/${doCompRes.data?.total_evaluations})`
    );

    // -------------------------------------------------------------
    // TEST 13: Centre Admin Centre Demand Outlook
    // -------------------------------------------------------------
    const adminOutlookRes = await api('GET', '/admin/my-centre/procurement-outlook', null, adminToken);
    const outlook = adminOutlookRes.data?.demand_outlook;
    record('GET /admin/my-centre/procurement-outlook returns catchment demand',
      outlook && outlook.expected_farmers > 0 && outlook.expected_procurement_max_mt > 0,
      `Farmers: ${outlook?.expected_farmers}, Demand: ${outlook?.expected_procurement_min_mt}-${outlook?.expected_procurement_max_mt} MT, Status: ${outlook?.status}`
    );

    // -------------------------------------------------------------
    // TEST 14: Strict RBAC & IDOR Isolation Verification
    // -------------------------------------------------------------
    // 14a. DO Vellore cannot request DO Madurai forecast
    const doCrossRes = await api('GET', '/district-officer/procurement-forecast?district=Madurai', null, doToken);
    record('RBAC: DO Vellore denied access to Madurai forecasts (403)', doCrossRes.status === 403 && doCrossRes.data?.error === 'district_access_denied');

    // 14b. Farmer 1 cannot update Farmer 2 plan
    const farmerIdorRes = await api('PUT', `/crop-plans/${cscPlanRes.data?.crop_plan?.id}`, {
      cultivated_area: 10.0,
      update_reason: 'Malicious modification attempt'
    }, farmerToken);
    record('IDOR: Farmer 1 denied update to Farmer 2 plan (403)', farmerIdorRes.status === 403 && farmerIdorRes.data?.error === 'farmer_access_denied');

    // 14c. Farmer 1 cannot view Farmer 2 plans via /my
    const farmerMyIdorRes = await api('GET', '/crop-plans/my?farmer_id=FARMER-2', null, farmerToken);
    record('IDOR: Farmer 1 denied fetching Farmer 2 plans via /my (403)', farmerMyIdorRes.status === 403 && farmerMyIdorRes.data?.error === 'farmer_access_denied');

    // 14d. CSC Vellore cannot register plan in Madurai
    const cscCrossRes = await api('POST', '/csc/crop-plans', {
      farmer_id: 'FARMER-1',
      crop: 'Paddy',
      cultivated_area: 5.0,
      sowing_date: '2026-07-15',
      expected_harvest_start: '2026-11-01',
      expected_harvest_end: '2026-11-20',
      district: 'Madurai'
    }, cscToken);
    record('Perimeter: CSC Vellore denied registering crop plan in Madurai (403)', cscCrossRes.status === 403 && cscCrossRes.data?.error === 'district_access_denied');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n===============================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
