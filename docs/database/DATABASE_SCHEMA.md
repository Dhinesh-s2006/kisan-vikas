# Kisan Vikas — Database Schema & Architecture Specification

## 1. Overview
The Kisan Vikas database is hosted on **PostgreSQL** (`kisan_queue`). It serves as the single source of truth across all channels (Farmer Web, IVR Ext 1000, IVR Ext 2000, Centre Admin Portal, District Officer Dashboard, and Super Admin Portal).

---

## 2. Primary Tables & Relationships

```mermaid
erDiagram
    FARMERS ||--o{ BOOKINGS : "places"
    CENTRES ||--o{ SLOTS : "schedules"
    SLOTS ||--o{ BOOKINGS : "reserves"
    CENTRES ||--o{ BOOKINGS : "processes"
    BOOKINGS ||--o{ STATUS_HISTORY : "tracks"
    BOOKINGS ||--o{ RESCHEDULE_EVENTS : "logs"
    CENTRES ||--o{ GRIEVANCES : "receives"
    FARMERS ||--o{ GRIEVANCES : "files"

    FARMERS {
        string farmer_id PK
        string name
        string phone
        string village
        string district
        float land_area_acres
        string primary_crop
        timestamp created_at
    }

    CENTRES {
        string centre_id PK
        string name
        string village_town
        string district
        float latitude
        float longitude
        string status
        int daily_capacity_farmers
    }

    SLOTS {
        string slot_id PK
        string centre_id FK
        date date
        time start_time
        time end_time
        int max_farmers
        int booked_count
        int held_count
        boolean is_expired
        string status
    }

    BOOKINGS {
        string booking_id PK
        string farmer_id FK
        string slot_id FK
        string centre_id FK
        date booking_date
        string crop
        float quantity_quintals
        string status
        string token
        float msp_rate_inr
        float payment_amount_inr
        string payment_status
        string booking_source
        string idempotency_key
        int queue_position_at_booking
        timestamp created_at
    }

    STATUS_HISTORY {
        serial id PK
        string booking_id FK
        string from_status
        string to_status
        string changed_by
        timestamp changed_at
    }

    RESCHEDULE_EVENTS {
        serial id PK
        string booking_id FK
        string old_slot_id
        string new_slot_id
        string reason
        timestamp rescheduled_at
    }
```

---

## 3. Data Integrity & Concurrency Constraints

1. **Calendar Date Preservation (OID 1082)**:
   - All appointment dates (`bookings.booking_date`, `slots.date`) are defined as PostgreSQL `DATE`.
   - Node-postgres driver type parser 1082 returns raw text strings (`YYYY-MM-DD`), preventing UTC shifts during JSON serialization.

2. **Atomic Slot Row Locking**:
   - Concurrent bookings use `SELECT * FROM slots WHERE slot_id = $1 FOR UPDATE`.
   - Slots increment `booked_count` atomically:
     ```sql
     UPDATE slots SET booked_count = booked_count + 1 WHERE slot_id = $1 AND booked_count < max_farmers;
     ```

3. **Single Active Booking Invariant**:
   - A farmer is restricted to at most one active appointment across future or current calendar dates until the existing appointment reaches a terminal state (`Payment Completed`, `Cancelled`, `Expired`).

4. **District-Centre Boundary Invariant**:
   - Cross-district bookings are prohibited by database and application checks ensuring `farmers.district == centres.district`.
