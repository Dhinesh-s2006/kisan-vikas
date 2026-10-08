# Kisan Vikas — Comprehensive Test Execution Guide

## 1. Overview
The Kisan Vikas test suite rigorously verifies system guarantees, including ACID transaction safety, atomic capacity locking, calendar date integrity, multi-channel IVR and website synchronization, and canonical booking lifecycle states.

---

## 2. Running Authoritative Test Suites

All tests are executed from the `backend/` directory using Node.js:

### 2.1 Date Off-by-One & Calendar Integrity Suite
Verifies calendar date preservation (`YYYY-MM-DD`), midnight boundary slots, and zero UTC drift across PostgreSQL, API serialization, and UI formatting.
```bash
cd backend
node scripts/test_booking_date_off_by_one_suite.js
# Output: 26 / 26 Assertions Passed (100%)
```

### 2.2 Production Reliability & Invariants Suite
Verifies all 18 core platform invariants, including unarrived slot expiration, physical queue filtering, fairness prioritization, and non-blocking alternative centre recommendations.
```bash
cd backend
node scripts/test_production_reliability_suite.js
# Output: 26 / 26 Invariants Passed (100%)
```

### 2.3 Critical Lifecycle & IVR Persistence Sync Suite
Verifies that IVR bookings are physically persisted in PostgreSQL, active-booking endpoints match, completed visits never appear in the active physical queue, and slot expiration rejects past dates.
```bash
cd backend
node scripts/test_critical_lifecycle_and_ivr_sync.js
# Output: 20 / 20 Assertions Passed (100%)
```

### 2.4 Canonical Business Logic Verification
Validates comprehensive business logic rules across multi-district constraints, slot capacities, and status state machines.
```bash
cd backend
node tests/verify_canonical_business_logic.js
```

### 2.5 IVR Concurrency & Recommendation Parity Suite
Verifies parallel booking requests, idempotency key replays, and recommendation parity between IVR and the web application.
```bash
cd backend
node scripts/test_ivr_concurrency_and_recommendations.js
```

---

## 3. Test Coverage Matrix

| Guarantee | Tested In | Key Assertion |
| :--- | :--- | :--- |
| **Atomic Capacity Locking** | `test_production_reliability_suite.js` | Concurrency row lock permits exactly 1 booking and rejects contender with `SLOT_FULL`. |
| **Calendar Date Preservation** | `test_booking_date_off_by_one_suite.js` | Pure `YYYY-MM-DD` preserved without UTC day-shifts (Tests 0 to 7). |
| **Queue Lifecycle Isolation** | `test_critical_lifecycle_and_ivr_sync.js` | `Payment Completed` visits strictly excluded from physical queue and "Your Active Visit". |
| **Fairness Neutrality** | `test_production_reliability_suite.js` | Priority points granted purely on operational disruptions (zero socioeconomic bias). |
| **IVR / Web Sync Parity** | `test_critical_lifecycle_and_ivr_sync.js` | Ext 1000 & Ext 2000 write to same PostgreSQL database read by Farmer Home and Centre Queue. |
