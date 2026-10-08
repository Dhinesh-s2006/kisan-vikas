# 🌾 Kisan Vikas — Accessibility Telephone IVR Layer

> **Authoritative IVR Engine**: Extension `2000` on FastAGI Port `4574`  
> **Server Implementation**: `backend/services/ivr/newFastAgiServer.js`  
> **Core System**: Integrates seamlessly with the central Kisan Vikas backend and PostgreSQL database.

---

## 1. Overview & Purpose

The **Kisan Vikas Accessibility IVR Layer** enables farmers with limited digital literacy, basic feature phones, or restricted internet connectivity to access all core procurement functions through a standard voice phone call using keypad (DTMF) interactions.

### Key Capabilities
- **Trilingual Voice Support**: Complete audio prompts and voice navigation in **Tamil (தமிழ்)** (default), **English**, and **Hindi (हिन्दी)**.
- **Strict Caller ID Identification**: Automatically looks up incoming caller numbers against registered farmer records in PostgreSQL. Unregistered callers are rejected with polite verbal guidance to register via web or an assisted CSC centre.
- **Spoken Farmer Identity Confirmation**: Speaks the farmer's registered name and Farmer ID in their chosen language before granting access to operations.
- **One-Touch Instant Booking**: Deterministic, automated allocation that evaluates operational procurement centres, road travel distance, and slot availability within the farmer's registered district.
- **Slot Expiry & Real-Time Capacity Protection**: Automatically validates time windows in `Asia/Kolkata` time and uses atomic locking to prevent slot overbooking.
- **PostgreSQL as Single Source of Truth**: Bookings, digital passes, and queue statuses are committed directly to the central database and are immediately visible across Farmer Web and Centre Admin portals.
- **Shared Business Logic**: Directly shares backend booking engines, validation rules, and cancellation policies with web and CSC channels.

---

## 2. Architecture & Design Principles

```
MicroSIP / Mobile Caller
         |
         v
   Asterisk PBX (:5060)
         |
    Dial 2000
         |
         v
   FastAGI (:4574)
         |
         v
   Express API (:4000)
         |
         v
   PostgreSQL (:5432)
```

### Design Principles
- **Additive & Non-Disruptive**: Operates cleanly alongside the web portal and administrative dashboards without modifying underlying database schemas or business rules.
- **Single Source of Truth**: Uses existing backend transactional locks (`pg_advisory_xact_lock`), Digital Pass endpoints, and dynamic pacing without a separate or duplicated IVR database.
- **Atomic Concurrency Protection**: Transactions use PostgreSQL advisory locks to guarantee that two simultaneous calls or web requests never double-book the same slot counter.
- **Provider-Neutral Abstraction**: Voice protocol handling is decoupled behind the `TelephonyAdapter` interface, allowing smooth operation across on-premise Asterisk PBX, SIP trunks, or cloud telephony providers (Exotel, Twilio).

---

## 3. Directory Structure

```
ivr/
├── asterisk/
│   └── config/
│       ├── asterisk.conf       # Master Asterisk daemon configuration
│       ├── extensions.conf     # Dialplan routing Extension 2000 to FastAGI :4574
│       ├── logger.conf         # Console & error logging
│       ├── modules.conf        # Required Asterisk 22 module autoloading
│       ├── pjsip.conf          # SIP endpoints, authentication, and transports
│       └── rtp.conf            # RTP media port configuration
├── config/
│   └── ivrConfig.js            # Environment configuration & default port 4574
├── core/
│   ├── bookingService.js       # Active booking check & slot reservation
│   ├── centreService.js        # Procurement centre status & live pacing
│   ├── farmerService.js        # Caller ID lookup & authentication
│   ├── grievanceService.js     # Categorized farmer grievance filing
│   ├── nearestCentresHelper.js # Spatial centre proximity & date resolution
│   ├── paymentService.js       # MSP payout status & DBT tracking
│   ├── rescheduleService.js    # Smart reschedule suggestions & decisions
│   └── statusService.js        # Authoritative Digital Pass & wait-time
├── prompts/
│   ├── languageManager.js      # Trilingual string interpolation (Tamil, English, Hindi)
│   └── promptMessages.js       # Multilingual dictionary of voice prompts
├── telephony/
│   ├── asterisk/
│   │   └── AsteriskAdapter.js  # FastAGI TCP protocol adapter
│   ├── mock/
│   │   └── MockTelephonyAdapter.js # Mock adapter for offline testing
│   ├── TelephonyAdapter.js     # Abstract telephony interface
│   └── ttsGenerator.js         # Real-time TTS synthesis engine
├── docker-compose.yml          # Asterisk Docker service configuration
├── package.json                # Dependencies and npm scripts
└── README.md                   # This documentation
```

*Note: The authoritative FastAGI server engine is implemented in `backend/services/ivr/newFastAgiServer.js`.*

---

## 4. Quickstart: Running the System

### Prerequisites
- Docker Desktop (running)
- Node.js 20+
- PostgreSQL (running database on port 5432)

### Step 1: Start Asterisk in Docker
From the `ivr/` directory:
```powershell
docker compose up -d
```
Verify the container is healthy:
```powershell
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
```
*Expected Output: Endpoint `1001` listed as Available.*

### Step 2: Start Kisan Vikas Backend & FastAGI Telephony
The FastAGI Extension 2000 service launches automatically alongside the Express API server:
```powershell
cd backend
npm start
```
*Expected Output:*
```
Backend running on port 4000
[NEW-IVR] FastAGI Server listening on 0.0.0.0:4574
[NEW-IVR] Extension 2000 is ready for MicroSIP calls
```

To run only the FastAGI telephony daemon in standalone mode:
```powershell
cd backend
npm run ivr
```

---

## 5. Softphone Setup (MicroSIP Demonstration)

Evaluators and judges can place live voice calls to the IVR using **MicroSIP** ([microsip.org](https://www.microsip.org/)):

1. Open **MicroSIP** ➔ Click Menu ➔ **Add Account...**
2. Configure account settings:
   - **Account Name**: `KisanVikas`
   - **SIP Server**: `127.0.0.1:5060`
   - **SIP Proxy**: `127.0.0.1:5060`
   - **Username**: `1001`
   - **Domain**: `127.0.0.1`
   - **Password**: `kisan123`
3. Click **Save** and verify status shows **Online**.
4. **Dial ONLY `2000`** and press Call.
5. Asterisk connects the call to FastAGI on port 4574 and you will hear the trilingual greeting:
   *"தமிழுக்கு 1 அழுத்தவும். Press 2 for English. हिंदी के लिए 3 दबाएं."*

### Testing with Specific Registered Farmer Identities
In development, Asterisk softphones present caller ID `1001`. You can configure which registered farmer is identified by setting `NEW_IVR_TEST_PHONE` in `backend/.env`:
```env
NEW_IVR_TEST_PHONE=9876543210
```
*(Example: `9000000016` maps to Deepak in Ariyalur; `9000000088` maps to Kavitha in Vellore).*

Alternatively, you can test any registered farmer directly from MicroSIP by dialing the pattern:
```
2000*<PHONE_NUMBER>
```
*Example: Dialing `2000*9000000016` immediately identifies farmer Deepak without modifying `.env`.*

---

## 6. Keypad (DTMF) Navigation Flow

```
                        [ Incoming Call to 2000 ]
                                    |
                       [ Language Selection (1-3) ]
                                    |
                    [ Caller ID Lookup in PostgreSQL ]
                                    |
                 +------------------+------------------+
                 |                                     |
           [ Unregistered ]                       [ Registered ]
                 |                                     |
          Say Error & Hangup                Spoken Identity Confirmation
                                                 (Name & Farmer ID)
                                            Press 1 (Confirm) / 2 (Reject)
                                                       |
                                                [ MAIN MENU ]
                                                       |
          +-------+-------+-------+-------+-------+----+----+-------+-------+
          |       |       |       |       |       |         |       |       |
         (1)     (2)     (3)     (4)     (5)     (6)       (7)     (8)     (9)
        Book   Booking  Centre  Resched  Raise  Payment  Digital  Repeat   End
        Visit  Status   Status   Visit  Griev-  Status    Pass    Menu    Call
                                         ance
```

### Main Menu Options
| Key | Option | Behavior |
| :---: | :--- | :--- |
| **1** | **Book Visit** | Enforces Single Active Booking Rule. If eligible, automatically allocates nearest available slot at the optimal operational centre in farmer's district and commits booking to PostgreSQL. |
| **2** | **Booking Status** | Speaks current active booking details, date, time window, centre name, and token number. |
| **3** | **Centre Status** | Speaks operational status (Open/Busy), active queue count, and counters for the nearest centre. |
| **4** | **Reschedule** | Checks eligible upcoming alternative slots and allows one-key acceptance or cancellation. |
| **5** | **Raise Grievance** | Collects grievance category and registers an auditable grievance ticket in the database. |
| **6** | **Payment Status** | Announces latest MSP procurement payout amount, payment status, and DBT disbursement method. |
| **7** | **Digital Pass** | Speaks digital pass token, queue status, and recommended arrival advisory. |
| **8** | **Repeat Menu** | Replays the main menu options without disconnecting. |
| **9** | **End Call** | Speaks farewell prompt in selected language and disconnects cleanly. |

### Retry & Timeout Policy
- **Invalid Key**: Speaks *"Invalid option. Please try again."* in the selected language and re-prompts.
- **No Input (Timeout)**: Speaks *"We did not receive your input."* and re-prompts.
- **Maximum Retries**: After 3 failed attempts, plays farewell notice and hangs up safely.

---

## 7. Automated Test Suites

The active Extension 2000 FastAGI implementation is validated by automated test suites in the repository:

### 1. Complete IVR Verification Suite
```powershell
node backend/scripts/run_ivr_verification_suite.js
```
Validates:
- FastAGI Port 4574 health check
- Live Asterisk call connection to Extension 2000
- Trilingual selection & spoken farmer identity (Tamil, English, Hindi)
- One-press automated booking creation and DB persistence
- Duplicate active booking prevention
- Unregistered caller hard gate
- Menu navigation options

### 2. Live FastAGI Simulation & DB Audit
```powershell
node backend/tests/verify_ivr_fastagi.js
```
Validates real FastAGI socket handshake on port 4574, DTMF collection, atomic slot capacity decrement, and PostgreSQL persistence.

### 3. Website & IVR Parity Suite
```powershell
node backend/scripts/test_ivr_website_sync_and_expiry.js
```
Validates recommendation synchronization between web and IVR, slot expiry enforcement, and single-source-of-truth consistency.

---

## 8. Cloud Telephony Integration (Exotel / Twilio)

The system is built on top of the abstract `TelephonyAdapter` interface:

```javascript
class TelephonyAdapter {
  async answerCall() {}
  getCallerNumber() {}
  async playAudio(audioFile) {}
  async speak(text, language) {}
  async collectDTMF(maxDigits, timeoutMs) {}
  async hangup() {}
}
```

The underlying telephony provider is fully decoupled:
- **Asterisk PBX**: Uses `AsteriskAdapter` to communicate over FastAGI TCP sockets on port 4574.
- **Cloud Providers**: To route incoming webhook calls from cloud trunks such as Exotel or Twilio Voice, incoming webhooks map to `IVRService` in `backend/services/ivr/ivrService.js` without altering core booking logic.
