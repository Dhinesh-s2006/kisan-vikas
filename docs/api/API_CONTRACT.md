# Kisan Queue / Uzhavarsethu — API Contract Specification
**Base URL**: `http://localhost:4000/api`  
**Protocol**: HTTP/1.1 REST + JSON  
**Authentication**: `Authorization: Bearer <JWT_TOKEN>`

---

## 1. Authentication & Identity Endpoints

### 1.1 Login
- **Endpoint**: `POST /api/auth/login`
- **Auth Required**: None (Public)
- **Body**: `{ "username": "...", "password": "..." }`
- **Response (200)**: `{ "success": true, "token": "<JWT>", "user": { ... } }`

### 1.2 Session Identity
- **Endpoint**: `GET /api/auth/me`
- **Auth Required**: `authenticateToken`
- **Response (200)**: Decoded token payload with userId, role, district, centreId, farmerId.

---

## 2. Core Farmer & Booking Endpoints

### 2.1 Register Farmer
- **Endpoint**: `POST /api/farmers/register`
- **Auth Required**: None (Public self-registration)
- **Body**: `{ "name": "...", "phone": "...", "district": "...", "aadhaar_last4": "..." }`

### 2.2 Get Farmer Bookings
- **Endpoint**: `GET /api/bookings/:farmerId`
- **Auth Required**: `authenticateToken`
- **Access Policy**:
  - `FARMER`: Scoped to own `farmerId` only (403 on mismatch).
  - `CSC_OPERATOR`: Scoped to farmers within assigned district.
  - `CENTRE_ADMIN`: Scoped to bookings under assigned centre.
  - `DISTRICT_OFFICER`: Scoped to farmers within assigned district.
- **Unauthenticated**: 401 Unauthorized.

### 2.3 Create Booking
- **Endpoint**: `POST /api/bookings`
- **Auth Required**: None / Farmer
- **Body**: `{ "farmer_id": "...", "centre_id": "...", "slot_id": "...", "crop": "...", "quantity_quintals": 10 }`
- **Response (200/201)**: `{ "booking_id": "...", "queue_position": 1, "token": "..." }`

### 2.4 Advance Booking Status (Secured)
- **Endpoint**: `PATCH /api/bookings/:id/status`
- **Auth Required**: `authenticateToken`
- **Allowed Roles**: `CENTRE_ADMIN` (Must match assigned centre).
- **Prohibited Roles**: `FARMER` (403), `CSC_OPERATOR` (403), unauthorized roles (403).
- **Body**: `{ "status": "Checked-In" | "Grading" | "Weighing" | "Procured" | "Payment Completed" }`

---

## 3. Physical Procurement Workflow Endpoints

### 3.1 Record Quality Assessment
- **Endpoint**: `POST /api/bookings/:id/quality`
- **Auth Required**: `authenticateToken` (`CENTRE_ADMIN`)
- **Body**: `{ "grade": "FAQ", "moisture_percent": 12.5, "foreign_matter_percent": 1.0 }`

### 3.2 Record Weighment
- **Endpoint**: `POST /api/bookings/:id/weighment`
- **Auth Required**: `authenticateToken` (`CENTRE_ADMIN`)
- **Precedence**: Authorization verified first (403 if foreign centre), then mathematical check (400 if Gross <= Tare).
- **Body**: `{ "gross_weight_kg": 2550, "tare_weight_kg": 50, "weighing_method": "ELECTRONIC_WEIGHBRIDGE" }`
- **Calculated Net**: `Net = Gross - Tare = 2500 kg`.

### 3.3 Procurement Acceptance & Receipt
- **Endpoint**: `POST /api/bookings/:id/procurement-acceptance`
- **Auth Required**: `authenticateToken` (`CENTRE_ADMIN`)
- **Response (200)**: Unique receipt `PROC-2026-XXXXXX` with cryptographic SHA-256 seal.

### 3.4 Record DBT Payment
- **Endpoint**: `POST /api/bookings/:id/payment`
- **Auth Required**: `authenticateToken` (`CENTRE_ADMIN`)
- **Body**: `{ "payment_method": "DIRECT_BENEFIT_TRANSFER", "transaction_ref": "..." }`

---

## 4. Predictive Procurement Demand Planning Endpoints

### 4.1 Benchmark Reference Yields
- **Endpoint**: `GET /api/crop-plans/reference-yields`
- **Auth Required**: None (Public catalog)
- **Returns**: Yield ranges and procurement ratios for Paddy, Maize, Groundnut, Cotton, Sugarcane.

### 4.2 Create Crop Plan
- **Endpoint**: `POST /api/crop-plans`
- **Auth Required**: `authenticateToken` (`FARMER`)
- **Validation**:
  - Crop must exist in `crop_reference_yields` (400 `unsupported_crop` if unknown).
  - `expected_harvest_start <= expected_harvest_end` (400 `invalid_harvest_date_range` if inverted).
  - Area must be positive.
- **Response (201)**: Created declaration with version 1 production & procurement forecast.

### 4.3 Update Crop Plan (Versioning)
- **Endpoint**: `PUT /api/crop-plans/:id`
- **Auth Required**: `authenticateToken` (`FARMER`)
- **Validation**: Mandatory `update_reason`, harvest chronology, supported crop.
- **Effect**: Marks previous forecast `is_current = false`, generates version v2/v3, logs audit record.

### 4.4 CSC Assisted Crop Declaration
- **Endpoint**: `POST /api/csc/crop-plans`
- **Auth Required**: `authenticateToken` (`CSC_OPERATOR`)
- **Access Policy**: Restricted to operator's assigned district (403 on cross-district).
- **Response (201)**: Declaration with printable thermal receipt metadata and advisory disclaimer.

### 4.5 District Officer Demand Forecast & KPIs
- **Endpoint**: `GET /api/district-officer/procurement-forecast`
- **Auth Required**: `authenticateToken` (`DISTRICT_OFFICER`)
- **Access Policy**: Confined to officer's assigned district (403 on cross-district).
- **Returns**: 5 KPIs (Declarations, Farmers, Demand Min/Max MT, Capacity, Storage Gap).

### 4.6 Centre Admin Catchment Demand Outlook
- **Endpoint**: `GET /api/admin/my-centre/procurement-outlook`
- **Auth Required**: `authenticateToken` (`CENTRE_ADMIN`)
- **Access Policy**: Defensively resolved from `req.user.centreId`; query spoofing rejected with 403.
- **Returns**: Catchment demand, expected farmers, risk status.

---

## 5. District Officer Governance & Oversight Endpoints

### 5.1 District Grievance Oversight (Secured)
- **Endpoint**: `GET /api/district/grievances`
- **Auth Required**: `authenticateToken` (`DISTRICT_OFFICER`)
- **Access Policy**: Strictly scoped to officer's district (401 unauthenticated, 403 foreign district).

### 5.2 Centre Accountability Monitoring (Secured)
- **Endpoint**: `GET /api/district/accountability`
- **Auth Required**: `authenticateToken` (`DISTRICT_OFFICER`)
- **Access Policy**: Strictly scoped to officer's district (401 unauthenticated, 403 foreign district).

### 5.3 District GIS Map
- **Endpoint**: `GET /api/district-officer/map`
- **Auth Required**: `authenticateToken` (`DISTRICT_OFFICER`)
- **Returns**: Geographic coordinates, status (Open/Closed), and capacity for DPCs in officer's district.
