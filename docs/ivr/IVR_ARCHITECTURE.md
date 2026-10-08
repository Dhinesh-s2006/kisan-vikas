# Kisan Vikas — IVR Telephony & FastAGI Architecture

## 1. Overview
The Kisan Vikas IVR system provides multi-lingual telephone access for farmers using feature phones or basic mobile connectivity without internet access. It operates via the **Asterisk PBX** telephony engine communicating with Node.js **FastAGI** (Asterisk Gateway Interface) services.

---

## 2. Telephony Topology

```
MicroSIP / Mobile Caller
          │
          ▼
   Asterisk PBX (:5060)
     └── Dial 2000 ──> FastAGI Service (:4574) [backend/services/ivr/newFastAgiServer.js]
                             │
                             ▼
                    Express REST API (:4000)
                             │
                             ▼
                    PostgreSQL Database (:5432)
```

### Extension 2000 (Port 4574) — Authoritative Voice Telephony Engine
- **Purpose**: Authoritative voice response and one-touch appointment booking engine (`backend/services/ivr/newFastAgiServer.js`).
- **Languages**: Full trilingual voice support: Tamil (1), English (2), Hindi (3).
- **Features**:
  - Automated caller phone lookup (`NEW_IVR_TEST_PHONE` or caller ID).
  - Immediate identification: Farmer name and registered ID vocal playback.
  - Complete 9-option interactive main menu:
    - `1`: One-Touch Visit Booking (Nearest centre allocation & atomic slot locking)
    - `2`: Booking Status & Digital Pass details
    - `3`: Centre Congestion & Queue Status
    - `4`: Reschedule Booking
    - `5`: Grievance Ticket Generation
    - `6`: MSP Payment Details & DBT Tracking
    - `7`: Digital Pass Token & Wait Time
    - `8`: Repeat Menu
    - `9`: End Call
  - Atomic slot locking and direct PostgreSQL commitment.
  - Extension 2000 (Port 4574) is the authoritative IVR service.

---

## 3. MicroSIP Demonstration Setup

For judges and evaluators demonstrating the IVR locally:

1. **Install MicroSIP**: Download from [microsip.org](https://www.microsip.org/).
2. **Account Configuration**:
   - **Account Name**: `KisanVikas`
   - **SIP Server**: `127.0.0.1:5060`
   - **SIP Proxy**: `127.0.0.1:5060`
   - **User**: `1001` (or configured Asterisk SIP endpoint)
   - **Domain**: `127.0.0.1`
   - **Password**: `kisan123`
3. **Dialing**:
   - Dial **`2000`** to test Extension 2000.
4. **Development Caller ID Simulation**:
   Set `NEW_IVR_TEST_PHONE` in `backend/.env` (e.g. `9876543210`) to simulate any registered farmer account.
