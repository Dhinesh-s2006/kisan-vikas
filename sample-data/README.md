# Kisan Vikas — Sample & Demonstration Datasets

This directory contains sanitized, non-sensitive sample datasets reflecting the authentic operational schema, entities, and relationships used by the Kisan Vikas procurement scheduling and queue management platform.

## Dataset Files

| File | Entity Description | Record Count | Schema Highlights |
| :--- | :--- | :--- | :--- |
| `centres.example.json` | Operational Direct Purchase Centres (DPCs) | 25 centres | Real `TN_DPC_...` format, GPS coordinates (`latitude`, `longitude`), `operational_status: 'Open'`, `daily_capacity_slots`, `storage_capacity_mt`. No retired demo centres. |
| `users.example.json` | Administrative User Accounts | 25 accounts | Canonical RBAC user model (`user_id`, `username`, `role`: `CENTRE_ADMIN`, `DISTRICT_OFFICER`, `CSC_OPERATOR`, `SUPER_ADMIN`, `district`, `centre_id`). |
| `farmers.example.json` | Registered Farmer Profiles | 30 farmers | Canonical farmer model (`farmer_id`, `name`, `phone`, `village`, `district`). Phone numbers are safely masked. |
| `slots.example.json` | Hourly Procurement Capacity Slots | 50 slots | Canonical slot model (`slot_id`, `centre_id`, `date`, `start_time`, `end_time`, `max_farmers`, `booked_count`, `held_count`, `status`). |
| `bookings.example.json` | Procurement Appointment Bookings | 30 bookings | Canonical booking lifecycle (`booking_id`, `farmer_id`, `centre_id`, `slot_id`, `booking_date`: `YYYY-MM-DD`, `crop`, `quantity_quintals`, `status`, `token`, `msp_rate_inr`, `payment_status`). |

## Entity Relationship Overview

```
[Users (RBAC)] ── (assigned to) ── [Centres]
                                        │
[Farmers] ──────< [Bookings] >──────── [Slots]
                      │
                      ├─ Status Flow: Confirmed ➔ Checked-In ➔ Grading ➔ Weighing ➔ Procured ➔ Payment Completed
                      ├─ Calendar Date: YYYY-MM-DD (Asia/Kolkata timezone preservation)
                      └─ Queue Token: e.g. Q001
```

## Security & Privacy Notice
All records in this directory are sanitized for demonstration and evaluation purposes. All telephone numbers are anonymized test abstractions. No private passwords, credentials, or personal bank accounts are included.
