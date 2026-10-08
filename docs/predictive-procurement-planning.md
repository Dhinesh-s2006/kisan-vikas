# Predictive Procurement Demand Planning Module
**Kisan Queue / Uzhavarsethu Digital Procurement Platform**

---

## 1. Executive Summary & Core Objective

The **Predictive Procurement Demand Planning** module introduces upstream pre-harvest cultivation forecasting and procurement demand planning into the Kisan Queue platform. Historically, procurement operations at Direct Purchase Centres (DPCs) operated reactively—handling arrivals and pacing queues only when harvest had completed and farmers arrived to book slots. 

This module enables a proactive, end-to-end planning cycle by:
1. Enabling farmers (or CSC operators on their behalf) to declare upcoming crop cultivation, expected harvest windows, and estimated acreage 2–4 months prior to harvest.
2. Applying verified agro-climatic benchmark yields and historical procurement factors to compute deterministic production and procurement demand ranges (in Metric Tonnes).
3. Aggregating demand projections at DPC catchment, taluk, and district levels to compute **storage capacity gaps**, **risk pressure levels**, and **actionable planning indicators** (recommended additional slots, buffer storage, and personnel).
4. Reconciling upstream forecasts against verified weighbridge receipts post-procurement to benchmark forecasting accuracy.

> **Demonstration & Synthetic Data Disclosure**:  
> In accordance with the system transparency guidelines, all reference yields, seeded crop plans, and forecast aggregations are clearly identified across the UI with **DEMO MODE**, **Forecast**, or **Estimated** badges.

---

## 2. Database Schema & Architecture

The module is implemented in `backend/predictivePlanning.js` and backed by four normalized, indexed PostgreSQL tables designed for strict auditability and version tracking.

```
+----------------------------+       1:N       +----------------------------+
|   crop_reference_yields    | --------------< |     crop_declarations      |
+----------------------------+                 +----------------------------+
| crop (PK)                  |                 | id (PK, e.g. CP-2026-XXXX) |
| yield_min_mt_per_acre      |                 | farmer_id (FK -> farmers)  |
| yield_max_mt_per_acre      |                 | centre_id (FK -> centres)  |
| procurement_factor_min     |                 | crop, cultivated_area      |
| procurement_factor_max     |                 | sowing_date, harvest_start |
+----------------------------+                 | expected_procurement_range |
                                               | status, update_reason      |
                                               +----------------------------+
                                                             |
                                            1:N (Versioned)  |  1:N (Audit)
                                                             v
+----------------------------+                 +----------------------------+
|    production_forecasts    |                 |   crop_plan_audit_logs     |
+----------------------------+                 +----------------------------+
| id (PK)                    |                 | id (PK)                    |
| crop_declaration_id (FK)   |                 | crop_declaration_id (FK)   |
| version (v1, v2, v3...)    |                 | action (CREATED, UPDATED)  |
| is_current (BOOLEAN)       |                 | previous_value (JSONB)     |
| production_min_mt          |                 | new_value (JSONB)          |
| production_max_mt          |                 | performed_by, role, reason |
| procurement_min_mt         |                 | timestamp                  |
| procurement_max_mt         |                 +----------------------------+
| algorithm_version          |
+----------------------------+
```

### 2.1 Table Specifications

1. **`crop_reference_yields`**:
   - Stores standardized baseline productivity indices per crop for Tamil Nadu agro-climatic zones.
   - Seeded benchmark values:
     - **Paddy**: 1.60 – 2.00 MT/acre yield; 0.75 – 0.85 procurement ratio (FAQ standards).
     - **Maize**: 2.20 – 2.80 MT/acre yield; 0.70 – 0.80 procurement ratio.
     - **Groundnut**: 0.80 – 1.20 MT/acre yield; 0.60 – 0.75 procurement ratio.
     - **Cotton**: 0.70 – 1.00 MT/acre yield; 0.80 – 0.90 procurement ratio.
     - **Sugarcane**: 35.00 – 45.00 MT/acre yield; 0.85 – 0.95 procurement ratio.

2. **`crop_declarations`**:
   - Primary declaration record for farmer cultivation intentions.
   - Fields: `id`, `farmer_id`, `crop`, `cultivated_area`, `area_unit`, `sowing_date`, `expected_harvest_start`, `expected_harvest_end`, `harvest_period`, `irrigation_type`, `crop_variety`, `farmer_estimated_procurement_qty`, `centre_id`, `district`, `village`, `status`, `update_reason`.

3. **`production_forecasts`**:
   - Maintains complete version history for mathematical forecast evaluations.
   - Every update or recalculation archives previous rows (`is_current = FALSE`) and increments the version counter (`version = version + 1`, `is_current = TRUE`).

4. **`crop_plan_audit_logs`**:
   - Tamper-evident operational audit log recording every creation, update, and recalculation event with actor credentials, role, timestamp, reason, and full JSON diffs.

---

## 3. Mathematical Forecasting Engine

All forecasting operations follow deterministic, transparent agro-mathematical formulations without ungrounded AI/ML claims.

### 3.1 Production Estimation
Given a declared cultivated area $A$ (in acres) and crop benchmark yield range $[Y_{\min}, Y_{\max}]$ (MT/acre):

$$\text{Production}_{\min} = A \times Y_{\min}$$
$$\text{Production}_{\max} = A \times Y_{\max}$$

### 3.2 Procurement Demand Forecasting
Farmers typically retain a fraction of harvest for family consumption, seeds, or local trade. Given procurement retention factor range $[P_{\min}, P_{\max}]$ (e.g. 75%–85% for Paddy):

$$\text{Demand}_{\min} = \text{Production}_{\min} \times P_{\min}$$
$$\text{Demand}_{\max} = \text{Production}_{\max} \times P_{\max}$$

### 3.3 Storage Capacity Gap Simulation
For any administrative entity (District or individual DPC) with storage capacity $C$ (in MT) and aggregate maximum projected procurement demand $D_{\max} = \sum \text{Demand}_{\max}$:

$$\text{Storage Gap} = \max(0, D_{\max} - C)$$

### 3.4 Operational Risk Classification
- **NORMAL**: $D_{\max} \le 0.80 \times C$ (Sufficient headroom).
- **WATCH / CAUTION**: $0.80 \times C < D_{\max} \le 1.00 \times C$ (Utilization approaching threshold).
- **CRITICAL / HIGH PRESSURE**: $D_{\max} > 1.00 \times C$ (Deficit detected; $\text{Storage Gap} > 0$).

### 3.5 Planning Indicators (DPC Capacity Table)
- **Recommended Daily Slots**:
  $$\Delta \text{Slots} = \left\lceil \frac{\text{Storage Gap}}{\text{Harvest Days} \times \text{Avg Batch MT}} \right\rceil$$
- **Buffer Storage Required**: $\text{Storage Gap}$ in Metric Tonnes.
- **Recommended Staffing**: Automated recommendation based on slot throughput requirements.

---

## 4. Role-Based Perspectives & UI Implementation

The module delivers tailored workflows across four distinct user roles:

### 4.1 Farmer Perspective: *My Crop Plan* (`/farmer/crop-plan`)
- **Self-Service Declaration Form**: Enables input of crop type, acreage, sowing date, expected harvest window, and irrigation type.
- **Dynamic Pre-Harvest Preview**: Automatically recalculates expected production and procurement ranges as acreage is entered.
- **Version History Drawer**: Displays previous iterations (`v1`, `v2`, `v3`) with update reasons and audit timestamps.
- **One-Click Recalculation**: Re-runs mathematical benchmarks on existing declarations if weather or crop parameters change.
- **Planning Disclaimer**: Clear notice that crop declarations assist administrative planning and do not substitute for formal slot booking.

### 4.2 CSC Operator Perspective: *Farmer Crop Declaration* (`/csc/crop-declarations`)
- **Assisted Entry Desk**: Designed for village Common Service Centre (CSC) operators assisting non-smartphone farmers.
- **Farmer Directory Search**: Instant lookup by farmer name, ID, or mobile number within the operator's assigned district.
- **District Confinement**: Automatically enforces strict district boundaries (e.g. CSC Vellore can only register Vellore farmers).
- **Printable Thermal Receipt**: Generates a standardized acknowledgement slip (monospace, 58mm/80mm thermal receipt format) complete with QR-verifiable receipt ID (`RCPT-CSC-...`), estimated delivery window, and statutory planning disclaimers.

### 4.3 District Officer Perspective: *Procurement Forecast* (`/district-officer/procurement-forecast`)
- **Executive Command Dashboard**: Displays 5 primary KPI cards:
  1. *Declared Crop Plans*
  2. *Expected Farmers*
  3. *Cultivated Acres*
  4. *Projected Demand Range (MT)*
  5. *District Storage Gap & Risk Badge*
- **Visual Analytics**:
  - *Projected Demand by Crop*: Proportionate comparative bar chart across commodities.
  - *Monthly Harvest Arrival Curve*: Distribution across peak harvest months (October, November, December, January).
- **DPC Capacity & Forecast Gap Simulation Table**: Comprehensive breakdown of every procurement centre in the district showing capacity, projected demand, risk level, and operational planning indicators (additional slots, storage, staff).
- **Pre-Harvest Forecast vs. Actual Receipts Table**: Cross-references verified weighment receipts against initial farmer declarations, calculating range accuracy rates.

### 4.4 Centre Admin Perspective: *Centre Demand Outlook* (Port 3001)
- **Local Catchment Card**: Integrated into the primary Centre Admin dashboard.
- **Key Metrics**: Primary declared crop, expected farmers in catchment area, projected procurement volume range, and centre storage headroom or pressure.
- **Operational Guidance**: Recommends slot pacing adjustments and preparation timelines for harvest arrival.

---

## 5. Security, RBAC & Data Integrity

1. **Role-Based Access Control (RBAC)**:
   - `FARMER`: Restricted to own declarations via `farmer_id` JWT claim.
   - `CSC_OPERATOR`: Restricted to registering and viewing declarations strictly within their authorized district.
   - `DISTRICT_OFFICER`: Restricted to aggregate and centre-level analytics strictly within their authorized district.
   - `CENTRE_ADMIN`: Strictly isolated to the assigned centre ID.

2. **Insecure Direct Object Reference (IDOR) Protections**:
   - All update (`PUT /api/crop-plans/:id`) and recalculation (`POST /api/crop-plans/:id/recalculate`) endpoints verify that the requesting farmer owns the record.
   - Unauthorized attempts return `403 Forbidden` with `farmer_access_denied`.

3. **District Perimeter Checks**:
   - Cross-district queries (e.g. DO Vellore attempting to query Madurai data) are intercepted and rejected with `403 Forbidden` (`district_access_denied`).

4. **Zero-Deletion & Baseline Preservation**:
   - Strict additive design guarantees that all 3,603 centres, 459 baseline farmers, and 391 baseline bookings remain untouched.
   - All regression suites for Phase 7.1 (Dynamic Pacing), Phase 7.2 (Fairness), and Phase 7.3 (Procurement Record) remain 100% operational.

---

## 6. Verification & Automated Test Coverage

The module has been comprehensively validated across two separate test suites:

### 6.1 Backend API Automated Battery (`backend/scripts/test_predictive_planning.js`)
- **36 / 36 Tests Passed (100%)**
  - Baseline zero-deletion verification (Centres: 3603, Farmers: 459, Bookings: 391, Declarations: 308+).
  - Benchmark yield retrieval and formula validation.
  - Multi-role authentication (DO, CSC, Centre Admin, Farmers).
  - Version increment and immutable audit logging.
  - Thermal receipt generation and validation.
  - 5 KPI calculations, storage gap analysis, and planning indicators.
  - Forecast vs actual weighment reconciliation.
  - Full RBAC, IDOR, and perimeter security denial tests.

### 6.2 Browser End-to-End Test Battery (`scratch/test_browser_predictive_planning.js`)
- **23 / 23 Tests Passed (100%)**
  - Farmer Crop Plan: Load, advisory notice, dynamic preview, version badges, history drawer.
  - CSC Assisted Entry: Desk load, operator profile, farmer search & auto-select, thermal receipt modal.
  - District Officer Forecast: Command center load, 5 KPI cards, storage gap, risk badge, visual charts, DPC table, forecast vs actual table.
  - Centre Admin Outlook: Dashboard load, demand outlook card, metrics grid, guidance, demo mode disclosure.
  - Full-resolution visual proof captured for all 4 perspectives.
