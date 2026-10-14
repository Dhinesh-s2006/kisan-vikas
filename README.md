# 🌾 Kisan Vikas (உழவர் முன்னேற்றம்)

### Empowering Farmers. Simplifying Procurement. Building Transparency.

<p align="center">
  <a href="https://kisan-queue-frontend.vercel.app/" target="_blank" rel="noopener noreferrer">
    <img src="https://img.shields.io/badge/🚀_CLICK_HERE_TO_LAUNCH_LIVE_DEMO-OPEN_KISAN_VIKAS-228B22?style=for-the-badge&logo=vercel&logoColor=white" alt="Launch Kisan Vikas Live Demo"/>
  </a>
</p>

<p align="center">
  <strong>👨‍🌾 Farmer Portal | 📅 Smart Slot Booking | 📊 Queue Tracking | 🤝 Assisted Access</strong>
</p>

---

## 🔑 Reviewer Access — Demo Credentials

**Welcome, Evaluators!** Use the live demo button above to open Kisan Vikas. The following demo accounts let you explore the application from different stakeholder perspectives.

> **Evaluation use only:** These credentials are intended for demonstration. Please do not enter real farmers' personal information.

### 👨‍🌾 1. Farmer Portal

| Field | Credentials |
|---|---|
| Farmer ID | `F758874` |
| Phone Number | `9020071017` |

### 🏢 2. DPC Centre Admin — Ariyalur

| Field | Credentials |
|---|---|
| Username | `dpc_admin_TN_DPC_0001` |
| Password | `Kisan@95EFB5#26` |
| Centre | Aiyyur Direct Paddy Procurement Centre |
| Centre ID | `TN_DPC_0001` |

### 🖥️ 3. CSC Operator — Ariyalur

| Field | Credentials |
|---|---|
| Username | `csc_ariyalur` |
| Password | `Kisan@593484#26` |

### 🏛️ 4. District Officer — Ariyalur

| Field | Credentials |
|---|---|
| Username | `officer_ariyalur` |
| Password | `kisan@123` |


### 🧭 Suggested Evaluation Flow

1. **Farmer:** Explore the farmer portal and procurement visit workflow.
2. **Centre Admin:** View and manage procurement-centre operations.
3. **CSC Operator:** Explore assisted access for farmers.
4. **District Officer:** Explore district-level monitoring.

*Some features may require a working backend and valid demo data.*

---

## 🌱 About Kisan Vikas

**Intelligent Agricultural Procurement Scheduling & Real-Time Queue Orchestration Platform**

*Bridging Digital Farmers, Feature-Phone Callers, and Direct Purchase Centres through Transparent, Synchronized Procurement.*

**விவசாயிகள் கொள்முதல் மையங்களில் தங்களுடைய விளைபொருட்களை விற்பனை செய்வதற்கான நேர முன்பதிவு, வரிசை மேலாண்மை மற்றும் கொள்முதல் நிலை கண்காணிப்பு அமைப்பு.**


** இணையதளம், தொலைபேசி வழி சேவை மற்றும் உதவி மையங்கள் மூலம் விவசாயிகள்
கொள்முதல் மையத்தில் நேரத்தை முன்பதிவு செய்து, காத்திருப்பு நேரத்தைக்
குறைத்து, தங்களுடைய கொள்முதல் நிலையை அறிந்து கொள்ள உதவும் ஒருங்கிணைந்த அமைப்பு.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v14%2B-blue.svg)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-18.x-61dafb.svg)](https://react.dev/)
[![Asterisk PBX](https://img.shields.io/badge/Asterisk-v18%20LTS-orange.svg)](https://www.asterisk.org/)

---

## 1. Problem Statement

At government Direct Purchase Centres (DPCs) and agricultural mandis across India:
- **Chaotic Physical Congestion**: Farmers wait in tractor queues for days during peak harvest season, leading to severe grain deterioration, exposure to rain, and physical exhaustion.
- **Distress Selling to Middlemen**: Because queue slots are non-transparent and uncoordinated, smallholder farmers frequently sell crops to private aggregators below Minimum Support Price (MSP).
- **Digital Inequity**: Most procurement platforms assume smartphone and broadband internet access, effectively disenfranchising millions of smallholder farmers using basic feature phones.
- **Data Fragmentation**: Administrative officers lack real-time visibility into mandi arrival congestion, physical queue depth, and district-level grain demand.

---

## 2. Solution Overview

**Kisan Vikas** transforms agricultural procurement into an orchestrated, equitable, multi-channel ecosystem:
1. **Multi-Channel Ingestion**: Provides identical procurement booking access via a modern web application (Farmer Web), Common Service Centre (CSC) assisted kiosks, and interactive telephone IVR (FastAGI over Asterisk).
2. **Deterministic Queue Scheduling**: Allocates time-bound, capacity-capped procurement slots (e.g., 08:00–09:00 AM) that guarantee physical throughput at centres without congestion.
3. **Operational Fairness**: Protects smallholder and disrupted farmers using interaction-based priority scoring (zero socioeconomic bias).
4. **End-to-End Procurement Lifecycle**: Tracks appointments through `Confirmed` ➔ `Checked-In` ➔ `Grading` ➔ `Weighing` ➔ `Procured` ➔ `Payment Completed` (Direct Benefit Transfer).
5. **Real-Time Data Parity**: Powered by a single PostgreSQL database ensuring instant synchronization across IVR calls, farmer web views, and administrative queue monitors.

---

## 3. User Roles & Stakeholders

| Stakeholder | Interface | Primary Responsibilities |
| :--- | :--- | :--- |
| **Digital Farmer** | Farmer Web Portal (`/`) | Self-service slot booking, digital pass QR code, live queue tracking, and MSP payment receipt inspection. |
| **IVR Feature-Phone Farmer** | Telephone IVR (`Ext 2000`) | Multilingual voice booking (Tamil, English, Hindi), status playback, audio digital pass, and DBT balance enquiry. |
| **CSC Operator** | Assisted Kiosk (`/assisted-kiosk`) | Assisted registration and crop declaration booking for farmers without digital literacy. |
| **Centre Administrator** | Centre Admin Portal (`/centre-admin`) | Live physical token verification, farmer check-in, quality assessment (FAQ standards), and weighment recording. |
| **District Officer** | District GIS Dashboard (`/district-officer`) | District-wide capacity oversight, inter-centre load balancing, disruption handling, and predictive planning. |
| **Super Administrator** | Platform Governance (`/super-admin`) | Master procurement centre registry, officer provisioning, RBAC configuration, and platform audit logs. |

---

## 4. Key Platform Capabilities

- **Intelligent Slot Allocation**: Recommends nearest operational centres based on harvest location, available slot capacity, and road travel distance.
- **Calendar-Date Architecture**: Procurement dates are strictly calendar dates (`YYYY-MM-DD` in `Asia/Kolkata`), eliminating UTC timezone offset errors across web and telephony.
- **IVR Telephony Pipeline**:
  - `Extension 2000`: Rapid one-touch automatic allocation with immediate farmer identity voice playback.
- **Fairness & Disruption Engine**: Automatically prioritizes farmers who experienced centre closures, rainfall delays, or system reschedules without socioeconomic profiling.
- **Active Physical Queue Isolation**: Completed visits (`Payment Completed`) and expired unarrived visits are automatically excluded from live physical queues while remaining fully accessible in historical ledgers.
- **AI Procurement Copilot**: Natural language operational intelligence for District Officers and Centre Admins powered by Google Gemini with deterministic fallback rules.
- **Atomic Concurrency Protection**: Advisory locks and row-level `SELECT ... FOR UPDATE` locks prevent slot overbooking under concurrent burst traffic.

---

## 5. System Architecture

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Kisan Vikas Architecture               │
                  └────────────────────────────────────────────────────────┘

    [ Farmer Web ]      [ MicroSIP / IVR ]      [ CSC Kiosk ]      [ Admin / Officer ]
     (React+Vite)       (Asterisk PBX)          (Assisted)         (React Dashboard)
          │                   │                      │                     │
          │                   ▼                      │                     │
          │         [ FastAGI Telephony ]            │                     │
          │                   |                       │
          │         :4574 (Ext 2000)                 │                     │
          │                   │                      │                     │
          └───────────┬───────┴──────────────────────┴─────────────────────┘
                      ▼
       ┌────────────────────────────────────────────────────────┐
       │         Core Backend API Engine (Node.js :4000)        │
       ├────────────────────────────────────────────────────────┤
       │  • JWT Auth & Scoped RBAC     • Slot Expiry Engine     │
       │  • Intelligent Booking Engine • Fairness Engine        │
       │  • Queue State Machine        • Congestion Telemetry   │
       │  • Officer AI Copilot         • Calendar Serializer    │
       └──────────────────────────┬─────────────────────────────┘
                                  ▼
       ┌────────────────────────────────────────────────────────┐
       │           PostgreSQL Database (kisan_queue)            │
       ├────────────────────────────────────────────────────────┤
       │  • farmers      • centres      • slots                 │
       │  • bookings     • status_hist  • reschedule_events     │
       └────────────────────────────────────────────────────────┘
```

For in-depth architectural specifications, see [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

---

## 6. Technology Stack

- **Backend Runtime**: Node.js (v20+ LTS)
- **Web Framework**: Express.js
- **Database**: PostgreSQL (v14+) with raw SQL transactions & advisory locks
- **Telephony & PBX**: Asterisk PBX (v18 LTS) with FastAGI (Asterisk Gateway Interface)
- **Frontend Framework**: React 18 with Vite
- **Styling**: Kisan Design System (Bilingual Green/Earthy Semantic CSS)
- **Speech & NLU**: Bhashini Udyat ASR / Sarvam STT & Google Gemini 3.5 Flash Lite
- **SIP Client**: MicroSIP (v3.21+) for SIP telephony testing

---

## 7. Repository Structure

```
kisan-vikas/
├── frontend/                   # Farmer Web Portal (React + Vite)
│   ├── src/                    # Pages, components, and design system
│   └── public/                 # Static assets and icons
├── admin-dashboard/            # Centre Admin & District Officer Portal
│   ├── src/                    # Administration modules and queue UI
│   └── public/                 # Static administrative assets
├── backend/                    # Core Express API & Backend Services
│   ├── services/               # Modular business logic:
│   │   ├── ai/                 # Gemini & fallback AI copilot engines
│   │   ├── booking/            # Slot booking, validation, and expiry
│   │   ├── centre/             # Centre discovery and recommendations
│   │   ├── congestion/         # Real-time queue congestion estimation
│   │   ├── fairness/           # Operational fairness and priority scoring
│   │   ├── ivr/                # Ext 2000 FastAGI server and ivr services
│   │   └── speech/             # Bhashini & Sarvam STT integrations
│   ├── scripts/                # Database migrations & test suites
│   └── tests/                  # Canonical business logic tests
├── ivr/                        # IVR Telephony Codebase & Asterisk Configs
│   ├── asterisk/config/        # Asterisk PBX templates (pjsip, extensions)
│   ├── core/                   # Telephony booking, status, and centre logic
│   ├── prompts/                # Multilingual prompts (Tamil, English, Hindi)
│   
├── docs/                       # Technical Documentation for Judges
│   ├── architecture/           # Technical Design Document & Architecture
│   ├── api/                    # REST API Contract Specifications
│   ├── database/               # PostgreSQL schema & relationships
│   ├── ivr/                    # IVR telephony architecture & MicroSIP guide
│   ├── deployment/             # Deployment and setup guide
│   └── testing/                # Test suite execution guide
├── sample-data/                # Safe Demonstration Datasets (JSON)
│   ├── farmers.example.json    # Sample farmer profiles
│   ├── centres.example.json    # Sample procurement centres
│   ├── slots.example.json      # Sample procurement slots
│   └── bookings.example.json   # Sample procurement bookings
├── .env.example                # Environment variables template (Zero secrets)
├── .gitignore                  # Production git ignore configuration
├── LICENSE                     # MIT Open Source License
└── README.md                   # Project overview & documentation
```

---

## 8. Prerequisites

- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0 or later
- **PostgreSQL**: v14.0 or later
- **Asterisk PBX** *(Optional, for live IVR telephony)*: v18 LTS
- **MicroSIP** *(Optional, for testing voice calls)*: Free SIP softphone

---

## 9. Installation & Setup

### 9.1 Clone Repository
```bash
git clone https://github.com/Dhinesh-s2006/kisan-vikas.git
cd kisan-vikas
```

### 9.2 Configure Environment Variables
Copy the template and configure your local PostgreSQL credentials:
```bash
cp .env.example .env
cp .env.example backend/.env
```
Edit `backend/.env` with your PostgreSQL password and port:
```env
PORT=4000
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/kisan_queue
JWT_SECRET=your_jwt_secret_key_here
NEW_IVR_TEST_PHONE=9876543210
```

### 9.3 PostgreSQL Database Initialization
Ensure PostgreSQL is running, then initialize the database:
```bash
# In PostgreSQL CLI / pgAdmin:
CREATE DATABASE kisan_queue;

# Run migrations and provisioning scripts:
cd backend
npm install
node seed.js
node scripts/migrate_master_platform.js
node scripts/migrate_demo_and_expiry_schema.js
node scripts/migrate_concurrency_hardening.js
node scripts/provision_centre_admins.js
node scripts/provision_district_officers.js
node scripts/provision_csc_operators.js
```

---

## 10. Starting Platform Services

### 10.1 Start Backend API & FastAGI Ext 2000
```bash
cd backend
npm install
node index.js
# Express API: http://localhost:4000
# FastAGI Ext 2000: 0.0.0.0:4574
```


### 10.2 Web Portal
In a separate terminal:
```bash
cd frontend
npm install
npm run dev
# Accessible at: http://localhost:5173
```

🔐 Super Admin Portal
The Super Admin interface is intentionally separated from the primary user-facing website to maintain an additional abstraction boundary for platform-level administration.
It provides access to system-wide governance functions such as user/role management, procurement-centre administration and platform configuration.
After starting the backend and frontend, open the following link separately:

Super Admin: http://localhost:5173/super-admin

The Super Admin does not require a separate frontend server. It is a separately routed administrative interface within the application, intentionally kept away from the normal farmer and operational workflows.


Farmer Portal:
http://localhost:5173/

Centre Admin:
http://localhost:5173/admin

District Officer:
http://localhost:5173/district-officer

CSC:
http://localhost:5173/assisted-kiosk

Super Admin:
http://localhost:5173/super-admin

---

## 11. MicroSIP Demonstration Instructions

To test the voice telephony interface locally:
1. Download and open **MicroSIP** ([microsip.org](https://www.microsip.org/)).
2. Go to **Menu ➔ Add Account**:
   - **Account Name**: `KisanVikas`
   - **SIP Server**: `127.0.0.1:5060`
   - **SIP Proxy**: `127.0.0.1:5060`
   - **Username**: `1001`
   - **Domain**: `127.0.0.1`
   - **Password**: `kisan123`
3. Click **Save** and confirm status is **Online**.
4. **Dial Extension 2000**: Tests one-touch instant booking and automated identity vocal playback.

---

## 12. Verification & Automated Test Suites

Kisan Vikas includes comprehensive test suites covering ACID transactions, capacity limits, calendar dates, and channel synchronization:

```bash
cd backend

# 1. Date Off-by-One & Calendar Serialization Suite (Tests 0-7)
node scripts/test_booking_date_off_by_one_suite.js
# Result: 26 / 26 Assertions Passed (100%)

# 2. Production Reliability & Invariants Suite (18 Invariants)
node scripts/test_production_reliability_suite.js
# Result: 26 / 26 Invariants Passed (100%)

# 3. Critical Lifecycle & IVR Persistence Sync Suite
node scripts/test_critical_lifecycle_and_ivr_sync.js
# Result: 20 / 20 Assertions Passed (100%)

# 4. Canonical Business Logic Invariants
node tests/verify_canonical_business_logic.js
```

---

## 13. Evaluator Demo Credentials

The following accounts are provided specifically for **hackathon evaluation and demonstration** of the Kisan Vikas system.

>**Evaluation Only:** These are demo credentials intended for evaluators to explore the system. They must not be used for production deployments or real farmer data.

**“We don't just have one login; we have role-based access with different views and permissions for each stakeholder.”**

### 👨‍🌾 Demo Farmer

| Field | Details |
|---|---|
| Farmer ID | `F758874` |
| Phone Number | `9020071017` |

### 🏢 DPC Centre Admin — Ariyalur District

**Aiyyur Direct Paddy Procurement Centre**

| Field | Details |
|---|---|
| Username | `dpc_admin_TN_DPC_0001` |
| Password | `Kisan@95EFB5#26` |
| Centre | Aiyyur Direct Paddy Procurement Centre |
| Centre ID | `TN_DPC_0001` |
| District | Ariyalur |

### 🖥️ CSC Operator — Ariyalur District

| Field | Details |
|---|---|
| Username | `csc_ariyalur` |
| Password | `Kisan@593484#26` |
| District | Ariyalur |

### 🏛️ District Officer — Ariyalur District

| Field | Details |
|---|---|
| Username | `officer_ariyalur` |
| Password | `kisan@123` |
| District | Ariyalur |

### 🔐 Super Admin

| Field | Details |
|---|---|
| Username | `superadmin` |
| Password | `kisan@123` |

> **Recommended evaluation flow:** Start with the **Farmer** account to create/view a procurement visit, then use the **DPC Centre Admin** account to view and manage the farmer's booking. The **CSC Operator**, **District Officer**, and **Super Admin** accounts can be used to explore their respective dashboards and administrative functions.
---

## 14. Known Limitations & Roadmap

- **SMS Gateway**: Simulated locally via in-database notification events; requires Twilio or CDAC SMS gateway integration for carrier delivery.
- **Hardware Weighbridge Integration**: Current system accepts manual or digital weighbridge readings via REST API; direct RS-232 serial integration is planned for Phase 2.
- **Offline Mesh P2P**: In remote mandis with intermittent cell coverage, Bluetooth/mesh sync between weighing counters is on the future roadmap.

---

## 15. License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
